// RED — Phase 108-00 — Wave 0 scaffolding. Production target: src/mcp/broker/broker.ts.
/**
 * Phase 108 Plan 00 — OnePasswordMcpBroker RED tests.
 *
 * Pins control-plane behavior for the broker that owns one PooledChild
 * per service-account token and fans agent connections onto the shared
 * children:
 *
 *   - Token grouping (POOL-01): N agents on token A + M agents on token
 *     B → exactly 2 PooledChild instances spawned.
 *   - Last-ref SIGTERM with drain (POOL-04 / Pitfall 3): when last agent
 *     disconnects, broker waits up to 2s for inflight to drain, then
 *     SIGTERMs the child. If drain ceiling is hit, in-flight calls are
 *     failed with a structured error BEFORE the kill.
 *   - Auto-respawn on crash (POOL-04): broker spawns new child within 2s
 *     of pool exit if any agent connections are still attached.
 *   - Per-agent semaphore (POOL-05): max 4 concurrent in-flight per agent;
 *     5th queues FIFO until one completes.
 *   - Audit log fields (POOL-06): every dispatched call emits a pino line
 *     with component, pool, agent, turnId, tool fields.
 *   - Token redaction (Phase 104 SEC-07): no log line ever contains the
 *     literal token string.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";

import { FakePooledChild } from "../../../../tests/__fakes__/fake-pooled-child.js";

// Production target — does NOT exist yet (intentional RED at import).
import {
  OnePasswordMcpBroker,
  type BrokerDeps,
  type BrokerSpawnFn,
  type BrokerAgentConnection,
  BROKER_ERROR_CODE_DRAIN_TIMEOUT,
} from "../broker.js";

const TEST_TOKEN_LITERAL = "ops_TESTTOKEN_FAKE_XYZ";
const TEST_TOKEN_LITERAL_B = "ops_TESTTOKEN_FAKE_QQQ";

type CapturedLog = ReturnType<typeof captureLogger>;

function captureLogger() {
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
  const raw = () => chunks.join("");
  return { log, lines, raw };
}

/**
 * Build a spawnFn that returns a fresh FakePooledChild per call. Tracks
 * every spawn so tests can assert pool cardinality.
 */
function makeSpawnFn(): {
  spawnFn: BrokerSpawnFn;
  spawned: FakePooledChild[];
} {
  const spawned: FakePooledChild[] = [];
  const spawnFn: BrokerSpawnFn = (_args) => {
    const child = new FakePooledChild();
    spawned.push(child);
    return child as unknown as import("node:child_process").ChildProcess;
  };
  return { spawnFn, spawned };
}

/**
 * Minimal BrokerAgentConnection fake. Captures everything the broker
 * sends back to the agent so tests can assert the per-agent stream.
 */
function makeAgentConn(
  agentName: string,
  tokenHash: string,
  rawToken: string,
): BrokerAgentConnection & {
  received: Array<Record<string, unknown>>;
  closeListeners: Array<() => void>;
  triggerClose: () => void;
} {
  const received: Array<Record<string, unknown>> = [];
  const closeListeners: Array<() => void> = [];
  const conn: BrokerAgentConnection = {
    agentName,
    tokenHash,
    rawToken, // broker MUST NOT log this
    send(msg) {
      received.push(msg as Record<string, unknown>);
    },
    onClose(fn) {
      closeListeners.push(fn);
    },
  };
  return Object.assign(conn, {
    received,
    closeListeners,
    triggerClose: () => {
      for (const fn of closeListeners) fn();
    },
  });
}

describe("Broker — token grouping (POOL-01)", () => {
  let cap: CapturedLog;

  beforeEach(() => {
    cap = captureLogger();
  });

  it("three agents on token A and one agent on token B spawn exactly 2 pool children", async () => {
    const { spawnFn, spawned } = makeSpawnFn();
    const broker = new OnePasswordMcpBroker({
      log: cap.log,
      spawnFn,
    } satisfies BrokerDeps);

    const a1 = makeAgentConn("agent-a1", "tokenA01", TEST_TOKEN_LITERAL);
    const a2 = makeAgentConn("agent-a2", "tokenA01", TEST_TOKEN_LITERAL);
    const a3 = makeAgentConn("agent-a3", "tokenA01", TEST_TOKEN_LITERAL);
    const b1 = makeAgentConn("agent-b1", "tokenB02", TEST_TOKEN_LITERAL_B);

    await broker.acceptConnection(a1);
    await broker.acceptConnection(a2);
    await broker.acceptConnection(a3);
    await broker.acceptConnection(b1);

    expect(spawned).toHaveLength(2);
    // Pool status reflects two distinct tokenHashes.
    const status = broker.getPoolStatus();
    expect(status).toHaveLength(2);
    const hashes = status.map((s) => s.tokenHash).sort();
    expect(hashes).toEqual(["tokenA01", "tokenB02"]);
    const refsByHash = Object.fromEntries(status.map((s) => [s.tokenHash, s.agentRefCount]));
    expect(refsByHash).toEqual({ tokenA01: 3, tokenB02: 1 });
  });

  it("broker does not cross-route between token pools", async () => {
    const { spawnFn, spawned } = makeSpawnFn();
    const broker = new OnePasswordMcpBroker({ log: cap.log, spawnFn });

    const a = makeAgentConn("agent-a", "tokenA01", TEST_TOKEN_LITERAL);
    const b = makeAgentConn("agent-b", "tokenB02", TEST_TOKEN_LITERAL_B);
    await broker.acceptConnection(a);
    await broker.acceptConnection(b);

    expect(spawned).toHaveLength(2);
    const [childA, childB] = spawned;

    // Agent A dispatches a tools/call.
    await broker.handleAgentMessage(a, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "password_read" },
    });

    // Only childA (the one spawned for tokenA01) should have received the
    // dispatch. childB stdin must be untouched.
    expect(childA!.consumeStdinJson()).toHaveLength(1);
    expect(childB!.consumeStdinJson()).toHaveLength(0);
  });
});

