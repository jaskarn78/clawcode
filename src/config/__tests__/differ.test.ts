import { describe, it, expect } from "vitest";
import { diffConfigs } from "../differ.js";
import type { Config } from "../schema.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    version: 1,
    defaults: {
      model: "sonnet",
      effort: "low" as const,
      // Phase 86 MODEL-01 — defaults carry the full allowlist so back-compat
      // tests that build a base Config don't produce a spurious diff on
      // the defaults.allowedModels field.
      allowedModels: ["haiku", "sonnet", "opus"],
      // Phase 89 GREET-07/10 — defaults carry the zod-populated values.
      greetOnRestart: true,
      greetCoolDownMs: 300_000,
      // Phase 90 MEM-01 — defaults carry the zod-populated value.
      memoryAutoLoad: true,
      // Phase 90 Plan 04 HUB-01/HUB-08 — defaults carry the zod-populated values.
      clawhubBaseUrl: "https://clawhub.ai",
      clawhubCacheTtlMs: 600_000,
      skills: [],
      basePath: "~/.clawcode/agents",
      skillsPath: "~/.clawcode/skills",
      memory: {
        compactionThreshold: 0.75,
        searchTopK: 10,
        consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *" },
        decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 },
        deduplication: { enabled: true, similarityThreshold: 0.85 },
        tiers: { hotAccessThreshold: 3, hotAccessWindowDays: 7, hotDemotionDays: 7, coldRelevanceThreshold: 0.05, hotBudget: 20 },
        episodes: { archivalAgeDays: 90 },
      },
      heartbeat: {
        enabled: true,
        intervalSeconds: 60,
        checkTimeoutSeconds: 10,
        contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75, zoneThresholds: { yellow: 0.50, orange: 0.70, red: 0.85 } },
      },
      threads: { idleTimeoutMinutes: 1440, maxThreadSessions: 10 },
      openai: { enabled: true, port: 3101, host: "0.0.0.0", maxRequestBodyBytes: 1048576, streamKeepaliveMs: 15000 },
      browser: {
        enabled: true,
        headless: true,
        warmOnBoot: true,
        navigationTimeoutMs: 30000,
        actionTimeoutMs: 10000,
        viewport: { width: 1280, height: 720 },
        userAgent: null,
        maxScreenshotInlineBytes: 524288,
      },
      search: {
        enabled: true,
        backend: "brave" as const,
        brave: { apiKeyEnv: "BRAVE_API_KEY", safeSearch: "moderate" as const, country: "us" },
        exa: { apiKeyEnv: "EXA_API_KEY", useAutoprompt: false },
        maxResults: 20,
        timeoutMs: 10000,
        fetch: { timeoutMs: 30000, maxBytes: 1048576, userAgentSuffix: null },
      },
      image: {
        enabled: true,
        backend: "openai" as const,
        openai: { apiKeyEnv: "OPENAI_API_KEY", model: "gpt-image-1" },
        minimax: { apiKeyEnv: "MINIMAX_API_KEY", model: "image-01" },
        fal: { apiKeyEnv: "FAL_API_KEY", model: "fal-ai/flux-pro" },
        maxImageBytes: 10485760,
        timeoutMs: 60000,
        workspaceSubdir: "generated-images",
      },
    },
    mcpServers: {},
    agents: [
      {
        name: "researcher",
        channels: ["123"],
        skills: [],
        effort: "low",
        heartbeat: true,
        schedules: [],
        admin: false,
        slashCommands: [],
        reactions: true,
        mcpServers: [],
      },
    ],
    ...overrides,
  };
}

