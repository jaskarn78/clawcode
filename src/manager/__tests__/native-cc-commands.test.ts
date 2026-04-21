/**
 * Phase 87 Plan 01 Task 1 — native-CC classifier + builder unit tests (RED).
 *
 * Pinned by the plan frontmatter must_haves:
 *   - classifyCommand routes `model`/`permissions`/`effort` → "control-plane"
 *   - classifyCommand routes `compact`/`context`/`cost`/`help`/`hooks` →
 *     "prompt-channel"
 *   - classifyCommand routes `clear`/`export`/`mcp` → "skip"
 *   - Safe default for unknown commands is "prompt-channel"
 *   - buildNativeCommandDefs: every entry's `.name` matches /^clawcode-/
 *   - buildNativeCommandDefs: skip-set entries produce zero output
 *   - buildNativeCommandDefs: ACL-denied names NEVER appear
 *   - buildNativeCommandDefs: nativeBehavior discriminator is populated
 *   - mergeAndDedupe: native wins on name collision
 *
 * The module under test is PURE (no imports from session-manager / daemon) so
 * this file exercises it in isolation — no DI, no mocks beyond literal
 * SlashCommand[] inputs.
 */

import { describe, it, expect } from "vitest";
import {
  classifyCommand,
  buildNativeCommandDefs,
  mergeAndDedupe,
  type CommandAcl,
} from "../native-cc-commands.js";
import type { SlashCommand } from "../sdk-types.js";
import type { SlashCommandDef } from "../../discord/slash-types.js";

const emptyAcl: CommandAcl = { denied: new Set<string>() };

function cmd(
  name: string,
  description = `Native /${name}`,
  argumentHint = "",
): SlashCommand {
  return { name, description, argumentHint };
}

describe("classifyCommand — dispatch discriminator", () => {
  it("routes `model` to control-plane", () => {
    expect(classifyCommand("model")).toBe("control-plane");
  });

  it("routes `permissions` to control-plane", () => {
    expect(classifyCommand("permissions")).toBe("control-plane");
  });

  it("routes `effort` to control-plane", () => {
    expect(classifyCommand("effort")).toBe("control-plane");
  });

  it("routes `compact` to prompt-channel", () => {
    expect(classifyCommand("compact")).toBe("prompt-channel");
  });

  it("routes `context` to prompt-channel", () => {
    expect(classifyCommand("context")).toBe("prompt-channel");
  });

  it("routes `cost` to prompt-channel", () => {
    expect(classifyCommand("cost")).toBe("prompt-channel");
  });

  it("routes `help` to prompt-channel", () => {
    expect(classifyCommand("help")).toBe("prompt-channel");
  });

  it("routes `hooks` to prompt-channel", () => {
    expect(classifyCommand("hooks")).toBe("prompt-channel");
  });

  it("routes `clear` to skip (CMD-00 spike: not SDK-dispatchable)", () => {
    expect(classifyCommand("clear")).toBe("skip");
  });

  it("routes `export` to skip (CMD-00 spike: not SDK-dispatchable)", () => {
    expect(classifyCommand("export")).toBe("skip");
  });

  it("routes `mcp` to skip (Pitfall 12 — covered by /clawcode-tools)", () => {
    expect(classifyCommand("mcp")).toBe("skip");
  });

  it("routes unknown future commands to prompt-channel (safe default)", () => {
    expect(classifyCommand("unknown-future-cmd")).toBe("prompt-channel");
  });

  it("routes empty string to prompt-channel (safe default)", () => {
    expect(classifyCommand("")).toBe("prompt-channel");
  });
});

