---
phase: 55-tool-call-overhead
verified: 2026-04-13T05:18:00Z
status: human_needed
score: 4/4 observable truths verified + 1 deferred to human
gaps: []
human_verification:
  - test: "Dashboard Tool Call Latency panel renders in browser"
    expected: "Per-agent tile shows Tool Call Latency panel adjacent to Prompt Cache panel, with per-tool rows (memory_lookup, search_documents, memory_save), slow-tool cells tinted red when p95 > 1500ms, collapse-to-top-5 affordance visible when >10 tools."
    why_human: "DOM eyeball verification — CSS visual effects, layout adjacency, interactive collapse/expand cannot be asserted programmatically. Synthetic data verified at the daemon + REST layers during Plan 55-03 Task 3 checkpoint (ffa8071 → 907ce66)."
  - test: "Live Discord tool traffic exercises cache + parallel dispatch"
    expected: "Agent issues memory_lookup + search_documents in one assistant message batch → both tool_call spans have is_parallel=true and started_at timestamps within 10ms. A repeat memory_lookup with identical args in the same turn returns cached value in <=5ms and carries cached=true."
    why_human: "Live runtime behavior requires a real Claude Code session with model-issued tool_use batches. Synthetic span injection verified during Plan 55-03 Task 3 (1501/1501 tests GREEN on clawdy, SLO evaluation correct), but the end-to-end SDK → MCP → cache path on live model traffic is the final confidence check."
  - test: "Cross-turn cache leak stress (runtime)"
    expected: "Fire 5 consecutive turns with identical memory_lookup args. Turn N+1 MUST miss cache (fresh Map) — hitCount resets to 0 at the start of each new Turn."
    why_human: "Unit test (trace-collector.test.ts 'Test 15') proves the invariant in isolation. A production-runtime stress test across real Turn boundaries (scheduler end/start cycle) is the confidence check for the caller-owned Turn lifecycle contract."
---

# Phase 55: Tool-Call Overhead Verification Report

**Phase Goal:** A turn spends less time waiting on tools.
**Verified:** 2026-04-13T05:18:00Z
**Status:** human_needed (all automated checks GREEN; 3 runtime/visual confirmations deferred)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Independent tool calls within a single turn execute in parallel (serialization points identified + removed, verified by trace comparison) | VERIFIED | `runWithConcurrencyLimit` worker-pool + `Promise.allSettled` at `src/mcp/tool-dispatch.ts:44-58`; pre-scan of assistant message content[] derives `isParallelBatch = toolUseCount > 1` at `src/manager/session-adapter.ts:619-622`; `is_parallel` span metadata flows through at line 642. Explicit test `session-adapter.test.ts` asserts `Math.abs(spanA.startedAtMs - spanB.startedAtMs) <= 10` for same-batch calls. |
| 2 | Idempotent tool results cached within a turn; second-call latency approaches zero | VERIFIED | `ToolCache.get` / `.set` with `canonicalStringify` key at `src/mcp/tool-cache.ts:90-106`; `invokeWithCache` wrapper at `src/mcp/server.ts:132-159` applied to `memory_lookup` (line 375) + `search_documents` (line 569). Test asserts elapsed hit time `toBeLessThanOrEqual(5)`ms; `hitCount` increments only on defined gets. |
| 3 | Per-tool round-trip timing logged and visible on the dashboard | VERIFIED (automated path) + HUMAN PENDING (DOM eyeball) | Daemon `case "tools"` at `src/manager/daemon.ts:1506` returns `AugmentedToolRow[]` via `augmentToolsWithSlo` (line 184) + `getToolPercentiles` (line 1538). REST `GET /api/agents/:name/tools` at `src/dashboard/server.ts:224-252`. CLI `clawcode tools` at `src/cli/commands/tools.ts:130` sorts by p95 DESC with `[SLOW]` sigil. Dashboard panel `renderToolsPanel` at `src/dashboard/static/app.js:616`. Plan 55-03 Task 3 live-tested CLI output on clawdy (search_documents [SLOW] at p95 1700ms > 1500 SLO, memory_lookup healthy at 150ms). Browser DOM render deferred to human. |
| 4 | Cache is scoped strictly to a single turn — no stale data leaks across turns | VERIFIED BY CONSTRUCTION | `ToolCache` is lazy-init getter on `Turn` at `src/performance/trace-collector.ts:131-134` — Map is instance-scoped, NOT collector/registry-level. Trace-collector.test.ts 'Test 15' proves `turnB.toolCache.get(...) === undefined` after `turnA.end()`. Zero `turn.end()` calls in mcp/server.ts, mcp/tool-cache.ts, mcp/tool-dispatch.ts (caller-owned lifecycle preserved). Runtime stress test across real scheduler boundaries deferred to human. |

