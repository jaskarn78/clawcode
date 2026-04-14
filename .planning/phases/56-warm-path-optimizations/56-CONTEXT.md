# Phase 56: Warm-Path Optimizations - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning
**Mode:** Smart discuss — all 4 grey areas accepted as recommended

<domain>
## Phase Boundary

The hot path stays hot. No cold penalty on first memory_lookup, first embedding call, or first message in a burst. Startup health check verifies all warm-path components are ready BEFORE marking an agent `ready` in the fleet status so operators never see a cold agent masquerading as ready.

Scope lines:
- IN: SQLite + sqlite-vec prepared-statement warmup at agent session start, singleton embedding service with lifetime-resident model + startup probe, audit + telemetry-backed confirmation that thread-session keep-alive already works, new `warm-path-check.ts` composite health check + ready-gate integration in `SessionManager.startAgent`, `warm_path_readiness_ms` metric in fleet status, `clawcode status` / `/clawcode-fleet` display of warm-path state, 10-second warmup timeout with error-state failure mode.
- OUT: Disk-backed KV cache persistence across daemon restarts (rejected in earlier milestone discussions), model-level warmup (Anthropic-side concern), cross-agent embedding pool optimizations, network warmup (wouldn't cover Anthropic API latency which is out of our control).

</domain>

<decisions>
## Implementation Decisions

### SQLite + sqlite-vec Warmup
- **Trigger point:** Inside `SessionMemoryManager` construction (or the equivalent per-agent store init site) — after DB handles open but before the agent is marked `ready`. Runs a lightweight "prime the cache" query suite.
- **Warmup queries:**
  - `memory.db`: `SELECT COUNT(*) FROM memories`, one sqlite-vec vector-search over an empty-result filter (forces vec0 extension init).
  - `usage.db`: `SELECT COUNT(*) FROM usage_events WHERE created_at > ? LIMIT 1` with a recent cutoff.
  - `traces.db`: `SELECT COUNT(*) FROM traces`, one read over `trace_spans` with a join plan that primes the sqlite-vec path if present.
- **Scope:** Per-agent on each agent's own SQLite files. Budget ≤ 200ms per agent total (sum across the 3 DBs).
- **Measurement:** New `warm_path_readiness_ms` recorded once per agent-start. Surfaced in `clawcode status` / `/clawcode-fleet`. NOT written to traces.db per-turn (it's a startup metric, not turn metric).
- **Failure handling:** Warmup failure → log ERROR, refuse to mark agent ready, fleet status shows `status: "error", error: "warmup failed: <reason>"`. Daemon keeps running and other agents are unaffected.

### Embedding Model Residency
- **Load timing:** Daemon startup — single `EmbeddingService` instance constructed once in `startDaemon`. Shared across all agents via dependency injection (the existing `SessionMemoryManager` already receives an embedder handle).
- **Idle handling:** Never unload. The `all-MiniLM-L6-v2` model is ~23MB resident. RAM cost is trivial vs. the first-call latency hit of a cold reload.
- **Startup probe:** After construction, run `await embedder.embed("warmup probe")` once. Primes the ONNX runtime, file cache, and quantization tables. Log the warmup duration.
- **Failure handling:** Embedder warmup failure → daemon startup FAILS hard. No graceful degradation — `memory_lookup` without embeddings is a broken surface, not a degraded one.

### Session Keep-Alive (Audit + Verify, Don't Rebuild)
- **Approach:** AUDIT the current code, don't assume it's broken. The Claude Agent SDK's `query({ resume: sessionId })` pattern is already used in `SessionManager.streamFromAgent` — this IS session reuse. Phase 19's thread-manager already maps Discord threads to persistent session IDs.
- **Confirmation via telemetry:** Add a bench test — send 5 messages in quick succession to the same thread, assert messages 2-5 have p50 `end_to_end` ≤ 70% of message 1's. Empirical proof that warm session reuse happens.
- **Build vs verify:** Plan does (a) audit code + document findings in SUMMARY; (b) add the bench assertion; (c) IF audit reveals cold re-init per message, fix it — otherwise mark success criterion satisfied.
- **Failure path:** If the audit reveals cold re-init, add it to Plan scope as a fix; don't pre-build speculative architecture.

### Startup Health Check + Fleet Ready Gate
- **Composition:** New `src/manager/warm-path-check.ts` aggregates 3 readiness signals:
  1. SQLite + sqlite-vec warm queries succeed (all 3 DBs).
  2. `EmbeddingService.isReady() === true` + one probe succeeds.
  3. Initial turn plumbing ready (session created, trace collector attached, first `turn.startSpan` callable).
  Returns `{ ready: bool, durations_ms: { sqlite, embedder, session }, total_ms, errors: string[] }`.
- **Ready-gate integration:** `SessionManager.startAgent` AWAITS the warm-path check before writing `status: "running"` to the registry. Until the check passes, status stays `"starting"`. Registry, `clawcode status`, and dashboard all reflect accurate state.
- **Fleet display:** `clawcode status` + `clawcode-fleet` slash command extend to show a `Warm-Path` column: `ready` (cyan), `starting (warm-path)` (yellow), `error: warmup-timeout` (red). Dashboard per-agent badge extends similarly.
- **Timeout:** 10-second warmup budget. Exceeding → log WARN, mark agent `error: warmup-timeout`, continue daemon. Prevents a single slow DB from blocking the daemon indefinitely.

### Claude's Discretion
- Exact file layout for warm-path-check.ts + helper utilities.
- Whether the embedder probe string is a constant or randomized (fixed is fine — we just need to exercise the pipeline).
- Whether warmup durations are exposed via existing `status` IPC method (extend result) or a new `warm-path-status` IPC method. Prefer extending `status` — aligns with Phase 50 regression lesson (avoid unnecessary new IPC methods).
- Exact Zod schema shape for WarmPathResult — derive from types.ts if introducing a new interface.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/manager/session-memory.ts`** — per-agent store init site. Inject warmup after construction.
- **`src/memory/embedder.ts`** / **`src/memory/store.ts`** — `EmbeddingService` already exists. Singleton wiring via daemon bootstrap is the target.
- **`src/performance/trace-store.ts`** + usage/traces stores — all follow the same per-agent SQLite file pattern.
- **`src/manager/daemon.ts`** — `startDaemon` bootstrap is the singleton embedder construction site.
- **`src/manager/session-manager.ts`** — `startAgent` + `streamFromAgent` flow. Ready-gate integration point.
- **`src/manager/registry.ts`** — registry writes. Warm-path ready flag integrates here.
- **`src/cli/commands/status.ts`** + **`src/discord/slash-commands.ts`** (fleet command) — CLI + Discord fleet display extensions.
- **`src/dashboard/server.ts`** + **`app.js`** — dashboard per-agent badge extensions.
- **`src/benchmarks/runner.ts`** — bench harness for the 5-message keep-alive assertion test.

### Established Patterns
- Per-agent SQLite, prepared statements, `Object.freeze` returns.
- Daemon bootstrap pattern: construct singletons → inject via `Deps` objects.
- Phase 50 regression lesson: new IPC method → BOTH `src/ipc/protocol.ts` AND `src/ipc/__tests__/protocol.test.ts` updated in same commit. This phase likely DOES NOT add a new IPC method (extends existing `status`).
- Phase 52 contract: AssembledContext untouched.
- Server-emit pattern (Phase 51): fleet status + dashboard read warm-path state from registry, no client-side computation.
- Phase 54 pattern: cold-start guard (count < N → no_data) for metrics that need a minimum sample.
- ESM `.js` imports, Zod v4, readonly types.

### Integration Points
- `src/manager/warm-path-check.ts` (NEW) — composite readiness helper.
- `src/manager/session-memory.ts` — SQLite warmup injection.
- `src/manager/daemon.ts` — embedder singleton + initial warmup + register warm-path duration.
- `src/manager/session-manager.ts` — await warm-path check before marking ready.
- `src/manager/registry.ts` — register schema gains optional `warm_path_ready: bool` + `warm_path_readiness_ms?: number`.
- `src/cli/commands/status.ts` — display warm-path column.
- `src/discord/slash-commands.ts` — `/clawcode-fleet` embed shows warm-path state.
- `src/dashboard/server.ts` + `app.js` — per-agent card badge.
- `src/benchmarks/runner.ts` — 5-message same-thread keep-alive bench test (success criterion 3 verification).
- `src/ipc/protocol.ts` + `__tests__/protocol.test.ts` — NO new method expected; verify via grep at plan end.

</code_context>

<specifics>
## Specific Ideas

- **Warmup queries are READ-ONLY.** Never write during warmup — that would alter state operators expect to be untouched at agent restart.
- **200ms budget per agent is tight.** Mostly driven by disk I/O on first query. If SSD, well under budget. On slow spinning disks (rare in production), may need to loosen or make configurable.
- **Embedder singleton is CRITICAL.** Loading the model per-agent would cost ~5s startup × 14 agents = 70s daemon boot. Must be daemon-level.
- **Audit first, build second.** Session keep-alive may already be working — the 5-message bench assertion is the truth, not speculative architecture rebuilds.
- **Ready-gate is the user-visible feature.** Operators currently can't tell if an agent is cold or warm. The ready gate makes it explicit.
- **10s timeout is firm.** Beyond 10s is pathological (corrupt DB, missing model file). Failing fast + surfacing the error is better than silent degradation.

</specifics>

<deferred>
## Deferred Ideas

- Disk-backed KV cache persistence across daemon restarts — rejected in v1.7 scope; prompt cache IS the win.
- Pre-loading hot-tier memory into a warm in-process cache — YAGNI; SQLite page cache is sufficient.
- Background warmup as a heartbeat task (re-warm periodically to survive eviction) — only if we observe eviction. Unlikely at this scale.
- Automatic tuning of warmup query set — too magical; the fixed set is deterministic and debuggable.
- Agent-pool warmup (warm all agents in parallel at daemon start) — the current per-agent sequential start already works; parallel would complicate failure reporting.
- Graceful degradation when embedder fails — correctness-first; memory_lookup without embeddings is broken, not degraded.

</deferred>
