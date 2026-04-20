import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Message, Collection, Attachment } from "discord.js";
import type { DownloadResult, AttachmentInfo } from "../attachment-types.js";

/**
 * We test the bridge's attachment integration by importing the updated
 * formatDiscordMessage (now exported for testing) and verifying handleMessage
 * behavior via a minimal DiscordBridge construction with mocked dependencies.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAttachmentInfo(overrides: Partial<AttachmentInfo> = {}): AttachmentInfo {
  return {
    name: "photo.png",
    url: "https://cdn.discordapp.com/attachments/1/2/photo.png",
    contentType: "image/png",
    size: 12345,
    proxyUrl: "https://media.discordapp.net/attachments/1/2/photo.png",
    ...overrides,
  };
}

function makeDownloadResult(overrides: Partial<DownloadResult> = {}): DownloadResult {
  return {
    success: true,
    path: "/workspace/inbox/attachments/1234-photo.png",
    error: null,
    attachmentInfo: makeAttachmentInfo(),
    ...overrides,
  };
}

/** Build a minimal discord.js Message-like object. */
function makeMessage(overrides: {
  content?: string;
  attachments?: Array<{ id: string; name: string; contentType: string | null; size: number; url: string; proxyURL: string }>;
  channelId?: string;
  messageId?: string;
  username?: string;
} = {}): Message {
  const attMap = new Map<string, Attachment>();
  for (const a of overrides.attachments ?? []) {
    attMap.set(a.id, a as Attachment);
  }

  // Mimic discord.js Collection with .map and .values
  const collection = {
    size: attMap.size,
    values: () => attMap.values(),
    [Symbol.iterator]: () => attMap.values(),
    map: <T>(fn: (att: Attachment) => T): T[] => {
      const result: T[] = [];
      for (const v of attMap.values()) {
        result.push(fn(v));
      }
      return result;
    },
  } as unknown as Collection<string, Attachment>;

  return {
    content: overrides.content ?? "hello",
    channelId: overrides.channelId ?? "chan-1",
    id: overrides.messageId ?? "msg-1",
    author: { username: overrides.username ?? "testuser", bot: false },
    createdAt: new Date("2026-04-09T12:00:00Z"),
    attachments: collection,
    reference: null,
    channel: { sendTyping: vi.fn(), send: vi.fn().mockResolvedValue({ edit: vi.fn() }) },
  } as unknown as Message;
}

// ── Mock attachment module ──────────────────────────────────────────────────

const mockExtractAttachments = vi.fn();
const mockDownloadAllAttachments = vi.fn();
const mockFormatAttachmentMetadata = vi.fn();
const mockIsImageAttachment = vi.fn();

