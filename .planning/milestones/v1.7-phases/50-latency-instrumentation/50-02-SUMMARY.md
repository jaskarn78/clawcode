---
phase: 50-latency-instrumentation
plan: 02
subsystem: performance
tags: [tracing, session-adapter, context-assembler, spans, subagent-filter, caller-owned-lifecycle, sdk-stream]

# Dependency graph
requires:
  - phase: 50-01
    provides: TraceStore + TraceCollector + Turn + Span primitives with batched per-turn flush
  - phase: 50-00
    provides: Wave 0 RED test scaffolding for session-adapter tracing (5 tests) + context-assembler tracing (3 tests)
provides:
  - Per-agent TraceStore + TraceCollector lifecycle (AgentMemoryManager init/cleanup)
  - SessionManager.getTraceStore(agent) + getTraceCollector(agent) accessors
  - SessionManager.streamFromAgent/sendToAgent accept optional caller-owned Turn parameter (NOT turnId)
  - SessionHandle.send/sendAndCollect/sendAndStream accept optional Turn; shared iterateWithTracing helper (Pitfall 2 resolved by construction)
  - first_token span fires on first PARENT assistant text block (subagent filter via parent_tool_use_id !== null, Pitfall 6 resolved)
  - tool_call.<name> span opened on each tool_use content block, ended on matching tool_use_result
  - end_to_end span covers full SDK stream in all three send variants
  - createTracedSessionHandle factory export (test harness + pre-bound-Turn pattern for future use)
  - ContextAssembler.assembleContextTraced wrapper (finally-ended context_assemble span)
affects: [50-02b, 50-03]

# Tech tracking
tech-stack:
  added: []  # No new runtime dependencies — all primitives already in src/performance/
  patterns:
    - "Caller-owned Turn lifecycle: Bridge/Scheduler construct Turn via TraceCollector.startTurn(), thread it through SessionManager → SessionHandle as optional parameter, own end(). SessionManager/SessionHandle NEVER call turn.end()."
    - "Shared iterateWithTracing helper inside wrapSdkQuery closure — all three send variants (send/sendAndCollect/sendAndStream) delegate so tracing cannot diverge (Pitfall 2 resolved by construction)."
    - "Subagent filter via parent_tool_use_id !== null — first_token + tool_call starts fire ONLY on PARENT assistant messages; subagent-emitted assistant messages do not end parent's first_token (Pitfall 6)."
    - "Content-block iteration over msg.message.content[] (NOT the narrowed local msg.content: string type) for tool_use + text block discrimination — matches SDK's BetaContentBlock shape."
    - "Bound Turn via factory: createTracedSessionHandle({sdk, baseOptions, sessionId, turn}) binds a Turn into the handle's closure for test ergonomics; call-site turn parameter still wins when provided (default ?? binding pattern)."
    - "context_assemble as pass-through wrapper with finally-ended span — no-op when turn is undefined, preserves untraced behavior exactly."

key-files:
  created: []
  modified:
    - src/manager/session-memory.ts
    - src/manager/session-manager.ts
    - src/manager/session-adapter.ts
    - src/manager/context-assembler.ts

key-decisions:
  - "Phase 50 Plan 02 — Case A context_assemble wiring: grep-verified session-scoped (buildSessionConfig call sites only). No per-turn plumbing in this plan. assembleContextTraced exported for future per-turn callers (Phase 52 cache_control)."
  - "Phase 50 Plan 02 — Caller-owned Turn lifecycle is locked contract; SessionManager + SessionHandle are pure passthrough/emitter, never construct or end Turn objects. 50-02b (bridge + scheduler) owns lifecycle."
  - "Phase 50 Plan 02 — createTracedSessionHandle delegates to wrapSdkQuery with a boundTurn parameter, rather than reimplementing the iteration loop. Zero duplication with production wrapSdkQuery."
  - "Phase 50 Plan 02 — iterateWithTracing lives inside wrapSdkQuery closure (not module-level) so it shares sessionId + usageCallback state with the return value's methods. Moving it out would require threading those refs through function args."
  - "Phase 50 Plan 02 — first_token + end_to_end spans started with explicit metadata `{}` (not omitted). Reason: the Wave 0 test asserts `toHaveBeenCalledWith('first_token', expect.anything())` and expect.anything() does not match absent arg in vitest."

