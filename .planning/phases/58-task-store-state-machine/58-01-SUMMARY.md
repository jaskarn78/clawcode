---
phase: 58-task-store-state-machine
plan: 01
subsystem: database
tags: [tasks, state-machine, zod, sqlite, lifecycle, life-02]

# Dependency graph
requires:
  - phase: 57-turndispatcher-foundation
    provides: TurnOrigin shape (rootTurnId / parentTurnId / chain) — referenced in TaskRow doc comments; downstream Phase 59 callers map TurnOrigin → causation_id / parent_task_id / depth
provides:
  - TaskStatus union (8 values) and LEGAL_TRANSITIONS map (locked transition table)
  - TERMINAL_STATUSES (5) and IN_FLIGHT_STATUSES (2) sets
  - Zod TaskRowSchema covering all 15 LIFE-02 fields
  - Zod TriggerStateRowSchema (Phase 60 watermark/cursor consumer)
  - assertLegalTransition pure-function state machine + isTerminal/isInFlight helpers
  - Three typed errors: TaskStoreError, IllegalTaskTransitionError, TaskNotFoundError
affects: [58-02 (TaskStore class), 58-03 (reconciler + daemon wiring), 59 (TaskManager / handoffs), 60 (TriggerEngine + retention), 63 (clawcode tasks CLI)]

# Tech tracking
tech-stack:
  added: []  # Zero new runtime dependencies — uses existing zod v4
  patterns: ["pure-function state machine over readonly Map", "feature-local errors.ts mirroring src/memory/errors.ts", "exhaustive table-driven test (8×8 = 64 pairs) for state-machine coverage"]

key-files:
  created:
    - src/tasks/types.ts (TASK_STATUSES + LEGAL_TRANSITIONS + sets)
    - src/tasks/schema.ts (TaskRowSchema + TriggerStateRowSchema)
    - src/tasks/errors.ts (3 typed error classes)
    - src/tasks/state-machine.ts (assertLegalTransition + helpers)
    - src/tasks/__tests__/schema.test.ts (14 tests)
    - src/tasks/__tests__/state-machine.test.ts (79 tests)
  modified: []  # Zero modifications — pure additive, no daemon wiring yet (lands in 58-03)

key-decisions:
  - "TaskRowSchema uses .nullable() (not .optional()) on the 4 nullable fields so SQLite NULL ↔ TS null round-trip is exact"
  - "chain_token_cost defaults to 0 at the schema layer so Phase 59 callers without cost telemetry can omit the field"
  - "isTerminal / isInFlight helpers wrap the pre-computed sets — callers never re-derive from LEGAL_TRANSITIONS"
  - "orphaned status is a terminal entry-only state; reconciler bypasses assertLegalTransition via a future TaskStore.markOrphaned path (Plan 58-02)"
  - "Errors live in feature-local src/tasks/errors.ts (matches src/memory/errors.ts pattern), not src/shared/errors.ts — only the tasks subsystem and Phase 59/60 catches consume them"

patterns-established:
  - "Pure-function state machine: assertLegalTransition(from, to): void — never returns boolean; throws typed error on illegal transition"
  - "Exhaustive table-driven state coverage: nested for-loop over TASK_STATUSES × TASK_STATUSES generates 64 test cases automatically — no implicit paths possible"
  - "SCREAMING_SNAKE_CASE Set/Map exports for status taxonomies (TASK_STATUSES, LEGAL_TRANSITIONS, TERMINAL_STATUSES, IN_FLIGHT_STATUSES)"

requirements-completed: [LIFE-02]

# Metrics
duration: 4min
completed: 2026-04-15
---

# Phase 58 Plan 01: TaskStatus + TaskRowSchema + State Machine Summary

**Locked the 8-status TaskStatus union, 15-field LIFE-02 row shape, and pure-function `assertLegalTransition` state machine — pure data foundation that Plans 58-02 (TaskStore) and 58-03 (reconciler + daemon wiring) build on with zero re-litigation.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-15T20:20:40Z
- **Completed:** 2026-04-15T20:24:35Z
- **Tasks:** 2 (both TDD: RED → GREEN, no refactor needed)
- **Files created:** 6 (4 source + 2 test)
- **Files modified:** 0

## Accomplishments

- 8 task statuses locked (`pending | running | awaiting_input | complete | failed | cancelled | timed_out | orphaned`) with their legal transitions captured as an immutable Map literal — every (from, to) pair not in the table is illegal by construction
- Zod `TaskRowSchema` validates every one of the 15 LIFE-02 fields on insert; nullable persistence fields use `.nullable()` for SQLite NULL fidelity; `chain_token_cost` defaults to 0
- `TriggerStateRowSchema` defined alongside (Phase 60 consumes it for source watermarks/cursors)
- Three typed errors (`TaskStoreError`, `IllegalTaskTransitionError`, `TaskNotFoundError`) follow the `src/shared/errors.ts` convention with readonly context fields
- Pure-function state machine: `assertLegalTransition(from, to): void` throws on illegal, returns on legal — never boolean
- Exhaustive 64-pair test exercises every (TaskStatus × TaskStatus) transition automatically — no implicit paths
- 93 tests passing across the two suites, zero new tsc errors in `src/tasks/`

## Task Commits

Each task was committed atomically using TDD (test → feat):

1. **Task 1 RED: failing tests for TaskRowSchema + error classes** — `2b26193` (test)
2. **Task 1 GREEN: TaskStatus + TaskRowSchema + typed error classes** — `3d7ca1a` (feat)
3. **Task 2 RED: failing tests for assertLegalTransition** — `0adde70` (test)
4. **Task 2 GREEN: assertLegalTransition state machine + helpers** — `53365d1` (feat)

