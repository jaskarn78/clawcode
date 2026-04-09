import { describe, it, expect, vi } from "vitest";
import { buildSessionConfig, type SessionConfigDeps } from "../session-config.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";

// Mock filesystem reads so buildSessionConfig doesn't hit disk
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
}));

// Mock loadLatestSummary to return undefined (no persisted summary)
vi.mock("../../memory/context-summary.js", () => ({
  loadLatestSummary: vi.fn().mockResolvedValue(undefined),
}));

// Mock buildBootstrapPrompt (not needed for these tests but imported by module)
vi.mock("../../bootstrap/prompt-builder.js", () => ({
  buildBootstrapPrompt: vi.fn().mockReturnValue("bootstrap prompt"),
}));

function makeConfig(overrides: Partial<ResolvedAgentConfig> = {}): ResolvedAgentConfig {
  return {
    name: "test-agent",
    workspace: "/tmp/test-workspace",
    channels: [],
    model: "sonnet",
    skills: [],
    soul: undefined,
    identity: undefined,
    memory: {
      compactionThreshold: 0.75,
      searchTopK: 10,
      consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4 },
      decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 },
      deduplication: { enabled: true, similarityThreshold: 0.85 },
    },
    schedules: [],
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75 },
    },
    skillsPath: "/tmp/skills",
    admin: false,
    subagentModel: undefined,
    threads: { idleTimeoutMinutes: 30, maxThreadSessions: 5 },
    reactions: false,
    slashCommands: [],
    mcpServers: [],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SessionConfigDeps> = {}): SessionConfigDeps {
  return {
    tierManagers: new Map(),
    skillsCatalog: new Map(),
    allAgentConfigs: [],
    ...overrides,
  };
}

describe("buildSessionConfig — subagent thread skill guidance", () => {
  it("includes Subagent Thread Skill section when agent has subagent-thread skill", async () => {
    const config = makeConfig({ skills: ["subagent-thread"] });
    const result = await buildSessionConfig(config, makeDeps());
    expect(result.systemPrompt).toContain("## Subagent Thread Skill");
  });

  it("includes guidance to prefer subagent-thread skill over raw Agent tool", async () => {
    const config = makeConfig({ skills: ["subagent-thread"] });
    const result = await buildSessionConfig(config, makeDeps());
    expect(result.systemPrompt).toContain(
      "prefer the `spawn_subagent_thread` MCP tool"
    );
    expect(result.systemPrompt).toContain("over the raw Agent tool");
  });

  it("does NOT include Subagent Thread Skill section when skill not assigned", async () => {
    const config = makeConfig({ skills: [] });
    const result = await buildSessionConfig(config, makeDeps());
    expect(result.systemPrompt).not.toContain("Subagent Thread Skill");
  });

  it("does NOT include guidance when agent has other skills but not subagent-thread", async () => {
    const config = makeConfig({ skills: ["some-other-skill"] });
    const result = await buildSessionConfig(config, makeDeps());
    expect(result.systemPrompt).not.toContain("Subagent Thread Skill");
  });

  it("mentions spawn_subagent_thread MCP tool in guidance", async () => {
    const config = makeConfig({ skills: ["subagent-thread"] });
    const result = await buildSessionConfig(config, makeDeps());
    expect(result.systemPrompt).toContain("spawn_subagent_thread");
  });

  it("includes guidance alongside other skills when multiple assigned", async () => {
    const config = makeConfig({ skills: ["content-engine", "subagent-thread", "market-research"] });
    const deps = makeDeps({
      skillsCatalog: new Map([
        ["content-engine", { name: "content-engine", version: "1.0", description: "Content creation", path: "/tmp/skills/content-engine" }],
        ["market-research", { name: "market-research", version: "1.0", description: "Market research", path: "/tmp/skills/market-research" }],
      ]),
    });
    const result = await buildSessionConfig(config, deps);
    // Should have both Available Skills section and Subagent Thread Skill section
    expect(result.systemPrompt).toContain("## Available Skills");
    expect(result.systemPrompt).toContain("## Subagent Thread Skill");
  });
});

describe("buildSessionConfig — MCP tools injection", () => {
  it("includes Available MCP Tools section when agent has mcpServers configured", async () => {
    const config = makeConfig({
      mcpServers: [
        { name: "finnhub", command: "npx", args: ["-y", "finnhub-mcp"], env: {} },
      ],
    });
    const result = await buildSessionConfig(config, makeDeps());
    expect(result.systemPrompt).toContain("## Available MCP Tools");
  });

  it("lists each server name and command in the MCP tools section", async () => {
    const config = makeConfig({
      mcpServers: [
        { name: "finnhub", command: "npx", args: ["-y", "finnhub-mcp"], env: {} },
        { name: "google-workspace", command: "node", args: ["gw-server.js"], env: { API_KEY: "test" } },
      ],
    });
    const result = await buildSessionConfig(config, makeDeps());
    expect(result.systemPrompt).toContain("**finnhub**");
    expect(result.systemPrompt).toContain("`npx -y finnhub-mcp`");
    expect(result.systemPrompt).toContain("**google-workspace**");
    expect(result.systemPrompt).toContain("`node gw-server.js`");
  });

  it("does NOT include MCP tools section when agent has empty mcpServers", async () => {
    const config = makeConfig({ mcpServers: [] });
    const result = await buildSessionConfig(config, makeDeps());
    expect(result.systemPrompt).not.toContain("Available MCP Tools");
  });

  it("does NOT include MCP tools section when mcpServers is undefined (defaults to empty)", async () => {
    // mcpServers defaults to [] via ?? in buildSessionConfig
    const config = makeConfig();
    const result = await buildSessionConfig(config, makeDeps());
    expect(result.systemPrompt).not.toContain("Available MCP Tools");
  });
});
