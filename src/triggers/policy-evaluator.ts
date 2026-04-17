/**
 * Phase 60 Plan 01 — default PolicyEvaluator.
 *
 * Internal chokepoint called by TriggerEngine.evaluate() before dispatch.
 * Default policy: "if the event's targetAgent is in the set of configured
 * agents, allow the dispatch."
 *
 * This is a pure function with no side effects, no I/O, and frozen return
 * values. Phase 62 will replace this with a full DSL-aware evaluator.
 * The interface (TriggerEvent in, PolicyResult out) is the stable contract.
 */

import type { TriggerEvent } from "./types.js";

// ---------------------------------------------------------------------------
// PolicyResult — discriminated union for policy evaluation outcomes
// ---------------------------------------------------------------------------

export type PolicyResult =
  | Readonly<{ allow: true; targetAgent: string }>
  | Readonly<{ allow: false; reason: string }>;

// ---------------------------------------------------------------------------
// evaluatePolicy — the Phase 60 default pass-through
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a trigger event should be dispatched.
 *
 * Default policy: if `event.targetAgent` is present in `configuredAgents`,
 * return `{ allow: true, targetAgent }`. Otherwise return `{ allow: false }`
 * with a diagnostic reason string.
 *
 * @param event           The trigger event to evaluate.
 * @param configuredAgents The set of agent names currently registered.
 * @returns Frozen PolicyResult — either allow or deny with reason.
 */
export function evaluatePolicy(
  event: TriggerEvent,
  configuredAgents: ReadonlySet<string>,
): PolicyResult {
  if (!configuredAgents.has(event.targetAgent)) {
    return Object.freeze({
      allow: false as const,
      reason: `target agent '${event.targetAgent}' not configured`,
    });
  }
  return Object.freeze({
    allow: true as const,
    targetAgent: event.targetAgent,
  });
}
