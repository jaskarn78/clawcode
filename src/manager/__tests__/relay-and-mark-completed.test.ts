import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import {
  relayAndMarkCompletedByThreadId,
  relayAndMarkCompletedByAgentName,
  type RelayAndMarkCompletedDeps,
} from "../relay-and-mark-completed.js";
import type {
  ThreadBinding,
  ThreadBindingRegistry,
} from "../../discord/thread-types.js";

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
  return { log, lines };
}

const NOW = 1_700_000_000_000;
const SUB = "fin-acquisition-via-fin-research-AbC123";

function binding(overrides: Partial<ThreadBinding> = {}): ThreadBinding {
  return {
    threadId: "thread-1",
    parentChannelId: "ch-1",
    agentName: SUB,
    sessionName: SUB,
    createdAt: NOW - 30 * 60_000,
    lastActivity: NOW - 10 * 60_000,
    // Phase 999.36 sub-bug D — default fixtures pass the delivery gate.
    // Tests asserting the gate's no-stamp branch override this with
    // `lastDeliveryAt: undefined` or `null` explicitly.
    lastDeliveryAt: NOW - 5 * 60_000,
    ...overrides,
  };
}

function makeDeps(opts: {
  registry: ThreadBindingRegistry;
  enabled?: boolean;
  spawnerAvailable?: boolean;
}): {
  deps: RelayAndMarkCompletedDeps;
  read: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  relay: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof captureLogger>;
} {
  const log = captureLogger();
  const read = vi.fn().mockResolvedValue(opts.registry);
  const write = vi.fn().mockResolvedValue(undefined);
  const relay = vi.fn().mockResolvedValue(undefined);
  const deps: RelayAndMarkCompletedDeps = {
    readThreadRegistry: read,
    writeThreadRegistry: write,
    relayCompletionToParent:
      opts.spawnerAvailable === false ? null : relay,
    now: () => NOW,
    log: log.log,
    enabled: opts.enabled !== false,
  };
  return { deps, read, write, relay, log };
}

describe("relayAndMarkCompletedByThreadId", () => {
  it("returns no-binding when threadId is unknown", async () => {
    const { deps, write, relay } = makeDeps({
      registry: { bindings: [], updatedAt: 0 },
    });
    const r = await relayAndMarkCompletedByThreadId(deps, "thread-x");
    expect(r).toEqual({ ok: false, reason: "no-binding" });
    expect(relay).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("returns disabled when enabled=false (no relay, no write)", async () => {
    const { deps, write, relay } = makeDeps({
      registry: { bindings: [binding()], updatedAt: 0 },
      enabled: false,
    });
    const r = await relayAndMarkCompletedByThreadId(deps, "thread-1");
    expect(r).toEqual({ ok: false, reason: "disabled" });
    expect(relay).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("returns spawner-unavailable when relayCompletionToParent is null", async () => {
    const { deps, write } = makeDeps({
      registry: { bindings: [binding()], updatedAt: 0 },
      spawnerAvailable: false,
    });
    const r = await relayAndMarkCompletedByThreadId(deps, "thread-1");
    expect(r).toEqual({ ok: false, reason: "spawner-unavailable" });
    expect(write).not.toHaveBeenCalled();
  });

  it("returns already-completed when binding.completedAt is set (idempotent)", async () => {
    const { deps, write, relay } = makeDeps({
      registry: {
        bindings: [binding({ completedAt: NOW - 60_000 })],
        updatedAt: 0,
      },
    });
    const r = await relayAndMarkCompletedByThreadId(deps, "thread-1");
    expect(r).toEqual({ ok: true, reason: "already-completed" });
    expect(relay).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("treats completedAt === null as not-completed and proceeds (back-compat)", async () => {
    const { deps, write, relay } = makeDeps({
      registry: {
        bindings: [binding({ completedAt: null })],
        updatedAt: 0,
      },
    });
    const r = await relayAndMarkCompletedByThreadId(deps, "thread-1");
    expect(r).toEqual({ ok: true, reason: "relayed" });
    expect(relay).toHaveBeenCalledWith("thread-1");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("happy path: fires relay, stamps completedAt, persists registry", async () => {
    const { deps, write, relay, log } = makeDeps({
      registry: { bindings: [binding()], updatedAt: 0 },
    });
    const r = await relayAndMarkCompletedByThreadId(deps, "thread-1");
    expect(r).toEqual({ ok: true, reason: "relayed" });
    expect(relay).toHaveBeenCalledWith("thread-1");
    expect(write).toHaveBeenCalledTimes(1);
    const written = write.mock.calls[0]![0] as ThreadBindingRegistry;
    expect(written.bindings[0]!.completedAt).toBe(NOW);
    expect(written.bindings[0]!.lastActivity).toBe(binding().lastActivity); // untouched
    const lines = log.lines();
    expect(
      lines.find(
        (l) =>
          l.action === "marked-completed" &&
          l.component === "subagent-completion",
      ),
    ).toBeDefined();
  });

  it("propagates throws from relay (caller handles)", async () => {
    const { deps, relay, write } = makeDeps({
      registry: { bindings: [binding()], updatedAt: 0 },
    });
    relay.mockRejectedValueOnce(new Error("discord 5xx"));
    await expect(
      relayAndMarkCompletedByThreadId(deps, "thread-1"),
    ).rejects.toThrow("discord 5xx");
    expect(write).not.toHaveBeenCalled(); // didn't reach the write
  });
});

describe("relayAndMarkCompletedByAgentName", () => {
  it("looks up by sessionName and delegates", async () => {
    const { deps, write, relay } = makeDeps({
      registry: { bindings: [binding()], updatedAt: 0 },
    });
    const r = await relayAndMarkCompletedByAgentName(deps, SUB);
    expect(r).toEqual({ ok: true, reason: "relayed" });
    expect(relay).toHaveBeenCalledWith("thread-1");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("returns no-binding when no session matches the agentName", async () => {
    const { deps, write, relay } = makeDeps({
      registry: { bindings: [binding()], updatedAt: 0 },
    });
    const r = await relayAndMarkCompletedByAgentName(deps, "ghost-agent");
    expect(r).toEqual({ ok: false, reason: "no-binding" });
    expect(relay).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("returns disabled without reading the registry", async () => {
    const { deps, read } = makeDeps({
      registry: { bindings: [binding()], updatedAt: 0 },
      enabled: false,
    });
    const r = await relayAndMarkCompletedByAgentName(deps, SUB);
    expect(r).toEqual({ ok: false, reason: "disabled" });
    expect(read).not.toHaveBeenCalled();
  });
});
