/**
 * Phase 82 Plan 01 Task 1 — pilot-selector.ts unit tests. TDD RED phase.
 *
 * Pins 4 load-bearing behaviors per 82-01-PLAN.md:
 *   1. Canonical 15-agent fixture → personal or local-clawdy wins (lowest
 *      memory count, dedicated workspace, not-finmentum)
 *   2. Finmentum penalty — a finmentum agent with 0 memory chunks still
 *      loses to a non-finmentum agent with any non-negative score
 *   3. Tie-break — when two non-finmentum agents have equal scores, the
 *      alphabetically-earlier sourceId wins (localeCompare)
 *   4. formatPilotLine byte-exact — `✨ Recommended pilot: <id> (<reason>)`
 *
 * Also covers:
 *   - pickPilot returns null on empty input
 *   - PILOT_RECOMMEND_PREFIX equals the literal "✨ Recommended pilot: "
 *   - scorePilot formula: memoryChunkCount*0.6 + mcpCount*0.2 + (isFinmentumFamily?100:0)
 */
import { describe, it, expect } from "vitest";
import {
  scorePilot,
  pickPilot,
  formatPilotLine,
  PILOT_RECOMMEND_PREFIX,
} from "../pilot-selector.js";
import type { AgentPlan } from "../diff-builder.js";

function makeAgent(overrides: Partial<AgentPlan>): AgentPlan {
  return {
    sourceId: "example",
    sourceName: "Example",
    sourceWorkspace: "/home/u/.openclaw/workspace-example",
    sourceAgentDir: "/home/u/.openclaw/agents/example/agent",
    sourceModel: "anthropic-api/claude-sonnet-4-6",
    memoryChunkCount: 100,
    memoryStatus: "present",
    discordChannelId: undefined,
    isFinmentumFamily: false,
    targetBasePath: "/home/u/.clawcode/agents/example",
    targetMemoryPath: "/home/u/.clawcode/agents/example",
    targetAgentName: "example",
    ...overrides,
  };
}

describe("scorePilot (formula)", () => {
  it("computes memoryChunkCount*0.6 + mcpCount*0.2 for non-finmentum agent", () => {
    const agent = makeAgent({
      sourceId: "personal",
      memoryChunkCount: 47,
      isFinmentumFamily: false,
    });
    // 47*0.6 + 3*0.2 = 28.2 + 0.6 = 28.8
    expect(scorePilot({ agent, mcpCount: 3 })).toBeCloseTo(28.8, 5);
  });

  it("adds 100 penalty for finmentum-family agents", () => {
    const agent = makeAgent({
      sourceId: "fin-acquisition",
      memoryChunkCount: 0,
      isFinmentumFamily: true,
    });
    // 0*0.6 + 0*0.2 + 100 = 100
    expect(scorePilot({ agent, mcpCount: 0 })).toBeCloseTo(100, 5);
  });

  it("non-finmentum agent with heavy memory still beats finmentum with 0 memory", () => {
    const finmentum = makeAgent({
      sourceId: "fin-acquisition",
      memoryChunkCount: 0,
      isFinmentumFamily: true,
    });
    const heavyNonFin = makeAgent({
      sourceId: "general",
      memoryChunkCount: 165,
      isFinmentumFamily: false,
    });
    // heavyNonFin = 165*0.6 + 0*0.2 = 99 < 100 (finmentum)
    expect(scorePilot({ agent: heavyNonFin, mcpCount: 0 })).toBeLessThan(
      scorePilot({ agent: finmentum, mcpCount: 0 }),
    );
  });
});

