import { describe, it, expect } from "vitest";

import { augmentWithSloStatus } from "../daemon.js";
import type { PercentileRow } from "../../performance/types.js";

/**
 * Build a frozen PercentileRow for tests. `p99` defaults to the p95 value so
 * tests that only care about p95 don't have to repeat the number.
 */
function row(
  segment: string,
  p95Or: number | null,
  count: number,
  p50: number | null = p95Or,
): PercentileRow {
  return Object.freeze({
    segment: segment as PercentileRow["segment"],
    p50,
    p95: p95Or,
    p99: p95Or,
    count,
  });
}

describe("augmentWithSloStatus", () => {
  it("flags end_to_end p95=4000 as healthy with threshold 6000 p95", () => {
    const out = augmentWithSloStatus([row("end_to_end", 4000, 10)], undefined);
    expect(out[0]!.slo_status).toBe("healthy");
    expect(out[0]!.slo_threshold_ms).toBe(6000);
    expect(out[0]!.slo_metric).toBe("p95");
  });

  it("flags end_to_end p95=7000 as breach with threshold 6000 p95", () => {
    const out = augmentWithSloStatus([row("end_to_end", 7000, 10)], undefined);
    expect(out[0]!.slo_status).toBe("breach");
    expect(out[0]!.slo_threshold_ms).toBe(6000);
    expect(out[0]!.slo_metric).toBe("p95");
  });

  it("flags count=0 as no_data but still emits threshold + metric", () => {
    const out = augmentWithSloStatus([row("end_to_end", null, 0)], undefined);
    expect(out[0]!.slo_status).toBe("no_data");
    expect(out[0]!.slo_threshold_ms).toBe(6000);
    expect(out[0]!.slo_metric).toBe("p95");
  });

  it("honors per-agent override in BOTH status AND emitted threshold (dashboard subtitle stays consistent)", () => {
    const out = augmentWithSloStatus(
      [row("end_to_end", 5000, 10)],
      [{ segment: "end_to_end", metric: "p95", thresholdMs: 4000 }],
    );
    expect(out[0]!.slo_status).toBe("breach");
    // The server emits the MERGED threshold — NOT the default 6000 — so the
    // dashboard subtitle matches the cell color under per-agent overrides.
    expect(out[0]!.slo_threshold_ms).toBe(4000);
    expect(out[0]!.slo_metric).toBe("p95");
  });

  it("uses p50 metric for first_token with threshold 2000 p50", () => {
    const healthy = augmentWithSloStatus(
      [row("first_token", 9999, 10, 1500)],
      undefined,
    );
    const breach = augmentWithSloStatus(
      [row("first_token", 9999, 10, 2500)],
      undefined,
    );
    expect(healthy[0]!.slo_status).toBe("healthy");
    expect(healthy[0]!.slo_threshold_ms).toBe(2000);
    expect(healthy[0]!.slo_metric).toBe("p50");
    expect(breach[0]!.slo_status).toBe("breach");
    expect(breach[0]!.slo_threshold_ms).toBe(2000);
    expect(breach[0]!.slo_metric).toBe("p50");
  });

  it("returns slo_status + slo_threshold_ms + slo_metric on all four canonical segments", () => {
    const out = augmentWithSloStatus(
      [
        row("end_to_end", 4000, 10),
        row("first_token", 0, 10, 1000),
        row("context_assemble", 100, 10),
        row("tool_call", 500, 10),
      ],
      undefined,
    );
    expect(out).toHaveLength(4);
    for (const r of out) {
      expect(typeof r.slo_status).toBe("string");
      expect(typeof r.slo_threshold_ms).toBe("number");
      expect(typeof r.slo_metric).toBe("string");
    }
  });

  it("returns null threshold + metric for segments with no configured SLO", () => {
    // Defensive runtime coverage for the null branch. The type union enforces
    // canonical segments at compile time; the cast simulates a future segment
    // landing in the IPC response without an entry in DEFAULT_SLOS.
    const unknown = row(
      "future_segment" as unknown as PercentileRow["segment"],
      999,
      10,
    );
    const out = augmentWithSloStatus([unknown], undefined);
    expect(out[0]!.slo_threshold_ms).toBe(null);
    expect(out[0]!.slo_metric).toBe(null);
    // slo_status is intentionally left unset — the dashboard's sloCellClass
    // helper falls back to latency-cell-no-data when it's undefined.
    expect(out[0]!.slo_status).toBeUndefined();
  });
});
