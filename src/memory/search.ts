import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { SearchResult, MemoryEntry } from "./types.js";
import { scoreAndRank, type ScoringConfig, type RankedSearchResult } from "./relevance.js";

/** Raw row shape from the KNN search query. */
type SearchRow = {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly importance: number;
  readonly access_count: number;
  readonly tags: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly accessed_at: string;
  readonly tier: string;
  readonly distance: number;
};

/** Default scoring configuration. */
const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  semanticWeight: 0.7,
  decayWeight: 0.3,
  halfLifeDays: 30,
};

/**
 * SemanticSearch performs KNN vector queries via sqlite-vec's vec0 MATCH.
 *
 * Uses the vec_memories virtual table with cosine distance for ranked
 * similarity search. Re-ranks results using combined semantic similarity
 * and relevance decay scoring. Updates access_count and accessed_at for
 * final top-K results only.
 */
export class SemanticSearch {
  private readonly searchStmt: Statement;
  private readonly updateAccessStmt: Statement;
  private readonly scoringConfig: ScoringConfig;

  constructor(db: DatabaseType, scoringConfig?: ScoringConfig) {
    this.scoringConfig = scoringConfig ?? DEFAULT_SCORING_CONFIG;

    this.searchStmt = db.prepare(`
      SELECT
        m.id, m.content, m.source, m.importance, m.access_count,
        m.tags, m.created_at, m.updated_at, m.accessed_at, m.tier,
        v.distance
      FROM vec_memories v
      INNER JOIN memories m ON m.id = v.memory_id
      WHERE v.embedding MATCH ?
        AND k = ?
      ORDER BY v.distance
    `);

    this.updateAccessStmt = db.prepare(`
      UPDATE memories SET access_count = access_count + 1, accessed_at = ? WHERE id = ?
    `);
  }

  /**
   * Search for memories most similar to the query embedding.
   *
   * Over-fetches by 2x from KNN, scores using combined semantic + relevance
   * decay, then trims to topK. Updates access_count and accessed_at ONLY
   * for the final top-K results (after scoring, not during).
   *
   * NOTE: Cold-tier memories are excluded by design. When a memory is archived
   * to cold, it is deleted from both the memories and vec_memories tables (D-14),
   * so it cannot appear in vector search results. To search cold archives and
   * promote back to warm, use TierManager.rewarmFromCold() explicitly.
   */
  search(queryEmbedding: Float32Array, topK: number): readonly RankedSearchResult[] {
    // Over-fetch by 2x for re-ranking headroom
    const fetchK = topK * 2;
    const rows = this.searchStmt.all(queryEmbedding, fetchK) as SearchRow[];

    // Convert to SearchResult objects (before access update)
    const searchResults: readonly SearchResult[] = Object.freeze(
      rows.map((row) => rowToSearchResult(row)),
    );

    // Score and re-rank using combined semantic + decay scoring
    // IMPORTANT: Score BEFORE updating accessed_at (Pitfall 6)
    const ranked = scoreAndRank(searchResults, this.scoringConfig, new Date());

    // Apply importance weighting: multiplicative boost that rewards high-importance
    // memories without overriding strong semantic matches
    const importanceWeighted = ranked
      .map((result) => {
        const boostedScore = result.combinedScore * (0.7 + 0.3 * result.importance);
        return Object.freeze({ ...result, combinedScore: boostedScore });
      })
      .sort((a, b) => b.combinedScore - a.combinedScore);

    // Trim to requested topK
    const topResults = importanceWeighted.slice(0, topK);

    // Update access_count and accessed_at ONLY for final top-K results
    const now = new Date().toISOString();
    for (const result of topResults) {
      this.updateAccessStmt.run(now, result.id);
    }

    // Return results with updated accessedAt
    return Object.freeze(
      topResults.map((result) =>
        Object.freeze({
          ...result,
          accessedAt: now,
          accessCount: result.accessCount + 1,
        }),
      ),
    );
  }
}

/** Convert a raw SQLite row to an immutable SearchResult. */
function rowToSearchResult(row: SearchRow): SearchResult {
  return Object.freeze({
    id: row.id,
    content: row.content,
    source: row.source as MemoryEntry["source"],
    importance: row.importance,
    accessCount: row.access_count,
    tags: Object.freeze(JSON.parse(row.tags) as string[]),
    embedding: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accessedAt: row.accessed_at,
    tier: (row.tier ?? "warm") as import("./types.js").MemoryTier,
    distance: row.distance,
  });
}