describe("pickPilot — canonical 15-agent inventory", () => {
  // Approximate on-box fleet: personal and local-clawdy are lightest.
  // Finmentum family gets +100 penalty so cannot win.
  const fleet: readonly AgentPlan[] = Object.freeze([
    makeAgent({ sourceId: "personal", memoryChunkCount: 47 }),
    makeAgent({ sourceId: "local-clawdy", memoryChunkCount: 50 }),
    makeAgent({ sourceId: "general", memoryChunkCount: 165 }),
    makeAgent({ sourceId: "work", memoryChunkCount: 180 }),
    makeAgent({ sourceId: "projects", memoryChunkCount: 140 }),
    makeAgent({ sourceId: "research", memoryChunkCount: 220 }),
    makeAgent({ sourceId: "card-planner", memoryChunkCount: 75 }),
    makeAgent({ sourceId: "card-generator", memoryChunkCount: 85 }),
    makeAgent({ sourceId: "finmentum-content-creator", memoryChunkCount: 300, isFinmentumFamily: true }),
    makeAgent({ sourceId: "fin-acquisition", memoryChunkCount: 100, isFinmentumFamily: true }),
    makeAgent({ sourceId: "fin-research", memoryChunkCount: 200, isFinmentumFamily: true }),
    makeAgent({ sourceId: "fin-playground", memoryChunkCount: 120, isFinmentumFamily: true }),
    makeAgent({ sourceId: "fin-tax", memoryChunkCount: 150, isFinmentumFamily: true }),
    makeAgent({ sourceId: "admin-clawdy", memoryChunkCount: 95 }),
    makeAgent({ sourceId: "debug-clawdy", memoryChunkCount: 60 }),
  ]);

  it("winner is personal or local-clawdy (lowest memory, not-finmentum)", () => {
    const result = pickPilot(fleet, new Map());
    expect(result).not.toBeNull();
    expect(["personal", "local-clawdy"]).toContain(result!.winner.sourceId);
  });

  it("reason string includes 'lowest memory count' and chunk count literal", () => {
    const result = pickPilot(fleet, new Map());
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("lowest memory count");
    // personal has 47 — the winning chunk count must appear literally
    expect(result!.reason).toMatch(/\d+ chunks/);
  });

  it("finmentum family never wins, even if they had lower raw memory", () => {
    // Zero-out memory for every finmentum agent to stress the penalty
    const stressed = fleet.map((a) =>
      a.isFinmentumFamily ? { ...a, memoryChunkCount: 0 } : a,
    );
    const result = pickPilot(stressed, new Map());
    expect(result).not.toBeNull();
    expect(result!.winner.isFinmentumFamily).toBe(false);
  });

  it("returns null on empty input", () => {
    expect(pickPilot([], new Map())).toBeNull();
  });
});

describe("pickPilot — tie-break", () => {
  it("alphabetical sourceId wins when scores are equal", () => {
    const agents = [
      makeAgent({ sourceId: "zebra", memoryChunkCount: 10 }),
      makeAgent({ sourceId: "alpha", memoryChunkCount: 10 }),
      makeAgent({ sourceId: "mike", memoryChunkCount: 10 }),
    ];
    const result = pickPilot(agents, new Map());
    expect(result).not.toBeNull();
    expect(result!.winner.sourceId).toBe("alpha");
  });

  it("tie-break uses localeCompare (case sensitivity per locale)", () => {
    const agents = [
      makeAgent({ sourceId: "b-agent", memoryChunkCount: 5 }),
      makeAgent({ sourceId: "a-agent", memoryChunkCount: 5 }),
    ];
    const result = pickPilot(agents, new Map());
    expect(result!.winner.sourceId).toBe("a-agent");
  });
});

describe("pickPilot — mcpCount plumbing", () => {
  it("mcpCount from map affects total score", () => {
    const a = makeAgent({ sourceId: "a", memoryChunkCount: 100 });
    const b = makeAgent({ sourceId: "b", memoryChunkCount: 100 });
    // Agent a has 10 mcp servers (+2.0), agent b has 0 (+0)
    const mcpCounts = new Map<string, number>([["a", 10]]);
    const result = pickPilot([a, b], mcpCounts);
    expect(result!.winner.sourceId).toBe("b");
  });

  it("missing mcpCount defaults to 0", () => {
    const a = makeAgent({ sourceId: "a", memoryChunkCount: 100 });
    const b = makeAgent({ sourceId: "b", memoryChunkCount: 100 });
    // Neither in map → both score 60. Tie → alphabetical → a wins.
    const result = pickPilot([a, b], new Map());
    expect(result!.winner.sourceId).toBe("a");
  });
});

describe("formatPilotLine (literal byte-exact output)", () => {
  it("emits '✨ Recommended pilot: <id> (<reason>)' exactly", () => {
    const winner = makeAgent({ sourceId: "personal", memoryChunkCount: 47 });
    const line = formatPilotLine(
      winner,
      "lowest memory count (47 chunks), dedicated workspace, not-business-critical",
    );
    expect(line).toBe(
      "✨ Recommended pilot: personal (lowest memory count (47 chunks), dedicated workspace, not-business-critical)",
    );
  });

  it("PILOT_RECOMMEND_PREFIX is the literal '✨ Recommended pilot: '", () => {
    expect(PILOT_RECOMMEND_PREFIX).toBe("✨ Recommended pilot: ");
  });

  it("output always starts with PILOT_RECOMMEND_PREFIX", () => {
    const winner = makeAgent({ sourceId: "foo" });
    const line = formatPilotLine(winner, "bar");
    expect(line.startsWith(PILOT_RECOMMEND_PREFIX)).toBe(true);
  });
});
