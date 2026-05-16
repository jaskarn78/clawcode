# Phase 117 — Deferred Items

Items discovered during execution but out of scope for the current plan.
Logged here per the GSD execution scope rule: only auto-fix issues
DIRECTLY caused by the current task's changes; everything else gets
deferred rather than fixed during the plan run.

---

## Plan 117-11 (operator /verbose toggle)

### Pre-existing test-count drift in slash-types/slash-commands tests

**Files:**
- `src/discord/__tests__/slash-types.test.ts` (CONTROL_COMMANDS length expectation)
- `src/discord/__tests__/slash-commands.test.ts` (DEFAULT + CONTROL sum expectation)

**Observed pre-117-11 (verified via `git stash` 2026-05-13):**
- Pre-117-11 runtime `CONTROL_COMMANDS.length` was **10** (not 12 as the
  historical comment chain in slash-types.test.ts:154-162 claims).
- Pre-117-11 sum `DEFAULT_SLASH_COMMANDS.length + CONTROL_COMMANDS.length`
  was **23** (not 25 — slash-commands.test.ts:487 was already failing).

**Root cause:** the historical comment chain accumulated phase notes
(95-03 dream → 11; 96-05 probe-fs → 12; 103-03 usage → 13; 999.32 removed
probe-fs → 12) but the count never actually decremented from 13 to 12
after the 999.32 removal. Off-by-one propagated.

**117-11 impact:** adding `/clawcode-verbose` brings the runtime count
to 11 (slash-types CONTROL_COMMANDS length) and the sum to 24. The 117-11
SUMMARY tracks this and leaves the slash-commands.test.ts sum expectation
at its pre-existing-failing value of 25 (still off by 1 post-117-11). 117-11
updates only the slash-types.test.ts `CONTROL_COMMANDS.toHaveLength(11)`
assertion + its validMethods array (set-verbose-level inclusion).

**Defer to:** a small `chore` PR that audits all comment-tracked counts
in this test file family and restores them to runtime truth. Not in the
117 phase budget — falls under cleanup hygiene.

### Pre-existing GSD nested slash-command failures

**Files:**
- `src/discord/__tests__/slash-commands-gsd-nested.test.ts` (GSDN-01, GSDN-02, …)
- `src/discord/__tests__/slash-commands-gsd-register.test.ts` (GSR-1, GSR-3, …)

**Observed pre-117-11 (verified 2026-05-13 via `git stash`):** 4 failures
in these two files. The composite `/get-shit-done` register output is
empty (`expected [] to have length 1`).

**117-11 impact:** none. These are pre-existing failures unrelated to
the advisor/verbose-state surface.

**Defer to:** the GSD subsystem owner (likely Phase 999.21 follow-up).
Possibly a regression introduced by 999.32 single-entry consolidation —
needs investigation by someone with GSD-register context.
