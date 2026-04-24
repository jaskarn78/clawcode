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

describe("TurnDispatcher — AbortSignal threading (Phase 59)", () => {
  it("forwards signal to sendToAgent via dispatch", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const origin = makeRootOrigin("task", "t:1");
    const controller = new AbortController();
    await dispatcher.dispatch(origin, "alice", "do-task", { signal: controller.signal });
    expect(mock.sm.sendToAgent).toHaveBeenCalledTimes(1);
    const callArgs = (mock.sm.sendToAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    // 4th arg is options with signal
    expect(callArgs[3]).toEqual({ signal: controller.signal });
  });

  it("forwards pre-aborted signal", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const origin = makeRootOrigin("task", "t:2");
    const controller = new AbortController();
    controller.abort();
    await dispatcher.dispatch(origin, "alice", "do-task", { signal: controller.signal });
    const callArgs = (mock.sm.sendToAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[3]?.signal?.aborted).toBe(true);
  });

  it("forwards signal to streamFromAgent via dispatchStream", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const origin = makeRootOrigin("task", "t:3");
    const controller = new AbortController();
    await dispatcher.dispatchStream(origin, "alice", "stream-task", () => {}, { signal: controller.signal });
    expect(mock.sm.streamFromAgent).toHaveBeenCalledTimes(1);
    const callArgs = (mock.sm.streamFromAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    // 5th arg is options with signal
    expect(callArgs[4]).toEqual({ signal: controller.signal });
  });

  it("dispatch without signal still works (backward compat)", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({ sessionManager: mock.sm as never, log: silentLog });
    const origin = makeRootOrigin("discord", "msg_bc");
    const result = await dispatcher.dispatch(origin, "alice", "hello");
    expect(result).toBe("mock-response");
    const callArgs = (mock.sm.sendToAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    // signal should be undefined when not provided
    expect(callArgs[3]).toEqual({ signal: undefined });
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
    expect(mock.sm.streamFromAgent).toHaveBeenCalledWith("alice", "hi", expect.any(Function), ownedTurn, { signal: undefined });
  });
});

// Phase 90 MEM-03 — memoryRetriever pre-turn injection tests
describe("TurnDispatcher — memoryRetriever injection (Phase 90 MEM-03)", () => {
  it("MEM-03-TD1: retrieveMemoryChunks invoked with query; result wrapped as <memory-context>", async () => {
    const mock = makeMockSessionManager();
    const retriever = vi.fn(async () =>
      Object.freeze([
        Object.freeze({
          chunkId: "c1",
          path: "/ws/memory/zaid.md",
          heading: "Investment",
          body: "Zaid wants 40% SGOV",
          fusedScore: 0.5,
          scoreWeight: 0,
        }),
      ]),
    );
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      memoryRetriever: retriever,
    });
    const origin = makeRootOrigin("discord", "msg_m1");
    await dispatcher.dispatch(origin, "alice", "Zaid investment proportion?");

    expect(retriever).toHaveBeenCalledWith("alice", "Zaid investment proportion?");
    const sendCall = (mock.sm.sendToAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentMessage = sendCall[1] as string;
    expect(sentMessage).toMatch(/<memory-context/);
    expect(sentMessage).toContain("Zaid wants 40% SGOV");
    expect(sentMessage).toContain("Zaid investment proportion?"); // original user text preserved
  });

  it("MEM-03-TD2: retriever throws → dispatch fails-open, original message sent, warn logged", async () => {
    const mock = makeMockSessionManager();
    const retriever = vi.fn(async () => {
      throw new Error("retrieval boom");
    });
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      memoryRetriever: retriever,
    });
    const origin = makeRootOrigin("discord", "msg_m2");
    await dispatcher.dispatch(origin, "alice", "hello world");
    const sendCall = (mock.sm.sendToAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentMessage = sendCall[1] as string;
    expect(sentMessage).toBe("hello world"); // unchanged
    expect(sentMessage).not.toContain("<memory-context");
  });

  it("MEM-03-TD3: zero chunks returned → no wrapper injected", async () => {
    const mock = makeMockSessionManager();
    const retriever = vi.fn(async () => Object.freeze([]));
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      memoryRetriever: retriever,
    });
    const origin = makeRootOrigin("discord", "msg_m3");
    await dispatcher.dispatch(origin, "alice", "random text");
    const sendCall = (mock.sm.sendToAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sendCall[1]).toBe("random text");
  });

  it("MEM-03-TD4: no memoryRetriever wired → message passes through unchanged (zero side effects)", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      // memoryRetriever NOT provided
    });
    const origin = makeRootOrigin("discord", "msg_m4");
    await dispatcher.dispatch(origin, "alice", "plain message");
    const sendCall = (mock.sm.sendToAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sendCall[1]).toBe("plain message");
  });

  it("MEM-03-TD5: dispatchStream also augments with memory context", async () => {
    const mock = makeMockSessionManager();
    const retriever = vi.fn(async () =>
      Object.freeze([
        Object.freeze({
          chunkId: "c1",
          path: "/ws/memory/standing.md",
          heading: null,
          body: "body text",
          fusedScore: 0.5,
          scoreWeight: 0,
        }),
      ]),
    );
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      memoryRetriever: retriever,
    });
    const origin = makeRootOrigin("discord", "msg_m5");
    await dispatcher.dispatchStream(origin, "alice", "streamed question", () => {});
    const streamCall = (mock.sm.streamFromAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(streamCall[1]).toContain("<memory-context");
    expect(streamCall[1]).toContain("body text");
    expect(streamCall[1]).toContain("streamed question");
  });
});

