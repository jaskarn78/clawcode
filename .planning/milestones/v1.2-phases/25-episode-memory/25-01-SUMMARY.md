---
phase: 25-episode-memory
plan: 01
subsystem: memory
tags: [sqlite, episode, memory, semantic-search, zod]

requires:
  - phase: 05-memory
    provides: MemoryStore, SemanticSearch, EmbeddingService, sqlite-vec
provides:
  - EpisodeStore class with recordEpisode, listEpisodes, getEpisodeCount
  - EpisodeInput type and 'episode' MemorySource value
  - episodeInputSchema and episodeConfigSchema for validation
  - Schema migration for existing databases to accept 'episode' source
affects: [25-02-episode-memory, memory-cli, agent-session]

tech-stack:
  added: []
  patterns: [episode-as-memory-entry, structured-content-format, source-migration-pattern]

key-files:
  created:
    - src/memory/episode-store.ts
    - src/memory/__tests__/episode-store.test.ts
  modified:
    - src/memory/types.ts
    - src/memory/schema.ts
    - src/memory/store.ts
    - src/memory/__tests__/store.test.ts

key-decisions:
  - "Episodes stored as standard MemoryEntry with source='episode' and structured content format [Episode: {title}]\\n\\n{summary}"
  - "Episode tags always auto-include 'episode' prefix for filtering, with user tag deduplication"
  - "skipDedup=true for episode inserts since each episode is a unique event"

patterns-established:
  - "Episode content format: [Episode: {title}]\\n\\n{summary} for search relevance"
  - "Source migration pattern: savepoint-test then table recreation (migrateEpisodeSource)"

requirements-completed: [EPSD-01, EPSD-02, EPSD-03]

duration: 3min
completed: 2026-04-09
---

# Phase 25 Plan 01: Episode Memory Types, Storage, and Search Summary

**EpisodeStore with structured content format, schema migration, and semantic search integration via existing MemoryStore/sqlite-vec infrastructure**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-09T20:04:45Z
- **Completed:** 2026-04-09T20:07:54Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added 'episode' to MemorySource union with EpisodeInput type and zod validation schemas
- EpisodeStore class records, lists, and counts episodes as first-class memory entries
- Episodes participate in semantic search via shared vec_memories KNN table
- Schema migration handles existing databases gracefully with savepoint-test pattern
- 8 new episode-store tests + 1 updated store test, all 169 memory tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Episode types, schema migration, and source expansion** - `679c6f2` (feat)
2. **Task 2: EpisodeStore class with record, list, and search integration** - `1bab9ae` (feat)

## Files Created/Modified
- `src/memory/types.ts` - Added 'episode' to MemorySource, EpisodeInput type
- `src/memory/schema.ts` - episodeInputSchema, episodeConfigSchema, episodes in memoryConfigSchema
- `src/memory/store.ts` - Updated CHECK constraints, added migrateEpisodeSource()
- `src/memory/episode-store.ts` - EpisodeStore class with recordEpisode, listEpisodes, getEpisodeCount
- `src/memory/__tests__/store.test.ts` - Updated source validation test to include 'episode'
- `src/memory/__tests__/episode-store.test.ts` - 8 test cases for episode storage, retrieval, and search

## Decisions Made
- Episodes stored as standard MemoryEntry with source='episode' -- no separate table needed, episodes participate in existing KNN search
- Content formatted as `[Episode: {title}]\n\n{summary}` for search relevance and readability
- skipDedup=true for episode inserts since each episode represents a unique discrete event
- Default importance 0.6 (higher than regular memory default of 0.5) reflecting episode significance

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all functionality is fully wired.

## Next Phase Readiness
- EpisodeStore ready for integration with agent sessions (Plan 25-02)
- Episode types and schemas available for CLI tooling
- Semantic search works for episodes alongside regular memories

---
*Phase: 25-episode-memory*
*Completed: 2026-04-09*