describe("Broker — last-ref SIGTERM with drain (POOL-04, Pitfall 3)", () => {
  let cap: CapturedLog;
  beforeEach(() => {
    cap = captureLogger();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("last-ref disconnect waits up to 2s for inflight to drain, then SIGTERMs the child", async () => {
    const { spawnFn, spawned } = makeSpawnFn();
    const broker = new OnePasswordMcpBroker({ log: cap.log, spawnFn });

    const a = makeAgentConn("agent-a", "tokenA01", TEST_TOKEN_LITERAL);
    await broker.acceptConnection(a);
    expect(spawned).toHaveLength(1);
    const child = spawned[0]!;

    // One in-flight call.
    await broker.handleAgentMessage(a, {
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: { name: "password_read" },
    });
    expect(child.consumeStdinJson()).toHaveLength(1);

    // Agent disconnects — broker decrements ref to 0.
    a.triggerClose();

    // Within 100ms broker should NOT have killed yet (waiting for drain).
    await vi.advanceTimersByTimeAsync(100);
    expect(child.killCallCount).toBe(0);

    // Drain ceiling is 2s — at 2s mark broker MUST have failed inflight
    // with structured error AND SIGTERMed the child.
    await vi.advanceTimersByTimeAsync(2000);

    expect(a.received).toHaveLength(1);
    const errMsg = a.received[0]!;
    expect(errMsg.id).toBe(42);
    expect((errMsg.error as { code: number }).code).toBe(BROKER_ERROR_CODE_DRAIN_TIMEOUT);
    expect(child.killCallCount).toBe(1);
    expect(child.lastKillSignal).toBe("SIGTERM");
  });

  it("if inflight drains before ceiling, SIGTERM fires immediately after the last response", async () => {
    const { spawnFn, spawned } = makeSpawnFn();
    const broker = new OnePasswordMcpBroker({ log: cap.log, spawnFn });

    const a = makeAgentConn("agent-a", "tokenA01", TEST_TOKEN_LITERAL);
    await broker.acceptConnection(a);
    const child = spawned[0]!;

    await broker.handleAgentMessage(a, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "password_read" },
    });
    const writes = child.consumeStdinJson() as Array<{ id: number }>;

    a.triggerClose();
    // Child responds after 50ms.
    await vi.advanceTimersByTimeAsync(50);
    child.pushStdoutLine({ jsonrpc: "2.0", id: writes[0]!.id, result: { ok: true } });
    await vi.advanceTimersByTimeAsync(10);

    expect(child.killCallCount).toBe(1);
  });
});

