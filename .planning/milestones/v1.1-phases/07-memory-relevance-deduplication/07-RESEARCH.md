# Phase 7: Memory Relevance & Deduplication - Research

**Researched:** 2026-04-08
**Domain:** Memory scoring, temporal decay, semantic deduplication
**Confidence:** HIGH

## Summary

Phase 7 adds two capabilities to the existing memory system: (1) relevance decay that penalizes stale/unaccessed memories in search results, and (2) semantic deduplication that merges near-duplicate memories on insert. Both build directly on the existing `MemoryStore`, `SemanticSearch`, and `EmbeddingService` classes without requiring new dependencies.

The existing codebase already has the required fields (`importance`, `access_count`, `accessed_at`) in the `memories` table and the `MemoryEntry` type. The `vec_memories` virtual table uses cosine distance via sqlite-vec, which returns values in range [0, 2] where 0 = identical. Similarity is computed as `1 - distance`. The deduplication check on insert reuses the same vector search infrastructure -- embed the new content, KNN search with k=1, check if distance is below threshold.

**Primary recommendation:** Implement decay as a pure function (`calculateRelevanceScore`) and deduplication as a pre-insert check in `MemoryStore.insert()`. Extend `SemanticSearch.search()` to re-rank results using the combined semantic+relevance score. All new logic should be in separate files (`src/memory/decay.ts`, `src/memory/dedup.ts`) to keep existing files focused.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Each memory entry has a `relevanceScore` (0-1 float) that decays over time based on last access
- D-02: Decay formula: `score = baseImportance * decayFactor^(daysSinceAccess / halfLifeDays)` -- exponential decay with configurable half-life
- D-03: Default half-life: 30 days (configurable in clawcode.yaml)
- D-04: Relevance score recalculated on search -- not stored/updated continuously
- D-05: Accessing a memory (search hit) resets its `accessed_at` timestamp, effectively resetting decay
- D-06: Memory search combines semantic similarity score with relevance decay score
- D-07: Combined score: `finalScore = semanticSimilarity * relevanceWeight + relevanceScore * decayWeight` (configurable weights)
- D-08: Default weights: 0.7 semantic + 0.3 relevance (prioritize content match, penalize staleness)
- D-09: On memory insert, check for semantic duplicates above a configurable similarity threshold (default 0.85)
- D-10: If duplicate found: merge into existing entry -- update content to newest, keep highest importance, increment access_count, merge tags
- D-11: Deduplication uses the same embedding/vector search infrastructure from Phase 4
- D-12: Deduplication is optional per-insert (flag to skip for manual/system memories that intentionally repeat)

### Claude's Discretion
- Exact decay math implementation details
- Whether to add a `clawcode memory gc` command for manual cleanup
- Minimum relevance threshold below which memories are candidates for cold storage (Phase 8 prep)

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AMEM-04 | Unaccessed memories lose relevance score over time based on configurable decay rate | Decay function using exponential decay with `accessed_at` and configurable half-life. Fields already exist in schema. |
| AMEM-05 | Memory search results factor in relevance decay (recent/accessed memories rank higher) | Combined scoring formula in SemanticSearch re-ranking. sqlite-vec cosine distance converted to similarity. |
| AMEM-06 | Semantically similar memories automatically merged into single authoritative entry on write | Pre-insert KNN check against existing memories using same embedding infrastructure. Threshold-based merge. |
| AMEM-07 | Deduplication preserves highest importance score and merges metadata | Merge function that takes existing + new entry, keeps max importance, unions tags, updates content. |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | Memory storage + vector search | Already the persistence layer; extend queries |
| sqlite-vec | 0.1.9 | KNN vector search for dedup | Already loaded; reuse for similarity check on insert |
| date-fns | 4.1.0 | Date diff for decay calculation | Already used in consolidation.ts; use `differenceInDays` or manual ms diff |
| zod | 4.3.6 | Schema validation for new config fields | Already used for memory config schema |

### No New Dependencies Required

This phase requires zero new packages. All functionality is implemented with existing dependencies plus standard math.

## Architecture Patterns

### Recommended New Files
```
src/memory/
  decay.ts           # Pure decay calculation functions
  dedup.ts           # Deduplication check + merge logic
  relevance.ts       # Combined scoring (semantic + decay)
```

