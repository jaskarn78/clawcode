/**
 * Phase 116 Plan 02 T03 + T05 — F09 embedding-v2 migration tracker.
 *
 * Per-agent phase pill (idle / dual-write / re-embedding N% / re-embed-
 * complete / cutover / v1-dropped / rolled-back) sourced from
 * `GET /api/migrations` (proxies the daemon `embedding-migration-status` IPC).
 *
 * Operator actions per agent:
 *   - Pause  -> POST /api/migrations/:agent/pause
 *   - Resume -> POST /api/migrations/:agent/resume
 *   - Rollback -> POST /api/migrations/:agent/rollback  (transition→rolled-back)
 *
 * Each action opens a shadcn <Dialog> confirm modal first. Rollback always
 * requires confirm; Pause/Resume could in principle skip confirm but the
 * plan requires confirm for all three so operators get the same shape every
 * time.
 *
 * ETA: linear projection from current velocity over the last 24h. If we
 * have < 6h of velocity samples, render "calculating…" rather than a
 * misleading number. Since the daemon only surfaces total + processed
 * (not a velocity time series), velocity is approximated client-side from
 * the rate-of-change between consecutive `useMigrations()` polls (10s
 * interval). Insufficient samples → fall back to "calculating…".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useMigrations, type MigrationRow } from '@/hooks/useApi'

// ---------------------------------------------------------------------------
// Phase pill styling
// ---------------------------------------------------------------------------

type PhasePalette = {
  readonly bg: string
  readonly text: string
  readonly border: string
  readonly label: string
}

function phasePalette(phase: string): PhasePalette {
  switch (phase) {
    case 'idle':
      return {
        bg: 'bg-fg-3/15',
        text: 'text-fg-2',
        border: 'border-fg-3/40',
        label: 'idle',
      }
    case 'dual-write':
      return {
        bg: 'bg-primary/15',
        text: 'text-primary',
        border: 'border-primary/40',
        label: 'dual-write',
      }
    case 're-embedding':
      return {
        bg: 'bg-warn/15',
        text: 'text-warn',
        border: 'border-warn/40',
        label: 're-embedding',
      }
    case 're-embed-complete':
      return {
        bg: 'bg-primary/15',
        text: 'text-primary',
        border: 'border-primary/40',
        label: 're-embed complete',
      }
    case 'cutover':
      return {
        bg: 'bg-primary/15',
        text: 'text-primary',
        border: 'border-primary/40',
        label: 'cutover',
      }
    case 'v1-dropped':
      return {
        bg: 'bg-primary/25',
        text: 'text-primary',
        border: 'border-primary/60',
        label: 'v1 dropped',
      }
    case 'rolled-back':
      return {
        bg: 'bg-danger/15',
        text: 'text-danger',
        border: 'border-danger/40',
        label: 'rolled back',
      }
    case 'no-store':
    case 'error':
      return {
        bg: 'bg-danger/15',
        text: 'text-danger',
        border: 'border-danger/40',
        label: phase,
      }
    default:
      return {
        bg: 'bg-fg-3/15',
        text: 'text-fg-2',
        border: 'border-fg-3/40',
        label: phase,
      }
  }
}

// ---------------------------------------------------------------------------
// Velocity / ETA bookkeeping — single in-memory ring of recent samples.
// One bucket per agent. We need ≥ 6h of velocity samples (6 * 60 / 10s
// poll = 2160 samples minimum) BUT we don't want to memory-leak; cap at
// 2880 (8h) per agent. In practice operators see "calculating…" the first
// 6h after a migration starts, then a stable ETA.
// ---------------------------------------------------------------------------

type Sample = { readonly t: number; readonly processed: number }

const MIN_HISTORY_MS = 6 * 60 * 60 * 1000 // 6h
const MAX_HISTORY_SAMPLES = 2880

function useVelocityTracker(rows: readonly MigrationRow[]): Map<
  string,
  { readonly etaMs: number | null; readonly velocityPerSec: number | null }
> {
  const samplesRef = useRef<Map<string, Sample[]>>(new Map())
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const now = Date.now()
    const map = samplesRef.current
    for (const r of rows) {
      if (r.phase !== 're-embedding') {
        // Reset history when not actively re-embedding so a future restart
        // doesn't compute velocity off stale (no-progress) samples.
        if (map.has(r.agent)) map.delete(r.agent)
        continue
      }
      const list = map.get(r.agent) ?? []
      const last = list[list.length - 1]
      if (!last || last.processed !== r.progressProcessed) {
        list.push({ t: now, processed: r.progressProcessed })
        if (list.length > MAX_HISTORY_SAMPLES) list.shift()
      }
      map.set(r.agent, list)
    }
    setTick((v) => v + 1)
  }, [rows])

  return useMemo(() => {
    const out = new Map<
      string,
      { readonly etaMs: number | null; readonly velocityPerSec: number | null }
    >()
    for (const r of rows) {
      if (r.phase !== 're-embedding') {
        out.set(r.agent, { etaMs: null, velocityPerSec: null })
        continue
      }
      const list = samplesRef.current.get(r.agent) ?? []
      if (list.length < 2) {
        out.set(r.agent, { etaMs: null, velocityPerSec: null })
        continue
      }
      const first = list[0]!
      const last = list[list.length - 1]!
      const dtMs = last.t - first.t
      if (dtMs < MIN_HISTORY_MS) {
        out.set(r.agent, { etaMs: null, velocityPerSec: null })
        continue
      }
      const dProc = last.processed - first.processed
      if (dProc <= 0) {
        out.set(r.agent, { etaMs: null, velocityPerSec: 0 })
        continue
      }
      const velPerSec = dProc / (dtMs / 1000)
      const remaining = r.progressTotal - r.progressProcessed
      const etaMs = remaining > 0 ? (remaining / velPerSec) * 1000 : 0
      out.set(r.agent, { etaMs, velocityPerSec: velPerSec })
    }
    return out
    // tick + rows drive recompute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, rows])
}

function formatEta(etaMs: number | null): string {
  if (etaMs === null) return 'calculating…'
  if (etaMs <= 0) return 'imminent'
  const sec = Math.round(etaMs / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 48) return `${hr}h`
  const d = Math.round(hr / 24)
  return `${d}d`
}

function formatProgress(r: MigrationRow): string {
  if (r.progressTotal <= 0) return '0 / 0'
  const pct = Math.min(
    100,
    Math.round((r.progressProcessed / r.progressTotal) * 100),
  )
  return `${r.progressProcessed.toLocaleString()} / ${r.progressTotal.toLocaleString()} (${pct}%)`
}

// ---------------------------------------------------------------------------
// Operator-confirm modal
// ---------------------------------------------------------------------------

type Action = 'pause' | 'resume' | 'rollback'

function actionCopy(action: Action): {
  readonly title: string
  readonly body: string
  readonly cta: string
  readonly variant: 'default' | 'destructive'
} {
  switch (action) {
    case 'pause':
      return {
        title: 'Pause migration?',
        body:
          'The heartbeat runner will skip this agent until resumed. Re-embed progress halts; existing dual-write traffic continues.',
        cta: 'Pause',
        variant: 'default',
      }
    case 'resume':
      return {
        title: 'Resume migration?',
        body:
          'The heartbeat runner resumes re-embedding for this agent at the configured CPU budget + batch size.',
        cta: 'Resume',
        variant: 'default',
      }
    case 'rollback':
      return {
        title: 'Roll back migration?',
        body:
          'Transitions the agent to "rolled-back" phase. Re-embed progress is preserved but reads return to v1. This action is reversible (rolled-back → dual-write is legal).',
        cta: 'Roll back',
        variant: 'destructive',
      }
  }
}

async function postAction(agent: string, action: Action): Promise<void> {
  const r = await fetch(
    `/api/migrations/${encodeURIComponent(agent)}/${action}`,
    {
      method: 'POST',
      credentials: 'same-origin',
    },
  )
  if (!r.ok) {
    let detail = ''
    try {
      const body = (await r.json()) as { error?: string }
      detail = body?.error ?? ''
    } catch {
      /* swallow — non-JSON body */
    }
    throw new Error(
      `POST /api/migrations/${agent}/${action} failed: ${r.status}${detail ? ` — ${detail}` : ''}`,
    )
  }
}

