/**
 * SLO source of truth for the v1.7 latency budget.
 *
 * `DEFAULT_SLOS` is the single, frozen list of latency targets. It is imported
 * by:
 *   - The daemon's latency IPC handler (Plan 51-03) — to attach
 *     `slo_status: "healthy" | "breach" | "no_data"` per segment to the
 *     `/api/agents/:name/latency` response.
 *   - The CI regression gate (`src/benchmarks/thresholds.ts`) — to know which
 *     segments require a tracked threshold.
 *
 * Per-agent or fleet-wide overrides arrive through the Zod-parsed
 * `clawcode.yaml` `perf.slos: [...]` field (see `src/config/schema.ts`
 * `sloOverrideSchema`). They merge through `mergeSloOverrides` with
 * per-(segment, metric) replacement semantics.
 *
 * SECURITY: SLO entries are tiny config — no PII, no secrets, no risk vector.
 * Every record returned by this module is `Object.freeze`d.
 */

import {
  CANONICAL_SEGMENTS,
  type CacheHitRateStatus,
  type CanonicalSegment,
  type PercentileRow,
  type SloMetric,
  type SloStatus,
} from "./types.js";

// `SloMetric` + `SloStatus` were moved to `./types.ts` in Phase 51 Plan 03 so
// `PercentileRow` can reference them without a circular import. Re-export here
// so existing callers that import from `./slos.js` keep working unchanged.
export type { CacheHitRateStatus, SloMetric, SloStatus };

/**
 * A single SLO target: which segment, which percentile, and the maximum
 * milliseconds before the row is considered a breach.
 */
export type SloEntry = {
  readonly segment: CanonicalSegment;
  readonly metric: SloMetric;
  readonly thresholdMs: number;
};

/**
 * Default SLO targets for v1.7 — the single source of truth. Verbatim from
 * `.planning/phases/51-slos-regression-gate/51-CONTEXT.md` decisions plus
 * Phase 54 streaming-and-typing-indicator additions:
 *
 *   - `end_to_end`        p95 ≤ 6000 ms
 *   - `first_token`       p50 ≤ 2000 ms
 *   - `context_assemble`  p95 ≤  300 ms
 *   - `tool_call`         p95 ≤ 1500 ms
 *   - `typing_indicator`  p95 ≤  500 ms  (Phase 54 — observational initially)
 *
 * The `typing_indicator` 500 ms budget is deliberately aggressive. Per Phase
 * 54 CONTEXT D-03 operators should treat it as OBSERVATIONAL for the first
 * week of real traffic, observing p95 before treating breach as a hard gate.
 * The `first_visible_token` canonical segment intentionally has NO default
 * SLO — it is the debug/support metric (delta vs `first_token` captures
 * Discord plumbing overhead), not a headline.
 *
 * Frozen at module load. Override per-agent via `clawcode.yaml`
 * `perf.slos: [...]` which feeds `mergeSloOverrides`.
 */
export const DEFAULT_SLOS: readonly SloEntry[] = Object.freeze([
  Object.freeze<SloEntry>({
    segment: "end_to_end",
    metric: "p95",
    thresholdMs: 6000,
  }),
  Object.freeze<SloEntry>({
    segment: "first_token",
    metric: "p50",
    thresholdMs: 2000,
  }),
  Object.freeze<SloEntry>({
    segment: "context_assemble",
    metric: "p95",
    thresholdMs: 300,
  }),
  Object.freeze<SloEntry>({
    segment: "tool_call",
    metric: "p95",
    thresholdMs: 1500,
  }),
  Object.freeze<SloEntry>({
    segment: "typing_indicator",
    metric: "p95",
    thresholdMs: 500,
  }),
]);

/**
 * Evaluate a percentile row against an SLO threshold for a given metric.
 *
 * Returns `"no_data"` when `count === 0` OR when the requested percentile is
 * `null` (the row exists but the metric column is empty — e.g. a window with
 * traces but no first-token spans).
 *
 * Returns `"healthy"` when `row[metric] <= thresholdMs`.
 * Returns `"breach"`  when `row[metric] >  thresholdMs`.
 *
 * Pure function — safe to call from the daemon, the dashboard, or the CI gate.
 *
 * @param row         - The percentile row to evaluate (any object with the
 *                      four standard percentile keys + count).
 * @param thresholdMs - Maximum tolerated milliseconds for `metric`.
 * @param metric      - Which percentile column the SLO targets.
 */
export function evaluateSloStatus(
  row: Pick<PercentileRow, "p50" | "p95" | "p99" | "count">,
  thresholdMs: number,
  metric: SloMetric,
): SloStatus {
  if (row.count === 0) return "no_data";
  const value = row[metric];
  if (value === null) return "no_data";
  return value <= thresholdMs ? "healthy" : "breach";
}

/**
 * Merge user overrides into a base SLO list (typically `DEFAULT_SLOS`).
 *
 * Per-(segment, metric) override semantics:
 *   - An override matching BOTH `segment` AND `metric` REPLACES the base
 *     threshold. Position in the result preserved.
 *   - An override matching the segment but a DIFFERENT metric is APPENDED —
 *     a single segment may carry multiple SLOs in future (e.g. p50 AND p95
 *     first_token).
 *
 * The returned array and every entry are frozen. Inputs are never mutated.
 *
 * @param defaults  - Base SLO list (usually `DEFAULT_SLOS`).
 * @param overrides - User-supplied overrides (validated by Zod elsewhere).
 * @returns A frozen merged list.
 */