### Pattern 1: Pure Decay Function
**What:** Stateless function that computes relevance score from memory metadata and current time.
**When to use:** Called during search result re-ranking, never stored persistently.
**Example:**
```typescript
// src/memory/decay.ts

type DecayConfig = {
  readonly halfLifeDays: number;  // default: 30
};

/**
 * Calculate relevance score using exponential decay.
 * Formula: baseImportance * (0.5)^(daysSinceAccess / halfLifeDays)
 *
 * Returns 0-1 float. Score approaches 0 as time since access grows.
 * Accessing a memory resets accessed_at, which resets decay.
 */
function calculateRelevanceScore(
  importance: number,
  accessedAt: string,
  now: Date,
  config: DecayConfig,
): number {
  const accessDate = new Date(accessedAt);
  const daysSinceAccess = (now.getTime() - accessDate.getTime()) / (1000 * 60 * 60 * 24);
  
  if (daysSinceAccess <= 0) return importance;
  
  const decayFactor = 0.5; // half-life base
  const score = importance * Math.pow(decayFactor, daysSinceAccess / config.halfLifeDays);
  
  return Math.max(0, Math.min(1, score));
}
```

### Pattern 2: Combined Scoring with Re-ranking
**What:** After sqlite-vec returns KNN results by cosine distance, re-rank using combined semantic + relevance score.
**When to use:** Every search call.
**Example:**
```typescript
// src/memory/relevance.ts

type ScoringConfig = {
  readonly semanticWeight: number;   // default: 0.7
  readonly decayWeight: number;      // default: 0.3
  readonly halfLifeDays: number;     // default: 30
};

type ScoredResult = SearchResult & {
  readonly relevanceScore: number;
  readonly combinedScore: number;
};

/**
 * Convert cosine distance [0, 2] to similarity [0, 1].
 * sqlite-vec cosine distance: 0 = identical, 2 = opposite.
 * Clamp to [0, 1] since negative similarity is meaningless for ranking.
 */
function distanceToSimilarity(distance: number): number {
  return Math.max(0, 1 - distance);
}

function scoreAndRank(
  results: readonly SearchResult[],
  config: ScoringConfig,
  now: Date,
): readonly ScoredResult[] {
  const scored = results.map((result) => {
    const semanticSimilarity = distanceToSimilarity(result.distance);
    const relevanceScore = calculateRelevanceScore(
      result.importance,
      result.accessedAt,
      now,
      { halfLifeDays: config.halfLifeDays },
    );
    const combinedScore =
      semanticSimilarity * config.semanticWeight +
      relevanceScore * config.decayWeight;

    return Object.freeze({
      ...result,
      relevanceScore,
      combinedScore,
    });
  });

  // Re-sort by combined score descending (highest = most relevant)
  return Object.freeze(
    [...scored].sort((a, b) => b.combinedScore - a.combinedScore),
  );
}
```

### Pattern 3: Dedup-on-Insert
**What:** Before inserting a new memory, check if a semantically similar one already exists. If so, merge.
**When to use:** Every insert unless `skipDedup: true` is passed.
**Example:**
```typescript
// src/memory/dedup.ts

type DedupConfig = {
  readonly similarityThreshold: number;  // default: 0.85
};

type DedupResult =
  | { readonly action: "insert" }
  | { readonly action: "merge"; readonly existingId: string };

/**
 * Check if a memory with similar content already exists.
 * Uses the same KNN search with k=1, checks if similarity > threshold.
 */
function checkForDuplicate(
  embedding: Float32Array,
  db: DatabaseType,
  config: DedupConfig,
): DedupResult {
  // Query vec_memories for nearest neighbor
  const stmt = db.prepare(`
    SELECT v.memory_id, v.distance
    FROM vec_memories v
    WHERE v.embedding MATCH ?
      AND k = 1
  `);
  const row = stmt.get(embedding) as { memory_id: string; distance: number } | undefined;
  
  if (!row) return { action: "insert" };
  
  const similarity = 1 - row.distance;
  if (similarity >= config.similarityThreshold) {
    return { action: "merge", existingId: row.memory_id };
  }
  
  return { action: "insert" };
}

/**
 * Merge new memory data into an existing entry.
 * Rules: newest content wins, highest importance wins, tags merge (union), access_count increments.
 */
function mergeMemory(
  db: DatabaseType,
  existingId: string,
  newContent: string,
  newImportance: number,
  newTags: readonly string[],
  newEmbedding: Float32Array,
): void {
  const now = new Date().toISOString();
  
  // Get existing entry
  const existing = db.prepare(
    "SELECT importance, tags, access_count FROM memories WHERE id = ?"
  ).get(existingId) as { importance: number; tags: string; access_count: number };
  
  const existingTags = JSON.parse(existing.tags) as string[];
  const mergedTags = [...new Set([...existingTags, ...newTags])];
  const maxImportance = Math.max(existing.importance, newImportance);
  
  db.transaction(() => {
    // Update memory entry
    db.prepare(`
      UPDATE memories SET
        content = ?,
        importance = ?,
        tags = ?,
        access_count = access_count + 1,
        updated_at = ?,
        accessed_at = ?
      WHERE id = ?
    `).run(newContent, maxImportance, JSON.stringify(mergedTags), now, now, existingId);
    
    // Update embedding vector
    db.prepare("DELETE FROM vec_memories WHERE memory_id = ?").run(existingId);
    db.prepare("INSERT INTO vec_memories (memory_id, embedding) VALUES (?, ?)").run(existingId, newEmbedding);
  })();
}
```

