import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wave 0 RED tests for SdkSessionAdapter tracing integration.
 *
 * Wave 2 adds these behaviors to session-adapter.ts:
 *   - `first_token` span ends on the first text content block of a PARENT
 *     assistant message (parent_tool_use_id == null).
 *   - `tool_call.<name>` span opens on each `tool_use` content block and
 *     ends on the matching tool_use_result (user message with matching
 *     `parent_tool_use_id`).
 *   - `end_to_end` span covers the full stream from send dispatch to
 *     `result` message.
 *   - Subagent assistant messages (parent_tool_use_id set) do NOT close the
 *     parent first_token span.
 *   - `sendAndCollect` applies the same tracing as `sendAndStream`.
 *
 * These tests import `createTracedSessionHandle` — a Wave 2-added named
 * export. Today the import fails with "Cannot find name", giving us a
 * clean RED.
 */

import { createTracedSessionHandle } from "../session-adapter.js";

type MockTurn = {
  startSpan: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  recordCacheUsage: ReturnType<typeof vi.fn>;
};

type MockSpan = {
  end: ReturnType<typeof vi.fn>;
};

function createMockTurn(): { turn: MockTurn; spansByName: Map<string, MockSpan[]> } {
  const spansByName = new Map<string, MockSpan[]>();
  const startSpan = vi.fn((name: string): MockSpan => {
    const span: MockSpan = { end: vi.fn() };
    if (!spansByName.has(name)) {
      spansByName.set(name, []);
    }
    spansByName.get(name)!.push(span);
    return span;
  });
  const end = vi.fn();
  const recordCacheUsage = vi.fn();
  return { turn: { startSpan, end, recordCacheUsage }, spansByName };
}

/**
 * Build an async iterable that yields the supplied SDK messages in order.
 */
function makeSdkStream(messages: ReadonlyArray<unknown>) {
  async function* gen() {
    for (const m of messages) {
      yield m;
    }
  }
  const query: any = gen();
  query.interrupt = vi.fn();
  query.close = vi.fn();
  query.streamInput = vi.fn();
  query.mcpServerStatus = vi.fn();
  query.setMcpServers = vi.fn();
  return query;
}

describe("SdkSessionAdapter tracing", () => {
  let mockSdk: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSdk = { query: vi.fn() };
  });

  it("first_token: ends on the first text content block of the parent assistant message", async () => {
    const messages = [
      { type: "system", subtype: "init" },
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "Hello" }] },
      },
      { type: "result", subtype: "success", result: "Hello", session_id: "sess-1" },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    const { turn, spansByName } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "sess-1",
      turn,
    });

    await handle.sendAndStream("prompt", () => undefined);

    expect(turn.startSpan).toHaveBeenCalledWith("first_token", expect.anything());
    const firstTokenSpans = spansByName.get("first_token") ?? [];
    expect(firstTokenSpans.length).toBe(1);
    expect(firstTokenSpans[0]!.end).toHaveBeenCalled();
  });

  it("tool_call: opens a tool_call.<name> span on each tool_use content block and ends it on the matching tool_use_result", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_use", id: "tu-1", name: "memory_lookup", input: {} },
          ],
        },
      },
      {
        type: "user",
        parent_tool_use_id: "tu-1",
        message: { content: [{ type: "tool_result", tool_use_id: "tu-1", content: "ok" }] },
      },
      { type: "result", subtype: "success", result: "", session_id: "sess-1" },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    const { turn, spansByName } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "sess-1",
      turn,
    });

    await handle.sendAndStream("prompt", () => undefined);

    expect(turn.startSpan).toHaveBeenCalledWith(
      "tool_call.memory_lookup",
      expect.objectContaining({ tool_use_id: "tu-1" }),
    );
    const toolSpans = spansByName.get("tool_call.memory_lookup") ?? [];
    expect(toolSpans.length).toBe(1);
    expect(toolSpans[0]!.end).toHaveBeenCalled();
  });

  it("subagent: does NOT end first_token when the assistant message has non-null parent_tool_use_id", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: "some-tool-id", // SUBAGENT — filtered
        message: { content: [{ type: "text", text: "inner subagent text" }] },
      },
      {
        type: "assistant",
        parent_tool_use_id: null, // PARENT — should trigger first_token
        message: { content: [{ type: "text", text: "outer parent text" }] },
      },
      { type: "result", subtype: "success", result: "done", session_id: "sess-1" },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    const { turn, spansByName } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "sess-1",
      turn,
    });

    await handle.sendAndStream("prompt", () => undefined);

    const firstTokenSpans = spansByName.get("first_token") ?? [];
    expect(firstTokenSpans.length).toBe(1);
    // first_token must have ended exactly once, triggered by the PARENT message.
    expect(firstTokenSpans[0]!.end).toHaveBeenCalledTimes(1);
  });

  it("end_to_end: span covers the full stream (start at send dispatch, end at result)", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "hi" }] },
      },
      { type: "result", subtype: "success", result: "hi", session_id: "sess-1" },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    const { turn, spansByName } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "sess-1",
      turn,
    });

    await handle.sendAndStream("prompt", () => undefined);

    const endToEndSpans = spansByName.get("end_to_end") ?? [];
    expect(endToEndSpans.length).toBe(1);
    expect(endToEndSpans[0]!.end).toHaveBeenCalled();
  });

  it("sendAndCollect applies the same instrumentation as sendAndStream (Pitfall 2 guard)", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "collect-response" }] },
      },
      { type: "result", subtype: "success", result: "collect-response", session_id: "sess-1" },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    const { turn, spansByName } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "sess-1",
      turn,
    });

    await handle.sendAndCollect("prompt");

    // Tracing must have fired on the collect path the same way as stream.
    const firstTokenSpans = spansByName.get("first_token") ?? [];
    expect(firstTokenSpans.length).toBe(1);
    expect(firstTokenSpans[0]!.end).toHaveBeenCalled();

    const endToEndSpans = spansByName.get("end_to_end") ?? [];
    expect(endToEndSpans.length).toBe(1);
    expect(endToEndSpans[0]!.end).toHaveBeenCalled();
  });
});

