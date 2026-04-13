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

// @ts-expect-error - Wave 2 will add this export; Wave 0 leaves it missing for RED state.
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
