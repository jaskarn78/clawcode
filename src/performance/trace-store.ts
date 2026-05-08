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
  type ToolPercentileRow,
  type TurnRecord,
} from "./types.js";
// Phase 57 Plan 02: the `turn_origin` column stores a serialized TurnOrigin
// as JSON text. TurnOrigin is defined on TurnRecord (see types.ts) and flows
// through writeTurn's JSON.stringify. Consumers of the raw row revalidate via
// TurnOriginSchema in src/manager/turn-origin.ts (Phase 63 trace walker).
import type { TurnOrigin } from "../manager/turn-origin.js";
import { PERCENTILE_SQL } from "./percentiles.js";

/** Maximum length of the serialized metadata JSON per span. */
const METADATA_JSON_MAX_LEN = 1000;

/** Prepared statements used by the TraceStore. */
type PreparedStatements = {
  readonly insertTrace: Statement;
  readonly insertSpan: Statement;
  readonly deleteOlderThan: Statement;
  readonly percentiles: Statement;
  readonly perToolPercentiles: Statement;
  readonly cacheTelemetryRows: Statement;
  readonly cacheTelemetryAggregates: Statement;
  readonly cacheTelemetryTrend: Statement;
  readonly cacheEffectStats: Statement;
  // Phase 115 Plan 05 T03 — D-05 priority dream-pass trigger.
  readonly insertTier1TruncationEvent: Statement;
  readonly countTier1TruncationEventsSince: Statement;
};

/**
 * Phase 52 Plan 03: raw row shape for the cache-effect first-token query.
 *
 * AVG returns NULL when the CASE WHEN filter yields no matching rows — we
 * surface that as a `null` field so the caller can decide whether the window
 * has enough signal (eligibleTurns >= 20) to compute a delta.
 */
type CacheEffectRawRow = {
  readonly hit_avg_ms: number | null;
  readonly miss_avg_ms: number | null;
  readonly eligible_turns: number | null;
};

/**
 * Phase 52 Plan 03: cache-effect first-token stats for the `cache_effect_ms`
 * metric surfaced on the `clawcode cache` CLI and dashboard Prompt Cache
 * panel. Both averages are `null` when the window has no eligible turns on
 * that side (e.g. no cache-hit turns yet). `eligibleTurns` is the count of
 * turns that had a `first_token` span AND non-NULL `cache_read_input_tokens`.
 *
 * Callers (daemon.ts computeCacheEffectMs) MUST gate on `eligibleTurns >= 20`
 * before computing `hitAvgMs - missAvgMs` — 20 is the noise floor per
 * CONTEXT D-05.
 */
export type CacheEffectStats = {
  readonly hitAvgMs: number | null;
  readonly missAvgMs: number | null;
  readonly eligibleTurns: number;
};

/** Raw row shape from the PERCENTILE_SQL query. */
type PercentileRawRow = {
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly count: number | null;
};

/**
 * Phase 115 Plan 00 — row shape exposing the six new column slots opened on
 * the `traces` table by `migrateSchema()`. Each field is OPTIONAL because
 * Plan 115-00 does not yet wire writes — Plans 115-02, 115-05, and 115-07
 * land the producers. Today every row in production reads NULL on all six.
 *
 * Exported so that downstream Phase 115 plans (and their tests) can declare
 * row-shape expectations without re-deriving the column list.
 *
 * Field ↔ producer mapping:
 *   - tier1_inject_chars            → Plan 115-02 (sub-scope 1 Tier 1 cap)
 *   - tier1_budget_pct              → Plan 115-02 (sub-scope 1 utilization)
 *   - tool_cache_hit_rate           → Plan 115-07 (sub-scope 15 tool cache)
 *   - tool_cache_size_mb            → Plan 115-07 (sub-scope 15 size telemetry)
 *   - lazy_recall_call_count        → Plan 115-05 (sub-scope 7 lazy recall)
 *   - prompt_bloat_warnings_24h     → Plan 115-02 (sub-scope 13 observability)
 *
 * The TypeScript camelCase form is mirrored on `TurnRecord` in
 * `src/performance/types.ts` so writers compose a turn record with these
 * fields named consistently with the rest of the schema.
 */
