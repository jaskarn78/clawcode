/**
 * Source-side memory reader for OpenClaw's per-agent sqlite file-RAG index.
 *
 * Used at `list`/`plan` time to surface a per-agent chunk count for the
 * migration dry-run table. Scope is intentionally narrow:
 *   - Read-only open (`{ readonly: true, fileMustExist: true }`) — mandatory
 *     per PITFALLS.md Pitfall 3: the live OpenClaw daemon may still be writing
 *     WAL; a writable handle could corrupt the journal. Read-only handles are
 *     safe against a concurrent writer.
 *   - Only `COUNT(*) FROM chunks` is queried. This module MUST NOT read
 *     row contents — memory translation (Phase 80) uses workspace markdown,
 *     not the sqlite chunks table (D-Roadmap decision).
 *   - `db.close()` in finally — better-sqlite3 leaks FDs until explicit close;
 *     across 15 agents in `list` that would trip the OS FD limit in CI.
 *
 * Three observable outcomes covered by the `ChunkCountResult` shape:
 *   1. File present + chunks table + rows   → `{ count: N, missing: false, tableAbsent: false }`
 *   2. File absent (8 of 15 agents on-box)  → `{ count: 0, missing: true,  tableAbsent: false }`
 *   3. File present, no chunks table        → `{ count: 0, missing: false, tableAbsent: true  }`
 *
 * DO NOT:
 *   - Swap `readonly: true` for `readonly: false` — corruption risk against
 *     live WAL (Pitfall 3). The test "does NOT modify the source sqlite file's
 *     mtime" is a regression guard for exactly this.
 *   - Skip the sqlite_master table-existence probe — 8 agents have empty or
 *     structurally-degenerate dbs; throwing on missing table would make `list`
 *     unusable for those agents.
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Outcome of a `readChunkCount` call. Exactly one of `missing` / `tableAbsent`
 * is true when `count === 0`; neither is true when `count > 0`.
 */
export type ChunkCountResult = {
  readonly count: number;
  readonly missing: boolean;
  readonly tableAbsent: boolean;
};

/**
 * Join `memoryDir` + `<agentId>.sqlite`. Thin wrapper around `path.join` —
 * tilde expansion and directory defaulting happen in the CLI layer, not
 * here. Keeping this as a plain string join means downstream callers can
 * unit-test their own path resolution without touching the filesystem.
 */
export function getMemorySqlitePath(
  agentId: string,
  memoryDir: string,
): string {
  return join(memoryDir, `${agentId}.sqlite`);
}

/**
 * Read-only COUNT(*) against the `chunks` table of an OpenClaw per-agent
 * sqlite. Always closes the db handle in finally. See file header for the
 * three-state contract and rationale.
 */
export function readChunkCount(sqlitePath: string): ChunkCountResult {
  if (!existsSync(sqlitePath)) {
    return { count: 0, missing: true, tableAbsent: false };
  }
  // `readonly: true` is the PITFALLS.md Pitfall 3 guard — cannot corrupt
  // WAL even if the OpenClaw daemon is concurrently writing. `fileMustExist:
  // true` is safe here because we already verified existsSync.
  const db = new Database(sqlitePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const tableRow = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks' LIMIT 1",
      )
      .get() as { name: string } | undefined;
    if (!tableRow) {
      return { count: 0, missing: false, tableAbsent: true };
    }
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM chunks")
      .get() as { n: number };
    return {
      count: row.n ?? 0,
      missing: false,
      tableAbsent: false,
    };
  } finally {
    db.close();
  }
}
