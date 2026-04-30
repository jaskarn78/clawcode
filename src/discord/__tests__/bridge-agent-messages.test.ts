import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Message, Collection, Attachment, Embed } from "discord.js";

/**
 * Tests for bridge agent-to-agent message detection and routing.
 *
 * Validates that the bridge's bot-filter allows through webhook messages
 * from known agents (identified by embed footer pattern) while still
 * blocking non-agent bot messages.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal discord.js Message-like object for agent message tests. */
function makeMessage(overrides: {
  content?: string;
  channelId?: string;
  messageId?: string;
  username?: string;
  bot?: boolean;
  webhookId?: string | null;
  embeds?: Array<{ footer?: { text: string } | null; description?: string }>;
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
      username: overrides.username ?? "agent-a",
      bot: overrides.bot ?? false,
      id: "user-1",
    },
    createdAt: new Date("2026-04-12T00:00:00Z"),
    attachments: collection,
    reference: null,
    webhookId: overrides.webhookId ?? null,
    embeds: (overrides.embeds ?? []) as Embed[],
    channel: { sendTyping: vi.fn(), send: vi.fn().mockResolvedValue({ edit: vi.fn() }) },
  } as unknown as Message;
}

// ── Mock modules ─────────────────────────────────────────────────────────────

vi.mock("../attachments.js", () => ({
  extractAttachments: vi.fn(),
  downloadAllAttachments: vi.fn(),
  formatAttachmentMetadata: vi.fn(),
  isImageAttachment: vi.fn(),
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe("bridge agent-to-agent message handling", () => {
  let DiscordBridge: typeof import("../bridge.js").DiscordBridge;

  const mockForwardToAgent = vi.fn();
  const mockStreamFromAgent = vi.fn();
  const mockGetAgentConfig = vi.fn();

  const fakeSessionManager = {
    forwardToAgent: mockForwardToAgent,
    streamFromAgent: mockStreamFromAgent,
    getAgentConfig: mockGetAgentConfig,
  };

  const fakeRoutingTable = {
    channelToAgent: new Map([["chan-1", "agent-b"]]),
    agentToChannels: new Map([["agent-b", ["chan-1"]]]),
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

  beforeEach(async () => {
    vi.clearAllMocks();
    mockStreamFromAgent.mockResolvedValue("response");
    mockGetAgentConfig.mockReturnValue({ workspace: "/workspace/agent-b" });
    const mod = await import("../bridge.js");
    DiscordBridge = mod.DiscordBridge;
  });

  function createBridge() {
    return new DiscordBridge({
      routingTableRef: { current: fakeRoutingTable },
      sessionManager: fakeSessionManager as any,
      webhookManager: fakeWebhookManager as any,
      botToken: "fake-token",
      log: fakeLog as any,
    });
  }

  describe("extractAgentSender (via handleMessage behavior)", () => {
    it("allows agent webhook messages through bot filter when embed footer matches", async () => {
      const bridge = createBridge();
      const msg = makeMessage({
        bot: true,
        webhookId: "webhook-123",
        embeds: [
          {
            footer: { text: "Agent-to-agent message from agent-a" },
            description: "Hello from agent-a",
          },
        ],
      });

      await (bridge as any).handleMessage(msg);

      expect(mockForwardToAgent).toHaveBeenCalledWith("agent-b", expect.any(String));
    });

    it("filters messages with no embeds even when webhookId is set", async () => {
      const bridge = createBridge();
      const msg = makeMessage({
        bot: true,
        webhookId: "webhook-123",
        embeds: [],
      });

      await (bridge as any).handleMessage(msg);

      expect(mockForwardToAgent).not.toHaveBeenCalled();
      expect(mockStreamFromAgent).not.toHaveBeenCalled();
    });

    it("filters messages with non-matching embed footer even when webhookId is set", async () => {
      const bridge = createBridge();
      const msg = makeMessage({
        bot: true,
        webhookId: "webhook-123",
        embeds: [
          {
            footer: { text: "Some other bot footer" },
            description: "Not an agent message",
          },
        ],
      });

      await (bridge as any).handleMessage(msg);

      expect(mockForwardToAgent).not.toHaveBeenCalled();
      expect(mockStreamFromAgent).not.toHaveBeenCalled();
    });

    it("filters messages with embed but no footer", async () => {
      const bridge = createBridge();
      const msg = makeMessage({
        bot: true,
        webhookId: "webhook-123",
        embeds: [
          {
            footer: null,
            description: "Embed without footer",
          },
        ],
      });

      await (bridge as any).handleMessage(msg);

      expect(mockForwardToAgent).not.toHaveBeenCalled();
      expect(mockStreamFromAgent).not.toHaveBeenCalled();
    });

    it("filters bot messages without webhookId (regular bot, not webhook)", async () => {
      const bridge = createBridge();
      const msg = makeMessage({
        bot: true,
        webhookId: null,
        embeds: [
          {
            footer: { text: "Agent-to-agent message from agent-a" },
            description: "Fake agent message from regular bot",
          },
        ],
      });

      await (bridge as any).handleMessage(msg);

      expect(mockForwardToAgent).not.toHaveBeenCalled();
      expect(mockStreamFromAgent).not.toHaveBeenCalled();
    });
  });

  describe("agent message prefix format (A2A-04)", () => {
    it("forwards agent message with [Agent Message from X] prefix", async () => {
      const bridge = createBridge();
      const msg = makeMessage({
        bot: true,
        webhookId: "webhook-123",
        embeds: [
          {
            footer: { text: "Agent-to-agent message from agent-a" },
            description: "Please review the deployment status",
          },
        ],
      });

      await (bridge as any).handleMessage(msg);

      expect(mockForwardToAgent).toHaveBeenCalledWith(
        "agent-b",
        "[Agent Message from agent-a]\nPlease review the deployment status",
      );
    });

    it("uses embed description as content, not message.content", async () => {
      const bridge = createBridge();
      const msg = makeMessage({
        content: "raw webhook content that should be ignored",
        bot: true,
        webhookId: "webhook-123",
        embeds: [
          {
            footer: { text: "Agent-to-agent message from agent-a" },
            description: "The actual message from the embed",
          },
        ],
      });

      await (bridge as any).handleMessage(msg);

      expect(mockForwardToAgent).toHaveBeenCalledWith(
        "agent-b",
        "[Agent Message from agent-a]\nThe actual message from the embed",
      );
    });
  });

  describe("bot filter unchanged for non-agents", () => {
    it("still filters regular bot messages (no webhookId)", async () => {
      const bridge = createBridge();
      const msg = makeMessage({
        bot: true,
        webhookId: null,
        content: "I am a regular bot",
      });

      await (bridge as any).handleMessage(msg);

      expect(mockForwardToAgent).not.toHaveBeenCalled();
      expect(mockStreamFromAgent).not.toHaveBeenCalled();
    });

    it("still processes human messages normally", async () => {
      const bridge = createBridge();
      const msg = makeMessage({
        bot: false,
        content: "Human message",
      });

      await (bridge as any).handleMessage(msg);

      expect(mockStreamFromAgent).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("ignores agent webhook message in unbound channel", async () => {
      const bridge = createBridge();
      const msg = makeMessage({
        bot: true,
        webhookId: "webhook-123",
        channelId: "unbound-channel",
        embeds: [
          {
            footer: { text: "Agent-to-agent message from agent-a" },
            description: "Message to nowhere",
          },
        ],
      });

      await (bridge as any).handleMessage(msg);

      expect(mockForwardToAgent).not.toHaveBeenCalled();
    });

    it("handles forwardToAgent error gracefully", async () => {
      const bridge = createBridge();
      mockForwardToAgent.mockRejectedValueOnce(new Error("session offline"));

      const msg = makeMessage({
        bot: true,
        webhookId: "webhook-123",
        embeds: [
          {
            footer: { text: "Agent-to-agent message from agent-a" },
            description: "This will fail to forward",
          },
        ],
      });

      // Should not throw
      await (bridge as any).handleMessage(msg);

      expect(fakeLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ from: "agent-a", to: "agent-b" }),
        expect.stringContaining("failed to forward"),
      );
    });
  });
});
