/**
 * Phase 83 Plan 01 Task 1 — RED tests for effort-mapping + effortSchema v2.2 extension.
 *
 * Regression-pins:
 *   1. mapEffortToTokens covers all 7 v2.2 levels with exact token budgets
 *   2. effortSchema accepts the extended level set (xhigh | auto | off)
 *   3. v2.1 migrated configs ("effort: low") still parse unchanged (backward compat)
 */

import { describe, it, expect } from "vitest";
import { mapEffortToTokens } from "../effort-mapping.js";
import { effortSchema } from "../../config/schema.js";

describe("mapEffortToTokens", () => {
  it("'off' returns 0 (explicit disable — literal zero, not null)", () => {
    expect(mapEffortToTokens("off")).toBe(0);
  });

  it("'auto' returns null (SDK / model default)", () => {
    expect(mapEffortToTokens("auto")).toBe(null);
  });

  it("'low' returns 1024", () => {
    expect(mapEffortToTokens("low")).toBe(1024);
  });

  it("'medium' returns 4096", () => {
    expect(mapEffortToTokens("medium")).toBe(4096);
  });

  it("'high' returns 16384", () => {
    expect(mapEffortToTokens("high")).toBe(16384);
  });

  it("'xhigh' returns 24576", () => {
    expect(mapEffortToTokens("xhigh")).toBe(24576);
  });

  it("'max' returns 32768", () => {
    expect(mapEffortToTokens("max")).toBe(32768);
  });

  // Semantics check: off is a number (0), auto is null. These MUST NOT collapse
  // — Plan 02 persistence depends on the distinction (null means "don't
  // override, use model default"; 0 means "explicitly off").
  it("'off' and 'auto' are distinguishable — 0 !== null", () => {
    const offTokens = mapEffortToTokens("off");
    const autoTokens = mapEffortToTokens("auto");
    expect(offTokens).not.toBe(autoTokens);
    expect(typeof offTokens).toBe("number");
    expect(autoTokens).toBe(null);
  });
});

describe("effortSchema v2.2 extension", () => {
  it("parses 'xhigh' (new in v2.2)", () => {
    expect(effortSchema.parse("xhigh")).toBe("xhigh");
  });

  it("parses 'auto' (new in v2.2)", () => {
    expect(effortSchema.parse("auto")).toBe("auto");
  });

  it("parses 'off' (new in v2.2)", () => {
    expect(effortSchema.parse("off")).toBe("off");
  });

  it("still parses 'low' (backward-compat with v2.1 migrated configs)", () => {
    expect(effortSchema.parse("low")).toBe("low");
  });

  it("still parses 'medium' / 'high' / 'max' (backward-compat)", () => {
    expect(effortSchema.parse("medium")).toBe("medium");
    expect(effortSchema.parse("high")).toBe("high");
    expect(effortSchema.parse("max")).toBe("max");
  });

  it("rejects 'invalid' (unknown level)", () => {
    expect(() => effortSchema.parse("invalid")).toThrow();
  });

  it("v2.1 migrated-fleet snapshot — all 15 agents with 'effort: low' parse without error", () => {
    // Simulates the fleet shape post-v2.1 migration — every agent had
    // `effort: low` baked in by effortSchema.default("low"). Schema extension
    // is additive and MUST NOT invalidate these values.
    const migratedLevels = new Array(15).fill("low");
    for (const level of migratedLevels) {
      expect(() => effortSchema.parse(level)).not.toThrow();
      expect(effortSchema.parse(level)).toBe("low");
    }
  });
});
