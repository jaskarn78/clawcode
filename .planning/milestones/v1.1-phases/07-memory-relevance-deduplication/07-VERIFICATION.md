---
phase: 07-memory-relevance-deduplication
verified: 2026-04-08T04:21:00Z
status: passed
score: 14/14 must-haves verified
re_verification: false
---

# Phase 7: Memory Relevance and Deduplication — Verification Report

**Phase Goal:** Memory search surfaces what matters — recent and frequently accessed memories rank higher, and redundant entries collapse into single authoritative facts
**Verified:** 2026-04-08T04:21:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A memory not accessed for 60 days has a lower relevance score than one accessed today, given equal importance | VERIFIED | `decay.ts` exponential formula + test "returns ~quarter importance at two half-lives (60 days)" passes |
| 2 | Relevance decay follows exponential half-life formula with configurable halfLifeDays | VERIFIED | `calculateRelevanceScore` uses `importance * Math.pow(0.5, daysSinceAccess / config.halfLifeDays)` |
| 3 | Combined scoring re-ranks search results using semantic similarity * 0.7 + relevance * 0.3 | VERIFIED | `scoreAndRank` in `relevance.ts` implements weighted sum; integration test in `search.test.ts` "recently accessed memory ranks higher" passes |
| 4 | Config schema accepts decay and deduplication settings with sensible defaults | VERIFIED | `schema.ts` exports `decayConfigSchema` (halfLifeDays=30, semanticWeight=0.7, decayWeight=0.3) and `dedupConfigSchema` (enabled=true, similarityThreshold=0.85) |
| 5 | When a new memory with similarity >= 0.85 to an existing entry is inserted, the existing entry is updated (merged) instead of creating a duplicate | VERIFIED | `store.ts` calls `checkForDuplicate` then `mergeMemory`; store.test.ts "merges near-duplicate embedding" passes |
| 6 | The merged entry has the highest importance of the two | VERIFIED | `mergeMemory` uses `Math.max(existing.importance, input.importance)`; test "merged entry keeps max importance" passes |
| 7 | The merged entry has the union of both tag sets | VERIFIED | `mergeMemory` uses `[...new Set([...existingTags, ...input.tags])]`; test "unions tags from both entries without duplicates" passes |
| 8 | The merged entry content is updated to the newest version | VERIFIED | `UPDATE memories SET content = ?` uses `input.content`; test "updates content to new value" passes |
| 9 | When skipDedup is true, deduplication is bypassed entirely | VERIFIED | `store.ts` checks `!input.skipDedup`; test "skipDedup creates new entry" confirms two entries remain |
| 10 | SemanticSearch.search() returns results ranked by combined semantic+relevance score, not just cosine distance | VERIFIED | `search.ts` calls `scoreAndRank()` before trimming to topK; integration test confirms recently accessed ranks first |
| 11 | SemanticSearch.search() over-fetches by 2x from KNN then trims to topK after re-ranking | VERIFIED | `search.ts` line: `const fetchK = topK * 2;` |
| 12 | SemanticSearch.search() only updates accessed_at for the final top-K results (not over-fetched ones) | VERIFIED | Access update loop is on `topResults` (post-trim), not `ranked`; test "accessed_at is updated after search for returned results" passes |
| 13 | MemoryStore.insert() checks for duplicates before inserting and merges if similarity >= threshold | VERIFIED | `store.ts` dedup check runs before insert path; tested end-to-end in `store.test.ts` |
| 14 | CreateMemoryInput type includes optional skipDedup field | VERIFIED | `types.ts` contains `readonly skipDedup?: boolean` |

