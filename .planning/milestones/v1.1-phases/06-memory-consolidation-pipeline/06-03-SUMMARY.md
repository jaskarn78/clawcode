---
phase: 06-memory-consolidation-pipeline
plan: 03
subsystem: memory
tags: [heartbeat, consolidation, llm-summarization, per-check-timeout]

requires:
  - phase: 06-memory-consolidation-pipeline-02
    provides: runConsolidation pipeline function, ConsolidationDeps interface
  - phase: 05-heartbeat-framework
    provides: HeartbeatRunner, CheckModule, auto-discovery from checks directory
  - phase: 06-memory-consolidation-pipeline-01
    provides: SessionManager accessors (getMemoryStore, getEmbedder, getAgentConfig, sendToAgent)
provides:
  - Consolidation heartbeat check module auto-discovered by HeartbeatRunner
  - Per-check timeout override on CheckModule type
  - Daily scheduled consolidation with concurrency lock per agent
affects: [heartbeat, memory-consolidation, agent-lifecycle]

tech-stack:
  added: []
  patterns: [per-check-timeout-override, set-based-concurrency-lock, sendToAgent-as-summarizer]

key-files:
  created:
    - src/heartbeat/checks/consolidation.ts
    - src/heartbeat/checks/__tests__/consolidation.test.ts
  modified:
    - src/heartbeat/types.ts
    - src/heartbeat/runner.ts

key-decisions:
  - "Per-check timeout as optional CheckModule property (backward-compatible, no runner API change)"
  - "Set-based concurrency lock (not file-based) since runner executes sequentially per agent within single process"
  - "Warning status (not critical) for consolidation failures -- retries next daily cycle"

patterns-established:
  - "Per-check timeout: CheckModule.timeout overrides config.checkTimeoutSeconds for long-running checks"
  - "Concurrency guard: Set<agentName> lock with try/finally release pattern"

requirements-completed: [AMEM-01, AMEM-02, AMEM-03]

duration: 2min
completed: 2026-04-09
---

# Phase 6 Plan 3: Consolidation Heartbeat Check Summary

**Daily consolidation heartbeat check wired to HeartbeatRunner with per-check timeout override and Set-based concurrency lock**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-09T03:55:16Z
- **Completed:** 2026-04-09T03:57:19Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added per-check timeout property to CheckModule type with backward-compatible fallback in HeartbeatRunner
- Implemented consolidation heartbeat check that runs daily (86400s interval) with 120s timeout for LLM summarization
- Wired sendToAgent as the summarization function connecting consolidation pipeline to agent's own session
- Built Set-based per-agent concurrency lock with guaranteed release via try/finally
- Full integration test coverage (7 tests) covering success, partial failure, no-work, missing config, concurrency, and lock release

## Task Commits

Each task was committed atomically:

1. **Task 1: Add per-check timeout to CheckModule and update HeartbeatRunner** - `60fae56` (feat)
2. **Task 2 RED: Failing tests for consolidation heartbeat check** - `331f464` (test)
3. **Task 2 GREEN: Implement consolidation heartbeat check module** - `3eaa930` (feat)

## Files Created/Modified
- `src/heartbeat/types.ts` - Added optional timeout property to CheckModule
- `src/heartbeat/runner.ts` - Updated tick() to use check.timeout when available
- `src/heartbeat/checks/consolidation.ts` - Consolidation check with daily interval, 120s timeout, concurrency lock
- `src/heartbeat/checks/__tests__/consolidation.test.ts` - 7 integration tests for all consolidation check behaviors

## Decisions Made
- Per-check timeout as optional CheckModule property -- backward-compatible, existing checks unaffected
- Set-based concurrency lock (not file-based) since HeartbeatRunner runs checks sequentially within a single process
- Warning status for consolidation failures -- non-critical since it retries on next daily cycle
- _resetLock() test helper exported with underscore prefix to signal internal-only use

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all functionality is fully wired.

## Next Phase Readiness
- Phase 6 (memory-consolidation-pipeline) is now complete with all 3 plans executed
- Consolidation pipeline runs automatically via heartbeat on a daily schedule
- Ready for next milestone features (memory relevance decay, deduplication, tiered storage)

## Self-Check: PASSED

---
*Phase: 06-memory-consolidation-pipeline*
*Completed: 2026-04-09*
