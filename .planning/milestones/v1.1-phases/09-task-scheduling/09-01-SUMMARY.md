---
phase: 09-task-scheduling
plan: 01
subsystem: scheduler
tags: [croner, cron, scheduling, task-automation, zod]

requires:
  - phase: 02-agent-lifecycle
    provides: SessionManager with sendToAgent()
  - phase: 01-config-and-workspace
    provides: Config schema and loader with Zod validation
provides:
  - TaskScheduler class for cron-based per-agent task execution
  - ScheduleEntry and ScheduleStatus types
  - scheduleEntrySchema for config validation
  - Per-agent schedule config in clawcode.yaml
affects: [09-task-scheduling, daemon-startup, ipc-protocol, cli-commands]

tech-stack:
  added: [croner]
  patterns: [per-agent-sequential-lock, cron-trigger-callback, mutable-status-with-readonly-export]

key-files:
  created:
    - src/scheduler/types.ts
    - src/scheduler/scheduler.ts
    - src/scheduler/__tests__/scheduler.test.ts
    - src/scheduler/__tests__/schema-schedule.test.ts
  modified:
    - src/config/schema.ts
    - src/shared/types.ts
    - src/config/loader.ts
    - package.json

key-decisions:
  - "Per-agent boolean lock for sequential task execution (simple, no queue needed)"
  - "Cron expression validation deferred to croner at startup, not at config parse time"
  - "_triggerForTest helper for deterministic test execution without real timers"

patterns-established:
  - "Scheduler pattern: croner Cron instances managed in Map<agentName, Cron[]>"
  - "MutableStatus internal type converted to readonly ScheduleStatus on read"

requirements-completed: [SKED-01, SKED-02]

duration: 5min
completed: 2026-04-09
---

# Phase 9 Plan 1: Scheduler Engine and Config Summary

**Cron-based TaskScheduler using croner with per-agent sequential locking, schedule config schema, and full type system**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-09T04:49:08Z
- **Completed:** 2026-04-09T04:54:48Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- TaskScheduler class manages cron jobs per agent with addAgent/removeAgent/stop lifecycle
- Per-agent sequential lock prevents parallel scheduled task execution within same agent
- Schedule config schema validates name/cron/prompt/enabled with Zod, defaults enabled to true
- ScheduleEntry and ScheduleStatus types define the full scheduling contract
- 17 tests covering schema validation, scheduler behavior, locking, and error handling

## Task Commits

Each task was committed atomically:

1. **Task 1: Install croner, define types, extend config schema** - `1f2a5c5` (feat)
2. **Task 2: Implement TaskScheduler with croner execution** - `e65f0fb` (feat)

## Files Created/Modified
- `src/scheduler/types.ts` - ScheduleEntry, ScheduleStatus, TaskSchedulerOptions types
- `src/scheduler/scheduler.ts` - TaskScheduler class with croner cron job management
- `src/scheduler/__tests__/scheduler.test.ts` - 9 tests for TaskScheduler behavior
- `src/scheduler/__tests__/schema-schedule.test.ts` - 8 tests for schedule config schema
- `src/config/schema.ts` - Added scheduleEntrySchema and schedules to agentSchema
- `src/shared/types.ts` - Added schedules field to ResolvedAgentConfig
- `src/config/loader.ts` - Added schedules passthrough in resolveAgentConfig
- `package.json` - Added croner dependency

## Decisions Made
- Per-agent boolean lock for sequential task execution -- simple flag is sufficient since tasks run in-process; no need for a queue since skipped executions will retry on next cron tick
- Cron expression validation deferred to croner constructor at runtime, not at schema parse time -- keeps Zod schema simple, croner throws clear errors on invalid expressions
- _triggerForTest internal method allows deterministic testing without manipulating real timers or mocking croner internals

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated test fixtures across 5 files for new schedules field**
- **Found during:** Task 1 (after adding schedules to ResolvedAgentConfig)
- **Issue:** Existing test files constructing ResolvedAgentConfig/AgentConfig objects lacked the new schedules field, causing TypeScript errors
- **Fix:** Added `schedules: []` to test fixtures in loader.test.ts, workspace.test.ts, router.test.ts, runner.test.ts, session-manager.test.ts
- **Files modified:** 5 test files
- **Verification:** All existing tests continue to pass
- **Committed in:** 1f2a5c5 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary type compatibility fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TaskScheduler ready for daemon integration (Plan 2)
- IPC schedules method can query getStatuses() (Plan 3)
- CLI schedules command can format status output (Plan 3)

---
*Phase: 09-task-scheduling*
*Completed: 2026-04-09*
