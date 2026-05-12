/**
 * Phase 116-postdeploy 2026-05-12 — Memory + dreams page.
 *
 * Operator asked: "a view to see and trigger agent dreaming and memory
 * consolidation, etc." Reuses the existing F14 MemoryPanel and F15
 * DreamQueue components (Phase 116-04, already scoped per-agent) — those
 * give us tier counts, file previews, migration delta, and the D-10 veto
 * window UI for free. The new surface is:
 *
 *   - Per-agent operator-trigger card (Run dream pass + Consolidate)
 *   - Recent dream-artifact previews (list-dream-artifacts IPC)
 *   - Fleet-wide "Consolidate all" button
 *
 * Layout: agent picker on the left (sticky), selected agent's stack on
 * the right (panels + actions + artefacts). Keeps the page focused: an
 * operator typically reasons about one agent at a time during a memory
 * triage session.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  runDreamPass,
  runTierMaintenance,
  useAgents,
  useDreamArtifacts,
  type DreamArtifact,
  type RunDreamPassResponse,
  type TierMaintenanceResponse,
} from '@/hooks/useApi'
import { MemoryPanel } from './MemoryPanel'
import { DreamQueue } from './DreamQueue'
import { MigrationTracker } from './MigrationTracker'

type ModelChoice = 'haiku' | 'sonnet' | 'opus'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fmtRel(iso: string | null): string {
  if (!iso) return '—'
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return iso
  const d = Date.now() - ts
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`
  return `${Math.round(d / 86_400_000)}d ago`
}

export function MemoryView(): JSX.Element {
  const queryClient = useQueryClient()
  const agentsQ = useAgents()
  const topLevelAgents = useMemo(
    () =>
      agentsQ.data?.agents
        ?.map((a) => a.name)
        .filter((n) => !n.includes('-sub-') && !n.includes('-thread-'))
        .sort() ?? [],
    [agentsQ.data],
  )
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    if (!selected && topLevelAgents.length > 0) {
      setSelected(topLevelAgents[0] ?? null)
    }
  }, [selected, topLevelAgents])

  // Dream-run modal state
  const [runDreamOpen, setRunDreamOpen] = useState(false)
  const [model, setModel] = useState<ModelChoice>('haiku')
  const [force, setForce] = useState(false)
  const [idleBypass, setIdleBypass] = useState(false)
  const [running, setRunning] = useState(false)
  const [runOutcome, setRunOutcome] = useState<RunDreamPassResponse | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  // Consolidate state
  const [consolidating, setConsolidating] = useState(false)
  const [consolidateResult, setConsolidateResult] =
    useState<TierMaintenanceResponse | null>(null)
  const [consolidateError, setConsolidateError] = useState<string | null>(null)

  async function handleRunDream(): Promise<void> {
    if (!selected) return
    setRunning(true)
    setRunError(null)
    setRunOutcome(null)
    try {
      const out = await runDreamPass(selected, {
        modelOverride: model,
        force,
        idleBypass,
      })
      setRunOutcome(out)
      // Invalidate caches: dream-queue (events), dream-artifacts (new file),
      // memory-snapshot (tier counts may have shifted).
      void queryClient.invalidateQueries({ queryKey: ['dream-queue', selected] })
      void queryClient.invalidateQueries({
        queryKey: ['dream-artifacts', selected],
      })
      void queryClient.invalidateQueries({
        queryKey: ['memory-snapshot', selected],
      })
    } catch (err) {
      setRunError((err as Error).message)
    } finally {
      setRunning(false)
    }
  }

  async function handleConsolidate(scope: 'agent' | 'fleet'): Promise<void> {
    setConsolidating(true)
    setConsolidateError(null)
    setConsolidateResult(null)
    try {
      const out = await runTierMaintenance(
        scope === 'fleet' ? null : selected,
      )
      setConsolidateResult(out)
      // Refresh the affected agents' memory snapshots.
      if (scope === 'fleet') {
        for (const a of topLevelAgents) {
          void queryClient.invalidateQueries({
            queryKey: ['memory-snapshot', a],
          })
        }
      } else if (selected) {
        void queryClient.invalidateQueries({
          queryKey: ['memory-snapshot', selected],
        })
      }
    } catch (err) {
      setConsolidateError((err as Error).message)
    } finally {
      setConsolidating(false)
    }
  }

  return (
    <div
      className="mx-auto max-w-[1400px] px-4 py-6 lg:px-6"
      data-testid="memory-view"
    >
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg-1">
              Memory & dreams
            </h1>
            <p className="mt-1 text-sm text-fg-3">
              Per-agent memory tiers + dream-pass orchestration. Triggered
              passes write to <code className="font-mono">memory/dreams/</code>
              ; consolidation runs the tier-maintenance pipeline (promote /
              demote / archive).
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleConsolidate('fleet')}
            disabled={consolidating}
          >
            {consolidating ? 'Consolidating…' : 'Consolidate fleet'}
          </Button>
        </div>
      </header>

      {/* 116-postdeploy 2026-05-12 — fleet-wide embedding-v2 migration
          tracker. Mounted here on the Memory page so operators can drive
          the migration state machine alongside per-agent memory triage.
          The same component is also rendered on the dashboard home (Fleet
          layout) for at-a-glance visibility. */}
      <div className="mb-6">
        <MigrationTracker />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        {/* Agent picker */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <h2 className="mb-2 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-3">
            Agents
          </h2>
          {agentsQ.isLoading && (
            <p className="text-xs text-fg-3">Loading…</p>
          )}
          {topLevelAgents.length === 0 && !agentsQ.isLoading && (
            <p className="text-xs text-fg-3">No agents configured.</p>
          )}
          <nav className="flex flex-col gap-1">
            {topLevelAgents.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setSelected(name)}
                className={
                  'rounded-md border px-3 py-1.5 text-left text-sm transition-colors ' +
                  (name === selected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-transparent text-fg-2 hover:bg-bg-elevated hover:text-fg-1')
                }
              >
                {name}
              </button>
            ))}
          </nav>
        </aside>

        {/* Per-agent stack */}
        <div className="space-y-6">
          {!selected && (
            <div className="rounded-md border border-dashed border-border bg-bg-elevated/50 p-6 text-center text-sm text-fg-3">
              Pick an agent to view its memory tiers + dream history.
            </div>
          )}

          {selected && (
            <>
              {/* Actions card */}
              <section className="rounded-lg border border-border bg-bg-elevated p-4">
                <div className="mb-3 flex items-baseline justify-between">
                  <h3 className="font-display text-lg font-medium text-fg-1">
                    Actions
                  </h3>
                  <span className="font-mono text-[10px] text-fg-3">
                    {selected}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setRunDreamOpen(true)}>
                    Run dream pass…
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleConsolidate('agent')}
                    disabled={consolidating}
                  >
                    {consolidating
                      ? 'Consolidating…'
                      : 'Consolidate memory'}
                  </Button>
                </div>
                {consolidateError && (
                  <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                    {consolidateError}
                  </p>
                )}
                {consolidateResult && (
                  <ConsolidateResultBlock result={consolidateResult} />
                )}
              </section>

              {/* MemoryPanel — reused from F14 (116-04) */}
              <MemoryPanel agentName={selected} />

              {/* DreamQueue — reused from F15 (116-04). Active D-10 windows
                  + recent events + veto UI. */}
              <DreamQueue agentName={selected} />

              {/* Recent dream artefacts */}
              <DreamArtifactsList agentName={selected} />
            </>
          )}
        </div>
      </div>

      {/* RUN DREAM PASS MODAL */}
      <Dialog
        open={runDreamOpen}
        onOpenChange={(open) => {
          if (!open) {
            setRunDreamOpen(false)
            setRunOutcome(null)
            setRunError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              Run dream pass — {selected}
            </DialogTitle>
            <DialogDescription>
              Synthesises a themed reflection over recent memories and
              proposes promotions / consolidations. Heavy operation — model
              picks the synthesis cost ladder.
            </DialogDescription>
          </DialogHeader>

          {!runOutcome && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-2">
                  Model
                </label>
                <div className="flex gap-2">
                  {(['haiku', 'sonnet', 'opus'] as ModelChoice[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModel(m)}
                      className={
                        'rounded-full px-3 py-1 font-mono text-xs uppercase tracking-wider transition-all ' +
                        (model === m
                          ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                          : 'text-fg-3 hover:bg-bg-elevated hover:text-fg-1')
                      }
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-fg-3">
                  Default is haiku — cheap + fast. Sonnet/opus for deeper
                  reflections on backlogs.
                </p>
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="text-fg-1">Force</span>
                  <span className="ml-2 text-xs text-fg-3">
                    bypass the <code className="font-mono">dream.enabled=false</code>{' '}
                    config gate
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={idleBypass}
                  onChange={(e) => setIdleBypass(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="text-fg-1">Idle bypass</span>
                  <span className="ml-2 text-xs text-fg-3">
                    fire even if the agent isn't idle
                  </span>
                </span>
              </label>

              {runError && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  {runError}
                </p>
              )}
            </div>
          )}

          {runOutcome && (
            <div className="space-y-3 rounded-md border border-border bg-bg-base p-3 text-sm">
              <div className="flex gap-2">
                <span className="font-mono text-fg-3">Outcome:</span>
                <span className="font-mono text-fg-1">
                  {runOutcome.outcome.kind}
                </span>
                {runOutcome.outcome.reason && (
                  <span className="text-fg-3">
                    — {runOutcome.outcome.reason}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <span className="font-mono text-fg-3">Applied:</span>
                <span className="font-mono text-fg-1">
                  {runOutcome.applied.kind}
                </span>
                {runOutcome.applied.reason && (
                  <span className="text-fg-3">
                    — {runOutcome.applied.reason}
                  </span>
                )}
              </div>
              <p className="text-xs text-fg-3">
                Run dispatched at {runOutcome.startedAt}. The newly-written
                artefact will appear in the list below on the next refresh.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRunDreamOpen(false)
                setRunOutcome(null)
                setRunError(null)
              }}
            >
              {runOutcome ? 'Close' : 'Cancel'}
            </Button>
            {!runOutcome && (
              <Button onClick={handleRunDream} disabled={running}>
                {running ? 'Running…' : 'Run'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ConsolidateResultBlock(props: {
  readonly result: TierMaintenanceResponse
}): JSX.Element {
  const { result } = props
  const entries = Object.entries(result.results)
  return (
    <div className="mt-3 rounded-md border border-border bg-bg-base p-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-3">
        Consolidation result
      </p>
      {entries.length === 0 && (
        <p className="text-xs text-fg-3">
          No tier-managed agents — nothing to do.
        </p>
      )}
      {entries.map(([agent, counts]) => (
        <div
          key={agent}
          className="flex items-center justify-between gap-2 border-b border-border/40 py-1 text-xs last:border-b-0"
        >
          <span className="font-mono text-fg-2">{agent}</span>
          <span className="font-mono text-fg-1">
            promoted {counts.promoted} · demoted {counts.demoted} · archived{' '}
            {counts.archived}
          </span>
        </div>
      ))}
      {result.skipped.length > 0 && (
        <p className="mt-2 text-[10px] text-fg-3">
          Skipped (no tier manager): {result.skipped.join(', ')}
        </p>
      )}
    </div>
  )
}

function DreamArtifactsList(props: {
  readonly agentName: string
}): JSX.Element {
  const q = useDreamArtifacts(props.agentName, 20)
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <section className="rounded-lg border border-border bg-bg-elevated p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-display text-lg font-medium text-fg-1">
          Recent dreams
        </h3>
        {q.data && (
          <span className="font-mono text-[10px] text-fg-3">
            {q.data.artifacts.length} artefacts ·{' '}
            {q.data.memoryPath ?? '—'}
          </span>
        )}
      </div>

      {q.isLoading && <p className="text-sm text-fg-3">Loading dreams…</p>}
      {q.error && (
        <p className="text-sm text-destructive">
          {(q.error as Error).message}
        </p>
      )}

      {q.data && q.data.artifacts.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-bg-base p-4 text-center text-xs text-fg-3">
          No dream artefacts yet — run a dream pass above to generate the
          first reflection.
        </div>
      )}

      {q.data && q.data.artifacts.length > 0 && (
        <ol className="space-y-2">
          {q.data.artifacts.map((a: DreamArtifact) => {
            const isOpen = expanded === a.file
            return (
              <li
                key={a.file}
                className="overflow-hidden rounded-md border border-border bg-bg-base"
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : a.file)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-bg-muted"
                >
                  <span className="font-display text-sm font-medium text-fg-1">
                    {a.date ?? a.file}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-fg-3">
                    {fmtBytes(a.sizeBytes)} · {fmtRel(a.mtime)}
                  </span>
                  <span aria-hidden className="text-fg-3">
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {isOpen && (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-border bg-bg-base px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-1">
                    {a.preview}
                  </pre>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
