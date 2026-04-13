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
  type CacheTelemetryReport,
  type CacheTrendPoint,
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
  readonly cacheTelemetryRows: Statement;
  readonly cacheTelemetryAggregates: Statement;
  readonly cacheTelemetryTrend: Statement;
};

/** Raw row shape from the PERCENTILE_SQL query. */
type PercentileRawRow = {
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly count: number | null;
};

/** Raw row shape for cache-telemetry per-turn query. */
type CacheTelemetryRow = {
  readonly cache_read_input_tokens: number | null;
  readonly cache_creation_input_tokens: number | null;
  readonly input_tokens: number | null;
};

/** Raw row shape for cache-telemetry aggregate sums. */
type CacheTelemetryAggregateRow = {
  readonly total_cache_reads: number | null;
  readonly total_cache_writes: number | null;
  readonly total_input_tokens: number | null;
  readonly total_turns: number | null;
};

/** Raw row shape for cache-telemetry per-day trend query. */
type CacheTelemetryTrendRow = {
  readonly date: string;
  readonly turns: number;
  readonly sum_read: number;
  readonly sum_creation: number;
  readonly sum_input: number;
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
      this.migrateSchema();
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
        // Phase 52 Plan 01: cache telemetry columns are OPTIONAL on TurnRecord.
        // Pass `?? null` so older callers (Phase 50 turns) land NULL in those
        // columns and remain queryable. `cache_eviction_expected` is a boolean
        // stored as 0/1 INTEGER (SQLite convention).
        this.stmts.insertTrace.run(
          t.id,
          t.agent,
          t.startedAt,
          t.endedAt,
          t.totalMs,
          t.channelId,
          t.status,
          t.cacheReadInputTokens ?? null,
          t.cacheCreationInputTokens ?? null,
          t.inputTokens ?? null,
          t.prefixHash ?? null,
          t.cacheEvictionExpected === undefined
            ? null
            : t.cacheEvictionExpected
              ? 1
              : 0,
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

  /**
   * Compute the cache-telemetry report for `agent` over the `sinceIso` window.
   *
   * Hit-rate formula (Phase 52 D-01):
   *   hit_rate = cache_read / (cache_read + cache_creation + input)
   *
   * Skip rules:
   *   - WHERE `input_tokens IS NOT NULL AND input_tokens > 0` — excludes both
   *     Phase 50 legacy turns (NULL) and warm-up turns (0). This is what
   *     separates cache-aware turns from pre-Phase-52 rows.
   *   - Empty result window returns a zero-filled report with no exceptions.
   *
   * Percentile math mirrors `PERCENTILE_SQL`'s nearest-rank approach, but is
   * computed in JS here because the per-turn hit rate is a derived float and
   * SQLite cannot index-order expressions across windowed aggregates cleanly.
   * N at agent scale is small (tens of thousands across retention), so a
   * single ORDER-BY pass + sort is cheaper than a ROW_NUMBER subquery.
   */
  getCacheTelemetry(agent: string, sinceIso: string): CacheTelemetryReport {
    try {
      const rows = this.stmts.cacheTelemetryRows.all({
        agent,
        since: sinceIso,
      }) as readonly CacheTelemetryRow[];

      if (rows.length === 0) {
        return Object.freeze<CacheTelemetryReport>({
          agent,
          since: sinceIso,
          totalTurns: 0,
          avgHitRate: 0,
          p50HitRate: 0,
          p95HitRate: 0,
          totalCacheReads: 0,
          totalCacheWrites: 0,
          totalInputTokens: 0,
          trendByDay: Object.freeze([]),
        });
      }

      // Compute per-turn hit rates (guarded by the SQL WHERE input_tokens > 0).
      const hitRates = rows
        .map((r) => {
          const read = r.cache_read_input_tokens ?? 0;
          const creation = r.cache_creation_input_tokens ?? 0;
          const input = r.input_tokens ?? 0;
          const denominator = read + creation + input;
          return denominator > 0 ? read / denominator : 0;
        })
        .sort((a, b) => a - b);

      const totalTurns = hitRates.length;
      const sum = hitRates.reduce((acc, v) => acc + v, 0);
      const avgHitRate = sum / totalTurns;

      // Nearest-rank: index = floor(N * p), clamped to [0, N-1].
      const p50Idx = Math.min(Math.floor(totalTurns * 0.5), totalTurns - 1);
      const p95Idx = Math.min(Math.floor(totalTurns * 0.95), totalTurns - 1);
      const p50HitRate = hitRates[p50Idx] ?? 0;
      const p95HitRate = hitRates[p95Idx] ?? 0;

      // Aggregate sums over the same WHERE window.
      const agg = this.stmts.cacheTelemetryAggregates.get({
        agent,
        since: sinceIso,
      }) as CacheTelemetryAggregateRow | undefined;

      const totalCacheReads = agg?.total_cache_reads ?? 0;
      const totalCacheWrites = agg?.total_cache_writes ?? 0;
      const totalInputTokens = agg?.total_input_tokens ?? 0;

      // Per-day trend: SUM tokens per YYYY-MM-DD bucket, compute hitRate per day.
      const trendRows = this.stmts.cacheTelemetryTrend.all({
        agent,
        since: sinceIso,
      }) as readonly CacheTelemetryTrendRow[];

      const trendByDay: readonly CacheTrendPoint[] = Object.freeze(
        trendRows.map((t) => {
          const denominator = t.sum_read + t.sum_creation + t.sum_input;
          const hitRate = denominator > 0 ? t.sum_read / denominator : 0;
          return Object.freeze<CacheTrendPoint>({
            date: t.date,
            turns: t.turns,
            hitRate,
          });
        }),
      );

      return Object.freeze<CacheTelemetryReport>({
        agent,
        since: sinceIso,
        totalTurns,
        avgHitRate,
        p50HitRate,
        p95HitRate,
        totalCacheReads,
        totalCacheWrites,
        totalInputTokens,
        trendByDay,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TraceStoreError(
        `getCacheTelemetry failed: ${msg}`,
        this.dbPath,
      );
    }
  }

  /** Close the underlying database connection. */
  close(): void {
    this.db.close();
  }

  /**
   * Phase 52 Plan 01: idempotent ALTER TABLE migration.
   *
   * Reads the existing `traces` columns via `PRAGMA table_info(traces)`, then
   * issues `ALTER TABLE ... ADD COLUMN` only for columns not already present.
   * This means repeated daemon restarts on an already-upgraded traces.db do
   * NOT throw "duplicate column" errors. Columns added in order:
   *   - cache_read_input_tokens       INTEGER (nullable)
   *   - cache_creation_input_tokens   INTEGER (nullable)
   *   - input_tokens                  INTEGER (nullable)
   *   - prefix_hash                   TEXT    (nullable — set by Plan 52-02)
   *   - cache_eviction_expected       INTEGER (nullable 0/1 — set by Plan 52-02)
   *
   * SQLite's `ALTER TABLE ADD COLUMN` preserves existing row values (they land
   * NULL in the new columns) so Phase 50/51 turns remain queryable.
   */
  private migrateSchema(): void {
    const existing = new Set<string>(
      (
        this.db.prepare("PRAGMA table_info(traces)").all() as ReadonlyArray<{
          readonly name: string;
        }>
      ).map((r) => r.name),
    );
    const additions: ReadonlyArray<readonly [string, string]> = [
      ["cache_read_input_tokens", "INTEGER"],
      ["cache_creation_input_tokens", "INTEGER"],
      ["input_tokens", "INTEGER"],
      ["prefix_hash", "TEXT"],
      ["cache_eviction_expected", "INTEGER"],
    ];
    for (const [col, type] of additions) {
      if (!existing.has(col)) {
        this.db.exec(`ALTER TABLE traces ADD COLUMN ${col} ${type}`);
      }
    }
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
      // Phase 52 Plan 01: 12-arg positional insert (was 7-arg in Phase 50).
      // Last 5 columns are nullable — Phase 50 callers pass NULL for them.
      insertTrace: this.db.prepare(`
        INSERT OR REPLACE INTO traces
          (id, agent, started_at, ended_at, total_ms, discord_channel_id, status,
           cache_read_input_tokens, cache_creation_input_tokens, input_tokens,
           prefix_hash, cache_eviction_expected)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      // Phase 52 Plan 01: per-turn rows for in-JS percentile math.
      // WHERE input_tokens IS NOT NULL AND input_tokens > 0 excludes both
      // Phase 50 legacy turns (NULL) and warm-up turns (0).
      cacheTelemetryRows: this.db.prepare(`
        SELECT cache_read_input_tokens, cache_creation_input_tokens, input_tokens
        FROM traces
        WHERE agent = @agent
          AND started_at >= @since
          AND input_tokens IS NOT NULL
          AND input_tokens > 0
        ORDER BY started_at
      `),
      // Phase 52 Plan 01: single-row aggregate sums over the same window.
      cacheTelemetryAggregates: this.db.prepare(`
        SELECT
          COALESCE(SUM(cache_read_input_tokens), 0) AS total_cache_reads,
          COALESCE(SUM(cache_creation_input_tokens), 0) AS total_cache_writes,
          COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
          COUNT(*) AS total_turns
        FROM traces
        WHERE agent = @agent
          AND started_at >= @since
          AND input_tokens IS NOT NULL
          AND input_tokens > 0
      `),
      // Phase 52 Plan 01: per-day trend bucket. substr(started_at, 1, 10)
      // yields YYYY-MM-DD from the ISO 8601 started_at column.
      cacheTelemetryTrend: this.db.prepare(`
        SELECT
          substr(started_at, 1, 10) AS date,
          COUNT(*) AS turns,
          COALESCE(SUM(cache_read_input_tokens), 0) AS sum_read,
          COALESCE(SUM(cache_creation_input_tokens), 0) AS sum_creation,
          COALESCE(SUM(input_tokens), 0) AS sum_input
        FROM traces
        WHERE agent = @agent
          AND started_at >= @since
          AND input_tokens IS NOT NULL
          AND input_tokens > 0
        GROUP BY substr(started_at, 1, 10)
        ORDER BY date
      `),
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
