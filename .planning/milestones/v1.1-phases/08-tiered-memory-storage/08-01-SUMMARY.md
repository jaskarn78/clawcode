---
phase: 08-tiered-memory-storage
plan: 01
subsystem: memory
tags: [sqlite, date-fns, tiered-storage, memory-tiers]

requires:
  - phase: 07-relevance-decay
    provides: calculateRelevanceScore decay function
provides:
  - MemoryTier type (hot|warm|cold) on MemoryEntry
  - tierConfigSchema with 5 configurable thresholds
  - Pure tier transition functions (shouldPromoteToHot, shouldDemoteToWarm, shouldArchiveToCold)
  - SQLite tier column migration with CHECK constraint
  - getEmbedding, listByTier, updateTier store methods
affects: [08-02-PLAN, tiered-memory-orchestration]

tech-stack:
  added: []
  patterns:
    - "Pure function tier transitions with date-fns differenceInDays"
    - "PRAGMA table_info migration detection for ALTER TABLE"
    - "Buffer-to-Float32Array conversion for SQLite vec embedding retrieval"

key-files:
  created:
    - src/memory/tiers.ts
    - src/memory/__tests__/tiers.test.ts
  modified:
    - src/memory/types.ts
    - src/memory/schema.ts
    - src/memory/store.ts
    - src/memory/search.ts
    - src/memory/index.ts
    - src/memory/__tests__/store.test.ts

key-decisions:
  - "Use date-fns differenceInDays for tier transition date math instead of manual millisecond calculation"
  - "Buffer-to-Float32Array conversion in getEmbedding since SQLite returns Buffer not Float32Array"
  - "Tier column uses ALTER TABLE ADD COLUMN with DEFAULT warm for backward-compatible migration"

patterns-established:
  - "Pure tier transition functions: no I/O, no side effects, config-driven thresholds"
  - "PRAGMA table_info column detection before ALTER TABLE migration"

requirements-completed: [AMEM-08, AMEM-09]

duration: 4min
completed: 2026-04-09
---

# Phase 08 Plan 01: Tiered Memory Types and Transitions Summary

**MemoryTier type with pure tier transition functions using date-fns, tier config schema, and SQLite tier column migration with listByTier/updateTier/getEmbedding store methods**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-09T04:30:23Z
- **Completed:** 2026-04-09T04:34:28Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Added MemoryTier type (hot|warm|cold) to MemoryEntry with all existing code updated to default to warm
- Created 3 pure tier transition functions using date-fns and calculateRelevanceScore with 21 unit tests
- Added SQLite tier column migration with CHECK constraint and 3 new store methods (getEmbedding, listByTier, updateTier)
- Full regression-free: 307 tests passing across 27 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Types, schema, and pure tier transition functions** - `9c2e827` (test) + `263c186` (feat) - TDD RED/GREEN
2. **Task 2: SQLite tier column migration and tier-aware queries** - `4f2f725` (feat)

## Files Created/Modified
- `src/memory/tiers.ts` - Pure tier transition functions (shouldPromoteToHot, shouldDemoteToWarm, shouldArchiveToCold)
- `src/memory/types.ts` - Added MemoryTier type and tier field on MemoryEntry
- `src/memory/schema.ts` - Added tierConfigSchema with 5 configurable fields
- `src/memory/store.ts` - Tier column migration, getEmbedding, listByTier, updateTier methods
- `src/memory/search.ts` - Updated SearchRow and query to include tier column
- `src/memory/index.ts` - Barrel exports for all new types and functions
- `src/memory/__tests__/tiers.test.ts` - 21 tests for tier transition logic
- `src/memory/__tests__/store.test.ts` - 10 new tests for tier column and store methods

## Decisions Made
- Used date-fns differenceInDays for tier date arithmetic (per research "Don't Hand-Roll")
- Buffer-to-Float32Array conversion in getEmbedding since better-sqlite3 returns Buffer from vec_memories
- Tier column migration uses ALTER TABLE ADD COLUMN with NOT NULL DEFAULT 'warm' for backward compatibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Buffer-to-Float32Array conversion in getEmbedding**
- **Found during:** Task 2 (getEmbedding implementation)
- **Issue:** SQLite/better-sqlite3 returns embedding data as Buffer, not Float32Array
- **Fix:** Added type check and Buffer-to-Float32Array conversion using buffer/byteOffset/byteLength
- **Files modified:** src/memory/store.ts
- **Verification:** getEmbedding test passes, returns proper Float32Array
- **Committed in:** 4f2f725 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential for correctness. No scope creep.

## Issues Encountered
None beyond the Buffer conversion deviation noted above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All types, schemas, and pure functions ready for Plan 02 (TierManager orchestration)
- Store methods (listByTier, updateTier, getEmbedding) provide the database interface Plan 02 needs
- tierConfigSchema integrates into memoryConfigSchema for unified configuration

---
*Phase: 08-tiered-memory-storage*
*Completed: 2026-04-09*
