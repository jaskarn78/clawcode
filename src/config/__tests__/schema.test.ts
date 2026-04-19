import { describe, it, expect } from "vitest";
import { agentSchema, browserConfigSchema, configSchema, defaultsSchema, mcpServerSchema, openaiEndpointSchema, streamingConfigSchema } from "../schema.js";
import { conversationConfigSchema } from "../../memory/schema.js";

describe("mcpServerSchema", () => {
  it("validates a complete MCP server config", () => {
    const result = mcpServerSchema.safeParse({
      name: "finnhub",
      command: "npx",
      args: ["-y", "finnhub-mcp"],
      env: { API_KEY: "xxx" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("finnhub");
      expect(result.data.command).toBe("npx");
      expect(result.data.args).toEqual(["-y", "finnhub-mcp"]);
      expect(result.data.env).toEqual({ API_KEY: "xxx" });
    }
  });

  it("applies default empty arrays/objects for args and env", () => {
    const result = mcpServerSchema.safeParse({
      name: "simple",
      command: "my-server",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.args).toEqual([]);
      expect(result.data.env).toEqual({});
    }
  });

  it("rejects missing name", () => {
    const result = mcpServerSchema.safeParse({
      command: "npx",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing command", () => {
    const result = mcpServerSchema.safeParse({
      name: "finnhub",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name string", () => {
    const result = mcpServerSchema.safeParse({
      name: "",
      command: "npx",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty command string", () => {
    const result = mcpServerSchema.safeParse({
      name: "test",
      command: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("configSchema - mcpServers", () => {
  it("accepts top-level shared mcpServers definitions", () => {
    const result = configSchema.safeParse({
      version: 1,
      mcpServers: {
        finnhub: { name: "finnhub", command: "npx", args: ["-y", "finnhub-mcp"], env: { API_KEY: "xxx" } },
      },
      agents: [{ name: "test" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toBeDefined();
      expect(result.data.mcpServers["finnhub"]).toBeDefined();
      expect(result.data.mcpServers["finnhub"].command).toBe("npx");
    }
  });

  it("defaults mcpServers to empty object when omitted", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [{ name: "test" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toEqual({});
    }
  });

  it("accepts per-agent inline mcpServers objects", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [{
        name: "test",
        mcpServers: [{ name: "finnhub", command: "npx", args: ["-y", "finnhub-mcp"] }],
      }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0].mcpServers).toHaveLength(1);
    }
  });

  it("accepts per-agent string references in mcpServers", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [{
        name: "test",
        mcpServers: ["finnhub"],
      }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0].mcpServers).toEqual(["finnhub"]);
    }
  });

  it("accepts mixed inline and string references in per-agent mcpServers", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [{
        name: "test",
        mcpServers: [
          "finnhub",
          { name: "custom", command: "my-server" },
        ],
      }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0].mcpServers).toHaveLength(2);
    }
  });

  it("defaults per-agent mcpServers to empty array when omitted", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [{ name: "test" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0].mcpServers).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 70 — browser automation config schema
// ---------------------------------------------------------------------------

describe("browserConfigSchema", () => {
  it("parses with all defaults when block omitted (undefined input)", () => {
    const result = browserConfigSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.headless).toBe(true);
      expect(result.data.warmOnBoot).toBe(true);
      expect(result.data.navigationTimeoutMs).toBe(30000);
      expect(result.data.actionTimeoutMs).toBe(10000);
      expect(result.data.viewport).toEqual({ width: 1280, height: 720 });
      expect(result.data.userAgent).toBeNull();
      expect(result.data.maxScreenshotInlineBytes).toBe(524288);
    }
  });

  it("parses an empty object as all defaults", () => {
    const result = browserConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.headless).toBe(true);
      expect(result.data.maxScreenshotInlineBytes).toBe(524288);
    }
  });

  it("parses with partial overrides (headless=false preserved, others default)", () => {
    const result = browserConfigSchema.safeParse({ headless: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headless).toBe(false);
      expect(result.data.enabled).toBe(true);
      expect(result.data.navigationTimeoutMs).toBe(30000);
      expect(result.data.viewport).toEqual({ width: 1280, height: 720 });
    }
  });

  it("rejects navigationTimeoutMs=0", () => {
    const result = browserConfigSchema.safeParse({ navigationTimeoutMs: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative actionTimeoutMs", () => {
    const result = browserConfigSchema.safeParse({ actionTimeoutMs: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects navigationTimeoutMs over 10-minute ceiling", () => {
    const result = browserConfigSchema.safeParse({ navigationTimeoutMs: 600001 });
    expect(result.success).toBe(false);
  });

  it("rejects viewport width=0", () => {
    const result = browserConfigSchema.safeParse({ viewport: { width: 0, height: 720 } });
    expect(result.success).toBe(false);
  });

  it("rejects viewport height under 240", () => {
    const result = browserConfigSchema.safeParse({ viewport: { width: 1280, height: 239 } });
    expect(result.success).toBe(false);
  });

  it("rejects maxScreenshotInlineBytes > 5 MiB", () => {
    const result = browserConfigSchema.safeParse({ maxScreenshotInlineBytes: 6291456 });
    expect(result.success).toBe(false);
  });

  it("accepts maxScreenshotInlineBytes = 0 (never inline)", () => {
    const result = browserConfigSchema.safeParse({ maxScreenshotInlineBytes: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxScreenshotInlineBytes).toBe(0);
    }
  });

  it("accepts userAgent null", () => {
    const result = browserConfigSchema.safeParse({ userAgent: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userAgent).toBeNull();
    }
  });

  it("accepts userAgent custom string", () => {
    const result = browserConfigSchema.safeParse({ userAgent: "ClawcodeBot/1.0" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userAgent).toBe("ClawcodeBot/1.0");
    }
  });

  it("accepts custom viewport within bounds", () => {
    const result = browserConfigSchema.safeParse({ viewport: { width: 1920, height: 1080 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.viewport).toEqual({ width: 1920, height: 1080 });
    }
  });
});

describe("configSchema - defaults.browser wiring", () => {
  it("parses config without defaults.browser and applies browser defaults", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [{ name: "test" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults.browser).toBeDefined();
      expect(result.data.defaults.browser.enabled).toBe(true);
      expect(result.data.defaults.browser.headless).toBe(true);
      expect(result.data.defaults.browser.navigationTimeoutMs).toBe(30000);
    }
  });

  it("parses config with explicit defaults.browser block", () => {
    const result = configSchema.safeParse({
      version: 1,
      defaults: {
        browser: {
          enabled: false,
          headless: false,
          navigationTimeoutMs: 45000,
          viewport: { width: 1920, height: 1080 },
        },
      },
      agents: [{ name: "test" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults.browser.enabled).toBe(false);
      expect(result.data.defaults.browser.headless).toBe(false);
      expect(result.data.defaults.browser.navigationTimeoutMs).toBe(45000);
      expect(result.data.defaults.browser.viewport).toEqual({ width: 1920, height: 1080 });
      // Unspecified fields should fall back to defaults.
      expect(result.data.defaults.browser.warmOnBoot).toBe(true);
      expect(result.data.defaults.browser.actionTimeoutMs).toBe(10000);
    }
  });

  it("rejects defaults.browser with invalid viewport", () => {
    const result = configSchema.safeParse({
      version: 1,
      defaults: {
        browser: { viewport: { width: 10, height: 720 } },
      },
      agents: [{ name: "test" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("configSchema", () => {
  const validConfig = {
    version: 1,
    agents: [
      {
        name: "researcher",
        channels: ["1234567890123456"],
        model: "opus",
        skills: ["market-research"],
      },
    ],
  };

  it("parses a valid config with all fields", () => {
    const result = configSchema.safeParse({
      version: 1,
      defaults: {
        model: "sonnet",
        skills: ["search-first"],
        basePath: "~/.clawcode/agents",
      },
      agents: [
        {
          name: "researcher",
          channels: ["1234567890123456"],
          model: "opus",
          skills: ["market-research"],
          soul: "Be helpful",
          identity: "I am researcher",
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.defaults.model).toBe("sonnet");
      expect(result.data.agents[0].name).toBe("researcher");
      expect(result.data.agents[0].model).toBe("opus");
    }
  });

  it("applies default values when defaults section is omitted", () => {
    const result = configSchema.safeParse(validConfig);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults.model).toBe("haiku");
      expect(result.data.defaults.skills).toEqual([]);
      expect(result.data.defaults.basePath).toBe("~/.clawcode/agents");
    }
  });

  it("applies default empty arrays for agent channels and skills", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [{ name: "minimal" }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0].channels).toEqual([]);
      expect(result.data.agents[0].skills).toEqual([]);
    }
  });

  it("rejects config with missing version field", () => {
    const result = configSchema.safeParse({
      agents: [{ name: "test" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects config with wrong version number", () => {
    const result = configSchema.safeParse({
      version: 2,
      agents: [{ name: "test" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects config with empty agents array", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects agent with empty name string", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [{ name: "" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid model value", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [{ name: "test", model: "gpt4" }],
    });

    expect(result.success).toBe(false);
  });

  it("enforces channel IDs as strings (not numbers)", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [{ name: "test", channels: [1234567890] }],
    });

    expect(result.success).toBe(false);
  });
});

describe("agentSchema perf.slos override", () => {
  it("accepts a perf.slos array with a single canonical-segment override", () => {
    const result = agentSchema.safeParse({
      name: "x",
      perf: {
        slos: [{ segment: "end_to_end", metric: "p95", thresholdMs: 5000 }],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.perf?.slos).toHaveLength(1);
      expect(result.data.perf?.slos?.[0]).toEqual({
        segment: "end_to_end",
        metric: "p95",
        thresholdMs: 5000,
      });
    }
  });

  it("rejects a perf.slos override using a non-canonical segment name", () => {
    const result = agentSchema.safeParse({
      name: "x",
      perf: {
        slos: [{ segment: "garbage", metric: "p95", thresholdMs: 5000 }],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      // Zod enum issues mention the invalid value or expected options
      expect(messages.toLowerCase()).toMatch(/garbage|end_to_end|enum|invalid/);
    }
  });

  it("accepts perf.traceRetentionDays alongside perf.slos (additive, no field collision)", () => {
    const result = agentSchema.safeParse({
      name: "x",
      perf: {
        traceRetentionDays: 14,
        slos: [
          { segment: "first_token", metric: "p50", thresholdMs: 1500 },
          { segment: "tool_call", metric: "p99", thresholdMs: 4000 },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.perf?.traceRetentionDays).toBe(14);
      expect(result.data.perf?.slos).toHaveLength(2);
    }
  });

  it("accepts perf.slos on the defaults schema (fleet-wide override path)", () => {
    const result = defaultsSchema.safeParse({
      perf: {
        traceRetentionDays: 30,
        slos: [
          { segment: "context_assemble", metric: "p95", thresholdMs: 250 },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.perf?.slos?.[0]?.thresholdMs).toBe(250);
    }
  });
});

describe("agentSchema perf.memoryAssemblyBudgets override (Phase 53)", () => {
  it("accepts a valid memoryAssemblyBudgets object with partial sections", () => {
    const result = agentSchema.safeParse({
      name: "x",
      perf: {
        memoryAssemblyBudgets: {
          identity: 500,
          hot_tier: 1500,
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.perf?.memoryAssemblyBudgets?.identity).toBe(500);
      expect(result.data.perf?.memoryAssemblyBudgets?.hot_tier).toBe(1500);
    }
  });

  it("rejects negative memoryAssemblyBudgets values", () => {
    const result = agentSchema.safeParse({
      name: "x",
      perf: {
        memoryAssemblyBudgets: { identity: -1 },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("agentSchema perf.lazySkills override (Phase 53)", () => {
  it("accepts a valid lazySkills config with usageThresholdTurns >= 5", () => {
    const result = agentSchema.safeParse({
      name: "x",
      perf: {
        lazySkills: {
          enabled: true,
          usageThresholdTurns: 20,
          reinflateOnMention: true,
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.perf?.lazySkills?.usageThresholdTurns).toBe(20);
      expect(result.data.perf?.lazySkills?.enabled).toBe(true);
      expect(result.data.perf?.lazySkills?.reinflateOnMention).toBe(true);
    }
  });

  it("rejects lazySkills with usageThresholdTurns below the 5-turn floor", () => {
    const result = agentSchema.safeParse({
      name: "x",
      perf: {
        lazySkills: {
          enabled: true,
          usageThresholdTurns: 3,
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("agentSchema perf.resumeSummaryBudget override (Phase 53)", () => {
  it("accepts resumeSummaryBudget at or above the 500-token floor and rejects below/non-integer", () => {
    const ok = agentSchema.safeParse({
      name: "x",
      perf: { resumeSummaryBudget: 1500 },
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.perf?.resumeSummaryBudget).toBe(1500);
    }

    const tooLow = agentSchema.safeParse({
      name: "x",
      perf: { resumeSummaryBudget: 400 },
    });
    expect(tooLow.success).toBe(false);

    const nonInt = agentSchema.safeParse({
      name: "x",
      perf: { resumeSummaryBudget: 1500.5 },
    });
    expect(nonInt.success).toBe(false);
  });
});

describe("streamingConfigSchema (Phase 54)", () => {
  it("accepts { editIntervalMs: 750 } (inside default corridor)", () => {
    const result = streamingConfigSchema.safeParse({ editIntervalMs: 750 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.editIntervalMs).toBe(750);
    }
  });

  it("accepts { editIntervalMs: 300 } (exactly on the 300ms floor)", () => {
    const result = streamingConfigSchema.safeParse({ editIntervalMs: 300 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.editIntervalMs).toBe(300);
    }
  });

  it("rejects { editIntervalMs: 299 } with a Zod issue mentioning the 300ms floor", () => {
    const result = streamingConfigSchema.safeParse({ editIntervalMs: 299 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages.toLowerCase()).toMatch(/300|min|greater|>=|too_small/);
    }
  });

  it("rejects { editIntervalMs: -1 } and { editIntervalMs: 0 }", () => {
    const neg = streamingConfigSchema.safeParse({ editIntervalMs: -1 });
    const zero = streamingConfigSchema.safeParse({ editIntervalMs: 0 });
    expect(neg.success).toBe(false);
    expect(zero.success).toBe(false);
  });

  it("accepts { maxLength: 2000 } (Discord message character limit)", () => {
    const result = streamingConfigSchema.safeParse({ maxLength: 2000 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxLength).toBe(2000);
    }
  });

  it("accepts {} (all fields optional)", () => {
    const result = streamingConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.editIntervalMs).toBeUndefined();
      expect(result.data.maxLength).toBeUndefined();
    }
  });

  it("agentSchema accepts { perf: { streaming: { editIntervalMs: 500 } } }", () => {
    const result = agentSchema.safeParse({
      name: "x",
      perf: { streaming: { editIntervalMs: 500 } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.perf?.streaming?.editIntervalMs).toBe(500);
    }
  });

  it("agentSchema REJECTS { perf: { streaming: { editIntervalMs: 100 } } } (floor propagates)", () => {
    const result = agentSchema.safeParse({
      name: "x",
      perf: { streaming: { editIntervalMs: 100 } },
    });
    expect(result.success).toBe(false);
  });

  it("defaultsSchema accepts { perf: { streaming: { editIntervalMs: 500 } } } (fleet-wide default path)", () => {
    const result = defaultsSchema.safeParse({
      perf: { streaming: { editIntervalMs: 500, maxLength: 1800 } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.perf?.streaming?.editIntervalMs).toBe(500);
      expect(result.data.perf?.streaming?.maxLength).toBe(1800);
    }
  });
});

describe("agentSchema perf combined fields (Phase 53 regression)", () => {
  it("accepts all four phases' fields simultaneously with no collision", () => {
    const result = agentSchema.safeParse({
      name: "x",
      perf: {
        traceRetentionDays: 14,
        slos: [{ segment: "end_to_end", metric: "p95", thresholdMs: 6000 }],
        memoryAssemblyBudgets: {
          identity: 500,
          soul: 400,
          skills_header: 600,
          hot_tier: 1500,
          recent_history: 2000,
          per_turn_summary: 300,
          resume_summary: 1500,
        },
        lazySkills: {
          enabled: true,
          usageThresholdTurns: 20,
          reinflateOnMention: true,
        },
        resumeSummaryBudget: 1500,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.perf?.traceRetentionDays).toBe(14);
      expect(result.data.perf?.slos).toHaveLength(1);
      expect(result.data.perf?.memoryAssemblyBudgets?.resume_summary).toBe(1500);
      expect(result.data.perf?.lazySkills?.enabled).toBe(true);
      expect(result.data.perf?.resumeSummaryBudget).toBe(1500);
    }
  });

  it("mirrors the three new fields on defaultsSchema.perf (fleet-wide path)", () => {
    const result = defaultsSchema.safeParse({
      perf: {
        traceRetentionDays: 30,
        memoryAssemblyBudgets: { identity: 500 },
        lazySkills: { enabled: false, usageThresholdTurns: 10, reinflateOnMention: false },
        resumeSummaryBudget: 1500,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.perf?.memoryAssemblyBudgets?.identity).toBe(500);
      expect(result.data.perf?.lazySkills?.usageThresholdTurns).toBe(10);
      expect(result.data.perf?.resumeSummaryBudget).toBe(1500);
    }
  });
});

describe("conversationConfigSchema (Phase 67)", () => {
  it("resumeSessionCount floor", () => {
    // min 1 — value of 0 must be rejected
    expect(() => conversationConfigSchema.parse({ resumeSessionCount: 0 })).toThrow();
    // 1 is the floor — must pass
    expect(() => conversationConfigSchema.parse({ resumeSessionCount: 1 })).not.toThrow();
  });

  it("conversationContextBudget floor", () => {
    // min 500 — value of 499 must be rejected
    expect(() => conversationConfigSchema.parse({ conversationContextBudget: 499 })).toThrow();
    // 500 is the floor — must pass
    expect(() => conversationConfigSchema.parse({ conversationContextBudget: 500 })).not.toThrow();
  });

  it("provides defaults when input is empty", () => {
    const parsed = conversationConfigSchema.parse({});
    expect(parsed.resumeSessionCount).toBe(3);
    expect(parsed.resumeGapThresholdHours).toBe(4);
    expect(parsed.conversationContextBudget).toBe(2000);
  });

  it("resumeSessionCount ceiling (max 10)", () => {
    // max 10 — value of 11 must be rejected
    expect(() => conversationConfigSchema.parse({ resumeSessionCount: 11 })).toThrow();
    // 10 must pass
    expect(() => conversationConfigSchema.parse({ resumeSessionCount: 10 })).not.toThrow();
  });

  it("resumeGapThresholdHours accepts 0 (always inject)", () => {
    // gap=0 means never skip — valid per min(0)
    const parsed = conversationConfigSchema.parse({ resumeGapThresholdHours: 0 });
    expect(parsed.resumeGapThresholdHours).toBe(0);
  });

  // Phase 68 — RETR-03: retrievalHalfLifeDays knob
  it("retrievalHalfLifeDays defaults to 14", () => {
    const parsed = conversationConfigSchema.parse({});
    expect(parsed.retrievalHalfLifeDays).toBe(14);
  });

  it("retrievalHalfLifeDays accepts custom positive integer", () => {
    const parsed = conversationConfigSchema.parse({ retrievalHalfLifeDays: 7 });
    expect(parsed.retrievalHalfLifeDays).toBe(7);
  });

  it("retrievalHalfLifeDays rejects 0 (min=1)", () => {
    expect(() =>
      conversationConfigSchema.parse({ retrievalHalfLifeDays: 0 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Phase 69 — OpenAI-compatible endpoint schema (OPENAI-01..07)
// ---------------------------------------------------------------------------

describe("openaiEndpointSchema", () => {
  it("applies all defaults when parsed with an empty object", () => {
    const parsed = openaiEndpointSchema.parse({});
    expect(parsed.enabled).toBe(true);
    expect(parsed.port).toBe(3101);
    expect(parsed.host).toBe("0.0.0.0");
    expect(parsed.maxRequestBodyBytes).toBe(1048576);
    expect(parsed.streamKeepaliveMs).toBe(15000);
  });

  it("wraps schema with .default({}) so a partial object still populates all fields", () => {
    // When only a subset of fields is provided, the remaining fields fall
    // back to their inner defaults. This is the realistic YAML scenario.
    const parsed = openaiEndpointSchema.parse({ port: 9999 });
    expect(parsed.port).toBe(9999);
    expect(parsed.host).toBe("0.0.0.0");
    expect(parsed.enabled).toBe(true);
    expect(parsed.maxRequestBodyBytes).toBe(1048576);
    expect(parsed.streamKeepaliveMs).toBe(15000);
  });

  it("accepts port=3101 host=127.0.0.1 and preserves values", () => {
    const parsed = openaiEndpointSchema.parse({ port: 3101, host: "127.0.0.1" });
    expect(parsed.port).toBe(3101);
    expect(parsed.host).toBe("127.0.0.1");
  });

  it("rejects port=0 (below min)", () => {
    expect(() => openaiEndpointSchema.parse({ port: 0 })).toThrow();
  });

  it("rejects port=65536 (above max)", () => {
    expect(() => openaiEndpointSchema.parse({ port: 65536 })).toThrow();
  });

  it("rejects empty host string", () => {
    expect(() => openaiEndpointSchema.parse({ host: "" })).toThrow();
  });

  it("rejects maxRequestBodyBytes=500 (below 1024 floor)", () => {
    expect(() =>
      openaiEndpointSchema.parse({ maxRequestBodyBytes: 500 }),
    ).toThrow();
  });

  it("rejects maxRequestBodyBytes above 100 MiB ceiling", () => {
    expect(() =>
      openaiEndpointSchema.parse({ maxRequestBodyBytes: 104857601 }),
    ).toThrow();
  });

  it("rejects streamKeepaliveMs=500 (below 1000 floor)", () => {
    expect(() =>
      openaiEndpointSchema.parse({ streamKeepaliveMs: 500 }),
    ).toThrow();
  });

  it("rejects streamKeepaliveMs above 120000 ceiling", () => {
    expect(() =>
      openaiEndpointSchema.parse({ streamKeepaliveMs: 120001 }),
    ).toThrow();
  });

  it("rejects non-integer port", () => {
    expect(() => openaiEndpointSchema.parse({ port: 3101.5 })).toThrow();
  });
});

describe("configSchema — defaults.openai", () => {
  it("parses with all openai defaults when defaults.openai is omitted", () => {
    const result = configSchema.safeParse({
      version: 1,
      agents: [{ name: "test" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults.openai.enabled).toBe(true);
      expect(result.data.defaults.openai.port).toBe(3101);
      expect(result.data.defaults.openai.host).toBe("0.0.0.0");
      expect(result.data.defaults.openai.maxRequestBodyBytes).toBe(1048576);
      expect(result.data.defaults.openai.streamKeepaliveMs).toBe(15000);
    }
  });

  it("accepts explicit defaults.openai overrides", () => {
    const result = configSchema.safeParse({
      version: 1,
      defaults: {
        openai: {
          enabled: false,
          port: 4000,
          host: "127.0.0.1",
          maxRequestBodyBytes: 2097152,
          streamKeepaliveMs: 30000,
        },
      },
      agents: [{ name: "test" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults.openai.enabled).toBe(false);
      expect(result.data.defaults.openai.port).toBe(4000);
      expect(result.data.defaults.openai.host).toBe("127.0.0.1");
    }
  });

  it("rejects defaults.openai with out-of-range port", () => {
    const result = configSchema.safeParse({
      version: 1,
      defaults: { openai: { port: 70000 } },
      agents: [{ name: "test" }],
    });
    expect(result.success).toBe(false);
  });
});
