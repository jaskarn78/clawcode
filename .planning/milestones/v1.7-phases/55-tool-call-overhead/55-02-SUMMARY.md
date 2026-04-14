---
phase: 55-tool-call-overhead
plan: 02
subsystem: mcp + performance + manager
tags: [intra-turn-cache, parallel-dispatch, promise-allsettled, semaphore, span-metadata-enrichment, tool-01, tool-02, cache-correctness, deep-freeze-clone, hitcount-delta, caller-owned-turn]

# Dependency graph
requires:
  - phase: 55-01
    provides: canonicalStringify, IDEMPOTENT_TOOL_DEFAULTS, perf.tools Zod + TS mirror, getToolPercentiles, getPerToolSlo
  - phase: 52-02
    provides: caller-owned Turn lifecycle contract (session-adapter NEVER calls turn.end())
  - phase: 50-02
    provides: iterateWithTracing tool_call.<name> span creation point on assistant message content[] scan
provides:
  - ToolCache class (src/mcp/tool-cache.ts) with deep-frozen structured clones on set + get, canonicalStringify-keyed entries, hitCount telemetry
  - runWithConcurrencyLimit utility (src/mcp/tool-dispatch.ts) — worker-pool semaphore + Promise.allSettled error isolation + input-order results
  - Turn.toolCache lazy-init getter (src/performance/trace-collector.ts) — one Map per Turn, GC'd implicitly when Turn drops
  - invokeWithCache helper + McpServerDeps + McpPerfTools types (src/mcp/server.ts) — per-turn cache lookup for whitelisted idempotent tools
  - memory_lookup + search_documents MCP handlers wrapped with cache via invokeWithCache
  - tool_call.<name> span metadata enrichment — tool_name + is_parallel (batch size > 1 in same assistant message) + cached (hitCount delta detection) + cache_hit_duration_ms
affects: [55-03]

# Tech tracking
tech-stack:
  added: []  # No new runtime dependencies
  patterns:
    - "Deep-freeze-clone on cache set AND get — mutations to returned references never corrupt subsequent hits, and post-set caller mutations never poison the stored value (two-direction isolation)"
    - "Per-Turn cache scope via lazy field on the Turn class — cache Map is unreachable once the Turn goes out of scope (GC handles cleanup, no manual invalidation code). Cross-turn leak impossible BY CONSTRUCTION."
    - "Worker-pool semaphore (shared nextIndex counter + N workers via Promise.all) — lock-free, no polling, no setInterval. Errors caught inside the worker so one rejection cannot escape and take down sibling handlers."
    - "Span metadata enrichment (no new span types) — pre-Phase-55 tool_call.<name> spans from Phase 50 gain tool_name + is_parallel + cached keys. The SQL query surface stays stable; only metadata_json columns change."
    - "hitCount-delta detection pattern — session-adapter captures toolCache.hitCount() at span open, compares against hitCount at tool_use_result arrival. Delta > 0 = cache hit served by the MCP wrapper. Span enriched with cached=true BEFORE end(). Keeps MCP server → Trace span linkage out of the critical path."
    - "Pre-scan assistant message content[] for tool_use block count to derive is_parallel BEFORE opening any span. All spans from the same message batch share the same is_parallel flag. Tool calls in separate assistant messages stay sequential (matches SDK dispatch model)."
    - "Config-driven whitelist — invokeWithCache consults perfTools.idempotent (fall back to IDEMPOTENT_TOOL_DEFAULTS). Per-agent override is live; no recompile needed to adjust the cacheable set."
    - "Backward-compat — createMcpServer(deps?) is optional. Stdio startMcpServer path still works; non-daemon MCP clients get raw handler path with zero behavior change."

key-files:
  created:
    - src/mcp/tool-cache.ts
    - src/mcp/__tests__/tool-cache.test.ts
    - src/mcp/tool-dispatch.ts
    - src/mcp/__tests__/tool-dispatch.test.ts
  modified:
    - src/mcp/server.ts
    - src/mcp/server.test.ts
    - src/manager/session-adapter.ts
    - src/manager/__tests__/session-adapter.test.ts
    - src/performance/trace-collector.ts
    - src/performance/__tests__/trace-collector.test.ts
    - vitest.config.ts

