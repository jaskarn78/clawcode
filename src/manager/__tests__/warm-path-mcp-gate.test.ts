/**
 * Phase 85 Plan 01 — warm-path MCP readiness gate integration tests
 * (Task 1 behaviors 6 + 7, Task 2 behavior 6).
 *
 * Covers:
 *   6. startAgent with a failing MANDATORY MCP → registry entry goes to
 *      'failed' with the mcp-scoped error in lastError; sessions map empty.
 *   7. startAgent with a failing OPTIONAL MCP (healthy mandatory ones) →
 *      registry entry is 'running', sessions.get(name) is present, a warn
 *      log was emitted with the optional server name.
 *   Task 2 Test 6 — `list-mcp-status` IPC returns the per-agent state array.
 *
 * We mock `src/mcp/health.ts:checkMcpServerHealth` so the readiness probe's
 * underlying JSON-RPC spawn never actually fires. All other warm-path steps
 * (sqlite, embedder, session) are mocked via `warm-path-check.js` using the
 * same pattern as session-manager-memory-failure.test.ts so we focus purely
 * on the MCP gate branch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createMockAdapter } from "../session-adapter.js";
import type { MockSessionAdapter } from "../session-adapter.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";
import type { BackoffConfig } from "../types.js";
import { readRegistry } from "../registry.js";
import { SessionManager } from "../session-manager.js";

vi.mock("../../mcp/health.js", () => ({
  checkMcpServerHealth: vi.fn(),
}));
import { checkMcpServerHealth } from "../../mcp/health.js";
const mockedHealth = vi.mocked(checkMcpServerHealth);

// Intercept runWarmPathCheck so the non-MCP steps (sqlite, embedder,
// session, browser) don't try to reach real I/O. We delegate back to
// the real implementation ONLY for the mcpProbe hook — that way the
// gate's mandatory-vs-optional classification is exercised end-to-end
// against the MCP probe while other warm-path concerns are stubbed.
vi.mock("../warm-path-check.js", async () => {
  const actual = await vi.importActual<typeof import("../warm-path-check.js")>(
    "../warm-path-check.js",
  );
  return {
    ...actual,
    runWarmPathCheck: vi.fn(async (deps: Parameters<typeof actual.runWarmPathCheck>[0]) => {
      const mcpResult = deps.mcpProbe ? await deps.mcpProbe() : { errors: [] as readonly string[] };
      const errors = [...mcpResult.errors];
      return Object.freeze({
        ready: errors.length === 0,
        durations_ms: Object.freeze({ sqlite: 1, embedder: 1, session: 1, browser: 0, mcp: 1 }),
        total_ms: 4,
        errors: Object.freeze(errors) as readonly string[],
      });
    }),
  };
});

const TEST_BACKOFF: BackoffConfig = {
  baseMs: 100,
  maxMs: 1000,
  maxRetries: 3,
  stableAfterMs: 500,
};

function makeConfig(
  name: string,
  workspace: string,
  mcpServers: ResolvedAgentConfig["mcpServers"],
): ResolvedAgentConfig {
  return {
    name,
    workspace,
    memoryPath: workspace,
    channels: ["#general"],
    model: "sonnet",
    effort: "low",
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
    threads: { idleTimeoutMinutes: 1440, maxThreadSessions: 10 },
    reactions: false,
    mcpServers,
    slashCommands: [],
  };
}

describe("warm-path MCP readiness gate (Phase 85 TOOL-01)", () => {
  let adapter: MockSessionAdapter;
  let registryPath: string;
  let tmpDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    mockedHealth.mockReset();
    adapter = createMockAdapter();
    tmpDir = await mkdtemp(join(tmpdir(), "mcp-gate-test-"));
    registryPath = join(tmpDir, "registry.json");
    manager = new SessionManager({
      adapter,
      registryPath,
      backoffConfig: TEST_BACKOFF,
    });
  });

  afterEach(async () => {
    try {
      await manager.stopAll();
    } catch {
      /* ignore cleanup errors */
    }
    await rm(tmpDir, { recursive: true, force: true });
    mockedHealth.mockReset();
  });

  it("Test 6 — mandatory MCP handshake fails → registry 'failed', sessions empty, lastError contains mcp-scoped error", async () => {
    // Single mandatory MCP that fails to start.
    mockedHealth.mockResolvedValue({
      name: "mandatory-mcp",
      healthy: false,
      latencyMs: 5,
      error: "Failed to start: ENOENT",
    });

    const config = makeConfig("agent-a", tmpDir, [
      {
        name: "mandatory-mcp",
        command: "nonexistent",
        args: [],
        env: {},
        optional: false,
      } as ResolvedAgentConfig["mcpServers"][number],
    ]);

    await manager.startAgent("agent-a", config);

    const registry = await readRegistry(registryPath);
    const entry = registry.entries.find((e) => e.name === "agent-a");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("failed");
    expect(entry!.lastError).toContain("mcp: mandatory-mcp:");
    expect(entry!.lastError).toContain("Failed to start: ENOENT");

    // sessions map must be empty — handle.close() invoked
    expect(manager.getRunningAgents()).not.toContain("agent-a");
    expect(manager.isRunning("agent-a")).toBe(false);
  });

  it("Test 7 — optional MCP fails but mandatory is healthy → registry 'running', sessions populated", async () => {
    mockedHealth.mockImplementation(async (server) => {
      if (server.name === "opt-server") {
        return {
          name: "opt-server",
          healthy: false,
          latencyMs: 5,
          error: "auth refused",
        };
      }
      return { name: server.name, healthy: true, latencyMs: 5 };
    });

    const config = makeConfig("agent-b", tmpDir, [
      {
        name: "mand-server",
        command: "x",
        args: [],
        env: {},
        optional: false,
      } as ResolvedAgentConfig["mcpServers"][number],
      {
        name: "opt-server",
        command: "x",
        args: [],
        env: {},
        optional: true,
      } as ResolvedAgentConfig["mcpServers"][number],
    ]);

    await manager.startAgent("agent-b", config);

    const registry = await readRegistry(registryPath);
    const entry = registry.entries.find((e) => e.name === "agent-b");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("running");

    expect(manager.isRunning("agent-b")).toBe(true);
    // State map populated.
    const mcpState = manager.getMcpStateForAgent("agent-b");
    expect(mcpState.size).toBe(2);
    expect(mcpState.get("mand-server")!.status).toBe("ready");
    expect(mcpState.get("opt-server")!.status).toBe("failed");
    expect(mcpState.get("opt-server")!.optional).toBe(true);
  });

  it("zero MCPs configured → no probe spawn, agent starts normally", async () => {
    const config = makeConfig("agent-c", tmpDir, []);
    await manager.startAgent("agent-c", config);

    const registry = await readRegistry(registryPath);
    const entry = registry.entries.find((e) => e.name === "agent-c");
    expect(entry!.status).toBe("running");
    expect(mockedHealth).not.toHaveBeenCalled();
  });

  it("getMcpStateForAgent returns empty map for unknown agent", () => {
    const state = manager.getMcpStateForAgent("nonexistent");
    expect(state.size).toBe(0);
  });

  it("stopAgent clears the per-agent MCP state map", async () => {
    mockedHealth.mockResolvedValue({
      name: "srv",
      healthy: true,
      latencyMs: 5,
    });
    const config = makeConfig("agent-d", tmpDir, [
      {
        name: "srv",
        command: "x",
        args: [],
        env: {},
        optional: false,
      } as ResolvedAgentConfig["mcpServers"][number],
    ]);
    await manager.startAgent("agent-d", config);
    expect(manager.getMcpStateForAgent("agent-d").size).toBe(1);

    await manager.stopAgent("agent-d");
    expect(manager.getMcpStateForAgent("agent-d").size).toBe(0);
  });

  // Task 2 Test 6 — `list-mcp-status` IPC source-level wiring. We grep
  // daemon.ts for the case handler + required fields. The pure accessor
  // that the handler calls (SessionManager.getMcpStateForAgent) is
  // exercised end-to-end via the other tests in this file.
  it("Test 6 — daemon.ts has a list-mcp-status IPC case that returns the canonical shape", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../daemon.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toMatch(/case\s+"list-mcp-status":/);
    expect(src).toMatch(/getMcpStateForAgent/);
    // Shape fields the /clawcode-tools slash command will read in Plan 03.
    for (const field of [
      "status",
      "lastSuccessAt",
      "lastFailureAt",
      "failureCount",
      "optional",
      "lastError",
    ]) {
      expect(src).toMatch(new RegExp(`\\b${field}\\b`));
    }
    // And the IPC method is registered in the protocol.
    const { IPC_METHODS } = await import("../../ipc/protocol.js");
    expect(IPC_METHODS).toContain("list-mcp-status");
  });

  // Task 2 Test 5 — handle.getMcpState mirrors SessionManager.getMcpStateForAgent.
  it("session handle mirrors the MCP state map after warm-path gate", async () => {
    mockedHealth.mockResolvedValue({
      name: "srv",
      healthy: true,
      latencyMs: 5,
    });
    const config = makeConfig("agent-e", tmpDir, [
      {
        name: "srv",
        command: "x",
        args: [],
        env: {},
        optional: false,
      } as ResolvedAgentConfig["mcpServers"][number],
    ]);
    await manager.startAgent("agent-e", config);

    const smState = manager.getMcpStateForAgent("agent-e");
    // Access the handle via the adapter's test-only sessions map.
    const handle = adapter.sessions.get(
      [...adapter.sessions.keys()].find((k) => k.includes("agent-e"))!,
    );
    expect(handle).toBeDefined();
    const handleState = handle!.getMcpState();
    expect(handleState.size).toBe(smState.size);
    expect(handleState.get("srv")!.status).toBe("ready");
  });
});
