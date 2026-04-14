import { describe, it, expect, vi } from "vitest";
import { TOOL_DEFINITIONS, invokeWithCache } from "./server.js";
import { TraceCollector, type Turn } from "../performance/trace-collector.js";
import type { TraceStore } from "../performance/trace-store.js";

describe("TOOL_DEFINITIONS", () => {
  it("defines agent_status tool", () => {
    expect(TOOL_DEFINITIONS.agent_status).toBeDefined();
    expect(TOOL_DEFINITIONS.agent_status.description).toContain("status");
    expect(TOOL_DEFINITIONS.agent_status.ipcMethod).toBe("status");
  });

  it("defines send_message tool", () => {
    expect(TOOL_DEFINITIONS.send_message).toBeDefined();
    expect(TOOL_DEFINITIONS.send_message.description).toContain("message");
    expect(TOOL_DEFINITIONS.send_message.ipcMethod).toBe("send-message");
  });

  it("defines list_schedules tool", () => {
    expect(TOOL_DEFINITIONS.list_schedules).toBeDefined();
    expect(TOOL_DEFINITIONS.list_schedules.description).toContain("scheduled");
    expect(TOOL_DEFINITIONS.list_schedules.ipcMethod).toBe("schedules");
  });

  it("defines list_webhooks tool", () => {
    expect(TOOL_DEFINITIONS.list_webhooks).toBeDefined();
    expect(TOOL_DEFINITIONS.list_webhooks.description).toContain("webhook");
    expect(TOOL_DEFINITIONS.list_webhooks.ipcMethod).toBe("webhooks");
  });

  it("defines list_agents tool", () => {
    expect(TOOL_DEFINITIONS.list_agents).toBeDefined();
    expect(TOOL_DEFINITIONS.list_agents.ipcMethod).toBe("status");
  });

  it("has exactly 16 tools defined", () => {
    expect(Object.keys(TOOL_DEFINITIONS).length).toBe(16);
  });

  it("defines ask_advisor tool", () => {
    expect(TOOL_DEFINITIONS.ask_advisor).toBeDefined();
    expect(TOOL_DEFINITIONS.ask_advisor.description).toContain("advice");
    expect(TOOL_DEFINITIONS.ask_advisor.ipcMethod).toBe("ask-advisor");
  });

  it("defines spawn_subagent_thread tool", () => {
    expect(TOOL_DEFINITIONS.spawn_subagent_thread).toBeDefined();
    expect(TOOL_DEFINITIONS.spawn_subagent_thread.description).toContain("subagent");
    expect(TOOL_DEFINITIONS.spawn_subagent_thread.ipcMethod).toBe("spawn-subagent-thread");
  });
});

// ---------------------------------------------------------------------------
// Phase 55 Plan 02 — invokeWithCache behaviour (tool cache + bypass + stability)
// ---------------------------------------------------------------------------

function createMockStore(): TraceStore {
  return {
    writeTurn: vi.fn(),
    pruneOlderThan: vi.fn().mockReturnValue(0),
    close: vi.fn(),
    getPercentiles: vi.fn().mockReturnValue([]),
  } as unknown as TraceStore;
}

