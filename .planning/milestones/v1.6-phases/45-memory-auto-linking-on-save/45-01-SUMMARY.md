---
phase: 45-memory-auto-linking-on-save
plan: 01
subsystem: memory
tags: [sqlite-vec, knn, knowledge-graph, auto-linking, cosine-similarity]

requires:
  - phase: 38-graph-enriched-search-auto-linker
    provides: discoverAutoLinks batch auto-linker, cosineSimilarity, memory_links table
provides:
  - autoLinkMemory(store, memoryId) for single-memory eager auto-linking
  - MemoryStore.insert() eagerly auto-links on both insert and merge paths
affects: [heartbeat-auto-linker, memory-store, graph-search]

tech-stack:
  added: []
  patterns: [eager-link-on-write, non-fatal-graph-enrichment]

key-files:
  created: [src/memory/__tests__/similarity.test.ts]
  modified: [src/memory/similarity.ts, src/memory/store.ts, src/memory/__tests__/graph.test.ts]

key-decisions:
  - "autoLinkMemory called outside insert transaction so KNN can find the newly committed embedding"
  - "Non-fatal try/catch: auto-linking failures never break memory insertion"
  - "Heartbeat auto-linker unchanged as 6h background catch-all"

patterns-established:
  - "Eager-link-on-write: graph enrichment at write time with background catch-all for missed links"
  - "Non-fatal enrichment: try/catch around optional graph operations after core write succeeds"

requirements-completed: [AUTOLINK-01]

duration: 5min
completed: 2026-04-12
---

# Phase 45 Plan 01: Memory Auto-Linking on Save Summary

**Eager auto-linking on memory insert/merge via KNN similarity search with bidirectional edges and non-fatal failure handling**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-12T01:51:45Z
- **Completed:** 2026-04-12T01:57:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- New `autoLinkMemory(store, memoryId, config?)` function for single-memory eager auto-linking
- MemoryStore.insert() now calls autoLinkMemory after both normal insert and merge (dedup) paths
- Auto-linking failures are non-fatal -- heartbeat auto-linker still runs every 6h as catch-all
- 10 new tests covering all edge cases (cold-tier skip, existing links, no embedding, threshold override)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create autoLinkMemory function and tests** - `b982475` (feat, TDD)
2. **Task 2: Hook autoLinkMemory into MemoryStore.insert** - `18f451b` (feat)

## Files Created/Modified
- `src/memory/similarity.ts` - Added autoLinkMemory() for single-memory KNN neighbor linking
- `src/memory/__tests__/similarity.test.ts` - 10 tests for autoLinkMemory + cosineSimilarity + discoverAutoLinks
- `src/memory/store.ts` - Wired autoLinkMemory into insert() for both insert and merge paths
- `src/memory/__tests__/graph.test.ts` - Updated assertion to filter auto:similar edges in wikilink-specific test

## Decisions Made
- autoLinkMemory called OUTSIDE the insert transaction so the newly committed embedding is visible to KNN search
- Non-fatal try/catch wrapping ensures auto-linking failures never break memory insertion
- Heartbeat auto-linker left completely unchanged as background catch-all

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed graph.test.ts assertion broken by eager auto-linking**
- **Found during:** Task 2 (hook into store.ts)
- **Issue:** "creates multiple edges for multiple existing targets" test expected exactly 2 wikilink edges but got 4 because zero-embedding memories are now auto-linked too
- **Fix:** Filtered assertion query to exclude auto:similar edges (`WHERE link_text != 'auto:similar'`)
- **Files modified:** src/memory/__tests__/graph.test.ts
- **Verification:** All 302 graph tests pass
- **Committed in:** 18f451b (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test assertion fix necessary for correctness. No scope creep.

## Issues Encountered
None

## Known Stubs
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Eager auto-linking is live on every memory write
- Graph-enriched search immediately benefits from new memories
- Heartbeat auto-linker remains as safety net for edge cases

---
*Phase: 45-memory-auto-linking-on-save*
*Completed: 2026-04-12*
