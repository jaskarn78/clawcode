import { describe, it, expect } from "vitest";
import { configSchema, mcpServerSchema } from "../schema.js";

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
      expect(result.data.defaults.model).toBe("sonnet");
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