patterns-established:
  - "Pattern: Tracing-safe iteration helper — shared loop consumed by N send variants eliminates divergence risk at compile time."
  - "Pattern: Optional tracing hooks — every span call is prefixed with `turn?.`/`span?.` so no-turn code path is a compile-time no-op with zero runtime cost."
  - "Pattern: Content-block discrimination for SDK stream — cast `msg.message.content` to unknown[] and inspect block.type to bypass the narrowed local SDK type while preserving type safety at the read sites."

requirements-completed: [PERF-01]

# Metrics
duration: 25min
completed: 2026-04-13
---

# Phase 50 Plan 02: SDK-side tracing instrumentation Summary

**Per-agent TraceStore/TraceCollector lifecycle inside AgentMemoryManager, caller-owned Turn threading through SessionManager → SessionHandle, shared iterateWithTracing helper emitting first_token / tool_call.<name> / end_to_end spans in all three send variants, and assembleContextTraced wrapper around ContextAssembler.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-13T17:46:13Z
- **Completed:** 2026-04-13T18:11:07Z
- **Tasks:** 2 (both `auto` + `tdd`, no checkpoints)
- **Files modified:** 4

## Accomplishments

- **Wave 0 → GREEN for SdkSessionAdapter + ContextAssembler tracing:** all 5 session-adapter tests (first_token, tool_call, subagent, end_to_end, sendAndCollect parity) and all 3 context-assembler tests (span lifecycle, finally-ended-on-throw, no-op-when-turn-undefined) now pass.
- **Per-agent traces.db lifecycle delivered:** `AgentMemoryManager.initMemory` constructs `new TraceStore(<workspace>/traces.db)` + `new TraceCollector(store, log.child(...))` immediately after the UsageTracker init (mirrors pattern exactly). `cleanupMemory` closes the store and drops both map entries with the same try/catch shape UsageTracker uses.
- **SessionManager accessors delivered:** `getTraceStore(agentName)` + `getTraceCollector(agentName)` placed adjacent to `getUsageTracker` — the retention heartbeat check (Plan 50-02b) can now resolve `sessionManager.getTraceStore(agent)` without further edits.
- **Caller-owned Turn contract locked in code:** `streamFromAgent(name, message, onChunk, turn?)` and `sendToAgent(name, message, turn?)` thread the Turn to the session handle and return. SessionManager has ZERO `turn?.end(...)` call sites — verified by grep (returns 0 matches).
- **Shared iterateWithTracing helper:** ~100 lines inside `wrapSdkQuery` closure, consumed by all three send variants. Pitfall 2 (stream/collect divergence) resolved BY CONSTRUCTION — the three variants cannot diverge because they share the same body.
- **Subagent filter (Pitfall 6) resolved:** assistant messages with `parent_tool_use_id !== null` do NOT end the parent Turn's first_token span; subagent-emitted text is ignored at the tracing layer. The parent-text path still accumulates from the narrowed-type `msg.content: string` field.
- **Tool-call spans via content blocks:** the loop inspects `msg.message.content[]` (casting to `unknown[]` to bypass the narrowed local SDK type) and opens `tool_call.<name>` spans on each `tool_use` block; spans end on the matching user message with `parent_tool_use_id === tool_use_id`.
- **createTracedSessionHandle factory export:** minimal wrapper around `wrapSdkQuery` that binds a Turn into the handle's closure. Tests use it for ergonomics; production code uses the per-call Turn parameter.
- **assembleContextTraced wrapper:** finally-ended `context_assemble` span with pass-through semantics when `turn === undefined`. Result strictly equal to `assembleContext(sources, budgets)` — verified by the Wave 0 test `expect(result).toBe(assembleContext(sources, DEFAULT_BUDGETS))`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Per-agent TraceStore/TraceCollector lifecycle + SessionManager accessors + optional Turn threading** — `c982d5f` (feat)
   - `src/manager/session-memory.ts` (+16 lines) — TraceStore + TraceCollector maps; init constructs both at `<workspace>/traces.db`; cleanup closes the store.
   - `src/manager/session-manager.ts` (+30 lines) — Turn imports; optional Turn parameters on `sendToAgent` and `streamFromAgent` (caller-owned, no turn.end() call); `getTraceStore` + `getTraceCollector` accessors.
   - Tests: all 208 session-manager tests remain green (no regression).

