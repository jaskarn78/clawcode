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
 * Fleet agent-status snapshot. Initial fetch via REST (`/api/status`); SSE
 * `agent-status` events push subsequent updates into the same cache key.
 *
 * The daemon's existing dashboard REST surface for fleet state is
 * `/api/status` (verified against src/dashboard/server.ts:429). The SSE
 * `agent-status` event broadcasts the same shape on every poll tick.
 */
export function useAgents(): UseQueryResult<AgentStatusPayload> {
  return useQuery({
    queryKey: ['agent-status'],
    queryFn: () => fetchJson<AgentStatusPayload>('/api/status'),
    staleTime: Infinity, // SSE pushes invalidations; REST is only the initial fetch.
  })
}

/**
 * Per-agent latency report (`/api/agents/:name/latency`).
 *
 * Carries `first_token_headline.{p50,p95,p99,count,slo_status,slo_threshold_ms,slo_metric}` —
 * the OBSERVED first-token percentiles needed for F01 (SLO breach banner) and
 * the F03 tile's SLO color. The threshold lives on `useAgentCache(name).slos`
 * (Plan 116-00 T02 surface); the observed values live HERE.
 *
 * Polled every 30s — operator-acceptable refresh; the daemon's SSE bridge
 * doesn't broadcast `latency` events today, so polling is the only signal.
 */
export function useAgentLatency(
  agentName: string | null,
  since: string = '24h',
): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['agent-latency', agentName, since],
    queryFn: () =>
      fetchJson(
        `/api/agents/${encodeURIComponent(agentName ?? '')}/latency?since=${encodeURIComponent(since)}`,
      ),
    enabled: agentName !== null && agentName !== '',
    refetchInterval: 30_000,
    staleTime: 30_000,
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

/**
 * Per-agent memory tier counts — SSE `memory-stats` event ONLY (no REST
 * fallback; daemon doesn't expose a /api/memory-stats endpoint). Component
 * will see `data: undefined` until the first SSE tick lands (typically <3s).
 */
export function useMemoryStats(): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['memory-stats'],
    queryFn: () => Promise.resolve(undefined),
    staleTime: Infinity,
    enabled: false, // SSE-only — initial REST fetch disabled
  })
}

/** Task store snapshot — SSE `task-state-change` event + /api/tasks REST. */
export function useTasks(): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['task-state-change'],
    queryFn: () => fetchJson('/api/tasks'),
    staleTime: Infinity,
  })
}

/**
 * Fleet-level statistics (cgroup memory, claude proc count, MCP rollup).
 * Hits the existing `/api/fleet-stats` endpoint. Not SSE-pushed; refetches
 * every 5s as polling fallback for the few non-push metrics.
 */
export function useFleetStats(): UseQueryResult<unknown> {
  return useQuery({
    queryKey: ['fleet-stats'],
    queryFn: () => fetchJson('/api/fleet-stats'),
    refetchInterval: 5_000,
  })
}
