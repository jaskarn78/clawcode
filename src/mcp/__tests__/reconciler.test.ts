/**
 * Phase 999.15 Plan 00 — Wave 0 RED tests for reconcileAllAgents.
 *
 * Module under test: ../reconciler.js (DOES NOT EXIST AT WAVE 0).
 * GREEN ships in Plan 02 (TRACK-01, TRACK-04 implementation).
 *
 * Each test pins one behavior locked in CONTEXT.md `<specifics>` pseudocode +
 * RESEARCH.md Pattern 1+4 + the locked decisions:
 *
 *   - register signature: (agentName, claudePid, mcpPids) — orchestrator rec #2
 *   - discoverClaudeSubprocessPid opts: { minAge: 10 } — orchestrator rec #3
 *   - reason values: "stale-claude" | "missing-mcps" | "agent-restart" | "agent-gone"
 *   - canonical envelope: { component, action: "reconcile", agent, oldClaudePid,
 *     newClaudePid, oldMcpCount, newMcpCount, reason }
 *   - log messages: "tracker state reconciled" (state-change), "tracker entry
 *     dropped — claude proc gone" (agent-gone)
 *   - idempotent: zero log emissions and zero mutations on no-op cycles
 *   - error swallow: per-agent failure doesn't propagate
 *   - per-agent diff log on state change (not bulk-aggregated)
 *
 * Test architecture:
 *   - Mock ../proc-scan.js so isPidAlive + discoverClaudeSubprocessPid +
 *     discoverAgentMcpPids all return scripted values per test.
 *   - Fake McpProcessTracker — vi.fn() spies on the EXTENDED API surface
 *     (updateAgent, replaceMcpPids, unregister, getRegisteredAgents).
 *   - Real pino logger pointed at a captured-Writable so log-shape assertions
 *     are byte-precise on the JSON envelope.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";

// Hoisted mocks for proc-scan helpers (exists today: discoverClaudeSubprocessPid,
// discoverAgentMcpPids; ships in Plan 01: isPidAlive + the opts param on
// discoverClaudeSubprocessPid).
const {
  isPidAliveMock,
  discoverClaudeSubprocessPidMock,
  discoverAgentMcpPidsMock,
} = vi.hoisted(() => ({
  isPidAliveMock: vi.fn(),
  discoverClaudeSubprocessPidMock: vi.fn(),
  discoverAgentMcpPidsMock: vi.fn(),
}));

vi.mock("../proc-scan.js", async () => {
  const actual = await vi.importActual<typeof import("../proc-scan.js")>(
    "../proc-scan.js",
  );
  return {
    ...actual,
    // isPidAlive does not exist in 999.14 — Plan 01 adds it. The mock returns
    // it so the reconciler import resolves; runtime tests pin the export.
    isPidAlive: isPidAliveMock,
    discoverClaudeSubprocessPid: discoverClaudeSubprocessPidMock,
    discoverAgentMcpPids: discoverAgentMcpPidsMock,
  };
});

// IMPORTANT: This import will FAIL at Wave 0 because src/mcp/reconciler.ts
// does not exist yet. Plan 02 ships it. Until then, every test in this file
// errors at module-resolve time → that IS the RED state.
// @ts-expect-error — module ships in Plan 02 (TRACK-01, TRACK-04)
import { reconcileAllAgents } from "../reconciler.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type AgentEntry = {
  readonly claudePid: number;
  readonly mcpPids: readonly number[];
  readonly registeredAt: number;
};

interface FakeTracker {
  patterns: RegExp;
  getRegisteredAgents: ReturnType<typeof vi.fn>;
  updateAgent: ReturnType<typeof vi.fn>;
  replaceMcpPids: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
}

function makeTracker(entries: ReadonlyArray<readonly [string, AgentEntry]>): FakeTracker {
  const map = new Map<string, AgentEntry>(entries);
  const tracker: FakeTracker = {
    patterns: /mcp-server/,
    getRegisteredAgents: vi.fn(() => map),
    updateAgent: vi.fn((name: string, claudePid: number) => {
      const prev = map.get(name);
      if (prev) {
        map.set(name, { ...prev, claudePid });
      }
    }),
    replaceMcpPids: vi.fn((name: string, pids: readonly number[]) => {
      const prev = map.get(name);
      if (prev) {
        map.set(name, { ...prev, mcpPids: [...pids] });
      }
    }),
    unregister: vi.fn((name: string) => {
      const prev = map.get(name);
      map.delete(name);
      return prev ? [...prev.mcpPids] : [];
    }),
  };
  return tracker;
}

function captureLogger(): {
  log: pino.Logger;
  lines: () => Array<Record<string, unknown>>;
} {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const log = pino({ level: "debug" }, sink);
  const lines = () =>
    chunks
      .join("")
      .split("\n")
      .filter((s) => s.length > 0)
      .map((s) => JSON.parse(s) as Record<string, unknown>);
  return { log, lines };
}

const DAEMON_PID = 99_000;

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("reconcileAllAgents (Phase 999.15 Wave 0 — RED)", () => {
  beforeEach(() => {
    isPidAliveMock.mockReset();
    discoverClaudeSubprocessPidMock.mockReset();
    discoverAgentMcpPidsMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1: stale-claude → calls updateAgent + replaceMcpPids and emits one warn log", async () => {
    const tracker = makeTracker([
      ["A", { claudePid: 100, mcpPids: [], registeredAt: 1_700_000_000_000 }],
    ]);
    isPidAliveMock.mockReturnValue(false); // claudePid 100 dead
    discoverClaudeSubprocessPidMock.mockResolvedValue(200);
    discoverAgentMcpPidsMock.mockResolvedValue([201, 202]);

    const { log, lines } = captureLogger();
    await reconcileAllAgents({
      tracker: tracker as unknown as never,
      daemonPid: DAEMON_PID,
      log,
    });

    expect(tracker.updateAgent).toHaveBeenCalledWith("A", 200);
    expect(tracker.replaceMcpPids).toHaveBeenCalledWith("A", [201, 202]);

    // discoverClaudeSubprocessPid called with daemonPid + opts.minAge=10
    const call = discoverClaudeSubprocessPidMock.mock.calls[0];
    expect(call?.[0]).toBe(DAEMON_PID);
    expect(call?.[1]).toMatchObject({ minAge: 10 });

    const warns = lines().filter((l) => l.level === 40);
    expect(warns.length).toBe(1);
    expect(warns[0]!.reason).toBe("stale-claude");
    expect(warns[0]!.agent).toBe("A");
  });

  it("Test 2: missing-mcps → calls replaceMcpPids only (claude alive, mcpPids empty)", async () => {
    const tracker = makeTracker([
      ["A", { claudePid: 100, mcpPids: [], registeredAt: 1_700_000_000_000 }],
    ]);
    isPidAliveMock.mockReturnValue(true); // claudePid still alive
    discoverAgentMcpPidsMock.mockResolvedValue([301, 302, 303]);

    const { log, lines } = captureLogger();
    await reconcileAllAgents({
      tracker: tracker as unknown as never,
      daemonPid: DAEMON_PID,
      log,
    });

    expect(tracker.updateAgent).not.toHaveBeenCalled();
    expect(tracker.replaceMcpPids).toHaveBeenCalledWith("A", [301, 302, 303]);

    const warns = lines().filter((l) => l.level === 40);
    expect(warns.length).toBe(1);
    expect(warns[0]!.reason).toBe("missing-mcps");
  });

  it("Test 3: agent-gone → unregister + log, no updateAgent/replaceMcpPids", async () => {
    const tracker = makeTracker([
      ["A", { claudePid: 100, mcpPids: [], registeredAt: 1_700_000_000_000 }],
    ]);
    isPidAliveMock.mockReturnValue(false);
    discoverClaudeSubprocessPidMock.mockResolvedValue(null);

    const { log, lines } = captureLogger();
    await reconcileAllAgents({
      tracker: tracker as unknown as never,
      daemonPid: DAEMON_PID,
      log,
    });

    expect(tracker.unregister).toHaveBeenCalledWith("A");
    expect(tracker.updateAgent).not.toHaveBeenCalled();
    expect(tracker.replaceMcpPids).not.toHaveBeenCalled();

    const warns = lines().filter((l) => l.level === 40);
    expect(warns.length).toBe(1);
    expect(warns[0]!.reason).toBe("agent-gone");
    expect(warns[0]!.msg).toBe("tracker entry dropped — claude proc gone");
  });

  it("Test 4: idempotent — second cycle with no /proc change emits zero logs and zero mutations", async () => {
    // Tracker matches /proc state exactly: claudePid alive, mcpPids match
    // discoverAgentMcpPids return.
    const tracker = makeTracker([
      ["A", { claudePid: 100, mcpPids: [201, 202], registeredAt: 1_700_000_000_000 }],
    ]);
    isPidAliveMock.mockReturnValue(true);
    discoverAgentMcpPidsMock.mockResolvedValue([201, 202]);

    const { log, lines } = captureLogger();
    await reconcileAllAgents({
      tracker: tracker as unknown as never,
      daemonPid: DAEMON_PID,
      log,
    });
    await reconcileAllAgents({
      tracker: tracker as unknown as never,
      daemonPid: DAEMON_PID,
      log,
    });

    expect(tracker.updateAgent).not.toHaveBeenCalled();
    expect(tracker.replaceMcpPids).not.toHaveBeenCalled();
    expect(tracker.unregister).not.toHaveBeenCalled();
    const warns = lines().filter((l) => l.level === 40);
    expect(warns.length).toBe(0);
  });

  it("Test 5: error swallow — failure for one agent doesn't propagate, doesn't block siblings", async () => {
    const tracker = makeTracker([
      ["A", { claudePid: 100, mcpPids: [], registeredAt: 1_700_000_000_000 }],
      ["B", { claudePid: 110, mcpPids: [], registeredAt: 1_700_000_000_000 }],
    ]);
    isPidAliveMock.mockImplementation((pid: number) => pid === 110); // A dead, B alive
    discoverClaudeSubprocessPidMock.mockImplementation(async () => {
      // Only throw for the first call (agent A)
      throw new Error("simulated /proc failure for A");
    });
    discoverAgentMcpPidsMock.mockResolvedValue([311, 312]); // for agent B

    const { log, lines } = captureLogger();
    // MUST resolve — does not reject.
    await expect(
      reconcileAllAgents({
        tracker: tracker as unknown as never,
        daemonPid: DAEMON_PID,
        log,
      }),
    ).resolves.toBeUndefined();

    // Agent B should still be reconciled (missing-mcps path).
    expect(tracker.replaceMcpPids).toHaveBeenCalledWith("B", [311, 312]);

    const allLogs = lines();
    const errLikely = allLogs.find(
      (l) =>
        (l.level === 40 || l.level === 50) &&
        typeof l.err === "string" &&
        (l.agent === "A" || String(l.msg).includes("A")),
    );
    expect(errLikely).toBeDefined();
  });

  it("Test 6: one log per agent per cycle — 3 agents reconciled → 3 distinct warn logs", async () => {
    const tracker = makeTracker([
      ["A", { claudePid: 100, mcpPids: [], registeredAt: 1_700_000_000_000 }],
      ["B", { claudePid: 110, mcpPids: [], registeredAt: 1_700_000_000_000 }],
      ["C", { claudePid: 120, mcpPids: [], registeredAt: 1_700_000_000_000 }],
    ]);
    // All three claudePids dead — all three need stale-claude reconcile.
    isPidAliveMock.mockReturnValue(false);
    let callIdx = 0;
    discoverClaudeSubprocessPidMock.mockImplementation(async () => {
      callIdx += 1;
      return 200 + callIdx;
    });
    discoverAgentMcpPidsMock.mockImplementation(async (pid: number) => [pid + 1]);

    const { log, lines } = captureLogger();
    await reconcileAllAgents({
      tracker: tracker as unknown as never,
      daemonPid: DAEMON_PID,
      log,
    });

    const warns = lines().filter((l) => l.level === 40 && l.action === "reconcile");
    expect(warns.length).toBe(3);
    const agents = new Set(warns.map((w) => w.agent));
    expect(agents).toEqual(new Set(["A", "B", "C"]));
  });

  it("Test 7: log envelope — exact canonical keys + message string for state-change logs", async () => {
    const tracker = makeTracker([
      ["A", { claudePid: 100, mcpPids: [], registeredAt: 1_700_000_000_000 }],
    ]);
    isPidAliveMock.mockReturnValue(false);
    discoverClaudeSubprocessPidMock.mockResolvedValue(200);
    discoverAgentMcpPidsMock.mockResolvedValue([201, 202]);

    const { log, lines } = captureLogger();
    await reconcileAllAgents({
      tracker: tracker as unknown as never,
      daemonPid: DAEMON_PID,
      log,
    });

    const warns = lines().filter((l) => l.level === 40);
    expect(warns.length).toBe(1);
    const w = warns[0]!;
    expect(w.component).toBe("mcp-tracker");
    expect(w.action).toBe("reconcile");
    expect(w.agent).toBe("A");
    expect(w.oldClaudePid).toBe(100);
    expect(w.newClaudePid).toBe(200);
    expect(w.oldMcpCount).toBe(0);
    expect(w.newMcpCount).toBe(2);
    expect(w.reason).toBe("stale-claude");
    expect(w.msg).toBe("tracker state reconciled");
  });

  it("Test 8: no-op cycle emits zero logs (diff comparison empty)", async () => {
    const tracker = makeTracker([
      ["A", { claudePid: 100, mcpPids: [201, 202], registeredAt: 1_700_000_000_000 }],
    ]);
    isPidAliveMock.mockReturnValue(true);
    // Same set, possibly in a different order — sort-equality applies.
    discoverAgentMcpPidsMock.mockResolvedValue([202, 201]);

    const { log, lines } = captureLogger();
    await reconcileAllAgents({
      tracker: tracker as unknown as never,
      daemonPid: DAEMON_PID,
      log,
    });

    const warns = lines().filter((l) => l.level === 40);
    expect(warns.length).toBe(0);
  });

  it("Test 9: agent-restart — both claudePid and mcpPids change in one cycle", async () => {
    const tracker = makeTracker([
      ["A", { claudePid: 100, mcpPids: [201, 202], registeredAt: 1_700_000_000_000 }],
    ]);
    isPidAliveMock.mockReturnValue(false); // old claudePid dead
    discoverClaudeSubprocessPidMock.mockResolvedValue(300); // new claude
    discoverAgentMcpPidsMock.mockResolvedValue([301, 302]); // brand-new mcpPids

    const { log, lines } = captureLogger();
    await reconcileAllAgents({
      tracker: tracker as unknown as never,
      daemonPid: DAEMON_PID,
      log,
    });

    expect(tracker.updateAgent).toHaveBeenCalledWith("A", 300);
    expect(tracker.replaceMcpPids).toHaveBeenCalledWith("A", [301, 302]);

    const warns = lines().filter((l) => l.level === 40);
    expect(warns.length).toBe(1);
    // Per RESEARCH Pattern 4 diff classifier: when stale-claude AND mcpPids
    // also differs from prior, classify as agent-restart.
    expect(warns[0]!.reason).toBe("agent-restart");
  });
});
