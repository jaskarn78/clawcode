/**
 * Phase 101 T05 — vec_document_chunks int8[384] migration + CF-2 cutover.
 *
 * Asserts:
 *   1. Fresh DocumentStore creates vec_document_chunks with int8[384] column.
 *   2. migrateDocumentChunksToInt8() drops a pre-existing float[384] table.
 *   3. Re-running migration on an already-int8 table is a no-op (idempotent).
 *   4. DocumentStore.ingest accepts Int8Array[] (signature widening).
 *   5. Static grep — daemon.ts ingest-document block uses embedV2, not embed().
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DocumentStore,
  migrateDocumentChunksToInt8,
} from "../../src/documents/store.js";

/** Build a deterministic int8 384-dim vector for testing. */
function fakeInt8(seed: number): Int8Array {
  const arr = new Int8Array(384);
  for (let i = 0; i < 384; i++) {
    // Map sin output ∈ [-1,1] to int8 range [-127,127].
    arr[i] = Math.round(Math.sin(seed * (i + 1) * 0.01) * 127);
  }
  return arr;
}

function freshDb(): DatabaseType {
  const db = new Database(":memory:");
  sqliteVec.load(db);
  return db;
}

describe("phase101 T05 — vec_document_chunks int8[384] schema", () => {
  let db: DatabaseType;
  let store: DocumentStore;

  beforeEach(() => {
    db = freshDb();
    store = new DocumentStore(db);
  });

  it("creates vec_document_chunks with int8[384] embedding column", () => {
    const row = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_document_chunks'",
      )
      .get() as { sql: string } | undefined;
    expect(row?.sql).toMatch(/int8\s*\[\s*384\s*\]/i);
    expect(row?.sql).not.toMatch(/\bfloat\s*\[\s*384\s*\]/i);
  });

  it("ingest() accepts Int8Array[] embeddings (signature widened)", () => {
    const chunks = [
      { content: "alpha", chunkIndex: 0, startChar: 0, endChar: 5 },
      { content: "beta", chunkIndex: 1, startChar: 5, endChar: 9 },
    ] as const;
    const embeddings = [fakeInt8(1), fakeInt8(2)];
    const result = store.ingest("doc.txt", chunks, embeddings);
    expect(result.chunksCreated).toBe(2);
    expect(store.getChunkCount()).toBe(2);
  });

  it("search() accepts Int8Array query and returns matching chunks", () => {
    const chunks = [
      { content: "alpha", chunkIndex: 0, startChar: 0, endChar: 5 },
    ] as const;
    store.ingest("doc.txt", chunks, [fakeInt8(1)]);
    const results = store.search(fakeInt8(1), 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("doc.txt");
  });
});

describe("phase101 T05 — migrateDocumentChunksToInt8 idempotency", () => {
  it("returns false on fresh DB (no table yet)", () => {
    const db = freshDb();
    expect(migrateDocumentChunksToInt8(db)).toBe(false);
  });

  it("returns false when table is already int8 (idempotent)", () => {
    const db = freshDb();
    // Construct DocumentStore — creates int8 table.
    new DocumentStore(db);
    // Re-run migration.
    expect(migrateDocumentChunksToInt8(db)).toBe(false);
  });

  it("drops a pre-existing float[384] table (v1 schema)", () => {
    const db = freshDb();
    // Manually create the v1 float schema.
    db.exec(`
      CREATE TABLE document_chunks (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        start_char INTEGER NOT NULL,
        end_char INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE vec_document_chunks USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[384] distance_metric=cosine
      );
    `);
    // Migration should detect float and drop.
    expect(migrateDocumentChunksToInt8(db)).toBe(true);
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_document_chunks'",
      )
      .get();
    expect(row).toBeUndefined();
    // Re-create via DocumentStore — should land int8 shape.
    new DocumentStore(db);
    const row2 = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_document_chunks'",
      )
      .get() as { sql: string };
    expect(row2.sql).toMatch(/int8\s*\[\s*384\s*\]/i);
  });
});

describe("phase101 T05 — daemon.ts CF-2 static checks", () => {
  const daemonPath = join(__dirname, "..", "..", "src", "manager", "daemon.ts");
  const source = readFileSync(daemonPath, "utf-8");

  it("ingest-document block uses embedV2, not embed() (CF-2)", () => {
    const start = source.indexOf('case "ingest-document":');
    expect(start).toBeGreaterThan(0);
    const end = source.indexOf('case "search-documents":', start);
    const block = source.slice(start, end);
    expect(block).toMatch(/embedder\.embedV2\(/);
    // The block must NOT contain a bare `embedder.embed(` (would route to v1).
    const bareEmbedMatches = block.match(/embedder\.embed\(/g) ?? [];
    expect(bareEmbedMatches.length).toBe(0);
  });

  it("CF-2 marker comment is present in daemon.ts (grep target)", () => {
    expect(source).toMatch(/CF-2/);
  });

  it("at least one embedV2 call site exists in daemon.ts", () => {
    const matches = source.match(/embedder\.embedV2\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
