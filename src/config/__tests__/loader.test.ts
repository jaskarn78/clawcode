import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  loadConfig,
  resolveAgentConfig,
  resolveAllAgents,
  resolveContent,
  resolveEnvVars,
} from "../loader.js";
import { expandHome } from "../defaults.js";
import { ConfigFileNotFoundError, ConfigValidationError } from "../../shared/errors.js";
import type { AgentConfig, DefaultsConfig, Config } from "../schema.js";

describe("resolveAgentConfig", () => {
  const defaults: DefaultsConfig = {
    model: "sonnet",
    effort: "low" as const,
    // Phase 86 MODEL-01 — test fixture mirrors the defaultsSchema default.
    allowedModels: ["haiku", "sonnet", "opus"] as ("haiku" | "sonnet" | "opus")[],
    skills: ["default-skill"],
    basePath: "~/.clawcode/agents",
    skillsPath: "~/.clawcode/skills",
    memory: { compactionThreshold: 0.75, searchTopK: 10, consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *" }, decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 }, deduplication: { enabled: true, similarityThreshold: 0.85 }, tiers: { hotAccessThreshold: 3, hotAccessWindowDays: 7, hotDemotionDays: 7, coldRelevanceThreshold: 0.05, hotBudget: 20 }, episodes: { archivalAgeDays: 90 } },
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: {
        warningThreshold: 0.6,
        criticalThreshold: 0.75,
        zoneThresholds: { yellow: 0.50, orange: 0.70, red: 0.85 },
      },
    },
    threads: { idleTimeoutMinutes: 1440, maxThreadSessions: 10 },
    openai: { enabled: true, port: 3101, host: "0.0.0.0", maxRequestBodyBytes: 1048576, streamKeepaliveMs: 15000 },
    browser: {
      enabled: true,
      headless: true,
      warmOnBoot: true,
      navigationTimeoutMs: 30000,
      actionTimeoutMs: 10000,
      viewport: { width: 1280, height: 720 },
      userAgent: null,
      maxScreenshotInlineBytes: 524288,
    },
    search: {
      enabled: true,
      backend: "brave" as const,
      brave: { apiKeyEnv: "BRAVE_API_KEY", safeSearch: "moderate" as const, country: "us" },
      exa: { apiKeyEnv: "EXA_API_KEY", useAutoprompt: false },
      maxResults: 20,
      timeoutMs: 10000,
      fetch: { timeoutMs: 30000, maxBytes: 1048576, userAgentSuffix: null },
    },
    image: {
      enabled: true,
      backend: "openai" as const,
      openai: { apiKeyEnv: "OPENAI_API_KEY", model: "gpt-image-1" },
      minimax: { apiKeyEnv: "MINIMAX_API_KEY", model: "image-01" },
      fal: { apiKeyEnv: "FAL_API_KEY", model: "fal-ai/flux-pro" },
      maxImageBytes: 10485760,
      timeoutMs: 60000,
      workspaceSubdir: "generated-images",
    },
  };

  it("applies default model when agent does not specify one", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
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
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.model).toBe("opus");
  });

  it("uses default skills when agent skills array is empty", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.skills).toEqual(["default-skill"]);
  });

  it("uses agent skills when agent skills array is non-empty", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      skills: ["custom-skill"],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.skills).toEqual(["custom-skill"]);
  });

  it("defaults workspace to basePath/agentName when not specified", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
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
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.workspace).toBe("/custom/path");
  });

  it("does not mutate input agent object", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: ["ch1"],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
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
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };
    const defaultsCopy = { ...defaults };

    resolveAgentConfig(agent, defaults);

    expect(defaults).toEqual(defaultsCopy);
  });

  // Phase 75 Plan 02 — memoryPath resolution (SHARED-01, SHARED-02).
  // loader.ts guarantees ResolvedAgentConfig.memoryPath is populated:
  //   - expandHome(agent.memoryPath) when set (handles `~/...`)
  //   - resolvedWorkspace when unset (zero behavior change for dedicated
  //     workspace agents — they never set memoryPath)

  it("expands memoryPath with leading ~ when explicitly set", () => {
    const agent: AgentConfig = {
      name: "fin-acquisition",
      memoryPath: "~/shared/finmentum/fin-acquisition",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.memoryPath).toBe(
      join(homedir(), "shared/finmentum/fin-acquisition"),
    );
  });

  it("falls back memoryPath to workspace when unset (zero behavior change for dedicated-workspace agents)", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.memoryPath).toBe(resolved.workspace);
    expect(resolved.memoryPath).toBe(
      join(homedir(), ".clawcode/agents", "writer"),
    );
  });

  it("passes ./relative memoryPath through expandHome unchanged (no ~ prefix)", () => {
    const agent: AgentConfig = {
      name: "writer",
      memoryPath: "./relative/subdir",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.memoryPath).toBe("./relative/subdir");
  });

  it("passes absolute memoryPath through unchanged", () => {
    const agent: AgentConfig = {
      name: "writer",
      memoryPath: "/var/lib/clawcode/writer",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.memoryPath).toBe("/var/lib/clawcode/writer");
    // workspace is unaffected by memoryPath override
    expect(resolved.workspace).toBe(
      join(homedir(), ".clawcode/agents", "writer"),
    );
  });

  it("resolveAllAgents: two agents sharing basePath with distinct memoryPaths get distinct resolved paths", () => {
    const config: Config = {
      version: 1,
      defaults,
      agents: [
        {
          name: "fin-acquisition",
          workspace: "~/shared/finmentum",
          memoryPath: "~/shared/finmentum/fin-acquisition",
          channels: [],
          skills: [],
          effort: "low",
          heartbeat: true,
          schedules: [],
          admin: false,
          slashCommands: [],
          reactions: true,
          mcpServers: [],
        },
        {
          name: "fin-research",
          workspace: "~/shared/finmentum",
          memoryPath: "~/shared/finmentum/fin-research",
          channels: [],
          skills: [],
          effort: "low",
          heartbeat: true,
          schedules: [],
          admin: false,
          slashCommands: [],
          reactions: true,
          mcpServers: [],
        },
      ],
      mcpServers: {},
    } as unknown as Config;

    const resolved = resolveAllAgents(config);
    const acq = resolved.find((a) => a.name === "fin-acquisition")!;
    const res = resolved.find((a) => a.name === "fin-research")!;

    // Shared workspace (same YAML value, same resolved string)
    expect(acq.workspace).toBe(res.workspace);

    // Distinct memoryPaths — the whole point of Phase 75
    expect(acq.memoryPath).not.toBe(res.memoryPath);
    expect(acq.memoryPath).toBe(
      join(homedir(), "shared/finmentum/fin-acquisition"),
    );
    expect(res.memoryPath).toBe(
      join(homedir(), "shared/finmentum/fin-research"),
    );
  });

  // -------------------------------------------------------------------------
  // Phase 78 Plan 01 — CONF-01: soulFile / identityFile expansion
  // loader.ts guarantees ResolvedAgentConfig.soulFile / .identityFile are
  //   - expandHome(agent.soulFile) when set (handles `~/...`)
  //   - undefined when unset (session-config.ts skips the file branch)
  // -------------------------------------------------------------------------

  it("expands soulFile with leading ~ when set", () => {
    const agent: AgentConfig = {
      name: "fin-acquisition",
      soulFile: "~/workspace-fin-acquisition/SOUL.md",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.soulFile).toBe(
      join(homedir(), "workspace-fin-acquisition/SOUL.md"),
    );
  });

  it("leaves soulFile undefined when unset (no fallback to workspace/SOUL.md)", () => {
    const agent: AgentConfig = {
      name: "writer",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.soulFile).toBeUndefined();
  });

  it("expands identityFile with leading ~ when set; leaves undefined when unset", () => {
    const agentSet: AgentConfig = {
      name: "fin-research",
      identityFile: "~/workspace-fin-research/IDENTITY.md",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };
    const resolvedSet = resolveAgentConfig(agentSet, defaults);
    expect(resolvedSet.identityFile).toBe(
      join(homedir(), "workspace-fin-research/IDENTITY.md"),
    );

    const agentUnset: AgentConfig = {
      name: "writer",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };
    const resolvedUnset = resolveAgentConfig(agentUnset, defaults);
    expect(resolvedUnset.identityFile).toBeUndefined();
  });

  it("expands soulFile independently of workspace (soulFile expansion doesn't depend on workspace being set)", () => {
    const agent: AgentConfig = {
      name: "fin-acquisition",
      // workspace omitted — loader falls back to basePath + name
      soulFile: "~/external/custom-soul.md",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.soulFile).toBe(
      join(homedir(), "external/custom-soul.md"),
    );
    // Workspace still resolved from basePath — independent from soulFile.
    expect(resolved.workspace).toBe(
      join(homedir(), ".clawcode/agents", "fin-acquisition"),
    );
  });
});