function createMockLogger(): any {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function makeTurn(): Turn {
  const collector = new TraceCollector(createMockStore(), createMockLogger());
  return collector.startTurn("msg-cache-1", "alpha", null);
}

describe("invokeWithCache (Phase 55)", () => {
  it("Test 1: first memory_lookup populates cache; second identical call hits cache (<=5ms)", async () => {
    const turn = makeTurn();
    const raw = vi.fn().mockResolvedValue({ results: ["real"] });
    const deps = {
      getActiveTurn: () => turn,
      getAgentPerfTools: () => ({
        maxConcurrent: 10,
        idempotent: ["memory_lookup", "search_documents", "memory_list", "memory_graph"],
      }),
    };

    // First call — miss
    const r1 = await invokeWithCache("memory_lookup", "alpha", { q: "foo" }, raw, deps);
    expect(r1).toEqual({ results: ["real"] });
    expect(raw).toHaveBeenCalledTimes(1);

    // Second call — hit, no second raw invocation
    const startHit = Date.now();
    const r2 = await invokeWithCache("memory_lookup", "alpha", { q: "foo" }, raw, deps);
    const hitElapsed = Date.now() - startHit;
    expect(raw).toHaveBeenCalledTimes(1); // no second raw call
    expect(r2).toEqual({ results: ["real"] });
    expect(hitElapsed).toBeLessThanOrEqual(5);
    expect(turn.toolCache.hitCount()).toBe(1);
  });

  it("Test 2: different args = different cache entries, no spurious hit", async () => {
    const turn = makeTurn();
    const raw = vi
      .fn()
      .mockResolvedValueOnce({ q: "foo" })
      .mockResolvedValueOnce({ q: "bar" });
    const deps = {
      getActiveTurn: () => turn,
      getAgentPerfTools: () => ({
        maxConcurrent: 10,
        idempotent: ["memory_lookup"],
      }),
    };

    await invokeWithCache("memory_lookup", "alpha", { q: "foo" }, raw, deps);
    await invokeWithCache("memory_lookup", "alpha", { q: "bar" }, raw, deps);
    expect(raw).toHaveBeenCalledTimes(2);
    expect(turn.toolCache.hitCount()).toBe(0);
  });

  it("Test 3: non-idempotent tool (memory_save) NEVER hits cache even with identical args", async () => {
    const turn = makeTurn();
    const raw = vi.fn().mockResolvedValue({ id: "mem-1" });
    const deps = {
      getActiveTurn: () => turn,
      getAgentPerfTools: () => ({
        maxConcurrent: 10,
        idempotent: ["memory_lookup", "search_documents"], // memory_save NOT whitelisted
      }),
    };

    await invokeWithCache("memory_save", "alpha", { content: "x" }, raw, deps);
    await invokeWithCache("memory_save", "alpha", { content: "x" }, raw, deps);
    await invokeWithCache("memory_save", "alpha", { content: "x" }, raw, deps);
    expect(raw).toHaveBeenCalledTimes(3);
    expect(turn.toolCache.hitCount()).toBe(0);
  });

  it("Test 4: arg-order stability — {q:'x',limit:5} and {limit:5,q:'x'} share a cache entry", async () => {
    const turn = makeTurn();
    const raw = vi.fn().mockResolvedValue({ results: ["stable"] });
    const deps = {
      getActiveTurn: () => turn,
      getAgentPerfTools: () => ({
        maxConcurrent: 10,
        idempotent: ["memory_lookup"],
      }),
    };

    await invokeWithCache("memory_lookup", "alpha", { q: "x", limit: 5 }, raw, deps);
    await invokeWithCache("memory_lookup", "alpha", { limit: 5, q: "x" }, raw, deps);
    expect(raw).toHaveBeenCalledTimes(1); // second call is a cache hit
    expect(turn.toolCache.hitCount()).toBe(1);
  });

  it("Test 5: config-driven whitelist — test-only override makes memory_save cacheable", async () => {
    const turn = makeTurn();
    const raw = vi.fn().mockResolvedValue({ id: "mem-1" });
    const deps = {
      getActiveTurn: () => turn,
      getAgentPerfTools: () => ({
        maxConcurrent: 10,
        idempotent: ["memory_save"], // adversarial — shows whitelist is config-driven
      }),
    };

    await invokeWithCache("memory_save", "alpha", { content: "x" }, raw, deps);
    await invokeWithCache("memory_save", "alpha", { content: "x" }, raw, deps);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(turn.toolCache.hitCount()).toBe(1);
  });

  it("bypasses cache when no turn available (getActiveTurn returns null)", async () => {
    const raw = vi.fn().mockResolvedValue({ r: "ok" });
    const deps = {
      getActiveTurn: () => null,
      getAgentPerfTools: () => ({
        maxConcurrent: 10,
        idempotent: ["memory_lookup"],
      }),
    };
    await invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, deps);
    await invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, deps);
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it("bypasses cache when deps is undefined (backward-compat for stdio MCP path)", async () => {
    const raw = vi.fn().mockResolvedValue({ r: "ok" });
    await invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, undefined);
    await invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, undefined);
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it("uses IDEMPOTENT_TOOL_DEFAULTS when getAgentPerfTools returns undefined", async () => {
    const turn = makeTurn();
    const raw = vi.fn().mockResolvedValue({ r: "ok" });
    const deps = {
      getActiveTurn: () => turn,
      getAgentPerfTools: () => undefined,
    };
    await invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, deps);
    await invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, deps);
    // memory_lookup is in the defaults → 1 call
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it("handler failures do not poison the cache", async () => {
    const turn = makeTurn();
    const raw = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ results: ["real"] });
    const deps = {
      getActiveTurn: () => turn,
      getAgentPerfTools: () => ({
        maxConcurrent: 10,
        idempotent: ["memory_lookup"],
      }),
    };
    await expect(
      invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, deps),
    ).rejects.toThrow("boom");
    // Second call — must re-invoke real handler (cache empty because first threw)
    const r2 = await invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, deps);
    expect(r2).toEqual({ results: ["real"] });
    expect(raw).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// v1.7 cleanup — invokeWithCache concurrency-gate integration
// ---------------------------------------------------------------------------
describe("invokeWithCache + acquireToolSlot (v1.7 cleanup)", () => {
  it("calls acquireToolSlot before rawCall and releases after, even on error", async () => {
    const events: string[] = [];
    const raw = async (): Promise<{ ok: true }> => {
      events.push("raw");
      return { ok: true };
    };
    const deps = {
      acquireToolSlot: async (agent: string): Promise<() => void> => {
        events.push(`acquire:${agent}`);
        return () => events.push(`release:${agent}`);
      },
    };
    await invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, deps);
    expect(events).toEqual(["acquire:alpha", "raw", "release:alpha"]);
  });

  it("releases slot on error (finally semantics)", async () => {
    const events: string[] = [];
    const raw = async (): Promise<unknown> => {
      events.push("raw");
      throw new Error("boom");
    };
    const deps = {
      acquireToolSlot: async (): Promise<() => void> => {
        events.push("acquire");
        return () => events.push("release");
      },
    };
    await expect(
      invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, deps),
    ).rejects.toThrow("boom");
    expect(events).toEqual(["acquire", "raw", "release"]);
  });

  it("skips acquireToolSlot entirely on cache hit (fast path)", async () => {
    const cacheStore = new Map<string, unknown>();
    const turn = {
      toolCache: {
        get: (tool: string, args: unknown) => cacheStore.get(`${tool}|${JSON.stringify(args)}`),
        set: (tool: string, args: unknown, v: unknown) =>
          cacheStore.set(`${tool}|${JSON.stringify(args)}`, v),
        hitCount: () => 0,
      },
    } as unknown as import("../performance/trace-collector.js").Turn;

    let acquireCount = 0;
    const deps = {
      getActiveTurn: () => turn,
      getAgentPerfTools: () => ({
        maxConcurrent: 10,
        idempotent: ["memory_lookup"] as readonly string[],
      }),
      acquireToolSlot: async (): Promise<() => void> => {
        acquireCount += 1;
        return () => {};
      },
    };
    const raw = vi
      .fn<() => Promise<{ r: string }>>()
      .mockResolvedValue({ r: "v1" });

    // First call: miss → raw + acquire + release
    await invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, deps);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(acquireCount).toBe(1);

    // Second identical call: hit → no raw, no acquire
    await invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, deps);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(acquireCount).toBe(1); // unchanged — cache hit bypassed gate
  });

  it("falls through without gate when acquireToolSlot is undefined (backward compat)", async () => {
    const raw = vi.fn().mockResolvedValue({ ok: true });
    await invokeWithCache("memory_lookup", "alpha", { q: "x" }, raw, undefined);
    expect(raw).toHaveBeenCalledTimes(1);
  });
});
