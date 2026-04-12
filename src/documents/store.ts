/**
 * DocumentStore — SQLite-backed document chunk storage with vector search.
 *
 * Stores document chunks in a better-sqlite3 database alongside 384-dim
 * embeddings in a sqlite-vec virtual table. Supports ingest (with overwrite),
 * KNN search with adjacent-chunk context, and source-based deletion.
 */

import type { Database as DatabaseType, Statement } from "better-sqlite3";
import { nanoid } from "nanoid";
import type { IngestResult, DocumentSearchResult } from "./types.js";
import type { ChunkInput } from "./chunker.js";

/** Maximum search limit to prevent excessive queries. */
const MAX_SEARCH_LIMIT = 20;

/** Chunk count threshold for warning. */
const CHUNK_COUNT_WARNING_THRESHOLD = 10_000;

/** Raw row shape from document_chunks table. */
type ChunkRow = {
  readonly id: string;
  readonly source: string;
  readonly chunk_index: number;
  readonly content: string;
  readonly start_char: number;
  readonly end_char: number;
  readonly created_at: string;
};

/** Raw row from KNN search join. */
type SearchRow = {
  readonly id: string;
  readonly source: string;
  readonly chunk_index: number;
  readonly content: string;
  readonly distance: number;
};

/** Prepared statements for all store operations. */
type PreparedStatements = {
  readonly insertChunk: Statement;
  readonly insertVec: Statement;
  readonly deleteBySource: Statement;
  readonly deleteVecBySource: Statement;
  readonly getChunkCount: Statement;
  readonly getAdjacentChunk: Statement;
  readonly searchAll: Statement;
  readonly searchBySource: Statement;
  readonly listSources: Statement;
  readonly getChunkIdsBySource: Statement;
};

export class DocumentStore {
  private readonly db: DatabaseType;
  private readonly stmts: PreparedStatements;

  constructor(db: DatabaseType) {
    this.db = db;
    this.initSchema();
    this.stmts = this.prepareStatements();
  }

  /**
   * Ingest document chunks with their embeddings.
   *
   * If the source already exists, all previous chunks are deleted first
   * (overwrite semantics). Runs atomically within a transaction.
   */
  ingest(
    source: string,
    chunks: readonly ChunkInput[],
    embeddings: readonly Float32Array[],
  ): IngestResult {
    const now = new Date().toISOString();
    let totalChars = 0;

    this.db.transaction(() => {
      // Delete existing chunks for this source (overwrite)
      this.deleteChunksForSource(source);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        const id = nanoid();

        this.stmts.insertChunk.run(
          id,
          source,
          chunk.chunkIndex,
          chunk.content,
          chunk.startChar,
          chunk.endChar,
          now,
        );
        this.stmts.insertVec.run(id, embedding);
        totalChars += chunk.content.length;
      }
    })();

    // Check chunk count and warn if threshold exceeded
    const count = this.getChunkCount();
    if (count > CHUNK_COUNT_WARNING_THRESHOLD) {
      console.warn(
        `[DocumentStore] Chunk count (${count}) exceeds ${CHUNK_COUNT_WARNING_THRESHOLD}. Consider archiving old documents.`,
      );
    }