// ── Phase 55 Plan 02 — tool_call span metadata enrichment ──────────────────

/**
 * Richer mock Turn for Phase 55 tests: each span exposes its initial metadata
 * plus a setMetadata spy so we can assert `{ tool_name, is_parallel, cached }`
 * are present at span open and updated on cache hits.
 */
type PhaseSpan = {
  metadata: Record<string, unknown>;
  setMetadata: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  startedAtMs: number;
};

function createPhase55MockTurn(options?: {
  readonly hitCountSequence?: readonly number[];
}): {
  turn: {
    startSpan: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    recordCacheUsage: ReturnType<typeof vi.fn>;
    toolCache: { hitCount: () => number };
  };
  spansByName: Map<string, PhaseSpan[]>;
} {
  const spansByName = new Map<string, PhaseSpan[]>();
  let hitCountIdx = 0;
  const hitCountSequence = options?.hitCountSequence ?? [];

  const startSpan = vi.fn((name: string, metadata: Record<string, unknown> = {}): PhaseSpan => {
    const span: PhaseSpan = {
      metadata: { ...metadata },
      setMetadata: vi.fn(function (this: PhaseSpan, extra: Record<string, unknown>) {
        Object.assign(this.metadata, extra);
      }),
      end: vi.fn(),
      startedAtMs: Date.now(),
    };
    if (!spansByName.has(name)) spansByName.set(name, []);
    spansByName.get(name)!.push(span);
    return span;
  });

  const toolCache = {
    hitCount: vi.fn(() => {
      if (hitCountIdx < hitCountSequence.length) {
        const v = hitCountSequence[hitCountIdx]!;
        hitCountIdx++;
        return v;
      }
      return 0;
    }),
  };

  return {
    turn: {
      startSpan,
      end: vi.fn(),
      recordCacheUsage: vi.fn(),
      toolCache,
    },
    spansByName,
  };
}

