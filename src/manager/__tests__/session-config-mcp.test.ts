import { describe, it, expect, vi } from "vitest";
import { buildSessionConfig, type SessionConfigDeps } from "../session-config.js";
import {
  MCP_PREAUTH_STATEMENT,
  MCP_VERBATIM_ERROR_RULE,
} from "../mcp-prompt-block.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";
import type { McpServerState } from "../../mcp/readiness.js";

/**
 * Phase 85 Plan 02 — integration tests pinning that the MCP block lands in
 * the STABLE PREFIX (TOOL-07) and that end-to-end state pass-through works
 * from SessionManager.getMcpStateForAgent → mcpStateProvider → renderMcpPromptBlock.
 */

// Mock filesystem reads so buildSessionConfig doesn't hit disk.
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
}));

vi.mock("../../memory/context-summary.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../memory/context-summary.js")
  >();
  return {
    ...actual,
    loadLatestSummary: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../bootstrap/prompt-builder.js", () => ({
  buildBootstrapPrompt: vi.fn().mockReturnValue("bootstrap prompt"),
}));

function makeConfig(
  overrides: Partial<ResolvedAgentConfig> = {},
): ResolvedAgentConfig {
  return {
    name: "test-agent",
    workspace: "/tmp/test-workspace",
    memoryPath: "/tmp/test-workspace",
    channels: [],
    model: "sonnet",
    effort: "low",
    allowedModels: ["haiku", "sonnet", "opus"], // Phase 86 MODEL-01
    greetOnRestart: true, // Phase 89 GREET-07
    greetCoolDownMs: 300_000, // Phase 89 GREET-10
    skills: [],
    soul: undefined,
    identity: undefined,
    memory: {
      compactionThreshold: 0.75,
      searchTopK: 10,
      consolidation: {
        enabled: true,
        weeklyThreshold: 7,
        monthlyThreshold: 4,
        schedule: "0 3 * * *",
      },
      decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 },
      deduplication: { enabled: true, similarityThreshold: 0.85 },
    },
    schedules: [],
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75 },
    },
    skillsPath: "/tmp/skills",
    admin: false,
    subagentModel: undefined,
    threads: { idleTimeoutMinutes: 30, maxThreadSessions: 5 },
    reactions: false,
    slashCommands: [],
    mcpServers: [],
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<SessionConfigDeps> = {},
): SessionConfigDeps {
  return {
    tierManagers: new Map(),
    skillsCatalog: new Map(),
    allAgentConfigs: [],
    ...overrides,
  };
}

function makeState(
  overrides: Partial<McpServerState> & { name: string },
): McpServerState {
  return Object.freeze({
    name: overrides.name,
    status: overrides.status ?? "ready",
    lastSuccessAt: overrides.lastSuccessAt ?? 1_700_000_000_000,
    lastFailureAt: overrides.lastFailureAt ?? null,
    lastError: overrides.lastError ?? null,
    failureCount: overrides.failureCount ?? 0,
    optional: overrides.optional ?? false,
  });
}

describe("session-config MCP block — TOOL-07 stable-prefix placement", () => {
  it("Test 1: preauth + verbatim-error rule land in systemPrompt (stable prefix), NOT in mutableSuffix", async () => {
    const config = makeConfig({
      mcpServers: [
        { name: "a", command: "x", args: [], env: {}, optional: false },
        { name: "b", command: "y", args: [], env: {}, optional: false },
      ],
    });
    const stateByName = Object.freeze(
      new Map<string, McpServerState>([
        ["a", makeState({ name: "a", status: "ready" })],
        ["b", makeState({ name: "b", status: "ready" })],
      ]),
    );
    const deps = makeDeps({
      mcpStateProvider: () => stateByName,
    });
    const result = await buildSessionConfig(config, deps);

    expect(result.systemPrompt).toContain(MCP_PREAUTH_STATEMENT);
    expect(result.systemPrompt).toContain(MCP_VERBATIM_ERROR_RULE);
    expect(result.systemPrompt).toContain("| Server | Status | Tools | Last Error |");

    const mutable = result.mutableSuffix ?? "";
    expect(mutable).not.toContain(MCP_PREAUTH_STATEMENT);
    expect(mutable).not.toContain(MCP_VERBATIM_ERROR_RULE);
  });
});

