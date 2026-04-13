/**
 * TraceStore — SQLite-backed per-agent trace store.
 *
 * Mirrors the `src/usage/tracker.ts` structure: synchronous better-sqlite3,
 * prepared statements, WAL mode, Object.freeze on returned records.
 *
 * Two tables are maintained:
 *   - `traces`      — one row per turn (id, agent, started_at, ended_at,
 *                     total_ms, discord_channel_id, status)
 *   - `trace_spans` — many rows per turn (turn_id, name, started_at,
 *                     duration_ms, metadata_json); linked to `traces.id`
 *                     via ON DELETE CASCADE so retention deletes at the
 *                     parent level alone (see 50-RESEARCH.md pitfall 4).
 *
 * SECURITY: `metadata_json` stores small payloads only (tool name, content
 * length, model). NEVER prompt bodies or message contents. The serialized
 * JSON is capped at 1000 characters per span; longer payloads are
 * truncated with a trailing `...` sentinel (see 50-RESEARCH.md pitfall 5).
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType, Statement } from "better-sqlite3";

import {
  CANONICAL_SEGMENTS,
  TraceStoreError,
  type CanonicalSegment,
  type PercentileRow,
  type TurnRecord,
} from "./types.js";
import { PERCENTILE_SQL } from "./percentiles.js";

/** Maximum length of the serialized metadata JSON per span. */
const METADATA_JSON_MAX_LEN = 1000;

/** Prepared statements used by the TraceStore. */
type PreparedStatements = {
  readonly insertTrace: Statement;
  readonly insertSpan: Statement;
  readonly deleteOlderThan: Statement;
  readonly percentiles: Statement;
};

/** Raw row shape from the PERCENTILE_SQL query. */
type PercentileRawRow = {
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly count: number | null;
};

/**
 * TraceStore wraps a single per-agent `traces.db` SQLite file.
 *
 * Write volume is high-frequency but not high-throughput: one transaction
 * per turn (not per span). See 50-RESEARCH.md pitfall 5 for rationale.
 */
export class TraceStore {
  private readonly db: DatabaseType;
  private readonly stmts: PreparedStatements;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    try {
      this.db = new Database(dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("busy_timeout = 5000");
      this.db.pragma("synchronous = NORMAL");
      this.db.pragma("foreign_keys = ON");

      this.initSchema();
      this.stmts = this.prepareStatements();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TraceStoreError(`open failed: ${msg}`, dbPath);
    }
  }

  /**
   * Persist a complete turn record: one row in `traces` + N rows in
   * `trace_spans`, all inside a single transaction.
   *
   * Uses INSERT OR REPLACE on `traces` to handle Discord message redelivery
   * (see 50-RESEARCH.md pitfall 1) — the latter write wins, and CASCADE
   * drops stale spans before the new ones are inserted.
   */
  writeTurn(turn: TurnRecord): void {
    try {
      const tx = this.db.transaction((t: TurnRecord) => {
        this.stmts.insertTrace.run(
          t.id,
          t.agent,
          t.startedAt,
          t.endedAt,
          t.totalMs,
          t.channelId,
          t.status,
        );
        for (const span of t.spans) {
          this.stmts.insertSpan.run(
            t.id,
            span.name,
            span.startedAt,
            span.durationMs,
            serializeMetadata(span.metadata),
          );
        }
      });
      tx(turn);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TraceStoreError(`writeTurn failed: ${msg}`, this.dbPath);
    }
  }

  /**
   * Delete all turns with `started_at < cutoffIso`. Child spans are removed
   * automatically via ON DELETE CASCADE — no secondary cleanup query.
   *
   * @returns Number of trace rows deleted (spans cascade).
   */
  pruneOlderThan(cutoffIso: string): number {
    try {
      const result = this.stmts.deleteOlderThan.run({ cutoff: cutoffIso });
      return Number(result.changes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TraceStoreError(`pruneOlderThan failed: ${msg}`, this.dbPath);
    }
  }

  /**
   * Compute p50/p95/p99/count for each canonical segment within the window.
   *
   * Returns exactly 4 frozen rows (one per CANONICAL_SEGMENTS entry). When
   * a segment has no matching spans in the window, its p-values are `null`
   * and `count` is `0`.
   */
  getPercentiles(agent: string, sinceIso: string): readonly PercentileRow[] {
    try {
      const rows: PercentileRow[] = CANONICAL_SEGMENTS.map((segment: CanonicalSegment) => {
        const raw = this.stmts.percentiles.get({
          agent,
          since: sinceIso,
          span_name: segment,
        }) as PercentileRawRow | undefined;
        const count = raw && typeof raw.count === "number" ? raw.count : 0;
        return Object.freeze({
          segment,
          p50: count > 0 ? (raw?.p50 ?? null) : null,
          p95: count > 0 ? (raw?.p95 ?? null) : null,
          p99: count > 0 ? (raw?.p99 ?? null) : null,
          count,
        });
      });
      return Object.freeze(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TraceStoreError(`getPercentiles failed: ${msg}`, this.dbPath);
    }
  }

  /** Close the underlying database connection. */
  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        total_ms INTEGER NOT NULL,
        discord_channel_id TEXT,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trace_spans (
        turn_id TEXT NOT NULL,
        name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        metadata_json TEXT,
        FOREIGN KEY(turn_id) REFERENCES traces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_traces_agent_started ON traces(agent, started_at);
      CREATE INDEX IF NOT EXISTS idx_spans_turn_name ON trace_spans(turn_id, name);
    `);
  }

  private prepareStatements(): PreparedStatements {
    return {
      insertTrace: this.db.prepare(`
        INSERT OR REPLACE INTO traces
          (id, agent, started_at, ended_at, total_ms, discord_channel_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      insertSpan: this.db.prepare(`
        INSERT INTO trace_spans
          (turn_id, name, started_at, duration_ms, metadata_json)
        VALUES (?, ?, ?, ?, ?)
      `),
      deleteOlderThan: this.db.prepare(`
        DELETE FROM traces WHERE started_at < @cutoff
      `),
      percentiles: this.db.prepare(PERCENTILE_SQL),
    };
  }
}

/**
 * Serialize span metadata with a hard length cap (see pitfall 5).
 *
 * Empty/null metadata becomes `{}`. Oversized JSON is truncated at
 * METADATA_JSON_MAX_LEN - 3 characters and a literal `...` sentinel is
 * appended so operators can tell the payload was clipped during inspection.
 */
function serializeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): string {
  const source = metadata ?? {};
  const json = JSON.stringify(source);
  if (json === undefined) {
    return "{}";
  }
  if (json.length <= METADATA_JSON_MAX_LEN) {
    return json;
  }
  return `${json.slice(0, METADATA_JSON_MAX_LEN - 3)}...`;
}
