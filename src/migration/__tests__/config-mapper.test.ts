/**
 * Phase 78 Plan 02 Task 2 — config-mapper.ts unit tests.
 *
 * Pins 11 behaviors for mapAgent pure function: finmentum vs dedicated path
 * resolution, MCP auto-injection (clawcode + 1password), per-agent MCP
 * lookup, unknown-MCP warnings, unmappable-model warnings, --model-map
 * override precedence, discord channel passthrough, and purity.
 */
import { describe, it, expect } from "vitest";
import type { OpenclawSourceEntry } from "../openclaw-config-reader.js";
import { mapAgent, type MapAgentWarning } from "../config-mapper.js";
import { DEFAULT_MODEL_MAP } from "../model-map.js";
import type { PlanWarning } from "../diff-builder.js";

/**
 * Minimal OpenclawSourceEntry factory — only fields mapAgent actually reads.
 * Everything else is filled with safe defaults.
 */
function makeSource(overrides: Partial<OpenclawSourceEntry> = {}): OpenclawSourceEntry {
  return {
    id: "alpha",
    name: "Alpha Agent",
    workspace: "/home/jj/.openclaw/workspace-alpha",
    agentDir: "/home/jj/.openclaw/workspace-alpha",
    model: { primary: "anthropic-api/claude-sonnet-4-6", fallbacks: [] },
    identity: {},
    discordChannelId: undefined,
    isFinmentumFamily: false,
    ...overrides,
  } as OpenclawSourceEntry;
}

describe("mapAgent — finmentum vs dedicated paths", () => {
  it("finmentum agent gets shared basePath + distinct memoryPath + SOUL/IDENTITY under memoryPath", () => {
    const source = makeSource({
      id: "fin-acquisition",
      workspace: "/home/jj/.openclaw/workspace-fin-acquisition",
      model: { primary: "anthropic-api/claude-sonnet-4-6", fallbacks: [] },
      isFinmentumFamily: true,
    });
    const { node } = mapAgent({
      source,
      targetBasePath: "/root/finmentum",
      targetMemoryPath: "/root/finmentum/memory/fin-acquisition",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(),
      perAgentMcpNames: [],
    });
    expect(node.workspace).toBe("/root/finmentum");
    expect(node.memoryPath).toBe("/root/finmentum/memory/fin-acquisition");
    expect(node.soulFile).toBe("/root/finmentum/memory/fin-acquisition/SOUL.md");
    expect(node.identityFile).toBe("/root/finmentum/memory/fin-acquisition/IDENTITY.md");
    expect(node.model).toBe("sonnet");
    expect(node.name).toBe("fin-acquisition");
  });

  it("dedicated agent omits memoryPath (schema fallback inherits workspace)", () => {
    const source = makeSource({ id: "personal", isFinmentumFamily: false });
    const { node } = mapAgent({
      source,
      targetBasePath: "/root/personal",
      targetMemoryPath: "/root/personal",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(),
      perAgentMcpNames: [],
    });
    expect(node.workspace).toBe("/root/personal");
    expect(node.memoryPath).toBeUndefined();
    expect(node.soulFile).toBe("/root/personal/SOUL.md");
    expect(node.identityFile).toBe("/root/personal/IDENTITY.md");
  });
});

describe("mapAgent — mcpServers auto-injection", () => {
  it("always includes clawcode AND 1password even when perAgentMcpNames is empty", () => {
    const { node } = mapAgent({
      source: makeSource(),
      targetBasePath: "/root/alpha",
      targetMemoryPath: "/root/alpha",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(),
      perAgentMcpNames: [],
    });
    expect(node.mcpServers).toEqual(["clawcode", "1password"]);
  });

  it("preserves order: clawcode, 1password, then per-agent names", () => {
    const { node } = mapAgent({
      source: makeSource(),
      targetBasePath: "/root/alpha",
      targetMemoryPath: "/root/alpha",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(["finnhub", "finmentum-db", "google-workspace"]),
      perAgentMcpNames: ["finnhub", "finmentum-db"],
    });
    expect(node.mcpServers).toEqual([
      "clawcode",
      "1password",
      "finnhub",
      "finmentum-db",
    ]);
  });

  it("does not double-inject when user already declared clawcode explicitly", () => {
    const { node } = mapAgent({
      source: makeSource(),
      targetBasePath: "/root/alpha",
      targetMemoryPath: "/root/alpha",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(["finnhub"]),
      perAgentMcpNames: ["finnhub", "clawcode"],
    });
    expect(node.mcpServers.filter((n) => n === "clawcode")).toHaveLength(1);
    expect(node.mcpServers).toEqual(["clawcode", "1password", "finnhub"]);
  });

  it("emits unknown-mcp-server warning and skips the ref when name is not in top-level map", () => {
    const { node, warnings } = mapAgent({
      source: makeSource({ id: "gamma" }),
      targetBasePath: "/root/gamma",
      targetMemoryPath: "/root/gamma",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(["finnhub"]),
      perAgentMcpNames: ["mystery-mcp-server"],
    });
    expect(node.mcpServers).toEqual(["clawcode", "1password"]);
    expect(warnings).toContainEqual<MapAgentWarning>({
      kind: "unknown-mcp-server",
      name: "mystery-mcp-server",
      agent: "gamma",
    });
  });
});

