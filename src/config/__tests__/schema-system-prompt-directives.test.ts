/**
 * Phase 94 Plan 06 — TOOL-10 / D-10 / D-09 / D-07
 *
 * Schema + resolver tests for `defaults.systemPromptDirectives` — the new
 * additive-optional config field that ships two default-shipped directives
 * (file-sharing, cross-agent-routing) plus a per-agent override merge.
 *
 * 8th application of the Phase 83/86/89/90/92 additive-optional schema
 * blueprint — v2.5 migrated configs without `systemPromptDirectives` MUST
 * parse unchanged (regression-pinned by REG-V25-BACKCOMPAT).
 *
 * Static-grep regression pins (DO NOT remove):
 *   - "ALWAYS upload via Discord" — D-09 file-sharing verbatim
 *   - "suggest the user ask another agent" — D-07 cross-agent-routing verbatim
 *   - "REG-V25-BACKCOMPAT" — additive-optional invariant marker
 *   - "REG-OVERRIDE-PARTIAL" — partial-override merge invariant marker
 */
import { describe, it, expect } from "vitest";
import {
  agentSchema,
  defaultsSchema,
  systemPromptDirectiveSchema,
  DEFAULT_SYSTEM_PROMPT_DIRECTIVES,
  type SystemPromptDirective,
} from "../schema.js";
import { resolveSystemPromptDirectives } from "../loader.js";

describe("systemPromptDirectiveSchema (Phase 94 TOOL-10)", () => {
  it("TOOL-10-S0: shape is { enabled: boolean, text: string }", () => {
    const ok = systemPromptDirectiveSchema.safeParse({
      enabled: true,
      text: "hello",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.enabled).toBe(true);
      expect(ok.data.text).toBe("hello");
    }
  });
});

describe("DEFAULT_SYSTEM_PROMPT_DIRECTIVES (Phase 94 D-09 + D-07)", () => {
  it("REG-DEFAULTS-PRESENT: ships exactly 2 default keys (file-sharing + cross-agent-routing)", () => {
    const keys = Object.keys(DEFAULT_SYSTEM_PROMPT_DIRECTIVES).sort();
    expect(keys).toEqual(["cross-agent-routing", "file-sharing"]);
    // Both default-enabled per D-10 (operator-locked)
    expect(DEFAULT_SYSTEM_PROMPT_DIRECTIVES["file-sharing"].enabled).toBe(true);
    expect(DEFAULT_SYSTEM_PROMPT_DIRECTIVES["cross-agent-routing"].enabled).toBe(true);
    // D-09 file-sharing verbatim text contract
    expect(DEFAULT_SYSTEM_PROMPT_DIRECTIVES["file-sharing"].text).toContain(
      "ALWAYS upload via Discord",
    );
    expect(DEFAULT_SYSTEM_PROMPT_DIRECTIVES["file-sharing"].text).toContain(
      "NEVER just tell the user a local file path",
    );
    // D-07 cross-agent-routing verbatim text contract
    expect(DEFAULT_SYSTEM_PROMPT_DIRECTIVES["cross-agent-routing"].text).toContain(
      "suggest the user ask another agent",
    );
  });
});

describe("defaultsSchema.systemPromptDirectives (Phase 94 D-10)", () => {
  it("REG-V25-BACKCOMPAT: defaultsSchema.parse({}) populates systemPromptDirectives with the defaults (additive-optional, 8th application)", () => {
    const result = defaultsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      // Default-bearing: legacy v2.5 migrated configs without
      // systemPromptDirectives MUST resolve to a concrete record matching
      // DEFAULT_SYSTEM_PROMPT_DIRECTIVES exactly (REG-V25-BACKCOMPAT pin).
      expect(result.data.systemPromptDirectives).toBeDefined();
      expect(
        Object.keys(result.data.systemPromptDirectives ?? {}).sort(),
      ).toEqual(["cross-agent-routing", "file-sharing"]);
      expect(
        result.data.systemPromptDirectives?.["file-sharing"].text,
      ).toContain("ALWAYS upload via Discord");
      expect(
        result.data.systemPromptDirectives?.["cross-agent-routing"].text,
      ).toContain("suggest the user ask another agent");
    }
  });

  it("REG-OVERRIDE-DEFAULTS: defaultsSchema accepts explicit systemPromptDirectives override", () => {
    const result = defaultsSchema.safeParse({
      systemPromptDirectives: {
        "custom-rule": { enabled: true, text: "Be terse." },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        result.data.systemPromptDirectives?.["custom-rule"]?.text,
      ).toBe("Be terse.");
    }
  });
});

