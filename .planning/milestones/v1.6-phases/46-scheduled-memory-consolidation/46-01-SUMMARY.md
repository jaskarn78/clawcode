---
phase: 46-scheduled-memory-consolidation
plan: 01
subsystem: scheduler
tags: [croner, cron, consolidation, memory, scheduler, handler]

requires:
  - phase: 24-cron-scheduler
    provides: TaskScheduler with cron-based task execution
  - phase: 17-memory-consolidation
    provides: runConsolidation pipeline
provides:
  - Handler-based ScheduleEntry support in TaskScheduler
  - Configurable per-agent consolidation schedule via consolidation.schedule
  - Deprecated heartbeat consolidation check (no-op stub)
affects: [scheduler, heartbeat, daemon, memory-consolidation]

tech-stack:
  added: []
  patterns: [handler-based schedule entries for programmatic tasks]

key-files:
  created: []
  modified:
    - src/memory/schema.ts
    - src/scheduler/types.ts
    - src/scheduler/scheduler.ts
    - src/config/schema.ts
    - src/manager/daemon.ts
    - src/heartbeat/checks/consolidation.ts
    - src/shared/types.ts
    - src/scheduler/__tests__/scheduler.test.ts
    - src/heartbeat/checks/__tests__/consolidation.test.ts

key-decisions:
  - "Handler-based ScheduleEntry takes priority over prompt when both present"
  - "scheduleEntrySchema (YAML validation) unchanged -- handler entries are programmatic only"
  - "Heartbeat consolidation check kept as no-op stub for auto-discovery compatibility"

patterns-established:
  - "Handler-based schedule entries: use handler callback for programmatic tasks, prompt for agent-driven tasks"

requirements-completed: [CONSOL-01]

duration: 387s
completed: 2026-04-12
---

# Phase 46 Plan 01: Scheduled Memory Consolidation Summary

**Configurable cron-based memory consolidation via TaskScheduler with handler callback support, replacing fixed 24h heartbeat trigger**

## Performance

- **Duration:** 6min 27s
- **Started:** 2026-04-12T02:08:53Z
- **Completed:** 2026-04-12T02:15:20Z
- **Tasks:** 2
- **Files modified:** 20

## Accomplishments
- Extended TaskScheduler to support handler-based execution alongside prompt-based (handler takes priority)
- Added `consolidation.schedule` config field with default "0 3 * * *" (daily at 3am)
- Daemon injects "memory-consolidation" ScheduleEntry per agent with configurable cron
- Heartbeat consolidation check converted to deprecated no-op stub

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend schema and scheduler to support handler-based scheduled tasks** - `56de920` (feat)
2. **Task 2: Wire consolidation into TaskScheduler and remove heartbeat check** - `8b17875` (feat)

## Files Created/Modified
- `src/memory/schema.ts` - Added schedule field to consolidationConfigSchema
- `src/scheduler/types.ts` - Made prompt optional, added handler callback to ScheduleEntry
- `src/scheduler/scheduler.ts` - Handler-based execution path (handler takes priority over prompt)
- `src/config/schema.ts` - Updated consolidation defaults in both defaultsSchema and configSchema
- `src/manager/daemon.ts` - Injects memory-consolidation ScheduleEntry per agent with runConsolidation handler
- `src/heartbeat/checks/consolidation.ts` - Converted to deprecated no-op stub
- `src/shared/types.ts` - Added schedule field to ResolvedAgentConfig consolidation type
- `src/scheduler/__tests__/scheduler.test.ts` - New tests for handler-based execution and error handling
- `src/heartbeat/checks/__tests__/consolidation.test.ts` - Replaced with deprecated stub tests
- 11 test fixture files - Added schedule field to consolidation config objects

## Decisions Made
- Handler-based ScheduleEntry takes priority when both handler and prompt are present
- scheduleEntrySchema (YAML validation) left unchanged -- handler entries are created programmatically in daemon.ts, not parsed from YAML
- Heartbeat consolidation check kept as no-op stub so heartbeat auto-discovery still loads it without errors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added schedule field to ResolvedAgentConfig type in shared/types.ts**
- **Found during:** Task 2 (tsc --noEmit)
- **Issue:** ResolvedAgentConfig had hardcoded consolidation type without schedule field, causing type errors
- **Fix:** Added `readonly schedule: string` to the consolidation type in shared/types.ts
- **Files modified:** src/shared/types.ts
- **Verification:** tsc --noEmit passes for schedule-related errors
- **Committed in:** 8b17875 (Task 2 commit)

**2. [Rule 3 - Blocking] Updated 11 test fixture files with schedule field**
- **Found during:** Task 2 (tsc --noEmit)
- **Issue:** Test fixtures across the codebase referenced consolidation config without the new required schedule field
- **Fix:** Added `schedule: "0 3 * * *"` to all consolidation config objects in test files
- **Files modified:** 11 test files across agent, bootstrap, config, discord, heartbeat, manager directories
- **Verification:** tsc --noEmit passes, all tests pass
- **Committed in:** 8b17875 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary to maintain type safety after adding the required schedule field. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None

## Next Phase Readiness
- Consolidation now runs on configurable cron schedule per agent
- Operators can set `consolidation.schedule` in clawcode.yaml per agent or in defaults
- TaskScheduler handler pattern available for future programmatic scheduled tasks

---
*Phase: 46-scheduled-memory-consolidation*
*Completed: 2026-04-12*
