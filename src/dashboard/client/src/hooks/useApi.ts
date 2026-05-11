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

// ---------------------------------------------------------------------------
// Phase 116-02 — new query/mutation surfaces for F09 migrations + F10 MCP
// health. Polling-only (no SSE event today); 10s for migrations because
// re-embed progress moves over minutes, 30s for MCP because server health
// flips on the 60s heartbeat cycle.
// ---------------------------------------------------------------------------

export type MigrationRow = {
  readonly agent: string
  readonly phase: string // idle | dual-write | re-embedding | re-embed-complete | cutover | v1-dropped | rolled-back | no-store | error
  readonly progressProcessed: number
  readonly progressTotal: number
  readonly lastCursor: string | null
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly paused: boolean
  readonly error?: string
}

export type MigrationsPayload = {
  readonly results: readonly MigrationRow[]
}

/** F09 — fleet migration phase snapshot. Polls every 10s. */
export function useMigrations(): UseQueryResult<MigrationsPayload> {
  return useQuery({
    queryKey: ['migrations'],
    queryFn: () => fetchJson<MigrationsPayload>('/api/migrations'),
    refetchInterval: 10_000,
    staleTime: 10_000,
  })
}

export type McpServerStatus =
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'unknown'
  | string

export type McpServerEntry = {
  readonly name: string
  readonly status: McpServerStatus
  readonly lastSuccessAt: string | null
  readonly lastFailureAt: string | null
  readonly failureCount: number
  readonly optional: boolean
  readonly lastError: string | null
  readonly capabilityProbe?: {
    readonly lastRunAt: string
    readonly status: string
    readonly toolCount?: number
    readonly error?: string
  }
  readonly alternatives?: readonly string[]
}

export type McpAgentSnapshot = {
  readonly agent: string
  readonly servers: readonly McpServerEntry[]
}

/**
 * F10 — per-agent live MCP runtime state (status, lastSuccessAt, capability
 * probe). Polls every 30s; MCP health doesn't broadcast over SSE today.
 */
export function useMcpServers(
  agentName: string | null,
): UseQueryResult<McpAgentSnapshot> {
  return useQuery({
    queryKey: ['mcp-servers', agentName],
    queryFn: () =>
      fetchJson<McpAgentSnapshot>(
        `/api/mcp-servers/${encodeURIComponent(agentName ?? '')}`,
      ),
    enabled: agentName !== null && agentName !== '',
    refetchInterval: 30_000,
    staleTime: 30_000,
  })
}

// ---------------------------------------------------------------------------
// Phase 116-03 — Tier 1.5 operator workflow query/mutation hooks.
// F26 config editor, F27 conversations view, F28 Kanban task board.
// ---------------------------------------------------------------------------

export type AgentConfigResponse = {
  readonly agent: string
  readonly resolved: Record<string, unknown>
  readonly raw: Record<string, unknown> | null
  readonly hotReloadableFields: readonly string[]
  readonly restartRequiredFields: readonly string[]
}

/** F26 — fetch one agent's resolved + raw config for the editor. */
export function useAgentConfig(
  agentName: string | null,
): UseQueryResult<AgentConfigResponse> {
  return useQuery({
    queryKey: ['agent-config', agentName],
    queryFn: () =>
      fetchJson<AgentConfigResponse>(
        `/api/config/agents/${encodeURIComponent(agentName ?? '')}`,
      ),
    enabled: agentName !== null && agentName !== '',
    staleTime: 5_000,
  })
}

export type UpdateAgentConfigResponse = {
  readonly written: boolean
  readonly sha256?: string
  readonly reason?: string
  readonly hotReloaded: readonly string[]
  readonly agentsNeedingRestart: readonly string[]
  readonly restartRequiredFields?: readonly string[]
}

/** F26 — PUT a partial update to clawcode.yaml; returns hot-reload status. */
export async function updateAgentConfig(
  agentName: string,
  partial: Record<string, unknown>,
): Promise<UpdateAgentConfigResponse> {
  const res = await fetch(
    `/api/config/agents/${encodeURIComponent(agentName)}`,
    {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partial }),
    },
  )
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(errBody.error ?? `update-agent-config ${res.status}`)
  }
  return (await res.json()) as UpdateAgentConfigResponse
}

