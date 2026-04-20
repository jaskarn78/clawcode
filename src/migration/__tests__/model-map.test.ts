/**
 * Phase 78 Plan 02 Task 1 — model-map.ts unit tests.
 *
 * Pins 17 behaviors across DEFAULT_MODEL_MAP, parseModelMapFlag,
 * mergeModelMap, mapModel, and UNMAPPABLE_MODEL_WARNING_TEMPLATE.
 *
 * The literal-warning tests are load-bearing — Phase 78 success criterion
 * #3 pins the exact byte-level warning copy (em-dash U+2014, angle brackets,
 * double-quotes). Any drift MUST fail a test here before it fails phase
 * verification.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODEL_MAP,
  UNMAPPABLE_MODEL_WARNING_TEMPLATE,
  parseModelMapFlag,
  mergeModelMap,
  mapModel,
} from "../model-map.js";

describe("DEFAULT_MODEL_MAP", () => {
  it("contains exactly the 7 known OpenClaw model ids", () => {
    const keys = Object.keys(DEFAULT_MODEL_MAP).sort();
    expect(keys).toEqual(
      [
        "anthropic-api/claude-haiku-4-5",
        "anthropic-api/claude-opus-4-6",
        "anthropic-api/claude-opus-4-7",
        "anthropic-api/claude-sonnet-4-5",
        "anthropic-api/claude-sonnet-4-6",
        "clawcode/admin-clawdy",
        "minimax/abab6.5",
      ].sort(),
    );
  });

  it("is frozen (Object.isFrozen returns true)", () => {
    expect(Object.isFrozen(DEFAULT_MODEL_MAP)).toBe(true);
  });
});

describe("mapModel", () => {
  it("maps anthropic-api/claude-sonnet-4-6 -> sonnet", () => {
    expect(mapModel("anthropic-api/claude-sonnet-4-6", DEFAULT_MODEL_MAP))
      .toEqual({ mapped: "sonnet", warning: undefined });
  });

  it("folds older opus-4-6 up to opus", () => {
    expect(mapModel("anthropic-api/claude-opus-4-6", DEFAULT_MODEL_MAP))
      .toEqual({ mapped: "opus", warning: undefined });
  });

  it("passes clawcode/admin-clawdy through unchanged", () => {
    expect(mapModel("clawcode/admin-clawdy", DEFAULT_MODEL_MAP))
      .toEqual({ mapped: "clawcode/admin-clawdy", warning: undefined });
  });

  it("returns literal unmappable-model warning for unknown ids", () => {
    const result = mapModel("unknown/made-up-id", DEFAULT_MODEL_MAP);
    expect(result.mapped).toBeUndefined();
    // EXACT byte match — em-dash (U+2014), angle brackets, double-quotes.
    expect(result.warning).toBe(
      '\u26a0 unmappable model: unknown/made-up-id \u2014 pass --model-map "unknown/made-up-id=<clawcode-id>" or edit plan.json',
    );
  });
});

describe("parseModelMapFlag", () => {
  it("parses a single mapping", () => {
    expect(parseModelMapFlag(["oc-id=cc-id"])).toEqual({ "oc-id": "cc-id" });
  });

  it("aggregates repeatable flags", () => {
    expect(parseModelMapFlag(["a=1", "b=2"])).toEqual({ a: "1", b: "2" });
  });

  it("throws on missing '=' separator", () => {
    expect(() => parseModelMapFlag(["oc-id"])).toThrow(
      /invalid --model-map syntax.*oc-id/,
    );
  });

  it("throws on empty LHS", () => {
    expect(() => parseModelMapFlag(["=cc-id"])).toThrow(
      /invalid --model-map syntax/,
    );
  });

  it("throws on empty RHS", () => {
    expect(() => parseModelMapFlag(["oc-id="])).toThrow(
      /invalid --model-map syntax/,
    );
  });

  it("preserves slashes in keys and values (real model-id shape)", () => {
    expect(
      parseModelMapFlag([
        "oc/sonnet-foo=sonnet",
        "oc/haiku-bar=haiku",
      ]),
    ).toEqual({ "oc/sonnet-foo": "sonnet", "oc/haiku-bar": "haiku" });
  });

  it("splits only on the FIRST '=' (values may contain '=')", () => {
    expect(parseModelMapFlag(["a=b=c"])).toEqual({ a: "b=c" });
  });

  it("returns {} for empty input", () => {
    expect(parseModelMapFlag([])).toEqual({});
  });
});

describe("mergeModelMap", () => {
  it("user overrides win over defaults", () => {
    const merged = mergeModelMap(DEFAULT_MODEL_MAP, {
      "anthropic-api/claude-sonnet-4-6": "custom-override",
    });
    expect(merged["anthropic-api/claude-sonnet-4-6"]).toBe("custom-override");
    // Other defaults intact
    expect(merged["anthropic-api/claude-opus-4-7"]).toBe("opus");
    expect(merged["anthropic-api/claude-haiku-4-5"]).toBe("haiku");
  });

  it("adds new keys while preserving defaults", () => {
    const merged = mergeModelMap(DEFAULT_MODEL_MAP, { "new-id": "sonnet" });
    expect(merged["new-id"]).toBe("sonnet");
    expect(merged["anthropic-api/claude-sonnet-4-6"]).toBe("sonnet");
  });

  it("does not mutate DEFAULT_MODEL_MAP (pure)", () => {
    mergeModelMap(DEFAULT_MODEL_MAP, {
      "anthropic-api/claude-sonnet-4-6": "custom",
    });
    // Original still frozen and unchanged
    expect(Object.isFrozen(DEFAULT_MODEL_MAP)).toBe(true);
    expect(DEFAULT_MODEL_MAP["anthropic-api/claude-sonnet-4-6"]).toBe("sonnet");
  });
});

describe("UNMAPPABLE_MODEL_WARNING_TEMPLATE", () => {
  it("contains all three load-bearing phrases (triple pin)", () => {
    expect(UNMAPPABLE_MODEL_WARNING_TEMPLATE).toContain("\u26a0 unmappable model:");
    expect(UNMAPPABLE_MODEL_WARNING_TEMPLATE).toContain("pass --model-map");
    expect(UNMAPPABLE_MODEL_WARNING_TEMPLATE).toContain("or edit plan.json");
  });
});
