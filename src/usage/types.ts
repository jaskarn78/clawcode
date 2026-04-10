/**
 * Types for persistent usage tracking.
 *
 * Records token consumption, cost, turns, model, and duration
 * per SDK interaction for each agent.
 */

/**
 * A single usage event recorded after an SDK send/sendAndCollect completes.
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
 */
export type CostByAgentModel = {
  readonly agent: string;
  readonly model: string;
  readonly tokens_in: number;
  readonly tokens_out: number;
  readonly cost_usd: number;
};
