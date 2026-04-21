/**
 * Phase 83 Plan 03 Task 1 (RED→GREEN) — UI-01 StringChoices for /clawcode-effort.
 *
 * Locks:
 *   (a) DEFAULT_SLASH_COMMANDS.clawcode-effort.options[0].choices is a 7-entry
 *       tuple of `{ name, value }` pairs covering the full v2.2 EffortLevel set
 *       (low|medium|high|xhigh|max|auto|off). This is what forces Discord to
 *       render a dropdown (no free-text typing possible).
 *   (b) EFFORT_CHOICES is exported so other code (schema validation, registration
 *       body, tests) can reuse the canonical list.
 *   (c) slashCommandOptionSchema accepts an optional `choices` field and
 *       remains back-compat (existing option configs without choices still
 *       parse).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_SLASH_COMMANDS,
  EFFORT_CHOICES,
} from "../slash-types.js";
import { slashCommandOptionSchema } from "../../config/schema.js";

describe("Phase 83 UI-01 — EFFORT_CHOICES tuple", () => {
  it("exports a 7-entry tuple covering every EffortLevel", () => {
    expect(EFFORT_CHOICES).toHaveLength(7);
    const values = EFFORT_CHOICES.map((c) => c.value);
    expect(values).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto",
      "off",
    ]);
  });

  it("each entry has the literal display name expected by the plan", () => {
    // Lock the display strings verbatim — these are what Discord shows users in
    // the dropdown. Changing these is a user-facing UI change.
    const byValue = new Map(
      EFFORT_CHOICES.map((c) => [c.value, c.name] as const),
    );
    expect(byValue.get("low")).toBe("low (fastest)");
    expect(byValue.get("medium")).toBe("medium");
    expect(byValue.get("high")).toBe("high");
    expect(byValue.get("xhigh")).toBe("xhigh");
    expect(byValue.get("max")).toBe("max (deepest)");
    expect(byValue.get("auto")).toBe("auto (model default)");
    expect(byValue.get("off")).toBe("off (disabled)");
  });
});

describe("Phase 83 UI-01 — clawcode-effort option carries choices", () => {
  it("has options[0].choices identical to EFFORT_CHOICES", () => {
    const effortCmd = DEFAULT_SLASH_COMMANDS.find(
      (c) => c.name === "clawcode-effort",
    );
    expect(effortCmd).toBeDefined();
    expect(effortCmd!.options).toHaveLength(1);
    const levelOpt = effortCmd!.options[0];
    expect(levelOpt.name).toBe("level");
    expect(levelOpt.type).toBe(3); // STRING
    expect(levelOpt.required).toBe(true);
    // The choices list must be present and match EFFORT_CHOICES entry-for-entry.
    expect(levelOpt.choices).toBeDefined();
    expect(levelOpt.choices).toHaveLength(7);
    for (let i = 0; i < EFFORT_CHOICES.length; i++) {
      expect(levelOpt.choices![i].name).toBe(EFFORT_CHOICES[i].name);
      expect(levelOpt.choices![i].value).toBe(EFFORT_CHOICES[i].value);
    }
  });

  it("no OTHER default command has a choices field (scoped change)", () => {
    for (const cmd of DEFAULT_SLASH_COMMANDS) {
      if (cmd.name === "clawcode-effort") continue;
      for (const opt of cmd.options) {
        expect(opt.choices).toBeUndefined();
      }
    }
  });
});

describe("Phase 83 UI-01 — slashCommandOptionSchema accepts choices", () => {
  it("parses an option WITH a valid choices array", () => {
    const parsed = slashCommandOptionSchema.parse({
      name: "level",
      type: 3,
      description: "pick one",
      required: true,
      choices: [
        { name: "low (fastest)", value: "low" },
        { name: "max (deepest)", value: "max" },
      ],
    });
    expect(parsed.choices).toBeDefined();
    expect(parsed.choices).toHaveLength(2);
    expect(parsed.choices![0].value).toBe("low");
  });

  it("still parses an option WITHOUT choices (back-compat)", () => {
    const parsed = slashCommandOptionSchema.parse({
      name: "query",
      type: 3,
      description: "what to search",
      required: true,
    });
    // choices should be undefined (not present) after parse.
    expect(parsed.choices).toBeUndefined();
  });

  it("rejects a choices entry with empty name or value", () => {
    expect(() =>
      slashCommandOptionSchema.parse({
        name: "level",
        type: 3,
        description: "x",
        required: true,
        choices: [{ name: "", value: "low" }],
      }),
    ).toThrow();
    expect(() =>
      slashCommandOptionSchema.parse({
        name: "level",
        type: 3,
        description: "x",
        required: true,
        choices: [{ name: "low", value: "" }],
      }),
    ).toThrow();
  });

  it("rejects a choices array longer than 25 (Discord cap)", () => {
    const tooMany = Array.from({ length: 26 }, (_, i) => ({
      name: `c${i}`,
      value: `v${i}`,
    }));
    expect(() =>
      slashCommandOptionSchema.parse({
        name: "x",
        type: 3,
        description: "y",
        required: true,
        choices: tooMany,
      }),
    ).toThrow();
  });
});