// Phase 90 MEM-05 — cue detection + discord reaction post-turn hook
describe("TurnDispatcher — cue detection hook (Phase 90 MEM-05)", () => {
  it("MEM-05-TD1: cue in user message triggers memoryCueWriter + discordReact", async () => {
    const mock = makeMockSessionManager();
    const cueWriter = vi.fn(async () => "/ws/memory/2026-04-24-remember-abcd.md");
    const reactSpy = vi.fn(async () => {});
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      memoryCueWriter: cueWriter,
      discordReact: reactSpy,
      workspaceForAgent: () => "/ws",
    });
    const origin = makeRootOrigin("discord", "msg_c1");
    await dispatcher.dispatch(origin, "alice", "remember this: Zaid wants 40% SGOV.", {
      channelId: "ch1",
    });
    // Give the fire-and-forget cue write a tick to resolve
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(cueWriter).toHaveBeenCalledTimes(1);
    const args = cueWriter.mock.calls[0][0];
    expect(args.workspacePath).toBe("/ws");
    expect(args.cue.toLowerCase()).toContain("remember");
    expect(args.context).toContain("Zaid wants 40%");
    // Discord reaction invoked with the originating messageId + channelId
    expect(reactSpy).toHaveBeenCalledTimes(1);
    expect(reactSpy.mock.calls[0][0]).toEqual({
      channelId: "ch1",
      messageId: "msg_c1",
    });
    expect(reactSpy.mock.calls[0][1]).toBe("✅");
  });

  it("MEM-05-TD2: cue-writer throw → dispatch still resolves successfully (fire-and-forget)", async () => {
    const mock = makeMockSessionManager();
    const cueWriter = vi.fn(async () => {
      throw new Error("write boom");
    });
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      memoryCueWriter: cueWriter,
      workspaceForAgent: () => "/ws",
    });
    const origin = makeRootOrigin("discord", "msg_c2");
    const result = await dispatcher.dispatch(origin, "alice", "remember this: something");
    expect(result).toBe("mock-response"); // dispatch succeeded despite cue-writer throw
  });

  it("MEM-05-TD3: no cue in user message → memoryCueWriter NOT called", async () => {
    const mock = makeMockSessionManager();
    const cueWriter = vi.fn(async () => "/nope");
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      memoryCueWriter: cueWriter,
      workspaceForAgent: () => "/ws",
    });
    const origin = makeRootOrigin("discord", "msg_c3");
    await dispatcher.dispatch(origin, "alice", "What's the weather today?");
    await new Promise((r) => setImmediate(r));
    expect(cueWriter).not.toHaveBeenCalled();
  });

  it("MEM-05-TD4: no memoryCueWriter wired → dispatch proceeds unchanged", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      // memoryCueWriter NOT provided
    });
    const origin = makeRootOrigin("discord", "msg_c4");
    const result = await dispatcher.dispatch(origin, "alice", "remember this: x");
    expect(result).toBe("mock-response");
  });

  it("MEM-05-TD5: workspaceForAgent returns undefined → cue write skipped", async () => {
    const mock = makeMockSessionManager();
    const cueWriter = vi.fn(async () => "/nope");
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      memoryCueWriter: cueWriter,
      workspaceForAgent: () => undefined,
    });
    const origin = makeRootOrigin("discord", "msg_c5");
    await dispatcher.dispatch(origin, "alice", "remember this: x");
    await new Promise((r) => setImmediate(r));
    expect(cueWriter).not.toHaveBeenCalled();
  });
});

// Phase 90 MEM-06 — subagent Task-return observer
describe("TurnDispatcher — subagent capture hook (Phase 90 MEM-06)", () => {
  it("MEM-06-TD1: onTaskToolReturn DI slot is callable from external caller", async () => {
    const mock = makeMockSessionManager();
    const captureSpy = vi.fn(async () => "/ws/memory/2026-04-24-subagent-research.md");
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      subagentCapture: captureSpy,
      workspaceForAgent: () => "/ws",
    });
    // Invoke the public observer entry point
    await dispatcher.handleTaskToolReturn("alice", {
      subagent_type: "researcher",
      task_description: "Research Phase 90",
      return_summary: "Done.",
      spawned_at_iso: "2026-04-24T18:30:00.000Z",
      duration_ms: 5000,
    });
    await new Promise((r) => setImmediate(r));
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy.mock.calls[0][0].workspacePath).toBe("/ws");
    expect(captureSpy.mock.calls[0][0].subagent_type).toBe("researcher");
  });

  it("MEM-06-TD2: subagentCapture throw → handleTaskToolReturn does NOT throw (fire-and-forget)", async () => {
    const mock = makeMockSessionManager();
    const captureSpy = vi.fn(async () => {
      throw new Error("capture boom");
    });
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
      subagentCapture: captureSpy,
      workspaceForAgent: () => "/ws",
    });
    // Must not throw
    await expect(
      dispatcher.handleTaskToolReturn("alice", {
        subagent_type: "researcher",
        task_description: "x",
        return_summary: "y",
        spawned_at_iso: "2026-04-24T18:30:00.000Z",
        duration_ms: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it("MEM-06-TD3: no subagentCapture wired → handleTaskToolReturn is a no-op", async () => {
    const mock = makeMockSessionManager();
    const dispatcher = new TurnDispatcher({
      sessionManager: mock.sm as never,
      log: silentLog,
    });
    await expect(
      dispatcher.handleTaskToolReturn("alice", {
        subagent_type: "researcher",
        task_description: "x",
        return_summary: "y",
        spawned_at_iso: "2026-04-24T18:30:00.000Z",
        duration_ms: 1,
      }),
    ).resolves.toBeUndefined();
  });
});
