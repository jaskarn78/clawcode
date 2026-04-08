import { describe, it, expect } from "vitest";
import { configSchema } from "../schema.js";

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
