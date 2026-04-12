import { describe, it, expect } from "vitest";
import {
  formatCommandMessage,
  resolveAgentCommands,
  buildFleetEmbed,
  formatUptime,
} from "../slash-commands.js";
import { DEFAULT_SLASH_COMMANDS } from "../slash-types.js";
import type { SlashCommandDef } from "../slash-types.js";
import type { RegistryEntry } from "../../manager/types.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";

describe("formatCommandMessage", () => {
  it("returns claudeCommand as-is when no options are provided", () => {
    const def: SlashCommandDef = {
      name: "status",
      description: "Get status",
      claudeCommand: "Report your current status",
      options: [],
    };
    const result = formatCommandMessage(def, new Map());
    expect(result).toBe("Report your current status");
  });

  it("substitutes {optionName} placeholders with option values", () => {
    const def: SlashCommandDef = {
      name: "memory",
      description: "Search memory",
      claudeCommand: "Search your memory for: {query}",
      options: [
        { name: "query", type: 3, description: "What to search for", required: true },
      ],
    };
    const options = new Map<string, string | number | boolean>([
      ["query", "project deadlines"],
    ]);
    const result = formatCommandMessage(def, options);
    expect(result).toBe("Search your memory for: project deadlines");
  });

  it("appends unmatched options as key: value after the command", () => {
    const def: SlashCommandDef = {
      name: "custom",
      description: "Custom command",
      claudeCommand: "Do something",
      options: [
        { name: "extra", type: 3, description: "Extra info", required: false },
      ],
    };
    const options = new Map<string, string | number | boolean>([
      ["extra", "some value"],
    ]);
    const result = formatCommandMessage(def, options);
    expect(result).toBe("Do something\nextra: some value");
  });
});

describe("resolveAgentCommands", () => {
  it("returns DEFAULT_SLASH_COMMANDS when agent has no custom commands", () => {
    const result = resolveAgentCommands([]);
    expect(result).toEqual(DEFAULT_SLASH_COMMANDS);
  });

  it("overrides default command when agent defines one with the same name", () => {
    const customStatus: SlashCommandDef = {
      name: "clawcode-status",
      description: "Custom status",
      claudeCommand: "Custom status report",
      options: [],
    };
    const result = resolveAgentCommands([customStatus]);
    const statusCmd = result.find((c) => c.name === "clawcode-status");
    expect(statusCmd).toBeDefined();
    expect(statusCmd!.description).toBe("Custom status");
    expect(statusCmd!.claudeCommand).toBe("Custom status report");
    // Other defaults should still be present
    expect(result.length).toBe(DEFAULT_SLASH_COMMANDS.length);
  });
});

function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    name: "test-agent",
    status: "running",
    sessionId: "sess-1",
    startedAt: Date.now() - 3_600_000, // 1 hour ago
    restartCount: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastStableAt: Date.now() - 60_000,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ResolvedAgentConfig> = {}): ResolvedAgentConfig {
  return {
    name: "test-agent",
    model: "haiku",
    effort: "high",
    workspace: "/tmp/test",
    channels: ["ch1"],
    systemPrompt: "",
    slashCommands: [],
    ...overrides,
  } as ResolvedAgentConfig;
}

describe("formatUptime", () => {
  it("renders days, hours, minutes", () => {
    // 1 day, 2 hours, 3 minutes
    const ms = (1 * 24 * 60 + 2 * 60 + 3) * 60_000;
    expect(formatUptime(ms)).toBe("1d 2h 3m");
  });

  it("renders only hours and minutes when under 1 day", () => {
    const ms = (5 * 60 + 30) * 60_000;
    expect(formatUptime(ms)).toBe("5h 30m");
  });

  it("renders only minutes when under 1 hour", () => {
    const ms = 15 * 60_000;
    expect(formatUptime(ms)).toBe("15m");
  });

  it("renders 0m for zero milliseconds", () => {
    expect(formatUptime(0)).toBe("0m");
  });
});

describe("buildFleetEmbed", () => {
  it("returns correct structure with title, color, fields, timestamp", () => {
    const entries = [makeEntry()];
    const configs = [makeConfig()];
    const result = buildFleetEmbed(entries, configs);
    expect(result.title).toBe("Fleet Status");
    expect(result.fields).toHaveLength(1);
    expect(result.timestamp).toBeTruthy();
    expect(typeof result.color).toBe("number");
  });

  it("uses green (0x00ff00) when all agents running", () => {
    const entries = [
      makeEntry({ name: "a1", status: "running" }),
      makeEntry({ name: "a2", status: "running" }),
    ];
    const configs = [makeConfig({ name: "a1" }), makeConfig({ name: "a2" })];
    const result = buildFleetEmbed(entries, configs);
    expect(result.color).toBe(0x00ff00);
  });

  it("uses red (0xff0000) when any agent is stopped", () => {
    const entries = [
      makeEntry({ name: "a1", status: "running" }),
      makeEntry({ name: "a2", status: "stopped" }),
    ];
    const configs = [makeConfig({ name: "a1" }), makeConfig({ name: "a2" })];
    const result = buildFleetEmbed(entries, configs);
    expect(result.color).toBe(0xff0000);
  });

  it("uses yellow (0xffff00) when mixed (running + restarting)", () => {
    const entries = [
      makeEntry({ name: "a1", status: "running" }),
      makeEntry({ name: "a2", status: "restarting" }),
    ];
    const configs = [makeConfig({ name: "a1" }), makeConfig({ name: "a2" })];
    const result = buildFleetEmbed(entries, configs);
    expect(result.color).toBe(0xffff00);
  });

  it("uses gray (0x808080) for empty entries", () => {
    const result = buildFleetEmbed([], []);
    expect(result.color).toBe(0x808080);
    expect(result.fields).toHaveLength(0);
  });

  it("includes model from config in field value", () => {
    const entries = [makeEntry({ name: "bot1", status: "running" })];
    const configs = [makeConfig({ name: "bot1", model: "opus" })];
    const result = buildFleetEmbed(entries, configs);
    expect(result.fields[0].value).toContain("opus");
  });

  it("shows unknown model when config not found", () => {
    const entries = [makeEntry({ name: "orphan", status: "running" })];
    const result = buildFleetEmbed(entries, []);
    expect(result.fields[0].value).toContain("unknown");
  });
});
