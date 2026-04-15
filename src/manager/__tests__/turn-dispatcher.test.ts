import { describe, it, expect, vi, beforeEach } from "vitest";
import pino from "pino";
import { TurnDispatcher, TurnDispatcherError } from "../turn-dispatcher.js";
import { makeRootOrigin } from "../turn-origin.js";

type MockTurn = {
  id: string;
  agent: string;
  channelId: string | null;
  end: ReturnType<typeof vi.fn>;
  startSpan: ReturnType<typeof vi.fn>;
};

function makeMockTurn(id: string, agent: string, channelId: string | null): MockTurn {
  return {
    id,
    agent,
    channelId,
    end: vi.fn(),
    startSpan: vi.fn(() => ({ end: vi.fn(), setMetadata: vi.fn() })),
  };
}

function makeMockSessionManager(overrides: Partial<{
  sendToAgent: (name: string, msg: string, turn?: unknown) => Promise<string>;
  streamFromAgent: (name: string, msg: string, onChunk: (a: string) => void, turn?: unknown) => Promise<string>;
  getTraceCollector: (name: string) => { startTurn: (id: string, agent: string, ch: string | null) => MockTurn } | undefined;
}> = {}) {
  const turns: MockTurn[] = [];
  const defaultCollector = {
    startTurn: vi.fn((id: string, agent: string, ch: string | null) => {
      const t = makeMockTurn(id, agent, ch);
      turns.push(t);
      return t;
    }),
  };
  const sm = {
    sendToAgent: overrides.sendToAgent ?? vi.fn(async () => "mock-response"),
    streamFromAgent: overrides.streamFromAgent ?? vi.fn(async () => "mock-stream"),
    getTraceCollector: overrides.getTraceCollector ?? vi.fn(() => defaultCollector),
  };
  return { sm, turns, defaultCollector };
}

const silentLog = pino({ level: "silent" });

describe("TurnDispatcher.dispatch", () => {
  let dispatcher: TurnDispatcher;
  let mock: ReturnType<typeof makeMockSessionManager>;

  beforeEach(() => {
    mock = makeMockSessionManager();
    dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
    });
  });

  it("calls sendToAgent once with a Turn whose id === rootTurnId", async () => {
    const origin = makeRootOrigin("discord", "msg_1");
    await dispatcher.dispatch(origin, "alice", "hello");
    expect(mock.sm.sendToAgent).toHaveBeenCalledTimes(1);
    const [name, message, turn] = (mock.sm.sendToAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(name).toBe("alice");
    expect(message).toBe("hello");
    expect(turn).toBeDefined();
    expect((turn as MockTurn).id).toBe(origin.rootTurnId);
    expect((turn as MockTurn).agent).toBe("alice");
  });

  it("passes origin-prefixed rootTurnId to collector.startTurn", async () => {
    const origin = makeRootOrigin("discord", "msg_1");
    await dispatcher.dispatch(origin, "alice", "hi", { channelId: "chan_42" });
    expect(mock.defaultCollector.startTurn).toHaveBeenCalledWith(
      origin.rootTurnId,
      "alice",
      "chan_42",
    );
  });

  it("defaults channelId to null when not provided", async () => {
    const origin = makeRootOrigin("scheduler", "daily-report");
    await dispatcher.dispatch(origin, "alice", "hi");
    expect(mock.defaultCollector.startTurn).toHaveBeenCalledWith(
      origin.rootTurnId,
      "alice",
      null,
    );
  });

  it("ends the Turn with 'success' when sendToAgent resolves", async () => {
    const origin = makeRootOrigin("discord", "msg_1");
    await dispatcher.dispatch(origin, "alice", "hi");
    expect(mock.turns).toHaveLength(1);
    expect(mock.turns[0].end).toHaveBeenCalledWith("success");
    expect(mock.turns[0].end).toHaveBeenCalledTimes(1);
  });

  it("ends the Turn with 'error' and re-throws when sendToAgent rejects", async () => {
    const err = new Error("upstream boom");
    mock.sm.sendToAgent = vi.fn(async () => { throw err; });
    dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const origin = makeRootOrigin("discord", "msg_1");
    await expect(dispatcher.dispatch(origin, "alice", "hi")).rejects.toBe(err);
    expect(mock.turns).toHaveLength(1);
    expect(mock.turns[0].end).toHaveBeenCalledWith("error");
    expect(mock.turns[0].end).toHaveBeenCalledTimes(1);
  });

  it("returns the response string from sendToAgent (passthrough)", async () => {
    mock.sm.sendToAgent = vi.fn(async () => "the-actual-reply");
    dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const origin = makeRootOrigin("discord", "msg_1");
    const result = await dispatcher.dispatch(origin, "alice", "hi");
    expect(result).toBe("the-actual-reply");
  });

  it("succeeds without throwing when getTraceCollector returns undefined", async () => {
    mock.sm.getTraceCollector = vi.fn(() => undefined);
    dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const origin = makeRootOrigin("discord", "msg_1");
    const result = await dispatcher.dispatch(origin, "alice", "hi");
    expect(result).toBe("mock-response");
    const [, , turn] = (mock.sm.sendToAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(turn).toBeUndefined();
  });

  it("throws TurnDispatcherError on empty agentName", async () => {
    const origin = makeRootOrigin("discord", "msg_1");
    await expect(dispatcher.dispatch(origin, "", "hi")).rejects.toBeInstanceOf(TurnDispatcherError);
    expect(mock.sm.sendToAgent).not.toHaveBeenCalled();
  });
});