describe("SdkSessionAdapter tool_call span metadata enrichment (Phase 55)", () => {
  let mockSdk: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSdk = { query: vi.fn() };
  });

  it("Test 7: tool_call.<name> span metadata includes tool_name, cached, is_parallel", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_use", id: "tu-solo", name: "memory_lookup", input: {} },
          ],
        },
      },
      {
        type: "user",
        parent_tool_use_id: "tu-solo",
        message: { content: [{ type: "tool_result", tool_use_id: "tu-solo", content: "ok" }] },
      },
      { type: "result", subtype: "success", result: "", session_id: "s-meta" },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    const { turn, spansByName } = createPhase55MockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s-meta",
      turn,
    });

    await handle.sendAndStream("prompt", () => undefined);

    const toolSpans = spansByName.get("tool_call.memory_lookup") ?? [];
    expect(toolSpans.length).toBe(1);
    const meta = toolSpans[0]!.metadata;
    // Required keys at span open per Phase 55 CONTEXT decisions.
    expect(meta).toMatchObject({
      tool_name: "memory_lookup",
      tool_use_id: "tu-solo",
      is_parallel: false, // single tool_use block in the assistant message
      cached: false, // no cache hit happened during the span
    });
  });

  it("Test 8: two tool_use blocks in same assistant message dispatch in parallel — started_at within 10ms, is_parallel=true", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_use", id: "tu-a", name: "memory_lookup", input: { q: "a" } },
            { type: "tool_use", id: "tu-b", name: "memory_lookup", input: { q: "b" } },
          ],
        },
      },
      {
        type: "user",
        parent_tool_use_id: "tu-a",
        message: { content: [{ type: "tool_result", tool_use_id: "tu-a", content: "ok" }] },
      },
      {
        type: "user",
        parent_tool_use_id: "tu-b",
        message: { content: [{ type: "tool_result", tool_use_id: "tu-b", content: "ok" }] },
      },
      { type: "result", subtype: "success", result: "", session_id: "s-par" },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    const { turn, spansByName } = createPhase55MockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s-par",
      turn,
    });

    await handle.sendAndStream("prompt", () => undefined);

    const toolSpans = spansByName.get("tool_call.memory_lookup") ?? [];
    expect(toolSpans.length).toBe(2);
    const [a, b] = toolSpans;
    expect(a!.metadata.is_parallel).toBe(true);
    expect(b!.metadata.is_parallel).toBe(true);
    // Both spans were started within 10ms of each other (proves parallel dispatch,
    // not serial — they were opened synchronously during the same message
    // content[] scan).
    expect(Math.abs(a!.startedAtMs - b!.startedAtMs)).toBeLessThanOrEqual(10);
  });

  it("Test 9: tool_call in a SEPARATE assistant message (single tool_use) is NOT is_parallel", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_use", id: "tu-1", name: "memory_lookup", input: { q: "a" } },
          ],
        },
      },
      {
        type: "user",
        parent_tool_use_id: "tu-1",
        message: { content: [{ type: "tool_result", tool_use_id: "tu-1", content: "ok" }] },
      },
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_use", id: "tu-2", name: "memory_lookup", input: { q: "b" } },
          ],
        },
      },
      {
        type: "user",
        parent_tool_use_id: "tu-2",
        message: { content: [{ type: "tool_result", tool_use_id: "tu-2", content: "ok" }] },
      },
      { type: "result", subtype: "success", result: "", session_id: "s-seq" },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    const { turn, spansByName } = createPhase55MockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s-seq",
      turn,
    });

    await handle.sendAndStream("prompt", () => undefined);

    const toolSpans = spansByName.get("tool_call.memory_lookup") ?? [];
    expect(toolSpans.length).toBe(2);
    for (const s of toolSpans) {
      expect(s.metadata.is_parallel).toBe(false);
    }
  });

  it("on cache hit (toolCache.hitCount increments during span), span is updated with cached=true + cache_hit_duration_ms", async () => {
    // hitCountSequence: called twice per span (start, end). Span A:
    //   start: 0  end: 1  → delta=1, cached=true
    // Span B:
    //   start: 1  end: 1  → delta=0, cached=false
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_use", id: "tu-hit", name: "memory_lookup", input: { q: "a" } },
            { type: "tool_use", id: "tu-miss", name: "search_documents", input: { q: "b" } },
          ],
        },
      },
      {
        type: "user",
        parent_tool_use_id: "tu-hit",
        message: { content: [{ type: "tool_result", tool_use_id: "tu-hit", content: "ok" }] },
      },
      {
        type: "user",
        parent_tool_use_id: "tu-miss",
        message: { content: [{ type: "tool_result", tool_use_id: "tu-miss", content: "ok" }] },
      },
      { type: "result", subtype: "success", result: "", session_id: "s-cache" },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    const { turn, spansByName } = createPhase55MockTurn({
      // Order of toolCache.hitCount() calls:
      //   A open → 0   (baseline for memory_lookup span)
      //   B open → 1   (baseline for search_documents span — hit already fired for A)
      //   A end  → 1   (delta 1 > 0 → cached=true on memory_lookup span)
      //   B end  → 1   (delta 1 > 1 = 0 → cached stays false on search_documents span)
      hitCountSequence: [0, 1, 1, 1],
    });
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s-cache",
      turn,
    });

    await handle.sendAndStream("prompt", () => undefined);

    const lookupSpans = spansByName.get("tool_call.memory_lookup") ?? [];
    const docSpans = spansByName.get("tool_call.search_documents") ?? [];
    expect(lookupSpans.length).toBe(1);
    expect(docSpans.length).toBe(1);
    // memory_lookup span: delta 0→1 → cached=true
    expect(lookupSpans[0]!.metadata.cached).toBe(true);
    expect(typeof lookupSpans[0]!.metadata.cache_hit_duration_ms).toBe("number");
    // search_documents span: delta 1→1 → cached=false (no update)
    expect(docSpans[0]!.metadata.cached).toBe(false);
  });
});

