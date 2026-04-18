# Deferred Items — 260418-sux

Pre-existing TypeScript errors discovered during execution but out-of-scope per the SCOPE BOUNDARY rule. These are NOT caused by this quick task's changes.

## Pre-existing `tsc --noEmit` errors (as of 2026-04-18)

- `src/memory/__tests__/graph.test.ts:338` — `recencyWeight` does not exist in `ScoringConfig`.
- `src/tasks/task-manager.ts:239, 328, 367, 485` — `causationId` missing in TurnContext construction (4 sites).
- `src/triggers/__tests__/engine.test.ts:66, 67` — vitest Mock type incompatibility.
- `src/usage/__tests__/daily-summary.test.ts:209, 288, 313` — tuple index errors (`[]` tuple length 0).
- `src/usage/budget.ts:138` — comparison between `"warning" | null` and `"exceeded"` has no overlap.
- `src/manager/daemon.ts` (pre-existing, confirmed via `git stash` baseline):
  - schedule config `handler` property not in type (scheduler config schema drift).
  - `CostByAgentModel` not assignable to usage-summary param type.

These errors existed before Task 1 and persist after Task 3 (confirmed: our diff touches `src/mcp/server.ts`, `src/manager/registry.ts`, `src/manager/__tests__/registry.test.ts`, `src/manager/daemon.ts` only). File them in a follow-up cleanup task.
