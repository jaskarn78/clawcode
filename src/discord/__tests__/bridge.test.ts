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

    expect(mockCollector.startTurn).toHaveBeenCalledWith("msg-abc", "agent-x", "chan-1");
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