describe("diffConfigs", () => {
  it("returns empty changes for identical configs", () => {
    const config = makeConfig();
    const result = diffConfigs(config, config);
    expect(result.changes).toEqual([]);
    expect(result.hasReloadableChanges).toBe(false);
    expect(result.hasNonReloadableChanges).toBe(false);
  });

  it("detects channel change as reloadable", () => {
    const oldConfig = makeConfig();
    const newConfig = makeConfig({
      agents: [
        { ...oldConfig.agents[0], channels: ["123", "456"] },
      ],
    });
    const result = diffConfigs(oldConfig, newConfig);
    expect(result.changes.length).toBeGreaterThan(0);
    const channelChange = result.changes.find((c) =>
      c.fieldPath.includes("channels"),
    );
    expect(channelChange).toBeDefined();
    expect(channelChange!.reloadable).toBe(true);
    expect(result.hasReloadableChanges).toBe(true);
  });

  it("detects model change as non-reloadable", () => {
    const oldConfig = makeConfig();
    const newConfig = makeConfig({
      agents: [
        { ...oldConfig.agents[0], model: "opus" },
      ],
    });
    const result = diffConfigs(oldConfig, newConfig);
    const modelChange = result.changes.find((c) =>
      c.fieldPath.includes("model"),
    );
    expect(modelChange).toBeDefined();
    expect(modelChange!.reloadable).toBe(false);
    expect(result.hasNonReloadableChanges).toBe(true);
  });

  it("detects agent added", () => {
    const oldConfig = makeConfig();
    const newConfig = makeConfig({
      agents: [
        ...oldConfig.agents,
        {
          name: "coder",
          channels: ["789"],
          skills: [],
          effort: "low",
          heartbeat: true,
          schedules: [],
          admin: false,
          slashCommands: [],
          reactions: true,
          mcpServers: [],
        },
      ],
    });
    const result = diffConfigs(oldConfig, newConfig);
    const addedChange = result.changes.find((c) =>
      c.fieldPath.includes("coder") && c.oldValue === undefined,
    );
    expect(addedChange).toBeDefined();
  });

  it("detects agent removed", () => {
    const oldConfig = makeConfig({
      agents: [
        {
          name: "researcher",
          channels: ["123"],
          skills: [],
          effort: "low",
          heartbeat: true,
          schedules: [],
          admin: false,
          slashCommands: [],
          reactions: true,
          mcpServers: [],
        },
        {
          name: "coder",
          channels: ["789"],
          skills: [],
          effort: "low",
          heartbeat: true,
          schedules: [],
          admin: false,
          slashCommands: [],
          reactions: true,
          mcpServers: [],
        },
      ],
    });
    const newConfig = makeConfig({
      agents: [
        {
          name: "researcher",
          channels: ["123"],
          skills: [],
          effort: "low",
          heartbeat: true,
          schedules: [],
          admin: false,
          slashCommands: [],
          reactions: true,
          mcpServers: [],
        },
      ],
    });
    const result = diffConfigs(oldConfig, newConfig);
    const removedChange = result.changes.find((c) =>
      c.fieldPath.includes("coder") && c.newValue === undefined,
    );
    expect(removedChange).toBeDefined();
  });

  it("detects schedule change as reloadable", () => {
    const oldConfig = makeConfig();
    const newConfig = makeConfig({
      agents: [
        {
          ...oldConfig.agents[0],
          schedules: [{ name: "daily", cron: "0 9 * * *", prompt: "report", enabled: true }],
        },
      ],
    });
    const result = diffConfigs(oldConfig, newConfig);
    const scheduleChange = result.changes.find((c) =>
      c.fieldPath.includes("schedules"),
    );
    expect(scheduleChange).toBeDefined();
    expect(scheduleChange!.reloadable).toBe(true);
  });

  it("detects multiple changes at once", () => {
    const oldConfig = makeConfig();
    const newConfig = makeConfig({
      defaults: { ...oldConfig.defaults, model: "opus" },
      agents: [
        { ...oldConfig.agents[0], channels: ["123", "456"] },
      ],
    });
    const result = diffConfigs(oldConfig, newConfig);
    expect(result.changes.length).toBeGreaterThanOrEqual(2);
    expect(result.hasReloadableChanges).toBe(true);
    expect(result.hasNonReloadableChanges).toBe(true);
  });

  it("detects defaults.heartbeat change as reloadable", () => {
    const oldConfig = makeConfig();
    const newConfig = makeConfig({
      defaults: {
        ...oldConfig.defaults,
        heartbeat: { ...oldConfig.defaults.heartbeat, intervalSeconds: 120 },
      },
    });
    const result = diffConfigs(oldConfig, newConfig);
    const hbChange = result.changes.find((c) =>
      c.fieldPath.includes("defaults.heartbeat"),
    );
    expect(hbChange).toBeDefined();
    expect(hbChange!.reloadable).toBe(true);
  });

  it("detects defaults.basePath change as non-reloadable", () => {
    const oldConfig = makeConfig();
    const newConfig = makeConfig({
      defaults: { ...oldConfig.defaults, basePath: "/new/path" },
    });
    const result = diffConfigs(oldConfig, newConfig);
    const pathChange = result.changes.find((c) =>
      c.fieldPath.includes("defaults.basePath"),
    );
    expect(pathChange).toBeDefined();
    expect(pathChange!.reloadable).toBe(false);
  });

  // Phase 83 EFFORT-01 — effort is reloadable because setEffort() invokes
  // q.setMaxThinkingTokens on the live handle; no restart required.
  it("detects agents.*.effort change as reloadable", () => {
    const oldConfig = makeConfig();
    const newConfig = makeConfig({
      agents: [
        { ...oldConfig.agents[0], effort: "high" as const },
      ],
    });
    const result = diffConfigs(oldConfig, newConfig);
    const effortChange = result.changes.find((c) =>
      c.fieldPath === "agents.researcher.effort",
    );
    expect(effortChange).toBeDefined();
    expect(effortChange!.oldValue).toBe("low");
    expect(effortChange!.newValue).toBe("high");
    expect(effortChange!.reloadable).toBe(true);
    expect(result.hasReloadableChanges).toBe(true);
  });

  it("detects defaults.effort change as reloadable", () => {
    const oldConfig = makeConfig();
    const newConfig = makeConfig({
      defaults: { ...oldConfig.defaults, effort: "medium" as const },
    });
    const result = diffConfigs(oldConfig, newConfig);
    const effortChange = result.changes.find((c) =>
      c.fieldPath === "defaults.effort",
    );
    expect(effortChange).toBeDefined();
    expect(effortChange!.reloadable).toBe(true);
  });

  // Phase 86 MODEL-01 — allowedModels is reloadable because the Discord
  // picker re-reads on every invocation; no session restart needed.
  // Runtime model SWITCHES stay non-reloadable (see agents.*.model below).
  it("detects agents.*.allowedModels change as reloadable", () => {
    const baseAgent = makeConfig().agents[0];
    const oldConfig = makeConfig({
      agents: [{ ...baseAgent, allowedModels: ["haiku"] } as typeof baseAgent],
    });
    const newConfig = makeConfig({
      agents: [
        {
          ...baseAgent,
          allowedModels: ["haiku", "sonnet"],
        } as typeof baseAgent,
      ],
    });
    const result = diffConfigs(oldConfig, newConfig);
    const change = result.changes.find((c) =>
      c.fieldPath.includes("allowedModels"),
    );
    expect(change).toBeDefined();
    expect(change!.reloadable).toBe(true);
    expect(result.hasReloadableChanges).toBe(true);
  });

  it("detects defaults.allowedModels change as reloadable", () => {
    const oldConfig = makeConfig();
    const newConfig = makeConfig({
      defaults: {
        ...oldConfig.defaults,
        allowedModels: ["haiku"],
      } as typeof oldConfig.defaults,
    });
    const result = diffConfigs(oldConfig, newConfig);
    const change = result.changes.find((c) =>
      c.fieldPath === "defaults.allowedModels",
    );
    expect(change).toBeDefined();
    expect(change!.reloadable).toBe(true);
  });

  it("keeps agents.*.model classified as non-reloadable (no regression from allowedModels)", () => {
    // Regression pin: adding allowedModels must NOT reclassify `model` as
    // reloadable — runtime model switches use SessionHandle.setModel, not
    // the hot-reload path.
    const oldConfig = makeConfig();
    const newConfig = makeConfig({
      agents: [
        { ...oldConfig.agents[0], model: "opus" as const },
      ],
    });
    const result = diffConfigs(oldConfig, newConfig);
    const modelChange = result.changes.find((c) =>
      c.fieldPath === "agents.researcher.model",
    );
    expect(modelChange).toBeDefined();
    expect(modelChange!.reloadable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 75 Plan 01 — SHARED-01: memoryPath classified as non-reloadable
// ---------------------------------------------------------------------------

describe("diffConfigs - memoryPath non-reloadable", () => {
  it("marks a changed memoryPath as non-reloadable (swapping memoryPath requires daemon restart)", () => {
    const oldCfg = makeConfig({
      agents: [
        {
          name: "fin-acquisition",
          channels: [],
          skills: [],
          effort: "low",
          heartbeat: true,
          schedules: [],
          admin: false,
          slashCommands: [],
          reactions: true,
          mcpServers: [],
          memoryPath: "~/shared/finmentum/fin-acquisition",
        },
      ],
    });
    const newCfg = makeConfig({
      agents: [
        { ...oldCfg.agents[0], memoryPath: "~/shared/finmentum/fin-research" },
      ],
    });
    const diff = diffConfigs(oldCfg, newCfg);
    const change = diff.changes.find(
      (c) => c.fieldPath === "agents.fin-acquisition.memoryPath",
    );
    expect(change).toBeDefined();
    expect(change!.reloadable).toBe(false);
    expect(diff.hasNonReloadableChanges).toBe(true);
  });

  it("produces no diff entry when memoryPath is identical on both sides", () => {
    const agent = {
      name: "fin-acquisition",
      channels: [],
      skills: [],
      effort: "low" as const,
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
      memoryPath: "~/shared/finmentum/fin-acquisition",
    };
    const oldCfg = makeConfig({ agents: [agent] });
    const newCfg = makeConfig({ agents: [{ ...agent }] });
    const diff = diffConfigs(oldCfg, newCfg);
    const change = diff.changes.find((c) => c.fieldPath.includes("memoryPath"));
    expect(change).toBeUndefined();
  });

  it("marks adding memoryPath (undefined -> defined) as non-reloadable", () => {
    const agent = {
      name: "fin-acquisition",
      channels: [],
      skills: [],
      effort: "low" as const,
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };
    const oldCfg = makeConfig({ agents: [agent] });
    const newCfg = makeConfig({
      agents: [{ ...agent, memoryPath: "~/shared/finmentum/fin-acquisition" }],
    });
    const diff = diffConfigs(oldCfg, newCfg);
    const change = diff.changes.find(
      (c) => c.fieldPath === "agents.fin-acquisition.memoryPath",
    );
    expect(change).toBeDefined();
    expect(change!.reloadable).toBe(false);
  });

  it("marks removing memoryPath (defined -> undefined) as non-reloadable", () => {
    const agentWithMemoryPath = {
      name: "fin-acquisition",
      channels: [],
      skills: [],
      effort: "low" as const,
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
      memoryPath: "~/shared/finmentum/fin-acquisition",
    };
    const agentWithoutMemoryPath = {
      name: "fin-acquisition",
      channels: [],
      skills: [],
      effort: "low" as const,
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };
    const oldCfg = makeConfig({ agents: [agentWithMemoryPath] });
    const newCfg = makeConfig({ agents: [agentWithoutMemoryPath] });
    const diff = diffConfigs(oldCfg, newCfg);
    const change = diff.changes.find(
      (c) => c.fieldPath === "agents.fin-acquisition.memoryPath",
    );
    expect(change).toBeDefined();
    expect(change!.reloadable).toBe(false);
  });

  it("hasNonReloadableChanges is true when only a memoryPath change is present", () => {
    const agent = {
      name: "fin-acquisition",
      channels: [],
      skills: [],
      effort: "low" as const,
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
      memoryPath: "~/shared/finmentum/fin-acquisition",
    };
    const oldCfg = makeConfig({ agents: [agent] });
    const newCfg = makeConfig({
      agents: [{ ...agent, memoryPath: "~/shared/finmentum/fin-research" }],
    });
    const diff = diffConfigs(oldCfg, newCfg);
    expect(diff.hasNonReloadableChanges).toBe(true);
    // Should NOT also set hasReloadableChanges (memoryPath-only diff).
    expect(diff.hasReloadableChanges).toBe(false);
  });
});
