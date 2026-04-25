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

## Plan 94-02 verification (full-suite sweep)

**Discovered during:** Plan 94-02 execution (Task 2 full-suite sweep — `npx vitest run --reporter=dot`).

**Status:** Net-zero new failure surface. Pre-existing failure count baseline = 27 (verified via `git stash` before changes); after-change count = 28 in one full-suite run, but 1 of those is `MEM-01-C2: 50KB cap` test timeout — same timeout reproduces unmodified on stash baseline (flaky pre-existing). All Plan 94-02 modifications and new tests pass: 59/59 in session-config + session-config-mcp, 13/13 in filter-tools-by-capability-probe (9 FT-* + 4 regression pins). Build clean.

**Plan 94-02 contribution:** 1 new pure module (`filter-tools-by-capability-probe.ts`), 13 new tests, single-source-of-truth filter wired at `session-config.ts` MCP-block assembly, getFlapHistory accessor added to SessionHandle (mirrored on PersistentSessionHandle + per-turn-query legacy + 3 mock test helpers).

## Plan 94-03 verification (full-suite sweep)

**Discovered during:** Plan 94-03 execution (Task 2 full-suite sweep — `npx vitest run --reporter=dot --exclude="**/e2e/**"`).

**Status:** Net-zero new failure surface. Full-suite count: 27 failed / 4886 passed across 11 failing files. Re-running the same 10 failing test files with my changes stashed (`git stash push -u && npx vitest run <files>`) reproduced the identical 27 failures — every failure is pre-existing.

**Pre-existing failures by file (verified via `git stash` baseline):**
- `src/ipc/__tests__/protocol.test.ts` — 1 failure (4 cutover-* methods missing from fixture; 94-01 deferred item, recurring)
- `src/discord/__tests__/slash-types.test.ts` — 2 failures (CONTROL_COMMANDS exact-count drift)
- `src/discord/__tests__/slash-commands.test.ts` — 1 failure (CONTROL_COMMANDS total drift)
- `src/manager/__tests__/bootstrap-integration.test.ts` — 2 failures (94-04 deferred — `memoryPath` undefined)
- `src/manager/__tests__/daemon-openai.test.ts` — 6 failures (94-04 deferred — handle shape drift)
- `src/manager/__tests__/daemon-warmup-probe.test.ts` — 1 failure (94-04 deferred — EmbeddingService cap)
- `src/manager/__tests__/restart-greeting.test.ts` — 2 failures (94-04 deferred — skip-classifier drift)
- `src/migration/__tests__/verifier.test.ts` — 8 failures (workspace-files-present test fixture missing MEMORY.md)
- `src/migration/__tests__/memory-translator.test.ts` — 2 failures (static-grep regression on better-sqlite3 imports)
- `src/migration/__tests__/config-mapper.test.ts` — 4 failures (mcp auto-injection test drift)

**Plan 94-03 contribution:** 5 new modules (`recovery/types.ts`, `recovery/registry.ts`, `recovery/playwright-chromium.ts`, `recovery/op-refresh.ts`, `recovery/subprocess-restart.ts`), 20 new tests across 4 test files, heartbeat integration in `mcp-reconnect.ts` with 2 new tests, `getRecoveryAttemptHistory()` accessor on SessionHandle (mirrored on PersistentSessionHandle + MockSessionHandle + per-turn-query legacy). All 22 new tests pass. Build clean. Zero new npm deps. DI-purity invariant pinned (handlers + registry free of `node:child_process` imports — production wires real impls at the heartbeat edge).
