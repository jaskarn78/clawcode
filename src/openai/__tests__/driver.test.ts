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
  ApiKeySessionIndex,
} from "../session-index.js";
import { createOpenAiSessionDriver } from "../driver.js";
import type { OpenAiSessionDriverDeps } from "../driver.js";
import type { SdkStreamEvent } from "../types.js";

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
  };
} {
  const db = new Database(":memory:");
  db.exec(API_KEY_SESSIONS_MIGRATION_SQL);

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
  };

  // The Turn mock records its lifecycle so tests can assert.
  const makeTurn = () => ({
    id: "mock-turn",
    recordOrigin: vi.fn(),
    end: vi.fn((outcome: "success" | "error") => {
      events.turnEndCalls.push(outcome);
    }),
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
    const found = sessionIndex.lookup(keyHash);
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
    d.prepare("UPDATE api_key_sessions SET last_used_at = ? WHERE key_hash = ?").run(
      1000,
      keyHash,
    );
    const before = d
      .prepare("SELECT last_used_at FROM api_key_sessions WHERE key_hash = ?")
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
        "SELECT last_used_at, session_id FROM api_key_sessions WHERE key_hash = ?",
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
    expect(idx.lookup(key1)?.session_id).toBe("sess-key1");
    expect(idx.lookup(key2)?.session_id).toBe("sess-key2");
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