### Pattern 4: Config Schema Extension
**What:** Add decay and dedup settings to `memoryConfigSchema`.
**Example:**
```typescript
// Extend src/memory/schema.ts

export const decayConfigSchema = z.object({
  halfLifeDays: z.number().int().min(1).default(30),
  semanticWeight: z.number().min(0).max(1).default(0.7),
  decayWeight: z.number().min(0).max(1).default(0.3),
});

export const dedupConfigSchema = z.object({
  enabled: z.boolean().default(true),
  similarityThreshold: z.number().min(0).max(1).default(0.85),
});

// Add to memoryConfigSchema
export const memoryConfigSchema = z.object({
  compactionThreshold: z.number().min(0).max(1).default(0.75),
  searchTopK: z.number().int().min(1).default(10),
  consolidation: consolidationConfigSchema.default(/* ... */),
  decay: decayConfigSchema.default(() => ({
    halfLifeDays: 30,
    semanticWeight: 0.7,
    decayWeight: 0.3,
  })),
  deduplication: dedupConfigSchema.default(() => ({
    enabled: true,
    similarityThreshold: 0.85,
  })),
});
```

### Anti-Patterns to Avoid
- **Storing decayed scores in DB:** Decision D-04 explicitly says recalculate on search. Storing creates stale data and complexity.
- **Running dedup asynchronously:** The dedup check must happen before insert returns, inside the same transaction boundary, to prevent race conditions.
- **Mutating search results:** Project convention is immutable data. Always return new frozen objects with added score fields.
- **Hardcoding decay constants:** All values (half-life, weights, threshold) must come from config schema with defaults.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date difference calculation | Manual date parsing | `new Date(isoString).getTime()` arithmetic | ISO strings from SQLite parse reliably with native Date. date-fns `differenceInDays` also works but simple ms math is sufficient and avoids extra import for a one-liner. |
| Cosine similarity | Custom dot product | `1 - distance` from sqlite-vec | sqlite-vec already computes cosine distance. Converting to similarity is trivial subtraction. |
| Tag deduplication | Manual array loop | `[...new Set([...a, ...b])]` | Standard JS Set handles string dedup. |
| Embedding for dedup check | New embedding code | Existing `EmbeddingService.embed()` | Already generates 384-dim Float32Array compatible with vec_memories. |

## Common Pitfalls

### Pitfall 1: Cosine Distance vs Similarity Confusion
**What goes wrong:** sqlite-vec returns cosine *distance* (0 = identical, 2 = opposite), but the scoring formula uses *similarity* (1 = identical, 0 = orthogonal). Mixing them up inverts rankings.
**Why it happens:** Many vector DBs return similarity directly. sqlite-vec returns distance.
**How to avoid:** Always convert: `similarity = 1 - distance`. Add a named helper function `distanceToSimilarity()` to make intent explicit.
**Warning signs:** Search results where old/irrelevant memories rank highest.

### Pitfall 2: Dedup Threshold Too Aggressive
**What goes wrong:** Threshold of 0.85 similarity with all-MiniLM-L6-v2 embeddings may merge memories that are related but distinct.
**Why it happens:** 384-dim embeddings from MiniLM are good but not perfect at fine-grained distinctions. Two memories about "TypeScript generics" and "TypeScript type guards" might exceed 0.85 similarity.
**How to avoid:** The threshold is configurable (D-09). Log merges with content snippets so users can tune. Consider starting conservative (0.90) and documenting how to adjust.
**Warning signs:** Distinct memories disappearing, users reporting lost information.

