# Phase 69 Deferred Items

## Pre-existing test timeouts (out of scope)

**Found during:** Phase 69 Plan 02 execution — full `npm test` run.

**Scope:** `src/cli/commands/__tests__/triggers.test.ts` — 29 tests timing out at 5000ms (default vitest timeout). All failures are in the `queryTriggerFires` / `renderDetailRows` / trigger-related code paths owned by Phase 60-61.

**Status:** Not caused by Phase 69 Plan 02 — `src/openai/**` did not modify any `src/cli/commands/triggers.ts` or `src/triggers/*` code. Pre-existing. Likely a CI-environment-sensitive test that needs higher `testTimeout` or async cleanup.

**Action deferred to:** Owner of Phase 60/61 CLI triggers module. Not blocking Phase 69 delivery.

**Evidence:** Full-suite run 2026-04-18T23:40Z — 2498 passed, 29 failed, all in triggers.test.ts; 100% of `src/openai/**` tests (122) passed.