describe("buildNativeCommandDefs — classifier-driven SlashCommandDef[] construction", () => {
  it("skips SKIP-set entries and emits only non-skip commands", () => {
    const input: readonly SlashCommand[] = [
      cmd("compact", "X"),
      cmd("export", "Y"),
    ];
    const out = buildNativeCommandDefs(input, emptyAcl);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("clawcode-compact");
  });

  it("prefixes EVERY returned name with `clawcode-`", () => {
    const input: readonly SlashCommand[] = [
      cmd("compact"),
      cmd("model"),
      cmd("hooks"),
      cmd("help"),
      cmd("context"),
    ];
    const out = buildNativeCommandDefs(input, emptyAcl);
    // Every returned entry respects the namespace pin (Pitfall 10).
    for (const entry of out) {
      expect(entry.name).toMatch(/^clawcode-/);
    }
    expect(out.length).toBe(input.length);
  });

  it("tags control-plane entries with nativeBehavior:'control-plane'", () => {
    const out = buildNativeCommandDefs([cmd("model")], emptyAcl);
    expect(out).toHaveLength(1);
    expect(out[0].nativeBehavior).toBe("control-plane");
  });

  it("tags prompt-channel entries with nativeBehavior:'prompt-channel'", () => {
    const out = buildNativeCommandDefs([cmd("compact")], emptyAcl);
    expect(out).toHaveLength(1);
    expect(out[0].nativeBehavior).toBe("prompt-channel");
  });

  it("filters out ACL-denied names BEFORE classification (init/security-review/batch)", () => {
    const input: readonly SlashCommand[] = [
      cmd("init"),
      cmd("security-review"),
      cmd("batch"),
      cmd("compact"),
    ];
    const acl: CommandAcl = {
      denied: new Set(["init", "security-review", "batch"]),
    };
    const out = buildNativeCommandDefs(input, acl);
    const names = out.map((c) => c.name);
    expect(names).not.toContain("clawcode-init");
    expect(names).not.toContain("clawcode-security-review");
    expect(names).not.toContain("clawcode-batch");
    expect(names).toContain("clawcode-compact");
  });

  it("with empty ACL, all non-skip commands pass through", () => {
    const input: readonly SlashCommand[] = [
      cmd("init"),
      cmd("compact"),
      cmd("model"),
    ];
    const out = buildNativeCommandDefs(input, emptyAcl);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.name).sort()).toEqual([
      "clawcode-compact",
      "clawcode-init",
      "clawcode-model",
    ]);
  });

  it("forwards description and description-fallback is non-empty", () => {
    // Empty SDK description should fall back to "Native /{name}" so Discord
    // never receives a zero-length description (API rejects that).
    const out = buildNativeCommandDefs([cmd("compact", "")], emptyAcl);
    expect(out[0].description.length).toBeGreaterThan(0);
  });

  it("truncates description at 100 characters (Discord limit)", () => {
    const longDesc = "x".repeat(250);
    const out = buildNativeCommandDefs([cmd("compact", longDesc)], emptyAcl);
    expect(out[0].description.length).toBeLessThanOrEqual(100);
  });

  it("emits an `args` STRING option when argumentHint is present", () => {
    const out = buildNativeCommandDefs(
      [cmd("compact", "Compact", "<summary-style>")],
      emptyAcl,
    );
    expect(out[0].options).toHaveLength(1);
    expect(out[0].options[0].name).toBe("args");
    expect(out[0].options[0].type).toBe(3);
    expect(out[0].options[0].required).toBe(false);
  });

  it("emits zero options when argumentHint is empty", () => {
    const out = buildNativeCommandDefs([cmd("compact", "Compact", "")], emptyAcl);
    expect(out[0].options).toEqual([]);
  });

  it("returns an empty array when given an empty SDK command list", () => {
    const out = buildNativeCommandDefs([], emptyAcl);
    expect(out).toEqual([]);
  });

  it("handles mixed skip + control-plane + prompt-channel + denied", () => {
    const input: readonly SlashCommand[] = [
      cmd("clear"),    // skip
      cmd("export"),   // skip
      cmd("mcp"),      // skip
      cmd("model"),    // control-plane
      cmd("compact"),  // prompt-channel
      cmd("init"),     // denied by ACL
      cmd("help"),     // prompt-channel
    ];
    const acl: CommandAcl = { denied: new Set(["init"]) };
    const out = buildNativeCommandDefs(input, acl);
    const names = out.map((c) => c.name).sort();
    expect(names).toEqual([
      "clawcode-compact",
      "clawcode-help",
      "clawcode-model",
    ]);
  });
});

describe("mergeAndDedupe — existing + native merge, native wins", () => {
  it("preserves unique entries from both sides", () => {
    const existing: readonly SlashCommandDef[] = [
      {
        name: "clawcode-fleet",
        description: "Fleet",
        claudeCommand: "",
        options: [],
        control: true,
      },
    ];
    const native: readonly SlashCommandDef[] = [
      {
        name: "clawcode-compact",
        description: "Compact",
        claudeCommand: "",
        options: [],
        nativeBehavior: "prompt-channel",
      },
    ];
    const merged = mergeAndDedupe(existing, native);
    expect(merged).toHaveLength(2);
    expect(merged.map((c) => c.name).sort()).toEqual([
      "clawcode-compact",
      "clawcode-fleet",
    ]);
  });

  it("native wins on name collision (preserves nativeBehavior discriminator)", () => {
    const existing: readonly SlashCommandDef[] = [
      {
        name: "clawcode-compact",
        description: "Old LLM-prompt version",
        claudeCommand: "Trigger context compaction now",
        options: [],
      },
    ];
    const native: readonly SlashCommandDef[] = [
      {
        name: "clawcode-compact",
        description: "Native compact",
        claudeCommand: "",
        options: [],
        nativeBehavior: "prompt-channel",
      },
    ];
    const merged = mergeAndDedupe(existing, native);
    expect(merged).toHaveLength(1);
    expect(merged[0].nativeBehavior).toBe("prompt-channel");
    expect(merged[0].description).toBe("Native compact");
    expect(merged[0].claudeCommand).toBe("");
  });

  it("returns an empty array when both inputs are empty", () => {
    expect(mergeAndDedupe([], [])).toEqual([]);
  });

  it("returns existing as-is when native is empty", () => {
    const existing: readonly SlashCommandDef[] = [
      {
        name: "clawcode-status",
        description: "Status",
        claudeCommand: "Report status",
        options: [],
      },
    ];
    const merged = mergeAndDedupe(existing, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("clawcode-status");
  });

  it("returns native as-is when existing is empty", () => {
    const native: readonly SlashCommandDef[] = [
      {
        name: "clawcode-compact",
        description: "Compact",
        claudeCommand: "",
        options: [],
        nativeBehavior: "prompt-channel",
      },
    ];
    const merged = mergeAndDedupe([], native);
    expect(merged).toHaveLength(1);
    expect(merged[0].nativeBehavior).toBe("prompt-channel");
  });

  it("preserves insertion order (existing first, then unique native)", () => {
    const existing: readonly SlashCommandDef[] = [
      {
        name: "clawcode-fleet",
        description: "",
        claudeCommand: "",
        options: [],
      },
      {
        name: "clawcode-status",
        description: "",
        claudeCommand: "",
        options: [],
      },
    ];
    const native: readonly SlashCommandDef[] = [
      {
        name: "clawcode-compact",
        description: "",
        claudeCommand: "",
        options: [],
        nativeBehavior: "prompt-channel",
      },
    ];
    const merged = mergeAndDedupe(existing, native);
    expect(merged.map((c) => c.name)).toEqual([
      "clawcode-fleet",
      "clawcode-status",
      "clawcode-compact",
    ]);
  });
});
