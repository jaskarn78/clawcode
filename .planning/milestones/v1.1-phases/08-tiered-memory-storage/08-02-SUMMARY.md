---
phase: 08-tiered-memory-storage
plan: 02
subsystem: memory
tags: [tier-manager, cold-archival, hot-injection, yaml, base64, system-prompt]

requires:
  - phase: 08-tiered-memory-storage plan 01
    provides: tier column, pure transition functions, store tier methods
provides:
  - TierManager class orchestrating all tier transitions and cold I/O
  - Hot memory injection into agent system prompt via SessionManager
  - Cold archival to markdown with YAML frontmatter and base64 embedding
  - Re-warming from cold with fresh embedding and preserved access_count
  - Cold exclusion from semantic search by design
affects: [cron-scheduler, admin-agent]

tech-stack:
  added: [yaml (stringify/parse for cold archive frontmatter)]
  patterns: [dependency-injected TierManager, cold-as-markdown archival, hot-memory system prompt injection]

key-files:
  created:
    - src/memory/tier-manager.ts
    - src/memory/__tests__/tier-manager.test.ts
  modified:
    - src/memory/index.ts
    - src/manager/session-manager.ts
    - src/memory/search.ts
    - src/memory/__tests__/search.test.ts
    - src/shared/types.ts

key-decisions:
  - "TierManager uses dependency injection (store, embedder, logger) for full testability"
  - "Cold archives use yaml package for frontmatter (not hand-rolled) per research guidance"
  - "initMemory moved before buildSessionConfig in startAgent to enable hot memory injection"
  - "Cold memories excluded from search by deletion (not filter) per D-14 design"

patterns-established:
  - "Cold archival pattern: YAML frontmatter + base64 embedding + markdown body"
  - "Hot injection pattern: TierManager.getHotMemories() -> '## Key Memories' section in system prompt"
  - "Maintenance cycle: demote stale hot, archive cold-worthy warm, promote qualifying warm"

requirements-completed: [AMEM-08, AMEM-09]

duration: 4min
completed: 2026-04-09
---

# Phase 08 Plan 02: TierManager Orchestration Summary

**TierManager class with cold archival to markdown+base64, hot memory injection into system prompt, and full maintenance cycle (demote/archive/promote)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-09T04:36:02Z
- **Completed:** 2026-04-09T04:40:30Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- TierManager class orchestrates all tier transitions: archiveToCold, rewarmFromCold, refreshHotTier, runMaintenance
- Cold archives written as markdown with YAML frontmatter containing all metadata + base64 embedding for fast re-warming
- SessionManager injects hot memories as "## Key Memories" section in agent system prompt on every session start
- Hot tier refreshed before session config is built, ensuring fresh hot selection
- 330 tests passing with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: TierManager class with cold archival, hot refresh, and tier maintenance** - `24913db` (test) + `75d00e1` (feat)
2. **Task 2: Wire hot injection into SessionManager and cold promotion into SemanticSearch** - `a76f6c9` (feat)

## Files Created/Modified
- `src/memory/tier-manager.ts` - TierManager class with all tier transition orchestration
- `src/memory/__tests__/tier-manager.test.ts` - 21 tests covering archival, re-warming, hot refresh, maintenance
- `src/memory/index.ts` - Barrel export for TierManager and utilities
- `src/manager/session-manager.ts` - Hot memory injection, TierManager lifecycle, initMemory reorder
- `src/memory/search.ts` - Cold exclusion documentation comment
- `src/memory/__tests__/search.test.ts` - 2 new tests for cold tier exclusion
- `src/shared/types.ts` - Added optional tiers field to ResolvedAgentConfig memory type

## Decisions Made
- TierManager uses dependency injection for store, embedder, logger, and config (testability)
- Cold archives use the `yaml` package for frontmatter serialization (not hand-rolled)
- Moved initMemory before buildSessionConfig in startAgent to enable hot memory injection at session start
- Cold memories excluded from search by SQLite deletion (D-14), not runtime filtering

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added tiers field to ResolvedAgentConfig**
- **Found during:** Task 2 (SessionManager wiring)
- **Issue:** ResolvedAgentConfig.memory type did not have a tiers field, causing type error when accessing config.memory.tiers
- **Fix:** Added optional tiers field to the memory type in src/shared/types.ts
- **Files modified:** src/shared/types.ts
- **Verification:** Full test suite passes (330 tests)
- **Committed in:** a76f6c9 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for type safety. No scope creep.

## Issues Encountered
None

## Known Stubs
None - all data paths are fully wired.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Tier system fully operational: hot/warm/cold transitions, cold archival, hot injection
- Ready for cron/scheduler integration to run maintenance cycles periodically
- TierManager.runMaintenance() can be called from heartbeat checks

---
*Phase: 08-tiered-memory-storage*
*Completed: 2026-04-09*