**Score:** 4/4 truths verified (3 fully automated; truth 3 has dashboard DOM pending; truth 4 has runtime stress pending)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/shared/canonical-stringify.ts` | canonicalStringify export, deterministic nested key sort, null/undefined/NaN coercion | VERIFIED | 60 lines, exports canonicalStringify, 8 unit tests GREEN. Spot-check: `canonicalStringify({b:1,a:2}) === canonicalStringify({a:2,b:1})` → true; `canonicalStringify(undefined)` → "null". |
| `src/config/schema.ts` (IDEMPOTENT_TOOL_DEFAULTS + toolsConfigSchema) | Frozen 4-entry whitelist, Zod schema with maxConcurrent min 1 default 10 | VERIFIED | Exports at lines 270 / 285 / 312 / 321. `toolsConfigSchema.parse({})` returns `{maxConcurrent:10, idempotent:[memory_lookup, search_documents, memory_list, memory_graph]}`. Wired into BOTH agentSchema.perf (line 366) AND defaultsSchema.perf (line 407). |
| `src/shared/types.ts` (ResolvedAgentConfig.perf.tools) | Readonly inline mirror at line 150 | VERIFIED | `readonly tools?:` block with maxConcurrent, idempotent, slos (record) — inline-literal (no cross-module import), Phase 51/53/54 low-dep boundary preserved. |
| `src/performance/types.ts` (ToolPercentileRow) | Row shape `{tool_name, p50, p95, p99, count}` all readonly | VERIFIED | Exported; referenced by trace-store at line 45 (PreparedStatements.perToolPercentiles). |
| `src/performance/trace-store.ts` (getToolPercentiles) | CTE with SUBSTR(name, 11), ORDER BY p95 DESC NULLS LAST | VERIFIED | Method at line 282 + prepared statement at line 573-576. 5 new trace-store tests GREEN. |
| `src/performance/slos.ts` (getPerToolSlo) | Override-wins helper with tool_call fallback (1500ms p95) | VERIFIED | Helper at line 248. Spot-check: `getPerToolSlo('memory_lookup', undefined)` → `{thresholdMs:1500, metric:"p95"}`; override returns override value. |
| `src/mcp/tool-cache.ts` (ToolCache class) | Deep-freeze-clone on set+get, canonicalStringify key, hitCount telemetry | VERIFIED | 112 lines. ToolCache class with private hits Map, deepFreezeClone helper (line 49-61), `key()` static, `set`/`get`/`hitCount`. Spot-check: hit returns value, miss returns undefined, hitCount=1 after one successful get. |
| `src/mcp/tool-dispatch.ts` (runWithConcurrencyLimit) | Worker-pool semaphore + Promise.allSettled | VERIFIED | 60 lines. Exports `runWithConcurrencyLimit`. Spot-check: 3 handlers (one throws) → `[fulfilled, rejected, fulfilled]` in input order. |
| `src/mcp/server.ts` (invokeWithCache + createMcpServer(deps?)) | getActiveTurn injection, whitelist lookup, memory_lookup + search_documents wrapped | VERIFIED | 12 matches for invokeWithCache/ToolCache/getActiveTurn/McpServerDeps. invokeWithCache at line 132, memory_lookup wrapped at 375, search_documents wrapped at 569. Non-idempotent memory_save bypasses (config-driven whitelist). |
| `src/performance/trace-collector.ts` (Turn.toolCache) | Lazy-init getter, one Map per Turn | VERIFIED | Import at line 25; `_toolCache` field at line 90; getter at line 131-134. Unreachable after Turn GC — cross-turn leak impossible by construction. |
| `src/manager/session-adapter.ts` (span enrichment) | tool_name + is_parallel + cached + cache_hit_duration_ms on tool_call spans | VERIFIED | Pre-scan at 619-622; span startup at 639-644 with metadata; hitCount-delta detection at 682-690 updates cached=true before end(). |
| `src/ipc/protocol.ts` + test | `tools` IPC method registered in BOTH files SAME COMMIT | VERIFIED | protocol.ts:64 and protocol.test.ts:67 — both committed in ffa8071 (Phase 50 regression lesson honored). |
| `src/manager/daemon.ts` (case "tools") | Augmented handler with SLO status | VERIFIED | Handler at line 1506, `augmentToolsWithSlo` helper at 184, `getToolPercentiles` call at 1538. |
| `src/dashboard/server.ts` (REST endpoint) | GET /api/agents/:name/tools | VERIFIED | Endpoint at lines 230-252 proxies via `sendIpcRequest(socketPath, "tools", {agent, since})`. |
| `src/cli/commands/tools.ts` + index.ts registration | clawcode tools CLI | VERIFIED | 179 lines. `registerToolsCommand` + `formatToolsTable` + registered in src/cli/index.ts:157. Live-tested on clawdy during Plan 55-03 Task 3. |
| `src/dashboard/static/app.js` (renderToolsPanel + fetchAgentTools) | Panel adjacent to Prompt Cache, 30s polling | VERIFIED (code path) | `renderToolsPanel` at line 616; `fetchAgentTools` at 582; tools-panel DOM at 286; 30s polling at 336. Zero DEFAULT_SLOS/SLO_LABELS references in app.js (server-emit invariant preserved). |
| `src/dashboard/static/styles.css` | tools-panel / tool-row-slow / tool-row-healthy classes | VERIFIED | Classes at lines 1011, 1027, 1070, 1076. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| src/mcp/server.ts | src/mcp/tool-cache.ts | `turn.toolCache.get/set` in invokeWithCache | WIRED | Server.ts line 148 (`turn.toolCache.get`) + 156 (`turn.toolCache.set`). Whitelist gate at 145-146. |
| src/mcp/tool-cache.ts | src/shared/canonical-stringify.ts | `canonicalStringify(args)` in cache key | WIRED | Import at tool-cache.ts:38, usage in `ToolCache.key` at line 79. |
| src/performance/trace-collector.ts | src/mcp/tool-cache.ts | Turn owns ToolCache lifecycle | WIRED | Import at trace-collector.ts:25, lazy getter at 131-134. |
| src/cli/commands/tools.ts | src/manager/daemon.ts | sendIpcRequest(SOCKET_PATH, "tools", ...) | WIRED | CLI invokes `tools` IPC method; daemon routes to case "tools" at line 1506. |
| src/dashboard/static/app.js | src/dashboard/server.ts | fetch('/api/agents/<name>/tools') polling | WIRED | `fetchAgentTools` at app.js:582 calls the REST endpoint; 30s polling interval. |
| src/dashboard/server.ts | src/manager/daemon.ts | REST → IPC proxy | WIRED | Server.ts:242 `sendIpcRequest(socketPath, "tools", {agent, since})`. |
| src/manager/session-adapter.ts | src/performance/trace-collector.ts | hitCount-delta read at span open/close | WIRED | 619-651 baseline capture, 682-690 delta detection + setMetadata. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| Tool Call Latency panel (app.js) | `report.tools` | `/api/agents/:name/tools` → `augmentToolsWithSlo(store.getToolPercentiles(...))` → SQLite trace_spans | Yes — real SQL aggregation against `tool_call.%` spans written by session-adapter | FLOWING |
| clawcode tools CLI | `result.tools` | Same daemon handler as dashboard | Yes | FLOWING |
| Cache hit metadata (span.metadata.cached) | `hitCountNow - hitCountAtOpen` | `ToolCache.hitCount()` incremented in `.get()` when returning defined value | Yes — real delta detection at tool_use_result arrival | FLOWING |
| is_parallel span metadata | `toolUseCount > 1` | Pre-scan of assistant message `content[]` for `type === "tool_use"` blocks | Yes — real SDK message structure | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| canonicalStringify key-order invariance | `canonicalStringify({b:1,a:2}) === canonicalStringify({a:2,b:1})` | `true` | PASS |
| canonicalStringify undefined coercion | `canonicalStringify(undefined)` | `"null"` | PASS |
| ToolCache hit returns stored value | `c.set('t', {q:1}, {r:'x'}); c.get('t', {q:1})` | `{r: 'x'}` | PASS |
| ToolCache miss returns undefined | `c.get('t', {q:2})` | `undefined` | PASS |
| ToolCache hitCount increments only on hit | after 1 hit, 1 miss | `1` | PASS |
| runWithConcurrencyLimit error isolation | 3 handlers, middle throws | `[fulfilled:ok1, rejected, fulfilled:ok3]` | PASS |
| toolsConfigSchema defaults | `toolsConfigSchema.parse({})` | `{maxConcurrent:10, idempotent:[4 tools]}` | PASS |
| IDEMPOTENT_TOOL_DEFAULTS forbidden exclusion | filter for memory_save/spawn_subagent/send_message | `[]` | PASS |
| getPerToolSlo global fallback | `getPerToolSlo('memory_lookup', undefined)` | `{thresholdMs:1500, metric:"p95"}` | PASS |
| getPerToolSlo override | `getPerToolSlo('memory_lookup', {slos:{memory_lookup:{thresholdMs:100}}})` | `{thresholdMs:100, metric:"p95"}` | PASS |
| Phase 55 test suites GREEN | 13 test files (200 tests) — canonical-stringify + tools-schema + tool-cache + tool-dispatch + cli/tools + trace-store + slos + trace-collector + session-adapter + daemon-tools + dashboard/server + protocol + mcp/server | `13 passed (13), 200 passed (200)` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| TOOL-01 | 55-02-PLAN | Independent tool calls within a single turn execute in parallel | SATISFIED | `runWithConcurrencyLimit` worker-pool + `Promise.allSettled` in `src/mcp/tool-dispatch.ts` caps at `perf.tools.maxConcurrent` (default 10, min 1). Session-adapter pre-scan derives `isParallelBatch` and marks all same-batch spans `is_parallel=true`. Explicit `toBeLessThanOrEqual(10)` ms assertion on span started_at timestamps in session-adapter.test.ts. |
| TOOL-02 | 55-02-PLAN | Intra-turn idempotent tool-result cache | SATISFIED | `ToolCache` class with deep-freeze-clone on set+get; `invokeWithCache` wrapper whitelist-gated via `perf.tools.idempotent` (default 4-tool frozen list); per-Turn lifetime (lazy getter on Turn; Map unreachable after turn.end()). memory_lookup + search_documents wrapped in server.ts; memory_save bypasses even under adversarial whitelist (Test 3). Cache hit latency asserted `<=5ms`. |
| TOOL-03 | 55-01-PLAN, 55-03-PLAN | Per-tool round-trip timing logged and visible in the dashboard | SATISFIED (automated) / HUMAN PENDING (DOM eyeball) | `getToolPercentiles` SQL aggregation → `case "tools"` daemon handler → REST endpoint → CLI (`clawcode tools`) + dashboard panel. Live-tested on clawdy 2026-04-14 — synthetic injection proved p95 DESC sort + `[SLOW]` sigil on SLO breach + `--json` shape. Server-emit invariant preserved (zero client-side SLO constants in app.js). Browser DOM render + live Discord traffic deferred to user per orchestrator delegation. |

All 3 requirement IDs from ROADMAP Phase 55 section appear in at least one plan's `requirements:` field. Zero orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | No TODO/FIXME/placeholder/stub patterns detected in phase 55 source files | — | Clean |

Note: `cached: false` default at session-adapter.ts:643 is legitimate — it is the initial span metadata, overwritten by delta detection on hit. Flagged-and-cleared per stub classification rules (other code path populates via `setMetadata` on hit).

### Human Verification Required

1. **Dashboard Tool Call Latency panel DOM render**
   - What to do: Open dashboard in browser with a running daemon that has tool_call spans. Confirm the panel appears adjacent to Prompt Cache per agent, per-tool rows render with tool names (memory_lookup, search_documents, memory_save), and slow-tool cells tint red when p95 > 1500ms. If >10 tools observed, confirm collapse-to-top-5 with 'Show all' affordance.
   - Expected: Panel visually adjacent to Prompt Cache, rows sorted slowest-first, cell tinting correct per `tool-row-slow` / `tool-row-healthy` / `tool-row-no-data` classes.
   - Why human: CSS layout adjacency and color tinting are visual. Synthetic data verified at daemon + REST layers already.

2. **Live Discord tool traffic — parallel dispatch + intra-turn cache**
   - What to do: Send a message to an agent that triggers memory_lookup + search_documents in one assistant message batch. Then repeat the same memory_lookup query in the same turn. Inspect trace_spans for both tool_call.memory_lookup spans.
   - Expected: First batch: both spans have `is_parallel: true` and `started_at` within 10ms. Second memory_lookup: `cached: true` + `cache_hit_duration_ms <= 5`.
   - Why human: End-to-end SDK → MCP → cache path on live model traffic is the final confidence check. Unit tests cover in-isolation invariants.

3. **Cross-turn cache leak stress (runtime)**
   - What to do: Fire 5 consecutive turns with identical memory_lookup args. Inspect each turn's toolCache.hitCount() at end (or inspect tool_call spans — each fresh turn's memory_lookup should show `cached: false`).
   - Expected: Each new turn starts with empty cache; hitCount() returns 0 on the first get of each turn regardless of prior turns.
   - Why human: Unit test proves in isolation. Production-runtime stress across scheduler end/start cycle is the confidence check for the caller-owned Turn lifecycle contract.

### Gaps Summary

No automated-verification gaps. All 4 observable truths are technically satisfied by code paths that exist, are substantive, are wired, and flow real data. The 3 human-verification items are visual/runtime confidence checks whose programmatic proxies (unit tests, synthetic injection, SQL aggregation spot-checks) all pass.

Runtime verification on clawdy during Plan 55-03 Task 3 (2026-04-14) proved:
- Build succeeds
- Daemon starts
- CLI table output matches expected format (p95 DESC sort, `[SLOW]` sigil, SLO evaluation correct)
- `--json` shape matches AugmentedToolRow contract
- Full test suite 1501/1501 GREEN with zero failures (vitest worktree exclusion eliminated pre-existing noise; mcp/server.test.ts tool count drift 8→16 fixed)

The 3 remaining human-verification items are explicitly scoped in the phase 55-03 summary as "Deferred to user" and approved by orchestrator delegation. No code paths are untested or unwired.

---

*Verified: 2026-04-13T05:18:00Z*
*Verifier: Claude (gsd-verifier)*
