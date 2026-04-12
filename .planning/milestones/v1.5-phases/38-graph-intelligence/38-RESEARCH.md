# Phase 38: Graph Intelligence - Research

**Researched:** 2026-04-10
**Domain:** Graph-enriched memory retrieval + auto-linking background job
**Confidence:** HIGH

## Summary

Phase 38 enhances the existing memory search pipeline to leverage the graph structure built in Phase 36. Two features are required: (1) graph-enriched retrieval that augments KNN vector search results with 1-hop neighbors from the `memory_links` adjacency table, and (2) a background auto-linker job that periodically scans for semantically similar unlinked memories and creates edges between them.

The codebase is well-prepared for both features. `SemanticSearch.search()` returns ranked results with IDs that can be used to query `getForwardLinks()` and `getBacklinks()` from `graph.ts`. The heartbeat check pattern (auto-discovered modules in `src/heartbeat/checks/`) provides the execution framework for the background auto-linker. The `EmbeddingService` and `MemoryStore.getEmbedding()` method provide all primitives needed for pairwise similarity comparison.

The critical design challenge is token budget enforcement -- graph neighbor expansion must be relevance-gated to prevent unbounded fan-out. A simple approach: for each KNN result, fetch 1-hop neighbors, score them using the same `distanceToSimilarity` function against the query embedding, and only include neighbors above a configurable similarity threshold. Cap total results (KNN + neighbors) at a hard limit.

**Primary recommendation:** Enhance `SemanticSearch` with an optional graph-enrichment pass, implement the auto-linker as a heartbeat check module, and gate all expansion with configurable thresholds and hard caps.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all implementation choices are at Claude's discretion (infrastructure phase).

### Claude's Discretion
All implementation choices. Key constraints from prior phases:
- Phase 36 built the graph foundation (memory_links adjacency table, wikilink parsing, backlink/forward-link queries)
- Phase 37 built memory_lookup MCP tool (delegates to SemanticSearch via IPC)
- Graph-enriched retrieval means enhancing SemanticSearch results to include 1-hop neighbors from memory_links
- Auto-linker uses existing EmbeddingService for similarity comparison -- no new dependencies
- Token budgets mean relevance-gated neighbor inclusion (not unbounded fan-out)
- Local embeddings stay (384-dim sufficient for graph similarity) -- per v1.5 roadmap decision

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GRAPH-03 | Memory search results include 1-hop graph neighbors for richer context retrieval | Graph-enriched search pattern: after KNN, fetch neighbors via `getForwardLinks`/`getBacklinks`, score against query embedding, merge with relevance gating. Implemented as enhancement to `SemanticSearch` or a new `GraphEnrichedSearch` wrapper. |
| GRAPH-04 | Background job auto-discovers and suggests links between semantically similar unlinked memories | Auto-linker heartbeat check: scan memory pairs without existing edges, compare embeddings via cosine similarity, create edges above threshold. Uses existing `EmbeddingService`, `MemoryStore.getEmbedding()`, and heartbeat check pattern. |
</phase_requirements>

## Standard Stack

No new dependencies required. This phase uses only existing libraries.

### Core (existing)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | Graph queries, embedding retrieval | Already used for all memory operations |
| sqlite-vec | 0.1.9 | KNN vector search | Already loaded for SemanticSearch |
| @huggingface/transformers | 4.0.1 | Embedding computation for auto-linker | Already used by EmbeddingService |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline graph enrichment in SemanticSearch | Separate GraphEnrichedSearch class | Separate class is cleaner but adds indirection. Recommend a new `GraphSearch` class that composes `SemanticSearch` + graph queries, keeping `SemanticSearch` unchanged. |
| Heartbeat check for auto-linker | Croner standalone job | Heartbeat is the established pattern for periodic agent-scoped work. No reason to diverge. |
| Pairwise embedding comparison | Re-running KNN per memory | KNN would work but is wasteful. Direct cosine similarity between stored embeddings is O(1) per pair. |

## Architecture Patterns

### Recommended Project Structure
```
src/
├── memory/
│   ├── graph-search.ts         # NEW: GraphSearch wrapping SemanticSearch + neighbor expansion
│   ├── graph-search.types.ts   # NEW: Types for graph-enriched results
│   ├── search.ts               # UNCHANGED: SemanticSearch (KNN only)
│   ├── graph.ts                # UNCHANGED: extractWikilinks, traverseGraph, getBacklinks, getForwardLinks
│   ├── store.ts                # MINOR: May need new query for unlinked memory pairs
│   └── __tests__/
│       ├── graph-search.test.ts    # NEW: Graph-enriched search tests
│       └── auto-linker.test.ts     # NEW: Auto-linker logic tests
├── heartbeat/
│   └── checks/
│       └── auto-linker.ts      # NEW: Auto-linker heartbeat check
└── manager/
    └── daemon.ts               # MODIFY: memory-lookup handler uses GraphSearch instead of SemanticSearch
```