### Pitfall 3: Division by Zero in Decay
**What goes wrong:** If `halfLifeDays` is 0, the exponent becomes infinity.
**Why it happens:** Config validation gap.
**How to avoid:** Zod schema with `.min(1)` on `halfLifeDays`. The decay function should also guard: `if (halfLifeDays <= 0) return importance`.
**Warning signs:** NaN scores in search results.

### Pitfall 4: Search Over-Fetching for Re-ranking
**What goes wrong:** If you request topK=10 from sqlite-vec and then re-rank, the optimal results after decay scoring might be items 11-20 that were filtered out.
**Why it happens:** KNN returns top-K by cosine distance alone. After re-ranking with decay, the order changes.
**How to avoid:** Fetch more candidates than the final topK. Use a multiplier (e.g., fetch `topK * 2` from KNN, score all, return top `topK`). This is a standard pattern in hybrid search.
**Warning signs:** Freshly accessed memories not appearing in top results despite high semantic match.

### Pitfall 5: Dedup on Empty Database
**What goes wrong:** KNN search on empty `vec_memories` table could return unexpected results or errors.
**Why it happens:** sqlite-vec MATCH on empty table returns empty result set (safe), but the code must handle the null/undefined case.
**How to avoid:** Check for null result from the k=1 query before accessing distance. Existing search.test.ts already tests empty case.
**Warning signs:** Errors on first memory insert.

### Pitfall 6: accessed_at Not Updated Before Decay Calculation
**What goes wrong:** Search updates `accessed_at` (D-05), but if decay is calculated before the access update, the score uses the old timestamp.
**Why it happens:** Order of operations in the search method.
**How to avoid:** Calculate decay scores using the *pre-access* `accessed_at` values. The access update happens after scoring. This is correct -- you want to rank based on staleness *before* this search refreshed them.
**Warning signs:** All memories having identical decay scores of 1.0 because they were just accessed.

## Code Examples

### Existing Search Flow (to extend)
```typescript
// Current: src/memory/search.ts - SemanticSearch.search()
// Returns SearchResult[] with { distance } from vec_memories
// Updates access_count and accessed_at for each result

// Extension point: after getting rows from KNN, before updating access:
// 1. Calculate relevance score for each row using accessed_at + importance
// 2. Compute combined score: semantic * 0.7 + relevance * 0.3
// 3. Re-sort by combined score
// 4. Trim to topK
// 5. THEN update access_count/accessed_at for final results only
```

### Existing Insert Flow (to extend)
```typescript
// Current: src/memory/store.ts - MemoryStore.insert()
// Takes CreateMemoryInput + Float32Array embedding
// Inserts into memories + vec_memories atomically

// Extension point: before the transaction:
// 1. If skipDedup flag is false (default):
//    a. KNN search vec_memories with k=1 using the new embedding
//    b. If similarity >= threshold: merge into existing entry, return merged entry
//    c. If similarity < threshold: proceed with normal insert
// 2. If skipDedup is true: proceed with normal insert
```

