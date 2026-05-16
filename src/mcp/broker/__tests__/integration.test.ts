// RED — Phase 108-00 — Wave 0 scaffolding. Production target: src/mcp/broker/ (broker.ts + shim-server.ts + pooled-child.ts wired together).
/**
 * Phase 108 Plan 00 — Broker integration RED tests.
 *
 * End-to-end exercises with all three broker modules wired together
 * (pool spawn still uses FakePooledChild via injected spawnFn, so no
 * real npx process is started):
 *
 *   - POOL-08 multi-token cardinality: 5 agents × 2 tokens → 2 pool
 *     children spawned.
 *   - Synthetic burst: 5 agents on the same token issue tools/call
 *     simultaneously; all receive correct responses; broker dispatches
 *     to the single pool child.
 *   - Crash + auto-respawn: kill the FakePooledChild for a token; broker
 *     respawns within 2s; in-flight calls receive structured errors;
 *     next call after respawn succeeds.
 *   - getPoolStatus reports correct cardinality & refcounts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";

import {
  createFakeBrokerSocketPair,
  type FakeSocket,
} from "../../../../tests/__fakes__/fake-broker-socket.js";
import { FakePooledChild } from "../../../../tests/__fakes__/fake-pooled-child.js";

// Production targets — none exist yet.
import { OnePasswordMcpBroker } from "../broker.js";
import { ShimServer } from "../shim-server.js";
import { BROKER_ERROR_CODE_POOL_CRASH } from "../pooled-child.js";

function captureLogger() {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const log = pino({ level: "debug" }, sink);
  return { log, raw: () => chunks.join("") };
}

function pushLine(socket: FakeSocket, obj: unknown): void {
  socket.write(JSON.stringify(obj) + "\n");
}

function readLines(socket: FakeSocket, into: string[]): void {
  socket.on("data", (chunk: Buffer) => into.push(chunk.toString("utf8")));
}

function parseLines(buf: string[]): Array<Record<string, unknown>> {
  return buf
    .join("")
    .split("\n")
    .filter((s) => s.length > 0)
    .map((s) => JSON.parse(s) as Record<string, unknown>);
}

type Wired = {
  broker: OnePasswordMcpBroker;
  server: ShimServer;
  spawned: FakePooledChild[];
};

function wire(): Wired {
  const cap = captureLogger();
  const spawned: FakePooledChild[] = [];
  const broker = new OnePasswordMcpBroker({
    log: cap.log,
    spawnFn: () => {
      const c = new FakePooledChild();
      spawned.push(c);
      return c as unknown as import("node:child_process").ChildProcess;
    },
  });
  const server = new ShimServer({ broker, log: cap.log });
  return { broker, server, spawned };
}

describe("Broker integration — POOL-08 (5 agents × 2 tokens → 2 children)", () => {
  it("3 agents on token A and 2 agents on token B spawn exactly 2 pool children", async () => {
    const { server, spawned, broker } = wire();

    const pairs = [
      { agent: "a-1", token: "tokenA01" },
      { agent: "a-2", token: "tokenA01" },
      { agent: "a-3", token: "tokenA01" },
      { agent: "b-1", token: "tokenB02" },
      { agent: "b-2", token: "tokenB02" },
    ].map((cfg) => {
      const pair = createFakeBrokerSocketPair();
      server.handleConnection(pair.server);
      pushLine(pair.client, { agent: cfg.agent, tokenHash: cfg.token });
      return { ...cfg, pair };
    });

    await new Promise((r) => setImmediate(r));

    expect(spawned).toHaveLength(2);
    const status = broker.getPoolStatus();
    const refs = Object.fromEntries(status.map((s) => [s.tokenHash, s.agentRefCount]));
    expect(refs).toEqual({ tokenA01: 3, tokenB02: 2 });

    // Each pool child sees exactly one initialize-style first dispatch
    // (the SDK sends initialize on connect; in production the broker
    // synthesizes the cached response after the first agent's). Here we
    // only assert spawn cardinality; per-message routing is covered by
    // pooled-child.test.ts.
    void pairs;
  });
});

describe("Broker integration — synthetic burst (smoke #3)", () => {
  it("5 agents on token A simultaneously call password_read; all receive correct responses through one pool child", async () => {
    const { server, spawned, broker } = wire();

    const conns = [] as Array<{ name: string; pair: ReturnType<typeof createFakeBrokerSocketPair>; received: string[] }>;
    for (let i = 1; i <= 5; i++) {
      const pair = createFakeBrokerSocketPair();
      const received: string[] = [];
      readLines(pair.client, received);
      server.handleConnection(pair.server);
      pushLine(pair.client, { agent: `a-${i}`, tokenHash: "tokenA01" });
      conns.push({ name: `a-${i}`, pair, received });
    }
    await new Promise((r) => setImmediate(r));

    expect(spawned).toHaveLength(1);
    const child = spawned[0]!;

    // All 5 agents send tools/call concurrently.
    for (const c of conns) {
      pushLine(c.pair.client, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "password_read", arguments: { reference: `op://x/${c.name}/p` } },
      });
    }
    await new Promise((r) => setImmediate(r));

    const writes = child.consumeStdinJson() as Array<{ id: number; method: string }>;
    // Up to 4 in-flight per agent allowed (semaphore), but 5 distinct
    // agents at 1-each → all 5 should be in-flight.
    expect(writes.length).toBeGreaterThanOrEqual(5);

    // Respond to each with a unique result keyed off pool-id.
    for (const w of writes) {
      child.pushStdoutLine({
        jsonrpc: "2.0",
        id: w.id,
        result: { value: `pool-id-${w.id}` },
      });
    }
    await new Promise((r) => setImmediate(r));

    // Each agent receives its response.
    for (const c of conns) {
      const lines = parseLines(c.received);
      const responses = lines.filter(
        (l) => typeof l.id === "number" && l.id === 1 && l.result !== undefined,
      );
      expect(responses).toHaveLength(1);
    }

    // All 5 dispatches went to ONE PID.
    expect(broker.getPoolStatus()).toHaveLength(1);
  });
});

describe("Broker integration — crash + auto-respawn (smoke #4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("when pool child crashes mid-dispatch, in-flight calls error-out and broker respawns within 2s", async () => {
    const { server, spawned, broker } = wire();

    const pair = createFakeBrokerSocketPair();
    const received: string[] = [];
    readLines(pair.client, received);
    server.handleConnection(pair.server);
    pushLine(pair.client, { agent: "a-1", tokenHash: "tokenA01" });
    await vi.advanceTimersByTimeAsync(1);

    pushLine(pair.client, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "password_read" },
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(spawned).toHaveLength(1);
    spawned[0]!.consumeStdinJson(); // drain

    // Child crashes.
    spawned[0]!.simulateExit(137, "SIGKILL");
    await vi.advanceTimersByTimeAsync(50);

    const errLines = parseLines(received).filter((l) => l.error);
    expect(errLines).toHaveLength(1);
    expect((errLines[0]!.error as { code: number }).code).toBe(BROKER_ERROR_CODE_POOL_CRASH);

    // Broker should respawn within 2s because connection still attached.
    await vi.advanceTimersByTimeAsync(2000);
    expect(spawned.length).toBeGreaterThanOrEqual(2);

    // After respawn, a fresh request succeeds.
    pushLine(pair.client, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "password_read" },
    });
    await vi.advanceTimersByTimeAsync(1);
    const written = spawned[1]!.consumeStdinJson() as Array<{ id: number }>;
    expect(written).toHaveLength(1);
    spawned[1]!.pushStdoutLine({ jsonrpc: "2.0", id: written[0]!.id, result: { ok: 2 } });
    await vi.advanceTimersByTimeAsync(1);

    const okLines = parseLines(received).filter(
      (l) => typeof l.id === "number" && l.id === 2 && l.result !== undefined,
    );
    expect(okLines).toHaveLength(1);

    expect(broker).toBeDefined();
  });
});

describe("Broker integration — token grouping cardinality (POOL-01)", () => {
  it("getPoolStatus returns one entry per unique tokenHash with the correct refcount", async () => {
    const { server, broker } = wire();

    const setup = [
      { agent: "x", token: "h1" },
      { agent: "y", token: "h1" },
      { agent: "z", token: "h2" },
    ];
    for (const s of setup) {
      const pair = createFakeBrokerSocketPair();
      server.handleConnection(pair.server);
      pushLine(pair.client, { agent: s.agent, tokenHash: s.token });
    }
    await new Promise((r) => setImmediate(r));

    const status = broker.getPoolStatus();
    expect(status).toHaveLength(2);
    const refs = Object.fromEntries(status.map((s) => [s.tokenHash, s.agentRefCount]));
    expect(refs).toEqual({ h1: 2, h2: 1 });
  });
});
