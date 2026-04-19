/**
 * Types for persistent usage tracking.
 *
 * Records token consumption, cost, turns, model, and duration
 * per SDK interaction for each agent.
 *
 * Phase 72 extension: optional `category`, `backend`, `count` fields
 * record image-generation cost rows alongside token rows in the same
 * `usage_events` table. All new fields are optional for back-compat:
 * existing token-recording call sites still type-check.
 */

/**
 * Usage category. Defaults to `"tokens"` (when null/undefined in DB)
 * for back-compat with all pre-Phase-72 rows.
 */
export type UsageCategory = "tokens" | "image";

/**
 * A single usage event recorded after an SDK send/sendAndCollect completes,
 * or after an image-generation tool call (Phase 72).
 */
export type UsageEvent = {
  readonly id: string;
  readonly agent: string;
  readonly timestamp: string;
  readonly tokens_in: number;
  readonly tokens_out: number;
  readonly cost_usd: number;
  readonly turns: number;
  readonly model: string;
  readonly duration_ms: number;
  readonly session_id: string;
  // Phase 72 additions — all optional, all NULL-able in the DB schema:
  /** Defaults to "tokens" when omitted (for back-compat with existing rows). */
  readonly category?: UsageCategory;
  /** Image backend identifier (e.g. "openai" / "minimax" / "fal"). */
  readonly backend?: string;
  /** Image count (n parameter) — number of images this event represents. */
  readonly count?: number;
};

/**
 * Aggregated usage data from one or more events.
 * All fields default to 0 when no matching events exist.
 */
export type UsageAggregate = {
  readonly tokens_in: number;
  readonly tokens_out: number;
  readonly cost_usd: number;
  readonly turns: number;
  readonly duration_ms: number;
  readonly event_count: number;
};

/**
 * Cost data grouped by agent and model.
 * Returned by getCostsByAgentModel for per-agent/per-model cost breakdown.
 *
 * Phase 72: `category` is included so the costs CLI can split image
 * rows from token rows. NULL in DB (pre-Phase-72 rows) → exposed as
 * `null`; CLI displays NULL as "tokens".
 */
export type CostByAgentModel = {
  readonly agent: string;
  readonly model: string;
  readonly tokens_in: number;
  readonly tokens_out: number;
  readonly cost_usd: number;
  /** Phase 72 — null for legacy rows, "tokens"/"image" for new rows. */
  readonly category?: string | null;
};

/**
 * Phase 72 — cost aggregation by category for the costs CLI breakdown
 * (`clawcode costs --by-category`). Returned by getCostsByCategory.
 */
export type CostByCategory = {
  readonly category: string;
  readonly cost_usd: number;
};
