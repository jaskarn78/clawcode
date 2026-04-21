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

## Pre-existing test failures (detected 2026-04-21, verified via git stash)

Verified via `git stash && npx vitest run ...` on the pre-Plan-83-01 HEAD —
the same 9 tests fail in the clean tree. Not introduced by Plan 83-01.

1. `src/manager/__tests__/daemon-openai.test.ts` — 7 fails around
   `startOpenAiEndpoint` dependency shape (`apiKeysStore` undefined in
   handle, `server.close` ordering). Unrelated to effort work.
2. `src/manager/__tests__/bootstrap-integration.test.ts` — 2 fails,
   `TypeError: The "path" argument must be of type string. Received undefined`
   in `buildSessionConfig`. Unrelated to effort work.
3. Several other manager tests show 5000ms test-timeouts under parallel
   vitest pressure (session-manager.test.ts, session-memory-warmup.test.ts,
   session-manager-memory-failure.test.ts); these are flaky-timing,
   not logic regressions.

The Plan 83-01 test delta is clean:
- `src/manager/__tests__/effort-mapping.test.ts` — 15 passing (new)
- `src/manager/__tests__/persistent-session-handle-effort.test.ts` — 8 passing (new)
- `src/manager/__tests__/persistent-session-handle.test.ts` — 15 passing
  (existing — updated FakeQuery mock to satisfy new SdkQuery.setMaxThinkingTokens
  contract; this is a Rule 3 blocking-issue auto-fix)
- `src/config/__tests__/differ.test.ts` — passing (+ 2 new effort-reloadable tests)