describe("TurnDispatcher.dispatchStream", () => {
  it("calls streamFromAgent once with a Turn whose id === rootTurnId and returns the stream result", async () => {
    const mock = makeMockSessionManager({
      streamFromAgent: vi.fn(async (_n, _m, onChunk) => { onChunk("partial"); return "final"; }),
    });
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
    });
    const origin = makeRootOrigin("discord", "msg_1");
    const chunks: string[] = [];
    const result = await dispatcher.dispatchStream(origin, "alice", "hi", (c) => chunks.push(c));
    expect(result).toBe("final");
    expect(chunks).toEqual(["partial"]);
    expect(mock.sm.streamFromAgent).toHaveBeenCalledTimes(1);
    const [name, message, , turn] = (mock.sm.streamFromAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(name).toBe("alice");
    expect(message).toBe("hi");
    expect((turn as MockTurn).id).toBe(origin.rootTurnId);
  });

  it("does not mutate the TurnOrigin passed in", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const origin = makeRootOrigin("discord", "msg_1");
    const snapshot = JSON.parse(JSON.stringify(origin));
    await dispatcher.dispatch(origin, "alice", "hi");
    expect(JSON.parse(JSON.stringify(origin))).toEqual(snapshot);
    expect(Object.isFrozen(origin)).toBe(true);
  });
});

describe("TurnDispatcher — caller-owned Turn (Plan 57-03)", () => {
  it("recordOrigin is called once when caller passes options.turn", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const ownedTurn = makeMockTurn("discord:callerownedaa", "alice", null);
    const recordOrigin = vi.fn();
    (ownedTurn as unknown as { recordOrigin: typeof recordOrigin }).recordOrigin = recordOrigin;
    const origin = makeRootOrigin("discord", "msg_x");

    await dispatcher.dispatch(origin, "alice", "hi", { turn: ownedTurn as never });

    expect(recordOrigin).toHaveBeenCalledTimes(1);
    expect(recordOrigin).toHaveBeenCalledWith(origin);
    expect(mock.defaultCollector.startTurn).not.toHaveBeenCalled();
  });

  it("does not call turn.end() when caller owns the Turn", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const ownedTurn = makeMockTurn("discord:callerownedaa", "alice", null);
    (ownedTurn as unknown as { recordOrigin: (o: unknown) => void }).recordOrigin = vi.fn();
    const origin = makeRootOrigin("discord", "msg_x");

    await dispatcher.dispatch(origin, "alice", "hi", { turn: ownedTurn as never });

    expect(ownedTurn.end).not.toHaveBeenCalled();
  });

  it("preserves default lifecycle (opens Turn via collector) when no caller Turn passed", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const origin = makeRootOrigin("discord", "msg_x");

    await dispatcher.dispatch(origin, "alice", "hi");

    expect(mock.defaultCollector.startTurn).toHaveBeenCalledTimes(1);
    expect(mock.turns).toHaveLength(1);
    expect(mock.turns[0].end).toHaveBeenCalledWith("success");
  });

  it("re-throws without ending caller-owned Turn on session error", async () => {
    const err = new Error("upstream boom");
    const mock = makeMockSessionManager({ sendToAgent: vi.fn(async () => { throw err; }) });
    const dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const ownedTurn = makeMockTurn("discord:callerownedaa", "alice", null);
    (ownedTurn as unknown as { recordOrigin: (o: unknown) => void }).recordOrigin = vi.fn();
    const origin = makeRootOrigin("discord", "msg_x");

    await expect(
      dispatcher.dispatch(origin, "alice", "hi", { turn: ownedTurn as never }),
    ).rejects.toBe(err);
    expect(ownedTurn.end).not.toHaveBeenCalled();
  });

  it("dispatchStream with caller-owned Turn: recordOrigin called, no end() from dispatcher", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const ownedTurn = makeMockTurn("discord:callerownedaa", "alice", "chan_1");
    const recordOrigin = vi.fn();
    (ownedTurn as unknown as { recordOrigin: typeof recordOrigin }).recordOrigin = recordOrigin;
    const origin = makeRootOrigin("discord", "msg_x");

    await dispatcher.dispatchStream(origin, "alice", "hi", () => {}, { turn: ownedTurn as never });

    expect(recordOrigin).toHaveBeenCalledWith(origin);
    expect(ownedTurn.end).not.toHaveBeenCalled();
    expect(mock.sm.streamFromAgent).toHaveBeenCalledWith("alice", "hi", expect.any(Function), ownedTurn);
  });
});
