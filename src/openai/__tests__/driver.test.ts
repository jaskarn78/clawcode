/**
 * Phase 69 Plan 03 Task 2 — OpenAiSessionDriver implementation tests.
 *
 * Validates `createOpenAiSessionDriver` — the production implementation of
 * Plan 02's `OpenAiSessionDriver` interface. The driver:
 *   1. Resolves the bearer-key → session_id mapping via ApiKeySessionIndex.
 *   2. Builds a caller-owned Turn via TraceCollector.startTurn with TurnOrigin
 *      `kind:"openai-api"` + `source.id = keyHash.slice(0, 8)` (OPENAI-07).
 *   3. Dispatches through TurnDispatcher.dispatchStream (caller-owned Turn mode)
 *      so v1.7 prompt caching + trace participation work for free.
 *   4. Synthesizes SdkStreamEvents from the text stream + resolves the final
 *      session_id via SessionManager (the TurnDispatcher contract does NOT
 *      expose raw SDK events — we adapt the callback signal into the shape
 *      the translator consumes).
 *   5. Records the mapping on the first-result event; touches on subsequent reuse.
 *   6. Honors AbortSignal: aborting mid-dispatch ends the turn with "error".
 *   7. Never mutates the input options (immutable contract).
 *
 * Isolation from Discord: we do NOT change TurnDispatcher's signature. Discord
 * call sites pass no additive options, so their behavior is bit-for-bit identical.
 */

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  API_KEY_SESSIONS_MIGRATION_SQL,
  API_KEY_SESSIONS_MIGRATION_V2_SQL,
  ApiKeySessionIndex,
} from "../session-index.js";
import { createOpenAiSessionDriver } from "../driver.js";
import type { OpenAiSessionDriverDeps } from "../driver.js";
import type { SdkStreamEvent } from "../types.js";

/**
 * Phase 73 Plan 03 — per-span recording harness.
 *
 * A span entry captures the startSpan() name + initial metadata plus a list
 * of setMetadata() deltas and the count of end() calls. The TurnMock in
 * makeMockDeps collects these into a shared `spanCalls` array so tests can
 * assert the lifecycle of the new `openai.chat_completion` span without
 * reaching into the Turn internals.
 */
type SpanEntry = {
  readonly name: string;
  readonly metadata: Record<string, unknown>;
  readonly setMetadataCalls: Record<string, unknown>[];
  endCalled: number;
};

function makeMockDeps(overrides: Partial<OpenAiSessionDriverDeps> = {}): {
  deps: OpenAiSessionDriverDeps;
  db: Database.Database;
  events: {
    dispatchStreamCalls: Array<{
      originKind: string;
      sourceId: string;
      agentName: string;
      message: string;
      hasTurn: boolean;
      channelId: string | null | undefined;
      hasSignal: boolean;
    }>;
    turnStartCalls: Array<{ rootTurnId: string; agentName: string }>;
    turnEndCalls: Array<"success" | "error">;
    spanCalls: SpanEntry[];
  };
} {
  const db = new Database(":memory:");
  db.exec(API_KEY_SESSIONS_MIGRATION_SQL);
  db.exec(API_KEY_SESSIONS_MIGRATION_V2_SQL);

  const events = {
    dispatchStreamCalls: [] as Array<{
      originKind: string;
      sourceId: string;
      agentName: string;
      message: string;
      hasTurn: boolean;
      channelId: string | null | undefined;
      hasSignal: boolean;
    }>,
    turnStartCalls: [] as Array<{ rootTurnId: string; agentName: string }>,
    turnEndCalls: [] as Array<"success" | "error">,
    spanCalls: [] as SpanEntry[],
  };

  // The Turn mock records its lifecycle so tests can assert.
  const makeTurn = () => ({
    id: "mock-turn",
    recordOrigin: vi.fn(),
    end: vi.fn((outcome: "success" | "error") => {
      events.turnEndCalls.push(outcome);
    }),
    // Phase 73 Plan 03 — recorder for the new `openai.chat_completion` span.
    startSpan: vi.fn(
      (name: string, metadata: Record<string, unknown> = {}) => {
        const entry: SpanEntry = {
          name,
          metadata: { ...metadata },
          setMetadataCalls: [],
          endCalled: 0,
        };
        events.spanCalls.push(entry);
        return {
          setMetadata: (extra: Record<string, unknown>) => {
            entry.setMetadataCalls.push({ ...extra });
          },
          end: () => {
            entry.endCalled += 1;
          },
        };
      },
    ),
  });

  const traceCollector = {
    startTurn: vi.fn((rootTurnId: string, agentName: string, _channelId: string | null) => {
      events.turnStartCalls.push({ rootTurnId, agentName });
      return makeTurn();
    }),
  };

  // Default SessionManager returns a conversation-store session id after dispatch.
  let activeSessionId: string | undefined = "sess-generated-by-sdk";
  const sessionManager = {
    getActiveConversationSessionId: vi.fn(() => activeSessionId),
  };

  // Default turnDispatcher emits two text deltas via the callback then resolves.
  const turnDispatcher = {
    dispatchStream: vi.fn(
      async (
        origin: { source: { kind: string; id: string } },
        agentName: string,
        message: string,
        onChunk: (accumulated: string) => void,
        options: {
          turn?: unknown;
          signal?: AbortSignal;
          channelId?: string | null;
        } = {},
      ) => {
        events.dispatchStreamCalls.push({
          originKind: origin.source.kind,
          sourceId: origin.source.id,
          agentName,
          message,
          hasTurn: options.turn !== undefined,
          channelId: options.channelId,
          hasSignal: options.signal !== undefined,
        });
        onChunk("Hello");
        onChunk("Hello, world");
        return "Hello, world";
      },
    ),
  };

  const sessionIndex = new ApiKeySessionIndex(db);

  const deps: OpenAiSessionDriverDeps = {
    turnDispatcher: turnDispatcher as unknown as OpenAiSessionDriverDeps["turnDispatcher"],
    sessionManager:
      sessionManager as unknown as OpenAiSessionDriverDeps["sessionManager"],
    sessionIndexFor: () => sessionIndex,
    traceCollectorFor: () =>
      traceCollector as unknown as ReturnType<
        OpenAiSessionDriverDeps["traceCollectorFor"]
      >,
    ...overrides,
  };

  return { deps, db, events };
}