/** F26 — force chokidar to re-read clawcode.yaml on demand (no debounce wait). */
export async function triggerHotReload(): Promise<{ ok: boolean; touchedAt?: number }> {
  const res = await fetch('/api/config/hot-reload', {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(errBody.error ?? `hot-reload-now ${res.status}`)
  }
  return (await res.json()) as { ok: boolean; touchedAt?: number }
}

// ---------------------------------------------------------------------------
// F27 — conversations view
// ---------------------------------------------------------------------------

export type ConversationSearchHit = {
  readonly turnId: string
  readonly sessionId: string
  readonly role: 'user' | 'assistant' | 'system'
  readonly content: string
  readonly bm25Score: number
  readonly createdAt: string
  readonly channelId: string | null
  readonly isTrustedChannel: boolean
  readonly agent: string
}

export type ConversationSearchResult = {
  readonly hits: readonly ConversationSearchHit[]
  readonly totalMatches: number
  readonly agentsQueried: readonly string[]
}

/** F27 — FTS5 search across one or all agents. */
export function useConversationSearch(
  query: string,
  agent: string | null,
  enabled: boolean,
): UseQueryResult<ConversationSearchResult> {
  return useQuery({
    queryKey: ['conversation-search', query, agent],
    queryFn: () => {
      const params = new URLSearchParams({ q: query })
      if (agent) params.set('agent', agent)
      return fetchJson<ConversationSearchResult>(
        `/api/conversations/search?${params.toString()}`,
      )
    },
    enabled: enabled && query.length > 0,
    staleTime: 60_000,
  })
}

export type ConversationSessionRow = {
  readonly id: string
  readonly agentName: string
  readonly startedAt: string
  readonly endedAt: string | null
  readonly turnCount: number
  readonly totalTokens: number | null
  readonly status: string
}

export type RecentConversationsResponse = {
  readonly agent: string
  readonly sessions: readonly ConversationSessionRow[]
}

/** F27 — recent session metadata for one agent. */
export function useRecentConversations(
  agentName: string | null,
): UseQueryResult<RecentConversationsResponse> {
  return useQuery({
    queryKey: ['recent-conversations', agentName],
    queryFn: () =>
      fetchJson<RecentConversationsResponse>(
        `/api/conversations/${encodeURIComponent(agentName ?? '')}/recent?limit=50`,
      ),
    enabled: agentName !== null && agentName !== '',
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

// ---------------------------------------------------------------------------
// F28 — Kanban task board
// ---------------------------------------------------------------------------

export type KanbanRow = {
  readonly task_id: string
  readonly task_type: string
  readonly caller_agent: string
  readonly target_agent: string
  readonly status: string
  readonly started_at: number
  readonly ended_at: number | null
  readonly heartbeat_at: number
  readonly chain_token_cost: number
  readonly error: string | null
}

export type KanbanColumns = {
  readonly Backlog: readonly KanbanRow[]
  readonly Scheduled: readonly KanbanRow[]
  readonly Running: readonly KanbanRow[]
  readonly Waiting: readonly KanbanRow[]
  readonly Failed: readonly KanbanRow[]
  readonly Done: readonly KanbanRow[]
}

export type KanbanResponse = {
  readonly columns: KanbanColumns
  readonly total: number
}

/** F28 — fleet task kanban grouped by 6 columns. Polls 10s + SSE invalidates. */
export function useKanbanTasks(): UseQueryResult<KanbanResponse> {
  return useQuery({
    queryKey: ['tasks-kanban'],
    queryFn: () => fetchJson<KanbanResponse>('/api/tasks/kanban'),
    refetchInterval: 10_000,
    staleTime: 5_000,
  })
}

/** F28 — operator-fired task transition. Optimistic UI flips before this returns. */
export async function transitionTask(
  taskId: string,
  status: string,
  patch: Record<string, unknown> = {},
): Promise<{ task_id: string; row: KanbanRow }> {
  const res = await fetch(
    `/api/tasks/${encodeURIComponent(taskId)}/transition`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, patch }),
    },
  )
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(errBody.error ?? `transition-task ${res.status}`)
  }
  return (await res.json()) as { task_id: string; row: KanbanRow }
}

/** F28 — operator-created task. Lands as status='pending' in Backlog. */
export async function createTask(input: {
  title: string
  description?: string
  target_agent: string
}): Promise<{ task_id: string; row: KanbanRow }> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(errBody.error ?? `create-task ${res.status}`)
  }
  return (await res.json()) as { task_id: string; row: KanbanRow }
}
