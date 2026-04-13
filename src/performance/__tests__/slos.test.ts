import { describe, it, expect } from "vitest";

import {
  DEFAULT_SLOS,
  evaluateSloStatus,
  mergeSloOverrides,
  type SloEntry,
} from "../slos.js";
import { CANONICAL_SEGMENTS } from "../types.js";

describe("DEFAULT_SLOS", () => {
  it("contains exactly four entries (one per canonical segment) matching CONTEXT decisions verbatim", () => {
    expect(DEFAULT_SLOS).toHaveLength(4);

    const bySegment = new Map<string, SloEntry>(
      DEFAULT_SLOS.map((e) => [e.segment, e]),
    );

    expect(bySegment.get("end_to_end")).toEqual({
      segment: "end_to_end",
      metric: "p95",
      thresholdMs: 6000,
    });
    expect(bySegment.get("first_token")).toEqual({
      segment: "first_token",
      metric: "p50",
      thresholdMs: 2000,
    });
    expect(bySegment.get("context_assemble")).toEqual({
      segment: "context_assemble",
      metric: "p95",
      thresholdMs: 300,
    });
    expect(bySegment.get("tool_call")).toEqual({
      segment: "tool_call",
      metric: "p95",
      thresholdMs: 1500,
    });

    // Sanity: every canonical segment is represented at least once
    for (const seg of CANONICAL_SEGMENTS) {
      expect(bySegment.has(seg)).toBe(true);
    }
  });

  it("is fully frozen: array AND every entry", () => {
    expect(Object.isFrozen(DEFAULT_SLOS)).toBe(true);
    for (const entry of DEFAULT_SLOS) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });
});

describe("evaluateSloStatus", () => {
  it("returns no_data when row.count === 0", () => {
    const row = { p50: null, p95: null, p99: null, count: 0 };
    expect(evaluateSloStatus(row, 1000, "p95")).toBe("no_data");
  });

  it("returns no_data when the requested metric is null even with count > 0", () => {
    const row = { p50: 100, p95: null, p99: null, count: 5 };
    expect(evaluateSloStatus(row, 1000, "p95")).toBe("no_data");
  });

  it("returns healthy when row[metric] !== null AND row[metric] <= thresholdMs", () => {
    const row = { p50: 800, p95: 1500, p99: 2500, count: 50 };
    expect(evaluateSloStatus(row, 1500, "p95")).toBe("healthy");
    expect(evaluateSloStatus(row, 2000, "p95")).toBe("healthy");
    expect(evaluateSloStatus(row, 800, "p50")).toBe("healthy");
  });

  it("returns breach when row[metric] !== null AND row[metric] > thresholdMs", () => {
    const row = { p50: 1200, p95: 5800, p99: 9000, count: 50 };
    expect(evaluateSloStatus(row, 5000, "p95")).toBe("breach");
    expect(evaluateSloStatus(row, 1000, "p50")).toBe("breach");
    expect(evaluateSloStatus(row, 1199, "p50")).toBe("breach");
  });
});

describe("mergeSloOverrides", () => {
  it("replaces threshold for an entry matching segment + metric", () => {
    const merged = mergeSloOverrides(DEFAULT_SLOS, [
      { segment: "end_to_end", metric: "p95", thresholdMs: 4000 },
    ]);
    expect(merged).toHaveLength(4);

    const bySeg = new Map<string, SloEntry>(merged.map((e) => [e.segment, e]));
    expect(bySeg.get("end_to_end")).toEqual({
      segment: "end_to_end",
      metric: "p95",
      thresholdMs: 4000,
    });
    // Others unchanged
    expect(bySeg.get("first_token")?.thresholdMs).toBe(2000);
    expect(bySeg.get("context_assemble")?.thresholdMs).toBe(300);
    expect(bySeg.get("tool_call")?.thresholdMs).toBe(1500);

    expect(Object.isFrozen(merged)).toBe(true);
  });

  it("appends rather than replaces when an override targets the same segment with a different metric", () => {
    // first_token default is p50/2000. Adding a p95 override on first_token
    // should APPEND a new entry, not replace the existing p50.
    const merged = mergeSloOverrides(DEFAULT_SLOS, [
      { segment: "first_token", metric: "p95", thresholdMs: 4500 },
    ]);
    expect(merged).toHaveLength(5);

    const firstTokenEntries = merged.filter((e) => e.segment === "first_token");
    expect(firstTokenEntries).toHaveLength(2);
    expect(firstTokenEntries.find((e) => e.metric === "p50")?.thresholdMs).toBe(
      2000,
    );
    expect(firstTokenEntries.find((e) => e.metric === "p95")?.thresholdMs).toBe(
      4500,
    );
    expect(Object.isFrozen(merged)).toBe(true);
  });
});
