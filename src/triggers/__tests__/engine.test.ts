/**
 * Phase 60 Plan 02 — TriggerEngine + TriggerSourceRegistry tests.
 *
 * TDD RED phase: these tests define the expected behavior of the
 * TriggerEngine ingest pipeline (3-layer dedup -> policy -> causation_id
 * dispatch) and TriggerSourceRegistry (register/get/all/size).
 *
 * Uses:
 *   - real better-sqlite3 :memory: DB for DedupLayer + TaskStore trigger_state
 *   - mock TurnDispatcher (vi.fn() for dispatch)
 *   - FakeTriggerSource implementing TriggerSource interface
 *   - pino silent logger
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import pino from "pino";

import { TriggerSourceRegistry } from "../source-registry.js";
import { TriggerEngine } from "../engine.js";
import type { TriggerEvent, TriggerSource } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const silentLog = pino({ level: "silent" });

/** Minimal mock TurnDispatcher — only dispatch() is used by TriggerEngine. */
function makeMockDispatcher() {
  return {
    dispatch: vi.fn().mockResolvedValue("ok"),
    dispatchStream: vi.fn(),
  };
}

/**
 * Minimal mock TaskStore that uses a real :memory: SQLite for rawDb (needed
 * by DedupLayer), plus in-memory Maps for trigger state methods.
 */
function makeMockTaskStore(db: DatabaseType) {
  const stateMap = new Map<string, { last_watermark: string | null; cursor_blob: string | null; updated_at: number }>();
  return {
    rawDb: db,
    upsertTriggerState: vi.fn((sourceId: string, lastWatermark: string | null, cursorBlob: string | null) => {
      stateMap.set(sourceId, { last_watermark: lastWatermark, cursor_blob: cursorBlob, updated_at: Date.now() });
    }),
    getTriggerState: vi.fn((sourceId: string) => {
      const s = stateMap.get(sourceId);
      if (!s) return null;
      return { source_id: sourceId, ...s };
    }),
    purgeCompleted: vi.fn(() => 0),
    purgeTriggerEvents: vi.fn(() => 0),
  };
}

/** FakeTriggerSource implementing TriggerSource. */
function makeFakeSource(
  sourceId: string,
  opts: { poll?: boolean } = {},
): TriggerSource & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; pollFn?: ReturnType<typeof vi.fn> } {
  const source: TriggerSource & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; pollFn?: ReturnType<typeof vi.fn> } = {
    sourceId,
    start: vi.fn(),
    stop: vi.fn(),
  };
  if (opts.poll) {
    const pollFn = vi.fn().mockResolvedValue([]);
    source.poll = pollFn;
    source.pollFn = pollFn;
  }
  return source;
}