### Pattern 1: Graph-Enriched Search (Composition)
**What:** A `GraphSearch` class that wraps `SemanticSearch` and enriches results with 1-hop graph neighbors.
**When to use:** All `memory-lookup` IPC calls.
**Example:**
```typescript
// src/memory/graph-search.ts
export class GraphSearch {
  private readonly semanticSearch: SemanticSearch;
  private readonly store: MemoryStore;
  private readonly config: GraphSearchConfig;

  search(queryEmbedding: Float32Array, topK: number): readonly GraphSearchResult[] {
    // Step 1: KNN search (existing)
    const knnResults = this.semanticSearch.search(queryEmbedding, topK);

    // Step 2: Collect 1-hop neighbor IDs (deduped, excluding KNN hits)
    const knnIds = new Set(knnResults.map(r => r.id));
    const candidateNeighbors: Map<string, MemoryEntry> = new Map();

    for (const result of knnResults) {
      const forward = getForwardLinks(this.store, result.id);
      const back = getBacklinks(this.store, result.id);
      for (const link of [...forward, ...back]) {
        if (!knnIds.has(link.memory.id) && !candidateNeighbors.has(link.memory.id)) {
          candidateNeighbors.set(link.memory.id, link.memory);
        }
      }
    }

    // Step 3: Score neighbors against query embedding (relevance gate)
    // Step 4: Merge, cap at budget, return
  }
}
```

### Pattern 2: Auto-Linker as Heartbeat Check
**What:** A heartbeat check that scans for semantically similar unlinked memories and creates edges.
**When to use:** Runs periodically (e.g., every 6 hours) per agent.
**Example:**
```typescript
// src/heartbeat/checks/auto-linker.ts
const autoLinkerCheck: CheckModule = {
  name: "auto-linker",
  interval: 21600, // 6 hours
  timeout: 60,     // 1 minute

  async execute(context): Promise<CheckResult> {
    const store = context.sessionManager.getMemoryStore(context.agentName);
    const embedder = context.sessionManager.getEmbedder();
    // Scan recent memories, find similar unlinked pairs, create edges
  }
};
```

### Pattern 3: Relevance-Gated Neighbor Inclusion
**What:** Neighbors are only included if their embedding similarity to the query exceeds a threshold.
**When to use:** Always, during graph enrichment step.
**Key insight:** Without gating, a single highly-connected memory could pull in dozens of irrelevant neighbors. The gate ensures only contextually relevant neighbors appear.

```typescript
type GraphSearchConfig = {
  readonly neighborSimilarityThreshold: number; // e.g., 0.3 (cosine similarity)
  readonly maxNeighbors: number;                // e.g., 5 (hard cap on total neighbors)
  readonly maxTotalResults: number;             // e.g., topK + maxNeighbors
};
```

### Anti-Patterns to Avoid
- **Unbounded fan-out:** Never include ALL 1-hop neighbors. Always relevance-gate and cap.
- **Mutating SemanticSearch:** Don't modify the existing `SemanticSearch` class. Compose around it.
- **Re-embedding for neighbor scoring:** Don't re-embed neighbor content. Use stored embeddings via `store.getEmbedding(id)` and compute cosine similarity directly.
- **Blocking the heartbeat loop:** The auto-linker must batch its work and respect timeout. Don't scan the entire memory corpus in one tick.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cosine similarity | Custom distance function | `distanceToSimilarity()` from `relevance.ts` (converts distance to similarity) | Already exists and tested |
| Periodic job scheduling | Custom timer/cron | Heartbeat check module pattern | Auto-discovered, timeout-protected, logged to NDJSON |
| Graph traversal | Custom BFS/DFS | `traverseGraph()` from `graph.ts` | Already handles cycles, depth limits, frozen results |
| Neighbor fetching | Raw SQL queries | `getForwardLinks()` / `getBacklinks()` from `graph.ts` | Prepared statements, frozen results, typed |
| Embedding retrieval | Raw SQL | `store.getEmbedding(id)` | Handles Buffer-to-Float32Array conversion |

**Key insight:** Every primitive needed for this phase already exists. The work is composing them correctly with proper budgeting.

## Common Pitfalls

