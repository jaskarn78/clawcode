# Deferred items — Phase 56

Pre-existing tsc errors discovered during Plan 56-01 execution. All are in files NOT touched by this plan. Per execute-phase SCOPE BOUNDARY, these are NOT auto-fixed in this plan.

## tsc errors (pre-existing, out of scope for 56-01)

- `src/cli/commands/__tests__/latency.test.ts` (150, 166, 179) — implicit any
- `src/manager/__tests__/agent-provisioner.test.ts:34` — string | undefined
- `src/manager/__tests__/memory-lookup-handler.test.ts:22` — missing `limit` on test input type
- `src/manager/daemon.ts:1942` — CostByAgentModel shape mismatch
- `src/manager/session-adapter.ts:668` — dead-branch comparison
- `src/memory/__tests__/graph.test.ts:338` — unknown `recencyWeight` in ScoringConfig
- `src/usage/__tests__/daily-summary.test.ts:209, 288, 313` — tuple index access on empty array
- `src/usage/budget.ts:138` — dead-branch comparison

None of these relate to warm-path-check, session-memory, registry, daemon embedder probe, or the tests added in this plan. Suggested follow-up: `/gsd:quick` run to clean up pre-existing test-only typing errors.
