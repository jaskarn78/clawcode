/**
 * Phase 116-05 F17 — cost dashboard.
 *
 * Lazy-loaded (App.tsx imports via React.lazy) because recharts'
 * AreaChart + PieChart land ~70KB minified. Eager loading would burn
 * the remaining bundle budget for a single route.
 *
 * Sections (top→bottom):
 *
 *  1. Anomaly alert banner
 *     If today's spend > 2× the 30-day daily average, render a warn
 *     banner with the multiplier. Threshold locked from CONTEXT.
 *
 *  2. Total spend cards (today / 7d / 30d)
 *     Three columns. Each card pulls a separate /api/costs?period={}
 *     query so we get the daemon's canonical aggregate (covers the
 *     today/week/month switch already implemented in the costs handler).
 *
 *  3. Trend chart (stacked area)
 *     Per-day buckets from /api/costs/daily?days=30. Toggle: stack by
 *     agent vs by model. Linear projection from the 30d trend is overlaid
 *     as a dashed extension to month-end.
 *
 *  4. Per-model split donut
 *     Sum costs by model name (opus/sonnet/haiku) over the 30d window;
 *     drives a PieChart donut for fast eyeball of where spend goes.
 *
 *  5. Budget gauges (EscalationBudget)
 *     One row per (agent, model, period) where a token limit is
 *     configured. Bar shows tokens_used / tokens_limit + status color
 *     (ok / warning / exceeded). UNITS ARE TOKENS BY SCHEMA — see
 *     116-05-SUMMARY decisions.
 *
 * Linear projection logic:
 *   - Need ≥14 days of buckets in the 30d window (after collapsing
 *     per-agent/per-model rows by date). Below that we render
 *     "insufficient data — gather 14d for projection".
 *   - Compute total spend per day. Fit y = mx + b via least-squares
 *     regression over the 30d. Extrapolate to month-end (last day of
 *     the current calendar month). Render the projection as a tiny
 *     callout card next to the trend chart.
 *
 * Anomaly logic:
 *   - average30 = sum(daily totals over last 30d) / 30
 *   - If average30 > 0 and today_total > 2 × average30 → banner.
 *   - When data is sparse (< 5 days of buckets) we suppress the banner
 *     to avoid spurious alerts on freshly-installed daemons.
 */
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  useBudgets,
  useCosts,
  useCostsDaily,
  type CostByDay,
  type BudgetRow,
} from '@/hooks/useApi'
import { parentAgentName } from '@/lib/agent-name'

const ANOMALY_MULTIPLIER = 2 // CONTEXT-locked
const MIN_DAYS_FOR_PROJECTION = 14
const MIN_DAYS_FOR_ANOMALY = 5

