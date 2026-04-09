---
phase: 06-memory-consolidation-pipeline
plan: 01
subsystem: memory
tags: [consolidation, zod, sqlite, migration, date-fns, types]

requires:
  - phase: 04-memory-system
    provides: "MemoryStore, MemorySource type, memoryConfigSchema, SessionLogger"
  - phase: 05-heartbeat-framework
    provides: "SessionManager with memory lifecycle, heartbeat checks"
provides:
  - "MemorySource union includes 'consolidation'"
  - "consolidationConfigSchema with enabled, thresholds, summaryModel"
  - "WeeklyDigest, MonthlyDigest, ConsolidationResult types"
  - "SQLite schema migration for existing databases"
  - "MemoryStore.deleteSessionLog() and getSessionLogDates()"
  - "SessionManager.getEmbedder(), getAgentConfig(), getSessionLogger()"
  - "date-fns dependency for ISO week calculations"
affects: [06-02-core-consolidation-logic, 06-03-heartbeat-wiring]

tech-stack:
  added: [date-fns@4.1.0]
  patterns: [sqlite-table-recreation-migration, savepoint-based-constraint-detection]

key-files:
  created:
    - src/memory/consolidation.types.ts
  modified:
    - src/memory/types.ts
    - src/memory/schema.ts
    - src/memory/store.ts
    - src/config/schema.ts
    - src/shared/types.ts
    - src/manager/session-manager.ts
    - package.json

key-decisions:
  - "SQLite migration uses savepoint test to detect if constraint update needed"
  - "consolidation config nested inside memoryConfigSchema rather than separate top-level"

patterns-established:
  - "SQLite CHECK constraint migration via table recreation with savepoint detection"
  - "SessionManager accessor pattern for exposing internals to consolidation pipeline"

requirements-completed: [AMEM-01, AMEM-02, AMEM-03]

duration: 3min
completed: 2026-04-09
---

# Phase 06 Plan 01: Consolidation Foundation Summary

**MemorySource extended with 'consolidation', Zod schemas for consolidation config, digest types, SQLite migration, and SessionManager accessors for pipeline access**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-09T03:46:04Z
- **Completed:** 2026-04-09T03:49:11Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Extended MemorySource union and Zod schema with 'consolidation' as a valid source
- Created digest types (WeeklyDigest, MonthlyDigest, ConsolidationResult) for the consolidation pipeline
- Added SQLite schema migration that detects and updates existing databases via savepoint-based constraint testing
- Exposed SessionManager internals (embedder, agent config, session logger) for consolidation pipeline use
- Installed date-fns for ISO week calculations

## Task Commits

Each task was committed atomically:

1. **Task 1: Types, schemas, and config extension for consolidation** - `12736d0` (feat)
2. **Task 2: Schema migration and SessionManager accessors** - `ca2a555` (feat)

## Files Created/Modified
- `src/memory/consolidation.types.ts` - WeeklyDigest, MonthlyDigest, ConsolidationResult types
- `src/memory/types.ts` - Added 'consolidation' to MemorySource union
- `src/memory/schema.ts` - consolidationConfigSchema, updated memoryConfigSchema with consolidation field
- `src/memory/store.ts` - migrateSchema(), deleteSessionLog(), getSessionLogDates()
- `src/config/schema.ts` - Config defaults include consolidation settings
- `src/shared/types.ts` - ResolvedAgentConfig.memory includes consolidation
- `src/manager/session-manager.ts` - getEmbedder(), getAgentConfig(), getSessionLogger() accessors
- `package.json` - Added date-fns dependency

## Decisions Made
- SQLite migration uses savepoint-based detection to test if the CHECK constraint already accepts 'consolidation', avoiding unnecessary table recreation
- Consolidation config is nested inside memoryConfigSchema (not a separate top-level config) to keep memory-related settings co-located

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated ResolvedAgentConfig type and test fixtures**
- **Found during:** Task 1
- **Issue:** Adding consolidation to memoryConfigSchema caused type errors in ResolvedAgentConfig (src/shared/types.ts) and all test fixtures using memory config objects
- **Fix:** Added consolidation field to ResolvedAgentConfig.memory type, updated 5 test files with consolidation defaults
- **Files modified:** src/shared/types.ts, src/config/__tests__/loader.test.ts, src/heartbeat/__tests__/runner.test.ts, src/agent/__tests__/workspace.test.ts, src/manager/__tests__/session-manager.test.ts, src/discord/__tests__/router.test.ts
- **Verification:** npx tsc --noEmit passes cleanly
- **Committed in:** 12736d0 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary type propagation across codebase. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All type contracts and schemas ready for Plan 02 (core consolidation logic)
- SessionManager accessors provide pipeline access to embedder, config, and session loggers
- date-fns available for ISO week grouping in consolidation engine

---
*Phase: 06-memory-consolidation-pipeline*
*Completed: 2026-04-09*
