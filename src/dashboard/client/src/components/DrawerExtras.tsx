/**
 * Phase 116-05 — opportunistic drawer-enrichment cards.
 *
 * Two small additions to the F11 AgentDetailDrawer's right column,
 * landed here so the 116-04 drawer file stays untouched and a future
 * plan can extend the enrichment surface without re-reading the
 * drawer's transcript/header logic:
 *
 *   1. SloSegmentGauges — F02 per-segment percentile + threshold bars
 *      (first_token / end_to_end / tool_call / context_assemble). Reads
 *      from useAgentLatency(name).segments. No new backend.
 *
 *   2. CostSummaryCard — F17 24-hour spend snapshot, scoped to the
 *      active agent. Reads from useCosts('today') and reduces to one
 *      agent's rows. No new backend. (Full F17 dashboard lives at
 *      /dashboard/v2/costs — this card is the "what about this agent"
 *      summary.)
 *
 * F04 7-day sparkline is INTENTIONALLY NOT here. It needs a new per-
 * agent timeline endpoint (turns/day or first_token p50/day buckets)
 * that 116-04 explicitly called out as missing. Documented as a 116-06
 * forward-pointer in the 116-05 SUMMARY.
 */
import { useMemo } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useAgentLatency, useCosts } from '@/hooks/useApi'

// ---------------------------------------------------------------------------
// SLO segment gauges — F02 per-segment surface (one bar per segment).
// ---------------------------------------------------------------------------

type Segment = {
  readonly name: string
  readonly p50?: number | null
  readonly p95?: number | null
  readonly p99?: number | null
  readonly count?: number
  readonly slo_threshold_ms?: number | null
  readonly slo_status?: string | null
  readonly slo_metric?: string | null
}

type LatencyPayload = {
  readonly segments?: readonly Segment[]
}

const SEGMENT_ORDER = [
  'first_token',
  'end_to_end',
  'tool_call',
  'context_assemble',
] as const

/**
 * Map (status, observed, threshold) → bar+label color.
 *
 * SloStatus is `"healthy" | "breach" | "no_data"` (src/performance/types.ts).
 * The F02 convention in AgentTile.tsx splits a breach into warn vs danger
 * by magnitude: observed > 2× threshold → danger, > 1× → warn, else primary.
 * We mirror that here for the per-segment gauges so a true breach renders
 * red rather than amber when the magnitude warrants it.
 */
function sloColorFromStatus(
  status: string | null | undefined,
  observed: number | null,
  threshold: number | null,
): {
  readonly bar: string
  readonly label: string
} {
  if (status === 'no_data' || status === null || status === undefined) {
    return { bar: 'bg-bg-s3', label: 'text-fg-3' }
  }
  if (status === 'healthy') {
    return { bar: 'bg-primary', label: 'text-primary' }
  }
  // status === 'breach' — split by magnitude. If we don't have numbers to
  // make the magnitude call, default to danger (a breach reported by the
  // server should never render less severe than warn).
  if (observed !== null && threshold !== null && threshold > 0) {
    if (observed > threshold * 2) {
      return { bar: 'bg-danger', label: 'text-danger' }
    }
    return { bar: 'bg-warn', label: 'text-warn' }
  }
  return { bar: 'bg-danger', label: 'text-danger' }
}

export function SloSegmentGauges(props: {
  readonly agentName: string
}): JSX.Element {
  const latencyQ = useAgentLatency(props.agentName)
  const payload = (latencyQ.data ?? {}) as LatencyPayload
  const segments = payload.segments ?? []

  const orderedSegments = useMemo(() => {
    const byName = new Map(segments.map((s) => [s.name, s]))
    return SEGMENT_ORDER.map((name) => byName.get(name)).filter(
      (s): s is Segment => s !== undefined,
    )
  }, [segments])

  return (
    <Card className="bg-bg-elevated border-bg-s3" data-testid="drawer-slo-gauges">
      <CardHeader className="pb-1">
        <span className="font-display text-sm font-bold text-fg-1">
          SLO segments (24h)
        </span>
        <span className="text-[10px] text-fg-3 font-sans">
          Observed percentiles vs configured threshold.
        </span>
      </CardHeader>
      <CardContent>
        {orderedSegments.length === 0 ? (
          <p className="text-fg-3 text-xs">
            {latencyQ.isLoading ? 'Loading…' : 'No segment data yet.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {orderedSegments.map((s) => (
              <SegmentBar key={s.name} segment={s} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SegmentBar(props: { readonly segment: Segment }): JSX.Element {
  const s = props.segment
  // Bar measures p95 against threshold. Saturate at 200% so a runaway
  // p95 doesn't blow the bar offscreen.
  const observed = typeof s.p95 === 'number' ? s.p95 : null
  const threshold =
    typeof s.slo_threshold_ms === 'number' ? s.slo_threshold_ms : null
  const color = sloColorFromStatus(s.slo_status ?? null, observed, threshold)
  const pct =
    observed === null || threshold === null || threshold === 0
      ? null
      : Math.min(200, (observed / threshold) * 100)
  return (
    <li>
      <div className="flex items-baseline justify-between text-[11px] font-mono">
        <span className="text-fg-1">{s.name}</span>
        <span className={`data ${color.label}`}>
          p95 {observed === null ? '—' : `${Math.round(observed)}ms`}
          {threshold !== null && (
            <span className="text-fg-3"> / SLO {threshold}ms</span>
          )}
        </span>
      </div>
      <div className="mt-0.5 h-1 w-full bg-bg-s3 rounded overflow-hidden">
        {pct !== null && (
          <div
            className={`h-full ${color.bar}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        )}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// CostSummaryCard — F17 24h spend, scoped to the active agent.
// ---------------------------------------------------------------------------

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 10) return `$${n.toFixed(3)}`
  if (n < 1000) return `$${n.toFixed(2)}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function CostSummaryCard(props: {
  readonly agentName: string
}): JSX.Element {
  const costsQ = useCosts('today')
  const agentRows = useMemo(
    () =>
      (costsQ.data?.costs ?? []).filter((r) => r.agent === props.agentName),
    [costsQ.data, props.agentName],
  )
  const total = useMemo(
    () => agentRows.reduce((acc, r) => acc + r.cost_usd, 0),
    [agentRows],
  )
  const byModel = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of agentRows) {
      m.set(r.model, (m.get(r.model) ?? 0) + r.cost_usd)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [agentRows])

  return (
    <Card className="bg-bg-elevated border-bg-s3" data-testid="drawer-cost-card">
      <CardHeader className="pb-1 flex flex-row items-baseline justify-between">
        <span className="font-display text-sm font-bold text-fg-1">
          Cost (today)
        </span>
        <a
          href="/dashboard/v2/costs"
          className="text-[10px] font-sans text-fg-3 hover:text-fg-1 underline"
        >
          Full dashboard →
        </a>
      </CardHeader>
      <CardContent>
        <div className="font-display text-xl font-bold text-fg-1 data">
          {costsQ.isLoading ? '—' : formatUsd(total)}
        </div>
        {byModel.length > 0 && (
          <ul className="mt-2 space-y-1 text-[11px] font-mono">
            {byModel.map(([model, amount]) => (
              <li key={model} className="flex justify-between gap-2">
                <span className="text-fg-3">{model}</span>
                <span className="text-fg-2 data">{formatUsd(amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {!costsQ.isLoading && byModel.length === 0 && (
          <p className="mt-1 text-[11px] text-fg-3">No spend yet today.</p>
        )}
      </CardContent>
    </Card>
  )
}