vi.mock("../attachments.js", () => ({
  extractAttachments: (...args: unknown[]) => mockExtractAttachments(...args),
  downloadAllAttachments: (...args: unknown[]) => mockDownloadAllAttachments(...args),
  formatAttachmentMetadata: (...args: unknown[]) => mockFormatAttachmentMetadata(...args),
  isImageAttachment: (...args: unknown[]) => mockIsImageAttachment(...args),
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe("formatDiscordMessage (with attachment support)", () => {
  // Import after mocks are registered
  let formatDiscordMessage: (message: Message, downloadResults?: readonly DownloadResult[]) => string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../bridge.js");
    formatDiscordMessage = mod.formatDiscordMessage;
  });

  it("returns same format as before when no downloadResults are provided (backward compatible)", () => {
    const msg = makeMessage({ content: "hello world" });
    const output = formatDiscordMessage(msg);

    expect(output).toContain("hello world");
    expect(output).toContain('source="discord"');
    expect(output).toContain('user="testuser"');
    expect(output).not.toContain("<attachments>");
  });

  it("includes structured attachment metadata when downloadResults are provided", () => {
    mockFormatAttachmentMetadata.mockReturnValue(
      '<attachments>\n  <attachment name="photo.png" type="image/png" size="12345" local_path="/tmp/photo.png" />\n</attachments>',
    );

    const results = [makeDownloadResult()];
    const msg = makeMessage({ content: "check this" });
    const output = formatDiscordMessage(msg, results);

    expect(mockFormatAttachmentMetadata).toHaveBeenCalledWith(results);
    expect(output).toContain("<attachments>");
    expect(output).toContain('local_path="/tmp/photo.png"');
  });

  it("includes local_path for successfully downloaded attachments", () => {
    mockFormatAttachmentMetadata.mockReturnValue(
      '<attachments>\n  <attachment name="doc.pdf" type="application/pdf" size="5000" local_path="/workspace/inbox/attachments/1234-doc.pdf" />\n</attachments>',
    );

    const results = [
      makeDownloadResult({
        path: "/workspace/inbox/attachments/1234-doc.pdf",
        attachmentInfo: makeAttachmentInfo({ name: "doc.pdf", contentType: "application/pdf" }),
      }),
    ];
    const msg = makeMessage({ content: "file" });
    const output = formatDiscordMessage(msg, results);

    expect(output).toContain("local_path");
    expect(output).toContain("1234-doc.pdf");
  });

  it("includes multimodal reading hint for successfully downloaded image attachments", () => {
    mockFormatAttachmentMetadata.mockReturnValue(
      '<attachments>\n  <attachment name="photo.png" type="image/png" size="12345" local_path="/tmp/1234-photo.png" />\n</attachments>',
    );
    mockIsImageAttachment.mockReturnValue(true);

    const results = [
      makeDownloadResult({
        path: "/tmp/1234-photo.png",
        attachmentInfo: makeAttachmentInfo({ name: "photo.png", contentType: "image/png" }),
      }),
    ];
    const msg = makeMessage({ content: "look at this" });
    const output = formatDiscordMessage(msg, results);

    expect(output).toContain("Image downloaded");
    expect(output).toContain("/tmp/1234-photo.png");
    expect(output).toContain("read the file");
  });

  it("does NOT include multimodal hint for non-image attachments", () => {
    mockFormatAttachmentMetadata.mockReturnValue(
      '<attachments>\n  <attachment name="doc.pdf" type="application/pdf" size="5000" local_path="/tmp/1234-doc.pdf" />\n</attachments>',
    );
    mockIsImageAttachment.mockReturnValue(false);

    const results = [
      makeDownloadResult({
        path: "/tmp/1234-doc.pdf",
        attachmentInfo: makeAttachmentInfo({ name: "doc.pdf", contentType: "application/pdf" }),
      }),
    ];
    const msg = makeMessage({ content: "check this" });
    const output = formatDiscordMessage(msg, results);

    expect(output).not.toContain("Image downloaded");
  });
});

describe("handleMessage attachment integration", () => {
  let DiscordBridge: typeof import("../bridge.js").DiscordBridge;

  const mockStreamFromAgent = vi.fn();
  const mockGetAgentConfig = vi.fn();

  const fakeSessionManager = {
    streamFromAgent: mockStreamFromAgent,
    getAgentConfig: mockGetAgentConfig,
  };

  const fakeRoutingTable = {
    channelToAgent: new Map([["chan-1", "test-agent"]]),
    agentToChannels: new Map([["test-agent", ["chan-1"]]]),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Phase 75 SHARED-01 — attachment download uses memoryPath (not workspace).
    // For dedicated-workspace agents memoryPath === workspace, mirroring the
    // loader.ts fallback behavior.
    mockGetAgentConfig.mockReturnValue({ workspace: "/workspace/test-agent", memoryPath: "/workspace/test-agent" });
    mockStreamFromAgent.mockResolvedValue("agent response");
    mockExtractAttachments.mockReturnValue([makeAttachmentInfo()]);
    mockDownloadAllAttachments.mockResolvedValue([makeDownloadResult()]);
    mockFormatAttachmentMetadata.mockReturnValue(
      '<attachments>\n  <attachment name="photo.png" type="image/png" size="12345" local_path="/workspace/test-agent/inbox/attachments/1234-photo.png" />\n</attachments>',
    );
    mockIsImageAttachment.mockReturnValue(true);

    const mod = await import("../bridge.js");
    DiscordBridge = mod.DiscordBridge;
  });

  it("resolves agent workspace and downloads attachments to {workspace}/inbox/attachments/", async () => {
    const bridge = new DiscordBridge({
      routingTable: fakeRoutingTable,
      sessionManager: fakeSessionManager as any,
      botToken: "fake-token",
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any,
    });

    const msg = makeMessage({
      content: "look at this",
      attachments: [
        { id: "att-1", name: "photo.png", contentType: "image/png", size: 12345, url: "https://cdn.example.com/photo.png", proxyURL: "https://proxy.example.com/photo.png" },
      ],
    });

    // Call handleMessage directly (it's private, so we use bracket notation)
    await (bridge as any).handleMessage(msg);

    expect(mockGetAgentConfig).toHaveBeenCalledWith("test-agent");
    expect(mockExtractAttachments).toHaveBeenCalledWith(msg.attachments);
    expect(mockDownloadAllAttachments).toHaveBeenCalledWith(
      [makeAttachmentInfo()],
      "/workspace/test-agent/inbox/attachments",
      expect.anything(), // logger
    );
  });

  it("does NOT call attachment module when message has no attachments", async () => {
    const bridge = new DiscordBridge({
      routingTable: fakeRoutingTable,
      sessionManager: fakeSessionManager as any,
      botToken: "fake-token",
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any,
    });

    const msg = makeMessage({ content: "just text" });

    await (bridge as any).handleMessage(msg);

    expect(mockExtractAttachments).not.toHaveBeenCalled();
    expect(mockDownloadAllAttachments).not.toHaveBeenCalled();
    expect(mockStreamFromAgent).toHaveBeenCalled();
  });
});