_Plan metadata commit follows this SUMMARY._

## Files Created/Modified

- `src/tasks/types.ts` — TASK_STATUSES tuple, LEGAL_TRANSITIONS map, TERMINAL_STATUSES set, IN_FLIGHT_STATUSES set, TaskStatus type
- `src/tasks/schema.ts` — TaskStatusSchema (z.enum), TaskRowSchema (15 LIFE-02 fields), TriggerStateRowSchema, inferred types
- `src/tasks/errors.ts` — TaskStoreError(message, dbPath), IllegalTaskTransitionError(from, to), TaskNotFoundError(taskId)
- `src/tasks/state-machine.ts` — assertLegalTransition(from, to): void, isTerminal(status), isInFlight(status)
- `src/tasks/__tests__/schema.test.ts` — 14 tests: status tuple, 15-field round-trip, rejection paths, nullable defaults, error shape invariants
- `src/tasks/__tests__/state-machine.test.ts` — 79 tests: 64-pair exhaustive table-driven coverage + 15 explicit scenarios

## Decisions Made

- **`.nullable()` not `.optional()`** on the 4 nullable persistence fields (`parent_task_id`, `ended_at`, `result_digest`, `error`) — SQLite NULL ↔ TS `null` round-trip stays exact, no `undefined` leaks into rows
- **`chain_token_cost` default 0 at schema layer** — Phase 59 callers without cost telemetry can omit the field; matches HAND-02 where cost attribution lives in the wrapper, not the row
- **Helpers wrap pre-computed sets** (`isTerminal`/`isInFlight`) so callers never re-derive from `LEGAL_TRANSITIONS` — fast `Set.has()` on the hot path
- **`orphaned` is terminal entry-only** — reconciler will bypass `assertLegalTransition` via a `TaskStore.markOrphaned` method (decided in 58-CONTEXT.md, implemented in Plan 58-02). The state machine still lists `orphaned` as terminal so post-reconciliation transitions are blocked.
- **Errors are feature-local** (`src/tasks/errors.ts`, mirroring `src/memory/errors.ts`), not in `src/shared/errors.ts` — only the tasks subsystem and Phase 59/60 typed catches consume them; keeps `shared/errors.ts` reserved for cross-cutting types like `ManagerError` / `SessionError` / `IpcError`

## Deviations from Plan

None — plan executed exactly as written. Both tasks used TDD (test → feat) with no refactor pass needed (state-machine.ts is 45 lines, schema.ts is 64 lines — already at the right granularity).

## Issues Encountered

None. The plan's `<locked_shapes>` section made implementation mechanical.

One harness note: `npx tsc --noEmit src/tasks/types.ts ...` reports `error TS5112` (TypeScript 6 won't accept files-on-commandline when `tsconfig.json` is present). Substituted a project-level `npx tsc --noEmit` filtered to `src/tasks/` paths — zero errors there. Pre-existing tsc errors elsewhere in the repo are out of scope per Phase 57-01 SUMMARY precedent.

## How Downstream Plans Consume This

- **Plan 58-02 (TaskStore)** imports `TaskRow` + `TaskRowSchema` for validation on `insert`; calls `assertLegalTransition` from `transition`; throws `TaskStoreError` on SQLite failure and `TaskNotFoundError` on missing-row reads
- **Plan 58-03 (reconciler + daemon wiring)** imports `IN_FLIGHT_STATUSES` for the WHERE clause that scans for stale-heartbeat candidates (`status IN (?, ?) AND heartbeat_at < ?`); uses `TaskStore.markOrphaned` (introduced in 58-02) which bypasses `assertLegalTransition`
- **Phase 59 (TaskManager / handoffs)** imports `TaskStatus` + `LEGAL_TRANSITIONS` for typed handoff state inspection; catches `IllegalTaskTransitionError` to translate into MCP `INVALID_STATE` typed errors; reads `TaskRowSchema` shape to validate retry-CLI payloads
- **Phase 60 (TriggerEngine)** writes `TriggerStateRowSchema`-shaped rows to the trigger_state table; uses `TERMINAL_STATUSES` for the LIFE-03 retention WHERE clause
- **Phase 63 (CLIs)** reads `TaskRow` shape and `TASK_STATUSES` for `clawcode tasks` filter validation

## Next Phase Readiness

- Pure-data foundation is locked. Plan 58-02 can proceed mechanically: `import { TaskRowSchema } from "./schema.js"` → Zod-validate → SQLite prepared statement.
- No daemon wiring yet — `src/manager/daemon.ts` untouched until Plan 58-03.
- Zero regressions: pre-existing tests unaffected; the new `src/tasks/__tests__/` suite is additive.

## Self-Check: PASSED

- `src/tasks/types.ts`: FOUND
- `src/tasks/schema.ts`: FOUND
- `src/tasks/errors.ts`: FOUND
- `src/tasks/state-machine.ts`: FOUND
- `src/tasks/__tests__/schema.test.ts`: FOUND
- `src/tasks/__tests__/state-machine.test.ts`: FOUND
- Commit `2b26193`: FOUND (test: failing tests for TaskRowSchema)
- Commit `3d7ca1a`: FOUND (feat: TaskStatus + TaskRowSchema + errors)
- Commit `0adde70`: FOUND (test: failing tests for state machine)
- Commit `53365d1`: FOUND (feat: assertLegalTransition state machine)
- All 93 tests pass (`npx vitest run src/tasks/__tests__`)

---
*Phase: 58-task-store-state-machine*
*Completed: 2026-04-15*
