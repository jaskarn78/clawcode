/**
 * Phase 100 follow-up — GSD_SLASH_COMMANDS constant tests.
 *
 * The Phase 100 plan shipped 5 GSD slash commands inlined per-agent in the
 * yaml. The follow-up moves them to a shared `GSD_SLASH_COMMANDS` constant in
 * slash-types.ts so any agent with `gsd.projectDir` configured auto-inherits
 * them — no per-agent yaml duplication. The constant adds 14 more commands
 * (operator-curated subset of the ~57 GSD skills in ~/.claude/commands/gsd/)
 * + the runtime project switcher (gsd-set-project, handled inline).
 *
 * Pins (GS1 + structural / shape):
 *   GS1a — GSD_SLASH_COMMANDS exported with exactly 19 entries
 *   GS1b — Each entry has the SlashCommandDef shape (name, description,
 *          claudeCommand, options array)
 *   GS1c — All 5 originally shipped Phase 100 names are present (back-compat
 *          for the 5 yaml entries which still get deduped via seenNames)
 *   GS1d — All 14 new operator-friction names are present
 *   GS1e — gsd-set-project is present with an empty claudeCommand (inline-
 *          handled, no LLM-prompt routing)
 *   GS1f — Every name matches /^gsd-/ (namespace guard mirroring slash-types
 *          Pitfall 10 for clawcode- prefix)
 *   GS1g — Every option has the SlashCommandOption shape (name, type,
 *          description, required) and `type` is the Discord STRING enum (3)
 *   GS1h — gsd-set-project's only option is `path`, required, type=3
 */
import { describe, it, expect } from "vitest";
import { GSD_SLASH_COMMANDS } from "../slash-types.js";

describe("Phase 100 follow-up — GSD_SLASH_COMMANDS constant", () => {
  it("GS1a — exports exactly 19 entries", () => {
    expect(GSD_SLASH_COMMANDS).toHaveLength(19);
  });

  it("GS1b — each entry has SlashCommandDef shape (name, description, claudeCommand, options)", () => {
    for (const cmd of GSD_SLASH_COMMANDS) {
      expect(typeof cmd.name).toBe("string");
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.description).toBe("string");
      expect(cmd.description.length).toBeGreaterThan(0);
      expect(typeof cmd.claudeCommand).toBe("string"); // may be empty for inline (gsd-set-project)
      expect(Array.isArray(cmd.options)).toBe(true);
    }
  });

  it("GS1c — all 5 originally-shipped Phase 100 names are present", () => {
    const names = GSD_SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain("gsd-autonomous");
    expect(names).toContain("gsd-plan-phase");
    expect(names).toContain("gsd-execute-phase");
    expect(names).toContain("gsd-debug");
    expect(names).toContain("gsd-quick");
  });

  it("GS1d — all 14 new operator-friction names are present", () => {
    const names = GSD_SLASH_COMMANDS.map((c) => c.name);
    // Project / milestone / phase scaffolding (the friction catalysts)
    expect(names).toContain("gsd-new-project");
    expect(names).toContain("gsd-new-milestone");
    expect(names).toContain("gsd-add-phase");
    expect(names).toContain("gsd-add-tests");
    // Audit / completion / cleanup
    expect(names).toContain("gsd-audit-milestone");
    expect(names).toContain("gsd-complete-milestone");
    expect(names).toContain("gsd-cleanup");
    // Progress / verify / discuss
    expect(names).toContain("gsd-progress");
    expect(names).toContain("gsd-verify-work");
    expect(names).toContain("gsd-discuss-phase");
    // Quick / fast / do / help
    expect(names).toContain("gsd-do");
    expect(names).toContain("gsd-fast");
    expect(names).toContain("gsd-help");
    // Runtime project switcher (inline-handled)
    expect(names).toContain("gsd-set-project");
  });

  it("GS1e — gsd-set-project has empty claudeCommand (inline handler short-circuit)", () => {
    const setProj = GSD_SLASH_COMMANDS.find((c) => c.name === "gsd-set-project");
    expect(setProj).toBeDefined();
    expect(setProj!.claudeCommand).toBe("");
  });

  it("GS1f — every name matches /^gsd-/ (namespace guard)", () => {
    for (const cmd of GSD_SLASH_COMMANDS) {
      expect(cmd.name).toMatch(/^gsd-/);
    }
  });

  it("GS1g — every option is { name, type=3, description, required }", () => {
    for (const cmd of GSD_SLASH_COMMANDS) {
      for (const opt of cmd.options) {
        expect(typeof opt.name).toBe("string");
        expect(opt.name.length).toBeGreaterThan(0);
        // 3 = Discord ApplicationCommandOptionType.STRING
        expect(opt.type).toBe(3);
        expect(typeof opt.description).toBe("string");
        expect(typeof opt.required).toBe("boolean");
      }
    }
  });

  it("GS1h — gsd-set-project has exactly one required `path` option (type=3)", () => {
    const setProj = GSD_SLASH_COMMANDS.find((c) => c.name === "gsd-set-project");
    expect(setProj).toBeDefined();
    expect(setProj!.options).toHaveLength(1);
    const pathOpt = setProj!.options[0]!;
    expect(pathOpt.name).toBe("path");
    expect(pathOpt.type).toBe(3);
    expect(pathOpt.required).toBe(true);
  });

  it("GS1i — gsd-autonomous keeps its `args` option (back-compat with Phase 100 yaml)", () => {
    const auto = GSD_SLASH_COMMANDS.find((c) => c.name === "gsd-autonomous");
    expect(auto).toBeDefined();
    expect(auto!.claudeCommand).toBe("/gsd:autonomous {args}");
    const args = auto!.options.find((o) => o.name === "args");
    expect(args).toBeDefined();
    expect(args!.required).toBe(false);
  });

  it("GS1j — gsd-debug keeps its required `issue` option", () => {
    const dbg = GSD_SLASH_COMMANDS.find((c) => c.name === "gsd-debug");
    expect(dbg).toBeDefined();
    expect(dbg!.claudeCommand).toBe("/gsd:debug {issue}");
    const issue = dbg!.options.find((o) => o.name === "issue");
    expect(issue).toBeDefined();
    expect(issue!.required).toBe(true);
  });
});
