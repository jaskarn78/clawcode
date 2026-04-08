import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  loadConfig,
  resolveAgentConfig,
  resolveContent,
} from "../loader.js";
import { expandHome } from "../defaults.js";
import { ConfigFileNotFoundError, ConfigValidationError } from "../../shared/errors.js";
import type { AgentConfig, DefaultsConfig } from "../schema.js";

describe("resolveAgentConfig", () => {
  const defaults: DefaultsConfig = {
    model: "sonnet",
    skills: ["default-skill"],
    basePath: "~/.clawcode/agents",
  };

  it("applies default model when agent does not specify one", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      skills: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.model).toBe("sonnet");
  });

  it("uses agent model when specified, overriding default", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      model: "opus",
      skills: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.model).toBe("opus");
  });

  it("uses default skills when agent skills array is empty", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      skills: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.skills).toEqual(["default-skill"]);
  });

  it("uses agent skills when agent skills array is non-empty", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      skills: ["custom-skill"],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.skills).toEqual(["custom-skill"]);
  });

  it("defaults workspace to basePath/agentName when not specified", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      skills: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.workspace).toBe(join(homedir(), ".clawcode/agents", "writer"));
  });

  it("uses agent workspace when specified", () => {
    const agent: AgentConfig = {
      name: "writer",
      workspace: "/custom/path",
      channels: [],
      skills: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.workspace).toBe("/custom/path");
  });

  it("does not mutate input agent object", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: ["ch1"],
      skills: [],
    };
    const agentCopy = { ...agent };

    resolveAgentConfig(agent, defaults);

    expect(agent).toEqual(agentCopy);
  });

  it("does not mutate input defaults object", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      skills: [],
    };
    const defaultsCopy = { ...defaults };

    resolveAgentConfig(agent, defaults);

    expect(defaults).toEqual(defaultsCopy);
  });
});

describe("resolveContent", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clawcode-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns value as-is when it contains newlines (inline content)", async () => {
    const inline = "# My Soul\n\nBe helpful.";
    const result = await resolveContent(inline);
    expect(result).toBe(inline);
  });

  it("reads file contents when value looks like a path and file exists", async () => {
    const filePath = join(tempDir, "soul.md");
    await writeFile(filePath, "File soul content");

    const result = await resolveContent(filePath);
    expect(result).toBe("File soul content");
  });

  it("returns value as-is when value does not look like a path", async () => {
    const value = "Just some inline text";
    const result = await resolveContent(value);
    expect(result).toBe(value);
  });

  it("returns value as-is when path-like value does not exist on disk", async () => {
    const value = "./nonexistent/soul.md";
    const result = await resolveContent(value);
    expect(result).toBe(value);
  });
});

describe("expandHome", () => {
  it("replaces leading ~ with os.homedir()", () => {
    const result = expandHome("~/some/path");
    expect(result).toBe(join(homedir(), "some/path"));
  });

  it("does not modify absolute paths", () => {
    const result = expandHome("/absolute/path");
    expect(result).toBe("/absolute/path");
  });

  it("does not modify relative paths without tilde", () => {
    const result = expandHome("relative/path");
    expect(result).toBe("relative/path");
  });
});

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clawcode-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("parses a valid YAML config file", async () => {
    const configPath = join(tempDir, "clawcode.yaml");
    await writeFile(
      configPath,
      `version: 1
agents:
  - name: researcher
    channels: ["1234567890123456"]
    model: opus
`,
    );

    const config = await loadConfig(configPath);
    expect(config.version).toBe(1);
    expect(config.agents[0].name).toBe("researcher");
    expect(config.agents[0].model).toBe("opus");
  });

  it("throws ConfigFileNotFoundError for missing file", async () => {
    const missingPath = join(tempDir, "nonexistent.yaml");

    await expect(loadConfig(missingPath)).rejects.toThrow(ConfigFileNotFoundError);
  });

  it("throws ConfigValidationError for invalid config content", async () => {
    const configPath = join(tempDir, "bad.yaml");
    await writeFile(configPath, `version: 1\nagents: []\n`);

    await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError);
  });

  it("throws ConfigValidationError with agent name context", async () => {
    const configPath = join(tempDir, "bad-agent.yaml");
    await writeFile(
      configPath,
      `version: 1
agents:
  - name: researcher
    channels: [1234]
`,
    );

    try {
      await loadConfig(configPath);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const error = err as ConfigValidationError;
      expect(error.message).toContain("researcher");
    }
  });
});