2. **Task 2: Instrument SdkSessionAdapter + ContextAssembler with tracing spans** — `5904bd4` (feat)
   - `src/manager/session-adapter.ts` (+207 -64 lines delta) — `import type { Turn, Span }` from performance module; `SessionHandle` type extended with optional Turn on all three send signatures; `MockSessionHandle` methods accept (and ignore) the Turn param; `wrapSdkQuery` signature gains optional `boundTurn`; internal `iterateWithTracing` (~100 lines) shared by all three send variants; `createTracedSessionHandle` factory exported.
   - `src/manager/context-assembler.ts` (+26 lines) — `import type { Turn }`; `assembleContextTraced` wrapper with `try { return assembleContext(...) } finally { span?.end() }` shape.
   - Tests: 5 new session-adapter tracing tests GREEN; 3 new context-assembler tracing tests GREEN; 15 prior context-assembler tests still GREEN; 208 session-manager tests still GREEN.

**Plan metadata:** _(see final metadata commit below)_

## Hook-point Call Sites

| Hook point | File | Lines | Notes |
|------------|------|-------|-------|
| `end_to_end` span opened | `src/manager/session-adapter.ts` | 402 | Opens on entry to `iterateWithTracing`; closes on `result` / `throw` via `closeAllSpans()` at 406–413. |
| `first_token` span opened | `src/manager/session-adapter.ts` | 403 | Same entry path; closes on first PARENT text block (line 430–434) OR `closeAllSpans()` on stream exit. |
| `tool_call.<name>` span opened | `src/manager/session-adapter.ts` | 436 | Per tool_use content block; span stored in `activeTools` map keyed by tool_use_id (line 439). |
| `tool_call.<name>` span closed | `src/manager/session-adapter.ts` | 454–458 | On user-message whose `parent_tool_use_id` matches the stored span's key. |
| Subagent filter | `src/manager/session-adapter.ts` | 422–424 | `parent_tool_use_id ?? null === null` gate; everything inside the content-block loop sits under this check. |
| `context_assemble` span opened | `src/manager/context-assembler.ts` | 168 | Opens on entry to `assembleContextTraced`. |
| `context_assemble` span closed | `src/manager/context-assembler.ts` | 171–173 | Finally block; always runs regardless of `assembleContext` throw or return. |

## iterateWithTracing Helper

- **Location:** `src/manager/session-adapter.ts` lines 397–483 (inside `wrapSdkQuery` closure)
- **Size:** ~87 lines (function body ~ 80 non-whitespace)
- **Reason for inside-closure placement:** needs mutable access to `sessionId` (for `msg.session_id` updates on each result) and `usageCallback` (for `extractUsage(msg, usageCallback)`) which live in the closure.
- **Consumed by:** `send` (line 494), `sendAndCollect` (line 506), `sendAndStream` (line 517). Each is a 6-line wrapper delegating to the shared helper with a different onAssistantText callback (`null` for send/sendAndCollect, `onChunk` for sendAndStream).

## context_assemble Wiring Resolution — Case A (session-scoped)

**Decision:** `assembleContext` is session-scoped. `assembleContextTraced` exported but NOT wired into any call site.

