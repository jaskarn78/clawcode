/**
 * Phase 116 T08 — TanStack Query wrappers for the existing daemon REST API.
 *
 * Pattern: each hook queries the REST endpoint on first mount + window focus,
 * THEN useSse.ts pushes incremental updates into the same cache key. The
 * component code only sees `useQuery(...)` and doesn't have to know whether
 * the value came from REST or SSE.
 *
 * Cache keys are tuples matching the SSE event names (useSse.ts) so the
 * setQueryData([eventName], data) bridge lands in the right slot.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// Shared types — minimal shape declarations to keep the hooks self-typed
// without importing daemon-side TS. Real types land in Plan 116-01 per
// component as they need richer payloads.
// ---------------------------------------------------------------------------

export type AgentStatusEntry = {
  readonly name: string
  readonly model: 'sonnet' | 'opus' | 'haiku' | string
  readonly status?: 'active' | 'idle' | 'starting' | 'errored' | 'stopped' | string
  readonly lastTurnAt?: string | null
  // Loose-typed bag for fields we don't yet need to narrow.
  readonly [key: string]: unknown
}

export type AgentStatusPayload = {
  readonly agents: readonly AgentStatusEntry[]
  readonly [key: string]: unknown
}

// ---------------------------------------------------------------------------
// REST fetchers — kept thin so SSE-driven setQueryData replaces the value
// transparently. Each fetcher returns the raw payload shape the daemon emits.
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin' })
  if (!r.ok) {
    throw new Error(`fetch ${url} failed with status ${r.status}`)
  }
  return (await r.json()) as T
}

// ---------------------------------------------------------------------------
// Hooks — one per SSE event channel + one for per-agent cache telemetry.
// Tier 1 components in Plan 116-01 will consume these directly.
// ---------------------------------------------------------------------------

/**
 * Fleet agent-status snapshot. Initial fetch via REST (`/api/state`); SSE
 * `agent-status` events push subsequent updates into the same cache key.
 *
 * NOTE: the daemon's existing dashboard REST surface for fleet state is
 * `/api/state` (broadcast also by `agent-status` SSE event). If the daemon
 * later moves to `/api/agents` we update one fetcher here without touching
 * any component.
 */
export function useAgents(): UseQueryResult<AgentStatusPayload> {
  return useQuery({
    queryKey: ['agent-status'],
    queryFn: () => fetchJson<AgentStatusPayload>('/api/state'),
    staleTime: Infinity, // SSE pushes invalidations; REST is only the initial fetch.
  })
}

/**
 * Per-agent prompt cache + per-model SLO bundle (Plan 116-00 T02 surface).
 *
 * Hits `/api/agents/:name/cache?since=24h`. The response carries the augmented
 * `slos: { first_token_p50_ms, source, model, model_defaults }` field added
 * in T02 plus the existing prompt_cache / tool_cache fields.
 */
export function useAgentCache(
  agentName: string | null,
  since: string = '24h',
): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['agent-cache', agentName, since],
    queryFn: () =>
      fetchJson(
        `/api/agents/${encodeURIComponent(agentName ?? '')}/cache?since=${encodeURIComponent(since)}`,
      ),
    enabled: agentName !== null && agentName !== '',
    staleTime: 30_000, // 30s — cache panel updates frequently but not push-driven
  })
}

/** Schedules — populated by SSE `schedules` event. */
export function useSchedules(): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: () => fetchJson('/api/schedules'),
    staleTime: Infinity,
  })
}

/** Fleet health rollup — SSE `health` event. */
export function useHealth(): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => fetchJson('/api/health'),
    staleTime: Infinity,
  })
}

/** Cross-agent delivery queue — SSE `delivery-queue` event. */
export function useDeliveryQueue(): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['delivery-queue'],
    queryFn: () => fetchJson('/api/delivery-queue'),
    staleTime: Infinity,
  })
}

/** Per-agent memory tier counts — SSE `memory-stats` event. */
export function useMemoryStats(): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['memory-stats'],
    queryFn: () => fetchJson('/api/memory-stats'),
    staleTime: Infinity,
  })
}

/** Task store snapshot — SSE `task-state-change` event. */
export function useTasks(): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['task-state-change'],
    queryFn: () => fetchJson('/api/tasks'),
    staleTime: Infinity,
  })
}

/**
 * Fleet-level statistics (cgroup memory, claude proc count, MCP rollup).
 * Hits the existing `/api/fleet/stats` endpoint. Not SSE-pushed; refetches
 * every 5s as polling fallback for the few non-push metrics.
 */
export function useFleetStats(): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['fleet-stats'],
    queryFn: () => fetchJson('/api/fleet/stats'),
    refetchInterval: 5_000,
  })
}
