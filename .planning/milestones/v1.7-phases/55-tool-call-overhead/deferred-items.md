
## Deferred: Stale worktree directories picked up by vitest

Found during: Plan 55-02 execution (2026-04-14)
Issue: `.claude/worktrees/agent-*` contains 15+ stale copies of the project from prior agent runs. Each carries outdated `src/mcp/server.test.ts` that vitest globs include, producing 6+ spurious failures per run.
Impact: pre-existing noise across every vitest run; out of scope for Plan 55-02 (tool-call-overhead).
Fix: either delete `.claude/worktrees/` (user-owned state) or add `test.exclude: [".claude/worktrees/**"]` in vitest.config.ts.
Owner: user / repo-hygiene task.
