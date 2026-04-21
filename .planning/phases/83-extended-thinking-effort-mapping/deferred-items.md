# Deferred Items — Phase 83 Plan 01

Items discovered during execution that are **out of scope** for the current task
(not caused by 83-01 changes) and therefore not fixed.

## Pre-existing TypeScript errors (detected 2026-04-21)

Not caused by Phase 83 Plan 01 changes — these exist in files unrelated to
effort schema / handle / mapping work:

1. `src/triggers/__tests__/engine.test.ts:67` — TS2322 Mock type mismatch
   (unrelated to effort work)
2. `src/usage/__tests__/daily-summary.test.ts:209,288,313` — TS2493 tuple-type
   index errors (unrelated)
3. `src/usage/budget.ts:138` — TS2367 comparison-overlap error (unrelated)

All P83-01 touched files (`src/config/schema.ts`, `src/config/types.ts`,
`src/manager/effort-mapping.ts`, `src/manager/persistent-session-handle.ts`,
`src/manager/sdk-types.ts`, `src/manager/session-manager.ts`,
`src/manager/session-adapter.ts`, `src/discord/slash-commands.ts`,
`src/manager/daemon.ts`) type-check cleanly.
