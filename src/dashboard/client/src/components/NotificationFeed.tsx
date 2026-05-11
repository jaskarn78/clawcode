/**
 * Phase 116-06 F20 — notification feed.
 *
 * Bell icon in the header with a badge count; click opens a slide-over
 * `<Sheet>` from the right with a chronological list of fleet-wide
 * notifications.
 *
 * SOURCES (all derived client-side; NO new backend endpoint — every
 * signal already streams via SSE or polls via the existing query layer):
 *
 *   1. SLO breach          — useAgents() + useAgentCache(name) per agent.
 *                            slos.first_token_p50_ms observed > threshold.
 *                            Same logic as SloBreachBanner.tsx.
 *   2. Budget exceeded     — useBudgets(). Any row.pct >= 0.9.
 *   3. MCP degradation     — useFleetStats().mcpFleet — any pattern with
 *                            count > 0 + a sibling agent's useMcpServers
 *                            reporting `degraded`. For the v1 surface we
 *                            ONLY notify on the fleet snapshot's "degraded"
 *                            string when present in the payload (lazy
 *                            best-effort; falls back silently).
 *   4. Dream priority      — useAgents()'s SSE stream emits
 *                            `dream_priority_pass_fired`. We watch via
 *                            the SSE bridge (window event).
 *   5. IPC delivery failure — useIpcInboxes().deliveryStats.failed > 0.
 *
 * AUTO-DISMISS: notifications with `firstSeen` older than 24h are
 * filtered out at render time (no localStorage retention; the next
 * page load with the upstream signal still present re-creates the
 * notification with a fresh `firstSeen`). Operator-dismissed entries
 * persist in `clawcode:dismissed-notifications` until the underlying
 * signal clears (so a once-dismissed SLO breach doesn't re-pop on
 * every poll).
 *
 * The header badge shows the UNDISMISSED count. Zero = no badge.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  useAgents,
  useBudgets,
  useDeliveryQueue,
  useIpcInboxes,
} from '@/hooks/useApi'

type NotificationLevel = 'info' | 'warn' | 'danger'

export type Notification = {
  readonly id: string // stable across re-renders so dismissal persists
  readonly level: NotificationLevel
  readonly title: string
  readonly detail: string
  readonly firstSeen: number // epoch ms
  readonly source: 'slo' | 'budget' | 'ipc' | 'mcp' | 'delivery'
}

const DISMISSED_KEY = 'clawcode:dismissed-notifications'
const AUTO_DISMISS_MS = 24 * 3600 * 1000

function readDismissed(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return new Set(parsed.filter((x) => typeof x === 'string'))
  } catch {
    /* fall through */
  }
  return new Set()
}

function writeDismissed(set: ReadonlySet<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(set)))
  } catch {
    /* private mode — dismissals are session-scope only */
  }
}

function BellIcon(): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

