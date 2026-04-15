/**
 * Trace types for the per-agent latency tracing subsystem.
 *
 * These types are the shared contract between TraceCollector (in-memory span
 * buffer) and TraceStore (SQLite persistence). All domain records are fully
 * readonly and are expected to be frozen by their producers.
 *
 * SECURITY: span metadata stores small payloads ONLY (tool name, content
 * length, model). NEVER prompt bodies or message contents. The TraceStore
 * enforces a 1KB cap on the serialized metadata JSON per span.
 */

import type { TurnOrigin } from "../manager/turn-origin.js";

/** Terminal status recorded on a completed turn. */
export type TurnStatus = "success" | "error";

/**
 * A single timed phase within a turn.
 *
 * `name` is one of the canonical segments (`receive`, `context_assemble`,
 * `first_token`, `end_to_end`) OR a `tool_call.<name>` prefixed span.
 */
export type SpanRecord = {
  readonly name: string;
  /** ISO 8601 timestamp when the span started. */
  readonly startedAt: string;
  /** Duration of the span in milliseconds (Date.now() delta). */
  readonly durationMs: number;
  /** Small-payload metadata only. See file header SECURITY note. */
  readonly metadata: Readonly<Record<string, unknown>>;
};

/**
 * A complete turn: one Discord message -> reply cycle (or scheduler tick).
 *
 * The turn record is what TraceStore.writeTurn persists in a single
 * transaction. `id` is the Discord message id for Discord-triggered turns,
 * or a `scheduler:<nanoid>` / `subagent:<nanoid>` prefixed id otherwise.
 *
 * Phase 52 Plan 01 adds five OPTIONAL cache-telemetry fields. They are
 * populated by `Turn.recordCacheUsage` when the SDK result message carries
 * `usage.cache_read_input_tokens` / `cache_creation_input_tokens` / `input_tokens`.
 * Producers on the Phase 50 timeline may omit them — consumers MUST treat all
 * five as optional. `prefix_hash` + `cache_eviction_expected` remain undefined
 * until Plan 52-02 wires the context-assembler stable-prefix split.
 */
export type TurnRecord = {
  readonly id: string;
  readonly agent: string;
  readonly channelId: string | null;
  /** ISO 8601 timestamp when startTurn was called. */
  readonly startedAt: string;
  /** ISO 8601 timestamp when turn.end(status) was called. */
  readonly endedAt: string;
  /** endedAt - startedAt in milliseconds. */
  readonly totalMs: number;
  readonly status: TurnStatus;
  readonly spans: readonly SpanRecord[];
  /**
   * Phase 52 Plan 01: tokens served from the prompt cache for this turn.
   * Populated by session-adapter from `msg.usage.cache_read_input_tokens`.
   */
  readonly cacheReadInputTokens?: number;
  /**
   * Phase 52 Plan 01: tokens written into the prompt cache for this turn
   * (new cache entries created). Populated from
   * `msg.usage.cache_creation_input_tokens`.
   */
  readonly cacheCreationInputTokens?: number;
  /**
   * Phase 52 Plan 01: uncached input tokens for this turn. Populated from
   * `msg.usage.input_tokens`. Used as the denominator in the hit-rate formula.
   */
  readonly inputTokens?: number;
  /**
   * Phase 52 Plan 02: sha256 of the stable prefix string assembled for this
   * turn. Used by dashboard to detect prefix changes between adjacent turns.
   * SECURITY: sha256 is safe to log — never the raw prefix body.
   */
  readonly prefixHash?: string;
  /**
   * Phase 52 Plan 02: true when this turn's `prefixHash` differs from the
   * immediately prior turn's for the same agent. An operator-facing signal
   * that a cache eviction was expected (prompt prefix changed).
   */
  readonly cacheEvictionExpected?: boolean;
  /**
   * Phase 57 Plan 02: provenance blob attached by TurnDispatcher. When present,
   * identifies the source (Discord / scheduler / Phase 59 task / Phase 60 trigger),
   * the root turn of the chain, the immediate parent, and the full chain[].
   * Downstream Phase 63 `clawcode trace <causation_id>` walker pattern-matches
   * on `source.kind` + `chain[]` to stitch cross-agent causation.
   *
   * Optional — Phase 50/51/52 legacy callers (e.g., bench harness, heartbeat
   * checks) that open a Turn without going through TurnDispatcher omit it.
   * Plan 57-03 migrates DiscordBridge + TaskScheduler to provide it.
   */
  readonly turnOrigin?: TurnOrigin;
};

