# Phase 7: Memory Relevance & Deduplication - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds relevance decay and deduplication to the memory system. After this phase, unaccessed memories lose relevance over time, search results factor in recency/access frequency, and semantically duplicate memories auto-merge on write. No tiering — that builds on top of this.

</domain>

<decisions>
## Implementation Decisions

### Relevance Decay
- **D-01:** Each memory entry has a `relevanceScore` (0-1 float) that decays over time based on last access
- **D-02:** Decay formula: `score = baseImportance * decayFactor^(daysSinceAccess / halfLifeDays)` — exponential decay with configurable half-life
- **D-03:** Default half-life: 30 days (configurable in clawcode.yaml)
- **D-04:** Relevance score recalculated on search — not stored/updated continuously
- **D-05:** Accessing a memory (search hit) resets its `accessed_at` timestamp, effectively resetting decay

### Search Integration
- **D-06:** Memory search combines semantic similarity score with relevance decay score
- **D-07:** Combined score: `finalScore = semanticSimilarity * relevanceWeight + relevanceScore * decayWeight` (configurable weights)
- **D-08:** Default weights: 0.7 semantic + 0.3 relevance (prioritize content match, penalize staleness)

### Deduplication
- **D-09:** On memory insert, check for semantic duplicates above a configurable similarity threshold (default 0.85)
- **D-10:** If duplicate found: merge into existing entry — update content to newest, keep highest importance, increment access_count, merge tags
- **D-11:** Deduplication uses the same embedding/vector search infrastructure from Phase 4
- **D-12:** Deduplication is optional per-insert (flag to skip for manual/system memories that intentionally repeat)

### Claude's Discretion
- Exact decay math implementation details
- Whether to add a `clawcode memory gc` command for manual cleanup
- Minimum relevance threshold below which memories are candidates for cold storage (Phase 8 prep)

</decisions>

<canonical_refs>
## Canonical References

### Existing Codebase
- `src/memory/store.ts` — MemoryStore (extend insert with dedup, search with relevance)
- `src/memory/search.ts` — SemanticSearch (extend scoring with decay)
- `src/memory/types.ts` — MemoryEntry (already has access_count, accessed_at, importance)
- `src/memory/embedder.ts` — EmbeddingService (reuse for dedup similarity check)
- `src/memory/schema.ts` — Memory config schema (extend with decay/dedup settings)
- `src/config/schema.ts` — Config schema

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/memory/search.ts`: SemanticSearch with vec0 KNN — extend scoring function
- `src/memory/store.ts`: MemoryStore.insert() — add dedup check before insert
- `src/memory/embedder.ts`: EmbeddingService — generate embeddings for dedup comparison

### Integration Points
- MemoryStore.insert(): add dedup logic
- SemanticSearch.search(): add relevance decay to scoring
- Config schema: add decay/dedup settings

</code_context>

<specifics>
## Specific Ideas
- Decay calculation should be a pure function for easy testing
- Dedup merge should log what was merged for debugging

</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 07-memory-relevance-deduplication*
*Context gathered: 2026-04-09*