function ConfirmModal(props: {
  readonly open: boolean
  readonly agent: string
  readonly action: Action
  readonly onClose: () => void
  readonly onConfirmed: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copy = actionCopy(props.action)

  const handleConfirm = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await postAction(props.agent, props.action)
      props.onConfirmed()
      props.onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setBusy(false)
    }
  }, [props])

  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (!o && !busy) props.onClose()
      }}
    >
      <DialogContent
        className="bg-bg-elevated border border-bg-s3 text-fg-1"
        data-testid={`migration-confirm-${props.action}`}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-fg-1">
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-fg-2 font-sans">
            <span className="font-mono text-primary">{props.agent}</span> —{' '}
            {copy.body}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-danger font-mono text-xs data" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={props.onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={
              copy.variant === 'destructive'
                ? 'bg-danger text-white hover:bg-danger/90'
                : 'bg-primary text-bg-base hover:bg-primary/90'
            }
          >
            {busy ? 'Working…' : copy.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Fleet aggregate bar chart — phase distribution. Stacked horizontal bar.
// ---------------------------------------------------------------------------

const PHASE_ORDER: readonly string[] = [
  'idle',
  'dual-write',
  're-embedding',
  're-embed-complete',
  'cutover',
  'v1-dropped',
  'rolled-back',
]

function FleetAggregate(props: {
  readonly rows: readonly MigrationRow[]
}): JSX.Element {
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of props.rows) {
      c[r.phase] = (c[r.phase] ?? 0) + 1
    }
    return c
  }, [props.rows])
  const total = props.rows.length

  if (total === 0) return <></>

  return (
    <div className="space-y-2" data-testid="migration-fleet-aggregate">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-fg-3 font-sans">
          Fleet phase distribution
        </h3>
        <span className="font-mono text-xs text-fg-3 data">
          {total} agent{total === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex w-full h-6 rounded-md overflow-hidden border border-bg-s3 bg-bg-base">
        {PHASE_ORDER.filter((p) => counts[p] && counts[p]! > 0).map((p) => {
          const palette = phasePalette(p)
          const pct = ((counts[p] ?? 0) / total) * 100
          return (
            <div
              key={p}
              style={{ width: `${pct}%` }}
              className={`${palette.bg} ${palette.border} border-r last:border-r-0 flex items-center justify-center text-[10px] font-mono ${palette.text}`}
              title={`${p}: ${counts[p]} (${pct.toFixed(0)}%)`}
            >
              {pct >= 10 ? counts[p] : ''}
            </div>
          )
        })}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-sans">
        {PHASE_ORDER.filter((p) => counts[p] && counts[p]! > 0).map((p) => {
          const palette = phasePalette(p)
          return (
            <li key={p} className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-sm ${palette.bg} border ${palette.border}`}
                aria-hidden
              />
              <span className="text-fg-2">{palette.label}</span>
              <span className="text-fg-3 data font-mono">
                {counts[p]}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-agent row
// ---------------------------------------------------------------------------

function AgentRow(props: {
  readonly row: MigrationRow
  readonly etaMs: number | null
  readonly onActionStart: (agent: string, action: Action) => void
}): JSX.Element {
  const r = props.row
  const palette = phasePalette(r.phase)
  const showProgress =
    r.phase === 're-embedding' || r.phase === 're-embed-complete'
  const canPause = r.phase === 're-embedding' && !r.paused
  const canResume = r.phase === 're-embedding' && r.paused
  // Rollback is legal from every phase except v1-dropped (LEGAL_TRANSITIONS).
  // Hide it in idle (nothing to roll back) too.
  const canRollback = r.phase !== 'v1-dropped' && r.phase !== 'idle' && r.phase !== 'rolled-back'

  return (
    <li
      className="border-t border-bg-s3 py-3 grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-3 items-center"
      data-testid={`migration-row-${r.agent}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-display font-bold text-sm truncate">
          {r.agent}
        </span>
        {r.paused && (
          <Badge
            variant="outline"
            className="font-mono text-[10px] border-warn/40 text-warn"
          >
            paused
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-sans">
        <Badge
          variant="outline"
          className={`font-mono text-[10px] ${palette.bg} ${palette.text} ${palette.border}`}
        >
          {palette.label}
        </Badge>
        {showProgress && (
          <span className="font-mono text-fg-2 data">
            {formatProgress(r)}
          </span>
        )}
        {r.phase === 're-embedding' && (
          <span className="font-mono text-fg-3 data">
            eta {formatEta(props.etaMs)}
          </span>
        )}
        {r.error && (
          <span className="text-danger font-mono text-[10px] truncate max-w-xs">
            {r.error}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 justify-end">
        {canPause && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onActionStart(r.agent, 'pause')}
            className="border-bg-s3 text-fg-2 hover:text-fg-1 font-mono text-xs"
          >
            Pause
          </Button>
        )}
        {canResume && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onActionStart(r.agent, 'resume')}
            className="border-bg-s3 text-fg-2 hover:text-fg-1 font-mono text-xs"
          >
            Resume
          </Button>
        )}
        {canRollback && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onActionStart(r.agent, 'rollback')}
            className="border-danger/40 text-danger hover:bg-danger/10 font-mono text-xs"
          >
            Rollback
          </Button>
        )}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export function MigrationTracker(): JSX.Element {
  const migQ = useMigrations()
  const rows = (migQ.data?.results ?? []) as readonly MigrationRow[]
  const etaMap = useVelocityTracker(rows)

  const [pending, setPending] = useState<
    { readonly agent: string; readonly action: Action } | null
  >(null)

  const onActionStart = useCallback((agent: string, action: Action) => {
    setPending({ agent, action })
  }, [])

  const sorted = useMemo(() => {
    // Active migrations (anything except idle) first; then idle agents.
    const score = (r: MigrationRow): number => {
      if (r.phase === 'idle') return 99
      if (r.phase === 'error' || r.phase === 'no-store') return 0
      if (r.phase === 'rolled-back') return 1
      if (r.phase === 're-embedding') return 2
      if (r.phase === 'dual-write') return 3
      if (r.phase === 're-embed-complete') return 4
      if (r.phase === 'cutover') return 5
      if (r.phase === 'v1-dropped') return 6
      return 50
    }
    return [...rows].sort((a, b) => {
      const sa = score(a)
      const sb = score(b)
      if (sa !== sb) return sa - sb
      return a.agent.localeCompare(b.agent)
    })
  }, [rows])

  return (
    <Card
      className="bg-bg-elevated border-bg-s3 text-fg-1"
      data-testid="migration-tracker"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold">
              Embedding migration
            </h2>
            <p className="text-xs text-fg-3 font-sans mt-0.5">
              Per-agent phase + operator pause/resume/rollback. ETA projects
              linearly from velocity over the trailing 6h+ of samples.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pb-4">
        {migQ.isLoading && (
          <p className="text-fg-2 font-sans text-sm">Loading migrations…</p>
        )}
        {migQ.isError && (
          <p className="text-danger font-sans text-sm">
            Failed to load migrations — daemon unreachable.
          </p>
        )}
        {!migQ.isLoading && !migQ.isError && rows.length === 0 && (
          <p className="text-fg-2 font-sans text-sm">
            No migration state reported.
          </p>
        )}
        {rows.length > 0 && (
          <>
            <FleetAggregate rows={rows} />
            <ul>
              {sorted.map((r) => (
                <AgentRow
                  key={r.agent}
                  row={r}
                  etaMs={etaMap.get(r.agent)?.etaMs ?? null}
                  onActionStart={onActionStart}
                />
              ))}
            </ul>
          </>
        )}
      </CardContent>
      {pending && (
        <ConfirmModal
          open={true}
          agent={pending.agent}
          action={pending.action}
          onClose={() => setPending(null)}
          onConfirmed={() => {
            // Trigger an immediate refetch so the phase pill flips without
            // waiting for the next 10s poll tick.
            void migQ.refetch()
          }}
        />
      )}
    </Card>
  )
}

export default MigrationTracker
