/**
 * Phase 60 Plan 01 — PolicyEvaluator tests.
 *
 * Default policy: "if event.targetAgent is in configuredAgents, allow."
 * Phase 62 will replace this with a full DSL-aware evaluator.
 */

import { describe, it, expect } from "vitest";

import { evaluatePolicy, type PolicyResult } from "../policy-evaluator.js";
import type { TriggerEvent } from "../types.js";

const makeEvent = (overrides: Partial<TriggerEvent> = {}): TriggerEvent => ({
  sourceId: "src-1",
  idempotencyKey: "key-1",
  targetAgent: "research",
  payload: null,
  timestamp: Date.now(),
  ...overrides,
});

describe("evaluatePolicy", () => {
  it("returns allow: true when targetAgent is configured", () => {
    const agents = new Set(["research", "writer"]);
    const result = evaluatePolicy(makeEvent(), agents);
    expect(result.allow).toBe(true);
    if (result.allow) {
      expect(result.targetAgent).toBe("research");
    }
  });

  it("returns allow: false when targetAgent is NOT configured", () => {
    const agents = new Set(["writer"]);
    const result = evaluatePolicy(makeEvent(), agents);
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.reason).toBe("target agent 'research' not configured");
    }
  });

  it("returns allow: false with empty configuredAgents", () => {
    const result = evaluatePolicy(makeEvent(), new Set());
    expect(result.allow).toBe(false);
  });

  it("returns frozen objects (allow: true)", () => {
    const agents = new Set(["research"]);
    const result = evaluatePolicy(makeEvent(), agents);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns frozen objects (allow: false)", () => {
    const result = evaluatePolicy(makeEvent(), new Set());
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("matches targetAgent exactly (case-sensitive)", () => {
    const agents = new Set(["Research"]);
    const result = evaluatePolicy(makeEvent({ targetAgent: "research" }), agents);
    expect(result.allow).toBe(false);
  });

  it("works with multiple configured agents", () => {
    const agents = new Set(["alpha", "beta", "gamma"]);
    const result = evaluatePolicy(makeEvent({ targetAgent: "beta" }), agents);
    expect(result.allow).toBe(true);
    if (result.allow) {
      expect(result.targetAgent).toBe("beta");
    }
  });

  it("discriminated union: allow true has targetAgent, not reason", () => {
    const agents = new Set(["research"]);
    const result: PolicyResult = evaluatePolicy(makeEvent(), agents);
    if (result.allow) {
      expect("targetAgent" in result).toBe(true);
      expect("reason" in result).toBe(false);
    } else {
      throw new Error("Expected allow: true");
    }
  });

  it("discriminated union: allow false has reason, not targetAgent", () => {
    const result: PolicyResult = evaluatePolicy(makeEvent(), new Set());
    if (!result.allow) {
      expect("reason" in result).toBe(true);
      expect("targetAgent" in result).toBe(false);
    } else {
      throw new Error("Expected allow: false");
    }
  });
});