### Existing Types (to extend)
```typescript
// Current SearchResult has { distance: number }
// Add: { relevanceScore: number; combinedScore: number }
// Either extend SearchResult type or create a new RankedSearchResult type

// Current CreateMemoryInput has { content, source, importance?, tags? }
// Add: { skipDedup?: boolean } for the dedup opt-out flag (D-12)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pure cosine similarity ranking | Hybrid scoring (semantic + temporal decay) | Standard in RAG systems since 2024 | Better retrieval quality for long-lived knowledge bases |
| No dedup on write | Insert-time dedup with semantic similarity | Standard practice | Prevents knowledge base bloat over time |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run src/memory/__tests__/ --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AMEM-04 | Decay function returns lower scores for older memories | unit | `npx vitest run src/memory/__tests__/decay.test.ts -x` | Wave 0 |
| AMEM-04 | Half-life config controls decay rate | unit | `npx vitest run src/memory/__tests__/decay.test.ts -x` | Wave 0 |
| AMEM-04 | Accessing a memory resets decay (accessed_at update) | unit | `npx vitest run src/memory/__tests__/search.test.ts -x` | Extend existing |
| AMEM-05 | Search results re-ranked by combined score | unit | `npx vitest run src/memory/__tests__/relevance.test.ts -x` | Wave 0 |
| AMEM-05 | Semantic weight + decay weight are configurable | unit | `npx vitest run src/memory/__tests__/relevance.test.ts -x` | Wave 0 |
| AMEM-05 | Fresh memories rank higher than stale ones with same semantic score | integration | `npx vitest run src/memory/__tests__/relevance.test.ts -x` | Wave 0 |
| AMEM-06 | Near-duplicate memory merged on insert | integration | `npx vitest run src/memory/__tests__/dedup.test.ts -x` | Wave 0 |
| AMEM-06 | Below-threshold memory inserted normally | integration | `npx vitest run src/memory/__tests__/dedup.test.ts -x` | Wave 0 |
| AMEM-07 | Merge keeps highest importance | unit | `npx vitest run src/memory/__tests__/dedup.test.ts -x` | Wave 0 |
| AMEM-07 | Merge unions tags | unit | `npx vitest run src/memory/__tests__/dedup.test.ts -x` | Wave 0 |
| AMEM-07 | Merge updates content to newest | unit | `npx vitest run src/memory/__tests__/dedup.test.ts -x` | Wave 0 |
| AMEM-07 | skipDedup flag bypasses dedup check | unit | `npx vitest run src/memory/__tests__/dedup.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/memory/__tests__/ --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/memory/__tests__/decay.test.ts` -- covers AMEM-04 (pure function tests, edge cases)
- [ ] `src/memory/__tests__/relevance.test.ts` -- covers AMEM-05 (combined scoring, re-ranking)
- [ ] `src/memory/__tests__/dedup.test.ts` -- covers AMEM-06, AMEM-07 (merge logic, threshold, skipDedup)

Existing test infrastructure (`store.test.ts`, `search.test.ts`) uses `:memory:` SQLite databases and helper functions (`randomEmbedding`, `directionalEmbedding`) that can be reused. No new test framework setup needed.

## Open Questions

1. **Over-fetch multiplier for re-ranking**
   - What we know: KNN returns top-K by distance; re-ranking may reorder significantly
   - What's unclear: Optimal multiplier (2x? 3x?) depends on how much decay reshuffles results
   - Recommendation: Use 2x as default, make it internal (not user-configurable). Can tune later.

2. **Minimum relevance threshold for Phase 8 prep**
   - What we know: Phase 8 introduces tiered storage (hot/warm/cold). Memories below a threshold become cold candidates.
   - What's unclear: What threshold value is useful
   - Recommendation: Add a `coldThreshold` field to decay config (default 0.05) but don't act on it in Phase 7. Phase 8 will use it. This is within Claude's discretion per CONTEXT.md.

3. **Memory GC command**
   - What we know: Claude's discretion item. Could be useful for manual cleanup.
   - Recommendation: Defer to Phase 8 or later. The decay scoring naturally deprioritizes stale memories without deletion. GC adds complexity without immediate value.

## Project Constraints (from CLAUDE.md)

- **Immutability:** All returned objects must be frozen. New objects, never mutate existing ones.
- **Small files:** Each new module (decay.ts, dedup.ts, relevance.ts) should be under 200 lines.
- **Error handling:** Dedup/merge failures must throw `MemoryError` with context, never swallowed.
- **Input validation:** Zod schemas for all config fields with sensible defaults.
- **No hardcoded values:** All thresholds and weights from config schema.
- **Security:** No secrets involved in this phase. Input validation via Zod on config.
- **Git:** Meaningful commits per feature (decay, dedup, scoring, config, tests).

## Sources

### Primary (HIGH confidence)
- Project source code: `src/memory/store.ts`, `search.ts`, `types.ts`, `embedder.ts`, `schema.ts` -- direct inspection
- Project source code: `src/config/schema.ts` -- config schema structure
- sqlite-vec documentation -- cosine distance range [0, 2], similarity = 1 - distance

### Secondary (MEDIUM confidence)
- [sqlite-vec cosine distance behavior](https://medium.com/@stephenc211/how-sqlite-vec-works-for-storing-and-querying-vector-embeddings-165adeeeceea) -- confirms distance range
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec) -- KNN query syntax, vec0 virtual table

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, extending existing code
- Architecture: HIGH -- clear extension points in existing code, locked decisions constrain design
- Pitfalls: HIGH -- cosine distance confusion is well-documented, other pitfalls from direct code analysis

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable domain, no external dependency changes expected)
