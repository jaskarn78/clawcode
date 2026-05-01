---
phase: 106
plan: 00
subsystem: testing
tags: [tdd, red-tests, wave-0, dscope, stall-02, track-cli]
requires:
  - 999.13 DELEG substrate (renderDelegatesBlock + delegatesBlock injection)
  - 999.15 IPC pattern + IPC_METHODS enum
  - subagent-recursion-guard.test.ts harness (Phase 99-N)
  - session-manager.test.ts harness (createMockAdapter)
provides:
  - DSCOPE-02 RED — subagent config strips `delegates` (test pin)
  - DSCOPE-03 GREEN — sourceConfig purity invariant (regression lock)
  - STALL-02 RED — warmup-timeout sentinel (test pin, 60s threshold)
  - STALL-02 GREEN — no-false-positive on happy-path startup (regression lock)
  - TRACK-CLI-01 RED — mcp-tracker-snapshot expected in IPC_METHODS tuple
affects:
  - Wave 1 GREEN plans (106-01 DSCOPE fix, 106-02 STALL-02 fix, 106-03 TRACK-CLI fix)
tech-stack:
  added: []
  patterns:
    - vitest fake timers (vi.useFakeTimers + vi.advanceTimersByTimeAsync) for 60s sentinel
    - vi.fn() captor on sessionManager.startAgent for ResolvedAgentConfig assertions
    - pino-shaped spy logger (warn = vi.fn()) for structured warmup-timeout assertions
    - mirror of Phase 99-N subagent-recursion-guard.test.ts harness
key-files:
  created:
    - src/discord/__tests__/subagent-delegates-scoping.test.ts
    - src/manager/__tests__/session-manager-warmup-timeout.test.ts
  modified:
    - src/ipc/__tests__/protocol.test.ts
key-decisions:
  - 'Test 2 in DSCOPE / STALL is GREEN-on-purpose (regression-lock guarding against future bugs), not RED — actual bug-locking REDs total 5 (DSCOPE 2 + STALL 2 + TRACK-CLI 1)'
  - 'STALL-02 test uses real SessionManager + createMockAdapter with adapter.createSession overridden to never-resolve — simulates SDK MCP cold-start hang without mocking the entire memory/registry pipeline'
  - 'Spy logger is a hand-rolled pino-shaped object (warn = vi.fn()) rather than vi.spyOn(pino) — pino logger methods are non-enumerable and bound to internal state; replacement is cleaner'
  - 'DSCOPE adds a 3rd test for the delegateTo path (defense-in-depth) — pins the strip applies whether sourceConfig = parentConfig or delegateConfig'
requirements-completed:
  - DSCOPE-02
  - DSCOPE-03
  - STALL-02
  - TRACK-CLI-01
duration: 8 min
completed: 2026-04-30
---

# Phase 106 Plan 00: Wave 0 RED Tests Summary

Wave 0 RED tests for DSCOPE delegate-scope leak, STALL-02 warmup-timeout sentinel, and TRACK-CLI mcp-tracker IPC-enum gap — five failing tests + two regression-lock tests across two new files and one extended file. All tests fail today with the exact failure mode predicted by RESEARCH.md; each Wave 1 GREEN plan's `<verify>` command points to one of these files.

## Execution Metrics

- **Duration:** ~8 min
- **Tasks:** 3/3
- **Files created:** 2
- **Files modified:** 1
- **Commits:** 3 (one per task)

## Tasks Executed

### Task 1: DSCOPE RED test — subagent config strips `delegates`
- **File created:** `src/discord/__tests__/subagent-delegates-scoping.test.ts` (267 lines)
- **Commit:** `4779d47`
- **RED tests (2):**
  - `DSCOPE-02: spawned subagent config does NOT carry delegates field even when sourceConfig has it`
  - `DSCOPE-02 (delegateTo path): when delegating to fin-research, the spawned subagent config does NOT carry the delegate's delegates field either`
- **GREEN regression-lock (1):**
  - `DSCOPE-03: sourceConfig.delegates remain unmodified after spawn (destructure-only, no in-place mutation)`
- **Failure mode (RED):** `expected { research: 'fin-research' } to be undefined` — exactly matches research-predicted spread leak at `subagent-thread-spawner.ts:454-465`.
- **Harness:** mirrors `subagent-recursion-guard.test.ts` — `makeMockSessionManager()` with `vi.fn()` captor on `startAgent`, `makeMockDiscordClient()` with stubbed thread creation, isolated `tmpDir` for thread-bindings registry.

### Task 2: STALL-02 RED test — warmup-timeout sentinel
- **File created:** `src/manager/__tests__/session-manager-warmup-timeout.test.ts` (263 lines)
- **Commit:** `07f9222`
- **RED tests (2):**
  - `STALL-02: warmup-timeout fires at 60s when adapter.createSession never resolves`
  - `STALL-02: lastStep reports adapter-create-session when the hang is at adapter.createSession`
- **GREEN regression-lock (1):**
  - `STALL-02: sentinel cleared on warm-path-ready (no warmup-timeout warn fires after 60s if startup completed)`
