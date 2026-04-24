# Phase 90 Deferred Items

Out-of-scope issues discovered during plan execution. Do NOT fix in-plan — belongs to a future phase.

## Plan 90-03

### Pre-existing test failures (not introduced by MEM-04/05/06)

**1. `src/manager/__tests__/bootstrap-integration.test.ts` — 2/4 tests fail**
- `buildSessionConfig with bootstrapStatus complete returns normal prompt`
- `buildSessionConfig with bootstrapStatus undefined returns normal prompt (backward compat)`
- Root cause: fixture `config.memoryPath` is undefined → `join(config.memoryPath, "memory")` throws at `src/manager/session-config.ts:409`
- Verified pre-existing: `git stash && npx vitest run ... && git stash pop` confirms same failure on master before my commits
- Not my concern — test fixtures need memoryPath populated; orthogonal to Phase 90-03's memory flush / cue / subagent work

**2. `src/manager/__tests__/daemon-openai.test.ts` — 7/10 tests fail**
- Pre-existing failures; no relation to Phase 90-03
- Likely introduced by a different parallel phase (90-05 plugins-browse or similar daemon work)

## Plan 90-03 executor — not fixing

Both failures are outside the MEM-04/05/06 blast radius. Fixing them would require touching `session-config.ts` (bootstrap) or `daemon-openai.test.ts` mock wiring, neither of which is in the plan's files_modified manifest. A future plan (or a quick-fix ticket) should address them.