export function mergeSloOverrides(
  defaults: readonly SloEntry[],
  overrides: readonly SloEntry[],
): readonly SloEntry[] {
  const result: SloEntry[] = [];
  const consumed = new Set<number>();

  for (const def of defaults) {
    const matchIndex = overrides.findIndex(
      (o) => o.segment === def.segment && o.metric === def.metric,
    );
    if (matchIndex >= 0) {
      const o = overrides[matchIndex]!;
      result.push(
        Object.freeze<SloEntry>({
          segment: def.segment,
          metric: def.metric,
          thresholdMs: o.thresholdMs,
        }),
      );
      consumed.add(matchIndex);
    } else {
      result.push(def);
    }
  }

  for (let i = 0; i < overrides.length; i++) {
    if (consumed.has(i)) continue;
    const o = overrides[i]!;
    result.push(
      Object.freeze<SloEntry>({
        segment: o.segment,
        metric: o.metric,
        thresholdMs: o.thresholdMs,
      }),
    );
  }

  return Object.freeze(result);
}

/**
 * Phase 52 Plan 01: cache-hit-rate SLO bands.
 *
 * Separate from `DEFAULT_SLOS` because cache hit rate is a ratio (0..1), not a
 * millisecond threshold. Per Phase 52 CONTEXT D-03 surfacing decision:
 *   - healthy ≥ 0.60
 *   - breach  < 0.30
 *   - gray zone (0.30..0.60) → `no_data` = warming up, neutral tint
 *
 * Values are verbatim from the CONTEXT file and MUST NOT be edited casually —
 * they are surfaced on the dashboard and drive operator attention bandwidth.
 */
export type CacheHitRateSloEntry = {
  readonly healthyMin: number;
  readonly breachMax: number;
};

export const CACHE_HIT_RATE_SLO: CacheHitRateSloEntry = Object.freeze({
  healthyMin: 0.6,
  breachMax: 0.3,
});

/**
 * Evaluate a cache hit-rate observation against `CACHE_HIT_RATE_SLO`.
 *
 * Pure function. Returns:
 *   - `"no_data"` when `turns === 0` (no observations in window).
 *   - `"healthy"` when `hitRate >= CACHE_HIT_RATE_SLO.healthyMin` (0.60).
 *   - `"breach"`  when `hitRate <  CACHE_HIT_RATE_SLO.breachMax`  (0.30).
 *   - `"no_data"` in the gray zone (0.30..0.60) — warming up, neither green
 *     nor red. The dashboard renders a neutral tint so operators are not
 *     distracted while the cache is establishing its prefix.
 *
 * @param hitRate - Observed hit rate in [0..1].
 * @param turns   - Number of turns that contributed to the hit rate.
 */
export function evaluateCacheHitRateStatus(
  hitRate: number,
  turns: number,
): CacheHitRateStatus {
  if (turns === 0) return "no_data";
  if (hitRate >= CACHE_HIT_RATE_SLO.healthyMin) return "healthy";
  if (hitRate < CACHE_HIT_RATE_SLO.breachMax) return "breach";
  return "no_data";
}

/**
 * Phase 55 — resolve the effective SLO for a named tool with fallback to the
 * global `tool_call` SLO.
 *
 * Lookup order:
 *   1. If `perTools?.slos?.[toolName]` exists, that wins. The override's
 *      `metric` defaults to `"p95"` when omitted so the common case stays
 *      concise in clawcode.yaml.
 *   2. Otherwise falls back to the `tool_call` entry in `DEFAULT_SLOS`
 *      (1500ms p95 from 51-CONTEXT).
 *
 * Unknown tools (not in the override map, not in DEFAULT_SLOS) still receive
 * the global `tool_call` fallback so the dashboard and CLI always have a
 * threshold to render — no `null` cases for consumers to null-check.
 *
 * Pure function; returns a frozen `{ thresholdMs, metric }` pair.
 *
 * @param toolName - The tool name (e.g. `"memory_lookup"`) without the
 *                   `tool_call.` prefix.
 * @param perTools - Optional per-agent `perf.tools` config (the `.slos` field
 *                   is the only one this helper reads). `undefined` falls
 *                   through to the global SLO directly.
 */
export function getPerToolSlo(
  toolName: string,
  perTools?: {
    readonly slos?: Readonly<
      Record<
        string,
        { readonly thresholdMs: number; readonly metric?: SloMetric }
      >
    >;
  },
): { readonly thresholdMs: number; readonly metric: SloMetric } {
  const override = perTools?.slos?.[toolName];
  if (override) {
    return Object.freeze({
      thresholdMs: override.thresholdMs,
      metric: override.metric ?? "p95",
    });
  }
  const globalToolCall = DEFAULT_SLOS.find((s) => s.segment === "tool_call");
  return Object.freeze({
    thresholdMs: globalToolCall?.thresholdMs ?? 1500,
    metric: globalToolCall?.metric ?? "p95",
  });
}

// Re-export for downstream symmetry (so callers don't need a second import to
// iterate canonical segment names).
export { CANONICAL_SEGMENTS };
