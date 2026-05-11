/**
 * Phase 116 T08 — SSE → TanStack Query cache bridge.
 *
 * Singleton EventSource connected to `/api/events`. Each known event name
 * is wired to a TanStack Query cache key so consumers can use the standard
 * `useQuery(['agent-status'])` pattern and get push-driven updates without
 * polling. The daemon's SSE manager (src/dashboard/sse.ts) already
 * broadcasts these 7 events:
 *
 *   - agent-status       → fleet state snapshot (per-agent status, model,
 *                          turn count, etc.)
 *   - schedules          → cron / one-shot scheduler view
 *   - health             → fleet health rollup
 *   - delivery-queue     → cross-agent IPC delivery state
 *   - memory-stats       → per-agent memory tier counts
 *   - task-state-change  → task store state transitions
 *   - error              → daemon-unreachable / SSE-side errors
 *
 * Initial fetch is REST (via useApi.ts hooks) — SSE only feeds incremental
 * updates. Connection state surfaces via `useSseStatus()` so the header
 * can render a connection dot.
 */
import { useEffect, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

export const SSE_EVENT_NAMES = [
  'agent-status',
  'schedules',
  'health',
  'delivery-queue',
  'memory-stats',
  'task-state-change',
  'error',
] as const

export type SseEventName = (typeof SSE_EVENT_NAMES)[number]

export type SseStatus = 'connecting' | 'open' | 'closed' | 'error'

// ---------------------------------------------------------------------------
// Singleton state — one EventSource per browser tab. React's StrictMode
// double-mounts effects in dev; the singleton guard means we don't open
// duplicate connections.
// ---------------------------------------------------------------------------

let activeEventSource: EventSource | null = null
let activeQueryClient: QueryClient | null = null
let activeStatus: SseStatus = 'closed'
const statusListeners = new Set<(status: SseStatus) => void>()

function setStatus(next: SseStatus) {
  activeStatus = next
  for (const fn of statusListeners) fn(next)
}

/**
 * Start the singleton SSE connection if it isn't already running.
 * Idempotent — calling twice doesn't double-subscribe.
 */
function ensureConnection(client: QueryClient): void {
  if (activeEventSource) return
  activeQueryClient = client
  setStatus('connecting')

  const es = new EventSource('/api/events')

  es.onopen = () => setStatus('open')
  es.onerror = () => setStatus('error')

  for (const name of SSE_EVENT_NAMES) {
    es.addEventListener(name, (evt) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data)
        activeQueryClient?.setQueryData([name], data)
      } catch {
        // Drop malformed payloads — daemon never sends non-JSON, but a
        // proxy / load-balancer might inject something. Silent drop is
        // safer than throwing in the EventSource handler.
      }
    })
  }
}

/**
 * Mount this hook ONCE at the React root (e.g. inside <App />) to start the
 * SSE bridge. Subsequent calls in deeper components are no-ops thanks to
 * the singleton guard.
 */
export function useSseBridge(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    ensureConnection(queryClient)
    return () => {
      // Intentionally NOT closing the EventSource on unmount — we want the
      // singleton to outlive any single component. The browser tears it
      // down when the tab closes.
    }
  }, [queryClient])
}

/**
 * Read-only connection-status indicator. Components subscribe via
 * useState + listener registration; updates are O(listeners) per status
 * change which is fine at our scale (~1 indicator in the header).
 */
export function useSseStatus(): SseStatus {
  const [status, setStatusState] = useState<SseStatus>(activeStatus)
  useEffect(() => {
    statusListeners.add(setStatusState)
    return () => {
      statusListeners.delete(setStatusState)
    }
  }, [])
  return status
}
