import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  assembleContext,
  DEFAULT_BUDGETS,
  estimateTokens,
  exceedsCeiling,
  type ContextBudgets,
  type ContextSources,
} from "../context-assembler.js";

/**
 * Phase 52 Plan 02: `assembleContext` now returns `AssembledContext`, an
 * object with `stablePrefix`, `mutableSuffix`, and `hotStableToken`. The
 * existing pre-52 tests were written against the single-string return and
 * have been surgically updated to assert on the joined stable+mutable
 * string so intent is preserved.
 */
function joinAssembled(result: unknown): string {
  const a = result as { stablePrefix: string; mutableSuffix: string };
  if (a.stablePrefix && a.mutableSuffix) {
    return `${a.stablePrefix}\n\n${a.mutableSuffix}`;
  }
  return a.stablePrefix || a.mutableSuffix;
}

function makeSources(overrides: Partial<ContextSources> = {}): ContextSources {
  return {
    identity: "",
    hotMemories: "",
    toolDefinitions: "",
    graphContext: "",
    discordBindings: "",
    contextSummary: "",
    ...overrides,
  };
}

describe("estimateTokens", () => {
  it("returns Math.ceil(text.length / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("ab")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});

describe("exceedsCeiling", () => {
  it("returns true when assembled string exceeds 8000 tokens (32000 chars) by default", () => {
    const underCeiling = "x".repeat(32000);
    expect(exceedsCeiling(underCeiling)).toBe(false);

    const overCeiling = "x".repeat(32001);
    expect(exceedsCeiling(overCeiling)).toBe(true);
  });

  it("accepts custom ceiling", () => {
    const text = "x".repeat(100); // 25 tokens
    expect(exceedsCeiling(text, 24)).toBe(true);
    expect(exceedsCeiling(text, 25)).toBe(false);
    expect(exceedsCeiling(text, 26)).toBe(false);
  });
});

describe("DEFAULT_BUDGETS", () => {
  it("has expected values and is frozen", () => {
    expect(DEFAULT_BUDGETS).toEqual({
      identity: 1000,
      hotMemories: 3000,
      toolDefinitions: 2000,
      graphContext: 2000,
    });
    expect(Object.isFrozen(DEFAULT_BUDGETS)).toBe(true);
  });
});

describe("assembleContext", () => {
  it("with all sources populated returns sections in order", () => {
    const sources = makeSources({
      identity: "I am an agent",
      hotMemories: "- memory 1\n- memory 2",
      toolDefinitions: "tool_a: does stuff",
      graphContext: "graph node info",
      discordBindings: "## Discord\nbound to #general",
      contextSummary: "## Context Summary\nprevious session info",
    });

    const result = joinAssembled(assembleContext(sources));

    const identityIdx = result.indexOf("I am an agent");
    const memoriesIdx = result.indexOf("## Key Memories");
    const toolsIdx = result.indexOf("## Available Tools");
    const graphIdx = result.indexOf("## Related Context");
    const discordIdx = result.indexOf("## Discord");
    const summaryIdx = result.indexOf("## Context Summary");

    expect(identityIdx).toBeGreaterThanOrEqual(0);
    expect(memoriesIdx).toBeGreaterThan(identityIdx);
    expect(toolsIdx).toBeGreaterThan(memoriesIdx);
    expect(graphIdx).toBeGreaterThan(toolsIdx);
    expect(discordIdx).toBeGreaterThan(graphIdx);
    expect(summaryIdx).toBeGreaterThan(discordIdx);
  });

  it("truncates identity exceeding 1000-token budget (4000+ chars)", () => {
    const longIdentity = "a".repeat(5000);
    const sources = makeSources({ identity: longIdentity });

    const result = joinAssembled(assembleContext(sources));

    // Identity budget is 1000 tokens = 4000 chars max
    // Truncated text should be <= 4000 chars + "..." suffix
    expect(result.length).toBeLessThanOrEqual(4003);
    expect(result).toContain("...");
  });

  it("truncates hotMemories at line boundaries (drops whole bullets)", () => {
    // Each bullet is ~90 chars, 500 bullets = ~45000 chars = ~11250 tokens
    // Budget is 3000 tokens = 12000 chars, so truncation will occur
    const bullets = Array.from(
      { length: 500 },
      (_, i) => `- Memory entry number ${i} with some extended detail and extra padding text here`,
    ).join("\n");

    const sources = makeSources({ hotMemories: bullets });
    const result = joinAssembled(assembleContext(sources));

    // Should contain the header
    expect(result).toContain("## Key Memories");

    // Extract the memories section content (after header, before end)
    const memStart = result.indexOf("## Key Memories\n\n") + "## Key Memories\n\n".length;
    const memContent = result.slice(memStart);

    // Every line should be complete (start with "- ")
    const lines = memContent.split("\n").filter((l) => l.length > 0);
    for (const line of lines) {
      expect(line).toMatch(/^- /);
    }

    // Should be shorter than the original
    expect(memContent.length).toBeLessThan(bullets.length);
  });

  it("omits identity section when identity is empty", () => {
    const sources = makeSources({
      hotMemories: "- some memory",
    });

    const result = joinAssembled(assembleContext(sources));

    // Should start with the memories section, no empty identity
    expect(result).toContain("## Key Memories");
    expect(result.indexOf("## Key Memories")).toBe(0);
  });

  it("omits graphContext section when empty", () => {
    const sources = makeSources({
      identity: "I am agent",
      graphContext: "",
    });

    const result = joinAssembled(assembleContext(sources));
    expect(result).not.toContain("## Related Context");
  });

  it("returns empty string when all sources are empty", () => {
    const sources = makeSources();
    const result = joinAssembled(assembleContext(sources));
    expect(result).toBe("");
  });

  it("uses custom budgets when provided", () => {
    const tinyBudgets: ContextBudgets = {
      identity: 5,
      hotMemories: 5,
      toolDefinitions: 5,
      graphContext: 5,
    };

    const sources = makeSources({
      identity: "a".repeat(100),
      hotMemories: "- short\n- also short",
    });

    const result = joinAssembled(assembleContext(sources, tinyBudgets));

    // Identity should be truncated to ~20 chars (5 tokens * 4) + "..."
    const identityEnd = result.indexOf("\n\n## Key Memories");
    const identityPart =
      identityEnd >= 0 ? result.slice(0, identityEnd) : result;
    expect(identityPart.length).toBeLessThanOrEqual(23); // 20 + "..."
  });

  it("discord bindings are pass-through (no truncation)", () => {
    const longBindings = "## Discord\n" + "x".repeat(50000);
    const sources = makeSources({ discordBindings: longBindings });

    // Phase 52 Plan 02: discord bindings live in mutableSuffix now, not the
    // top-level string. Assert the mutable half equals the input.
    const result = assembleContext(sources) as unknown as {
      stablePrefix: string;
      mutableSuffix: string;
    };
    expect(result.mutableSuffix).toBe(longBindings);
    expect(result.stablePrefix).toBe("");
  });

  it("context summary is pass-through (no truncation)", () => {
    const longSummary = "## Summary\n" + "y".repeat(50000);
    const sources = makeSources({ contextSummary: longSummary });

    // Phase 52 Plan 02: context summary lives in mutableSuffix.
    const result = assembleContext(sources) as unknown as {
      stablePrefix: string;
      mutableSuffix: string;
    };
    expect(result.mutableSuffix).toBe(longSummary);
    expect(result.stablePrefix).toBe("");
  });

  it("section headers are NOT counted against the source budget", () => {
    // Budget of 10 tokens = 40 chars for hotMemories content
    const customBudgets: ContextBudgets = {
      identity: 1000,
      hotMemories: 10,
      toolDefinitions: 2000,
      graphContext: 2000,
    };

    const shortMemory = "- a short bullet"; // 16 chars = 4 tokens, well within budget
    const sources = makeSources({ hotMemories: shortMemory });

    const result = joinAssembled(assembleContext(sources, customBudgets));

    // The full memory content should be preserved (within budget)
    expect(result).toContain(shortMemory);
    // Header should be present
    expect(result).toContain("## Key Memories");
  });

  it("total assembled context respects ceiling check", () => {
    const hugeIdentity = "x".repeat(40000);
    const sources = makeSources({ identity: hugeIdentity });

    const result = joinAssembled(assembleContext(sources));
    // Even though identity is huge, it gets truncated to budget
    // So the result should not exceed ceiling
    expect(exceedsCeiling(result)).toBe(false);
  });
});

// ── APPENDED BY Phase 50-00 Wave 0 scaffolding ───────────────────────────────
// New "context_assemble tracing" describe block. Existing tests above remain
// untouched. Wave 2 Task 2 will add the `assembleContextTraced` export that
// makes these tests green.

import { vi } from "vitest";
import { assembleContextTraced } from "../context-assembler.js";

describe("context_assemble tracing", () => {
  function makeTurnStub() {
    const spanEnd = vi.fn();
    const startSpan = vi.fn(() => ({ end: spanEnd }));
    return { turn: { startSpan, end: vi.fn() }, spanEnd, startSpan };
  }

  it("tracing: assembleContextTraced opens a context_assemble span before assembling and ends it after (finally)", () => {
    const { turn, startSpan, spanEnd } = makeTurnStub();
    const sources = makeSources({ identity: "I am an agent" });

    const result = (assembleContextTraced as any)(sources, DEFAULT_BUDGETS, undefined, turn);

    expect(startSpan).toHaveBeenCalledWith("context_assemble");
    expect(spanEnd).toHaveBeenCalledTimes(1);
    // Result should still match the untraced assembleContext output (same shape).
    expect(result).toEqual(assembleContext(sources, DEFAULT_BUDGETS));
  });

  it("tracing: ends the context_assemble span even when assembleContext throws", () => {
    const { turn, startSpan, spanEnd } = makeTurnStub();

    // Build a proxy that triggers inside assembleContextTraced. Since we can't
    // easily force the inner assembleContext to throw without mocking the
    // module graph, we use a deliberately malformed sources object cast to the
    // expected type — assembleContextTraced should still end the span via its
    // finally block.
    const thrower = {
      get identity() {
        throw new Error("boom");
      },
    } as unknown as ContextSources;

    expect(() => (assembleContextTraced as any)(thrower, DEFAULT_BUDGETS, undefined, turn)).toThrow();

    expect(startSpan).toHaveBeenCalledWith("context_assemble");
    expect(spanEnd).toHaveBeenCalledTimes(1);
  });

  it("tracing: no-op when turn is undefined (does not call startSpan)", () => {
    const sources = makeSources({ identity: "I am an agent" });
    const result = (assembleContextTraced as any)(sources, DEFAULT_BUDGETS, undefined, undefined);
    // Result equals the untraced output.
    expect(result).toEqual(assembleContext(sources, DEFAULT_BUDGETS));
  });
});

// ── Phase 52 Plan 02 — two-block assembly + hot-tier stable_token ─────────────

import { computeHotStableToken, computePrefixHash } from "../context-assembler.js";

describe("two-block assembly (Phase 52)", () => {
  it("returns { stablePrefix, mutableSuffix, hotStableToken } — not a single string", () => {
    const sources = makeSources({
      identity: "I am an agent",
      hotMemories: "- memory 1\n- memory 2",
      toolDefinitions: "tool_a: does stuff",
      discordBindings: "## Discord\nbound to #general",
      contextSummary: "## Context Summary\nprevious session info",
    });

    const result = assembleContext(sources);

    expect(typeof result).toBe("object");
    expect(typeof (result as any).stablePrefix).toBe("string");
    expect(typeof (result as any).mutableSuffix).toBe("string");
    expect(typeof (result as any).hotStableToken).toBe("string");
    expect((result as any).hotStableToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stablePrefix contains identity, hotMemories, toolDefinitions — the cacheable block", () => {
    const sources = makeSources({
      identity: "I am an agent",
      hotMemories: "- memory alpha",
      toolDefinitions: "tool_a: does stuff",
      discordBindings: "## Discord\nbound to #general",
    });

    const result = assembleContext(sources) as unknown as {
      stablePrefix: string;
      mutableSuffix: string;
    };

    expect(result.stablePrefix).toContain("I am an agent");
    expect(result.stablePrefix).toContain("memory alpha");
    expect(result.stablePrefix).toContain("tool_a");
  });

  it("mutableSuffix contains discordBindings and contextSummary — the per-turn block", () => {
    const sources = makeSources({
      identity: "I am an agent",
      discordBindings: "## Discord\nbound to #channel",
      contextSummary: "## Context Summary\nprior session",
    });

    const result = assembleContext(sources) as unknown as {
      stablePrefix: string;
      mutableSuffix: string;
    };

    expect(result.mutableSuffix).toContain("## Discord");
    expect(result.mutableSuffix).toContain("## Context Summary");
    expect(result.stablePrefix).not.toContain("## Discord");
    expect(result.stablePrefix).not.toContain("## Context Summary");
  });

  it("when priorHotStableToken matches current hot-tier, hot-tier stays in stablePrefix", () => {
    const sources = makeSources({
      identity: "identity",
      hotMemories: "- m1\n- m2",
      discordBindings: "## Discord\nb",
    });

    // First call gets the current token, then pass it as priorHotStableToken.
    const first = assembleContext(sources) as unknown as {
      hotStableToken: string;
    };
    const result = assembleContext(sources, DEFAULT_BUDGETS, {
      priorHotStableToken: first.hotStableToken,
    }) as unknown as { stablePrefix: string; mutableSuffix: string };

    expect(result.stablePrefix).toContain("## Key Memories");
    expect(result.mutableSuffix).not.toContain("## Key Memories");
  });

  it("when priorHotStableToken differs, hot-tier is excluded from stablePrefix and placed in mutableSuffix", () => {
    const sources = makeSources({
      identity: "identity",
      hotMemories: "- m1\n- m2",
      discordBindings: "## Discord\nb",
    });

    const result = assembleContext(sources, DEFAULT_BUDGETS, {
      priorHotStableToken: "0".repeat(64), // deliberately non-matching
    }) as unknown as {
      stablePrefix: string;
      mutableSuffix: string;
      hotStableToken: string;
    };

    expect(result.stablePrefix).not.toContain("## Key Memories");
    expect(result.mutableSuffix).toContain("## Key Memories");
    expect(result.hotStableToken).not.toBe("0".repeat(64));
  });

  it("when hotMemories is empty, hotStableToken is sha256 of '' and hot-tier is absent from both blocks", () => {
    const sources = makeSources({
      identity: "identity",
      hotMemories: "",
      discordBindings: "## Discord\nb",
    });

    const result = assembleContext(sources) as unknown as {
      stablePrefix: string;
      mutableSuffix: string;
      hotStableToken: string;
    };

    const emptyHash = createHash("sha256").update("", "utf8").digest("hex");
    expect(result.hotStableToken).toBe(emptyHash);
    expect(result.stablePrefix).not.toContain("## Key Memories");
    expect(result.mutableSuffix).not.toContain("## Key Memories");
  });

  it("assembleContextTraced returns AssembledContext unchanged (pass-through type-preserving wrapper)", () => {
    const spanEnd = vi.fn();
    const startSpan = vi.fn(() => ({ end: spanEnd }));
    const turn = { startSpan, end: vi.fn() };
    const sources = makeSources({
      identity: "identity",
      hotMemories: "- m1",
    });

    const result = (assembleContextTraced as any)(
      sources,
      DEFAULT_BUDGETS,
      undefined,
      turn,
    );

    expect(startSpan).toHaveBeenCalledWith("context_assemble");
    expect(spanEnd).toHaveBeenCalledTimes(1);
    expect(typeof result).toBe("object");
    expect(typeof result.stablePrefix).toBe("string");
    expect(typeof result.mutableSuffix).toBe("string");
    expect(typeof result.hotStableToken).toBe("string");
  });

  it("AssembledContext is frozen (immutability contract)", () => {
    const sources = makeSources({ identity: "x" });
    const result = assembleContext(sources);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe("computeHotStableToken / computePrefixHash (Phase 52)", () => {
  it("computeHotStableToken returns sha256 hex over the input string", () => {
    const input = "- mem1\n- mem2";
    const expected = createHash("sha256").update(input, "utf8").digest("hex");
    expect(computeHotStableToken(input)).toBe(expected);
    expect(computeHotStableToken(input)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("computeHotStableToken returns sha256('') for empty input", () => {
    const expected = createHash("sha256").update("", "utf8").digest("hex");
    expect(computeHotStableToken("")).toBe(expected);
  });

  it("computePrefixHash returns sha256 hex of stablePrefix", () => {
    const prefix = "## Identity\nCore traits: helpful";
    const expected = createHash("sha256").update(prefix, "utf8").digest("hex");
    expect(computePrefixHash(prefix)).toBe(expected);
    expect(computePrefixHash(prefix)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("computePrefixHash differs between different prefixes (eviction detection)", () => {
    const a = computePrefixHash("prefix A");
    const b = computePrefixHash("prefix B");
    expect(a).not.toBe(b);
  });
});