**Evidence (grep-upfront per plan):**

```
src/manager/session-config.ts:11:import { assembleContext, DEFAULT_BUDGETS } from "./context-assembler.js";
src/manager/session-config.ts:213:  const systemPrompt = assembleContext(sources, budgets);
```

`buildSessionConfig` (src/manager/session-config.ts) is invoked from exactly 3 places:

1. `src/manager/session-manager.ts:107` — `startAgent` (agent-start-time, not per-message)
2. `src/manager/session-manager.ts:273` — `reconcileRegistry` (session-resume-on-restart, not per-message)
3. `src/cli/commands/run.ts:80` — `run` CLI (one-shot CLI command invocation)

None are per-turn. No Turn is in scope at these call sites (Turns are created per Discord message / scheduler tick by `TraceCollector.startTurn` in 50-02b). Threading a Turn down into `buildSessionConfig` would require extending its signature + 3 call sites for zero runtime signal — the span would fire exactly once per agent startup.

**Consequence for downstream plans (50-03):** the `context_assemble` segment row in `clawcode latency <agent>` / `/api/agents/:name/latency` will show `count=0` until a per-turn context-assembly path is introduced (e.g., Phase 52 cache_control work). The existing `formatLatencyTable` / `getPercentiles` infrastructure already handles `count=0` gracefully (null percentiles render as `—`), so no downstream code changes are needed.

The `assembleContextTraced` wrapper is exported so that any future per-turn caller can opt-in with a single-line swap without re-plumbing the signature.

## Turn Ownership Contract — Verified

| Contract | Verification |
|----------|--------------|
| SessionManager never calls `turn.end()` | `grep 'turn\?\.end(' src/manager/session-manager.ts` — **0 matches** |
| SessionHandle never calls `turn.end()` | `grep 'turn\?\.end(' src/manager/session-adapter.ts` — **0 matches** |
| Turn parameter is `Turn` object (not turnId string) in SessionManager | `streamFromAgent(...turn?: Turn)` + `sendToAgent(...turn?: Turn)` both typed with `Turn` from `../performance/trace-collector.js` |
| Caller-owned lifecycle documented in code comments | Both `sendToAgent` and `streamFromAgent` carry "NOTE: SessionManager does NOT call turn.end() — caller owns Turn lifecycle (50-02b)" |

The caller (Plan 50-02b DiscordBridge / Scheduler) is the sole owner of `turn.end()` calls; SessionManager and SessionHandle open and close only their own spans.

## Test Counts

| Test File | Count (post-plan) | Status | Notes |
|-----------|-------------------|--------|-------|
| `src/manager/__tests__/session-adapter.test.ts` | 5 | 5/5 GREEN | All Wave 0 tracing tests now pass |
| `src/manager/__tests__/context-assembler.test.ts` | 18 | 18/18 GREEN | 15 pre-existing + 3 new tracing tests |
| `src/manager/__tests__/session-manager.test.ts` | 208 | 208/208 GREEN | No regression from Task 1 changes |
| `src/manager + src/performance` combined (full in-scope) | ~1230 | All GREEN | No regressions from either task |

**Expected-still-RED Wave 0 tests (out of scope for Plan 50-02):**

- `src/discord/__tests__/bridge.test.ts` — 3 failures (Plan 50-02b: DiscordBridge.handleMessage receive-span + end_to_end wiring)
- `src/scheduler/__tests__/scheduler.test.ts` — 4 failures in the appended "scheduler tracing" block (Plan 50-02b: `scheduler:<id>` turnId prefix)
- `src/dashboard/__tests__/server.test.ts` — 4 failures in the appended "latency endpoint" block (Plan 50-03)
- `src/cli/commands/__tests__/latency.test.ts` — 0 tests (import of Plan 50-03 exports fails — expected)
- `src/heartbeat/checks/__tests__/trace-retention.test.ts` — 0 tests (same — Plan 50-03)