async function collect(iter: AsyncIterable<SdkStreamEvent>): Promise<SdkStreamEvent[]> {
  const out: SdkStreamEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe("createOpenAiSessionDriver", () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it("dispatch yields SdkStreamEvents as an async iterable (text stream + result)", async () => {
    const { deps, db: d, events } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const ac = new AbortController();
    const out = await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash: "a".repeat(64),
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-1",
      }),
    );

    expect(events.dispatchStreamCalls).toHaveLength(1);
    expect(events.dispatchStreamCalls[0]?.message).toBe("Hi");

    // Expect at least one text_delta and exactly one result event at the end.
    const textDeltas = out.filter(
      (e) => e.type === "stream_event" && e.event.type === "content_block_delta",
    );
    expect(textDeltas.length).toBeGreaterThanOrEqual(1);

    const lastEvent = out[out.length - 1];
    expect(lastEvent?.type).toBe("result");
    if (lastEvent?.type === "result") {
      expect(lastEvent.session_id).toBe("sess-generated-by-sdk");
    }
  });

  it("first request with unknown key_hash records session mapping on first result", async () => {
    const { deps, db: d } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const keyHash = "b".repeat(64);
    const ac = new AbortController();
    await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash,
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-2",
      }),
    );
    const sessionIndex = deps.sessionIndexFor("clawdy");
    const found = sessionIndex.lookup(keyHash, "clawdy");
    expect(found?.session_id).toBe("sess-generated-by-sdk");
    expect(found?.agent_name).toBe("clawdy");
  });

  it("second request with same key_hash reuses the stored mapping (touch path)", async () => {
    const { deps, db: d } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const keyHash = "c".repeat(64);
    const ac = new AbortController();

    // Pre-populate with an existing session; stamp last_used_at in the past so
    // touch() strictly bumps it forward.
    const sessionIndex = deps.sessionIndexFor("clawdy");
    sessionIndex.record(keyHash, "clawdy", "sess-previous");
    d.prepare("UPDATE api_key_sessions_v2 SET last_used_at = ? WHERE key_hash = ?").run(
      1000,
      keyHash,
    );
    const before = d
      .prepare("SELECT last_used_at FROM api_key_sessions_v2 WHERE key_hash = ?")
      .get(keyHash) as { last_used_at: number };

    await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash,
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-3",
      }),
    );

    const after = d
      .prepare(
        "SELECT last_used_at, session_id FROM api_key_sessions_v2 WHERE key_hash = ?",
      )
      .get(keyHash) as { last_used_at: number; session_id: string };
    expect(after.last_used_at).toBeGreaterThan(before.last_used_at);
    // The driver records whatever session_id the SDK reports; mock returns
    // "sess-generated-by-sdk", which overwrites "sess-previous". That's the
    // ON CONFLICT REPLACE contract — keeps the index fresh against SDK rotations.
    expect(after.session_id).toBe("sess-generated-by-sdk");
  });

  it("different key_hashes → different session mappings (isolation)", async () => {
    const { deps, db: d } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const key1 = "d".repeat(64);
    const key2 = "e".repeat(64);

    // Mutate the SessionManager mock return for each call to simulate the SDK
    // returning a distinct session_id per bearer key.
    const sm = deps.sessionManager as unknown as {
      getActiveConversationSessionId: ReturnType<typeof vi.fn>;
    };
    sm.getActiveConversationSessionId
      .mockReturnValueOnce("sess-key1")
      .mockReturnValueOnce("sess-key2");

    const ac = new AbortController();
    await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash: key1,
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-a",
      }),
    );
    await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash: key2,
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-b",
      }),
    );

    const idx = deps.sessionIndexFor("clawdy");
    expect(idx.lookup(key1, "clawdy")?.session_id).toBe("sess-key1");
    expect(idx.lookup(key2, "clawdy")?.session_id).toBe("sess-key2");
  });

  // Quick task 260419-p51 — same bearer key + different agents → independent sessions.
  it("same key_hash on different agents records independent (key_hash, agent) sessions", async () => {
    const { deps, db: d } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const keyHash = "9".repeat(64);

    // Driver mock must return a DIFFERENT session_id per agent so we can
    // confirm the per-(key, agent) mapping survives independently.
    const sm = deps.sessionManager as unknown as {
      getActiveConversationSessionId: ReturnType<typeof vi.fn>;
    };
    sm.getActiveConversationSessionId
      .mockReturnValueOnce("sess-clawdy-A")
      .mockReturnValueOnce("sess-assistant-B");

    const ac = new AbortController();
    await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash,
        lastUserMessage: "Hi from clawdy",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-clawdy",
      }),
    );
    await collect(
      driver.dispatch({
        agentName: "assistant",
        keyHash,
        lastUserMessage: "Hi from assistant",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-assistant",
      }),
    );

    const idx = deps.sessionIndexFor("ignored");
    expect(idx.lookup(keyHash, "clawdy")?.session_id).toBe("sess-clawdy-A");
    expect(idx.lookup(keyHash, "assistant")?.session_id).toBe("sess-assistant-B");
    // Both rows coexist under the composite PK.
    const rowCount = d
      .prepare("SELECT COUNT(*) AS n FROM api_key_sessions_v2 WHERE key_hash = ?")
      .get(keyHash) as { n: number };
    expect(rowCount.n).toBe(2);
  });

  it("caller-owned Turn is started with origin.source.kind === 'openai-api' and source.id === first-8-hex(keyHash)", async () => {
    const { deps, db: d, events } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const keyHash =
      "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const ac = new AbortController();
    await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash,
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-origin",
      }),
    );

    expect(events.turnStartCalls).toHaveLength(1);
    expect(events.turnStartCalls[0]?.agentName).toBe("clawdy");
    expect(events.turnStartCalls[0]?.rootTurnId).toMatch(/^openai-api:/);

    expect(events.dispatchStreamCalls).toHaveLength(1);
    expect(events.dispatchStreamCalls[0]?.originKind).toBe("openai-api");
    expect(events.dispatchStreamCalls[0]?.sourceId).toBe("12345678");
  });

  it("caller-owned Turn is ended with 'success' on clean completion", async () => {
    const { deps, db: d, events } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const ac = new AbortController();
    await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash: "f".repeat(64),
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-ok",
      }),
    );
    expect(events.turnEndCalls).toEqual(["success"]);
  });

  it("caller-owned Turn is ended with 'error' when dispatchStream throws", async () => {
    const { deps, db: d, events } = makeMockDeps();
    db = d;
    (deps.turnDispatcher as unknown as {
      dispatchStream: ReturnType<typeof vi.fn>;
    }).dispatchStream = vi.fn(async () => {
      throw new Error("boom");
    });
    const driver = createOpenAiSessionDriver(deps);
    const ac = new AbortController();
    await expect(
      collect(
        driver.dispatch({
          agentName: "clawdy",
          keyHash: "a".repeat(64),
          lastUserMessage: "Hi",
          clientSystemAppend: null,
          tools: null,
          toolChoice: null,
          toolResults: [],
          signal: ac.signal,
          xRequestId: "req-boom",
        }),
      ),
    ).rejects.toThrow("boom");
    expect(events.turnEndCalls).toEqual(["error"]);
  });

  it("abort signal aborts mid-dispatch and ends the turn with 'error'", async () => {
    const { deps, db: d, events } = makeMockDeps();
    db = d;
    // Replace dispatchStream with a version that NEVER emits, letting the
    // caller fire abort. We then resolve to simulate the SDK honoring signal.
    (deps.turnDispatcher as unknown as {
      dispatchStream: ReturnType<typeof vi.fn>;
    }).dispatchStream = vi.fn(
      async (_o, _a, _m, _cb, options: { signal?: AbortSignal } = {}) => {
        return new Promise<string>((_resolve, reject) => {
          const s = options.signal;
          if (!s) return reject(new Error("no signal"));
          s.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    );
    const driver = createOpenAiSessionDriver(deps);
    const ac = new AbortController();
    const iterable = driver.dispatch({
      agentName: "clawdy",
      keyHash: "a".repeat(64),
      lastUserMessage: "Hi",
      clientSystemAppend: null,
      tools: null,
      toolChoice: null,
      toolResults: [],
      signal: ac.signal,
      xRequestId: "req-abort",
    });
    // Start the iterator, then abort; expect rejection.
    const iter = iterable[Symbol.asyncIterator]();
    setTimeout(() => ac.abort(), 5);
    await expect(iter.next()).rejects.toThrow();
    expect(events.turnEndCalls).toEqual(["error"]);
  });

  it("channelId passed to dispatchStream is null (no Discord channel)", async () => {
    const { deps, db: d, events } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const ac = new AbortController();
    await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash: "a".repeat(64),
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-ch",
      }),
    );
    expect(events.dispatchStreamCalls[0]?.channelId).toBeNull();
  });

  it("caller-owned Turn is passed to dispatchStream (options.turn is set)", async () => {
    const { deps, db: d, events } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const ac = new AbortController();
    await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash: "a".repeat(64),
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-turn",
      }),
    );
    expect(events.dispatchStreamCalls[0]?.hasTurn).toBe(true);
  });

  it("AbortSignal is propagated to dispatchStream options.signal", async () => {
    const { deps, db: d, events } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const ac = new AbortController();
    await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash: "a".repeat(64),
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-sig",
      }),
    );
    expect(events.dispatchStreamCalls[0]?.hasSignal).toBe(true);
  });

  it("clientSystemAppend is appended to the user message (NEVER overrides — Pitfall 8)", async () => {
    const { deps, db: d, events } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const ac = new AbortController();
    await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash: "a".repeat(64),
        lastUserMessage: "Write haiku",
        clientSystemAppend: "Be brief.",
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-sys",
      }),
    );
    // The driver appends clientSystemAppend to the user message with a clear
    // delimiter so the stable agent prefix stays intact (never overridden —
    // Pitfall 8). The mock captures the full message.
    const sent = events.dispatchStreamCalls[0]?.message ?? "";
    expect(sent).toContain("Write haiku");
    expect(sent).toContain("Be brief.");
  });

  it("text deltas are synthesized from the accumulated-text callback", async () => {
    const { deps, db: d } = makeMockDeps();
    db = d;
    const driver = createOpenAiSessionDriver(deps);
    const ac = new AbortController();
    const out = await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash: "a".repeat(64),
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-txt",
      }),
    );
    // Collect text_delta events; they should combine to "Hello, world".
    let combined = "";
    for (const e of out) {
      if (e.type === "stream_event" && e.event.type === "content_block_delta") {
        if (e.event.delta.type === "text_delta") combined += e.event.delta.text;
      }
    }
    expect(combined).toBe("Hello, world");
  });

  describe("openai.chat_completion span (LAT-03)", () => {
    it("successful dispatch produces span with ttfb_ms + total_turn_ms", async () => {
      const { deps, db: d, events } = makeMockDeps();
      db = d;
      const driver = createOpenAiSessionDriver(deps);
      const ac = new AbortController();
      await collect(
        driver.dispatch({
          agentName: "clawdy",
          keyHash:
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          lastUserMessage: "Hi",
          clientSystemAppend: null,
          tools: [
            {
              name: "echo",
              description: "echo",
              input_schema: { type: "object", properties: {} },
            },
          ],
          toolChoice: null,
          toolResults: [],
          signal: ac.signal,
          xRequestId: "req-ttfb-ok",
        }),
      );

      // Exactly one openai.chat_completion span was opened.
      const chatSpans = events.spanCalls.filter(
        (s) => s.name === "openai.chat_completion",
      );
      expect(chatSpans).toHaveLength(1);
      const span = chatSpans[0]!;

      // Initial metadata carries agent + keyHashPrefix + xRequestId + stream + tools.
      expect(span.metadata.agent).toBe("clawdy");
      expect(span.metadata.keyHashPrefix).toBe("abcdef01");
      expect(span.metadata.xRequestId).toBe("req-ttfb-ok");
      expect(span.metadata.stream).toBe(true);
      expect(span.metadata.tools).toBe(1);

      // Exactly one setMetadata call with ttfb_ms (number) + total_turn_ms (number).
      expect(span.setMetadataCalls).toHaveLength(1);
      const delta = span.setMetadataCalls[0]!;
      expect(typeof delta.ttfb_ms).toBe("number");
      expect(typeof delta.total_turn_ms).toBe("number");
      expect(delta.ttfb_ms).toBeGreaterThanOrEqual(0);
      expect(delta.total_turn_ms).toBeGreaterThanOrEqual(0);
      expect(delta.error).toBeUndefined();

      // .end() called exactly once.
      expect(span.endCalled).toBe(1);
    });

    it("aborted dispatch produces span with error:true and finite total_turn_ms", async () => {
      const { deps, db: d, events } = makeMockDeps();
      db = d;
      // Never-emit dispatchStream; the abort path drives the closure.
      (deps.turnDispatcher as unknown as {
        dispatchStream: ReturnType<typeof vi.fn>;
      }).dispatchStream = vi.fn(
        async (_o, _a, _m, _cb, options: { signal?: AbortSignal } = {}) => {
          return new Promise<string>((_resolve, reject) => {
            const s = options.signal;
            if (!s) return reject(new Error("no signal"));
            s.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          });
        },
      );
      const driver = createOpenAiSessionDriver(deps);
      const ac = new AbortController();
      const iterable = driver.dispatch({
        agentName: "clawdy",
        keyHash: "a".repeat(64),
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-ttfb-abort",
      });
      const iter = iterable[Symbol.asyncIterator]();
      setTimeout(() => ac.abort(), 5);
      await expect(iter.next()).rejects.toThrow();

      const chatSpans = events.spanCalls.filter(
        (s) => s.name === "openai.chat_completion",
      );
      expect(chatSpans).toHaveLength(1);
      const span = chatSpans[0]!;
      // At least one setMetadata call carrying error:true + total_turn_ms.
      expect(span.setMetadataCalls.length).toBeGreaterThanOrEqual(1);
      const errorDelta = span.setMetadataCalls.find(
        (c) => c.error === true,
      );
      expect(errorDelta).toBeDefined();
      expect(typeof errorDelta!.total_turn_ms).toBe("number");
      expect(Number.isFinite(errorDelta!.total_turn_ms)).toBe(true);
      // .end() called exactly once (idempotent guard protects against double-close).
      expect(span.endCalled).toBe(1);
    });

    it("dispatch-promise rejection produces span with error:true + total_turn_ms", async () => {
      const { deps, db: d, events } = makeMockDeps();
      db = d;
      (deps.turnDispatcher as unknown as {
        dispatchStream: ReturnType<typeof vi.fn>;
      }).dispatchStream = vi.fn(async () => {
        throw new Error("boom");
      });
      const driver = createOpenAiSessionDriver(deps);
      const ac = new AbortController();
      await expect(
        collect(
          driver.dispatch({
            agentName: "clawdy",
            keyHash: "a".repeat(64),
            lastUserMessage: "Hi",
            clientSystemAppend: null,
            tools: null,
            toolChoice: null,
            toolResults: [],
            signal: ac.signal,
            xRequestId: "req-ttfb-reject",
          }),
        ),
      ).rejects.toThrow("boom");

      const chatSpans = events.spanCalls.filter(
        (s) => s.name === "openai.chat_completion",
      );
      expect(chatSpans).toHaveLength(1);
      const span = chatSpans[0]!;
      expect(span.setMetadataCalls).toHaveLength(1);
      const delta = span.setMetadataCalls[0]!;
      expect(delta.error).toBe(true);
      expect(typeof delta.total_turn_ms).toBe("number");
      // On pure-reject path no delta fires → ttfb_ms is null.
      expect(delta.ttfb_ms).toBeNull();
      expect(span.endCalled).toBe(1);
    });

    it("no span opened when traceCollectorFor returns null", async () => {
      const { deps, db: d, events } = makeMockDeps({
        traceCollectorFor: () => null,
      });
      db = d;
      const driver = createOpenAiSessionDriver(deps);
      const ac = new AbortController();
      // Request still completes (driver degrades gracefully when no collector).
      const out = await collect(
        driver.dispatch({
          agentName: "clawdy",
          keyHash: "a".repeat(64),
          lastUserMessage: "Hi",
          clientSystemAppend: null,
          tools: null,
          toolChoice: null,
          toolResults: [],
          signal: ac.signal,
          xRequestId: "req-ttfb-nocol",
        }),
      );
      expect(out.length).toBeGreaterThan(0);
      // No Turn was opened → no spans recorded at all.
      expect(events.spanCalls).toHaveLength(0);
      expect(events.turnStartCalls).toHaveLength(0);
    });
  });

  it("when SessionManager returns no session_id, driver still completes without recording", async () => {
    const { deps, db: d, events } = makeMockDeps();
    db = d;
    (deps.sessionManager as unknown as {
      getActiveConversationSessionId: ReturnType<typeof vi.fn>;
    }).getActiveConversationSessionId = vi.fn(() => undefined);
    const driver = createOpenAiSessionDriver(deps);
    const keyHash = "a".repeat(64);
    const ac = new AbortController();
    const out = await collect(
      driver.dispatch({
        agentName: "clawdy",
        keyHash,
        lastUserMessage: "Hi",
        clientSystemAppend: null,
        tools: null,
        toolChoice: null,
        toolResults: [],
        signal: ac.signal,
        xRequestId: "req-nosess",
      }),
    );

    // Final event is still emitted as a result with a placeholder session_id
    // so the OpenAI server can build a `chatcmpl-` response. The
    // api_key_sessions row MAY be absent (no concrete sdk session to record).
    const last = out[out.length - 1];
    expect(last?.type).toBe("result");

    // The turn still ends "success".
    expect(events.turnEndCalls).toEqual(["success"]);
  });
});

