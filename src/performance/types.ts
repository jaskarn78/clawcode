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
};

/**
 * Canonical segment names the CLI and dashboard agree on.
 *
 * `tool_call` is the aggregate row across all `tool_call.<name>` spans
 * (see TraceStore.getPercentiles + PERCENTILE_SQL aggregation clause).
 */
export type CanonicalSegment =
  | "end_to_end"
  | "first_token"
  | "context_assemble"
  | "tool_call";

/** Frozen list of the four canonical segments, in display order. */
export const CANONICAL_SEGMENTS: readonly CanonicalSegment[] = Object.freeze([
  "end_to_end",
  "first_token",
  "context_assemble",
  "tool_call",
]);

/**
 * One row per canonical segment returned by getPercentiles.
 *
 * p-values are `null` only when count === 0 (no matching spans in window).
 */
export type PercentileRow = {
  readonly segment: CanonicalSegment;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly count: number;
};

/** Shape returned by the `latency` IPC method + `clawcode latency` CLI. */
export type LatencyReport = {
  readonly agent: string;
  /** ISO 8601 cutoff used for the query window. */
  readonly since: string;
  readonly segments: readonly PercentileRow[];
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