These failures exist because those tests reference exports that are scaffolded to be added by later plans. Identical list to the one Plan 50-01 SUMMARY already flagged.

**Pre-existing unrelated failures (not introduced by this plan):**

- `src/ipc/__tests__/protocol.test.ts` — `IPC_METHODS` includes `agent-create` which the test's expected array does not contain. Unrelated to tracing.
- `src/mcp/server.test.ts` — `TOOL_DEFINITIONS.length` assertion mismatch. Unrelated to tracing.
- `.claude/worktrees/agent-*/src/...` — stale parallel worktree copies of test files. Same caveat as Plan 50-01 SUMMARY.

## Decisions Made

- **Bound-Turn factory over separate SessionHandle implementation.** `createTracedSessionHandle` delegates to `wrapSdkQuery` with a new `boundTurn` parameter rather than reimplementing the entire iteration loop. This keeps the tracing logic in exactly one place (the shared `iterateWithTracing` helper inside `wrapSdkQuery`) — no duplication between the factory and production. The factory is ~6 lines; the binding is `turn ?? boundTurn` at each per-call site.
- **`first_token` + `end_to_end` started with explicit `{}` metadata.** The Wave 0 test asserts `expect(turn.startSpan).toHaveBeenCalledWith("first_token", expect.anything())`; `expect.anything()` fails on `undefined`. Passing an empty object satisfies the assertion without adding noise. The metadata-less form was kept for `context_assemble` because the ContextAssembler test asserts `toHaveBeenCalledWith("context_assemble")` (no second arg — vitest strict match).
- **Content-block cast via `unknown[]`.** The local `SdkAssistantMessage` type declares `message?: unknown` so content-block discrimination requires an explicit cast: `(msg as { message?: { content?: unknown[] } }).message?.content ?? []`. Individual blocks are read as `{ type?: string; name?: string; id?: string }` which is the minimal surface needed for text / tool_use branching. This mirrors the RESEARCH guidance to NOT replace the narrowed local type (which would cascade into other SessionAdapter surfaces out of Phase 50 scope).
- **iterateWithTracing kept inside the closure.** Alternative was to lift it to a module-level helper and pass `sessionId` / `usageCallback` refs via a small state object. The closure approach is fewer lines, keeps the state encapsulated, and matches the existing `wrapSdkQuery` factory pattern (already has other helpers like `turnOptions` and `notifyError` inside the closure).
- **`context_assemble` wiring Case A locked.** See dedicated section above. Future per-turn work will use the exported wrapper without revisiting this plan.

## Deviations from Plan

None — plan executed exactly as written. One minor TDD GREEN-phase adjustment was required, not a deviation:

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pass explicit metadata `{}` to `startSpan("first_token" | "end_to_end")` so vitest `expect.anything()` matcher is satisfied**
- **Found during:** Task 2 initial TDD GREEN run (1 of 5 session-adapter tests failed on first pass)
- **Issue:** `expect(turn.startSpan).toHaveBeenCalledWith("first_token", expect.anything())` failed because `expect.anything()` does not match absent/undefined argument in vitest — calling `startSpan("first_token")` with ONLY the name produces a 1-arg call, not a 2-arg call-with-anything.
- **Fix:** Updated both lines to `turn?.startSpan("first_token", {})` and `turn?.startSpan("end_to_end", {})` (retaining the default-empty-object semantics from `Turn.startSpan(name, metadata: Record<string, unknown> = {})`).
- **Files modified:** `src/manager/session-adapter.ts`
- **Verification:** All 5 session-adapter tracing tests now pass. `toHaveBeenCalledWith("first_token", expect.anything())` matches the 2-arg call.
- **Committed in:** `5904bd4` (Task 2 commit — fix rolled into initial implementation).

---