export type Phase115TurnColumns = {
  readonly tier1_inject_chars?: number | null;
  readonly tier1_budget_pct?: number | null;
  readonly tool_cache_hit_rate?: number | null;
  readonly tool_cache_size_mb?: number | null;
  readonly lazy_recall_call_count?: number | null;
  readonly prompt_bloat_warnings_24h?: number | null;
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
   * Phase 56 Plan 01 — expose the underlying database for READ-ONLY warmup
   * queries (AgentMemoryManager.warmSqliteStores). Do not use for writes —
   * go through writeTurn/pruneOlderThan instead.
   */
  getDatabase(): DatabaseType {
    return this.db;
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
        //
        // Phase 57 Plan 02: `turn_origin` is an OPTIONAL JSON blob. When present,
        // it round-trips through TurnOriginSchema.parse. When absent, column is
        // NULL — legacy Phase 50/51/52 callers that do not go through
        // TurnDispatcher remain queryable.
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
          t.turnOrigin ? JSON.stringify(t.turnOrigin) : null, // Phase 57 Plan 02
          // Phase 115 Plan 05 T04: lazy_recall_call_count. Producer optional
          // — turns that never invoked a clawcode_memory_* tool land NULL.
          t.lazyRecallCallCount ?? null,
          // Phase 115 Plan 07 T03: tool_cache_hit_rate + tool_cache_size_mb.
          // Producer optional — turns with zero cache-eligible tool calls
          // land NULL on hit_rate. Size_mb is sampled by the periodic
          // dashboard reporter (T04) and may be NULL on most turns.
          t.toolCacheHitRate ?? null,
          t.toolCacheSizeMb ?? null,
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
   * Returns one frozen row per entry in `CANONICAL_SEGMENTS` (6 rows as of
   * Phase 54 — was 4 pre-Phase-54). When a segment has no matching spans in
   * the window, its p-values are `null` and `count` is `0`.
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
   * Phase 54 — convenience wrapper over `getPercentiles` filtered to just the
   * `first_token` row. Powers the CLI / dashboard First Token headline card
   * (Plan 54-04) without forcing every caller to find-and-filter the full
   * 6-row percentile array.
   *
   * Returns exactly one frozen `PercentileRow`. When the window contains no
   * `first_token` spans, returns a count=0 / null-p-value row so the caller
   * can render "no_data" without a null-check ladder.
   */
  getFirstTokenPercentiles(
    agent: string,
    sinceIso: string,
  ): PercentileRow {
    const rows = this.getPercentiles(agent, sinceIso);
    const row = rows.find((r) => r.segment === "first_token");
    if (row) return row;
    return Object.freeze<PercentileRow>({
      segment: "first_token",
      p50: null,
      p95: null,
      p99: null,
      count: 0,
    });
  }

  /**
   * Phase 55 — per-tool percentile aggregation.
   *
   * Groups `trace_spans` rows by span name, filtered to `name LIKE 'tool_call.%'`,
   * extracts the tool name via `SUBSTR(name, 11)` (strips the canonical
   * `tool_call.` prefix — 11 characters including the trailing dot), and
   * computes p50/p95/p99/count per tool using the same nearest-rank approach
   * as `PERCENTILE_SQL`.
   *
   * Returns one frozen `ToolPercentileRow` per distinct tool observed in the
   * window, sorted by p95 DESC (nulls last) at the SQL layer. CLI + dashboard
   * consumers render the resulting list verbatim to highlight the slowest
   * tool at the top without a client-side re-sort.
   *
   * Empty window returns `[]` (not an error, not a sentinel row).
   */
  getToolPercentiles(
    agent: string,
    sinceIso: string,
  ): readonly ToolPercentileRow[] {
    try {
      const rows = this.stmts.perToolPercentiles.all({
        agent,
        since: sinceIso,
      }) as ReadonlyArray<{
        readonly tool_name: string;
        readonly p50: number | null;
        readonly p95: number | null;
        readonly p99: number | null;
        readonly count: number;
      }>;
      return Object.freeze(
        rows.map((r) =>
          Object.freeze<ToolPercentileRow>({
            tool_name: r.tool_name,
            p50: r.p50,
            p95: r.p95,
            p99: r.p99,
            count: r.count,
          }),
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TraceStoreError(
        `getToolPercentiles failed: ${msg}`,
        this.dbPath,
      );
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

  /**
   * Phase 52 Plan 03: compute the cache-effect first-token stats for the
   * `cache_effect_ms` metric surfaced on the `clawcode cache` CLI and
   * dashboard Prompt Cache panel.
   *
   * Cross-joins `traces` (cache columns) with `trace_spans` (first_token
   * duration) over the same agent + since window. Splits the average
   * `first_token` duration by whether `cache_read_input_tokens > 0` (hit) or
   * `= 0` (miss). Returns both averages plus the total eligible-turn count.
   *
   * NULL averages bubble up when one side has no rows (e.g., a freshly
   * started agent with no cache-hit turns yet). The caller is responsible
   * for gating on `eligibleTurns >= 20` (CONTEXT D-05 noise floor) before
   * computing the `hitAvgMs - missAvgMs` delta.
   *
   * A negative delta (hit average < miss average) means the cache is
   * delivering first-token latency improvement — the expected signal.
   */
  getCacheEffectStats(agent: string, sinceIso: string): CacheEffectStats {
    try {
      const raw = this.stmts.cacheEffectStats.get({
        agent,
        since: sinceIso,
      }) as CacheEffectRawRow | undefined;

      if (!raw) {
        return Object.freeze<CacheEffectStats>({
          hitAvgMs: null,
          missAvgMs: null,
          eligibleTurns: 0,
        });
      }

      return Object.freeze<CacheEffectStats>({
        hitAvgMs:
          typeof raw.hit_avg_ms === "number" ? raw.hit_avg_ms : null,
        missAvgMs:
          typeof raw.miss_avg_ms === "number" ? raw.miss_avg_ms : null,
        eligibleTurns:
          typeof raw.eligible_turns === "number" ? raw.eligible_turns : 0,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TraceStoreError(
        `getCacheEffectStats failed: ${msg}`,
        this.dbPath,
      );
    }
  }

  /** Close the underlying database connection. */
  close(): void {
    this.db.close();
  }

  /**
   * Phase 52 Plan 01 + Phase 57 Plan 02 + Phase 115 Plan 00: idempotent ALTER TABLE
   * migration.
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
   *   - turn_origin                   TEXT    (nullable JSON blob — Phase 57 Plan 02,
   *                                            populated by TurnDispatcher in Plan 57-03)
   *   - tier1_inject_chars            INTEGER (Phase 115 Plan 00 — column slot;
   *                                            writes wired by Plan 115-02)
   *   - tier1_budget_pct              REAL    (Phase 115 Plan 00 — column slot;
   *                                            writes wired by Plan 115-02)
   *   - tool_cache_hit_rate           REAL    (Phase 115 Plan 00 — column slot;
   *                                            writes wired by Plan 115-07)
   *   - tool_cache_size_mb            REAL    (Phase 115 Plan 00 — column slot;
   *                                            writes wired by Plan 115-07)
   *   - lazy_recall_call_count        INTEGER (Phase 115 Plan 00 — column slot;
   *                                            writes wired by Plan 115-05)
   *   - prompt_bloat_warnings_24h     INTEGER (Phase 115 Plan 00 — column slot;
   *                                            writes wired by Plan 115-02)
   *
   * Phase 115 Plan 00 only opens the column slots — `writeTurn` is NOT extended
   * to write to them yet. This means existing daemons can re-run the migration
   * without producer changes, and 115-02 / 115-05 / 115-07 can ship their write
   * logic without shipping a migration of their own.
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
      ["turn_origin", "TEXT"], // Phase 57 Plan 02 — nullable JSON blob
      // Phase 115 Plan 00 — column slots opened here so 115-02/05/07 can ship
      // their write paths without re-shipping migration code. All NULL on
      // legacy turns; readers MUST treat them as nullable.
      ["tier1_inject_chars", "INTEGER"],
      ["tier1_budget_pct", "REAL"],
      ["tool_cache_hit_rate", "REAL"],
      ["tool_cache_size_mb", "REAL"],
      ["lazy_recall_call_count", "INTEGER"],
      ["prompt_bloat_warnings_24h", "INTEGER"],
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

      -- Phase 115 Plan 05 T03 — D-05 priority dream-pass trigger.
      -- Records each tier-1 truncation event (when MEMORY.md exceeded
      -- INJECTED_MEMORY_MAX_CHARS at session-config.ts assembly time and
      -- the 70/20 head-tail truncation fired). Indexed by (agent, event_at)
      -- so dream-cron can query the 24h count in O(log n).
      CREATE TABLE IF NOT EXISTS tier1_truncation_events (
        agent TEXT NOT NULL,
        event_at INTEGER NOT NULL,
        dropped_chars INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_tier1_truncation_events_agent_time
        ON tier1_truncation_events(agent, event_at);

      CREATE INDEX IF NOT EXISTS idx_traces_agent_started ON traces(agent, started_at);
      CREATE INDEX IF NOT EXISTS idx_spans_turn_name ON trace_spans(turn_id, name);
    `);
  }

  private prepareStatements(): PreparedStatements {
    return {
      // Phase 57 Plan 02: 13-arg positional insert (was 12-arg in Phase 52 Plan 01).
      // Last 6 columns are nullable — Phase 50 callers pass NULL for all of them,
      // Phase 52 callers pass NULL for turn_origin. Phase 57 Plan 03 migrates
      // DiscordBridge + TaskScheduler to provide the turn_origin JSON blob.
      // Phase 115 Plan 05 T04: lazy_recall_call_count column slot opened in
      // Plan 115-00 migrateSchema(); writes wired here. Legacy callers pass
      // NULL via the `lazyRecallCallCount ?? null` fallback in writeTurn().
      // Phase 115 Plan 07 T03: tool_cache_hit_rate + tool_cache_size_mb
      // column slots wired here. Per-turn rate computed from hit/(hit+miss);
      // turns with zero cache-eligible tool calls land NULL.
      insertTrace: this.db.prepare(`
        INSERT OR REPLACE INTO traces
          (id, agent, started_at, ended_at, total_ms, discord_channel_id, status,
           cache_read_input_tokens, cache_creation_input_tokens, input_tokens,
           prefix_hash, cache_eviction_expected, turn_origin,
           lazy_recall_call_count, tool_cache_hit_rate, tool_cache_size_mb)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      // Phase 55 Plan 01: per-tool percentile aggregation. Groups spans whose
      // name starts with `tool_call.` by the extracted tool name (SUBSTR
      // strips the 10-char prefix + period = 11 chars). Nearest-rank p50/p95/p99
      // mirrors PERCENTILE_SQL. Sorted by p95 DESC at the SQL layer so CLI /
      // dashboard consumers render slowest-first without client-side sort.
      // NULLS LAST — SQLite places NULLs first on ASC and last on DESC by
      // default, but we spell it explicitly so intent is clear.
      perToolPercentiles: this.db.prepare(`
        WITH tool_spans AS (
          SELECT
            SUBSTR(s.name, 11) AS tool_name,
            s.duration_ms
          FROM trace_spans s
          JOIN traces t ON t.id = s.turn_id
          WHERE t.agent = @agent
            AND t.started_at >= @since
            AND s.name LIKE 'tool_call.%'
        ),
        ranked AS (
          SELECT
            tool_name,
            duration_ms,
            ROW_NUMBER() OVER (PARTITION BY tool_name ORDER BY duration_ms) AS rn,
            COUNT(*) OVER (PARTITION BY tool_name) AS cnt
          FROM tool_spans
        )
        SELECT
          tool_name,
          CAST(MIN(CASE WHEN rn >= CAST(cnt * 0.50 AS INTEGER) + 1 THEN duration_ms END) AS INTEGER) AS p50,
          CAST(MIN(CASE WHEN rn >= CAST(cnt * 0.95 AS INTEGER) + 1 THEN duration_ms END) AS INTEGER) AS p95,
          CAST(MIN(CASE WHEN rn >= CAST(cnt * 0.99 AS INTEGER) + 1 THEN duration_ms END) AS INTEGER) AS p99,
          cnt AS count
        FROM ranked
        GROUP BY tool_name
        ORDER BY p95 DESC NULLS LAST
      `),
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
      // Phase 52 Plan 03: cache-effect first-token stats.
      // Split AVG(first_token.duration_ms) by whether the parent turn was a
      // cache hit (cache_read_input_tokens > 0) vs miss (= 0). Both filters
      // require cache_read_input_tokens IS NOT NULL so Phase 50 legacy turns
      // are excluded from both sides. COUNT(*) returns the overall eligible
      // count (any turn with cache_read_input_tokens IS NOT NULL AND a
      // first_token span) so the caller can gate on the 20-turn noise floor.
      cacheEffectStats: this.db.prepare(`
        SELECT
          AVG(CASE WHEN t.cache_read_input_tokens > 0 THEN s.duration_ms END) AS hit_avg_ms,
          AVG(CASE WHEN t.cache_read_input_tokens = 0 THEN s.duration_ms END) AS miss_avg_ms,
          COUNT(*) AS eligible_turns
        FROM traces t
        JOIN trace_spans s ON s.turn_id = t.id
        WHERE s.name = 'first_token'
          AND t.agent = @agent
          AND t.started_at >= @since
          AND t.cache_read_input_tokens IS NOT NULL
      `),
      // Phase 115 Plan 05 T03 — D-05 priority dream-pass trigger.
      // Per-event row insert for tier-1 truncation count tracking.
      insertTier1TruncationEvent: this.db.prepare(`
        INSERT INTO tier1_truncation_events (agent, event_at, dropped_chars)
        VALUES (?, ?, ?)
      `),
      // Phase 115 Plan 05 T03 — counts events for one agent in a [since, now]
      // window. dream-cron consumes this to decide priority-pass scheduling.
      countTier1TruncationEventsSince: this.db.prepare(`
        SELECT COUNT(*) AS n
        FROM tier1_truncation_events
        WHERE agent = @agent
          AND event_at >= @since
      `),
    };
  }

  /**
   * Phase 115 Plan 05 T03 — record a tier-1 truncation event (D-05 trigger
   * counter). Called from session-config.ts when MEMORY.md exceeded
   * INJECTED_MEMORY_MAX_CHARS at assembly time. The dream-cron tick
   * queries `countTier1TruncationEventsSince` and fires a priority pass
   * when 2+ events fired in 24h for the same agent.
   *
   * Per-agent isolation: agent is treated as opaque — the per-agent
   * traces.db invariant (Phase 90) ensures cross-agent collision is
   * impossible. The column is indexed so 24h count queries are O(log n).
   */
  recordTier1TruncationEvent(agent: string, droppedChars = 0): void {
    try {
      this.stmts.insertTier1TruncationEvent.run(
        agent,
        Date.now(),
        droppedChars,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TraceStoreError(
        `recordTier1TruncationEvent failed: ${msg}`,
        this.dbPath,
      );
    }
  }

  /**
   * Phase 115 Plan 05 T03 — count tier-1 truncation events for an agent
   * since `sinceMs` (epoch ms). Used by dream-cron's
   * `shouldFirePriorityPass` to compute the 2-in-24h trigger.
   *
   * Returns 0 when no events recorded — never throws on missing rows.
   */
  countTier1TruncationEventsSince(agent: string, sinceMs: number): number {
    try {
      const row = this.stmts.countTier1TruncationEventsSince.get({
        agent,
        since: sinceMs,
      }) as { readonly n: number } | undefined;
      return row?.n ?? 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TraceStoreError(
        `countTier1TruncationEventsSince failed: ${msg}`,
        this.dbPath,
      );
    }
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
