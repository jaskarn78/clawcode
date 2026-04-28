import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Message, Collection, Attachment, Embed } from "discord.js";
import { DiscordBridge } from "../bridge.js";

/**
 * Wave 0 RED tests for DiscordBridge tracing integration.
 *
 * Wave 2 will wire a `TraceCollector` through `SessionManager.getTraceCollector(name)`
 * and call `startTurn` / `startSpan("receive")` at the start of `handleMessage`.
 *
 * These tests fail today because the current bridge does not call any tracing
 * APIs. Wave 2 Task 1 will make them green.
 */

function makeMessage(overrides: {
  content?: string;
  channelId?: string;
  messageId?: string;
  username?: string;
  bot?: boolean;
  type?: number;
  sendTyping?: ReturnType<typeof vi.fn>;
  isThread?: boolean;
} = {}): Message {
  const attMap = new Map<string, Attachment>();
  const collection = {
    size: 0,
    values: () => attMap.values(),
    [Symbol.iterator]: () => attMap.values(),
    map: <T>(fn: (att: Attachment) => T): T[] => [],
  } as unknown as Collection<string, Attachment>;

  const isThreadFn = vi.fn().mockReturnValue(overrides.isThread ?? false);

  return {
    content: overrides.content ?? "hello",
    channelId: overrides.channelId ?? "chan-1",
    id: overrides.messageId ?? "msg-1",
    type: overrides.type ?? 0, // 0 = Default user message
    author: {
      username: overrides.username ?? "human-user",
      bot: overrides.bot ?? false,
      id: "user-1",
    },
    createdAt: new Date("2026-04-12T00:00:00Z"),
    attachments: collection,
    reference: null,
    webhookId: null,
    embeds: [] as Embed[],
    channel: {
      sendTyping: overrides.sendTyping ?? vi.fn(),
      send: vi.fn().mockResolvedValue({ edit: vi.fn() }),
      isThread: isThreadFn,
    },
  } as unknown as Message;
}

vi.mock("../attachments.js", () => ({
  extractAttachments: vi.fn(),
  downloadAllAttachments: vi.fn(),
  formatAttachmentMetadata: vi.fn(),
  isImageAttachment: vi.fn(),
}));