describe("session-config MCP block — empty-servers case", () => {
  it("Test 2: agent with zero MCP servers produces a prompt WITHOUT the preauth block", async () => {
    const config = makeConfig({ mcpServers: [] });
    const result = await buildSessionConfig(config, makeDeps());

    expect(result.systemPrompt).not.toContain("MCP tools are pre-authenticated");
    expect(result.systemPrompt).not.toContain(
      "| Server | Status | Tools | Last Error |",
    );
  });
});

describe("session-config MCP block — state provider end-to-end", () => {
  it("Test 3: lastError.message from the state provider flows verbatim into the prompt", async () => {
    const config = makeConfig({
      mcpServers: [
        { name: "a", command: "x", args: [], env: {}, optional: false },
      ],
    });
    const stateByName = new Map<string, McpServerState>([
      [
        "a",
        makeState({
          name: "a",
          status: "failed",
          lastError: { message: "verbatim-123" },
        }),
      ],
    ]);
    const deps = makeDeps({
      mcpStateProvider: () => stateByName,
    });
    const result = await buildSessionConfig(config, deps);

    expect(result.systemPrompt).toContain("verbatim-123");
  });

  it("uses an empty state map when mcpStateProvider is not supplied — renders status 'unknown'", async () => {
    const config = makeConfig({
      mcpServers: [
        { name: "a", command: "x", args: [], env: {}, optional: false },
      ],
    });
    // No mcpStateProvider on deps.
    const result = await buildSessionConfig(config, makeDeps());
    expect(result.systemPrompt).toMatch(/\| a \| unknown \|/);
  });
});

describe("session-config MCP block — cache discipline (TOOL-07)", () => {
  it("Test 4: two calls with the SAME state produce byte-identical systemPrompt (cache stability)", async () => {
    const config = makeConfig({
      mcpServers: [
        { name: "a", command: "x", args: [], env: {}, optional: false },
      ],
    });
    const state = new Map<string, McpServerState>([
      ["a", makeState({ name: "a", status: "ready" })],
    ]);
    const deps = makeDeps({ mcpStateProvider: () => state });
    const r1 = await buildSessionConfig(config, deps);
    const r2 = await buildSessionConfig(config, deps);
    expect(r1.systemPrompt).toBe(r2.systemPrompt);
  });

  it("Test 5: state change (ready → failed) DOES change the systemPrompt (cache invalidation on purpose)", async () => {
    const config = makeConfig({
      mcpServers: [
        { name: "a", command: "x", args: [], env: {}, optional: false },
      ],
    });
    const readyState = new Map<string, McpServerState>([
      ["a", makeState({ name: "a", status: "ready" })],
    ]);
    const failedState = new Map<string, McpServerState>([
      [
        "a",
        makeState({
          name: "a",
          status: "failed",
          lastError: { message: "ENOENT" },
        }),
      ],
    ]);

    const r1 = await buildSessionConfig(
      config,
      makeDeps({ mcpStateProvider: () => readyState }),
    );
    const r2 = await buildSessionConfig(
      config,
      makeDeps({ mcpStateProvider: () => failedState }),
    );
    expect(r1.systemPrompt).not.toBe(r2.systemPrompt);
    expect(r1.systemPrompt).toMatch(/\| a \| ready \|/);
    expect(r2.systemPrompt).toMatch(/\| a \| failed \|/);
    expect(r2.systemPrompt).toContain("ENOENT");
  });
});

describe("session-config MCP block — Pitfall 12 closure", () => {
  it("replacing the legacy bullet-list removes command/args leak from the prompt", async () => {
    const config = makeConfig({
      mcpServers: [
        {
          name: "leaky",
          command: "/usr/bin/secret-binary",
          args: ["--api-key", "SECRET-IN-ARGS"],
          env: { OP_TOKEN: "SECRET-ENV-VALUE" },
          optional: false,
        },
      ],
    });
    const state = new Map<string, McpServerState>([
      ["leaky", makeState({ name: "leaky", status: "ready" })],
    ]);
    const result = await buildSessionConfig(
      config,
      makeDeps({ mcpStateProvider: () => state }),
    );
    expect(result.systemPrompt).not.toContain("/usr/bin/secret-binary");
    expect(result.systemPrompt).not.toContain("SECRET-IN-ARGS");
    expect(result.systemPrompt).not.toContain("SECRET-ENV-VALUE");
    expect(result.systemPrompt).not.toContain("--api-key");
    // Name-only rendering survives — the server name IS expected to appear.
    expect(result.systemPrompt).toContain("leaky");
  });
});
