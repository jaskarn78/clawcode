# Phase 106 — Deferred Items

Pre-existing issues discovered during execution. Out of scope for Phase 106 (not caused by this phase's changes).

## Pre-existing TypeScript errors (unrelated to IPC scope)

Discovered during 106-03 execution while running `npx tsc --noEmit`. None of these touch `src/ipc/` and none were caused by appending `mcp-tracker-snapshot` to `IPC_METHODS`. Logged here for a future cleanup phase.

- `src/tasks/task-manager.ts:239,328,367,485` — `causationId` missing in `OriginContext` literals (TaskManager pre-dates the field's required-ness).
- `src/triggers/__tests__/engine.test.ts:68,69` — `Mock<Procedure | Constructable>` not assignable to `(() => void) & Mock<...>` (vitest type drift).
- `src/triggers/__tests__/policy-watcher.test.ts:516` — Unused `@ts-expect-error` directive.
- `src/usage/__tests__/daily-summary.test.ts:209,288,313` — Tuple `[]` of length 0 has no element at index 0/1 (test fixture type drift).
- `src/usage/budget.ts:138` — `'warning' | null` vs `'exceeded'` comparison has no overlap (logic vs type drift).

**Status:** Pre-existing on master before Phase 106 started. Tests still pass via vitest (which doesn't gate on tsc); type errors are a separate cleanup concern.

## Pre-existing test failures in session-config.test.ts

Discovered during 106-01 execution while running the plan's verification command (`npx vitest run src/discord/__tests__/subagent-delegates-scoping.test.ts src/manager/__tests__/session-config.test.ts src/manager/__tests__/context-assembler.test.ts`). Confirmed pre-existing on master (verified by stashing the 106-01 edit and re-running — same 3 failures appeared on clean master).

- `session-config.test.ts:955` — buildSessionConfig — Phase 73 brief cache wiring > cache HIT (matching fingerprint) → skips assembleConversationBrief, uses cached block
- `session-config.test.ts:994` — buildSessionConfig — Phase 73 brief cache wiring > cache entry with stale fingerprint → cache miss, assembler called, new entry written
- `session-config.test.ts:1300` — buildSessionConfig — MEM-01 MEMORY.md auto-inject (Phase 90) > MEM-01-C2: 50KB cap — 60KB MEMORY.md truncates to 50KB + marker (5000ms timeout)

**Status:** Pre-existing on master before Phase 106-01 started. Out of scope per Phase 106 deviation rules (SCOPE BOUNDARY: only auto-fix issues directly caused by current task's changes). Phase 106-01 only modified the spread destructure in `subagent-thread-spawner.ts` — no path through these test cases. Recommend separate cleanup phase.
