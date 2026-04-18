# Deferred Items — Phase 66

Out-of-scope issues discovered during Phase 66 execution. These are NOT caused by the plan's changes and are logged per the scope-boundary rule.

## Pre-existing TypeScript errors (NOT touched by Phase 66)

Discovered during Phase 66-01 Task 1 verification (`npx tsc --noEmit`). None are in `src/memory/types.ts` or `src/memory/store.ts` (the files modified by this plan). All are in unrelated files:

- `src/cli/commands/__tests__/latency.test.ts` — 3 implicit any errors (lines 150, 166, 179)
- `src/cli/commands/__tests__/tasks.test.ts` — 3 implicit any errors (lines 57, 84, 97)
- `src/manager/__tests__/agent-provisioner.test.ts:34` — string|undefined assignability
- `src/manager/__tests__/memory-lookup-handler.test.ts:22` — `limit` property missing from test type
- `src/manager/daemon.ts:616` — `handler` property missing
- `src/manager/daemon.ts:2311` — `CostByAgentModel` input_tokens/output_tokens mismatch
- `src/manager/session-adapter.ts:737` — role comparison overlap
- `src/memory/__tests__/graph.test.ts:338` — `recencyWeight` not in `ScoringConfig`
- `src/tasks/task-manager.ts` — 4 missing `causationId` property errors (lines 239, 328, 367, 485)
- `src/triggers/__tests__/engine.test.ts` — Mock type assignability errors (lines 66-67)
- `src/usage/__tests__/daily-summary.test.ts` — 4 empty-tuple index errors (lines 209, 288, 313)
- `src/usage/budget.ts:138` — status comparison overlap

These were pre-existing before Phase 66 started (last touched in v1.8 work). Should be addressed in a dedicated tech-debt phase.
