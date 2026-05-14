# Phase 119 — Deferred Items (out-of-scope discoveries during execution)

## Pre-existing test failures (NOT caused by Plan 119-01)

- `src/migration/__tests__/verifier.test.ts > verifier — workspace-files-present check (Tests 1-2)`
  - 2 failures on `master` BEFORE Plan 119-01 changes were applied (verified via `git stash` + rerun).
  - Failure mode: `ENOENT: no such file or directory, lstat '/tmp/cc-verifier-XXXXX/target/alpha/MEMORY.md'`
  - Belongs to the migration tooling subsystem (Plan 999.30 era). Not in 119 scope.
  - Action: leave as-is. Surface to a future Phase that owns the migration verifier.