key-decisions:
  - "Phase 55 Plan 02 — ToolCache is per-Turn BY CONSTRUCTION. The cache Map lives on the Turn instance, not on a collector-level registry. After turn.end() the Turn is released and the Map is unreachable. Cross-turn leak cannot happen without explicit cache-sharing code (which does not exist). This invariant is proven by the 'Test 15: after turn.end(), a NEW turn has a fresh empty toolCache' test."
  - "Phase 55 Plan 02 — cache set AND get both return through deepFreezeClone. This gives TWO-way isolation: (a) caller cannot poison the cache by mutating values AFTER set (Test: 'set stores a deep clone'), and (b) caller cannot poison subsequent hits by mutating the returned value (Test 5: 'mutation on a hit result does NOT poison subsequent hits'). A single-side freeze would leak in the other direction."
  - "Phase 55 Plan 02 — runWithConcurrencyLimit uses a worker-pool pattern (shared nextIndex counter, N workers from 1..min(max, handlers.length)) instead of a ticket-based semaphore. Rationale: lock-free, zero timers, works with native microtask queue; simpler invariants to test (Test 9 proves cap holds, 'Concurrency cap is honoured' explicitly asserts peak in-flight ≤ 10 for 15 handlers)."
  - "Phase 55 Plan 02 — is_parallel is derived by pre-scanning assistant message content[] for tool_use block count. All spans from the same message batch inherit isParallelBatch = (toolUseCount > 1). Tool calls in separate assistant messages stay sequential. This matches the SDK dispatch model exactly — a single assistant message with N tool_use blocks is ONE batch; the SDK waits for all tool_use_results before the next assistant message."
  - "Phase 55 Plan 02 — cache hit detection on the span uses a hitCount DELTA pattern (capture baseline at span open; compare at span close). Rationale: MCP server wrapper cannot directly reach the tool_use_id-keyed span registry because MCP handlers don't receive tool_use_id. The delta pattern is cheap (O(1) per span) and correctness-complete (any cache.get returning a defined value increments hitCount by exactly 1)."
  - "Phase 55 Plan 02 — memory_save is EXPLICITLY tested as non-cacheable even with an adversarial test-only whitelist (Test 3 + Test 5). This double-asserts the whitelist is CONFIG-DRIVEN rather than hardcoded, and that the default IDEMPOTENT_TOOL_DEFAULTS list (from Plan 55-01) is the correctness guarantee."
  - "Phase 55 Plan 02 — only 2 of the 4 CONTEXT whitelist entries (memory_lookup, search_documents) are currently registered MCP tools. memory_list and memory_graph are NOT registered (they exist as IPC methods but not as MCP tools). Per plan: the whitelist includes them anyway as documented future-proofing; wrapping applies only to the 2 registered tools."
  - "Phase 55 Plan 02 — stdio startMcpServer path DOES NOT pass deps. External MCP clients (non-daemon-hosted) don't have a ClawCode Turn, so cache is correctly skipped for them. This keeps `clawcode mcp` fully backward-compatible with existing MCP clients."
  - "Phase 55 Plan 02 — handler failures do not poison the cache. invokeWithCache calls rawCall() inside a normal await; if it throws, the cache.set line is never reached. A retry re-enters the wrapper, misses (cache is empty), runs the handler again. Proven by the 'handler failures do not poison the cache' test."
  - "Phase 55 Plan 02 — context-assembler.ts is not touched. Phase 52 AssembledContext contract preserved (verified: git diff on context-assembler.ts across this plan returns 0 lines)."
  - "Phase 55 Plan 02 — the import edge performance → mcp IS introduced by importing ToolCache in trace-collector.ts. Grep confirmed ZERO pre-existing performance→mcp imports, but given ToolCache is a correctness-critical contract rather than a transient utility, a direct value import was preferred over a synthetic interface. This is documented so future audits understand the boundary break."
  - "Phase 55 Plan 02 — vitest.config.ts exclude list added. Pre-existing .claude/worktrees/agent-* directories contained stale copies of the project (from prior agent session worktrees) with outdated test files. These polluted every vitest run with 6+ spurious failures unrelated to the primary tree. Exclusion is surgical (.claude/worktrees/**) and covered by the default vitest ignore patterns otherwise."

requirements-completed: [TOOL-01, TOOL-02]

# Metrics
duration: ~30 min
completed: 2026-04-14
---

# Phase 55 Plan 02: Intra-Turn Tool Cache + Parallel Dispatch + Span Enrichment Summary