**Total deviations:** 1 auto-fixed (1 bug during TDD GREEN phase; zero scope creep).
**Impact on plan:** No scope creep. Wave 0 test expectation was literally that `startSpan` receives 2 args — the fix just makes the implementation match that explicit contract. Every `turn?.startSpan(...)` call now passes a metadata object (empty for spans that carry no payload, populated for `tool_call.<name>` with `{ tool_use_id }`).

## Issues Encountered

- **Full-suite vitest run picks up `.claude/worktrees/agent-*/` copies** (same caveat as Plan 50-01 SUMMARY). Running `npx vitest run src/` picks up duplicates in stale parallel worktrees; the failing counts there are irrelevant to this plan. In-scope verification was performed with targeted file paths.
- **Pre-existing failures in `src/mcp/server.test.ts` and `src/ipc/__tests__/protocol.test.ts`** predate this plan. Confirmed by `git stash && npx vitest run src/mcp/server.test.ts src/ipc/__tests__/protocol.test.ts` showing both failing prior to my changes.

## User Setup Required

None — no external service configuration required. New code is library-level and consumed only by tests in this plan; the production wiring that creates Turn objects (DiscordBridge, Scheduler) ships in Plan 50-02b.

## Next Phase Readiness

- **Plan 50-02b can begin** (DiscordBridge + Scheduler wiring + retention heartbeat check). All the passthrough primitives are in place: `sessionManager.getTraceStore(agent)`, `sessionManager.getTraceCollector(agent)`, `streamFromAgent(..., turn?)`, `sendToAgent(..., turn?)`. The bridge can now do `const turn = sessionManager.getTraceCollector(name)?.startTurn(message.id, name, message.channelId)` and pass `turn` through the session call — tracing will activate automatically at the session-adapter layer.
- **Plan 50-03 can begin** (CLI + dashboard + heartbeat retention surfaces). All three targeted hook points (first_token, tool_call.<name>, end_to_end) are emitting spans to the TraceStore the moment 50-02b wires the Turn. Percentile SQL from 50-01 can aggregate them immediately.
- **No blockers identified.** The caller-owned Turn contract is locked and verified by zero-match greps; 50-02b implementers cannot accidentally shift the ownership line.

## Self-Check: PASSED

All four modified files carry the expected changes:

- `src/manager/session-memory.ts` — FOUND: `traceStores: Map`, `traceCollectors: Map`, `new TraceStore`, `new TraceCollector`, `traces.db`, `traceStore.close`.
- `src/manager/session-manager.ts` — FOUND: `getTraceStore`, `getTraceCollector`, `sendToAgent(...turn?: Turn)`, `streamFromAgent(...turn?: Turn)`, `handle.sendAndStream(...turn)`, `handle.sendAndCollect(...turn)`. NOT PRESENT: any `turn?.end(` call.
- `src/manager/session-adapter.ts` — FOUND: `import type { Turn, Span }`, `turn?: Turn` (8 occurrences on signatures), `iterateWithTracing` (6 occurrences), `turn?.startSpan("end_to_end"`, `turn?.startSpan("first_token"`, `` `tool_call.${block.name}` ``, `parent_tool_use_id` (4 occurrences), `firstTokenEnded`, `activeTools`, `createTracedSessionHandle`. NOT PRESENT: any `turn?.end(` call.
- `src/manager/context-assembler.ts` — FOUND: `assembleContextTraced`, `"context_assemble"`, `span?.end()`.

Both task commits exist in `git log --oneline`:

- `c982d5f` (Task 1) — FOUND.
- `5904bd4` (Task 2) — FOUND.

All Wave 0 target tests GREEN:

- `src/manager/__tests__/session-adapter.test.ts` — 5/5 GREEN.
- `src/manager/__tests__/context-assembler.test.ts` — 18/18 GREEN (15 prior + 3 new).
- `src/manager/__tests__/session-manager.test.ts` — 208/208 GREEN (no regression).

Context_assemble Case-A resolution grep-verified and recorded inline above.

---
*Phase: 50-latency-instrumentation*
*Plan: 02*
*Completed: 2026-04-13*