describe("resolveAgentConfig - mcpServers", () => {
  const defaults: DefaultsConfig = {
    model: "sonnet",
    effort: "low" as const,
    // Phase 86 MODEL-01 — test fixture mirrors the defaultsSchema default.
    allowedModels: ["haiku", "sonnet", "opus"] as ("haiku" | "sonnet" | "opus")[],
    skills: [],
    basePath: "~/.clawcode/agents",
    skillsPath: "~/.clawcode/skills",
    memory: { compactionThreshold: 0.75, searchTopK: 10, consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *" }, decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 }, deduplication: { enabled: true, similarityThreshold: 0.85 }, tiers: { hotAccessThreshold: 3, hotAccessWindowDays: 7, hotDemotionDays: 7, coldRelevanceThreshold: 0.05, hotBudget: 20 }, episodes: { archivalAgeDays: 90 } },
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: {
        warningThreshold: 0.6,
        criticalThreshold: 0.75,
        zoneThresholds: { yellow: 0.50, orange: 0.70, red: 0.85 },
      },
    },
    threads: { idleTimeoutMinutes: 1440, maxThreadSessions: 10 },
    openai: { enabled: true, port: 3101, host: "0.0.0.0", maxRequestBodyBytes: 1048576, streamKeepaliveMs: 15000 },
    browser: {
      enabled: true,
      headless: true,
      warmOnBoot: true,
      navigationTimeoutMs: 30000,
      actionTimeoutMs: 10000,
      viewport: { width: 1280, height: 720 },
      userAgent: null,
      maxScreenshotInlineBytes: 524288,
    },
    search: {
      enabled: true,
      backend: "brave" as const,
      brave: { apiKeyEnv: "BRAVE_API_KEY", safeSearch: "moderate" as const, country: "us" },
      exa: { apiKeyEnv: "EXA_API_KEY", useAutoprompt: false },
      maxResults: 20,
      timeoutMs: 10000,
      fetch: { timeoutMs: 30000, maxBytes: 1048576, userAgentSuffix: null },
    },
    image: {
      enabled: true,
      backend: "openai" as const,
      openai: { apiKeyEnv: "OPENAI_API_KEY", model: "gpt-image-1" },
      minimax: { apiKeyEnv: "MINIMAX_API_KEY", model: "image-01" },
      fal: { apiKeyEnv: "FAL_API_KEY", model: "fal-ai/flux-pro" },
      maxImageBytes: 10485760,
      timeoutMs: 60000,
      workspaceSubdir: "generated-images",
    },
  };

  const sharedMcpServers = {
    // Phase 85 TOOL-01 — `optional: false` added to match the extended
    // mcpServerSchema (default field; mandatory servers).
    finnhub: { name: "finnhub", command: "npx", args: ["-y", "finnhub-mcp"], env: { API_KEY: "xxx" }, optional: false },
    google: { name: "google", command: "npx", args: ["-y", "google-mcp"], env: {}, optional: false },
  };

  const baseAgent: AgentConfig = {
    name: "test",
    channels: [],
    skills: [],
    effort: "low",
    heartbeat: true,
    schedules: [],
    admin: false,
    slashCommands: [],
    reactions: true,
    mcpServers: [],
  };

  it("resolves string references from shared definitions", () => {
    const agent = { ...baseAgent, mcpServers: ["finnhub"] as Array<string | { name: string; command: string; args: string[]; env: Record<string, string>; optional: boolean }> };
    const resolved = resolveAgentConfig(agent, defaults, sharedMcpServers);
    const finnhub = resolved.mcpServers.find(s => s.name === "finnhub");
    expect(finnhub).toBeDefined();
    expect(finnhub!.command).toBe("npx");
    expect(finnhub!.args).toEqual(["-y", "finnhub-mcp"]);
    expect(finnhub!.env).toEqual({ API_KEY: "xxx" });
    // Also has auto-injected clawcode
    expect(resolved.mcpServers.find(s => s.name === "clawcode")).toBeDefined();
  });

  it("passes inline MCP server objects through unchanged", () => {
    const inline = { name: "custom", command: "my-server", args: ["--port", "3000"], env: { KEY: "val" }, optional: false };
    const agent = { ...baseAgent, mcpServers: [inline] as Array<string | { name: string; command: string; args: string[]; env: Record<string, string>; optional: boolean }> };
    const resolved = resolveAgentConfig(agent, defaults, sharedMcpServers);
    const custom = resolved.mcpServers.find(s => s.name === "custom");
    expect(custom).toBeDefined();
    expect(custom!.command).toBe("my-server");
  });

  it("merges inline and refs, inline wins on name collision", () => {
    const inline = { name: "finnhub", command: "custom-finnhub", args: [], env: {}, optional: false };
    const agent = { ...baseAgent, mcpServers: ["finnhub", inline] as Array<string | { name: string; command: string; args: string[]; env: Record<string, string>; optional: boolean }> };
    const resolved = resolveAgentConfig(agent, defaults, sharedMcpServers);
    // Later entry wins on name collision
    const finnhub = resolved.mcpServers.find(s => s.name === "finnhub");
    expect(finnhub).toBeDefined();
    expect(finnhub!.command).toBe("custom-finnhub");
  });

  it("throws when string reference not found in shared definitions", () => {
    const agent = { ...baseAgent, mcpServers: ["nonexistent"] as Array<string | { name: string; command: string; args: string[]; env: Record<string, string>; optional: boolean }> };
    expect(() => resolveAgentConfig(agent, defaults, sharedMcpServers)).toThrow(
      /MCP server.*nonexistent.*not found/i,
    );
  });

  it("auto-injects clawcode MCP server when agent has none", () => {
    const resolved = resolveAgentConfig(baseAgent, defaults, sharedMcpServers);
    const clawcode = resolved.mcpServers.find(s => s.name === "clawcode");
    expect(clawcode).toBeDefined();
    expect(clawcode!.command).toBe("clawcode");
    expect(clawcode!.args).toEqual(["mcp"]);
  });

  // Phase 70 Plan 03 — auto-inject the `browser` MCP entry so every agent
  // gets the 6 browser_* tools out of the box. Parallels the `clawcode`
  // and `1password` auto-injects. Gated by defaults.browser.enabled.
  it("auto-injects browser MCP entry when defaults.browser.enabled is true", () => {
    const resolved = resolveAgentConfig(baseAgent, defaults, sharedMcpServers);
    const browser = resolved.mcpServers.find((s) => s.name === "browser");
    expect(browser).toBeDefined();
    expect(browser!.command).toBe("clawcode");
    expect(browser!.args).toEqual(["browser-mcp"]);
    expect(browser!.env).toEqual({ CLAWCODE_AGENT: "test" });
  });

  it("omits browser MCP when defaults.browser.enabled is false", () => {
    const disabledDefaults: DefaultsConfig = {
      ...defaults,
      browser: { ...defaults.browser, enabled: false },
    };
    const resolved = resolveAgentConfig(baseAgent, disabledDefaults, sharedMcpServers);
    expect(resolved.mcpServers.find((s) => s.name === "browser")).toBeUndefined();
  });

  it("browser injection sets CLAWCODE_AGENT env to the agent name per-agent", () => {
    const clawdy = { ...baseAgent, name: "clawdy" };
    const rubi = { ...baseAgent, name: "rubi" };
    const resolvedClawdy = resolveAgentConfig(clawdy, defaults, sharedMcpServers);
    const resolvedRubi = resolveAgentConfig(rubi, defaults, sharedMcpServers);
    expect(resolvedClawdy.mcpServers.find((s) => s.name === "browser")!.env).toEqual({ CLAWCODE_AGENT: "clawdy" });
    expect(resolvedRubi.mcpServers.find((s) => s.name === "browser")!.env).toEqual({ CLAWCODE_AGENT: "rubi" });
  });

  it("preserves user-specified 'browser' mcpServer entry (no overwrite)", () => {
    const customBrowser = { name: "browser", command: "mycustom", args: ["--flag"], env: { CUSTOM: "x" }, optional: false };
    const agent = {
      ...baseAgent,
      mcpServers: [customBrowser] as Array<string | { name: string; command: string; args: string[]; env: Record<string, string>; optional: boolean }>,
    };
    const resolved = resolveAgentConfig(agent, defaults, sharedMcpServers);
    const browser = resolved.mcpServers.find((s) => s.name === "browser");
    expect(browser).toBeDefined();
    expect(browser!.command).toBe("mycustom");
    expect(browser!.args).toEqual(["--flag"]);
    expect(browser!.env).toEqual({ CUSTOM: "x" });
  });

  // Phase 71 Plan 02 — auto-inject the `search` MCP entry so every agent
  // gets web_search + web_fetch_url. Parallels the browser auto-inject;
  // gated by defaults.search.enabled (default true).
  it("auto-injects search MCP entry when defaults.search.enabled is true", () => {
    const resolved = resolveAgentConfig(baseAgent, defaults, sharedMcpServers);
    const search = resolved.mcpServers.find((s) => s.name === "search");
    expect(search).toBeDefined();
    expect(search!.command).toBe("clawcode");
    expect(search!.args).toEqual(["search-mcp"]);
    expect(search!.env).toEqual({ CLAWCODE_AGENT: "test" });
  });

  it("omits search MCP when defaults.search.enabled is false", () => {
    const disabledDefaults: DefaultsConfig = {
      ...defaults,
      search: { ...defaults.search, enabled: false },
    };
    const resolved = resolveAgentConfig(baseAgent, disabledDefaults, sharedMcpServers);
    expect(resolved.mcpServers.find((s) => s.name === "search")).toBeUndefined();
  });

  it("search injection sets CLAWCODE_AGENT env to the agent name per-agent", () => {
    const clawdy = { ...baseAgent, name: "clawdy" };
    const rubi = { ...baseAgent, name: "rubi" };
    const resolvedClawdy = resolveAgentConfig(clawdy, defaults, sharedMcpServers);
    const resolvedRubi = resolveAgentConfig(rubi, defaults, sharedMcpServers);
    expect(resolvedClawdy.mcpServers.find((s) => s.name === "search")!.env).toEqual({ CLAWCODE_AGENT: "clawdy" });
    expect(resolvedRubi.mcpServers.find((s) => s.name === "search")!.env).toEqual({ CLAWCODE_AGENT: "rubi" });
  });

  it("preserves user-specified 'search' mcpServer entry (no overwrite)", () => {
    const customSearch = { name: "search", command: "mycustom", args: ["--flag"], env: { CUSTOM: "x" }, optional: false };
    const agent = {
      ...baseAgent,
      mcpServers: [customSearch] as Array<string | { name: string; command: string; args: string[]; env: Record<string, string>; optional: boolean }>,
    };
    const resolved = resolveAgentConfig(agent, defaults, sharedMcpServers);
    const search = resolved.mcpServers.find((s) => s.name === "search");
    expect(search).toBeDefined();
    expect(search!.command).toBe("mycustom");
    expect(search!.args).toEqual(["--flag"]);
    expect(search!.env).toEqual({ CUSTOM: "x" });
  });

  it("resolves multiple string references", () => {
    const agent = { ...baseAgent, mcpServers: ["finnhub", "google"] as Array<string | { name: string; command: string; args: string[]; env: Record<string, string>; optional: boolean }> };
    const resolved = resolveAgentConfig(agent, defaults, sharedMcpServers);
    expect(resolved.mcpServers.find(s => s.name === "finnhub")).toBeDefined();
    expect(resolved.mcpServers.find(s => s.name === "google")).toBeDefined();
    expect(resolved.mcpServers.find(s => s.name === "clawcode")).toBeDefined();
  });

  // Phase 72 Plan 02 — auto-inject the `image` MCP entry so every agent
  // gets image_generate + image_edit + image_variations. Parallels the
  // browser + search auto-injects; gated by defaults.image.enabled
  // (default true).
  it("L1: auto-injects image MCP entry when defaults.image.enabled is true", () => {
    const resolved = resolveAgentConfig(baseAgent, defaults, sharedMcpServers);
    const image = resolved.mcpServers.find((s) => s.name === "image");
    expect(image).toBeDefined();
    expect(image!.command).toBe("clawcode");
    expect(image!.args).toEqual(["image-mcp"]);
    expect(image!.env).toEqual({ CLAWCODE_AGENT: "test" });
  });

  it("L2: omits image MCP when defaults.image.enabled is false", () => {
    const disabledDefaults: DefaultsConfig = {
      ...defaults,
      image: { ...defaults.image, enabled: false },
    };
    const resolved = resolveAgentConfig(baseAgent, disabledDefaults, sharedMcpServers);
    expect(resolved.mcpServers.find((s) => s.name === "image")).toBeUndefined();
  });

  it("L3: image injection sets CLAWCODE_AGENT env to the agent name per-agent", () => {
    const clawdy = { ...baseAgent, name: "clawdy" };
    const rubi = { ...baseAgent, name: "rubi" };
    const resolvedClawdy = resolveAgentConfig(clawdy, defaults, sharedMcpServers);
    const resolvedRubi = resolveAgentConfig(rubi, defaults, sharedMcpServers);
    expect(resolvedClawdy.mcpServers.find((s) => s.name === "image")!.env).toEqual({ CLAWCODE_AGENT: "clawdy" });
    expect(resolvedRubi.mcpServers.find((s) => s.name === "image")!.env).toEqual({ CLAWCODE_AGENT: "rubi" });
  });

  it("L4: preserves user-specified 'image' mcpServer entry (no overwrite)", () => {
    const customImage = { name: "image", command: "mycustom", args: ["--flag"], env: { CUSTOM: "x" }, optional: false };
    const agent = {
      ...baseAgent,
      mcpServers: [customImage] as Array<string | { name: string; command: string; args: string[]; env: Record<string, string>; optional: boolean }>,
    };
    const resolved = resolveAgentConfig(agent, defaults, sharedMcpServers);
    const image = resolved.mcpServers.find((s) => s.name === "image");
    expect(image).toBeDefined();
    expect(image!.command).toBe("mycustom");
    expect(image!.args).toEqual(["--flag"]);
    expect(image!.env).toEqual({ CUSTOM: "x" });
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

describe("loadConfig - shared MCP servers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clawcode-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads full config with all 14 shared MCP servers and resolves agent references", async () => {
    const configPath = join(tempDir, "clawcode.yaml");
    await writeFile(
      configPath,
      `version: 1
defaults:
  model: sonnet
  basePath: ~/.clawcode/agents

mcpServers:
  finnhub:
    name: finnhub
    command: node
    args:
      - /home/jjagpal/clawd/mcp-servers/finnhub/server.js
    env:
      FINNHUB_API_KEY: op://clawdbot/Finnhub/api-key
  finmentum-db:
    name: finmentum-db
    command: mcporter
    args:
      - serve
      - mysql
    env:
      MYSQL_HOST: op://clawdbot/MySQL DB - Unraid/host
      MYSQL_PORT: "3306"
      MYSQL_USER: op://clawdbot/MySQL DB - Unraid/username
      MYSQL_PASSWORD: op://clawdbot/Finmentum DB/password
      MYSQL_DATABASE: finmentum
  google-workspace:
    name: google-workspace
    command: node
    args:
      - /home/jjagpal/clawd/projects/google-workspace-mcp/dist/index.js
  homeassistant:
    name: homeassistant
    command: python3
    args:
      - /home/jjagpal/.openclaw/workspace-general/mcp-servers/homeassistant.py
    env:
      HA_URL: http://100.76.169.87:8123
      HA_TOKEN: op://clawdbot/HA Access Token/Access Token
  strava:
    name: strava
    command: python3
    args:
      - /home/jjagpal/.openclaw/workspace-general/mcp-servers/strava.py
    env:
      STRAVA_CLIENT_ID: op://clawdbot/Strava OAuth Tokens/client_id
      STRAVA_CLIENT_SECRET: op://clawdbot/Strava OAuth Tokens/client_secret
      STRAVA_ACCESS_TOKEN: op://clawdbot/Strava OAuth Tokens/access_token
      STRAVA_REFRESH_TOKEN: op://clawdbot/Strava OAuth Tokens/refresh_token
  openai:
    name: openai
    command: python3
    args:
      - /home/jjagpal/.openclaw/workspace-general/mcp-servers/openai_server.py
    env:
      OPENAI_API_KEY: '\${OPENAI_API_KEY}'
  anthropic:
    name: anthropic
    command: python3
    args:
      - /home/jjagpal/.openclaw/workspace-general/mcp-servers/anthropic_server.py
    env:
      ANTHROPIC_API_KEY: '\${ANTHROPIC_API_KEY}'
  brave-search:
    name: brave-search
    command: python3
    args:
      - /home/jjagpal/.openclaw/workspace-general/mcp-servers/brave_search.py
    env:
      BRAVE_API_KEY: '\${BRAVE_API_KEY}'
  elevenlabs:
    name: elevenlabs
    command: python3
    args:
      - /home/jjagpal/.openclaw/workspace-general/mcp-servers/elevenlabs.py
    env:
      ELEVENLABS_API_KEY: '\${ELEVENLABS_API_KEY}'
  ollama:
    name: ollama
    command: python3
    args:
      - /home/jjagpal/.openclaw/workspace-general/mcp-servers/ollama.py
    env:
      OLLAMA_URL: http://100.117.64.85:11434
  browserless:
    name: browserless
    command: python3
    args:
      - /home/jjagpal/.openclaw/workspace-general/mcp-servers/browserless.py
    env:
      BROWSERLESS_URL: http://100.117.64.85:3000
  chatterbox-tts:
    name: chatterbox-tts
    command: python3
    args:
      - /home/jjagpal/.openclaw/workspace-general/mcp-servers/chatterbox_tts.py
    env:
      CHATTERBOX_URL: http://100.117.64.85:4123
  fal-ai:
    name: fal-ai
    command: python3
    args:
      - /home/jjagpal/.openclaw/workspace-general/mcp-servers/fal_ai.py
    env:
      FAL_API_KEY: op://clawdbot/fal.ai Admin API Credentials/credential
  finmentum-content:
    name: finmentum-content
    command: python3
    args:
      - /home/jjagpal/.openclaw/workspace-general/mcp-servers/finmentum_content.py
    env:
      FINMENTUM_DB_PASSWORD: op://clawdbot/MySQL DB - Unraid/password
      HEYGEN_API_KEY: op://clawdbot/HeyGen/api-key
      PEXELS_API_KEY: op://clawdbot/Pexels/api-key

agents:
  - name: plain-agent
    channels:
      - "1111111111111111"
  - name: mcp-agent
    channels:
      - "2222222222222222"
    mcpServers:
      - finnhub
      - brave-search
      - homeassistant
`,
    );

    // Load and validate
    const config = await loadConfig(configPath);

    // Verify 14 shared MCP servers loaded
    const serverKeys = Object.keys(config.mcpServers);
    expect(serverKeys).toHaveLength(14);
    expect(serverKeys).toContain("finnhub");
    expect(serverKeys).toContain("finmentum-db");
    expect(serverKeys).toContain("google-workspace");
    expect(serverKeys).toContain("homeassistant");
    expect(serverKeys).toContain("strava");
    expect(serverKeys).toContain("openai");
    expect(serverKeys).toContain("anthropic");
    expect(serverKeys).toContain("brave-search");
    expect(serverKeys).toContain("elevenlabs");
    expect(serverKeys).toContain("ollama");
    expect(serverKeys).toContain("browserless");
    expect(serverKeys).toContain("chatterbox-tts");
    expect(serverKeys).toContain("fal-ai");
    expect(serverKeys).toContain("finmentum-content");

    // Verify a specific server's details
    expect(config.mcpServers["finnhub"].command).toBe("node");
    expect(config.mcpServers["finmentum-db"].env.MYSQL_HOST).toBeDefined();

    // Resolve all agents
    const resolved = resolveAllAgents(config);
    expect(resolved).toHaveLength(2);

    // plain-agent gets auto-injected clawcode MCP
    const plainAgent = resolved.find((a) => a.name === "plain-agent");
    expect(plainAgent).toBeDefined();
    expect(plainAgent!.mcpServers.find(s => s.name === "clawcode")).toBeDefined();
    // No user-defined MCP servers — only the auto-injected clawcode/1password/browser/search/image entries remain.
    expect(plainAgent!.mcpServers.filter(s => s.name !== "clawcode" && s.name !== "1password" && s.name !== "browser" && s.name !== "search" && s.name !== "image")).toEqual([]);

    // mcp-agent has 3 resolved servers from string references + auto-injected ones
    const mcpAgent = resolved.find((a) => a.name === "mcp-agent");
    expect(mcpAgent).toBeDefined();
    expect(mcpAgent!.mcpServers.length).toBeGreaterThanOrEqual(4);

    const serverNames = mcpAgent!.mcpServers.map((s) => s.name);
    expect(serverNames).toContain("finnhub");
    expect(serverNames).toContain("brave-search");
    expect(serverNames).toContain("homeassistant");

    // Verify resolved server has full details (not just name)
    const resolvedFinnhub = mcpAgent!.mcpServers.find((s) => s.name === "finnhub");
    expect(resolvedFinnhub).toBeDefined();
    expect(resolvedFinnhub!.command).toBe("node");
    expect(resolvedFinnhub!.args).toEqual(["/home/jjagpal/clawd/mcp-servers/finnhub/server.js"]);
    expect(resolvedFinnhub!.env.FINNHUB_API_KEY).toBe("op://clawdbot/Finnhub/api-key");
  });
});

describe("resolveEnvVars", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    savedEnv.TOKEN = process.env.TOKEN;
    savedEnv.A = process.env.A;
    savedEnv.B = process.env.B;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("resolves a single env var", () => {
    process.env.OPENAI_API_KEY = "sk-123";
    expect(resolveEnvVars("${OPENAI_API_KEY}")).toBe("sk-123");
  });

  it("returns empty string for missing env var", () => {
    delete process.env.MISSING_VAR;
    expect(resolveEnvVars("${MISSING_VAR}")).toBe("");
  });

  it("handles partial interpolation with surrounding text", () => {
    process.env.TOKEN = "abc";
    expect(resolveEnvVars("Bearer ${TOKEN}")).toBe("Bearer abc");
  });

  it("passes through strings without env var patterns", () => {
    expect(resolveEnvVars("no-vars-here")).toBe("no-vars-here");
  });

  it("resolves multiple env vars in one string", () => {
    process.env.A = "foo";
    process.env.B = "bar";
    expect(resolveEnvVars("${A}_${B}")).toBe("foo_bar");
  });
});

describe("resolveAgentConfig - MCP env var interpolation", () => {
  const defaults: DefaultsConfig = {
    model: "sonnet",
    effort: "low" as const,
    // Phase 86 MODEL-01 — test fixture mirrors the defaultsSchema default.
    allowedModels: ["haiku", "sonnet", "opus"] as ("haiku" | "sonnet" | "opus")[],
    skills: [],
    basePath: "~/.clawcode/agents",
    skillsPath: "~/.clawcode/skills",
    memory: { compactionThreshold: 0.75, searchTopK: 10, consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *" }, decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 }, deduplication: { enabled: true, similarityThreshold: 0.85 }, tiers: { hotAccessThreshold: 3, hotAccessWindowDays: 7, hotDemotionDays: 7, coldRelevanceThreshold: 0.05, hotBudget: 20 }, episodes: { archivalAgeDays: 90 } },
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: {
        warningThreshold: 0.6,
        criticalThreshold: 0.75,
        zoneThresholds: { yellow: 0.50, orange: 0.70, red: 0.85 },
      },
    },
    threads: { idleTimeoutMinutes: 1440, maxThreadSessions: 10 },
    openai: { enabled: true, port: 3101, host: "0.0.0.0", maxRequestBodyBytes: 1048576, streamKeepaliveMs: 15000 },
    browser: {
      enabled: true,
      headless: true,
      warmOnBoot: true,
      navigationTimeoutMs: 30000,
      actionTimeoutMs: 10000,
      viewport: { width: 1280, height: 720 },
      userAgent: null,
      maxScreenshotInlineBytes: 524288,
    },
    search: {
      enabled: true,
      backend: "brave" as const,
      brave: { apiKeyEnv: "BRAVE_API_KEY", safeSearch: "moderate" as const, country: "us" },
      exa: { apiKeyEnv: "EXA_API_KEY", useAutoprompt: false },
      maxResults: 20,
      timeoutMs: 10000,
      fetch: { timeoutMs: 30000, maxBytes: 1048576, userAgentSuffix: null },
    },
    image: {
      enabled: true,
      backend: "openai" as const,
      openai: { apiKeyEnv: "OPENAI_API_KEY", model: "gpt-image-1" },
      minimax: { apiKeyEnv: "MINIMAX_API_KEY", model: "image-01" },
      fal: { apiKeyEnv: "FAL_API_KEY", model: "fal-ai/flux-pro" },
      maxImageBytes: 10485760,
      timeoutMs: 60000,
      workspaceSubdir: "generated-images",
    },
  };

  afterEach(() => {
    delete process.env.TEST_API_KEY;
  });

  it("resolves ${VAR_NAME} patterns in MCP server env values", () => {
    process.env.TEST_API_KEY = "sk-test-999";
    const agent: AgentConfig = {
      name: "test-agent",
      channels: [],
      skills: [],
      effort: "low",
      heartbeat: true,
      schedules: [],
      admin: false,
      slashCommands: [],
      reactions: true,
      mcpServers: [{ name: "my-server", command: "node", args: ["server.js"], env: { API_KEY: "${TEST_API_KEY}" }, optional: false }],
    };

    const resolved = resolveAgentConfig(agent, defaults);
    expect(resolved.mcpServers[0].env.API_KEY).toBe("sk-test-999");
  });
});
