import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CheckContext, CheckResult, HeartbeatConfig } from "../../types.js";
import type { McpServerState } from "../../../mcp/readiness.js";
import type { ResolvedAgentConfig } from "../../../shared/types.js";
import type { Registry } from "../../../manager/types.js";

/**
 * Phase 85 Plan 01 Task 2 — `mcp-reconnect` heartbeat check tests.
 *
 * Covers the four behavior scenarios from the plan:
 *   1. Steady-state: all MCPs ready → no state changes, status:"healthy"
 *      (heartbeat CheckStatus uses "healthy"|"warning"|"critical" — see
 *      src/heartbeat/types.ts — NOT "ok"|"warn" per the plan's
 *      initial description; our implementation maps accordingly).
 *   2. Degradation: server was ready, now fails → ready→degraded first
 *      tick, degraded→failed on subsequent tick; status:"warning" then
 *      "critical".
 *   3. Reconnect success: server was failed, probe succeeds → back to
 *      ready with failureCount reset.
 *   4. Reconnect cap + backoff: failureCount increments across ticks
 *      up to MAX_RECONNECTS_PER_CYCLE (3) without resetting — once the
 *      window-reset timer fires (5min) it starts a fresh count.
 */

// Mock the readiness module so tests drive the probe deterministically.
vi.mock("../../../mcp/readiness.js", async () => {
  const actual = await vi.importActual<typeof import("../../../mcp/readiness.js")>(
    "../../../mcp/readiness.js",
  );
  return {
    ...actual,
    performMcpReadinessHandshake: vi.fn(),
  };
});
import { performMcpReadinessHandshake } from "../../../mcp/readiness.js";
const mockedProbe = vi.mocked(performMcpReadinessHandshake);

import mcpReconnectCheck from "../mcp-reconnect.js";

// ---------------------------------------------------------------------------
// Helpers — stub context
// ---------------------------------------------------------------------------

function freezeState(s: Omit<McpServerState, "optional"> & { optional?: boolean }): McpServerState {
  return Object.freeze({
    ...s,
    optional: s.optional ?? false,
  });
}

function makeStub(opts: {
  agentConfig?: ResolvedAgentConfig;
  priorState?: Map<string, McpServerState>;
}) {
  const setCalls: Array<Map<string, McpServerState>> = [];
  const handleSetCalls: Array<Map<string, McpServerState>> = [];
  const fakeHandle = {
    setMcpState: (m: ReadonlyMap<string, McpServerState>) => {
      handleSetCalls.push(new Map(m));
    },
  };
  const sessionManager = {
    getAgentConfig: (_name: string) => opts.agentConfig,
    getMcpStateForAgent: (_name: string): ReadonlyMap<string, McpServerState> =>
      opts.priorState ?? new Map(),
    setMcpStateForAgent: (_name: string, m: ReadonlyMap<string, McpServerState>) => {
      setCalls.push(new Map(m));
    },
    sessions: new Map([["test-agent", fakeHandle]]),
  } as unknown as CheckContext["sessionManager"];

  const config: HeartbeatConfig = {
    enabled: true,
    intervalSeconds: 60,
    checkTimeoutSeconds: 10,
    contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75 },
  };

  const registry: Registry = { entries: [], updatedAt: Date.now() };

  const ctx: CheckContext = {
    agentName: "test-agent",
    sessionManager,
    registry,
    config,
  };
  return { ctx, setCalls, handleSetCalls };
}

