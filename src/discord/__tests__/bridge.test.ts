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
} = {}): Message {
  const attMap = new Map<string, Attachment>();
  const collection = {
    size: 0,
    values: () => attMap.values(),
    [Symbol.iterator]: () => attMap.values(),
    map: <T>(fn: (att: Attachment) => T): T[] => [],
  } as unknown as Collection<string, Attachment>;

  return {
    content: overrides.content ?? "hello",
    channelId: overrides.channelId ?? "chan-1",
    id: overrides.messageId ?? "msg-1",
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
      sendTyping: vi.fn(),
      send: vi.fn().mockResolvedValue({ edit: vi.fn() }),
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
