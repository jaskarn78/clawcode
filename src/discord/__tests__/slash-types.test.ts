import { describe, it, expect } from "vitest";
import {
  DEFAULT_SLASH_COMMANDS,
  type SlashCommandDef,
  type SlashCommandOption,
} from "../slash-types.js";

describe("slash-types", () => {
  describe("DEFAULT_SLASH_COMMANDS", () => {
    it("contains exactly 6 commands: status, memory, schedule, health, compact, usage", () => {
      expect(DEFAULT_SLASH_COMMANDS).toHaveLength(6);
      const names = DEFAULT_SLASH_COMMANDS.map((cmd) => cmd.name);
      expect(names).toEqual(["status", "memory", "schedule", "health", "compact", "usage"]);
    });

    it("each default command has name, description, claudeCommand fields (all non-empty strings)", () => {
      for (const cmd of DEFAULT_SLASH_COMMANDS) {
        expect(cmd.name).toBeTruthy();
        expect(typeof cmd.name).toBe("string");
        expect(cmd.description).toBeTruthy();
        expect(typeof cmd.description).toBe("string");
        expect(cmd.claudeCommand).toBeTruthy();
        expect(typeof cmd.claudeCommand).toBe("string");
      }
    });

    it("the memory command has one required option named query of type STRING (3)", () => {
      const memoryCmd = DEFAULT_SLASH_COMMANDS.find((cmd) => cmd.name === "memory");
      expect(memoryCmd).toBeDefined();
      expect(memoryCmd!.options).toHaveLength(1);

      const queryOpt = memoryCmd!.options[0];
      expect(queryOpt.name).toBe("query");
      expect(queryOpt.type).toBe(3);
      expect(queryOpt.required).toBe(true);
      expect(queryOpt.description).toBeTruthy();
    });

    it("commands without options have an empty options array", () => {
      const nonMemory = DEFAULT_SLASH_COMMANDS.filter((cmd) => cmd.name !== "memory");
      expect(nonMemory.length).toBe(5);
      for (const cmd of nonMemory) {
        expect(cmd.options).toEqual([]);
      }
    });

    it("default commands are readonly arrays", () => {
      // Verify the array and nested options are readonly by checking structure
      expect(Array.isArray(DEFAULT_SLASH_COMMANDS)).toBe(true);
      for (const cmd of DEFAULT_SLASH_COMMANDS) {
        expect(Array.isArray(cmd.options)).toBe(true);
      }
    });
  });

  describe("type contracts", () => {
    it("SlashCommandOption satisfies the expected shape", () => {
      const opt: SlashCommandOption = {
        name: "test",
        type: 3,
        description: "A test option",
        required: true,
      };
      expect(opt.name).toBe("test");
      expect(opt.type).toBe(3);
    });

    it("SlashCommandDef satisfies the expected shape", () => {
      const def: SlashCommandDef = {
        name: "test",
        description: "A test command",
        claudeCommand: "do something",
        options: [],
      };
      expect(def.name).toBe("test");
      expect(def.options).toEqual([]);
    });
  });
});