// 116-postdeploy Bug 1 — cap "by agent" series count so the legend stays
// readable. Top-N agents by total spend retain their own series; the
// remainder collapse into a single "other" bucket. 7 is a balance between
// "see real agents" and "legend doesn't wrap to three lines" on a 280px
// chart. With ~14 root agents in the fleet today, this keeps the top
// half of the fleet legible and packs the long-tail subagent spam into
// one band.
const TOP_AGENT_SERIES = 7
const OTHER_BUCKET = 'other'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 10) return `$${n.toFixed(3)}`
  if (n < 1000) return `$${n.toFixed(2)}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function modelBucket(model: string): 'opus' | 'sonnet' | 'haiku' | 'other' {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  return 'other'
}

const MODEL_COLORS = {
  opus: '#a855f7', // violet
  sonnet: '#10b981', // emerald
  haiku: '#f59e0b', // amber
  other: '#71717a', // muted
} as const

// Linear regression (least squares) over an array of (x, y) pairs.
function linearRegression(
  points: ReadonlyArray<{ x: number; y: number }>,
): { slope: number; intercept: number } | null {
  if (points.length < 2) return null
  const n = points.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (const p of points) {
    sumX += p.x
    sumY += p.y
    sumXY += p.x * p.y
    sumXX += p.x * p.x
  }
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return null
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

// Aggregate cost rows by date → total USD per day.
function dailyTotals(rows: readonly CostByDay[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    m.set(r.date, (m.get(r.date) ?? 0) + r.cost_usd)
  }
  return m
}

// Group rows by date with per-agent OR per-model columns. Recharts wants
// each row to be `{ date, [seriesName]: value, ... }`.
//
// 116-postdeploy Bug 1: when grouping by agent, names are first collapsed
// to their root parent (subagent threads like `<parent>-sub-<nanoid6>` or
// `<parent>-via-<delegate>-<nanoid6>` roll up into `<parent>`). Then the
// top-N parents by total spend retain individual series; the long tail
// merges into an `other` bucket. This avoids the operator-reported bug
// where hundreds of subagent session names spilled across the legend.
function buildChartRows(
  rows: readonly CostByDay[],
  groupBy: 'agent' | 'model',
): { rows: Array<Record<string, number | string>>; series: string[] } {
  // Pass 1 (agent-only): compute parent totals → pick top-N.
  let topAgents: Set<string> | null = null
  if (groupBy === 'agent') {
    const totals = new Map<string, number>()
    for (const r of rows) {
      const parent = parentAgentName(r.agent)
      totals.set(parent, (totals.get(parent) ?? 0) + r.cost_usd)
    }
    const ranked = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_AGENT_SERIES)
      .map(([name]) => name)
    topAgents = new Set(ranked)
  }

  // Pass 2: bucket each row into a date × series cell.
  const dateMap = new Map<string, Record<string, number | string>>()
  const seriesSet = new Set<string>()
  for (const r of rows) {
    let series: string
    if (groupBy === 'agent') {
      const parent = parentAgentName(r.agent)
      series = topAgents!.has(parent) ? parent : OTHER_BUCKET
    } else {
      series = modelBucket(r.model)
    }
    seriesSet.add(series)
    let row = dateMap.get(r.date)
    if (!row) {
      row = { date: r.date }
      dateMap.set(r.date, row)
    }
    row[series] = ((row[series] as number | undefined) ?? 0) + r.cost_usd
  }
  const sortedDates = [...dateMap.keys()].sort()

  // Sort series: `other` always last (visual: long tail sits at the top
  // of the stack, recognisable as the muted band). Otherwise alphabetical
  // for stable layout across renders.
  const series = [...seriesSet].sort((a, b) => {
    if (a === OTHER_BUCKET) return 1
    if (b === OTHER_BUCKET) return -1
    return a.localeCompare(b)
  })

  return {
    rows: sortedDates.map((d) => dateMap.get(d)!),
    series,
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AnomalyBanner(props: {
  readonly today: number
  readonly avg30: number
  readonly dayCount: number
}): JSX.Element | null {
  if (props.dayCount < MIN_DAYS_FOR_ANOMALY) return null
  if (props.avg30 <= 0) return null
  const ratio = props.today / props.avg30
  if (ratio < ANOMALY_MULTIPLIER) return null
  return (
    <div
      className="mb-4 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
      data-testid="cost-anomaly-banner"
      role="alert"
    >
      <span className="font-bold text-danger">Spend anomaly:</span>{' '}
      <span className="text-fg-1">
        today is {ratio.toFixed(1)}× the 30-day daily average (
        {formatUsd(props.today)} vs {formatUsd(props.avg30)}).
      </span>
    </div>
  )
}

function SpendCard(props: {
  readonly label: string
  readonly amount: number | null
  readonly testid: string
}): JSX.Element {
  return (
    <Card className="bg-bg-elevated border-bg-s3" data-testid={props.testid}>
      <CardHeader className="pb-1">
        <span className="font-display text-[10px] uppercase tracking-wide text-fg-3">
          {props.label}
        </span>
      </CardHeader>
      <CardContent>
        <div className="font-display text-2xl font-bold text-fg-1 data">
          {props.amount === null ? '—' : formatUsd(props.amount)}
        </div>
      </CardContent>
    </Card>
  )
}

function TrendChart(props: {
  readonly rows: readonly CostByDay[]
  readonly groupBy: 'agent' | 'model'
  readonly setGroupBy: (v: 'agent' | 'model') => void
}): JSX.Element {
  const { rows: chartRows, series } = useMemo(
    () => buildChartRows(props.rows, props.groupBy),
    [props.rows, props.groupBy],
  )

  return (
    <Card className="bg-bg-elevated border-bg-s3">
      <CardHeader className="flex flex-row items-center justify-between pb-1">
        <span className="font-display text-sm font-bold text-fg-1">
          Spend trend ({chartRows.length}d)
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={props.groupBy === 'agent' ? 'default' : 'outline'}
            onClick={() => props.setGroupBy('agent')}
            data-testid="cost-trend-by-agent"
          >
            by agent
          </Button>
          <Button
            size="sm"
            variant={props.groupBy === 'model' ? 'default' : 'outline'}
            onClick={() => props.setGroupBy('model')}
            data-testid="cost-trend-by-model"
          >
            by model
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {chartRows.length === 0 ? (
          <p className="text-fg-3 text-sm py-12 text-center">No data yet.</p>
        ) : (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartRows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#252530" />
                <XAxis
                  dataKey="date"
                  stroke="#71717a"
                  tick={{ fontSize: 10, fontFamily: 'monospace' }}
                />
                <YAxis
                  stroke="#71717a"
                  tick={{ fontSize: 10, fontFamily: 'monospace' }}
                  tickFormatter={(v) => formatUsd(v)}
                  width={60}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: '#1a1a23',
                    border: '1px solid #252530',
                    fontSize: 11,
                  }}
                  formatter={(v: number) => formatUsd(v)}
                />
                <Legend
                  wrapperStyle={{ fontSize: 10, fontFamily: 'monospace' }}
                />
                {series.map((s, idx) => (
                  <Area
                    key={s}
                    type="monotone"
                    dataKey={s}
                    stackId="cost"
                    stroke={pickColor(props.groupBy, s, idx)}
                    fill={pickColor(props.groupBy, s, idx)}
                    fillOpacity={0.45}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Series-color picker — when grouping by model, use the canonical model
// palette; when grouping by agent, fall back to a 6-color cycle.
const AGENT_COLORS = [
  '#10b981',
  '#a855f7',
  '#f59e0b',
  '#3b82f6',
  '#ec4899',
  '#06b6d4',
]
function pickColor(
  groupBy: 'agent' | 'model',
  series: string,
  idx: number,
): string {
  if (groupBy === 'model') {
    return (
      MODEL_COLORS[series as keyof typeof MODEL_COLORS] ?? MODEL_COLORS.other
    )
  }
  // 116-postdeploy Bug 1 — stable muted color for the "other" bucket so
  // the long-tail collapse reads as such (and doesn't fight for attention
  // against the top-N real-agent bands).
  if (series === OTHER_BUCKET) return '#52525b' // zinc-600
  return AGENT_COLORS[idx % AGENT_COLORS.length]!
}

function ModelDonut(props: { readonly rows: readonly CostByDay[] }): JSX.Element {
  const data = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of props.rows) {
      const b = modelBucket(r.model)
      m.set(b, (m.get(b) ?? 0) + r.cost_usd)
    }
    return [...m.entries()].map(([name, value]) => ({ name, value }))
  }, [props.rows])

  const total = data.reduce((acc, d) => acc + d.value, 0)

  return (
    <Card className="bg-bg-elevated border-bg-s3">
      <CardHeader className="pb-1">
        <span className="font-display text-sm font-bold text-fg-1">
          Spend by model (30d)
        </span>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-fg-3 text-sm py-12 text-center">No spend.</p>
        ) : (
          <div style={{ width: '100%', height: 220 }} data-testid="cost-model-donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  innerRadius={50}
                  outerRadius={80}
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                  isAnimationActive={false}
                  label={(entry) => entry.name}
                  labelLine={false}
                >
                  {data.map((d) => (
                    <Cell
                      key={d.name}
                      fill={
                        MODEL_COLORS[d.name as keyof typeof MODEL_COLORS] ??
                        MODEL_COLORS.other
                      }
                    />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{
                    background: '#1a1a23',
                    border: '1px solid #252530',
                    fontSize: 11,
                  }}
                  formatter={(v: number) => formatUsd(v)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProjectionCard(props: {
  readonly dailyTotals: ReadonlyMap<string, number>
}): JSX.Element {
  const dayCount = props.dailyTotals.size
  if (dayCount < MIN_DAYS_FOR_PROJECTION) {
    return (
      <Card className="bg-bg-elevated border-bg-s3" data-testid="cost-projection-card">
        <CardHeader className="pb-1">
          <span className="font-display text-sm font-bold text-fg-1">
            Month-end projection
          </span>
        </CardHeader>
        <CardContent>
          <p className="text-fg-3 text-sm">
            Insufficient data — gather {MIN_DAYS_FOR_PROJECTION}d for projection
            ({dayCount}/{MIN_DAYS_FOR_PROJECTION} so far).
          </p>
        </CardContent>
      </Card>
    )
  }

  // Sort daily totals chronologically; x = day index (0,1,2,...).
  const sorted = [...props.dailyTotals.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )
  const points = sorted.map(([_d, y], i) => ({ x: i, y }))
  const reg = linearRegression(points)
  if (!reg) {
    return (
      <Card className="bg-bg-elevated border-bg-s3" data-testid="cost-projection-card">
        <CardHeader className="pb-1">
          <span className="font-display text-sm font-bold text-fg-1">
            Month-end projection
          </span>
        </CardHeader>
        <CardContent>
          <p className="text-fg-3 text-sm">
            Trend not fittable — variance too low.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Extrapolate to month-end.
  const now = new Date()
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  )
  // Days from first observed date to now (most recent x).
  const lastX = points.length - 1
  const todayDate = new Date(sorted[sorted.length - 1]![0] + 'T00:00:00Z')
  const daysToEnd = Math.max(
    0,
    Math.round((monthEnd.getTime() - todayDate.getTime()) / 86_400_000),
  )
  // Project remainder spend = sum_{i=lastX+1..lastX+daysToEnd} (slope*i + intercept).
  let projectedRest = 0
  for (let i = lastX + 1; i <= lastX + daysToEnd; i++) {
    projectedRest += Math.max(0, reg.slope * i + reg.intercept)
  }
  const observed = points.reduce((acc, p) => acc + p.y, 0)
  const projectedMonthEnd = observed + projectedRest
  const trendDirection =
    reg.slope > 0.0001 ? '↑' : reg.slope < -0.0001 ? '↓' : '→'

  return (
    <Card className="bg-bg-elevated border-bg-s3" data-testid="cost-projection-card">
      <CardHeader className="pb-1">
        <span className="font-display text-sm font-bold text-fg-1">
          Month-end projection
        </span>
      </CardHeader>
      <CardContent>
        <div className="font-display text-2xl font-bold text-fg-1 data">
          {formatUsd(projectedMonthEnd)} {trendDirection}
        </div>
        <p className="text-fg-3 text-xs mt-1">
          Linear extrapolation from {dayCount}d trend.{' '}
          {formatUsd(observed)} observed + {formatUsd(projectedRest)} projected
          ({daysToEnd}d remaining).
        </p>
      </CardContent>
    </Card>
  )
}

function BudgetGauges(props: { readonly rows: readonly BudgetRow[] }): JSX.Element {
  if (props.rows.length === 0) {
    return (
      <Card className="bg-bg-elevated border-bg-s3">
        <CardHeader className="pb-1">
          <span className="font-display text-sm font-bold text-fg-1">
            Escalation budgets (tokens)
          </span>
        </CardHeader>
        <CardContent>
          <p className="text-fg-3 text-sm">
            No escalation budgets configured. Add{' '}
            <code className="font-mono text-fg-2">escalationBudget</code> to an
            agent in clawcode.yaml to see usage here.
          </p>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card className="bg-bg-elevated border-bg-s3">
      <CardHeader className="pb-1">
        <span className="font-display text-sm font-bold text-fg-1">
          Escalation budgets (tokens)
        </span>
        <span className="text-[10px] text-fg-3 font-sans">
          Units: tokens (matches AgentBudgetConfig schema). USD spend cards above
          are separate.
        </span>
      </CardHeader>
      <CardContent>
        <div className="space-y-2" data-testid="cost-budget-gauges">
          {props.rows.map((r) => (
            <BudgetBar key={`${r.agent}.${r.model}.${r.period}`} row={r} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function BudgetBar(props: { readonly row: BudgetRow }): JSX.Element {
  const r = props.row
  const pct = Math.min(100, r.pct * 100)
  const color =
    r.status === 'exceeded'
      ? 'bg-danger'
      : r.status === 'warning'
        ? 'bg-warn'
        : 'bg-primary'
  return (
    <div data-testid="cost-budget-row" data-agent={r.agent} data-status={r.status}>
      <div className="flex items-baseline justify-between text-xs font-mono">
        <span className="text-fg-1">
          {r.agent} · {r.model} ·{' '}
          <span className="text-fg-3">{r.period}</span>
        </span>
        <span className="text-fg-2 data">
          {r.tokens_used.toLocaleString()} / {r.tokens_limit.toLocaleString()}{' '}
          ({(r.pct * 100).toFixed(1)}%)
        </span>
      </div>
      <div className="mt-0.5 h-1.5 w-full bg-bg-s3 rounded overflow-hidden">
        <div
          className={`h-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export function CostDashboard(): JSX.Element {
  const todayQ = useCosts('today')
  const weekQ = useCosts('week')
  const monthQ = useCosts('month')
  const dailyQ = useCostsDaily(30, null)
  const budgetQ = useBudgets()

  const [groupBy, setGroupBy] = useState<'agent' | 'model'>('agent')

  const todayTotal = useMemo(
    () =>
      (todayQ.data?.costs ?? []).reduce((acc, r) => acc + r.cost_usd, 0),
    [todayQ.data],
  )
  const weekTotal = useMemo(
    () => (weekQ.data?.costs ?? []).reduce((acc, r) => acc + r.cost_usd, 0),
    [weekQ.data],
  )
  const monthTotal = useMemo(
    () => (monthQ.data?.costs ?? []).reduce((acc, r) => acc + r.cost_usd, 0),
    [monthQ.data],
  )

  const dailyRows = useMemo(
    () => dailyQ.data?.rows ?? [],
    [dailyQ.data],
  )
  const dailyMap = useMemo(() => dailyTotals(dailyRows), [dailyRows])
  const avg30 = useMemo(() => {
    if (dailyMap.size === 0) return 0
    const sum = [...dailyMap.values()].reduce((a, b) => a + b, 0)
    return sum / 30 // by-definition daily average over the 30d window
  }, [dailyMap])

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold text-fg-1">Costs</h1>
        <p className="text-sm text-fg-3 font-sans">
          Token + image spend. 30-day rolling window for the trend chart;
          today/week/month cards use the daemon's canonical aggregate.
        </p>
      </div>

      <AnomalyBanner today={todayTotal} avg30={avg30} dayCount={dailyMap.size} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <SpendCard
          label="Today"
          amount={todayQ.isLoading ? null : todayTotal}
          testid="cost-card-today"
        />
        <SpendCard
          label="This week"
          amount={weekQ.isLoading ? null : weekTotal}
          testid="cost-card-week"
        />
        <SpendCard
          label="This month"
          amount={monthQ.isLoading ? null : monthTotal}
          testid="cost-card-month"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <div className="lg:col-span-2">
          <TrendChart
            rows={dailyRows}
            groupBy={groupBy}
            setGroupBy={setGroupBy}
          />
        </div>
        <div className="space-y-3">
          <ProjectionCard dailyTotals={dailyMap} />
          <ModelDonut rows={dailyRows} />
        </div>
      </div>

      <BudgetGauges rows={budgetQ.data?.rows ?? []} />
    </div>
  )
}

export default CostDashboard
