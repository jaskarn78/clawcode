import { describe, it, expect } from "vitest";
import {
  formatCommandMessage,
  resolveAgentCommands,
} from "../slash-commands.js";
import { DEFAULT_SLASH_COMMANDS } from "../slash-types.js";
import type { SlashCommandDef } from "../slash-types.js";

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