describe("Broker — auto-respawn on crash (POOL-04)", () => {
  let cap: CapturedLog;
  beforeEach(() => {
    cap = captureLogger();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("when child exits while agents are still attached, broker spawns a new child within 2s", async () => {
    const { spawnFn, spawned } = makeSpawnFn();
    const broker = new OnePasswordMcpBroker({ log: cap.log, spawnFn });

    const a = makeAgentConn("agent-a", "tokenA01", TEST_TOKEN_LITERAL);
    await broker.acceptConnection(a);
    expect(spawned).toHaveLength(1);

    // First child crashes.
    spawned[0]!.simulateExit(137, "SIGKILL");
    await vi.advanceTimersByTimeAsync(2000);

    // Broker must have respawned because agent A is still attached.
    expect(spawned.length).toBeGreaterThanOrEqual(2);
    expect(spawned[1]!.pid).not.toBe(spawned[0]!.pid);
  });

  it("does NOT respawn if no agents remain attached", async () => {
    const { spawnFn, spawned } = makeSpawnFn();
    const broker = new OnePasswordMcpBroker({ log: cap.log, spawnFn });

    const a = makeAgentConn("agent-a", "tokenA01", TEST_TOKEN_LITERAL);
    await broker.acceptConnection(a);
    a.triggerClose(); // ref drops to 0
    await vi.advanceTimersByTimeAsync(2100); // past drain ceiling
    spawned[0]!.simulateExit(0); // child dies after broker SIGTERM

    await vi.advanceTimersByTimeAsync(2000);
    expect(spawned).toHaveLength(1); // no respawn
  });
});

describe("Broker — per-agent semaphore (POOL-05)", () => {
  let cap: CapturedLog;
  beforeEach(() => {
    cap = captureLogger();
  });

  it("a single agent dispatching 5 concurrent calls sees max 4 in-flight; 5th waits in FIFO queue", async () => {
    const { spawnFn, spawned } = makeSpawnFn();
    const broker = new OnePasswordMcpBroker({ log: cap.log, spawnFn });

    const a = makeAgentConn("agent-a", "tokenA01", TEST_TOKEN_LITERAL);
    await broker.acceptConnection(a);
    const child = spawned[0]!;

    // Dispatch 5 concurrent.
    for (let i = 1; i <= 5; i++) {
      await broker.handleAgentMessage(a, {
        jsonrpc: "2.0",
        id: i,
        method: "tools/call",
        params: { name: "password_read" },
      });
    }

    // Only 4 should have reached the child.
    let written = child.consumeStdinJson() as Array<{ id: number }>;
    expect(written).toHaveLength(4);

    // Status reports queue depth = 1.
    const status = broker.getPoolStatus()[0]!;
    expect(status.queueDepth).toBe(1);

    // Respond to one of the in-flight to free a slot.
    child.pushStdoutLine({ jsonrpc: "2.0", id: written[0]!.id, result: { ok: 1 } });
    await new Promise((r) => setImmediate(r));

    // Now the queued 5th call should be dispatched.
    written = child.consumeStdinJson() as Array<{ id: number }>;
    expect(written).toHaveLength(1);

    // And queue depth back to 0.
    expect(broker.getPoolStatus()[0]!.queueDepth).toBe(0);
  });
});

describe("Broker — audit log fields (POOL-06)", () => {
  it("every dispatched call emits a pino line with component, pool, agent, turnId, tool fields", async () => {
    const cap = captureLogger();
    const { spawnFn } = makeSpawnFn();
    const broker = new OnePasswordMcpBroker({ log: cap.log, spawnFn });

    const a = makeAgentConn("agent-a", "tokenA01", TEST_TOKEN_LITERAL);
    await broker.acceptConnection(a);

    await broker.handleAgentMessage(a, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "password_read", _meta: { turnId: "turn-uuid-123" } },
    });

    const dispatched = cap.lines().filter(
      (l) =>
        l.component === "mcp-broker" &&
        typeof l.tool === "string" &&
        l.tool === "password_read",
    );
    expect(dispatched.length).toBeGreaterThanOrEqual(1);
    const line = dispatched[0]!;
    expect(line.component).toBe("mcp-broker");
    expect(line.pool).toBe("1password-mcp:tokenA01");
    expect(line.agent).toBe("agent-a");
    expect(line.turnId).toBe("turn-uuid-123");
    expect(line.tool).toBe("password_read");
  });
});

describe("Broker — token redaction (Phase 104 SEC-07)", () => {
  it("no log line ever contains the literal OP_SERVICE_ACCOUNT_TOKEN value", async () => {
    const cap = captureLogger();
    const { spawnFn } = makeSpawnFn();
    const broker = new OnePasswordMcpBroker({ log: cap.log, spawnFn });

    const a = makeAgentConn("agent-a", "tokenA01", TEST_TOKEN_LITERAL);
    await broker.acceptConnection(a);

    await broker.handleAgentMessage(a, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "password_read" },
    });

    // Trigger a crash to exercise error-path logging.
    // (We don't have direct access to the spawned child here without the
    // test introspection; instead force broker to log an error path via
    // an explicit unsupported method.)
    await broker.handleAgentMessage(a, {
      jsonrpc: "2.0",
      id: 2,
      method: "wholly/invalid",
    });

    const raw = cap.raw();
    expect(raw).not.toContain(TEST_TOKEN_LITERAL);
    // tokenHash IS expected in audit lines.
    expect(raw).toContain("tokenA01");
  });

  it("no log line contains any string starting with 'ops_' (1Password service-account prefix)", async () => {
    const cap = captureLogger();
    const { spawnFn } = makeSpawnFn();
    const broker = new OnePasswordMcpBroker({ log: cap.log, spawnFn });

    const a = makeAgentConn("agent-a", "tokenA01", TEST_TOKEN_LITERAL);
    await broker.acceptConnection(a);
    await broker.handleAgentMessage(a, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "password_read" },
    });

    const raw = cap.raw();
    // Any literal `ops_` followed by capital letters / digits would be
    // a service-account token leak. tokenHash uses hex (lowercase).
    expect(raw).not.toMatch(/ops_[A-Z0-9_]/);
  });
});

describe("Broker — module shape", () => {
  it("exports BROKER_ERROR_CODE_DRAIN_TIMEOUT in JSON-RPC server-defined error range", () => {
    expect(typeof BROKER_ERROR_CODE_DRAIN_TIMEOUT).toBe("number");
    expect(BROKER_ERROR_CODE_DRAIN_TIMEOUT).toBeGreaterThanOrEqual(-32099);
    expect(BROKER_ERROR_CODE_DRAIN_TIMEOUT).toBeLessThanOrEqual(-32000);
  });
});