### Pitfall 1: Cosine Similarity vs Distance Confusion
**What goes wrong:** sqlite-vec returns cosine *distance* (0 = identical, 2 = opposite). Direct comparison of stored embeddings needs cosine *similarity* (1 = identical, 0 = orthogonal).
**Why it happens:** The existing `distanceToSimilarity()` converts distances from sqlite-vec. But when comparing two raw embeddings (for auto-linker), you need to compute cosine similarity directly: `dot(a,b) / (|a| * |b|)`. Since embeddings are already L2-normalized by the pipeline (`normalize: true`), the dot product IS the cosine similarity.
**How to avoid:** For stored embeddings (already normalized), cosine similarity = dot product. Write a `cosineSimilarity(a: Float32Array, b: Float32Array)` utility that computes the dot product directly.
**Warning signs:** Similarity scores above 1.0 or below 0.0 indicate a math error.

### Pitfall 2: Auto-Linker Quadratic Explosion
**What goes wrong:** Comparing all N memories pairwise is O(N^2). For 1000 memories, that's 500K comparisons, each requiring an embedding fetch.
**Why it happens:** Naive "scan everything" approach.
**How to avoid:** Batch the auto-linker: only scan memories created/updated since last run. Store a `last_auto_link_scan` timestamp. On each run, compare only new memories against existing ones. Also limit batch size (e.g., 50 new memories per tick).
**Warning signs:** Auto-linker check timing out at 60s.

### Pitfall 3: Duplicate Neighbor Entries in Results
**What goes wrong:** A memory can be both a KNN hit AND a graph neighbor of another KNN hit. Or it can be a neighbor of multiple KNN hits.
**Why it happens:** No deduplication between KNN results and neighbor results.
**How to avoid:** Collect all KNN result IDs into a Set. Skip any neighbor already in that Set. Track added neighbor IDs to prevent duplicates across multiple KNN results' neighbor expansions.
**Warning signs:** Same memory appearing twice in search results.

### Pitfall 4: Access Count Inflation from Neighbor Fetching
**What goes wrong:** `store.getById()` auto-increments `access_count`. If used to fetch neighbor details, every search inflates access counts for neighbors that weren't directly searched for.
**Why it happens:** `getById()` has side effects by design.
**How to avoid:** Use `getForwardLinks()` / `getBacklinks()` which return memory entries WITHOUT updating access counts (they use a JOIN query, not `getById()`). Only update access counts for results that are actually returned to the user.
**Warning signs:** Neighbor memories showing unexpectedly high access counts.

### Pitfall 5: Cold-Tier Memories in Graph Neighbors
**What goes wrong:** A graph edge may point to a memory that was archived to cold tier (deleted from memories table). The edge was CASCADE-deleted too, so this shouldn't happen. But if edges are created by the auto-linker AFTER cold archival occurs in the same tick, race conditions could arise.
**Why it happens:** Heartbeat checks run sequentially but within the same tick cycle.
**How to avoid:** The auto-linker should verify both source and target memories exist before creating edges (using `checkMemoryExists` prepared statement, which is already in the store). Also, heartbeat checks run sequentially per agent, so tier-maintenance and auto-linker won't truly race.
**Warning signs:** Foreign key constraint violations on edge insertion.

## Code Examples

### Cosine Similarity for Normalized Embeddings
```typescript
// Since EmbeddingService normalizes embeddings, dot product = cosine similarity
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
```

### Graph-Enriched Result Type
```typescript
type GraphSearchResult = {
  readonly id: string;
  readonly content: string;
  readonly relevanceScore: number;
  readonly combinedScore: number;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly source: "knn" | "graph-neighbor";
  readonly linkedFrom?: readonly string[]; // IDs of KNN results that link to this neighbor
};
```

### Unlinked Memory Pair Query (for auto-linker)
```sql
-- Find memories created since last scan that have no outbound edges
SELECT m.id
FROM memories m
WHERE m.created_at > ?
  AND m.tier != 'cold'
  AND NOT EXISTS (
    SELECT 1 FROM memory_links ml WHERE ml.source_id = m.id
  )
ORDER BY m.created_at DESC
LIMIT ?
```

### Auto-Linker Candidate Comparison
```typescript
// For each new memory, find top-K similar existing memories via KNN
// Then check if an edge already exists before creating one
const candidateStmt = db.prepare(`
  SELECT 1 FROM memory_links
  WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
`);

function edgeExists(a: string, b: string): boolean {
  return candidateStmt.get(a, b, b, a) !== undefined;
}
```

