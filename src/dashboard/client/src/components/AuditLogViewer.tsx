/**
 * Phase 116-06 F23 — operator action audit log viewer.
 *
 * Renders the dashboard-audit.jsonl tail in a sortable / filterable
 * table. Reads from GET /api/audit (daemon `list-dashboard-audit` IPC →
 * DashboardAuditTrail.listActions on the daemon side).
 *
 * Columns: timestamp · action · target · metadata (JSON, collapsed).
 * Filters: since (last 1h / 24h / 7d / all) · action (dropdown of seen
 * values) · agent (text match against `target`).
 *
 * Lazy-loaded — see App.tsx React.lazy() import.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'

type AuditEntry = {
  readonly timestamp: string
  readonly action: string
  readonly target: string | null
  readonly metadata?: Record<string, unknown>
}

type AuditResponse = {
  readonly rows: readonly AuditEntry[]
  readonly filePath: string | null
}

type SinceWindow = 'all' | '1h' | '24h' | '7d'

function sinceWindowToIso(window: SinceWindow): string | undefined {
  if (window === 'all') return undefined
  const now = Date.now()
  const offset =
    window === '1h'
      ? 3600 * 1000
      : window === '24h'
        ? 24 * 3600 * 1000
        : 7 * 24 * 3600 * 1000
  return new Date(now - offset).toISOString()
}

export function AuditLogViewer(): JSX.Element {
  const [sinceWindow, setSinceWindow] = useState<SinceWindow>('24h')
  const [actionFilter, setActionFilter] = useState<string>('')
  const [agentFilter, setAgentFilter] = useState<string>('')
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    const since = sinceWindowToIso(sinceWindow)
    if (since) params.set('since', since)
    if (actionFilter) params.set('action', actionFilter)
    if (agentFilter) params.set('agent', agentFilter)
    params.set('limit', '500')
    return params
  }, [sinceWindow, actionFilter, agentFilter])

  const { data, isLoading, error, refetch } = useQuery<AuditResponse>({
    queryKey: ['audit', sinceWindow, actionFilter, agentFilter],
    queryFn: async () => {
      const res = await fetch(`/api/audit?${queryParams.toString()}`)
      if (!res.ok) throw new Error(`audit fetch failed: ${res.status}`)
      return (await res.json()) as AuditResponse
    },
    staleTime: 10_000,
  })

  // 116-06 — auto-refresh every 30s so the operator's open viewer
  // shows new actions without manual reload. Pure setInterval; clears
  // on unmount.
  useEffect(() => {
    const t = setInterval(() => {
      void refetch()
    }, 30_000)
    return () => clearInterval(t)
  }, [refetch])

  // Unique action values from the loaded set — drives the action filter
  // dropdown so operators don't have to type the action string.
  const seenActions = useMemo(() => {
    const set = new Set<string>()
    for (const r of data?.rows ?? []) set.add(r.action)
    return Array.from(set).sort()
  }, [data])

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-fg-1">
            Operator audit log
          </h1>
          <p className="text-sm text-fg-3">
            Every dashboard-originated mutation, append-only. Source:{' '}
            <code className="text-[11px]">{data?.filePath ?? 'dashboard-audit.jsonl'}</code>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Refresh
        </Button>
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-xs text-fg-3 flex items-center gap-2">
          Window:
          <select
            value={sinceWindow}
            onChange={(e) => setSinceWindow(e.target.value as SinceWindow)}
            className="rounded border bg-card px-2 py-1 text-sm"
          >
            <option value="1h">Last 1h</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
            <option value="all">All</option>
          </select>
        </label>

        <label className="text-xs text-fg-3 flex items-center gap-2">
          Action:
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded border bg-card px-2 py-1 text-sm min-w-[180px]"
          >
            <option value="">(any)</option>
            {seenActions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-fg-3 flex items-center gap-2">
          Target:
          <input
            type="text"
            placeholder="agent or task id…"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="rounded border bg-card px-2 py-1 text-sm w-44"
          />
        </label>

        <span className="text-xs text-fg-3 ml-auto">
          {data?.rows.length ?? 0} rows
        </span>
      </div>

      {error ? (
        <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm">
          {(error as Error).message}
        </div>
      ) : isLoading ? (
        <div className="text-sm text-fg-3">Loading audit log…</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Timestamp</TableHead>
              <TableHead className="w-56">Action</TableHead>
              <TableHead className="w-48">Target</TableHead>
              <TableHead>Metadata</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.rows ?? []).map((r, idx) => {
              const isExpanded = expandedRow === idx
              const meta = r.metadata
              return (
                <TableRow
                  key={`${r.timestamp}-${idx}`}
                  className="cursor-pointer"
                  onClick={() => setExpandedRow(isExpanded ? null : idx)}
                  data-testid="audit-row"
                  data-action={r.action}
                >
                  <TableCell className="font-mono text-xs">
                    {new Date(r.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="text-xs">{r.target ?? '—'}</TableCell>
                  <TableCell className="text-xs">
                    {meta ? (
                      isExpanded ? (
                        <pre className="max-h-48 overflow-auto rounded bg-bg-muted p-2 text-[11px]">
                          {JSON.stringify(meta, null, 2)}
                        </pre>
                      ) : (
                        <span className="text-fg-3">
                          {Object.keys(meta).length} field
                          {Object.keys(meta).length === 1 ? '' : 's'} (click to expand)
                        </span>
                      )
                    ) : (
                      <span className="text-fg-3">—</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {data?.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-fg-3 py-8">
                  No audit entries match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