**Score:** 14/14 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/memory/decay.ts` | `calculateRelevanceScore` pure function | VERIFIED | Exports `calculateRelevanceScore` and `DecayParams`; exponential half-life formula; clamped to [0,1] |
| `src/memory/relevance.ts` | `scoreAndRank`, `distanceToSimilarity` | VERIFIED | Both exported; `RankedSearchResult` type; frozen return values |
| `src/memory/schema.ts` | `decayConfigSchema`, `dedupConfigSchema` added to `memoryConfigSchema` | VERIFIED | Both schemas present; integrated into `memoryConfigSchema` with defaults |
| `src/memory/dedup.ts` | `checkForDuplicate` and `mergeMemory` | VERIFIED | Both exported; KNN query with k=1; transaction-wrapped merge |
| `src/memory/search.ts` | SemanticSearch with relevance-aware ranking | VERIFIED | Imports `scoreAndRank`; over-fetches 2x; access update only on top-K |
| `src/memory/store.ts` | MemoryStore.insert with dedup-on-write | VERIFIED | Imports `checkForDuplicate`, `mergeMemory`; conditional dedup path |
| `src/memory/types.ts` | Extended `CreateMemoryInput` with `skipDedup`, `RankedSearchResult` re-exported | VERIFIED | `skipDedup?: boolean` present; `RankedSearchResult` re-exported from `relevance.js` |
| `src/memory/__tests__/decay.test.ts` | Unit tests for decay function | VERIFIED | 14 tests — half-life at 30/60 days, clamping, future dates, schema validation |
| `src/memory/__tests__/relevance.test.ts` | Unit tests for combined scoring | VERIFIED | Tests distanceToSimilarity edges, re-ranking, frozen results, empty input |
| `src/memory/__tests__/dedup.test.ts` | Unit and integration tests for dedup | VERIFIED | 10 tests — empty DB, above/below threshold, content/importance/tags/embedding updates, MemoryError throw |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/memory/relevance.ts` | `src/memory/decay.ts` | `import calculateRelevanceScore` | WIRED | Line 9: `import { calculateRelevanceScore } from "./decay.js"` |
| `src/memory/schema.ts` | `memoryConfigSchema` | `decay` and `deduplication` fields added | WIRED | Lines 49-57: both fields present with defaults |
| `src/memory/search.ts` | `src/memory/relevance.ts` | `import scoreAndRank` | WIRED | Line 3: `import { scoreAndRank, type ScoringConfig, type RankedSearchResult } from "./relevance.js"` |
| `src/memory/store.ts` | `src/memory/dedup.ts` | `import checkForDuplicate, mergeMemory` | WIRED | Line 6: `import { checkForDuplicate, mergeMemory } from "./dedup.js"` |
| `src/memory/search.ts` | `src/memory/schema.ts` | `DecayConfig` for scoring parameters | WIRED | `ScoringConfig` shape aligns with `decayConfigSchema`; `DEFAULT_SCORING_CONFIG` uses schema defaults |
| `src/memory/dedup.ts` | `vec_memories` table | KNN query with k=1 | WIRED | `SELECT memory_id, distance FROM vec_memories WHERE embedding MATCH ? AND k = 1` |
| `src/memory/dedup.ts` | `memories` table | UPDATE for merge, SELECT for existing | WIRED | `UPDATE memories SET content = ?, importance = ?, ...` present in transaction |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `search.ts` SemanticSearch.search | `ranked` (RankedSearchResult[]) | `scoreAndRank(searchResults, this.scoringConfig, new Date())` fed from KNN query results | Yes — KNN rows from `vec_memories JOIN memories`, scored then sorted | FLOWING |
| `store.ts` MemoryStore.insert | `merged` (MemoryEntry) | `this.getById(dedupResult.existingId)` after `mergeMemory` writes to DB | Yes — reads live DB row after merge transaction | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| decay tests pass (half-life at 30 days, 60 days, clamping) | `npx vitest run src/memory/__tests__/decay.test.ts` | 14/14 tests passed | PASS |
| relevance tests pass (re-ranking, frozen results) | `npx vitest run src/memory/__tests__/relevance.test.ts` | 7/7 tests passed | PASS |
| dedup tests pass (merge/insert decision, merge fields) | `npx vitest run src/memory/__tests__/dedup.test.ts` | 10/10 tests passed | PASS |
| integration tests pass (search ranking, store dedup) | `npx vitest run src/memory/__tests__/search.test.ts src/memory/__tests__/store.test.ts` | 29/29 tests passed | PASS |
| full test suite passes (no regressions) | `npx vitest run` | 276/276 tests passed (26 test files) | PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | No output (zero errors) | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AMEM-04 | Plans 01, 03 | Unaccessed memories lose relevance score over time based on configurable decay rate | SATISFIED | `decay.ts` exponential formula; `decayConfigSchema` with `halfLifeDays`; wired into `search.ts` via `scoreAndRank` |
| AMEM-05 | Plans 01, 03 | Memory search results factor in relevance decay (recent/accessed memories rank higher) | SATISFIED | `scoreAndRank` in `search.ts` produces `combinedScore`; integration test proves recently accessed ranks first |
| AMEM-06 | Plans 02, 03 | Semantically similar memories automatically merged into single authoritative entry on write | SATISFIED | `checkForDuplicate` + `mergeMemory` wired into `MemoryStore.insert`; store integration test proves single entry after duplicate insert |
| AMEM-07 | Plans 02, 03 | Deduplication preserves highest importance score and merges metadata | SATISFIED | `Math.max(existing.importance, input.importance)` and `new Set([...existingTags, ...input.tags])` in `mergeMemory`; tested explicitly |

---

### Anti-Patterns Found

No anti-patterns detected across the five modified source files (`decay.ts`, `relevance.ts`, `dedup.ts`, `search.ts`, `store.ts`). No TODO/FIXME comments, no stub returns, no hardcoded empty collections that flow to output.

---

### Human Verification Required

None. All behaviors are programmatically verifiable and confirmed by the test suite.

---

### Gaps Summary

No gaps. All must-haves from Plans 01, 02, and 03 are verified at all levels:

- Level 1 (exists): All 10 required files exist
- Level 2 (substantive): All files contain real implementations matching their specified behavior
- Level 3 (wired): All key links confirmed via import inspection and test execution
- Level 4 (data flows): Search and insert pipelines trace through to real DB queries

The full 276-test suite passes with zero regressions, and TypeScript compiles clean.

---

_Verified: 2026-04-08T04:21:00Z_
_Verifier: Claude (gsd-verifier)_