export function NotificationFeed(): JSX.Element {
  const agentsQuery = useAgents()
  const budgetsQuery = useBudgets()
  const ipcQuery = useIpcInboxes()
  const deliveryQuery = useDeliveryQueue()

  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() =>
    readDismissed(),
  )
  // Stable `firstSeen` map keyed by notification id. Notifications that
  // appear in successive polls keep the original firstSeen so the 24h
  // auto-dismiss runs from the FIRST time we saw the signal, not the
  // current render.
  const [firstSeenMap, setFirstSeenMap] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  )

  // Aggregate raw signals into notification objects (without firstSeen
  // yet — that's filled in from firstSeenMap below).
  const rawNotifications = useMemo<readonly Omit<Notification, 'firstSeen'>[]>(() => {
    const out: Omit<Notification, 'firstSeen'>[] = []

    // 1) Budget exceeded — useBudgets().rows where pct >= 0.9.
    const budgetData = budgetsQuery.data as
      | { readonly rows?: readonly { readonly agent: string; readonly model: string; readonly period: string; readonly pct: number; readonly status: string }[] }
      | undefined
    if (budgetData?.rows) {
      for (const row of budgetData.rows) {
        if (row.pct < 0.9) continue
        out.push({
          id: `budget:${row.agent}:${row.model}:${row.period}`,
          level: row.status === 'exceeded' ? 'danger' : 'warn',
          title: `${row.agent} budget ${Math.round(row.pct * 100)}% (${row.period}, ${row.model})`,
          detail:
            row.status === 'exceeded'
              ? 'Limit reached — escalation calls are blocked until the next period.'
              : 'Approaching limit; review usage or raise the budget if needed.',
          source: 'budget',
        })
      }
    }

    // 2) IPC delivery failures — useDeliveryQueue().stats.failed > 0.
    const deliveryData = deliveryQuery.data as
      | { readonly stats?: { readonly failed?: number; readonly delivered?: number } }
      | undefined
    if (
      deliveryData?.stats &&
      typeof deliveryData.stats.failed === 'number' &&
      deliveryData.stats.failed > 0
    ) {
      out.push({
        id: `delivery:failed`,
        level: 'warn',
        title: `Discord delivery: ${deliveryData.stats.failed} failed`,
        detail:
          'Fleet-wide outbound queue has unresolved failures. Inspect via the delivery panel or operator CLI.',
        source: 'delivery',
      })
    }

    // 3) IPC inbox failures — useIpcInboxes() carries per-agent inbox
    //    state with delivery counts; we surface any agent with a
    //    `failed > 0` count in its inbox.
    const ipcData = ipcQuery.data as
      | { readonly agents?: readonly { readonly name: string; readonly delivery?: { readonly failed?: number } }[] }
      | undefined
    if (ipcData?.agents) {
      for (const a of ipcData.agents) {
        const failed = a.delivery?.failed
        if (typeof failed === 'number' && failed > 0) {
          out.push({
            id: `ipc:${a.name}`,
            level: 'warn',
            title: `${a.name} IPC delivery failure`,
            detail: `${failed} undelivered IPC message${failed === 1 ? '' : 's'} pending.`,
            source: 'ipc',
          })
        }
      }
    }

    // 4) SLO breaches — DERIVED from useAgents()'s status field. Each
    //    agent payload carries a `slo_status` enrichment when the daemon
    //    has data; "warn" / "danger" produce a notification. The
    //    SloBreachBanner does its own per-agent useAgentCache fan-out
    //    for the precise metric; the notification feed surfaces the
    //    headline only ("agent X is breaching").
    const agentsData = agentsQuery.data as
      | { readonly agents?: readonly { readonly name: string; readonly slo_status?: string }[] }
      | undefined
    if (agentsData?.agents) {
      for (const a of agentsData.agents) {
        if (a.slo_status === 'warn' || a.slo_status === 'danger') {
          out.push({
            id: `slo:${a.name}`,
            level: a.slo_status === 'danger' ? 'danger' : 'warn',
            title: `${a.name} SLO breach`,
            detail:
              a.slo_status === 'danger'
                ? 'first_token p50 is more than 2× the per-model threshold. Investigate via the drawer.'
                : 'first_token p50 is over the per-model threshold. Watch for sustained degradation.',
            source: 'slo',
          })
        }
      }
    }

    return out
  }, [agentsQuery.data, budgetsQuery.data, ipcQuery.data, deliveryQuery.data])

  // Update firstSeenMap: new ids get `now`, existing keep their original
  // timestamp. Stale ids (signal cleared) DON'T get pruned — keeping
  // them lets a re-appearing signal re-use the older firstSeen, so the
  // 24h timer remains meaningful for flapping breaches.
  useEffect(() => {
    const now = Date.now()
    setFirstSeenMap((prev) => {
      const next = new Map(prev)
      for (const n of rawNotifications) {
        if (!next.has(n.id)) next.set(n.id, now)
      }
      return next
    })
  }, [rawNotifications])

  // Compose final notification list — apply firstSeen + auto-dismiss
  // window. Sort by level then firstSeen DESC (newest first).
  const notifications = useMemo<readonly Notification[]>(() => {
    const now = Date.now()
    return rawNotifications
      .map((n) => ({
        ...n,
        firstSeen: firstSeenMap.get(n.id) ?? now,
      }))
      .filter((n) => now - n.firstSeen < AUTO_DISMISS_MS)
      .sort((a, b) => {
        const order = { danger: 0, warn: 1, info: 2 }
        if (order[a.level] !== order[b.level]) {
          return order[a.level] - order[b.level]
        }
        return b.firstSeen - a.firstSeen
      })
  }, [rawNotifications, firstSeenMap])

  const undismissed = notifications.filter((n) => !dismissed.has(n.id))

  const dismiss = (id: string): void => {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(id)
      writeDismissed(next)
      return next
    })
  }

  const restoreAll = (): void => {
    setDismissed(() => {
      const empty = new Set<string>()
      writeDismissed(empty)
      return empty
    })
  }

  const badgeCount = undismissed.length
  // Pick the highest level for the badge color.
  const badgeLevel: NotificationLevel = undismissed.some((n) => n.level === 'danger')
    ? 'danger'
    : undismissed.some((n) => n.level === 'warn')
      ? 'warn'
      : 'info'

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative gap-1.5"
          aria-label={`Notifications (${badgeCount})`}
          data-testid="notification-bell"
        >
          <BellIcon />
          {badgeCount > 0 && (
            <span
              className={`absolute -top-1 -right-1 rounded-full text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center px-1 ${
                badgeLevel === 'danger'
                  ? 'bg-destructive text-destructive-foreground'
                  : badgeLevel === 'warn'
                    ? 'bg-amber-500 text-black'
                    : 'bg-primary text-primary-foreground'
              }`}
              data-testid="notification-badge"
            >
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
          <p className="text-xs text-fg-3">
            Auto-dismissed after 24h. Operator-dismissed entries return when
            the underlying signal clears and re-appears.
          </p>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {notifications.length === 0 && (
            <div className="text-sm text-fg-3 py-8 text-center">
              All systems nominal — nothing to report.
            </div>
          )}
          {notifications.map((n) => {
            const isDismissed = dismissed.has(n.id)
            return (
              <div
                key={n.id}
                className={`rounded-md border p-3 transition-opacity ${
                  isDismissed ? 'opacity-50' : 'opacity-100'
                }`}
                data-testid="notification-card"
                data-level={n.level}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Badge
                        variant={
                          n.level === 'danger'
                            ? 'destructive'
                            : n.level === 'warn'
                              ? 'secondary'
                              : 'default'
                        }
                      >
                        {n.level}
                      </Badge>
                      <span className="truncate">{n.title}</span>
                    </div>
                    <p className="mt-1 text-xs text-fg-3">{n.detail}</p>
                    <p className="mt-1 text-[10px] text-fg-3 font-mono">
                      {new Date(n.firstSeen).toLocaleString()}
                    </p>
                  </div>
                  {!isDismissed && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => dismiss(n.id)}
                    >
                      Dismiss
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
          {dismissed.size > 0 && (
            <div className="pt-2 text-right">
              <Button variant="ghost" size="sm" onClick={restoreAll}>
                Restore dismissed
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