describe("cache usage capture (Phase 52)", () => {
  let mockSdk: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSdk = { query: vi.fn() };
  });

  it("calls turn.recordCacheUsage with cache_read/creation/input tokens from the SDK result message", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "hi" }] },
      },
      {
        type: "result",
        subtype: "success",
        result: "hi",
        session_id: "sess-cache-1",
        usage: {
          input_tokens: 50,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 500,
          output_tokens: 200,
        },
      },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    const { turn } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "sess-cache-1",
      turn,
    });

    await handle.sendAndCollect("hi");

    expect(turn.recordCacheUsage).toHaveBeenCalledTimes(1);
    expect(turn.recordCacheUsage).toHaveBeenCalledWith({
      cacheReadInputTokens: 500,
      cacheCreationInputTokens: 100,
      inputTokens: 50,
    });
  });

  it("does not throw when turn is undefined (no-turn path is a compile-time no-op)", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "hi" }] },
      },
      {
        type: "result",
        subtype: "success",
        result: "hi",
        session_id: "sess-cache-2",
        usage: {
          input_tokens: 50,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 500,
        },
      },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    // No `turn` in opts → bound turn is undefined. Call must not throw.
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "sess-cache-2",
    });

    await expect(handle.sendAndCollect("hi")).resolves.toBe("hi");
  });

  it("treats missing usage fields as 0 (not NaN / undefined)", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "hi" }] },
      },
      {
        type: "result",
        subtype: "success",
        result: "hi",
        session_id: "sess-cache-3",
        usage: {}, // empty — all fields missing
      },
    ];
    mockSdk.query.mockReturnValueOnce(makeSdkStream(messages));

    const { turn } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "sess-cache-3",
      turn,
    });

    await handle.sendAndCollect("hi");

    expect(turn.recordCacheUsage).toHaveBeenCalledTimes(1);
    expect(turn.recordCacheUsage).toHaveBeenCalledWith({
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      inputTokens: 0,
    });
  });
});

// ── Phase 52 Plan 02 — SDK preset+append + mutableSuffix + prefixHash ───────

