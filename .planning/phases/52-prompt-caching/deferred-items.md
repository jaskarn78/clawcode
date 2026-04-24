# Phase 52 Prompt Caching — Deferred Items

Tracks pre-existing issues surfaced during plan execution that are out of scope
for the active plan. These are NOT regressions caused by the current work.

## Discovered during 52-02 execution

### Worktree pollution: stale bootstrap-integration test

- **Path:** `.claude/worktrees/agent-ad592f9f/src/manager/__tests__/bootstrap-integration.test.ts`
- **Line:** `102:33` asserts `toContain("I am a researcher agent")`
- **Cause:** Worktree test snapshot predates the fingerprint-based SOUL extraction
  refactor (current buildSessionConfig extracts "## Identity\n- **Name:** My Soul"
  from the SOUL's H1 rather than passing raw SOUL text).
- **Pre-existing:** Verified by `git stash && npx vitest run .claude/worktrees/...` —
  test fails identically on `master@58382fd` before any 52-02 changes.
- **Resolution:** Cleanup task for a future worktree-pruning pass OR adjust
  `vitest.config.ts` to exclude `.claude/worktrees/**`. Not a 52-02 concern.