function agentConfigWithMcps(mcpNames: string[]): ResolvedAgentConfig {
  return {
    name: "test-agent",
    workspace: "/tmp/test-agent",
    memoryPath: "/tmp/test-agent",
    channels: [],
    model: "sonnet",
    effort: "low",
    allowedModels: ["haiku", "sonnet", "opus"], // Phase 86 MODEL-01
    greetOnRestart: true, // Phase 89 GREET-07
    greetCoolDownMs: 300_000, // Phase 89 GREET-10
    memoryAutoLoad: true, // Phase 90 MEM-01
    memoryRetrievalTopK: 5, // Phase 90 MEM-03
    memoryScannerEnabled: true, // Phase 90 MEM-02
    memoryFlushIntervalMs: 900_000, // Phase 90 MEM-04
    memoryCueEmoji: "✅", // Phase 90 MEM-05
    skills: [],
    soul: undefined,
    identity: undefined,
    memory: {
      compactionThreshold: 0.75,
      searchTopK: 10,
      consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *" },
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
    mcpServers: mcpNames.map((name) => ({
      name,
      command: "x",
      args: [],
      env: {},
      optional: false,
    })),
    slashCommands: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mcp-reconnect heartbeat check", () => {
  beforeEach(() => {
    mockedProbe.mockReset();
  });

  afterEach(() => {
    mockedProbe.mockReset();
    vi.useRealTimers();
  });

  it("exports a CheckModule with the correct shape", () => {
    expect(mcpReconnectCheck.name).toBe("mcp-reconnect");
    expect(typeof mcpReconnectCheck.execute).toBe("function");
    expect(typeof mcpReconnectCheck.interval).toBe("number");
  });

  it("Test 0 — no MCPs configured → returns ok without probing", async () => {
    const { ctx } = makeStub({ agentConfig: agentConfigWithMcps([]) });
    const r: CheckResult = await mcpReconnectCheck.execute(ctx);
    expect(r.status).toBe("healthy");
    expect(r.message).toMatch(/no mcp/i);
    expect(mockedProbe).not.toHaveBeenCalled();
  });

  it("Test 1 — steady state: all ready → no state change, status healthy", async () => {
    const prior = new Map<string, McpServerState>([
      ["a", freezeState({ name: "a", status: "ready", lastSuccessAt: 1000, lastFailureAt: null, lastError: null, failureCount: 0 })],
      ["b", freezeState({ name: "b", status: "ready", lastSuccessAt: 1000, lastFailureAt: null, lastError: null, failureCount: 0 })],
    ]);
    mockedProbe.mockResolvedValue(
      Object.freeze({
        ready: true,
        stateByName: new Map([
          ["a", freezeState({ name: "a", status: "ready", lastSuccessAt: 2000, lastFailureAt: null, lastError: null, failureCount: 0 })],
          ["b", freezeState({ name: "b", status: "ready", lastSuccessAt: 2000, lastFailureAt: null, lastError: null, failureCount: 0 })],
        ]),
        errors: Object.freeze([]),
        optionalErrors: Object.freeze([]),
      }),
    );

    const { ctx, setCalls, handleSetCalls } = makeStub({
      agentConfig: agentConfigWithMcps(["a", "b"]),
      priorState: prior,
    });
    const r = await mcpReconnectCheck.execute(ctx);
    expect(r.status).toBe("healthy");
    expect(r.message).toContain("2 ready");
    expect(r.message).toContain("0 degraded");
    expect(r.message).toContain("0 failed");

    // Persisted state still has 2 ready entries with failureCount=0.
    expect(setCalls).toHaveLength(1);
    const persisted = setCalls[0]!;
    expect(persisted.get("a")!.status).toBe("ready");
    expect(persisted.get("a")!.failureCount).toBe(0);
    // Handle also updated.
    expect(handleSetCalls).toHaveLength(1);
  });

  it("Test 2a — degradation: previously ready, now failed → status warning, server state=degraded", async () => {
    const prior = new Map<string, McpServerState>([
      ["a", freezeState({ name: "a", status: "ready", lastSuccessAt: 1000, lastFailureAt: null, lastError: null, failureCount: 0 })],
    ]);
    mockedProbe.mockResolvedValue(
      Object.freeze({
        ready: false,
        stateByName: new Map([
          ["a", freezeState({ name: "a", status: "failed", lastSuccessAt: null, lastFailureAt: 2000, lastError: { message: "connection refused" }, failureCount: 1 })],
        ]),
        errors: Object.freeze(["mcp: a: connection refused"]),
        optionalErrors: Object.freeze([]),
      }),
    );

    const { ctx, setCalls } = makeStub({
      agentConfig: agentConfigWithMcps(["a"]),
      priorState: prior,
    });
    const r = await mcpReconnectCheck.execute(ctx);
    expect(r.status).toBe("warning");
    expect(r.message).toContain("1 degraded");

    const persisted = setCalls[0]!;
    const sa = persisted.get("a")!;
    expect(sa.status).toBe("degraded");
    expect(sa.failureCount).toBe(1);
    expect(sa.lastError!.message).toBe("connection refused");
    // lastSuccessAt preserved from prior so backoff window is computable.
    expect(sa.lastSuccessAt).toBe(1000);
  });

  it("Test 2b — still failed on next tick → status critical, failureCount increments, status=failed", async () => {
    // lastSuccessAt within the 5min backoff window so counter grows
    // instead of resetting.
    const recent = Date.now() - 30_000;
    const prior = new Map<string, McpServerState>([
      ["a", freezeState({ name: "a", status: "degraded", lastSuccessAt: recent, lastFailureAt: recent + 1000, lastError: { message: "connection refused" }, failureCount: 1 })],
    ]);
    mockedProbe.mockResolvedValue(
      Object.freeze({
        ready: false,
        stateByName: new Map([
          ["a", freezeState({ name: "a", status: "failed", lastSuccessAt: null, lastFailureAt: 3000, lastError: { message: "connection refused" }, failureCount: 1 })],
        ]),
        errors: Object.freeze(["mcp: a: connection refused"]),
        optionalErrors: Object.freeze([]),
      }),
    );

    const { ctx, setCalls } = makeStub({
      agentConfig: agentConfigWithMcps(["a"]),
      priorState: prior,
    });
    const r = await mcpReconnectCheck.execute(ctx);
    expect(r.status).toBe("critical");
    expect(r.message).toContain("1 failed");

    const persisted = setCalls[0]!;
    const sa = persisted.get("a")!;
    expect(sa.status).toBe("failed");
    // failureCount increments because it has been failing without a success.
    expect(sa.failureCount).toBeGreaterThan(1);
  });

  it("Test 3 — reconnect success: failed → ready, failureCount resets", async () => {
    const prior = new Map<string, McpServerState>([
      ["a", freezeState({ name: "a", status: "failed", lastSuccessAt: null, lastFailureAt: 2000, lastError: { message: "connection refused" }, failureCount: 3 })],
    ]);
    mockedProbe.mockResolvedValue(
      Object.freeze({
        ready: true,
        stateByName: new Map([
          ["a", freezeState({ name: "a", status: "ready", lastSuccessAt: 5000, lastFailureAt: null, lastError: null, failureCount: 0 })],
        ]),
        errors: Object.freeze([]),
        optionalErrors: Object.freeze([]),
      }),
    );

    const { ctx, setCalls } = makeStub({
      agentConfig: agentConfigWithMcps(["a"]),
      priorState: prior,
    });
    const r = await mcpReconnectCheck.execute(ctx);
    expect(r.status).toBe("healthy");

    const persisted = setCalls[0]!;
    const sa = persisted.get("a")!;
    expect(sa.status).toBe("ready");
    expect(sa.failureCount).toBe(0);
    expect(sa.lastError).toBeNull();
    expect(sa.lastSuccessAt).toBe(5000);
  });

  it("Test 4 — bounded failureCount: within backoff window, count increments monotonically", async () => {
    // lastSuccessAt within the 5min backoff window so counter grows.
    const recent = Date.now() - 30_000;
    const prior = new Map<string, McpServerState>([
      ["a", freezeState({ name: "a", status: "degraded", lastSuccessAt: recent, lastFailureAt: recent + 1000, lastError: { message: "e" }, failureCount: 2 })],
    ]);
    mockedProbe.mockResolvedValue(
      Object.freeze({
        ready: false,
        stateByName: new Map([
          ["a", freezeState({ name: "a", status: "failed", lastSuccessAt: null, lastFailureAt: 3000, lastError: { message: "e" }, failureCount: 1 })],
        ]),
        errors: Object.freeze(["mcp: a: e"]),
        optionalErrors: Object.freeze([]),
      }),
    );

    const { ctx, setCalls } = makeStub({
      agentConfig: agentConfigWithMcps(["a"]),
      priorState: prior,
    });
    await mcpReconnectCheck.execute(ctx);
    const sa = setCalls[0]!.get("a")!;
    // Prior count was 2; lastSuccessAt is recent (within 5min window)
    // so merged count grows to 3.
    expect(sa.failureCount).toBeGreaterThanOrEqual(3);
  });

  it("Test 4b — backoff window expiry: old lastSuccessAt → failureCount recycles to 1", async () => {
    // lastSuccessAt far in the past (> 5min) so counter resets.
    const old = Date.now() - 10 * 60_000;
    const prior = new Map<string, McpServerState>([
      ["a", freezeState({ name: "a", status: "failed", lastSuccessAt: old, lastFailureAt: Date.now() - 1000, lastError: { message: "e" }, failureCount: 7 })],
    ]);
    mockedProbe.mockResolvedValue(
      Object.freeze({
        ready: false,
        stateByName: new Map([
          ["a", freezeState({ name: "a", status: "failed", lastSuccessAt: null, lastFailureAt: Date.now(), lastError: { message: "e" }, failureCount: 1 })],
        ]),
        errors: Object.freeze(["mcp: a: e"]),
        optionalErrors: Object.freeze([]),
      }),
    );
    const { ctx, setCalls } = makeStub({
      agentConfig: agentConfigWithMcps(["a"]),
      priorState: prior,
    });
    await mcpReconnectCheck.execute(ctx);
    expect(setCalls[0]!.get("a")!.failureCount).toBe(1);
  });

  it("Phase 94 Plan 01 — capabilityProbe field populated after tick (status='ready' for connect-ok server)", async () => {
    // After the connect-test classifies a server as ready, the heartbeat
    // also writes a capabilityProbe snapshot. Until Plan 94-03 wires real
    // callTool, the probe falls through the default-fallback-via-listTools
    // stub and reports ready (we trust connect-test as a capability proxy).
    const prior = new Map<string, McpServerState>([
      ["a", freezeState({ name: "a", status: "ready", lastSuccessAt: 1000, lastFailureAt: null, lastError: null, failureCount: 0 })],
    ]);
    mockedProbe.mockResolvedValue(
      Object.freeze({
        ready: true,
        stateByName: new Map([
          ["a", freezeState({ name: "a", status: "ready", lastSuccessAt: 5000, lastFailureAt: null, lastError: null, failureCount: 0 })],
        ]),
        errors: Object.freeze([]),
        optionalErrors: Object.freeze([]),
      }),
    );

    const { ctx, setCalls } = makeStub({
      agentConfig: agentConfigWithMcps(["a"]),
      priorState: prior,
    });
    await mcpReconnectCheck.execute(ctx);

    const persisted = setCalls[0]!;
    const sa = persisted.get("a")!;
    expect(sa.capabilityProbe).toBeDefined();
    expect(sa.capabilityProbe!.status).toBe("ready");
    expect(typeof sa.capabilityProbe!.lastRunAt).toBe("string");
    // ISO8601-ish format check
    expect(sa.capabilityProbe!.lastRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // ready outcome → lastSuccessAt set to now
    expect(sa.capabilityProbe!.lastSuccessAt).toBeDefined();
  });

  it("Phase 94 Plan 01 — connect-fail short-circuit: capabilityProbe.status='failed' mirrors connect-test, no probe spawned for failed", async () => {
    const prior = new Map<string, McpServerState>();
    mockedProbe.mockResolvedValue(
      Object.freeze({
        ready: false,
        stateByName: new Map([
          ["a", freezeState({ name: "a", status: "failed", lastSuccessAt: null, lastFailureAt: 5000, lastError: { message: "connection refused" }, failureCount: 1 })],
        ]),
        errors: Object.freeze(["mcp: a: connection refused"]),
        optionalErrors: Object.freeze([]),
      }),
    );

    const { ctx, setCalls } = makeStub({
      agentConfig: agentConfigWithMcps(["a"]),
      priorState: prior,
    });
    await mcpReconnectCheck.execute(ctx);

    const persisted = setCalls[0]!;
    const sa = persisted.get("a")!;
    expect(sa.capabilityProbe).toBeDefined();
    // Connect-fail mirrors directly into capabilityProbe.status="failed"
    // without running the per-server probe.
    expect(sa.capabilityProbe!.status).toBe("failed");
    // Verbatim error pass-through (Phase 85 TOOL-04)
    expect(sa.capabilityProbe!.error).toBe("connection refused");
  });

  it("Test 5 — optional server failure is classified (still ready OK, optional surfaces)", async () => {
    const prior = new Map<string, McpServerState>([
      ["good", freezeState({ name: "good", status: "ready", lastSuccessAt: 1000, lastFailureAt: null, lastError: null, failureCount: 0 })],
      ["opt", freezeState({ name: "opt", status: "ready", lastSuccessAt: 1000, lastFailureAt: null, lastError: null, failureCount: 0, optional: true })],
    ]);
    mockedProbe.mockResolvedValue(
      Object.freeze({
        ready: true, // optional failures don't flip ready to false
        stateByName: new Map([
          ["good", freezeState({ name: "good", status: "ready", lastSuccessAt: 5000, lastFailureAt: null, lastError: null, failureCount: 0 })],
          ["opt", freezeState({ name: "opt", status: "failed", lastSuccessAt: null, lastFailureAt: 5000, lastError: { message: "auth refused" }, failureCount: 1, optional: true })],
        ]),
        errors: Object.freeze([]),
        optionalErrors: Object.freeze(["mcp: opt: auth refused"]),
      }),
    );

    const { ctx, setCalls } = makeStub({
      agentConfig: agentConfigWithMcps(["good", "opt"]),
      priorState: prior,
    });
    const r = await mcpReconnectCheck.execute(ctx);
    // Optional failure is still surfaced in the message but does not
    // transition good to anything; status maps from the good ready + opt
    // failed combination.
    expect(r.message).toContain("1 ready");
    const persisted = setCalls[0]!;
    const optState = persisted.get("opt")!;
    expect(optState.optional).toBe(true);
    expect(optState.status).toBe("degraded");
  });
});