    return Object.freeze({
      source,
      chunksCreated: chunks.length,
      totalChars,
    });
  }

  /**
   * Search for document chunks similar to the query embedding.
   *
   * Returns up to `limit` results (clamped to 20) ranked by similarity.
   * Each result includes content from adjacent chunks for context.
   * Optionally filters by source.
   */
  search(
    embedding: Float32Array,
    limit = 5,
    source?: string,
  ): readonly DocumentSearchResult[] {
    const clampedLimit = Math.min(Math.max(1, limit), MAX_SEARCH_LIMIT);

    const rows: readonly SearchRow[] = source
      ? (this.stmts.searchBySource.all(embedding, clampedLimit, source) as SearchRow[])
      : (this.stmts.searchAll.all(embedding, clampedLimit) as SearchRow[]);

    const results = rows.map((row) => {
      const similarity = 1 - row.distance;

      // Fetch adjacent chunks for context
      const before = this.stmts.getAdjacentChunk.get(
        row.source,
        row.chunk_index - 1,
      ) as ChunkRow | undefined;
      const after = this.stmts.getAdjacentChunk.get(
        row.source,
        row.chunk_index + 1,
      ) as ChunkRow | undefined;

      return Object.freeze({
        chunkId: row.id,
        source: row.source,
        chunkIndex: row.chunk_index,
        content: row.content,
        similarity,
        contextBefore: before?.content ?? null,
        contextAfter: after?.content ?? null,
      } satisfies DocumentSearchResult);
    });

    return Object.freeze(results);
  }

  /**
   * Delete all chunks and embeddings for a document source.
   * Returns the number of chunks deleted.
   */
  deleteDocument(source: string): number {
    let deleted = 0;
    this.db.transaction(() => {
      deleted = this.deleteChunksForSource(source);
    })();
    return deleted;
  }

  /** Get total number of document chunks across all sources. */
  getChunkCount(): number {
    const row = this.stmts.getChunkCount.get() as { count: number };
    return row.count;
  }

  /** List all distinct document sources, sorted alphabetically. */
  listSources(): readonly string[] {
    const rows = this.stmts.listSources.all() as ReadonlyArray<{ source: string }>;
    return Object.freeze(rows.map((r) => r.source));
  }

  /** Delete chunks for a source from both tables. Returns count deleted. */
  private deleteChunksForSource(source: string): number {
    // Get chunk IDs first for vec table deletion
    const chunkIds = this.stmts.getChunkIdsBySource.all(source) as ReadonlyArray<{ id: string }>;
    for (const row of chunkIds) {
      this.stmts.deleteVecBySource.run(row.id);
    }
    const result = this.stmts.deleteBySource.run(source);
    return result.changes;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        start_char INTEGER NOT NULL,
        end_char INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_doc_chunks_source
        ON document_chunks(source);
      CREATE INDEX IF NOT EXISTS idx_doc_chunks_source_index
        ON document_chunks(source, chunk_index);

      CREATE VIRTUAL TABLE IF NOT EXISTS vec_document_chunks USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[384] distance_metric=cosine
      );
    `);
  }

  private prepareStatements(): PreparedStatements {
    return {
      insertChunk: this.db.prepare(`
        INSERT INTO document_chunks (id, source, chunk_index, content, start_char, end_char, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      insertVec: this.db.prepare(`
        INSERT INTO vec_document_chunks (chunk_id, embedding)
        VALUES (?, ?)
      `),
      deleteBySource: this.db.prepare(
        "DELETE FROM document_chunks WHERE source = ?",
      ),
      deleteVecBySource: this.db.prepare(
        "DELETE FROM vec_document_chunks WHERE chunk_id = ?",
      ),
      getChunkCount: this.db.prepare(
        "SELECT COUNT(*) as count FROM document_chunks",
      ),
      getAdjacentChunk: this.db.prepare(
        "SELECT id, source, chunk_index, content, start_char, end_char, created_at FROM document_chunks WHERE source = ? AND chunk_index = ?",
      ),
      searchAll: this.db.prepare(`
        SELECT d.id, d.source, d.chunk_index, d.content, v.distance
        FROM vec_document_chunks v
        INNER JOIN document_chunks d ON d.id = v.chunk_id
        WHERE v.embedding MATCH ?
          AND k = ?
        ORDER BY v.distance
      `),
      searchBySource: this.db.prepare(`
        SELECT d.id, d.source, d.chunk_index, d.content, v.distance
        FROM vec_document_chunks v
        INNER JOIN document_chunks d ON d.id = v.chunk_id
        WHERE v.embedding MATCH ?
          AND k = ?
          AND d.source = ?
        ORDER BY v.distance
      `),
      listSources: this.db.prepare(
        "SELECT DISTINCT source FROM document_chunks ORDER BY source",
      ),
      getChunkIdsBySource: this.db.prepare(
        "SELECT id FROM document_chunks WHERE source = ?",
      ),
    };
  }
}