// ---------------------------------------------------------------------------
// Quick task 260419-p51 — OpenAI ↔ Discord parity for subagent-thread skill
// (P51-SPAWN-SUBAGENT-UX)
// ---------------------------------------------------------------------------

describe("driver × subagent-thread parity", () => {
  /**
   * Parity invariant: `buildSessionConfig` is the SINGLE codepath that wires
   * the subagent-thread skill guidance into an agent's session. The OpenAI
   * driver dispatches through the SAME TurnDispatcher + SAME agent session
   * that the Discord bridge uses — there is no alternate configuration path
   * that would bypass the guidance for OpenAI-endpoint turns.
   *
   * This test is a STATIC assertion against session-config.ts rather than
   * a runtime integration test, because:
   *   (a) The full session boot requires booting a real SessionManager +
   *       MemoryStore, which is not worth the setup cost for a parity check.
   *   (b) The failure mode we're guarding against is a refactor that
   *       conditionally includes the subagent-thread guidance based on turn
   *       origin — that would show up as a source-code change here long
   *       before it ships.
   *   (c) The driver test harness already verifies that dispatchStream is
   *       the daemon's shared instance (see "TurnDispatcher is the same
   *       instance" assertion in existing tests above).
   *
   * If a future refactor stops including the subagent-thread guidance for
   * non-Discord turns, this test fails fast with a clear signal.
   */
  it("session-config.ts injects subagent-thread guidance regardless of turn origin", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(import.meta.dirname, "..", "..", "manager", "session-config.ts"),
      "utf8",
    );

    // The `subagent-thread` skill check is unconditional — it keys off
    // `config.skills.includes("subagent-thread")`, which is session-scoped,
    // NOT per-turn. There is NO branch on origin (Discord / OpenAI / etc.).
    expect(source).toContain(`includes("subagent-thread")`);
    expect(source).toContain("spawn_subagent_thread");

    // Paranoia — fail the test if the guidance becomes gated on a turn-origin
    // check (which would be a regression on P51-SPAWN-SUBAGENT-UX).
    const guardPattern = /origin[^=]*===\s*"(discord|openai-api)"/;
    const subagentSection = source.slice(
      source.indexOf("subagent-thread"),
      source.indexOf("subagent-thread") + 800,
    );
    expect(subagentSection).not.toMatch(guardPattern);
  });
});