describe("SdkSessionAdapter preset+append for createSession/resumeSession (Phase 52)", () => {
  let mockSdkModule: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSdkModule = { query: vi.fn() };
  });

  function initialStream(sessionId: string) {
    return makeSdkStream([
      { type: "result", subtype: "success", session_id: sessionId },
    ]);
  }

  it("createSession emits systemPrompt as { type: 'preset', preset: 'claude_code', append: <stable> }", async () => {
    mockSdkModule.query.mockReturnValueOnce(initialStream("new-sess"));

    // Use the private buildBaseOptions logic via the exported adapter class. The
    // adapter dynamically imports the SDK, so we stub it by pre-populating the
    // module cache via the exported createTracedSessionHandle — which constructs
    // the same baseOptions shape. Here we use a direct build helper:
    const { buildSystemPromptOption } = (await import(
      "../session-adapter.js"
    )) as unknown as {
      buildSystemPromptOption: (prefix: string) =>
        | { type: "preset"; preset: "claude_code"; append: string }
        | { type: "preset"; preset: "claude_code" };
    };

    const opt = buildSystemPromptOption("stable-identity-block");
    expect(opt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "stable-identity-block",
    });
  });

  it("buildSystemPromptOption omits `append` when stable prefix is empty", async () => {
    const { buildSystemPromptOption } = (await import(
      "../session-adapter.js"
    )) as unknown as {
      buildSystemPromptOption: (
        prefix: string,
      ) =>
        | { type: "preset"; preset: "claude_code"; append?: string }
        | { type: "preset"; preset: "claude_code" };
    };

    const opt = buildSystemPromptOption("");
    expect(opt).toEqual({
      type: "preset",
      preset: "claude_code",
    });
  });
});

describe("SdkSessionAdapter systemPrompt preset wiring (Phase 52)", () => {
  let mockSdk: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSdk = { query: vi.fn() };
  });

  it("sendAndCollect prepends mutableSuffix to message when baseOptions carries it", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "ok" }] },
      },
      { type: "result", subtype: "success", result: "ok", session_id: "s1" },
    ];
    mockSdk.query.mockReturnValue(makeSdkStream(messages));

    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: { mutableSuffix: "## Discord\nchannel=foo" },
      sessionId: "s1",
    });

    await handle.sendAndCollect("user question");

    const call = mockSdk.query.mock.calls[0]![0];
    expect(typeof call.prompt).toBe("string");
    expect(call.prompt.startsWith("## Discord\nchannel=foo\n\n")).toBe(true);
    expect(call.prompt.endsWith("user question")).toBe(true);
  });

  it("sendAndCollect passes message unchanged when baseOptions has no mutableSuffix", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "ok" }] },
      },
      { type: "result", subtype: "success", result: "ok", session_id: "s1" },
    ];
    mockSdk.query.mockReturnValue(makeSdkStream(messages));

    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s1",
    });

    await handle.sendAndCollect("user question");

    const call = mockSdk.query.mock.calls[0]![0];
    expect(call.prompt).toBe("user question");
  });

  it("mutableSuffix is stripped from turnOptions forwarded to sdk.query (not a real SDK option)", async () => {
    const messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "ok" }] },
      },
      { type: "result", subtype: "success", result: "ok", session_id: "s1" },
    ];
    mockSdk.query.mockReturnValue(makeSdkStream(messages));

    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: { mutableSuffix: "## Discord\nx" },
      sessionId: "s1",
    });

    await handle.sendAndCollect("hi");

    const call = mockSdk.query.mock.calls[0]![0];
    expect(call.options.mutableSuffix).toBeUndefined();
  });
});

