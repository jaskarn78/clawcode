# Deferred items from 116-postdeploy orphan cleanup work (2026-05-12)

## Pre-existing test failure (NOT introduced by orphan cleanup work)
- `src/memory/__tests__/conversation-brief.test.ts` "agents-forget-across-sessions"
  2 failing assertions on master before any changes. Confirmed via `git stash`
  + clean run. Out of scope for orphan-cleanup commits.
