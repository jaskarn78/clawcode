---
phase: 07-memory-relevance-deduplication
plan: 01
subsystem: memory
tags: [decay, relevance, scoring, zod, exponential-decay]

requires:
  - phase: 06-memory-consolidation
    provides: memoryConfigSchema, consolidation config pattern
provides:
  - calculateRelevanceScore pure function with exponential half-life decay
  - scoreAndRank combined scoring and re-ranking function
  - distanceToSimilarity helper
  - decayConfigSchema and dedupConfigSchema extensions to memoryConfigSchema
affects: [07-02-deduplication, 07-03-search-integration]

tech-stack:
  added: []
  patterns: [exponential-half-life-decay, combined-weighted-scoring, distance-to-similarity-conversion]

key-files:
  created:
    - src/memory/decay.ts
    - src/memory/relevance.ts
    - src/memory/__tests__/decay.test.ts
    - src/memory/__tests__/relevance.test.ts
  modified:
    - src/memory/schema.ts
    - src/config/schema.ts
    - src/shared/types.ts
    - src/heartbeat/__tests__/runner.test.ts
    - src/discord/__tests__/router.test.ts
    - src/agent/__tests__/workspace.test.ts
    - src/manager/__tests__/session-manager.test.ts
    - src/config/__tests__/loader.test.ts

key-decisions:
  - "Exponential half-life formula: importance * 0.5^(days/halfLifeDays) for predictable decay curve"
  - "distanceToSimilarity clamped both lower and upper bounds to handle negative cosine distances"

patterns-established:
  - "Decay scoring: pure function with DecayParams config, clamped to [0,1]"
  - "Combined scoring: semanticWeight * similarity + decayWeight * relevance, frozen output"

requirements-completed: [AMEM-04, AMEM-05]

duration: 3min
completed: 2026-04-09
---

# Phase 7 Plan 1: Decay Scoring and Combined Relevance Summary

**Exponential half-life decay scoring with configurable weights and combined semantic+relevance re-ranking**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-09T04:10:38Z
- **Completed:** 2026-04-09T04:14:02Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Implemented calculateRelevanceScore with exponential half-life decay (importance * 0.5^(days/halfLifeDays))
- Built scoreAndRank function combining semantic similarity and relevance decay with configurable weights
- Extended memoryConfigSchema with decayConfigSchema and dedupConfigSchema
- Updated ResolvedAgentConfig type and all existing test fixtures for type safety

## Task Commits

Each task was committed atomically:

1. **Task 1: Config schema extensions, decay function, and decay tests** - `a504c38` (feat)
2. **Task 2: Combined scoring function and relevance tests** - `3f3b3e8` (feat)

## Files Created/Modified
- `src/memory/decay.ts` - Pure function for exponential half-life relevance decay
- `src/memory/relevance.ts` - Combined scoring with distanceToSimilarity and scoreAndRank
- `src/memory/__tests__/decay.test.ts` - 14 tests for decay function and config schemas
- `src/memory/__tests__/relevance.test.ts` - 11 tests for similarity conversion and re-ranking
- `src/memory/schema.ts` - Added decayConfigSchema, dedupConfigSchema, extended memoryConfigSchema
- `src/config/schema.ts` - Updated defaults to include decay and deduplication settings
- `src/shared/types.ts` - Added decay and deduplication to ResolvedAgentConfig.memory type
- `src/heartbeat/__tests__/runner.test.ts` - Updated mock configs with new memory fields
- `src/discord/__tests__/router.test.ts` - Updated mock configs with new memory fields
- `src/agent/__tests__/workspace.test.ts` - Updated mock configs with new memory fields
- `src/manager/__tests__/session-manager.test.ts` - Updated mock configs with new memory fields
- `src/config/__tests__/loader.test.ts` - Updated mock configs with new memory fields

## Decisions Made
- Exponential half-life formula chosen for predictable, tunable decay (importance * 0.5^(days/halfLifeDays))
- distanceToSimilarity clamps both bounds (min 0, max 1) to handle edge cases with negative cosine distances

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated existing test fixtures for type compatibility**
- **Found during:** Task 1
- **Issue:** Adding decay and deduplication fields to ResolvedAgentConfig broke 8 existing test files that construct mock configs
- **Fix:** Added decay and deduplication default values to all mock ResolvedAgentConfig objects across 5 test files
- **Files modified:** runner.test.ts, router.test.ts, workspace.test.ts, session-manager.test.ts, loader.test.ts
- **Verification:** npx tsc --noEmit passes clean
- **Committed in:** a504c38 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed distanceToSimilarity upper bound clamping**
- **Found during:** Task 2
- **Issue:** Negative distances produced similarity > 1.0 (Math.max(0, 1 - (-0.5)) = 1.5)
- **Fix:** Added Math.min(1, ...) wrapper to clamp upper bound
- **Files modified:** src/memory/relevance.ts
- **Verification:** Test for negative distance now passes
- **Committed in:** 3f3b3e8 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Decay scoring and combined ranking ready for search integration (Plan 03)
- Config schemas ready for deduplication logic (Plan 02)
- All 25 new tests passing, TypeScript compiles clean

---
*Phase: 07-memory-relevance-deduplication*
*Completed: 2026-04-09*