### IPC Handler Enhancement (daemon.ts)
```typescript
case "memory-lookup": {
  // ... existing param validation ...
  const store = manager.getMemoryStore(agentName);
  const embedder = manager.getEmbedder();
  const queryEmbedding = await embedder.embed(query);

  // Use GraphSearch instead of raw SemanticSearch
  const graphSearch = new GraphSearch(store, { /* config */ });
  const results = graphSearch.search(queryEmbedding, limit);

  return {
    results: results.map(r => ({
      id: r.id,
      content: r.content,
      relevance_score: r.combinedScore,
      tags: r.tags,
      created_at: r.createdAt,
      source: r.source, // "knn" | "graph-neighbor"
      linked_from: r.linkedFrom, // NEW: which KNN results link to this
    })),
  };
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest, project-configured) |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npx vitest run src/memory/__tests__/graph-search.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRAPH-03 | KNN results include 1-hop graph neighbors | unit | `npx vitest run src/memory/__tests__/graph-search.test.ts -x` | Wave 0 |
| GRAPH-03 | Neighbors are relevance-gated (below threshold excluded) | unit | `npx vitest run src/memory/__tests__/graph-search.test.ts -x` | Wave 0 |
| GRAPH-03 | Total results respect maxTotalResults cap | unit | `npx vitest run src/memory/__tests__/graph-search.test.ts -x` | Wave 0 |
| GRAPH-03 | Duplicate neighbors are deduplicated | unit | `npx vitest run src/memory/__tests__/graph-search.test.ts -x` | Wave 0 |
| GRAPH-03 | KNN-only results unchanged when no graph edges exist | unit | `npx vitest run src/memory/__tests__/graph-search.test.ts -x` | Wave 0 |
| GRAPH-04 | Auto-linker discovers similar unlinked memories | unit | `npx vitest run src/heartbeat/checks/__tests__/auto-linker.test.ts -x` | Wave 0 |
| GRAPH-04 | Auto-linker skips already-linked pairs | unit | `npx vitest run src/heartbeat/checks/__tests__/auto-linker.test.ts -x` | Wave 0 |
| GRAPH-04 | Auto-linker respects batch size limit | unit | `npx vitest run src/heartbeat/checks/__tests__/auto-linker.test.ts -x` | Wave 0 |
| GRAPH-04 | Auto-linker creates bidirectional edges | unit | `npx vitest run src/heartbeat/checks/__tests__/auto-linker.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/memory/__tests__/graph-search.test.ts src/heartbeat/checks/__tests__/auto-linker.test.ts -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/memory/__tests__/graph-search.test.ts` -- covers GRAPH-03
- [ ] `src/heartbeat/checks/__tests__/auto-linker.test.ts` -- covers GRAPH-04

## Open Questions

1. **Auto-linker edge directionality**
   - What we know: Wikilinks create directed edges (source -> target). The auto-linker discovers *mutual similarity*, which is undirected.
   - What's unclear: Should auto-created edges be unidirectional (A->B) or bidirectional (A->B AND B->A)?
   - Recommendation: Create bidirectional edges (both directions) since semantic similarity is symmetric. Use a distinct `link_text` value (e.g., `"auto:similar"`) to distinguish auto-created edges from wikilink-created ones.

2. **Memory-lookup result format change**
   - What we know: Current IPC response has `{id, content, relevance_score, tags, created_at}`. Adding `source` and `linked_from` fields changes the contract.
   - What's unclear: Whether downstream consumers (MCP tool) need to be updated.
   - Recommendation: Add the new fields as optional. MCP tool can include them in JSON output. No breaking change.

3. **Auto-linker similarity threshold**
   - What we know: Dedup threshold is 0.85 (very high -- near-duplicate). Auto-linking needs a lower threshold.
   - What's unclear: Optimal threshold for "related but not duplicate" memories.
   - Recommendation: Start with 0.6 cosine similarity (configurable). This is loose enough to capture thematic similarity without linking unrelated content. Tune based on real agent data.

## Sources

### Primary (HIGH confidence)
- Project codebase: `src/memory/search.ts`, `src/memory/graph.ts`, `src/memory/store.ts`, `src/memory/embedder.ts` -- all read and analyzed
- Project codebase: `src/heartbeat/checks/consolidation.ts`, `src/heartbeat/runner.ts`, `src/heartbeat/types.ts` -- heartbeat check pattern
- Project codebase: `src/manager/daemon.ts` lines 740-764 -- memory-lookup IPC handler
- Project codebase: `src/memory/relevance.ts` -- `distanceToSimilarity()` function

### Secondary (MEDIUM confidence)
- sqlite-vec documentation: cosine distance metric behavior (0 = identical, 2 = opposite)
- all-MiniLM-L6-v2: outputs L2-normalized embeddings when `normalize: true` is set

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing code examined
- Architecture: HIGH -- clear composition pattern, all integration points identified
- Pitfalls: HIGH -- derived from actual code analysis (access count side effects, cold-tier edge lifecycle, quadratic complexity)

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable -- no external dependency changes expected)