describe("SdkSessionAdapter prefix_hash per-turn recording (Phase 52 CACHE-04)", () => {
  let mockSdk: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSdk = { query: vi.fn() };
  });

  function buildResult() {
    return [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "ok" }] },
      },
      {
        type: "result",
        subtype: "success",
        result: "ok",
        session_id: "s1",
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    ];
  }

  it("records prefixHash and cacheEvictionExpected=false on first turn (no prior hash)", async () => {
    mockSdk.query.mockReturnValue(makeSdkStream(buildResult()));

    let persisted: string | undefined;
    const provider = {
      get: () => ({ current: "a".repeat(64), last: undefined as string | undefined }),
      persist: (h: string) => {
        persisted = h;
      },
    };

    const { turn } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s1",
      turn,
      prefixHashProvider: provider,
    });

    await handle.sendAndCollect("hi");

    expect(turn.recordCacheUsage).toHaveBeenCalledTimes(1);
    const call = turn.recordCacheUsage.mock.calls[0]![0];
    expect(call.prefixHash).toBe("a".repeat(64));
    expect(call.cacheEvictionExpected).toBe(false);
    expect(persisted).toBe("a".repeat(64));
  });

  it("records cacheEvictionExpected=true when prefixHash changes between consecutive turns", async () => {
    mockSdk.query.mockReturnValue(makeSdkStream(buildResult()));
    let lastHash: string | undefined;
    const current = { current: "hash_A", last: undefined as string | undefined };
    const provider = {
      get: () => ({ ...current, last: lastHash }),
      persist: (h: string) => {
        lastHash = h;
      },
    };

    const { turn } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s1",
      turn,
      prefixHashProvider: provider,
    });

    // Turn 1: current=hash_A, last=undefined → eviction=false
    await handle.sendAndCollect("hi");
    expect(turn.recordCacheUsage).toHaveBeenCalledTimes(1);
    let call = turn.recordCacheUsage.mock.calls[0]![0];
    expect(call.prefixHash).toBe("hash_A");
    expect(call.cacheEvictionExpected).toBe(false);

    // Turn 2: simulate prefix drift — hash_B now current.
    current.current = "hash_B";
    mockSdk.query.mockReturnValue(makeSdkStream(buildResult()));
    await handle.sendAndCollect("hi");
    expect(turn.recordCacheUsage).toHaveBeenCalledTimes(2);
    call = turn.recordCacheUsage.mock.calls[1]![0];
    expect(call.prefixHash).toBe("hash_B");
    expect(call.cacheEvictionExpected).toBe(true);
  });

  it("records cacheEvictionExpected=false when prefixHash is unchanged between consecutive turns", async () => {
    mockSdk.query.mockReturnValue(makeSdkStream(buildResult()));
    let lastHash: string | undefined;
    const current = { current: "hash_A", last: undefined as string | undefined };
    const provider = {
      get: () => ({ ...current, last: lastHash }),
      persist: (h: string) => {
        lastHash = h;
      },
    };

    const { turn } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s1",
      turn,
      prefixHashProvider: provider,
    });

    await handle.sendAndCollect("hi"); // turn 1
    mockSdk.query.mockReturnValue(makeSdkStream(buildResult()));
    await handle.sendAndCollect("hi"); // turn 2 — same hash

    expect(turn.recordCacheUsage).toHaveBeenCalledTimes(2);
    const call2 = turn.recordCacheUsage.mock.calls[1]![0];
    expect(call2.prefixHash).toBe("hash_A");
    expect(call2.cacheEvictionExpected).toBe(false);
  });

  it("does not throw when prefixHashProvider is absent (optional)", async () => {
    mockSdk.query.mockReturnValue(makeSdkStream(buildResult()));
    const { turn } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s1",
      turn,
      // no prefixHashProvider — should still capture token counts
    });

    await expect(handle.sendAndCollect("hi")).resolves.toBe("ok");
    expect(turn.recordCacheUsage).toHaveBeenCalledTimes(1);
    const call = turn.recordCacheUsage.mock.calls[0]![0];
    expect(call.prefixHash).toBeUndefined();
    expect(call.cacheEvictionExpected).toBeUndefined();
  });

  it("observational contract: provider throw does NOT break the message path (silent swallow)", async () => {
    mockSdk.query.mockReturnValue(makeSdkStream(buildResult()));
    const provider = {
      get: () => {
        throw new Error("boom");
      },
      persist: vi.fn(),
    };
    const { turn } = createMockTurn();
    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s1",
      turn,
      prefixHashProvider: provider,
    });

    await expect(handle.sendAndCollect("hi")).resolves.toBe("ok");
    // token counts still captured despite provider throwing
    expect(turn.recordCacheUsage).toHaveBeenCalledTimes(1);
    const call = turn.recordCacheUsage.mock.calls[0]![0];
    expect(call.prefixHash).toBeUndefined();
    expect(call.cacheEvictionExpected).toBeUndefined();
  });
});

// ── Phase 53 Plan 03 — skill usage capture ──────────────────────────────────

