import { describe, it, expect } from "vitest";
import { diffConfigs } from "../differ.js";
import type { Config } from "../schema.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    version: 1,
    defaults: {
      model: "sonnet",
      effort: "low" as const,
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
});