describe("mapAgent — model mapping + warnings", () => {
  it("emits unmappable-model warning for unknown source model, leaves raw value in node.model", () => {
    const source = makeSource({
      id: "delta",
      model: { primary: "unknown/made-up-model", fallbacks: [] },
    });
    const { node, warnings } = mapAgent({
      source,
      targetBasePath: "/root/delta",
      targetMemoryPath: "/root/delta",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(),
      perAgentMcpNames: [],
    });
    expect(node.model).toBe("unknown/made-up-model");
    expect(warnings).toContainEqual<MapAgentWarning>({
      kind: "unmappable-model",
      id: "unknown/made-up-model",
      agent: "delta",
    });
  });

  it("--model-map override eliminates the unmappable-model warning and sets mapped value", () => {
    const source = makeSource({
      id: "epsilon",
      model: { primary: "unknown/made-up-model", fallbacks: [] },
    });
    const modelMap = {
      ...DEFAULT_MODEL_MAP,
      "unknown/made-up-model": "sonnet",
    };
    const { node, warnings } = mapAgent({
      source,
      targetBasePath: "/root/epsilon",
      targetMemoryPath: "/root/epsilon",
      modelMap,
      existingTopLevelMcp: new Set(),
      perAgentMcpNames: [],
    });
    expect(node.model).toBe("sonnet");
    expect(warnings.filter((w) => w.kind === "unmappable-model")).toHaveLength(0);
  });
});

describe("mapAgent — channels passthrough", () => {
  it("includes discordChannelId as single-entry channels array when present", () => {
    const source = makeSource({ discordChannelId: "111222333" });
    const { node } = mapAgent({
      source,
      targetBasePath: "/root/alpha",
      targetMemoryPath: "/root/alpha",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(),
      perAgentMcpNames: [],
    });
    expect(node.channels).toEqual(["111222333"]);
  });

  it("returns empty channels array when discordChannelId is undefined", () => {
    const { node } = mapAgent({
      source: makeSource({ discordChannelId: undefined }),
      targetBasePath: "/root/alpha",
      targetMemoryPath: "/root/alpha",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(),
      perAgentMcpNames: [],
    });
    expect(node.channels).toEqual([]);
  });
});

describe("mapAgent — purity", () => {
  it("two identical invocations produce deep-equal outputs (pure function)", () => {
    const args = {
      source: makeSource({ id: "zeta" }),
      targetBasePath: "/root/zeta",
      targetMemoryPath: "/root/zeta",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(["finnhub"]),
      perAgentMcpNames: ["finnhub"],
    };
    const a = mapAgent(args);
    const b = mapAgent(args);
    expect(a).toEqual(b);
  });

  it("does not mutate source.model or source.identity", () => {
    const source = makeSource({
      id: "eta",
      model: { primary: "anthropic-api/claude-sonnet-4-6", fallbacks: [] },
    });
    const snapshot = JSON.parse(JSON.stringify(source));
    mapAgent({
      source,
      targetBasePath: "/root/eta",
      targetMemoryPath: "/root/eta",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(),
      perAgentMcpNames: [],
    });
    expect(source).toEqual(snapshot);
  });
});

describe("mapAgent — PlanWarning type compatibility", () => {
  it("warnings satisfy the PlanWarning union (compile-time pin via runtime check)", () => {
    const source = makeSource({
      id: "theta",
      model: { primary: "unknown/xxx", fallbacks: [] },
    });
    const { warnings } = mapAgent({
      source,
      targetBasePath: "/root/theta",
      targetMemoryPath: "/root/theta",
      modelMap: DEFAULT_MODEL_MAP,
      existingTopLevelMcp: new Set(),
      perAgentMcpNames: ["mystery"],
    });
    // Upcast to PlanWarning[] — compiles only if WARNING_KINDS includes
    // both "unmappable-model" and "unknown-mcp-server".
    const asPlanWarnings: PlanWarning[] = warnings.map((w) => {
      if (w.kind === "unmappable-model") {
        return { kind: w.kind, agent: w.agent, detail: w.id };
      }
      return { kind: w.kind, agent: w.agent, detail: w.name };
    });
    expect(asPlanWarnings.length).toBeGreaterThanOrEqual(2);
    expect(asPlanWarnings.map((w) => w.kind).sort()).toEqual([
      "unknown-mcp-server",
      "unmappable-model",
    ]);
  });
});
