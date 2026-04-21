/**
 * Read OpenClaw per-agent sqlite `chunks` table for memory migration.
 *
 * Phase 80 originally read ONLY workspace markdown per the "disk-is-truth"
 * STATE.md decision. Real-world migration revealed (2026-04-21) that some
 * agents have their entire memory store in sqlite WITHOUT matching
 * markdown — e.g. fin-acquisition: 597 structured memories (entities,
 * facts, concepts) in ~/.openclaw/memory/fin-acquisition.sqlite with
 * source="memory", and NO corresponding files in workspace-finmentum/
 * (shared with 4 siblings). Read-only access; source system never modified.
 */

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

export type SourceChunk = {
  readonly id: string;       // original chunks.id — used for origin_id
  readonly path: string;     // source file path (may not exist on disk)
  readonly text: string;     // verbatim chunk text
  readonly hash: string;     // source content hash from OpenClaw
};

/**
 * Read every row from the `chunks` table in a per-agent OpenClaw sqlite.
 * Returns empty array if the sqlite file doesn't exist (e.g. agent had
 * no memory) OR if the chunks table is absent (fresh/empty agent).
 */
export function readSourceChunks(sqlitePath: string): readonly SourceChunk[] {
  if (!existsSync(sqlitePath)) return [];
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    // Check table presence before query — some fresh agents have no schema.
    const tableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks' LIMIT 1",
      )
      .get();
    if (!tableExists) return [];
    const rows = db
      .prepare(
        "SELECT id, path, text, hash FROM chunks WHERE source='memory' AND text IS NOT NULL AND length(text) > 0",
      )
      .all() as Array<{ id: string; path: string; text: string; hash: string }>;
    return Object.freeze(
      rows.map((r) =>
        Object.freeze({ id: r.id, path: r.path, text: r.text, hash: r.hash }),
      ),
    );
  } finally {
    db.close();
  }
}

/**
 * Compute a stable origin_id for a sqlite-sourced chunk.
 * Format: `openclaw-sqlite:<agentId>:<sha256(chunks.id).slice(0,16)>`
 * Distinct namespace from markdown-sourced origin_ids
 * (`openclaw:<agentId>:<sha256(relpath)>`) so both sources can coexist
 * via origin_id UNIQUE without collision.
 */
export function computeSqliteOriginId(agentId: string, chunkId: string): string {
  const hash = createHash("sha256").update(chunkId).digest("hex").slice(0, 16);
  return `openclaw-sqlite:${agentId}:${hash}`;
}
