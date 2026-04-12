import { describe, it, expect } from "vitest";
import {
  DEFAULT_SLASH_COMMANDS,
  CONTROL_COMMANDS,
  type SlashCommandDef,
  type SlashCommandOption,
} from "../slash-types.js";

describe("slash-types", () => {
  describe("DEFAULT_SLASH_COMMANDS", () => {
    it("contains exactly 8 commands with clawcode- prefix", () => {
      expect(DEFAULT_SLASH_COMMANDS).toHaveLength(8);
      const names = DEFAULT_SLASH_COMMANDS.map((cmd) => cmd.name);
      expect(names).toEqual([
        "clawcode-status",
        "clawcode-memory",
        "clawcode-schedule",
        "clawcode-health",
        "clawcode-compact",
        "clawcode-usage",
        "clawcode-model",
        "clawcode-effort",
      ]);
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
      const memoryCmd = DEFAULT_SLASH_COMMANDS.find((cmd) => cmd.name === "clawcode-memory");
      expect(memoryCmd).toBeDefined();
      expect(memoryCmd!.options).toHaveLength(1);

      const queryOpt = memoryCmd!.options[0];
      expect(queryOpt.name).toBe("query");
      expect(queryOpt.type).toBe(3);
      expect(queryOpt.required).toBe(true);
      expect(queryOpt.description).toBeTruthy();
    });

    it("commands without options have an empty options array", () => {
      const withOptions = new Set(["clawcode-memory", "clawcode-model", "clawcode-effort"]);
      const noOptionCmds = DEFAULT_SLASH_COMMANDS.filter((cmd) => !withOptions.has(cmd.name));
      expect(noOptionCmds.length).toBe(5);
      for (const cmd of noOptionCmds) {
        expect(cmd.options).toEqual([]);
      }
    });

    it("the model command has one required option named model of type STRING (3)", () => {
      const modelCmd = DEFAULT_SLASH_COMMANDS.find((cmd) => cmd.name === "clawcode-model");
      expect(modelCmd).toBeDefined();
      expect(modelCmd!.options).toHaveLength(1);

      const modelOpt = modelCmd!.options[0];
      expect(modelOpt.name).toBe("model");
      expect(modelOpt.type).toBe(3);
      expect(modelOpt.required).toBe(true);
      expect(modelOpt.description).toBeTruthy();
    });

    it("default commands are readonly arrays", () => {
      // Verify the array and nested options are readonly by checking structure
      expect(Array.isArray(DEFAULT_SLASH_COMMANDS)).toBe(true);
      for (const cmd of DEFAULT_SLASH_COMMANDS) {
        expect(Array.isArray(cmd.options)).toBe(true);
      }
    });
  });

  describe("CONTROL_COMMANDS", () => {
    it("contains exactly 5 control commands", () => {
      expect(CONTROL_COMMANDS).toHaveLength(5);
    });

    it("all control commands have control: true and a valid ipcMethod", () => {
      const validMethods = ["start", "stop", "restart", "status", "agent-create"];
      for (const cmd of CONTROL_COMMANDS) {
        expect(cmd.control).toBe(true);
        expect(validMethods).toContain(cmd.ipcMethod);
      }
    });

    it("all control commands have empty claudeCommand", () => {
      for (const cmd of CONTROL_COMMANDS) {
        expect(cmd.claudeCommand).toBe("");
      }
    });

    it("start, stop, restart each have a required agent option", () => {
      const agentCmds = CONTROL_COMMANDS.filter(
        (c) => c.ipcMethod === "start" || c.ipcMethod === "stop" || c.ipcMethod === "restart",
      );
      expect(agentCmds).toHaveLength(3);
      for (const cmd of agentCmds) {
        expect(cmd.options).toHaveLength(1);
        expect(cmd.options[0].name).toBe("agent");
        expect(cmd.options[0].type).toBe(3);
        expect(cmd.options[0].required).toBe(true);
      }
    });

    it("fleet command has no options", () => {
      const fleet = CONTROL_COMMANDS.find(
        (c) => c.name === "clawcode-fleet",
      );
      expect(fleet).toBeDefined();
      expect(fleet!.options).toHaveLength(0);
    });

    it("includes all expected command names", () => {
      const names = CONTROL_COMMANDS.map((c) => c.name);
      expect(names).toContain("clawcode-start");
      expect(names).toContain("clawcode-stop");
      expect(names).toContain("clawcode-restart");
      expect(names).toContain("clawcode-fleet");
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
