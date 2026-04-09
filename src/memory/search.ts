import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { SearchResult, MemoryEntry } from "./types.js";

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
  readonly distance: number;
};

/**
 * SemanticSearch performs KNN vector queries via sqlite-vec's vec0 MATCH.
 *
 * Uses the vec_memories virtual table with cosine distance for ranked
 * similarity search. Updates access_count and accessed_at for each result.
 */
export class SemanticSearch {
  private readonly searchStmt: Statement;
  private readonly updateAccessStmt: Statement;

  constructor(db: DatabaseType) {
    this.searchStmt = db.prepare(`
      SELECT
        m.id, m.content, m.source, m.importance, m.access_count,
        m.tags, m.created_at, m.updated_at, m.accessed_at,
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
   * Returns top-K results ranked by cosine distance (lower = more similar).
   * Updates access_count and accessed_at for each returned result.
   */
  search(queryEmbedding: Float32Array, topK: number): readonly SearchResult[] {
    const rows = this.searchStmt.all(queryEmbedding, topK) as SearchRow[];

    const now = new Date().toISOString();
    for (const row of rows) {
      this.updateAccessStmt.run(now, row.id);
    }

    return Object.freeze(rows.map((row) => rowToSearchResult(row, now)));
  }
}

/** Convert a raw SQLite row to an immutable SearchResult. */
function rowToSearchResult(row: SearchRow, accessedAt: string): SearchResult {
  return Object.freeze({
    id: row.id,
    content: row.content,
    source: row.source as MemoryEntry["source"],
    importance: row.importance,
    accessCount: row.access_count + 1,
    tags: Object.freeze(JSON.parse(row.tags) as string[]),
    embedding: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accessedAt,
    distance: row.distance,
  });
}
