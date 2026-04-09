---
phase: 25-episode-memory
plan: 02
subsystem: memory
tags: [sqlite, episode, archival, cold-tier, cli, memory]

requires:
  - phase: 25-episode-memory-01
    provides: EpisodeStore, episode source type, episodeConfigSchema
provides:
  - archiveOldEpisodes function for monthly episode archival pipeline
  - CLI memory episodes subcommand for operator visibility
  - EpisodeArchivalResult type for pipeline results
affects: [agent-session, cron-scheduling, memory-cli]

tech-stack:
  added: []
  patterns: [error-tolerant-archival-pipeline, cli-ipc-episode-subcommand]

key-files:
  created:
    - src/memory/episode-archival.ts
    - src/memory/__tests__/episode-archival.test.ts
  modified:
    - src/cli/commands/memory.ts

key-decisions:
  - "Episode archival deletes vec_memories rows (not just tier change) to fully remove from semantic search"
  - "CLI episodes subcommand uses IPC pattern matching existing memory search/list commands"

patterns-established:
  - "Episode archival follows same error-tolerant loop pattern as archiveDailyLogs in consolidation.ts"
  - "CLI episode title parsed from structured content format [Episode: {title}]"

requirements-completed: [EPSD-04]

duration: 2min
completed: 2026-04-09
---

# Phase 25 Plan 02: Episode Archival Pipeline and CLI Integration Summary

**Episode archival pipeline moving old episodes to cold tier with vec_memories removal, plus CLI episodes subcommand for operator visibility**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-09T20:09:41Z
- **Completed:** 2026-04-09T20:12:07Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- archiveOldEpisodes function archives episodes older than configurable threshold to cold tier and removes from vector search
- Error-tolerant pipeline: individual episode failures don't stop the archival run
- CLI `memory episodes <agent>` subcommand with --count and --limit options
- 7 comprehensive test cases covering all archival edge cases

## Task Commits

Each task was committed atomically:

1. **Task 1: Episode archival pipeline** - `c7db0f9` (feat)
2. **Task 2: CLI memory episodes subcommand** - `ee1196d` (feat)

## Files Created/Modified
- `src/memory/episode-archival.ts` - archiveOldEpisodes function with EpisodeArchivalResult type
- `src/memory/__tests__/episode-archival.test.ts` - 7 test cases for archival pipeline
- `src/cli/commands/memory.ts` - Added episodes subcommand with list, count, and limit options

## Decisions Made
- Episode archival deletes from vec_memories (not just tier change) to fully exclude archived episodes from KNN search results
- CLI episodes subcommand follows the same IPC request pattern as existing search/list commands for consistency
- Episode title parsed from structured content format `[Episode: {title}]` for clean CLI display

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed archivalAgeDays=0 test race condition**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** Test for archivalAgeDays=0 failed because episodes created at exact same millisecond as cutoff were not strictly less than cutoff
- **Fix:** Backdated test episodes by 1 second to ensure they fall before the cutoff timestamp
- **Files modified:** src/memory/__tests__/episode-archival.test.ts
- **Committed in:** c7db0f9 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor test timing fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all functionality is fully wired.

## Next Phase Readiness
- Episode archival ready for integration with cron scheduling (monthly archival job)
- CLI episode visibility enables operators to monitor episode counts and listings
- archiveOldEpisodes accepts MemoryStore directly, ready for agent-level invocation

---
*Phase: 25-episode-memory*
*Completed: 2026-04-09*
