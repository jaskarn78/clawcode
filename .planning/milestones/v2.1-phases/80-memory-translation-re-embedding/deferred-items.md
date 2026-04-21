# Deferred Items — Phase 80 Memory Translation + Re-embedding

Discoveries outside the scope of the current plan's tasks. Logged per SCOPE BOUNDARY rule.

## Pre-existing TypeScript errors (observed during 80-01)

The following `npx tsc --noEmit` errors predate this plan and are in files untouched by Phase 80:

- `src/memory/__tests__/graph.test.ts:338` — `ScoringConfig` type doesn't have `recencyWeight`
- `src/tasks/task-manager.ts:239,328,367,485` — `causationId` property missing from 4 call sites
- `src/triggers/__tests__/engine.test.ts:66,67` — Mock signature mismatch
- `src/usage/__tests__/daily-summary.test.ts:209,288,313` — Tuple length-0 element access
- `src/usage/budget.ts:138` — Unreachable comparison between `"warning" | null` and `"exceeded"`

These do not affect Phase 80 modules (`src/memory/store.ts`, `src/memory/types.ts`, `src/memory/__tests__/store.test.ts` all compile clean). They are noted for a future TS cleanup quick task.

## Pre-existing test failures (observed during 80-01)

Full project `npx vitest run` shows 10 failures in 6 files unrelated to Phase 80:

- `src/manager/__tests__/bootstrap-integration.test.ts` — 2 failures
- `src/manager/__tests__/daemon-openai.test.ts` — 7 failures
- `src/manager/__tests__/session-manager.test.ts` — 1 failure (configDeps wiring, Phase 67)
- `src/config/__tests__/shared-workspace.integration.test.ts` — 1 failure (Phase 75, pairwise isolation)
- `src/cli/commands/__tests__/triggers.test.ts` — 3 failures
- `src/cli/commands/__tests__/trace.test.ts` — 1 failure

Verified pre-existing by running the same tests on a stashed (pre-Plan-80-01) tree — failures reproduce 1:1. Memory suite (`src/memory/__tests__/`) is 381/381 green.