/**
 * Phase 52 Plan 01: in-flight cache telemetry snapshot captured off the SDK
 * `result` message and attached to the parent Turn via `recordCacheUsage`.
 *
 * All three token counts are REQUIRED here (the session-adapter defaults
 * missing fields to 0 per Phase 52 D-01 decision). `prefixHash` +
 * `cacheEvictionExpected` are OPTIONAL on the snapshot — Plan 52-01 does not
 * compute them; Plan 52-02 supplies them once the assembler splits stable /
 * mutable blocks.
 */
export type CacheTelemetrySnapshot = {
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly inputTokens: number;
  readonly prefixHash?: string;
  readonly cacheEvictionExpected?: boolean;
};

/**
 * Phase 52 Plan 01: one point in the cache-hit-rate trend chart.
 *
 * `date` is a YYYY-MM-DD UTC day key (grouped by `substr(started_at, 1, 10)`
 * in the SQL). `turns` is the number of cache-aware turns that day;
 * `hitRate` is the day's arithmetic mean hit rate in [0..1].
 */
export type CacheTrendPoint = {
  readonly date: string;
  readonly turns: number;
  readonly hitRate: number;
};

/**
 * Phase 52 Plan 01: query result of `TraceStore.getCacheTelemetry`.
 *
 * Mirrors `LatencyReport` symmetry so the CLI/dashboard formatters (Plan 52-03)
 * stay structurally aligned with `clawcode latency`.
 *
 * Hit-rate formula (Phase 52 D-01):
 *   hit_rate = cache_read / (cache_read + cache_creation + input)
 *
 * `avgHitRate`, `p50HitRate`, `p95HitRate` all live in [0..1]. Returns 0 when
 * the window contains no cache-signal turns (`input_tokens > 0` rows).
 */
export type CacheTelemetryReport = {
  readonly agent: string;
  /** ISO 8601 cutoff used for the query window. */
  readonly since: string;
  readonly totalTurns: number;
  readonly avgHitRate: number;
  readonly p50HitRate: number;
  readonly p95HitRate: number;
  /** Sum of `cache_read_input_tokens` over the window. */
  readonly totalCacheReads: number;
  /** Sum of `cache_creation_input_tokens` over the window. */
  readonly totalCacheWrites: number;
  /** Sum of `input_tokens` over the window. */
  readonly totalInputTokens: number;
  readonly trendByDay: readonly CacheTrendPoint[];
};

/**
 * Phase 52 Plan 01: status of the cache-hit-rate SLO for a window.
 *
 * Mirrors `SloStatus` shape but is a distinct type because cache hit rate is a
 * ratio (0..1), not a millisecond threshold — and the gray zone (0.30..0.60)
 * maps to `no_data` to signal "warming up" on the dashboard.
 */
export type CacheHitRateStatus = "healthy" | "breach" | "no_data";

/**
 * Canonical segment names the CLI and dashboard agree on.
 *
 * `tool_call` is the aggregate row across all `tool_call.<name>` spans
 * (see TraceStore.getPercentiles + PERCENTILE_SQL aggregation clause).
 *
 * Phase 54 additions:
 *   - `first_visible_token` — Discord-plumbing view of first_token (measured
 *     from `handleMessage` entry to the first `editFn` call). The delta from
 *     `first_token` captures Discord-plumbing overhead. Debug/support metric,
 *     intentionally NOT elevated to a headline card.
 *   - `typing_indicator` — `handleMessage` entry → `sendTyping()` call.
 *     Budgeted at p95 ≤ 500ms. Observational initially per CONTEXT D-03.
 *
 * NOTE: `src/benchmarks/types.ts` segmentEnum stays on the 4-name Phase 51
 * shape so committed baselines remain backward-compatible. Plan 54-03 will
 * filter the bench runner's `overall_percentiles` back to those 4 names.
 */
export type CanonicalSegment =
  | "end_to_end"
  | "first_token"
  | "first_visible_token"
  | "context_assemble"
  | "tool_call"
  | "typing_indicator";

/** Frozen list of the six canonical segments, in display order. */
export const CANONICAL_SEGMENTS: readonly CanonicalSegment[] = Object.freeze([
  "end_to_end",
  "first_token",
  "first_visible_token",
  "context_assemble",
  "tool_call",
  "typing_indicator",
]);

