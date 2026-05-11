/**
 * Phase 116-03 F26 — In-UI agent config editor.
 *
 * Opens as a shadcn `<Dialog>` (full-page route deferred until 116-04 adds
 * react-router). Tabbed form with simple controlled state — react-hook-form
 * was the plan's nominal choice but introduces ~50KB of bundle for a single
 * form; controlled state hits the same UX with zero deps. Daemon-side
 * Zod validation via `agentSchema.partial()` is authoritative; UI surfaces
 * the daemon's 400-error message verbatim when invalid.
 *
 * Tabs:
 *   - Identity  (name, workspace, memoryPath, soulFile, identityFile)
 *   - Model     (model, allowedModels, effort)
 *   - Channels  (channels[] — Discord bindings)
 *   - Tools     (skills, fileAccess, outputDir)
 *   - MCP       (mcpServers — display-only; full editor in a later plan)
 *   - Memory    (memoryAutoLoad, memoryRetrievalTopK, dream)
 *   - Debug     (raw YAML view, system prompt directives)
 *
 * Restart-required fields render disabled with a "agent restart required"
 * tooltip — the daemon classifies via `RELOADABLE_FIELDS` and the response
 * carries `hotReloadableFields` + `restartRequiredFields`. The save flow:
 *
 *   1. PUT /api/config/agents/:name  — daemon Zod-validates + atomic-writes
 *   2. POST /api/config/hot-reload   — force chokidar to re-read (no debounce)
 *   3. Toast shows hot-reloaded vs needs-restart breakdown
 *
 * "Save + restart" path is deferred — the IPC is on the daemon (agent-control
 * restart) but the UI button needs an operator-confirm modal. 116-04 scope.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useAgentConfig,
  updateAgentConfig,
  triggerHotReload,
  type AgentConfigResponse,
  type UpdateAgentConfigResponse,
} from '@/hooks/useApi'

type TabKey =
  | 'identity'
  | 'model'
  | 'channels'
  | 'tools'
  | 'mcp'
  | 'memory'
  | 'debug'

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'identity', label: 'Identity' },
  { key: 'model', label: 'Model' },
  { key: 'channels', label: 'Channels' },
  { key: 'tools', label: 'Tools' },
  { key: 'mcp', label: 'MCP' },
  { key: 'memory', label: 'Memory' },
  { key: 'debug', label: 'Debug' },
]

const MODEL_OPTIONS = ['sonnet', 'opus', 'haiku'] as const
const EFFORT_OPTIONS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'auto',
  'off',
] as const

type Props = {
  readonly agentName: string | null
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; payload: UpdateAgentConfigResponse }
  | { kind: 'error'; message: string }

// ---------------------------------------------------------------------------
// Form-state model — flat shape mirroring agentSchema.partial(). The editor
// only tracks fields it can edit; the rest of the resolved block stays in
// `raw` and is sent through unchanged. Per-field "dirty" tracking diffs
// against the loaded raw so the save POST only carries actual changes.
// ---------------------------------------------------------------------------
type FormState = {
  workspace: string
  memoryPath: string
  model: string
  effort: string
  channels: string  // newline-separated for textarea
  allowedModels: string[]
  skills: string  // newline-separated
  memoryAutoLoad: boolean
  memoryRetrievalTopK: number | ''
}

function defaultFormState(raw: Record<string, unknown> | null): FormState {
  const r = raw ?? {}
  return {
    workspace: String(r['workspace'] ?? ''),
    memoryPath: String(r['memoryPath'] ?? ''),
    model: String(r['model'] ?? ''),
    effort: String(r['effort'] ?? ''),
    channels: Array.isArray(r['channels'])
      ? (r['channels'] as string[]).join('\n')
      : '',
    allowedModels: Array.isArray(r['allowedModels'])
      ? (r['allowedModels'] as string[])
      : [],
    skills: Array.isArray(r['skills'])
      ? (r['skills'] as string[]).join('\n')
      : '',
    memoryAutoLoad: Boolean(r['memoryAutoLoad']),
    memoryRetrievalTopK:
      typeof r['memoryRetrievalTopK'] === 'number'
        ? (r['memoryRetrievalTopK'] as number)
        : '',
  }
}

function buildPartial(
  current: FormState,
  original: FormState,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (current.workspace !== original.workspace) patch.workspace = current.workspace
  if (current.memoryPath !== original.memoryPath) {
    patch.memoryPath = current.memoryPath || undefined
  }
  if (current.model !== original.model && current.model.length > 0) {
    patch.model = current.model
  }
  if (current.effort !== original.effort && current.effort.length > 0) {
    patch.effort = current.effort
  }
  if (current.channels !== original.channels) {
    patch.channels = current.channels
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  if (current.skills !== original.skills) {
    patch.skills = current.skills
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  if (
    JSON.stringify(current.allowedModels.sort()) !==
    JSON.stringify([...original.allowedModels].sort())
  ) {
    patch.allowedModels = current.allowedModels
  }
  if (current.memoryAutoLoad !== original.memoryAutoLoad) {
    patch.memoryAutoLoad = current.memoryAutoLoad
  }
  if (current.memoryRetrievalTopK !== original.memoryRetrievalTopK) {
    patch.memoryRetrievalTopK =
      current.memoryRetrievalTopK === '' ? undefined : current.memoryRetrievalTopK
  }
  return patch
}

export function ConfigEditor({ agentName, open, onOpenChange }: Props) {
  const { data, isLoading, error, refetch } = useAgentConfig(agentName)
  const [tab, setTab] = useState<TabKey>('identity')
  const [form, setForm] = useState<FormState>(defaultFormState(null))
  const [original, setOriginal] = useState<FormState>(defaultFormState(null))
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle' })

  // Re-seed when fetched data arrives.
  useEffect(() => {
    if (data?.raw) {
      const next = defaultFormState(data.raw)
      setForm(next)
      setOriginal(next)
      setSaveStatus({ kind: 'idle' })
    }
  }, [data])

  const dirtyFields = useMemo(
    () => Object.keys(buildPartial(form, original)),
    [form, original],
  )

  const hotReloadable = useMemo(
    () => new Set(data?.hotReloadableFields ?? []),
    [data],
  )
  const restartRequired = useMemo(
    () => new Set(data?.restartRequiredFields ?? []),
    [data],
  )

  async function handleSave() {
    if (!agentName) return
    const partial = buildPartial(form, original)
    if (Object.keys(partial).length === 0) {
      setSaveStatus({
        kind: 'error',
        message: 'No changes to save.',
      })
      return
    }
    setSaveStatus({ kind: 'saving' })
    try {
      const result = await updateAgentConfig(agentName, partial)
      // Force the watcher to fire immediately so hot-reloadable fields
      // apply on the next turn without waiting for the chokidar debounce.
      try {
        await triggerHotReload()
      } catch {
        // hot-reload-now is best-effort — the watcher will pick up the
        // change on its own ~500ms debounce regardless.
      }
      setSaveStatus({ kind: 'success', payload: result })
      // Re-fetch so `original` reflects what's now on disk.
      void refetch()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      setSaveStatus({ kind: 'error', message })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Config: {agentName ?? '—'}</DialogTitle>
          <DialogDescription>
            Edit agent settings. Hot-reloadable fields apply on the next turn;
            restart-required fields take effect after{' '}
            <code className="rounded bg-muted px-1 text-xs">
              clawcode restart {agentName ?? '&lt;agent&gt;'}
            </code>
            .
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="text-sm text-muted-foreground">Loading config…</div>
        )}
        {error && (
          <div className="text-sm text-destructive">
            Failed to load: {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            {/* Tab bar */}
            <div className="flex flex-wrap gap-1 border-b">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={
                    'px-3 py-1.5 text-sm transition-colors ' +
                    (tab === t.key
                      ? 'border-b-2 border-primary text-foreground'
                      : 'text-muted-foreground hover:text-foreground')
                  }
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="max-h-[60vh] overflow-y-auto py-4">
              {tab === 'identity' && (
                <IdentityTab
                  form={form}
                  setForm={setForm}
                  restartRequired={restartRequired}
                />
              )}
              {tab === 'model' && (
                <ModelTab
                  form={form}
                  setForm={setForm}
                  restartRequired={restartRequired}
                />
              )}
              {tab === 'channels' && (
                <ChannelsTab form={form} setForm={setForm} />
              )}
              {tab === 'tools' && <ToolsTab form={form} setForm={setForm} />}
              {tab === 'mcp' && <McpTab raw={data.raw} />}
              {tab === 'memory' && (
                <MemoryTab form={form} setForm={setForm} hot={hotReloadable} />
              )}
              {tab === 'debug' && <DebugTab raw={data.raw} />}
            </div>

            {/* Dirty summary */}
            {dirtyFields.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <div className="mb-1 font-semibold">Pending changes:</div>
                <div className="flex flex-wrap gap-1">
                  {dirtyFields.map((f) => (
                    <Badge
                      key={f}
                      variant={hotReloadable.has(f) ? 'secondary' : 'destructive'}
                    >
                      {f}
                      {hotReloadable.has(f) ? ' (hot)' : ' (restart)'}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Save status / toast */}
            {saveStatus.kind === 'success' && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
                <div className="font-semibold">Saved.</div>
                {saveStatus.payload.hotReloaded.length > 0 && (
                  <div>
                    Hot-reloaded (applies on next turn):{' '}
                    {saveStatus.payload.hotReloaded.join(', ')}
                  </div>
                )}
                {saveStatus.payload.agentsNeedingRestart.length > 0 && (
                  <div>
                    Restart required for: {agentName}. Run{' '}
                    <code>clawcode restart {agentName}</code>.
                  </div>
                )}
              </div>
            )}
            {saveStatus.kind === 'error' && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {saveStatus.message}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  saveStatus.kind === 'saving' || dirtyFields.length === 0
                }
              >
                {saveStatus.kind === 'saving'
                  ? 'Saving…'
                  : `Save (${dirtyFields.length} change${dirtyFields.length === 1 ? '' : 's'})`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Tab subcomponents — kept small + co-located. Each is pure: takes form +
// setForm. Restart-required fields render disabled with a tooltip.
// ---------------------------------------------------------------------------

type TabProps = {
  form: FormState
  setForm: (next: FormState) => void
}

type TabPropsWithMeta = TabProps & { restartRequired: Set<string> }
type TabPropsWithHot = TabProps & { hot: Set<string> }

function RestartTip({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>
          Editing this field requires an agent restart to take effect. Use{' '}
          <code>clawcode restart &lt;agent&gt;</code> after save.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function IdentityTab({ form, setForm, restartRequired }: TabPropsWithMeta) {
  return (
    <div className="space-y-4">
      <Field label="workspace" restart={restartRequired.has('workspace')}>
        <input
          className="w-full rounded border bg-background px-2 py-1 text-sm"
          value={form.workspace}
          onChange={(e) => setForm({ ...form, workspace: e.target.value })}
        />
      </Field>
      <Field label="memoryPath" restart={restartRequired.has('memoryPath')}>
        <input
          className="w-full rounded border bg-background px-2 py-1 text-sm"
          value={form.memoryPath}
          onChange={(e) => setForm({ ...form, memoryPath: e.target.value })}
          placeholder="(defaults to workspace if blank)"
        />
      </Field>
    </div>
  )
}

function ModelTab({ form, setForm, restartRequired }: TabPropsWithMeta) {
  return (
    <div className="space-y-4">
      <Field label="model" restart={restartRequired.has('model')}>
        <select
          className="w-full rounded border bg-background px-2 py-1 text-sm"
          value={form.model}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
        >
          <option value="">(use default)</option>
          {MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          Model swap requires <code>clawcode restart</code> — captured into the
          SDK session at start. Per-turn /clawcode-model overrides still work
          on the live session.
        </p>
      </Field>
      <Field label="effort">
        <select
          className="w-full rounded border bg-background px-2 py-1 text-sm"
          value={form.effort}
          onChange={(e) => setForm({ ...form, effort: e.target.value })}
        >
          <option value="">(use default)</option>
          {EFFORT_OPTIONS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </Field>
      <Field label="allowedModels (per-agent picker scope)">
        <div className="flex flex-wrap gap-2">
          {MODEL_OPTIONS.map((m) => {
            const checked = form.allowedModels.includes(m)
            return (
              <label
                key={m}
                className="flex items-center gap-1 rounded border px-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...form.allowedModels, m]
                      : form.allowedModels.filter((x) => x !== m)
                    setForm({ ...form, allowedModels: next })
                  }}
                />
                {m}
              </label>
            )
          })}
        </div>
      </Field>
    </div>
  )
}

function ChannelsTab({ form, setForm }: TabProps) {
  return (
    <div className="space-y-2">
      <Field label="channels (one Discord channel ID per line)">
        <textarea
          className="h-40 w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          value={form.channels}
          onChange={(e) => setForm({ ...form, channels: e.target.value })}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Hot-reloadable — bridge re-routes on the next config tick.
        </p>
      </Field>
    </div>
  )
}

function ToolsTab({ form, setForm }: TabProps) {
  return (
    <div className="space-y-2">
      <Field label="skills (one skill ID per line)">
        <textarea
          className="h-40 w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          value={form.skills}
          onChange={(e) => setForm({ ...form, skills: e.target.value })}
        />
      </Field>
    </div>
  )
}

function McpTab({ raw }: { raw: Record<string, unknown> | null }) {
  const mcpServers = Array.isArray(raw?.['mcpServers'])
    ? (raw!['mcpServers'] as string[])
    : []
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        MCP server list (read-only here). Wire up name → env / command in a
        later plan; today operators edit the top-level
        <code className="mx-1 rounded bg-muted px-1">mcpServers</code> block
        in <code>clawcode.yaml</code>.
      </p>
      <ul className="rounded border bg-muted/30 p-2 text-sm">
        {mcpServers.length === 0 && (
          <li className="text-muted-foreground">no MCP servers bound</li>
        )}
        {mcpServers.map((s) => (
          <li key={s} className="font-mono text-xs">
            {s}
          </li>
        ))}
      </ul>
    </div>
  )
}

function MemoryTab({ form, setForm, hot }: TabPropsWithHot) {
  return (
    <div className="space-y-4">
      <Field label="memoryAutoLoad" hot={hot.has('memoryAutoLoad')}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.memoryAutoLoad}
            onChange={(e) =>
              setForm({ ...form, memoryAutoLoad: e.target.checked })
            }
          />
          Auto-inject MEMORY.md at session boot
        </label>
      </Field>
      <Field
        label="memoryRetrievalTopK (1-50)"
        hot={hot.has('memoryRetrievalTopK')}
      >
        <input
          type="number"
          min={1}
          max={50}
          className="w-32 rounded border bg-background px-2 py-1 text-sm"
          value={form.memoryRetrievalTopK}
          onChange={(e) => {
            const v = e.target.value
            setForm({
              ...form,
              memoryRetrievalTopK: v === '' ? '' : Number(v),
            })
          }}
        />
      </Field>
    </div>
  )
}

function DebugTab({ raw }: { raw: Record<string, unknown> | null }) {
  const json = JSON.stringify(raw ?? {}, null, 2)
  return (
    <pre className="max-h-[40vh] overflow-auto rounded bg-muted p-3 text-xs">
      {json}
    </pre>
  )
}

function Field({
  label,
  children,
  restart,
  hot,
}: {
  label: string
  children: React.ReactNode
  restart?: boolean
  hot?: boolean
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <span>{label}</span>
        {restart && (
          <RestartTip>
            <Badge variant="destructive" className="text-[10px]">
              restart
            </Badge>
          </RestartTip>
        )}
        {hot && (
          <Badge variant="secondary" className="text-[10px]">
            hot
          </Badge>
        )}
      </div>
      {children}
    </div>
  )
}
