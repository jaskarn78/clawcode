---
phase: 38-graph-intelligence
plan: 02
subsystem: memory
tags: [sqlite-vec, cosine-similarity, knowledge-graph, heartbeat, auto-linker]

requires:
  - phase: 36-knowledge-graph-foundation
    provides: memory_links table, insertLink/getGraphStatements on MemoryStore
provides:
  - Auto-linker heartbeat check (discoverAutoLinks, cosineSimilarity)
  - Bidirectional auto:similar edge creation for semantically related memories
affects: [graph-enriched-search, memory-consolidation]

tech-stack:
  added: []
  patterns: [auto-discovery heartbeat check, KNN-to-edge pipeline, bidirectional graph edges]

key-files:
  created:
    - src/memory/similarity.ts
    - src/heartbeat/checks/auto-linker.ts
    - src/heartbeat/checks/__tests__/auto-linker.test.ts
  modified: []

key-decisions:
  - "Convert sqlite-vec cosine distance to similarity via 1 - distance"
  - "Skip cold-tier neighbors (not just cold-tier candidates) to prevent linking into frozen memories"

patterns-established:
  - "Auto-link edges use link_text 'auto:similar' to distinguish from wikilink-created edges"
  - "Heartbeat check uses per-agent concurrency lock (Set) matching consolidation pattern"

requirements-completed: [GRAPH-04]

duration: 10min
completed: 2026-04-10
---

# Phase 38 Plan 02: Auto-Linker Summary

**Background auto-linker heartbeat check discovers semantically similar unlinked memories and creates bidirectional graph edges with cosineSimilarity utility**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-10T21:44:35Z
- **Completed:** 2026-04-10T21:54:47Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments
- cosineSimilarity utility for dot-product similarity on normalized embeddings
- discoverAutoLinks function: scans candidates via SQL, KNN via sqlite-vec, creates bidirectional edges
- Auto-linker heartbeat check running every 6 hours with batch size 50 and 0.6 similarity threshold
- 9 unit tests covering similarity math, edge creation, cold-tier skipping, existing edge dedup, batch limits

## Task Commits

Each task was committed atomically:

1. **Task 1: Create similarity utility and auto-linker heartbeat check with tests** - `bd073ac` (feat)

## Files Created/Modified
- `src/memory/similarity.ts` - cosineSimilarity() and discoverAutoLinks() with AutoLinkConfig/AutoLinkResult types
- `src/heartbeat/checks/auto-linker.ts` - Auto-linker heartbeat check module (6h interval, 60s timeout, concurrency lock)
- `src/heartbeat/checks/__tests__/auto-linker.test.ts` - 9 tests covering all required behaviors

## Decisions Made
- Convert sqlite-vec cosine distance to similarity via `1 - distance` (sqlite-vec cosine metric returns distance, not similarity)
- Skip cold-tier neighbors (not just candidates) to prevent warm memories from linking to frozen memories (deviation Rule 1)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cold-tier neighbor filtering**
- **Found during:** Task 1 (auto-linker implementation)
- **Issue:** Plan only excluded cold-tier memories as candidates, but warm candidates could still link TO cold-tier neighbors found via KNN
- **Fix:** Added a tier check on each KNN neighbor before creating edges
- **Files modified:** src/memory/similarity.ts
- **Verification:** Test "skips cold-tier memories" passes
- **Committed in:** bd073ac (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential correctness fix preventing links to frozen memories. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Auto-linker ready for integration with graph-enriched search (38-01)
- Knowledge graph now grows automatically from both wikilinks and semantic similarity

---
*Phase: 38-graph-intelligence*
*Completed: 2026-04-10*
