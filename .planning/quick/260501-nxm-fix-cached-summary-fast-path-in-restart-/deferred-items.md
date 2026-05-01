# Deferred Items — 260501-nxm

Pre-existing failures observed on `master` BEFORE this quick task's edits. Out of scope per SCOPE BOUNDARY rule (only auto-fix issues directly caused by current task's changes).

## Pre-existing failures in src/manager/__tests__/restart-greeting.test.ts (verified by stash-and-rerun on master)

- **P8: last session endedAt 8 days ago → skipped-dormant with lastActivityMs** (line ~351)
  - Symptom: `expected 'sent' to be 'skipped-dormant'`
  - Cause: unrelated to fast-path fingerprint guard.
  - Verified pre-existing: stashed my test additions, ran on bare master — failure reproduces identically.

- **P12: getTurnsForSession returns [] → skipped-empty-state (defensive)** (line ~413)
  - Symptom: `expected { kind: 'sent', messageId: 'msg-id-123' } to deeply equal { kind: 'skipped-empty-state' }`
  - Cause: unrelated to fast-path fingerprint guard.
  - Verified pre-existing: stashed my test additions, ran on bare master — failure reproduces identically.

## Pre-existing failures elsewhere in src/manager (full `npx vitest run src/manager` surface)

11 test files / 32 tests failing across the broader src/manager surface. Files involved are under active parallel-session modification at the time of this quick task (per `git status` at session start):

- src/manager/recovery/op-refresh.ts, types.ts
- src/manager/secrets-collector.ts, secrets-resolver.ts, secrets-watcher-bridge.ts, secrets-ipc-handler.ts
- corresponding test files

These belong to Phase 108 / 999.x parallel work and are out of scope for 260501-nxm (which only touches src/manager/restart-greeting.ts and its test file). Owner phases will resolve in their own GREEN passes.

## Pre-existing TypeScript errors

`npx tsc --noEmit` reports errors in:
- src/tasks/task-manager.ts (causationId missing — unrelated, parallel-session schema change)
- src/triggers/__tests__/engine.test.ts (Mock type mismatch — unrelated)
- src/triggers/__tests__/policy-watcher.test.ts (unused @ts-expect-error)
- src/usage/__tests__/daily-summary.test.ts (tuple length)
- src/usage/budget.ts (type comparison)

None reference src/manager/restart-greeting.ts or its test file. Verified by `npx tsc --noEmit 2>&1 | grep restart-greeting` returning empty. Out of scope.
