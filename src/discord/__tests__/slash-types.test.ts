import { describe, it, expect } from "vitest";
import {
  DEFAULT_SLASH_COMMANDS,
  CONTROL_COMMANDS,
  type SlashCommandDef,
  type SlashCommandOption,
} from "../slash-types.js";

describe("slash-types", () => {
  describe("DEFAULT_SLASH_COMMANDS", () => {
    // Phase 87 CMD-04 — clawcode-compact and clawcode-usage were REMOVED from
    // DEFAULT_SLASH_COMMANDS. They are re-provided at registration time by the
    // SDK discovery loop via native-cc-commands.buildNativeCommandDefs so the
    // native-dispatch path is the ONLY path for /compact and /cost going forward.
    it("contains exactly 12 commands (10 clawcode-* + 2 ultra-* native shortcuts added in 999.31)", () => {
      expect(DEFAULT_SLASH_COMMANDS).toHaveLength(12);
      const names = DEFAULT_SLASH_COMMANDS.map((cmd) => cmd.name);
      expect(names).toEqual([
        "clawcode-status",
        "clawcode-memory",
        "clawcode-schedule",
        "clawcode-health",
        "clawcode-model",
        "clawcode-effort",
        "clawcode-skills-browse",
        "clawcode-skills",
        "clawcode-plugins-browse",
        "clawcode-clawhub-auth",
        "ultra-plan",
        "ultra-review",
      ]);
    });

    it("does NOT contain clawcode-compact (Phase 87 CMD-04 regression pin)", () => {
      const names = DEFAULT_SLASH_COMMANDS.map((cmd) => cmd.name);
      expect(names).not.toContain("clawcode-compact");
    });

    it("does NOT contain clawcode-usage (Phase 87 CMD-04 regression pin)", () => {
      const names = DEFAULT_SLASH_COMMANDS.map((cmd) => cmd.name);
      expect(names).not.toContain("clawcode-usage");
    });

    it("every remaining entry matches /^clawcode-/ OR is a Phase 999.31 ultra-* native shortcut", () => {
      const ultraNames = new Set(["ultra-plan", "ultra-review"]);
      for (const cmd of DEFAULT_SLASH_COMMANDS) {
        if (ultraNames.has(cmd.name)) continue;
        expect(cmd.name).toMatch(/^clawcode-/);
      }
    });

    it("each default command has name, description fields (non-empty strings); claudeCommand is a string (may be empty for inline handlers)", () => {
      // Phase 86 MODEL-02 / MODEL-03 — clawcode-model was converted to an
      // inline handler that routes through IPC set-model directly. Its
      // claudeCommand field is intentionally empty (the inline handler short-
      // circuits before formatCommandMessage is reached). All other commands
      // still carry a non-empty LLM-prompt template.
      // Phase 88 MKT-01 / MKT-07 — clawcode-skills-browse and clawcode-skills
      // are ALSO inline-handled (StringSelectMenuBuilder + IPC dispatch).
      const inlineHandlers = new Set([
        "clawcode-model",
        "clawcode-skills-browse",
        "clawcode-skills",
        "clawcode-plugins-browse",
        "clawcode-clawhub-auth",
      ]);
      for (const cmd of DEFAULT_SLASH_COMMANDS) {
        expect(cmd.name).toBeTruthy();
        expect(typeof cmd.name).toBe("string");
        expect(cmd.description).toBeTruthy();
        expect(typeof cmd.description).toBe("string");
        expect(typeof cmd.claudeCommand).toBe("string");
        if (inlineHandlers.has(cmd.name)) {
          expect(cmd.claudeCommand).toBe("");
        } else {
          expect(cmd.claudeCommand).toBeTruthy();
        }
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
      // Phase 87 CMD-04 — after removing compact + usage, the no-options set
      // shrinks from 5 to 3 (status, schedule, health).
      // Phase 88 MKT-01 / MKT-07 / UI-01 — clawcode-skills-browse and
      // clawcode-skills are picker-driven (zero free-text args); they join
      // the no-options set.
      // Phase 999.31 — ultra-plan and ultra-review have an `args` option,
      // so they join the with-options set (not the no-options set).
      const withOptions = new Set([
        "clawcode-memory",
        "clawcode-model",
        "clawcode-effort",
        "ultra-plan",
        "ultra-review",
      ]);
      const noOptionCmds = DEFAULT_SLASH_COMMANDS.filter((cmd) => !withOptions.has(cmd.name));
      expect(noOptionCmds.length).toBe(7);
      for (const cmd of noOptionCmds) {
        expect(cmd.options).toEqual([]);
      }
    });

    it("(Phase 88 UI-01) clawcode-skills-browse and clawcode-skills have empty claudeCommand and zero options", () => {
      const browse = DEFAULT_SLASH_COMMANDS.find((c) => c.name === "clawcode-skills-browse");
      const skills = DEFAULT_SLASH_COMMANDS.find((c) => c.name === "clawcode-skills");
      expect(browse).toBeDefined();
      expect(skills).toBeDefined();
      expect(browse!.claudeCommand).toBe("");
      expect(skills!.claudeCommand).toBe("");
      expect(browse!.options).toHaveLength(0);
      expect(skills!.options).toHaveLength(0);
    });

    it("the model command has one OPTIONAL option named model of type STRING (3)", () => {
      // Phase 86 MODEL-02 — `/clawcode-model` (no arg) opens the native
      // StringSelectMenuBuilder picker; `/clawcode-model <alias>` dispatches
      // directly via IPC. The option must therefore be OPTIONAL (required: false)
      // so Discord lets users invoke the command with no argument.
      const modelCmd = DEFAULT_SLASH_COMMANDS.find((cmd) => cmd.name === "clawcode-model");
      expect(modelCmd).toBeDefined();
      expect(modelCmd!.options).toHaveLength(1);

      const modelOpt = modelCmd!.options[0];
      expect(modelOpt.name).toBe("model");
      expect(modelOpt.type).toBe(3);
      expect(modelOpt.required).toBe(false);
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
    it("contains exactly 13 control commands", () => {
      // Quick task 260419-nic — grew from 5 to 7 with clawcode-interrupt +
      // clawcode-steer. Phase 85 Plan 03 added clawcode-tools → 8.
      // Phase 91 Plan 05 added clawcode-sync-status → 9.
      // Phase 92 Plan 04 added clawcode-cutover-verify → 10.
      // Phase 95 Plan 03 added clawcode-dream → 11.
      // Phase 96 Plan 05 added clawcode-probe-fs → 12.
      // Phase 103 Plan 03 added clawcode-usage → 13.
      expect(CONTROL_COMMANDS).toHaveLength(13);
    });

    it("all control commands have control: true and a valid ipcMethod", () => {
      const validMethods = [
        "start",
        "stop",
        "restart",
        "status",
        "agent-create",
        // Quick task 260419-nic — mid-turn abort + redirect.
        "interrupt-agent",
        "steer-agent",
        // Phase 85 Plan 03 TOOL-06 — /clawcode-tools reads MCP state via
        // the list-mcp-status IPC shipped in Plan 01.
        "list-mcp-status",
        // Phase 91 Plan 05 SYNC-08 — /clawcode-sync-status reads sync
        // state via list-sync-status IPC shipped in 91-05.
        "list-sync-status",
        // Phase 92 Plan 04 CUT-06 — /clawcode-cutover-verify
        "cutover-verify-summary",
        // Phase 95 Plan 03 DREAM-07 — /clawcode-dream operator-driven
        // manual dream-pass trigger via run-dream-pass IPC shipped in 95-03.
        "run-dream-pass",
        // Phase 96 Plan 05 D-03 — /clawcode-probe-fs operator-driven
        // filesystem capability probe trigger via probe-fs IPC.
        "probe-fs",
        // Phase 103 Plan 03 OBS-07 — /clawcode-usage daemon-routed
        // OAuth Max usage panel via list-rate-limit-snapshots IPC
        // (NOT rate-limit-status — see Pitfall 5).
        "list-rate-limit-snapshots",
      ];
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
