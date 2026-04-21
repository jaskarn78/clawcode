# Phase 81 — Deferred Items

Items discovered during Phase 81 execution that are out-of-scope (pre-existing
or unrelated to Phase 81's verify/rollback/resume/fork work).

## Pre-existing test failures (not caused by Phase 81)

Verified via `git stash` + re-run against HEAD without Phase 81 changes;
all 9 failures reproduce without any Phase 81 files in play.

- **`src/manager/__tests__/bootstrap-integration.test.ts`** — 2 failures
  (buildSessionConfig with bootstrapStatus complete / undefined returns normal
  prompt). Pre-existing regression likely from earlier Phase 67+ work.

- **`src/manager/__tests__/daemon-openai.test.ts`** — 6 failures around
  startOpenAiEndpoint port/host env handling + shutdown ordering + apiKeysStore
  exposure. Pre-existing; likely from Phase 74/75 daemon refactors.

- **`src/manager/__tests__/session-manager.test.ts`** — 1 failure (configDeps
  passes conversationStores and memoryStores). Pre-existing Phase 67 gap-closure
  test.

None of these files are referenced by Phase 81 modules (verifier.ts /
rollbacker.ts / yaml-writer.ts extension). Plan 02 CLI integration may need to
audit if any of these relate to `clawcode migrate openclaw` sub-command wiring.

## Pre-existing tsc errors (not caused by Phase 81)

Reproduced via `npx tsc --noEmit` without Phase 81 changes:

- `src/triggers/__tests__/engine.test.ts:67` — Mock type assignment issue.
- `src/usage/__tests__/daily-summary.test.ts:209,288,313` — Tuple of length 0
  indexed at 0/1 (stale test fixtures against tightened types).
- `src/usage/budget.ts:138` — `"warning" | null` compared to `"exceeded"`
  (intent inversion — type narrowing drift from earlier Phase 74 usage work).

Zero tsc errors in Phase 81 files (verifier.ts, rollbacker.ts,
yaml-writer.ts, __tests__/verifier.test.ts, __tests__/rollbacker.test.ts,
__tests__/yaml-writer.test.ts).

## Plan 03 audit (2026-04-21)

Re-verified the pre-existing failures set against the full suite post-Plan-03:

- Both Plan 03 test files (fork-migrated-agent.test.ts, fork-cost-visibility.test.ts)
  pass 43/43 in isolation. Zero tsc errors in either file.
- Full suite: 3654 passed / 11 failed — same failure files as above plus 2
  adjacent Phase 80/81 CLI integration tests (`src/cli/__tests__/migrate-openclaw.test.ts`
  Test 1 for translateAgentMemories wiring; `src/cli/commands/__tests__/migrate-openclaw.test.ts`
  MIGR-03 integration). Neither references fork.ts / tracker.ts / costs.ts / the
  two new Plan 03 files — pre-existing drift from Phase 80/81 Plan 02 work.
  Out of scope for Plan 03 per SCOPE BOUNDARY rule (regression-only plan).