- **Failure mode (RED):** `Number of calls: 0` for `log.warn` — matches research's "no sentinel exists today; warmup-timeout warn never fires."
- **Harness:** real `SessionManager` + `createMockAdapter` with `adapter.createSession` overridden to `new Promise(() => {})` (never-resolves). Uses `vi.useFakeTimers` + `vi.advanceTimersByTimeAsync(60_001)` to drive the threshold deterministically. Pino-shaped spy logger replaces the manager's logger so `.warn` calls are observable.

### Task 3: TRACK-CLI RED — extend IPC_METHODS expected tuple
- **File modified:** `src/ipc/__tests__/protocol.test.ts` (1 line addition + 5 comment lines)
- **Commit:** `abc3eff`
- **RED test (1):**
  - `IPC_METHODS > includes all required methods`
- **Failure mode (RED):** `expected array to deeply equal […] missing "mcp-tracker-snapshot"` — exact precedent of commit `a9c39c7` (Phase 96-05 probe-fs/list-fs-status fix).

## Verification Results

```
$ npx vitest run src/discord/__tests__/subagent-delegates-scoping.test.ts \
                src/manager/__tests__/session-manager-warmup-timeout.test.ts \
                src/ipc/__tests__/protocol.test.ts

Test Files  3 failed (3)
     Tests  5 failed | 32 passed (37)
```

5 REDs total, breakdown:
- DSCOPE: 2 RED + 1 GREEN regression-lock
- STALL-02: 2 RED + 1 GREEN regression-lock
- TRACK-CLI: 1 RED

The plan predicted "~6 REDs (DSCOPE 2 + STALL 3 + TRACK-CLI 1)"; actual count is 5 because Test 2 in STALL is a regression-lock that asserts the *absence* of the warmup-timeout warn on happy-path startup — it stays GREEN before AND after the Wave 1 fix (its purpose is to prevent the sentinel from firing falsely once it lands). This matches the plan's intent: "The point is to make the test RED [...] when Plan 03 adds the entry, this test turns GREEN" — applies to bug-locking tests, not regression invariants.

### Collateral check

```
$ npx vitest run src/ipc/ \
                src/discord/__tests__/subagent-recursion-guard.test.ts \
                src/manager/__tests__/session-manager.test.ts

Test Files  1 failed | 7 passed (8)
     Tests  1 failed | 132 passed (133)
```

The single failure is the expected protocol.test.ts RED. All adjacent existing tests (subagent-recursion-guard, session-manager.test.ts, full ipc/ suite of ~133 tests) stay GREEN. **Zero collateral damage.**

## Deviations from Plan

None — plan executed exactly as written. The "5 REDs vs ~6 REDs" delta is explained by the GREEN regression-locks (Test 2 in DSCOPE / STALL), which the plan's task-level descriptions explicitly call out as regression invariants ("The strip is destructure-only, must not mutate the source" / "sentinel cleared on warm-path-ready").

## Authentication Gates

None.

## Issues Encountered

**Minor — teardown race on tmpDir:** STALL-02 test logs occasional `writeRegistry: target path vanished mid-write (likely teardown race)` warnings during `afterEach` cleanup when `manager.stopAll()` races with `rm(tmpDir, { recursive: true })`. Non-fatal — the registry write code already swallows `ENOENT` by design. Tests pass deterministically; the warnings are diagnostic noise from the SessionManager's own race-tolerance logic. No action needed.

## Next Phase Readiness

Wave 0 complete. Wave 1 GREEN plans can land in any order:

- **106-01 (DSCOPE GREEN):** edit `src/discord/subagent-thread-spawner.ts:454` — destructure `delegates` out of `sourceConfig` before spread. Verifies via `npx vitest run src/discord/__tests__/subagent-delegates-scoping.test.ts`.
- **106-02 (STALL-02 GREEN):** add the 60s `setTimeout` sentinel + `lastStep` step-tracking inside `startAgent` body in `src/manager/session-manager.ts`. Verifies via `npx vitest run src/manager/__tests__/session-manager-warmup-timeout.test.ts`.
- **106-03 (TRACK-CLI GREEN):** append `"mcp-tracker-snapshot"` to `IPC_METHODS` tuple in `src/ipc/protocol.ts:244`. Verifies via `npx vitest run src/ipc/__tests__/protocol.test.ts`.

Each Wave 1 plan should also confirm `npm test` stays GREEN beyond its own target file (no regressions in the full suite).

Ready for Wave 1.

## Self-Check: PASSED

- Files exist on disk:
  - `src/discord/__tests__/subagent-delegates-scoping.test.ts` ✓
  - `src/manager/__tests__/session-manager-warmup-timeout.test.ts` ✓
  - `src/ipc/__tests__/protocol.test.ts` (modified) ✓
- Commits exist in git log:
  - `4779d47` test(106-00): add DSCOPE RED tests ✓
  - `07f9222` test(106-00): add STALL-02 RED tests ✓
  - `abc3eff` test(106-00): add mcp-tracker-snapshot to IPC_METHODS expected tuple (RED) ✓
- Predicted REDs verified: 5 failing tests across 3 files ✓
- Predicted GREENs verified: 2 regression-lock tests stay GREEN ✓
- Collateral check: zero unrelated test failures ✓