function makeEvent(overrides: Partial<TriggerEvent> = {}): TriggerEvent {
  return {
    sourceId: "test-source",
    idempotencyKey: `key-${Date.now()}-${Math.random()}`,
    targetAgent: "agent-one",
    payload: { msg: "hello" },
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TriggerSourceRegistry
// ---------------------------------------------------------------------------

describe("TriggerSourceRegistry", () => {
  it("registers and retrieves a source by sourceId", () => {
    const registry = new TriggerSourceRegistry();
    const source = makeFakeSource("src-1");
    registry.register(source);
    expect(registry.get("src-1")).toBe(source);
  });

  it("returns undefined for unknown sourceId", () => {
    const registry = new TriggerSourceRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("all() returns all registered sources as array", () => {
    const registry = new TriggerSourceRegistry();
    const s1 = makeFakeSource("s1");
    const s2 = makeFakeSource("s2");
    registry.register(s1);
    registry.register(s2);
    const all = registry.all();
    expect(all).toHaveLength(2);
    expect(all).toContain(s1);
    expect(all).toContain(s2);
  });

  it("size returns the count of registered sources", () => {
    const registry = new TriggerSourceRegistry();
    expect(registry.size).toBe(0);
    registry.register(makeFakeSource("a"));
    expect(registry.size).toBe(1);
    registry.register(makeFakeSource("b"));
    expect(registry.size).toBe(2);
  });

  it("registerSource rejects duplicate sourceId", () => {
    const registry = new TriggerSourceRegistry();
    registry.register(makeFakeSource("dup"));
    expect(() => registry.register(makeFakeSource("dup"))).toThrow(
      /already registered/,
    );
  });
});

// ---------------------------------------------------------------------------
// TriggerEngine
// ---------------------------------------------------------------------------

describe("TriggerEngine", () => {
  let db: DatabaseType;
  let dispatcher: ReturnType<typeof makeMockDispatcher>;
  let taskStore: ReturnType<typeof makeMockTaskStore>;
  let engine: TriggerEngine;
  const configuredAgents = new Set(["agent-one", "agent-two"]);

  beforeEach(() => {
    db = new Database(":memory:");
    dispatcher = makeMockDispatcher();
    taskStore = makeMockTaskStore(db);
    engine = new TriggerEngine(
      {
        turnDispatcher: dispatcher as any,
        taskStore: taskStore as any,
        log: silentLog,
        config: {
          replayMaxAgeMs: 86_400_000,
          dedupLruSize: 100,
          defaultDebounceMs: 0, // zero debounce for test speed
        },
      },
      configuredAgents,
    );
  });

  afterEach(() => {
    engine.stopAll();
    db.close();
  });

  // -------------------------------------------------------------------------
  // ingest
  // -------------------------------------------------------------------------

  it("ingest dispatches event with causationId on origin", async () => {
    const event = makeEvent();
    await engine.ingest(event);

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    const [origin, agentName, payload] = dispatcher.dispatch.mock.calls[0]!;
    expect(agentName).toBe("agent-one");
    expect(origin.causationId).toBeTypeOf("string");
    expect(origin.causationId!.length).toBeGreaterThan(0);
    expect(origin.source.kind).toBe("trigger");
    expect(origin.source.id).toBe("test-source");
  });

  it("ingest rejects LRU duplicate — dispatch called once", async () => {
    const event = makeEvent({ idempotencyKey: "same-key" });
    await engine.ingest(event);
    await engine.ingest(event);

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });

  it("ingest rejects unknown targetAgent — policy blocks", async () => {
    const event = makeEvent({ targetAgent: "nonexistent-agent" });
    await engine.ingest(event);

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("ingest updates watermark after successful dispatch", async () => {
    const event = makeEvent({ timestamp: 1234567890 });
    await engine.ingest(event);

    expect(taskStore.upsertTriggerState).toHaveBeenCalledWith(
      event.sourceId,
      "1234567890",
      null,
    );
  });

  it("SQLite UNIQUE rejects duplicate after LRU eviction", async () => {
    // Create engine with LRU size of 2
    const smallEngine = new TriggerEngine(
      {
        turnDispatcher: dispatcher as any,
        taskStore: taskStore as any,
        log: silentLog,
        config: {
          replayMaxAgeMs: 86_400_000,
          dedupLruSize: 2,
          defaultDebounceMs: 0,
        },
      },
      configuredAgents,
    );

    // Insert event A — fills LRU slot 1
    const eventA = makeEvent({ idempotencyKey: "key-a" });
    await smallEngine.ingest(eventA);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);

    // Insert events B and C — evicts A from LRU
    await smallEngine.ingest(makeEvent({ idempotencyKey: "key-b" }));
    await smallEngine.ingest(makeEvent({ idempotencyKey: "key-c" }));
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);

    // Re-insert A — LRU won't catch it, but SQLite UNIQUE should
    await smallEngine.ingest(makeEvent({ idempotencyKey: "key-a" }));
    // Still 3 dispatches — SQLite blocked the fourth
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);

    smallEngine.stopAll();
  });

  // -------------------------------------------------------------------------
  // replayMissed
  // -------------------------------------------------------------------------

  it("replayMissed calls poll on sources with watermark", async () => {
    const source = makeFakeSource("poll-src", { poll: true });
    engine.registerSource(source);

    // Seed a watermark
    taskStore.getTriggerState.mockReturnValueOnce({
      source_id: "poll-src",
      last_watermark: "999",
      cursor_blob: null,
      updated_at: Date.now(),
    });

    await engine.replayMissed();

    expect(source.pollFn).toHaveBeenCalledWith("999");
  });

  it("replayMissed skips sources without poll method", async () => {
    const source = makeFakeSource("no-poll-src"); // no poll
    engine.registerSource(source);

    // Should not throw
    await engine.replayMissed();
  });

  it("replayMissed skips watermarks older than maxAge", async () => {
    const source = makeFakeSource("old-src", { poll: true });
    engine.registerSource(source);

    // Set watermark to a very old timestamp
    const veryOld = Date.now() - 200_000_000; // well beyond 86400000 maxAge
    taskStore.getTriggerState.mockReturnValueOnce({
      source_id: "old-src",
      last_watermark: String(veryOld),
      cursor_blob: null,
      updated_at: Date.now(),
    });

    await engine.replayMissed();

    // poll should NOT be called because watermark is too old
    expect(source.pollFn).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // startAll / stopAll
  // -------------------------------------------------------------------------

  it("startAll and stopAll call source lifecycle methods", () => {
    const s1 = makeFakeSource("s1");
    const s2 = makeFakeSource("s2");
    engine.registerSource(s1);
    engine.registerSource(s2);

    engine.startAll();
    expect(s1.start).toHaveBeenCalledTimes(1);
    expect(s2.start).toHaveBeenCalledTimes(1);

    engine.stopAll();
    expect(s1.stop).toHaveBeenCalledTimes(1);
    expect(s2.stop).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // registerSource
  // -------------------------------------------------------------------------

  it("registerSource rejects duplicate sourceId via registry", () => {
    engine.registerSource(makeFakeSource("dup-src"));
    expect(() => engine.registerSource(makeFakeSource("dup-src"))).toThrow(
      /already registered/,
    );
  });

  // -------------------------------------------------------------------------
  // updateConfiguredAgents
  // -------------------------------------------------------------------------

  it("updateConfiguredAgents changes policy evaluation", async () => {
    const event = makeEvent({ targetAgent: "new-agent" });

    // Should be rejected — new-agent not in initial set
    await engine.ingest(event);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();

    // Update agents to include new-agent (need different key to avoid dedup)
    engine.updateConfiguredAgents(new Set(["new-agent"]));
    const event2 = makeEvent({ targetAgent: "new-agent", idempotencyKey: "new-key" });
    await engine.ingest(event2);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });
});