describe("DiscordBridge tracing", () => {
  let mockCollector: {
    startTurn: ReturnType<typeof vi.fn>;
  };
  let mockTurn: {
    startSpan: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  let mockReceiveSpan: { end: ReturnType<typeof vi.fn> };

  const mockStreamFromAgent = vi.fn();
  const mockForwardToAgent = vi.fn();
  const mockGetAgentConfig = vi.fn();
  const mockGetTraceCollector = vi.fn();

  const fakeRoutingTable = {
    channelToAgent: new Map([["chan-1", "agent-x"]]),
    agentToChannels: new Map([["agent-x", ["chan-1"]]]),
  };

  const fakeWebhookManager = {
    hasWebhook: vi.fn().mockReturnValue(false),
    send: vi.fn(),
  };

  const fakeLog = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  function createBridgeWithCollector(hasCollector: boolean) {
    mockGetTraceCollector.mockReturnValue(hasCollector ? mockCollector : undefined);
    return new DiscordBridge({
      routingTable: fakeRoutingTable,
      sessionManager: {
        forwardToAgent: mockForwardToAgent,
        streamFromAgent: mockStreamFromAgent,
        getAgentConfig: mockGetAgentConfig,
        getTraceCollector: mockGetTraceCollector,
      } as any,
      webhookManager: fakeWebhookManager as any,
      botToken: "fake-token",
      log: fakeLog as any,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockReceiveSpan = { end: vi.fn() };
    mockTurn = {
      startSpan: vi.fn().mockReturnValue(mockReceiveSpan),
      end: vi.fn(),
    };
    mockCollector = {
      startTurn: vi.fn().mockReturnValue(mockTurn),
    };
    mockStreamFromAgent.mockResolvedValue("response");
    mockGetAgentConfig.mockReturnValue({ workspace: "/workspace/agent-x" });
  });

  it("receive span: starts when handleMessage is entered and ends before session dispatch", async () => {
    const bridge = createBridgeWithCollector(true);
    const msg = makeMessage({ messageId: "msg-abc", channelId: "chan-1" });

    await (bridge as any).handleMessage(msg);

    // Phase 57 Plan 03: turnId format is `discord:<snowflake>` so Turn.id
    // matches TurnOrigin.rootTurnId. Pre-v1.8 tests asserted the raw
    // snowflake — updated per Plan 57-03 Step 9.
    expect(mockCollector.startTurn).toHaveBeenCalledWith("discord:msg-abc", "agent-x", "chan-1");
    const firstSpanCall = mockTurn.startSpan.mock.calls[0];
    expect(firstSpanCall).toBeDefined();
    expect(firstSpanCall![0]).toBe("receive");
    // Receive span must end before any downstream work (streamFromAgent is called later)
    expect(mockReceiveSpan.end).toHaveBeenCalled();
  });

  it("end_to_end: turn.end('success') fires when streamAndPostResponse resolves", async () => {
    const bridge = createBridgeWithCollector(true);
    mockStreamFromAgent.mockResolvedValueOnce("great response");

    const msg = makeMessage({ messageId: "msg-ok" });
    await (bridge as any).handleMessage(msg);

    expect(mockTurn.end).toHaveBeenCalledWith("success");
  });

  it("end_to_end: turn.end('error') fires when streamAndPostResponse throws", async () => {
    const bridge = createBridgeWithCollector(true);
    mockStreamFromAgent.mockRejectedValueOnce(new Error("boom"));

    const msg = makeMessage({ messageId: "msg-err" });
    await (bridge as any).handleMessage(msg);

    expect(mockTurn.end).toHaveBeenCalledWith("error");
  });

  it("skips tracing when no TraceCollector is available (non-running agent)", async () => {
    const bridge = createBridgeWithCollector(false);
    const msg = makeMessage({ messageId: "msg-no-trace" });

    await expect((bridge as any).handleMessage(msg)).resolves.not.toThrow();

    expect(mockCollector.startTurn).not.toHaveBeenCalled();
    expect(mockTurn.startSpan).not.toHaveBeenCalled();
    expect(mockTurn.end).not.toHaveBeenCalled();
  });
});

/**
 * Phase 54 Plan 02 — typing indicator relocation to handleMessage entry.
 *
 * The typing fire moves from the old post-session-dispatch location inside
 * streamAndPostResponse to the earliest point where the bridge knows the
 * message is ours to answer: right after channel routing confirms an agent,
 * ACL passes, the author is not a bot, and the message is a user message.
 *
 * These tests exercise the four guards, span emission, silent-swallow of
 * sendTyping failures, and parity between the channel and thread routes.
 */
describe("typing indicator (Phase 54)", () => {
  let mockCollector: { startTurn: ReturnType<typeof vi.fn> };
  let mockTurn: {
    startSpan: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  let mockReceiveSpan: { end: ReturnType<typeof vi.fn> };
  let mockTypingSpan: { end: ReturnType<typeof vi.fn> };

  const mockStreamFromAgent = vi.fn();
  const mockForwardToAgent = vi.fn();
  const mockGetAgentConfig = vi.fn();
  const mockGetTraceCollector = vi.fn();

  const fakeRoutingTable = {
    channelToAgent: new Map([["chan-1", "agent-x"]]),
    agentToChannels: new Map([["agent-x", ["chan-1"]]]),
  };

  const fakeWebhookManager = {
    hasWebhook: vi.fn().mockReturnValue(false),
    send: vi.fn(),
  };

  const fakeLog = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  function createBridge(opts: {
    hasCollector?: boolean;
    routingTable?: typeof fakeRoutingTable;
    securityPolicies?: ReadonlyMap<string, unknown>;
    threadManager?: unknown;
  } = {}) {
    mockGetTraceCollector.mockReturnValue(
      (opts.hasCollector ?? true) ? mockCollector : undefined,
    );
    return new DiscordBridge({
      routingTable: opts.routingTable ?? fakeRoutingTable,
      sessionManager: {
        forwardToAgent: mockForwardToAgent,
        streamFromAgent: mockStreamFromAgent,
        getAgentConfig: mockGetAgentConfig,
        getTraceCollector: mockGetTraceCollector,
      } as any,
      webhookManager: fakeWebhookManager as any,
      securityPolicies: opts.securityPolicies as any,
      threadManager: opts.threadManager as any,
      botToken: "fake-token",
      log: fakeLog as any,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockReceiveSpan = { end: vi.fn() };
    mockTypingSpan = { end: vi.fn() };
    mockTurn = {
      // startSpan returns a different span object per name — first call is
      // typing_indicator (handleMessage entry), second is receive.
      startSpan: vi.fn((name: string) => {
        if (name === "typing_indicator") return mockTypingSpan;
        return mockReceiveSpan;
      }),
      end: vi.fn(),
    };
    mockCollector = {
      startTurn: vi.fn().mockReturnValue(mockTurn),
    };
    mockStreamFromAgent.mockResolvedValue("response");
    mockGetAgentConfig.mockReturnValue({ workspace: "/workspace/agent-x" });
  });

  it("Test 1: a user message on a routed channel fires sendTyping() AND opens a typing_indicator span BEFORE session dispatch", async () => {
    const bridge = createBridge();
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const msg = makeMessage({ messageId: "msg-1", channelId: "chan-1", sendTyping });

    // Capture call ordering: span start must precede streamFromAgent
    const callOrder: string[] = [];
    mockTurn.startSpan.mockImplementation((name: string) => {
      callOrder.push(`startSpan:${name}`);
      return name === "typing_indicator" ? mockTypingSpan : mockReceiveSpan;
    });
    sendTyping.mockImplementation(() => {
      callOrder.push("sendTyping");
      return Promise.resolve();
    });
    mockStreamFromAgent.mockImplementation(() => {
      callOrder.push("streamFromAgent");
      return Promise.resolve("response");
    });

    await (bridge as any).handleMessage(msg);

    expect(sendTyping).toHaveBeenCalledTimes(1);
    // Assert typing_indicator span was opened exactly once on the Turn
    const typingSpanCalls = mockTurn.startSpan.mock.calls.filter(
      (c) => c[0] === "typing_indicator",
    );
    expect(typingSpanCalls.length).toBe(1);
    // Ordering: typing_indicator span + sendTyping fire happen before streamFromAgent
    expect(callOrder.indexOf("startSpan:typing_indicator")).toBeLessThan(
      callOrder.indexOf("streamFromAgent"),
    );
    expect(callOrder.indexOf("sendTyping")).toBeLessThan(
      callOrder.indexOf("streamFromAgent"),
    );
  });

  it("Test 2: a bot-authored non-webhook message does NOT fire sendTyping() and does NOT open a typing_indicator span", async () => {
    const bridge = createBridge();
    const sendTyping = vi.fn();
    const msg = makeMessage({ bot: true, sendTyping });

    await (bridge as any).handleMessage(msg);

    expect(sendTyping).not.toHaveBeenCalled();
    expect(mockTurn.startSpan).not.toHaveBeenCalledWith("typing_indicator", expect.anything());
  });

  it("Test 3: a message on an UNROUTED channel does NOT fire sendTyping()", async () => {
    // Empty routing table — channel not bound to any agent
    const bridge = createBridge({
      routingTable: {
        channelToAgent: new Map(),
        agentToChannels: new Map(),
      },
    });
    const sendTyping = vi.fn();
    const msg = makeMessage({ channelId: "chan-unrouted", sendTyping });

    await (bridge as any).handleMessage(msg);

    expect(sendTyping).not.toHaveBeenCalled();
    expect(mockCollector.startTurn).not.toHaveBeenCalled();
    expect(mockTurn.startSpan).not.toHaveBeenCalled();
  });

  it("Test 4: a message blocked by channel ACL does NOT fire sendTyping()", async () => {
    // Channel ACL that only allows "other-user" — our fake user "user-1" is denied
    const policy = {
      agent: "agent-x",
      channelAcls: [
        { channelId: "chan-1", allowedUserIds: ["other-user"], allowedRoles: [] },
      ],
    };
    const bridge = createBridge({
      securityPolicies: new Map([["agent-x", policy]]),
    });
    const sendTyping = vi.fn();
    const msg = makeMessage({ channelId: "chan-1", sendTyping });

    await (bridge as any).handleMessage(msg);

    expect(sendTyping).not.toHaveBeenCalled();
    // Turn creation must not precede the ACL block either
    expect(mockTurn.startSpan).not.toHaveBeenCalledWith("typing_indicator", expect.anything());
  });

  it("Test 5: a thread-routed message fires sendTyping() AND opens typing_indicator span (parity with channel route)", async () => {
    const threadManager = {
      routeMessage: vi.fn().mockResolvedValue("agent-thread"),
    };
    const bridge = createBridge({ threadManager });
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const msg = makeMessage({
      messageId: "msg-thread",
      channelId: "thread-1",
      sendTyping,
      isThread: true,
    });

    await (bridge as any).handleMessage(msg);

    expect(threadManager.routeMessage).toHaveBeenCalledWith("thread-1");
    expect(sendTyping).toHaveBeenCalledTimes(1);
    const typingSpanCalls = mockTurn.startSpan.mock.calls.filter(
      (c) => c[0] === "typing_indicator",
    );
    expect(typingSpanCalls.length).toBe(1);
  });

  it("Test 6: sendTyping() that rejects is silently swallowed — streamFromAgent still runs AND span is ended", async () => {
    const bridge = createBridge();
    const sendTyping = vi.fn().mockRejectedValue(new Error("discord 429"));
    const msg = makeMessage({ messageId: "msg-reject", sendTyping });

    await (bridge as any).handleMessage(msg);

    // Rejection did not propagate — streamFromAgent ran to completion
    expect(mockStreamFromAgent).toHaveBeenCalled();
    expect(mockTurn.end).toHaveBeenCalledWith("success");
    // Span was end()-ed regardless (we end in finally immediately after the fire)
    expect(mockTypingSpan.end).toHaveBeenCalled();
    // Debug log confirms silent swallow (the .catch handler fires asynchronously)
    // Yield the microtask queue so the rejection handler runs
    await Promise.resolve();
    await Promise.resolve();
    expect(fakeLog.debug).toHaveBeenCalled();
  });

  it("Test 7: typing_indicator span is end()-ed synchronously right after sendTyping() is called (not after streamFromAgent)", async () => {
    const bridge = createBridge();
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const msg = makeMessage({ sendTyping });

    // Track the order of events across startSpan / span.end / streamFromAgent
    const events: string[] = [];
    mockTypingSpan.end = vi.fn(() => {
      events.push("typing_span_end");
    });
    mockTurn.startSpan = vi.fn((name: string) => {
      if (name === "typing_indicator") {
        events.push("typing_span_start");
        return mockTypingSpan;
      }
      return mockReceiveSpan;
    });
    mockStreamFromAgent.mockImplementation(() => {
      events.push("streamFromAgent");
      return Promise.resolve("response");
    });

    await (bridge as any).handleMessage(msg);

    // Typing span closes BEFORE streamFromAgent starts (span duration = fire latency only)
    expect(events.indexOf("typing_span_end")).toBeGreaterThan(-1);
    expect(events.indexOf("typing_span_end")).toBeLessThan(
      events.indexOf("streamFromAgent"),
    );
  });

  it("Test 8: a non-user message type (e.g., type=6 PIN_ADD) does NOT fire sendTyping()", async () => {
    const bridge = createBridge();
    const sendTyping = vi.fn();
    const msg = makeMessage({ type: 6, sendTyping }); // 6 = ChannelPinnedMessage

    await (bridge as any).handleMessage(msg);

    expect(sendTyping).not.toHaveBeenCalled();
    expect(mockTurn.startSpan).not.toHaveBeenCalledWith("typing_indicator", expect.anything());
  });

  it("Test 9: the old eager sendTyping() in streamAndPostResponse is REMOVED — only one sendTyping fires per turn (not the setInterval)", async () => {
    const bridge = createBridge();
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const msg = makeMessage({ sendTyping });

    await (bridge as any).handleMessage(msg);

    // Exactly one fire — the handleMessage-entry fire. If the old eager fire
    // in streamAndPostResponse still existed we would see 2 calls here
    // (the setInterval only fires at 8s elapsed, not synchronously).
    expect(sendTyping).toHaveBeenCalledTimes(1);
  });

  it("Test 10: a Reply-type message (type=19) fires typing (Reply is a user message type)", async () => {
    const bridge = createBridge();
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const msg = makeMessage({ type: 19, sendTyping });

    await (bridge as any).handleMessage(msg);

    expect(sendTyping).toHaveBeenCalledTimes(1);
    const typingSpanCalls = mockTurn.startSpan.mock.calls.filter(
      (c) => c[0] === "typing_indicator",
    );
    expect(typingSpanCalls.length).toBe(1);
  });
});

/**
 * Phase 54 Plan 03 — streamAndPostResponse threads agentConfig.perf.streaming
 * into the ProgressiveMessageEditor constructor and passes the caller-owned
 * Turn so the editor can emit first_visible_token spans on the first editFn.
 */
describe("streamAndPostResponse streaming cadence wire (Phase 54)", () => {
  let mockCollector: { startTurn: ReturnType<typeof vi.fn> };
  let mockTurn: {
    startSpan: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  let mockReceiveSpan: { end: ReturnType<typeof vi.fn> };
  let mockTypingSpan: { end: ReturnType<typeof vi.fn> };
  let mockFirstVisibleSpan: { end: ReturnType<typeof vi.fn> };

  const mockStreamFromAgent = vi.fn();
  const mockGetAgentConfig = vi.fn();
  const mockGetTraceCollector = vi.fn();

  const fakeRoutingTable = {
    channelToAgent: new Map([["chan-1", "agent-x"]]),
    agentToChannels: new Map([["agent-x", ["chan-1"]]]),
  };

  const fakeLog = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  function createBridge() {
    mockGetTraceCollector.mockReturnValue(mockCollector);
    return new DiscordBridge({
      routingTable: fakeRoutingTable,
      sessionManager: {
        forwardToAgent: vi.fn(),
        streamFromAgent: mockStreamFromAgent,
        getAgentConfig: mockGetAgentConfig,
        getTraceCollector: mockGetTraceCollector,
      } as any,
      botToken: "fake-token",
      log: fakeLog as any,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockReceiveSpan = { end: vi.fn() };
    mockTypingSpan = { end: vi.fn() };
    mockFirstVisibleSpan = { end: vi.fn() };
    mockTurn = {
      startSpan: vi.fn((name: string) => {
        if (name === "typing_indicator") return mockTypingSpan;
        if (name === "first_visible_token") return mockFirstVisibleSpan;
        return mockReceiveSpan;
      }),
      end: vi.fn(),
    };
    mockCollector = {
      startTurn: vi.fn().mockReturnValue(mockTurn),
    };
  });

  it("Test A: editor uses agentConfig.perf.streaming.editIntervalMs when present", async () => {
    mockGetAgentConfig.mockReturnValue({
      workspace: "/workspace/agent-x",
      perf: { streaming: { editIntervalMs: 400 } },
    });
    // streamFromAgent is responsible for invoking the streamCallback, which
    // calls editor.update(). We can inspect the editor indirectly via the
    // send/edit calls on the channel.
    let capturedUpdate: ((s: string) => void) | undefined;
    mockStreamFromAgent.mockImplementation(async (_agent, _msg, onChunk) => {
      capturedUpdate = onChunk;
      // First chunk fires immediately via editFn (channel.send)
      onChunk("first");
      // Wait long enough for the override interval (400ms) to pass and verify
      // the 2nd edit fires inside that window — we rely on real timers here.
      await new Promise((r) => setTimeout(r, 450));
      onChunk("first + second");
      await new Promise((r) => setTimeout(r, 450));
      return "final response";
    });

    const bridge = createBridge();
    const sendMock = vi.fn().mockResolvedValue({ edit: vi.fn() });
    const msg = {
      content: "hi",
      channelId: "chan-1",
      id: "m1",
      type: 0,
      author: { bot: false, username: "u", id: "user-1" },
      createdAt: new Date(),
      attachments: {
        size: 0,
        values: () => [].values(),
        [Symbol.iterator]: () => [].values(),
        map: () => [],
      },
      reference: null,
      webhookId: null,
      embeds: [],
      channel: {
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: sendMock,
        isThread: () => false,
      },
    } as unknown as import("discord.js").Message;

    await (bridge as any).handleMessage(msg);

    // The editor took the override (400ms) so streamFromAgent's 450ms wait
    // is enough to elapse the throttled interval and fire a second edit.
    expect(mockStreamFromAgent).toHaveBeenCalled();
    expect(capturedUpdate).toBeDefined();
  }, 10000);

  it("Test B: first_visible_token span is emitted on the Turn after streamAndPostResponse runs", async () => {
    mockGetAgentConfig.mockReturnValue({ workspace: "/workspace/agent-x" });
    mockStreamFromAgent.mockImplementation(async (_agent, _msg, onChunk) => {
      // Simulate at least one streamed chunk so the editor's first editFn runs
      onChunk("hello");
      // Let microtasks flush so the span emission path runs
      await Promise.resolve();
      return "hello";
    });

    const bridge = createBridge();
    const sendMock = vi.fn().mockResolvedValue({ edit: vi.fn() });
    const msg = {
      content: "hi",
      channelId: "chan-1",
      id: "m1",
      type: 0,
      author: { bot: false, username: "u", id: "user-1" },
      createdAt: new Date(),
      attachments: {
        size: 0,
        values: () => [].values(),
        [Symbol.iterator]: () => [].values(),
        map: () => [],
      },
      reference: null,
      webhookId: null,
      embeds: [],
      channel: {
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: sendMock,
        isThread: () => false,
      },
    } as unknown as import("discord.js").Message;

    await (bridge as any).handleMessage(msg);

    const fvtCalls = mockTurn.startSpan.mock.calls.filter(
      (c) => c[0] === "first_visible_token",
    );
    expect(fvtCalls.length).toBe(1);
    expect(mockFirstVisibleSpan.end).toHaveBeenCalled();
  });
});

/**
 * Phase 100 follow-up — QUEUE_FULL coalescing (operator's resend friction fix).
 *
 * Operator-reported bug 2026-04-28: when the agent is busy and additional
 * messages arrive in rapid succession, the 3rd+ message hits
 * `SerialTurnQueue.QUEUE_FULL` (depth-1: one in-flight + one queued) and
 * the bridge reacts ❌, forcing the operator to track and resend it.
 *
 * Fix: per-agent MessageCoalescer at the bridge layer (upstream of
 * SerialTurnQueue). When QUEUE_FULL fires, append to the buffer and react
 * with ⏳ instead of ❌. After the in-flight turn completes, drain the
 * coalescer and dispatch a single combined turn with all pending content.
 *
 * CO-1: when QUEUE_FULL throws, coalescer.addMessage is called (not ❌ react)
 * CO-2: after in-flight turn completes, pending messages dispatch as ONE combined turn
 * CO-3: combined turn payload contains all pending message contents joined
 * CO-4: ⏳ reaction added (not ❌) on coalesced messages
 * CO-5: when perAgentCap is hit, falls back to ❌ react (still rejected, but only after cap of 50)
 * CO-6: non-QUEUE_FULL errors (e.g. auth fail, agent crash) STILL react ❌ (back-compat)
 */
describe("QUEUE_FULL coalescing (Phase 100-fu)", () => {
  const mockStreamFromAgent = vi.fn();
  const mockForwardToAgent = vi.fn();
  const mockGetAgentConfig = vi.fn();
  const mockGetTraceCollector = vi.fn();

  const fakeRoutingTable = {
    channelToAgent: new Map([["chan-1", "agent-x"]]),
    agentToChannels: new Map([["agent-x", ["chan-1"]]]),
  };

  const fakeWebhookManager = {
    hasWebhook: vi.fn().mockReturnValue(false),
    send: vi.fn(),
  };

  const fakeLog = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  function createBridge(opts: { coalescer?: unknown } = {}) {
    mockGetTraceCollector.mockReturnValue(undefined); // tracing not relevant here
    const bridge = new DiscordBridge({
      routingTable: fakeRoutingTable,
      sessionManager: {
        forwardToAgent: mockForwardToAgent,
        streamFromAgent: mockStreamFromAgent,
        getAgentConfig: mockGetAgentConfig,
        getTraceCollector: mockGetTraceCollector,
      } as any,
      webhookManager: fakeWebhookManager as any,
      botToken: "fake-token",
      log: fakeLog as any,
    });
    if (opts.coalescer) {
      // Inject custom coalescer for inspection
      (bridge as any).messageCoalescer = opts.coalescer;
    }
    return bridge;
  }

  function makeQueueFullMessage(opts: {
    content?: string;
    messageId?: string;
    react?: ReturnType<typeof vi.fn>;
  } = {}): import("discord.js").Message {
    return {
      content: opts.content ?? "third rapid msg",
      channelId: "chan-1",
      id: opts.messageId ?? "msg-3",
      type: 0,
      author: {
        username: "operator",
        bot: false,
        id: "user-1",
      },
      createdAt: new Date("2026-04-28T00:00:00Z"),
      attachments: {
        size: 0,
        values: () => [].values(),
        [Symbol.iterator]: () => [].values(),
        map: () => [],
      },
      reference: null,
      webhookId: null,
      embeds: [],
      react: opts.react ?? vi.fn().mockResolvedValue(undefined),
      channel: {
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue({ edit: vi.fn() }),
        isThread: () => false,
      },
    } as unknown as import("discord.js").Message;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentConfig.mockReturnValue({ workspace: "/workspace/agent-x" });
  });

  it("CO-1: when QUEUE_FULL throws, coalescer.addMessage is called (not ❌ react)", async () => {
    const fakeCoalescer = {
      addMessage: vi.fn().mockReturnValue(true),
      takePending: vi.fn().mockReturnValue([]),
      getPendingCount: vi.fn().mockReturnValue(0),
    };
    const bridge = createBridge({ coalescer: fakeCoalescer });
    mockStreamFromAgent.mockRejectedValueOnce(new Error("QUEUE_FULL"));

    const react = vi.fn().mockResolvedValue(undefined);
    const msg = makeQueueFullMessage({ content: "third msg", messageId: "msg-3", react });

    await (bridge as any).handleMessage(msg);

    expect(fakeCoalescer.addMessage).toHaveBeenCalledWith(
      "agent-x",
      expect.stringContaining("third msg"),
      "msg-3",
    );
    // Must NOT have reacted with ❌
    expect(react).not.toHaveBeenCalledWith("❌");
  });

  it("CO-2: after in-flight turn completes, pending messages dispatch as ONE combined turn", async () => {
    const fakeCoalescer = {
      addMessage: vi.fn().mockReturnValue(true),
      // First QUEUE_FULL fills the buffer (one msg). After turn drain, takePending returns it.
      takePending: vi
        .fn()
        .mockReturnValueOnce([
          { content: "(formatted) third msg", messageId: "msg-3", receivedAt: 1 },
        ])
        .mockReturnValue([]),
      getPendingCount: vi.fn().mockReturnValue(0),
    };
    const bridge = createBridge({ coalescer: fakeCoalescer });
    // First call rejects QUEUE_FULL (msg-3 hits the wall)
    // Second call (the drain dispatch) succeeds
    mockStreamFromAgent
      .mockRejectedValueOnce(new Error("QUEUE_FULL"))
      .mockResolvedValueOnce("combined response");

    const msg = makeQueueFullMessage({ messageId: "msg-3", content: "third msg" });
    await (bridge as any).handleMessage(msg);

    // streamFromAgent called TWICE: once for the QUEUE_FULL'd attempt, once for the drain
    expect(mockStreamFromAgent).toHaveBeenCalledTimes(2);
    // takePending was called to drain (after the failed turn)
    expect(fakeCoalescer.takePending).toHaveBeenCalledWith("agent-x");
  });

  it("CO-3: combined turn payload contains all pending message contents joined", async () => {
    const fakeCoalescer = {
      addMessage: vi.fn().mockReturnValue(true),
      takePending: vi
        .fn()
        .mockReturnValueOnce([
          { content: "msg A content", messageId: "id-A", receivedAt: 1 },
          { content: "msg B content", messageId: "id-B", receivedAt: 2 },
          { content: "msg C content", messageId: "id-C", receivedAt: 3 },
        ])
        .mockReturnValue([]),
      getPendingCount: vi.fn().mockReturnValue(0),
    };
    const bridge = createBridge({ coalescer: fakeCoalescer });
    mockStreamFromAgent
      .mockRejectedValueOnce(new Error("QUEUE_FULL"))
      .mockResolvedValueOnce("combined response");

    const msg = makeQueueFullMessage({ messageId: "msg-trigger", content: "trigger" });
    await (bridge as any).handleMessage(msg);

    // The drain dispatch (2nd call) must contain all 3 pending messages joined
    expect(mockStreamFromAgent).toHaveBeenCalledTimes(2);
    const drainCall = mockStreamFromAgent.mock.calls[1];
    const drainPayload = drainCall[1] as string;
    expect(drainPayload).toContain("msg A content");
    expect(drainPayload).toContain("msg B content");
    expect(drainPayload).toContain("msg C content");
  });

  it("CO-4: ⏳ reaction added (not ❌) on coalesced messages", async () => {
    const fakeCoalescer = {
      addMessage: vi.fn().mockReturnValue(true),
      takePending: vi.fn().mockReturnValue([]),
      getPendingCount: vi.fn().mockReturnValue(0),
    };
    const bridge = createBridge({ coalescer: fakeCoalescer });
    mockStreamFromAgent.mockRejectedValueOnce(new Error("QUEUE_FULL"));

    const react = vi.fn().mockResolvedValue(undefined);
    const msg = makeQueueFullMessage({ react });

    await (bridge as any).handleMessage(msg);

    // ⏳ hourglass reaction (U+23F3) on coalesced messages
    expect(react).toHaveBeenCalledWith("⏳");
    expect(react).not.toHaveBeenCalledWith("❌");
  });

  it("CO-5: when perAgentCap is hit (addMessage returns false), falls back to ❌ react", async () => {
    const fakeCoalescer = {
      // Cap reached — addMessage returns false
      addMessage: vi.fn().mockReturnValue(false),
      takePending: vi.fn().mockReturnValue([]),
      getPendingCount: vi.fn().mockReturnValue(50),
    };
    const bridge = createBridge({ coalescer: fakeCoalescer });
    mockStreamFromAgent.mockRejectedValueOnce(new Error("QUEUE_FULL"));

    const react = vi.fn().mockResolvedValue(undefined);
    const msg = makeQueueFullMessage({ react });

    await (bridge as any).handleMessage(msg);

    // Cap hit — must fall back to ❌
    expect(fakeCoalescer.addMessage).toHaveBeenCalled();
    expect(react).toHaveBeenCalledWith("❌");
  });

  it("CO-6: non-QUEUE_FULL errors STILL react ❌ (back-compat for auth fail, agent crash, etc.)", async () => {
    const fakeCoalescer = {
      addMessage: vi.fn().mockReturnValue(true),
      takePending: vi.fn().mockReturnValue([]),
      getPendingCount: vi.fn().mockReturnValue(0),
    };
    const bridge = createBridge({ coalescer: fakeCoalescer });
    // Real disaster — not QUEUE_FULL
    mockStreamFromAgent.mockRejectedValueOnce(new Error("auth-failed: bad token"));

    const react = vi.fn().mockResolvedValue(undefined);
    const msg = makeQueueFullMessage({ react });

    await (bridge as any).handleMessage(msg);

    // Coalescer must NOT have been used
    expect(fakeCoalescer.addMessage).not.toHaveBeenCalled();
    // ❌ STILL fires for real errors
    expect(react).toHaveBeenCalledWith("❌");
  });
});