describe("agentSchema.systemPromptDirectives (Phase 94 D-10 per-agent override)", () => {
  it("agentSchema.parse({name:'x'}) leaves systemPromptDirectives undefined (optional)", () => {
    const result = agentSchema.safeParse({ name: "x" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.systemPromptDirectives).toBeUndefined();
    }
  });

  it("REG-OVERRIDE-PARTIAL: agentSchema accepts a partial directive override (only enabled set)", () => {
    const result = agentSchema.safeParse({
      name: "x",
      systemPromptDirectives: {
        "file-sharing": { enabled: false },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        result.data.systemPromptDirectives?.["file-sharing"]?.enabled,
      ).toBe(false);
      // Partial: text is optional in override shape
      expect(
        result.data.systemPromptDirectives?.["file-sharing"]?.text,
      ).toBeUndefined();
    }
  });

  it("REG-MALFORMED-REJECTED: agentSchema rejects malformed directive (enabled is not boolean)", () => {
    const result = agentSchema.safeParse({
      name: "x",
      systemPromptDirectives: {
        "file-sharing": { enabled: "not-a-bool" },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("resolveSystemPromptDirectives (Phase 94 D-10 per-key merge)", () => {
  const defaults: Record<string, SystemPromptDirective> = {
    "file-sharing": {
      enabled: true,
      text: "ALWAYS upload via Discord and return the CDN URL.",
    },
    "cross-agent-routing": {
      enabled: true,
      text: "suggest the user ask another agent in another channel.",
    },
  };

  it("REG-OVERRIDE-PARTIAL: agent override file-sharing.enabled=false drops file-sharing but keeps cross-agent-routing (inherits default)", () => {
    const out = resolveSystemPromptDirectives(
      { "file-sharing": { enabled: false } },
      defaults,
    );
    const keys = out.map((d) => d.key);
    expect(keys).not.toContain("file-sharing");
    expect(keys).toContain("cross-agent-routing");
  });

  it("REG-OVERRIDE-TEXT: agent override changes text but keeps enabled (inherited)", () => {
    const out = resolveSystemPromptDirectives(
      { "file-sharing": { text: "Custom directive." } },
      defaults,
    );
    const fileSharing = out.find((d) => d.key === "file-sharing");
    expect(fileSharing).toBeDefined();
    expect(fileSharing?.text).toBe("Custom directive.");
  });

  it("REG-OVERRIDE-NEW-DIRECTIVE: agent override adds a new directive on top of defaults (sorted alpha)", () => {
    const out = resolveSystemPromptDirectives(
      { "custom-rule": { enabled: true, text: "Be terse." } },
      defaults,
    );
    const keys = out.map((d) => d.key);
    // Three directives total, sorted alphabetically for cache stability
    expect(keys).toEqual(["cross-agent-routing", "custom-rule", "file-sharing"]);
  });

  it("REG-DETERMINISTIC: same input → byte-identical sorted output", () => {
    const out1 = resolveSystemPromptDirectives(undefined, defaults);
    const out2 = resolveSystemPromptDirectives(undefined, defaults);
    expect(out1.map((d) => d.key)).toEqual(out2.map((d) => d.key));
    expect(out1.map((d) => d.text)).toEqual(out2.map((d) => d.text));
    // Sort order MUST be alphabetical by key (deterministic for prompt-cache hash)
    const keys = out1.map((d) => d.key);
    expect(keys).toEqual([...keys].sort());
  });
});
