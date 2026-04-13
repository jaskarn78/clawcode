import { describe, it, expect, beforeEach, vi } from "vitest";
import { TraceCollector } from "../trace-collector.js";
import type { TraceStore } from "../trace-store.js";
import type { TurnRecord } from "../types.js";

/**
 * Minimal mock TraceStore for Wave 0 scaffolding.
 *
 * Captures every `writeTurn` invocation so we can inspect the
 * committed TurnRecord shape, metadata passthrough, and freeze semantics.
 */
function createMockStore(): {
  store: TraceStore;
  writeTurn: ReturnType<typeof vi.fn>;
} {
  const writeTurn = vi.fn();
  const store = {
    writeTurn,
    pruneOlderThan: vi.fn().mockReturnValue(0),
    close: vi.fn(),
    getPercentiles: vi.fn().mockReturnValue([]),
  } as unknown as TraceStore;
  return { store, writeTurn };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

describe("TraceCollector", () => {
  let store: TraceStore;
  let writeTurn: ReturnType<typeof vi.fn>;
  let collector: TraceCollector;

  beforeEach(() => {
    const mock = createMockStore();
    store = mock.store;
    writeTurn = mock.writeTurn;
    collector = new TraceCollector(store, createMockLogger());
  });

  it("startTurn returns a Turn with the given id and agent", () => {
    const turn = collector.startTurn("msg-123", "alpha", "channel-1");
    expect(turn).toBeDefined();
    // Turn should expose readable identity — either via public fields or accessor
    const turnAny = turn as unknown as { id?: string; agent?: string; channelId?: string | null };
    expect(turnAny.id ?? (turn as any).turnId).toBe("msg-123");
    expect(turnAny.agent).toBe("alpha");
    expect(turnAny.channelId).toBe("channel-1");
  });

  it("Turn.startSpan returns a Span object", () => {
    const turn = collector.startTurn("msg-1", "alpha", null);
    const span = turn.startSpan("receive");
    expect(span).toBeDefined();
    expect(typeof (span as unknown as { end: () => void }).end).toBe("function");
  });

  it("span.end() records a duration_ms > 0", async () => {
    const turn = collector.startTurn("msg-1", "alpha", null);
    const span = turn.startSpan("receive");
    await new Promise((r) => setTimeout(r, 2));
    span.end();
    turn.end("success");

    expect(writeTurn).toHaveBeenCalledTimes(1);
    const written = writeTurn.mock.calls[0]![0] as TurnRecord;
    const receiveSpan = written.spans.find((s) => s.name === "receive");
    expect(receiveSpan).toBeDefined();
    expect(receiveSpan!.durationMs).toBeGreaterThan(0);
  });

  it("turn.end() commits all spans in a single writeTurn call", () => {
    const turn = collector.startTurn("msg-1", "alpha", null);
    const s1 = turn.startSpan("receive");
    s1.end();
    const s2 = turn.startSpan("context_assemble");
    s2.end();
    const s3 = turn.startSpan("first_token");
    s3.end();
    turn.end("success");

    expect(writeTurn).toHaveBeenCalledTimes(1);
    const written = writeTurn.mock.calls[0]![0] as TurnRecord;
    expect(written.spans.length).toBe(3);
    const names = written.spans.map((s) => s.name).sort();
    expect(names).toEqual(["context_assemble", "first_token", "receive"]);
  });

  it("turn.end() freezes the committed TurnRecord", () => {
    const turn = collector.startTurn("msg-1", "alpha", null);
    const s1 = turn.startSpan("receive");
    s1.end();
    turn.end("success");

    const written = writeTurn.mock.calls[0]![0] as TurnRecord;
    expect(Object.isFrozen(written)).toBe(true);
    expect(Object.isFrozen(written.spans)).toBe(true);
  });

  it("turn.end('error') records status='error'", () => {
    const turn = collector.startTurn("msg-1", "alpha", null);
    const s1 = turn.startSpan("receive");
    s1.end();
    turn.end("error");

    const written = writeTurn.mock.calls[0]![0] as TurnRecord;
    expect(written.status).toBe("error");
  });

  it("metadata JSON is passed through per span", () => {
    const turn = collector.startTurn("msg-1", "alpha", null);
    const span = turn.startSpan("tool_call.memory_lookup", { tool: "memory_lookup", len: 42 });
    span.end();
    turn.end("success");

    const written = writeTurn.mock.calls[0]![0] as TurnRecord;
    const toolSpan = written.spans.find((s) => s.name === "tool_call.memory_lookup");
    expect(toolSpan).toBeDefined();
    expect(toolSpan!.metadata).toMatchObject({ tool: "memory_lookup", len: 42 });
  });
});