/**
 * SLO evaluation status for a percentile row.
 *
 * Moved here (from slos.ts) in Phase 51 Plan 03 so `PercentileRow` can
 * reference `SloStatus`/`SloMetric` without a circular import between
 * `types.ts` and `slos.ts`. `src/performance/slos.ts` re-exports both.
 */
export type SloStatus = "healthy" | "breach" | "no_data";

/**
 * Which percentile an SLO is measured against. Mirrors the shape consumed by
 * `evaluateSloStatus(row, thresholdMs, metric)` in `src/performance/slos.ts`.
 * Moved here alongside `SloStatus` to break the potential circular import.
 */
export type SloMetric = "p50" | "p95" | "p99";

/**
 * One row per canonical segment returned by getPercentiles.
 *
 * p-values are `null` only when count === 0 (no matching spans in window).
 *
 * Phase 51 Plan 03 adds three OPTIONAL SLO-related fields. They are populated
 * by the daemon's `latency` IPC handler via `augmentWithSloStatus` (which
 * merges per-agent `perf.slos?` overrides with `DEFAULT_SLOS`). Producers on
 * the Phase 50 timeline may omit them entirely — consumers MUST treat all
 * three as optional.
 */
export type PercentileRow = {
  readonly segment: CanonicalSegment;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly count: number;
  /**
   * Added in Phase 51 Plan 03. `undefined` on producers that do not augment.
   * Computed by `augmentWithSloStatus` from the merged SLO table.
   */
  readonly slo_status?: SloStatus;
  /**
   * Added in Phase 51 Plan 03. Threshold in milliseconds the server
   * evaluated this row against (after merging per-agent overrides).
   * `null` when no SLO is configured for this segment. The dashboard reads
   * this to render the "SLO target" subtitle — single source of truth
   * stays server-side (no client mirror of DEFAULT_SLOS).
   */
  readonly slo_threshold_ms?: number | null;
  /**
   * Added in Phase 51 Plan 03. Which percentile column the SLO is measured
   * against (mirrors the merged `SloEntry.metric`). `null` when no SLO is
   * configured for this segment. The dashboard reads this for the subtitle
   * text AND to know which cell to tint.
   */
  readonly slo_metric?: SloMetric | null;
};

/**
 * Phase 55 — one row per tool observed in the query window. Emitted by
 * `TraceStore.getToolPercentiles`. Sorted by p95 DESC (nulls last) at the
 * SQL layer so CLI / dashboard can highlight the slowest tool without a
 * client-side re-sort.
 *
 * `tool_name` is extracted from the span name via `SUBSTR(name, 11)` — the
 * canonical `tool_call.<name>` prefix is stripped so consumers see just the
 * tool name (e.g. `memory_lookup`, not `tool_call.memory_lookup`).
 *
 * All rows and the enclosing array are frozen. Empty windows return `[]`.
 */
export type ToolPercentileRow = {
  readonly tool_name: string;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly count: number;
};

/**
 * Phase 54 Plan 04: shape of the `first_token_headline` object emitted at the
 * top level of the `latency` IPC response. Server-evaluated so the CLI and
 * dashboard render verbatim — no client-side SLO threshold mirror.
 *
 * Cold-start guard: `slo_status === "no_data"` when `count < 5` regardless of
 * measured percentile. See `evaluateFirstTokenHeadline` in src/manager/daemon.ts.
 *
 * Optional on `LatencyReport` so pre-Phase-54 cached/piped consumers keep
 * parsing. Consumers MUST treat this as optional.
 */
export type FirstTokenHeadline = {
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly count: number;
  readonly slo_status: SloStatus;
  readonly slo_threshold_ms: number | null;
  readonly slo_metric: SloMetric | null;
};

/** Shape returned by the `latency` IPC method + `clawcode latency` CLI. */
export type LatencyReport = {
  readonly agent: string;
  /** ISO 8601 cutoff used for the query window. */
  readonly since: string;
  readonly segments: readonly PercentileRow[];
  /**
   * Phase 54 Plan 04: first-token headline card shape. Optional so older
   * consumers / pre-Phase-54 cached responses don't break parsing.
   */
  readonly first_token_headline?: FirstTokenHeadline;
};

/**
 * Thrown when a TraceStore operation fails.
 * Includes the database path for debugging context.
 */
export class TraceStoreError extends Error {
  readonly dbPath: string;

  constructor(message: string, dbPath: string) {
    super(`Trace store error (${dbPath}): ${message}`);
    this.name = "TraceStoreError";
    this.dbPath = dbPath;
  }
}
