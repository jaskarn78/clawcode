# Phase 75 Deferred Items

Pre-existing tsc errors discovered during Plan 01 execution (2026-04-20).
All are out-of-scope for Plan 01 (memoryPath field + conflict guard + hot-reload classification).

## Pre-existing tsc --noEmit errors (29 total, unrelated to memoryPath)

| File | Count | Nature |
|------|-------|--------|
| src/usage/__tests__/daily-summary.test.ts | 4 | Empty-tuple index access (TS2493) |
| src/tasks/task-manager.ts | 4 | Missing `causationId` property (TS2741) |
| src/manager/daemon.ts | 3 | ImageProvider import + schedule.handler + CostByAgentModel shape (TS2305/TS2339/TS2345) |
| src/image/daemon-handler.ts | 3 | (not inspected) |
| src/cli/commands/__tests__/tasks.test.ts | 3 | (not inspected) |
| src/cli/commands/__tests__/latency.test.ts | 3 | (not inspected) |
| src/triggers/__tests__/engine.test.ts | 2 | Mock type mismatch (TS2322) |
| src/manager/__tests__/memory-lookup-handler.test.ts | 2 | (not inspected) |
| src/usage/budget.ts | 1 | BudgetStatus comparison (TS2367) |
| src/memory/__tests__/graph.test.ts | 1 | Missing recencyWeight (TS2353) |
| src/manager/session-adapter.ts | 1 | Message role comparison (TS2367) |
| src/manager/__tests__/agent-provisioner.test.ts | 1 | (not inspected) |
| src/ipc/__tests__/image-tool-call.test.ts | 1 | (not inspected) |

## Plan 01 boundary

Plan 01 introduced zero new tsc errors. The ResolvedAgentConfig.memoryPath
addition required fixture updates in 13 test files (all completed), which
left the baseline error count unchanged (confirmed: 29 errors remain on
both pre- and post-Plan-01 trees, excluding the 2 errors my test fixture
updates happened to resolve as a side effect of spreading literals with
complete property sets).

These errors should be tracked in a separate tech-debt phase, not in
Phase 75.