**Wave 2 latency win — ToolCache class with deep-freeze-clone on set+get (two-direction mutation isolation), runWithConcurrencyLimit worker-pool semaphore with Promise.allSettled error isolation, Turn.toolCache lazy getter (cross-turn leak impossible by construction), MCP server `invokeWithCache` wrapper for the 2 registered whitelisted tools (memory_lookup, search_documents), session-adapter span metadata enrichment (tool_name, is_parallel via pre-scan, cached via hitCount-delta detection), and a 24-test proof suite covering parallel started_at within 10ms, non-idempotent bypass, config-driven whitelist, and fresh-cache-per-turn.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2 (both `auto` + `tdd`, no checkpoints)
- **Files created:** 4 (2 new source modules + 2 new test modules)
- **Files modified:** 7 (5 source + test updates + vitest config)
- **Tests added:** 24 (7 ToolCache + 8 runWithConcurrencyLimit + 4 Turn.toolCache + 9 invokeWithCache + 4 span enrichment) plus test-count drift fix

## Accomplishments

- **A second identical call to `memory_lookup` within the same Turn returns the frozen cached value in <=5ms and records cached=true on the tool_call span.** Verified by server.test.ts Test 1 (elapsed hit time asserted `toBeLessThanOrEqual(5)`) and session-adapter.test.ts cache-hit test (span metadata.cached === true after hitCount delta detection fires). File refs: `src/mcp/server.ts:103-115` (invokeWithCache hit path), `src/manager/session-adapter.ts:688-703` (hitCount-delta → setMetadata).
- **A call to `memory_save` (non-whitelisted) NEVER hits the cache even with identical args.** Verified by server.test.ts Test 3 (3 consecutive calls with identical args → 3 raw invocations, hitCount stays 0). File ref: `src/mcp/server.ts:108` (`isIdempotent` check gates both lookup AND write paths). The whitelist is CONFIG-DRIVEN (Test 5 shows an adversarial override can whitelist memory_save — proves it isn't hardcoded).
- **Two independent `memory_lookup` calls in the same assistant message batch dispatch in parallel — their tool_call spans' started_at timestamps are within 10ms of each other.** Verified by session-adapter.test.ts Test 8 (explicit `Math.abs(a.startedAtMs - b.startedAtMs) <= 10` assertion, both spans tagged is_parallel=true). File ref: `src/manager/session-adapter.ts:622-628` (pre-scan for tool_use block count → isParallelBatch).
- **ToolCache instance lives on Turn; after turn.end() the Map is unreachable; a fresh Turn has an empty cache — zero cross-turn leak.** Verified by trace-collector.test.ts Test 15 (set on turnA, end turnA, new turnB → turnB.toolCache.get returns undefined + hitCount 0). File ref: `src/performance/trace-collector.ts:98-107` (lazy getter — `_toolCache` is a Turn-instance field; no static singletons, no collector-level registries).
- **Concurrency cap (perf.tools.maxConcurrent, default 10) is enforced via semaphore — a batch of 15 dispatches never runs more than 10 concurrently.** Verified by tool-dispatch.test.ts 'Concurrency cap is honoured' test (tracks peak in-flight across 15 handlers, asserts peak <= 10). File ref: `src/mcp/tool-dispatch.ts:41-52` (worker pool of min(maxConcurrent, handlers.length) workers pulls from shared nextIndex).
- **Promise.allSettled pattern isolates errors — one handler throw does not block siblings.** Verified by tool-dispatch.test.ts Test 10 (3 handlers, middle throws, results[0]+[2] fulfilled, results[1] rejected). File ref: `src/mcp/tool-dispatch.ts:44-50` (try/catch inside worker → per-handler PromiseSettledResult).
- **Cache hit returns a deep-frozen structured clone — mutating a cache hit result does not corrupt subsequent hits.** Verified by tool-cache.test.ts Test 5 (attempted mutation in strict mode throws; subsequent get returns pristine value). Bonus: 'set stores a deep clone' test proves the OTHER direction — caller-side mutation of the pre-set reference also does not leak into the cache. File ref: `src/mcp/tool-cache.ts:39-57` (deepFreezeClone helper + usage on set AND return path).
- **tool_call.<name> span metadata gains keys: tool_name, cached, is_parallel (+ cache_hit_duration_ms on hit).** Verified by session-adapter.test.ts Test 7 (span.metadata matches `{ tool_name, tool_use_id, is_parallel, cached }`). File ref: `src/manager/session-adapter.ts:632-640` (startSpan call with enriched metadata object).
- **Pre-existing `src/mcp/server.test.ts` tool-count failure (8 vs 16) FIXED.** Updated the stale assertion in Task 2's Task commit alongside the server.ts wrapper work. File ref: `src/mcp/server.test.ts:37` (`toBe(16)` replaces the drifted `toBe(8)`).
- **Parallelization trace assertion — started_at timestamps within 10ms is explicitly tested.** File ref: `src/manager/__tests__/session-adapter.test.ts:384` (`toBeLessThanOrEqual(10)`).

## Task Commits

Each task was committed atomically. TDD RED phase also committed separately to preserve the red-green audit trail.

1. **Task 1 RED: add failing tests for ToolCache, runWithConcurrencyLimit, Turn.toolCache** — `c1f6313` (test)
   - `src/mcp/__tests__/tool-cache.test.ts` — 7 tests + 1 bonus (set-side clone)
   - `src/mcp/__tests__/tool-dispatch.test.ts` — 8 tests
   - `src/performance/__tests__/trace-collector.test.ts` — 4 tests appended to existing describe
   - `vitest.config.ts` — exclude `.claude/worktrees/**` (surgical fix for pre-existing pollution, documented in plan deferred-items.md)

2. **Task 1 GREEN: ToolCache + runWithConcurrencyLimit + Turn.toolCache** — `84f2e76` (feat)
   - `src/mcp/tool-cache.ts` (NEW, 105 lines) — ToolCache class + deepFreezeClone helper + static `key()` + set/get/hitCount
   - `src/mcp/tool-dispatch.ts` (NEW, 56 lines) — runWithConcurrencyLimit with worker-pool + Promise.allSettled + input-order result array
   - `src/performance/trace-collector.ts` — ToolCache import + `_toolCache` private field + lazy `toolCache` getter on Turn

3. **Task 2 GREEN: MCP server cache wrapping + session-adapter span enrichment + test count fix** — `0f66b20` (feat)
   - `src/mcp/server.ts` — McpPerfTools + McpServerDeps types, invokeWithCache helper export, deps parameter on createMcpServer, memory_lookup + search_documents routed through invokeWithCache, startMcpServer preserves backward-compat by omitting deps
   - `src/mcp/server.test.ts` — fix `toBe(8)` → `toBe(16)` + 9 new invokeWithCache tests (cache hit/miss, non-idempotent bypass, arg-order stability, config-driven whitelist, missing-deps/missing-turn fallbacks, handler-failure non-poisoning)
   - `src/manager/session-adapter.ts` — pre-scan assistant message content[] for tool_use count → isParallelBatch; enrich tool_call span metadata with tool_name + is_parallel + cached; track hitCount baseline at span open; on tool_use_result arrival, compare hitCount and call setMetadata with cached=true + cache_hit_duration_ms BEFORE span.end()
   - `src/manager/__tests__/session-adapter.test.ts` — 4 new Phase 55 tests (metadata shape, parallel started_at within 10ms, sequential-message baseline, cache-hit delta enrichment)

**Plan metadata commit:** _(final `docs` commit below after STATE + ROADMAP update)_

## Files Created/Modified

### Created

| Path | Lines | Purpose |
|------|-------|---------|
| `src/mcp/tool-cache.ts` | 105 | ToolCache class (per-Turn Map, deep-freeze-clone set+get, canonicalStringify key, hitCount telemetry). Exports: ToolCache. |
| `src/mcp/__tests__/tool-cache.test.ts` | 117 | 8 tests covering key format, arg-order stability, set/get, miss, deep-freeze-clone isolation (mutation + set-side), tool-name isolation, hitCount telemetry. |
| `src/mcp/tool-dispatch.ts` | 56 | runWithConcurrencyLimit with worker-pool semaphore + Promise.allSettled error isolation + input-order result ordering. Exports: runWithConcurrencyLimit. |
| `src/mcp/__tests__/tool-dispatch.test.ts` | 113 | 8 tests (parallel <150ms, cap 400-900ms, error isolation, empty input, unconstrained, concurrency peak cap, input-order preservation, invalid maxConcurrent rejection). |

### Modified

| Path | Change |
|------|--------|
| `src/mcp/server.ts` | Added IDEMPOTENT_TOOL_DEFAULTS import + Turn type import + McpPerfTools type + McpServerDeps type + invokeWithCache exported helper. createMcpServer signature extended with optional `deps`. memory_lookup + search_documents handlers routed through invokeWithCache. startMcpServer remains backward-compat (omits deps). |
| `src/mcp/server.test.ts` | Fixed pre-existing tool-count drift: `toBe(8)` → `toBe(16)` (matches current TOOL_DEFINITIONS with 16 entries). Added 9 invokeWithCache tests covering cache hit/miss/bypass semantics, arg-order stability, config-driven whitelist, backward-compat paths, and failure non-poisoning. |
| `src/manager/session-adapter.ts` | activeTools Map value changed from `Span` to `{ span, hitCountAtOpen, openedAtMs }`. Pre-scan of assistant message content[] for tool_use block count → isParallelBatch derived from `toolUseCount > 1`. tool_call.<name> span metadata at open now includes tool_name + is_parallel + cached=false. On tool_use_result arrival, hitCount delta detection → setMetadata with cached=true + cache_hit_duration_ms BEFORE span.end(). Guarded access to `turn.toolCache` (tests pass minimal mock Turns that lack the field). |
| `src/manager/__tests__/session-adapter.test.ts` | New Phase 55 describe block with richer mock Turn (PhaseSpan with metadata + setMetadata spy + toolCache.hitCount queue). 4 tests: span metadata shape, parallel started_at within 10ms, sequential-message baseline, cache-hit delta enrichment. |
| `src/performance/trace-collector.ts` | Added ToolCache import from `../mcp/tool-cache.js`. Added `_toolCache: ToolCache \| undefined` private field + lazy `toolCache` getter on Turn. Cache Map is GC'd when Turn goes out of scope — no explicit cleanup. |
| `src/performance/__tests__/trace-collector.test.ts` | New Phase 55 describe block with 4 tests (lazy singleton identity, per-turn isolation, zero cross-turn leak, lazy allocation). |
| `vitest.config.ts` | Added exclude list including `.claude/worktrees/**` (surgical fix for pre-existing stale project copies polluting vitest globs — logged in deferred-items.md). |

## Key Public API

### invokeWithCache wrapper (src/mcp/server.ts)

```typescript
/**
 * Cross-cutting helper — wrap a raw IPC handler with per-turn cache lookup
 * for whitelisted idempotent tools.
 *
 * Flow:
 *   1. If `deps` is absent OR no active Turn — run raw, no cache.
 *   2. Resolve whitelist from perfTools.idempotent ?? IDEMPOTENT_TOOL_DEFAULTS.
 *   3. If tool is whitelisted AND Turn.toolCache has a hit — return frozen
 *      cached value (raw handler NEVER runs).
 *   4. Else run raw handler. On SUCCESS + whitelisted — write to cache.
 *      On FAILURE — propagate; cache stays empty so retries re-run.
 *
 * Span metadata enrichment (`cached: true`) is performed by session-adapter
 * via hitCount delta detection — the wrapper has no direct span handle
 * because MCP handlers don't receive tool_use_id.
 */
export async function invokeWithCache<R>(
  toolName: string,
  agentName: string,
  args: unknown,
  rawCall: () => Promise<R>,
  deps: McpServerDeps | undefined,
): Promise<R> {
  if (!deps?.getActiveTurn) return rawCall();
  const turn = deps.getActiveTurn(agentName);
  if (!turn) return rawCall();

  const perfTools = deps.getAgentPerfTools?.(agentName);
  const idempotent = perfTools?.idempotent ?? IDEMPOTENT_TOOL_DEFAULTS;
  const isIdempotent = idempotent.includes(toolName);

  if (isIdempotent) {
    const cached = turn.toolCache.get(toolName, args);
    if (cached !== undefined) {
      return cached as R;
    }
  }

  const result = await rawCall();
  if (isIdempotent) {
    turn.toolCache.set(toolName, args, result);
  }
  return result;
}
```

### tool_call span metadata at open (src/manager/session-adapter.ts)

```typescript
// Phase 55 Plan 02 — span metadata enrichment. No new span types;
// just extra keys on existing `tool_call.<name>` spans so per-tool
// queryability (tool_name) + parallel vs serial (is_parallel) +
// cache hit observability (cached) are surfaced.
const span = turn?.startSpan(`tool_call.${block.name}`, {
  tool_use_id: block.id,
  tool_name: block.name,
  is_parallel: isParallelBatch,  // toolUseCount > 1 in this assistant message
  cached: false,                 // default; updated to true on hit (see user-msg branch)
});
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Vitest picked up stale worktree copies, producing 6 spurious failures**
- **Found during:** initial test run before writing any code.
- **Issue:** `.claude/worktrees/agent-*` contains 15+ stale copies of the project from prior agent worktree sessions. Each carries outdated `src/mcp/server.test.ts` (expecting 6 tools, 7 tools, or 8 tools depending on the copy's age) that vitest glob-matched. Running `npx vitest` produced 6+ failures unrelated to the primary tree, making it impossible to verify actual Plan 55-02 test outcomes.
- **Fix:** Added `exclude: [..., ".claude/worktrees/**"]` to `vitest.config.ts` alongside the default vitest exclude set (`node_modules`, `dist`, etc.). Tests now scope cleanly to `src/**`.
- **Files modified:** `vitest.config.ts`
- **Commit:** `c1f6313` (bundled with RED tests since both are pre-GREEN setup)
- **Also:** Deferred follow-up logged at `.planning/phases/55-tool-call-overhead/deferred-items.md` suggesting the user delete `.claude/worktrees/` or keep the vitest exclusion long-term.

### Auth Gates

None.

### Architectural Decisions Requested

None — all Rules 1-3 fixes were obvious blockers or missing critical functionality.

## Verification

```bash
# 1. New modules exist with required exports
$ grep -c "class ToolCache" src/mcp/tool-cache.ts
1
$ grep -c "canonicalStringify" src/mcp/tool-cache.ts
5

# 2. Concurrency + error isolation primitives present
$ grep -c "runWithConcurrencyLimit" src/mcp/tool-dispatch.ts
2
$ grep -Ec "Promise\.allSettled|PromiseSettledResult" src/mcp/tool-dispatch.ts
4

# 3. MCP server deps injection + wrapper wiring
$ grep -Ec "McpServerDeps|invokeWithCache|getActiveTurn" src/mcp/server.ts
12

# 4. Span metadata enrichment (no new span types — just new keys)
$ grep -Ec "is_parallel|tool_name:" src/manager/session-adapter.ts
4

# 5. Turn.toolCache lazy field
$ grep -Ec "toolCache|_toolCache" src/performance/trace-collector.ts
5

# 6. Stale test count fixed
$ grep -c "toBe(16)" src/mcp/server.test.ts
1

# 7. Phase 52 contract preserved — context-assembler untouched
$ git diff --stat HEAD~3 HEAD -- src/manager/context-assembler.ts
(empty — zero lines changed)

# 8. Parallelization trace assertion present
$ grep -c "toBeLessThanOrEqual(10)" src/manager/__tests__/session-adapter.test.ts
1

# 9. Idempotent defaults list excludes non-idempotent tools
$ grep -A10 "IDEMPOTENT_TOOL_DEFAULTS = Object.freeze" src/config/schema.ts | grep -Ec "memory_save|spawn_subagent|send_message|ingest_document"
0

# 10. Caller-owned Turn invariant — zero turn.end() in new files
$ for f in src/mcp/server.ts src/mcp/tool-cache.ts src/mcp/tool-dispatch.ts; do grep -c 'turn\.end(' "$f"; done
0
0
0

# 11. In-scope suite GREEN (6 test files, 77 tests)
$ npx vitest run src/mcp/__tests__/tool-cache.test.ts src/mcp/__tests__/tool-dispatch.test.ts src/mcp/server.test.ts src/performance/__tests__/trace-collector.test.ts src/performance/__tests__/cache-eviction.test.ts src/manager/__tests__/session-adapter.test.ts
 Test Files  6 passed (6)
      Tests  77 passed (77)

# 12. Full suite — no regressions
$ npx vitest run
 Test Files  134 passed (134)
      Tests  1468 passed (1468)
```

## Self-Check: PASSED

All verification grep commands produce the expected counts. All 77 in-scope tests pass. Full suite of 1468 tests pass with zero regressions. SUMMARY.md written to `.planning/phases/55-tool-call-overhead/55-02-SUMMARY.md`. Requirements TOOL-01 and TOOL-02 are closed at the implementation level; CLI + dashboard surface ships in Plan 55-03.
