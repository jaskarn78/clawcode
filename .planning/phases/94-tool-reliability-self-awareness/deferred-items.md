# Phase 94 Deferred Items

## Pre-existing test failure: src/ipc/__tests__/protocol.test.ts

**Discovered during:** Plan 94-01 execution (Task 2 verification sweep)

**Status:** Pre-existing — not caused by this plan. Verified by `git stash` baseline run before any plan changes.

**Issue:** The `IPC_METHODS` exact-array equality test in `src/ipc/__tests__/protocol.test.ts` is missing the four `cutover-*` IPC methods (`cutover-verify-summary`, `cutover-button-action`, `cutover-verify`, `cutover-rollback`) that landed in Phase 92 / Plan 92-04 + 92-06 inside `src/ipc/protocol.ts` but were never added to the test fixture array.

**Plan 94-01 contribution:** Added `mcp-probe` entry to BOTH protocol.ts AND the test fixture array — net-zero new failure surface from this plan.

**Suggested fix (out of scope for 94-01):** Add the 4 cutover-* entries to the IPC_METHODS test fixture in protocol.test.ts, plus consider switching the test from exact-array equality to a subset/contains assertion to prevent recurrence whenever new IPC methods land.

## Pre-existing manager test failures (12 tests across 4 files)

**Discovered during:** Plan 94-04 execution (Task 2 full-sweep verification — `npx vitest run src/manager/__tests__/`)

**Status:** Pre-existing — not caused by this plan. Verified by `git stash` baseline run with my changes stashed; same 11/12 failures reproduced.

**Failing files + counts:**
1. `src/manager/__tests__/bootstrap-integration.test.ts` — 2 failures (`config.memoryPath` undefined → `join()` throws). Build wiring drift in `session-config.ts:409`.
2. `src/manager/__tests__/daemon-openai.test.ts` — 6 failures (handle shape from `startOpenAiEndpoint` no longer carries `enabled`/`port`/`host`/`apiKeysStore`). Public surface drift in the OpenAI endpoint factory.
3. `src/manager/__tests__/daemon-warmup-probe.test.ts` — 1 failure (3 `EmbeddingService` constructions in src/, allowed cap is 2). Static-grep regression — a new entrypoint was added without updating the ALLOWED set.
4. `src/manager/__tests__/restart-greeting.test.ts` — 2 failures (P8 dormancy threshold + P12 empty-state guard skip predicates not firing). Skip-classifier drift since Phase 89 ship.

**Plan 94-04 contribution:** Net-zero new failure surface. The 33 new tests added by 94-04 (tool-call-error.test.ts + find-alternative-agents.test.ts + turn-dispatcher-tool-error.test.ts) all pass. The TurnDispatcher tests (`turn-dispatcher.test.ts` + `turn-dispatcher-skill-effort.test.ts`) all pass after my edits — no regressions.

**Suggested fix (out of scope for 94-04):** A small dedicated cleanup phase to chase down the 4 separate root causes — bootstrap memoryPath wiring, OpenAI handle shape regression, EmbeddingService cap, and restart-greeting skip-classifier — each is independent.
