# Phase 55: Tool-Call Overhead - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning
**Mode:** Smart discuss — all 4 grey areas accepted as recommended

<domain>
## Phase Boundary

A turn spends less time waiting on tools. Apply parallelization + intra-turn memoization + per-tool telemetry where WE own the execution path, surface per-tool latency for operators, and guarantee cache scope is strictly per-turn (no cross-turn leak).

**Architectural nuance:** The Claude Agent SDK executes tool calls internally — tool_use content blocks come from the model, results flow back as user messages with `parent_tool_use_id`. ClawCode DOES NOT parallelize MCP tool dispatch at the SDK transport layer (that's SDK-owned). What ClawCode CAN optimize:

1. **Our own MCP server tool handlers** (`src/mcp/server.ts`) — exposed as `memory_lookup`, `search_documents`, `memory_graph`, etc. These are the handlers that run IN the daemon when the model invokes a ClawCode-provided tool. Intra-turn caching + parallel-independent-call dispatch apply here.
2. **Per-tool telemetry** — already captured as `tool_call.<name>` spans in Phase 50. This phase enriches metadata and surfaces per-tool percentiles.
3. **Observability of SDK-side serialization** — if the SDK serializes externally, we can MEASURE it and document findings. We cannot directly parallelize what the SDK handles internally.

Scope lines:
- IN: Intra-turn memoization in `src/mcp/server.ts` handler wrappers (per-turn Map, whitelist of idempotent tool names), parallel dispatch when our handlers receive multiple tool_use invocations in a batch (Promise.allSettled), `TraceStore.getToolPercentiles`, new `clawcode tools <agent>` CLI, dashboard Tool Call Latency panel, per-tool SLO config surface, span metadata enrichment (`tool_name`, `cached: bool`, `is_parallel: bool`).
- OUT: Replacing the Claude Agent SDK's tool-dispatch loop, forking the SDK to expose its tool scheduler, caching across turns (correctness risk), caching non-idempotent tools (correctness risk), static dependency analysis of tool call graphs, MCP-server-to-MCP-server orchestration.

</domain>

<decisions>
## Implementation Decisions

### Parallel Tool-Call Execution (Our MCP Handlers)
- **Scope:** Inside `src/mcp/server.ts` — when our registered handlers receive concurrent calls in the same turn (the SDK/MCP runtime dispatches them), our handler wrappers use `Promise.allSettled` for independent calls. This addresses cases where multiple ClawCode-internal tools (e.g., `memory_lookup` + `search_documents`) run in parallel but our handler layer has synchronous bottlenecks (DB locks, file I/O).
- **Dependency detection heuristic:** Tool calls issued in the SAME assistant message batch are presumed independent. Our wrapper layer trusts this. Tool calls across separate assistant messages stay sequential (the model already waited for the prior result before issuing the next).
- **Error isolation:** `Promise.allSettled` returns both success + error results. The MCP server returns each tool's individual outcome — one tool's error doesn't block siblings.
- **Backpressure:** Soft cap at 10 concurrent tool dispatches per turn via `perf.tools.maxConcurrent` (default 10). Prevents a pathological model-generated batch from overwhelming MCP server internals. Enforced with a simple semaphore-like counter in the wrapper.

### Intra-Turn Tool Result Cache
- **Cache key:** Deterministic hash — `canonicalStringify({ tool_name, args })` where args are sorted by key recursively (stable hash regardless of JS object property order).
- **Idempotent whitelist:** Opt-in via `perf.tools.idempotent: string[]`. Defaults: `["memory_lookup", "search_documents", "memory_list", "memory_graph"]`. All other tools bypass the cache even if args match. Caching non-idempotent tools like `memory_save` or `spawn_subagent_thread` is a correctness bug.
- **Scope + lifetime:** In-memory `Map<string, unknown>` attached to the Turn object (`turn.toolCache = new Map()`). Created fresh per turn, garbage-collected when the Turn goes out of scope at `turn.end()`. Zero TTL, zero cross-turn leak possible by construction.
- **Cache hit telemetry:** New span metadata on tool_call spans: `cached: boolean` + `cache_hit_duration_ms: number` (for hits — target ≤ 1ms). Counted in per-tool timing as a separate aggregate so real tool latency isn't deflated by cache hits.

### Per-Tool Round-Trip Timing
- **Capture:** Existing `tool_call.<name>` spans from Phase 50 already exist. This phase enriches metadata_json with `tool_name` (extracted explicitly, vs. pulling from span name), `is_parallel: bool`, `cached: bool`. No new span types.
- **Query API:** New `TraceStore.getToolPercentiles(agent, since)` returns `readonly { tool_name, p50, p95, p99, count, cache_hit_rate }[]`. SQL groups by tool name extracted from span name via `SUBSTR(name, 11)` (after `tool_call.` prefix).
- **CLI:** New `clawcode tools <agent>` subcommand mirroring `clawcode latency` shape. Positional agent, `--all`, `--since`, `--json`. Output: per-tool table sorted by p95 DESC, highlights slowest.
- **Dashboard:** New "Tool Call Latency" panel adjacent to Prompt Cache. Per-tool rows (collapsible if >10), highlights slowest. 30s polling — same `/api/agents/:name/tools` REST endpoint (NO new IPC method — reuse existing routing via direct handler).
- **Slow-tool SLO:** Global `tool_call` p95 ≤ 1500ms from Phase 51 stays. Per-tool override via `perf.tools.slos: { <tool_name>: { thresholdMs: N } }`. Shared `perf.tools` config namespace (with concurrency cap + idempotent list).

### Correctness Guarantees (No Stale Data)
- **Eviction boundary:** Map lives on the Turn. Turn goes out of scope at `turn.end()` call by the caller (bridge/scheduler). Map is GC'd automatically — no manual cleanup code.
- **Non-idempotent passthrough:** Tools not in `perf.tools.idempotent` bypass the cache entirely. Even if args match. Strictly opt-in whitelist.
- **Argument-order stability:** `canonicalStringify(value)` helper — recursive sort of object keys, null-safe, array-preserving. Unit tests cover nested objects, null, arrays of objects with unsorted keys, and primitive values.
- **Verification test:** Dedicated unit test asserts three scenarios: (a) duplicate memory_lookup with same args hits cache (cached: true, duration ≤ 5ms); (b) duplicate memory_lookup with different args misses cache; (c) duplicate memory_save (non-whitelisted) never hits cache.

### Claude's Discretion
- Exact file layout for the wrapper — prefer `src/mcp/tool-cache.ts` + `src/mcp/tool-dispatch.ts` to keep server.ts slim.
- Whether the MCP server registration path gets a wrapper injection point OR each handler calls the cache manually. Prefer wrapper injection for uniformity.
- `canonicalStringify` may live in `src/shared/` (reusable utility) or inline. Lean reusable.
- Whether `getToolPercentiles` returns `sorted by p95 DESC` in SQL or in JS. Either is fine; pick the cleaner one.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/mcp/server.ts`** — current MCP server exposing 8 ClawCode tools (expanded to 16 per pre-existing test drift). Handler registration point for the wrapper injection.
- **`src/performance/trace-store.ts`** — `getPercentiles` + the Phase 54 `getFirstTokenPercentiles` convenience pattern — mirror for `getToolPercentiles`.
- **`src/performance/trace-collector.ts`** — `Turn` already owns state; adding `toolCache: Map<string, unknown>` is a one-field extension.
- **`src/performance/slos.ts`** — per-tool SLO override pattern extends existing `perf.slos?` field handling from Phase 51.
- **`src/cli/commands/latency.ts`** — CLI shape precedent (positional, --all, --since, --json).
- **`src/cli/commands/cache.ts`** — dashboard + CLI twin pattern.
- **`src/dashboard/server.ts`** — REST endpoint pattern; add `/api/agents/:name/tools`.
- **`src/dashboard/static/app.js`** — panel-per-tile pattern; add "Tool Call Latency" panel.
- **`src/config/schema.ts`** + **`src/shared/types.ts`** — extend `perf` with `tools?: { maxConcurrent?, idempotent?, slos? }`.
- **`src/ipc/protocol.ts`** + **`__tests__/protocol.test.ts`** — only touch if a new IPC method is added. Current plan routes tools query through existing `latency`-style handler added directly to daemon's routeMethod. Prefer adding `tools` method IF needed + honor Phase 50 regression lesson.

### Established Patterns
- Per-agent SQLite, prepared statements, `Object.freeze` returns.
- Phase 50 regression lesson: new IPC method → BOTH protocol.ts AND protocol.test.ts updated in same commit.
- Phase 51 server-emit pattern: per-tool SLO status + threshold emit from server, dashboard reads.
- Phase 52 contract preserved: AssembledContext untouched.
- ESM `.js` imports, Zod v4, readonly types.

### Integration Points
- `src/mcp/server.ts` — wrapper-injection point for cache + concurrency control.
- `src/mcp/tool-cache.ts` (NEW) — `canonicalStringify`, `ToolCache` class attached to Turn.
- `src/mcp/tool-dispatch.ts` (NEW) — concurrency control wrapper + parallel dispatch.
- `src/performance/trace-store.ts` — add `getToolPercentiles`.
- `src/performance/trace-collector.ts` — add `toolCache?` to Turn (optional, opt-in per tool).
- `src/performance/slos.ts` — per-tool SLO lookup helper.
- `src/manager/daemon.ts` — new IPC method `tools` + route handler; update protocol.ts.
- `src/cli/commands/tools.ts` (NEW) — `clawcode tools` CLI.
- `src/cli/index.ts` — register.
- `src/dashboard/server.ts` — `/api/agents/:name/tools` REST.
- `src/dashboard/static/app.js` + `styles.css` — Tool Call Latency panel.
- `src/config/schema.ts` + `src/shared/types.ts` — `perf.tools?` Zod + type mirror.
- `src/ipc/protocol.ts` + `__tests__/protocol.test.ts` — register `"tools"` IPC method.

</code_context>

<specifics>
## Specific Ideas

- **Cache returns a frozen clone, not the underlying reference.** Callers mutating a cache hit result could corrupt subsequent hits. Freeze or structured-clone on hit.
- **`canonicalStringify(undefined)` MUST be deterministic** — treat as `null` or empty string for stable hashing.
- **Parallelization trace assertion.** Add a test: dispatch 2 independent `memory_lookup` calls with different args → assert the spans' `started_at` timestamps are within 10ms of each other (truly parallel, not serial).
- **Pre-existing `src/mcp/server.test.ts` failure (tool count 8 vs 16)** — Phase 55 MAY touch this test while modifying server.ts. If you update tool registration, also fix the stale test count assertion.
- **Phase 50 regression lesson resurfaces:** new `"tools"` IPC method → update BOTH protocol.ts AND protocol.test.ts same commit. Enforce via acceptance grep in Task 3.

</specifics>

<deferred>
## Deferred Ideas

- Speculative tool execution (run likely-next tool before model requests it) — too speculative; token-cost risk.
- Cross-turn cache with TTL-based invalidation — correctness risk too high.
- SDK-side parallelization (forking claude-agent-sdk to expose tool scheduler) — upstream concern.
- MCP-to-MCP orchestration layer — architectural overreach for latency optimization.
- Automatic idempotency inference from tool description — YAGNI; manual whitelist is fine at this scale.
- Tool-input validation gate (reject malformed args before dispatch) — Zod schemas live inside each tool; not this phase.

</deferred>
