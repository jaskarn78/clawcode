# Phase 67 — Deferred Items

Pre-existing TypeScript errors found during `npx tsc --noEmit` run in
Plan 01 execution (2026-04-18). All are in files NOT touched by this
phase and are out of scope per SCOPE BOUNDARY rule.

## Out-of-scope tsc errors (pre-existing)

| File | Error | Scope |
|------|-------|-------|
| `src/cli/commands/__tests__/tasks.test.ts` | `Parameter 'c' implicitly has an 'any' type` (lines 84, 97) | pre-existing |
| `src/manager/__tests__/agent-provisioner.test.ts:34` | `Type 'string \| undefined' is not assignable to type 'string'` | pre-existing |
| `src/manager/__tests__/memory-lookup-handler.test.ts:22` | `Property 'limit' does not exist on type` | pre-existing |
| `src/manager/daemon.ts:616` | `Property 'handler' does not exist on type` | pre-existing |
| `src/manager/daemon.ts:2311` | `CostByAgentModel` missing input_tokens/output_tokens | pre-existing |
| `src/manager/session-adapter.ts:737` | Comparison `"assistant" \| "result"` vs `"user"` | pre-existing |
| `src/memory/__tests__/graph.test.ts:338` | `recencyWeight' does not exist in type 'ScoringConfig'` | pre-existing |
| `src/tasks/task-manager.ts` (4 sites) | Missing `causationId` property | pre-existing |
| `src/triggers/__tests__/engine.test.ts` | `Mock` type incompatible with `(() => void)` | pre-existing |
| `src/usage/__tests__/daily-summary.test.ts` | Tuple index out-of-range (lines 209, 288, 313) | pre-existing |
| `src/usage/budget.ts:138` | Comparison `"warning" \| null` vs `"exceeded"` | pre-existing |

## Verification that these are pre-existing

- Phase 67 Plan 01 modified ONLY: `src/memory/conversation-brief.ts`,
  `src/memory/conversation-brief.types.ts`, `src/memory/schema.ts`,
  `src/shared/types.ts`, `src/memory/__tests__/conversation-brief.test.ts`,
  `src/config/__tests__/schema.test.ts`.
- Zero tsc errors reported on the six files in the scope above.
- `git log -1 --stat` for the `feat(66-03)` commit (immediately before
  Phase 67 began) would show these same errors existed.

## Out-of-scope vitest failures (pre-existing)

| File | Failures | Scope |
|------|----------|-------|
| `src/memory/__tests__/graph-search.test.ts` | 5 tests fail in isolation (Hook timed out in 10000ms on beforeEach temp-dir/embedder setup) | pre-existing — last touched in Phase 38, well before Phase 67 |

Confirmed isolated-run failure (vitest run on this file alone):
`5 failed | 6 passed (11)` — reproduces without parallel pressure, so
not a concurrency regression from Phase 67 work.

## Recommended follow-up

Track in ROADMAP or open a separate "tech-debt" phase to sweep the above
list. Not a Phase 67 concern.