describe("SdkSessionAdapter skill usage capture (Phase 53)", () => {
  let mockSdk: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSdk = { query: vi.fn() };
  });

  function buildResultWithText(text: string) {
    return [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text }] },
      },
      {
        type: "result",
        subtype: "success",
        result: text,
        session_id: "s1",
      },
    ];
  }

  it("Test 10: records skill mentions found in the assistant text for the turn", async () => {
    mockSdk.query.mockReturnValue(
      makeSdkStream(buildResultWithText("I'll use search-first to research this.")),
    );

    const recordTurn = vi.fn();
    const tracker = {
      recordTurn,
    } as unknown as import("../../usage/skill-usage-tracker.js").SkillUsageTracker;

    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s1",
      skillTracking: {
        skillUsageTracker: tracker,
        agentName: "agent-a",
        skillCatalogNames: ["search-first", "content-engine"],
      },
    });

    await handle.sendAndCollect("hi");

    expect(recordTurn).toHaveBeenCalledTimes(1);
    expect(recordTurn).toHaveBeenCalledWith("agent-a", {
      mentionedSkills: ["search-first"],
    });
  });

  it("Test 11: tracker.recordTurn throw is silent-swallowed (observational contract)", async () => {
    mockSdk.query.mockReturnValue(
      makeSdkStream(buildResultWithText("using content-engine here")),
    );

    const tracker = {
      recordTurn: vi.fn(() => {
        throw new Error("tracker boom");
      }),
    } as unknown as import("../../usage/skill-usage-tracker.js").SkillUsageTracker;

    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s1",
      skillTracking: {
        skillUsageTracker: tracker,
        agentName: "agent-a",
        skillCatalogNames: ["content-engine"],
      },
    });

    // Message path must not throw despite the tracker error.
    await expect(handle.sendAndCollect("hi")).resolves.toBeDefined();
  });

  it("Test 12: no skillTracking option → zero tracker interaction (no errors, no calls)", async () => {
    mockSdk.query.mockReturnValue(
      makeSdkStream(buildResultWithText("search-first was mentioned")),
    );

    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s1",
      // skillTracking intentionally omitted
    });

    await expect(handle.sendAndCollect("hi")).resolves.toBeDefined();
  });

  it("Test 13: catalog filter — only configured skill names are recognized", async () => {
    mockSdk.query.mockReturnValue(
      makeSdkStream(
        buildResultWithText(
          "I'll use search-first and market-research but not noodle-soup.",
        ),
      ),
    );

    const recordTurn = vi.fn();
    const tracker = {
      recordTurn,
    } as unknown as import("../../usage/skill-usage-tracker.js").SkillUsageTracker;

    const handle = (createTracedSessionHandle as any)({
      sdk: mockSdk,
      baseOptions: {},
      sessionId: "s1",
      skillTracking: {
        skillUsageTracker: tracker,
        agentName: "agent-a",
        // noodle-soup is NOT in the catalog
        skillCatalogNames: ["search-first", "market-research"],
      },
    });

    await handle.sendAndCollect("hi");

    expect(recordTurn).toHaveBeenCalledTimes(1);
    const [agent, event] = recordTurn.mock.calls[0]!;
    expect(agent).toBe("agent-a");
    expect(event.mentionedSkills).toContain("search-first");
    expect(event.mentionedSkills).toContain("market-research");
    expect(event.mentionedSkills).not.toContain("noodle-soup");
  });
});

// ---------------------------------------------------------------------------
// Phase 59 — MockSessionHandle AbortSignal tests
// ---------------------------------------------------------------------------
import { MockSessionHandle } from "../session-adapter.js";

describe("MockSessionHandle — AbortSignal (Phase 59)", () => {
  it("sendAndCollect rejects with AbortError when signal is pre-aborted", async () => {
    const handle = new MockSessionHandle("s1");
    const controller = new AbortController();
    controller.abort();
    await expect(
      handle.sendAndCollect("hello", undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sendAndCollect succeeds when signal is not aborted", async () => {
    const handle = new MockSessionHandle("s1");
    const controller = new AbortController();
    const result = await handle.sendAndCollect("hello", undefined, { signal: controller.signal });
    expect(result).toBe("Mock response from s1");
  });

  it("sendAndStream rejects with AbortError when signal is pre-aborted", async () => {
    const handle = new MockSessionHandle("s1");
    const controller = new AbortController();
    controller.abort();
    await expect(
      handle.sendAndStream("hello", () => {}, undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("send rejects with AbortError when signal is pre-aborted", async () => {
    const handle = new MockSessionHandle("s1");
    const controller = new AbortController();
    controller.abort();
    await expect(
      handle.send("hello", undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
