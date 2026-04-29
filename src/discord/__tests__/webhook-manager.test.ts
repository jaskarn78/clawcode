import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture all WebhookClient.send calls across instances.
const sendMock = vi.fn().mockResolvedValue({ id: "msg-id" });
const destroyMock = vi.fn();

vi.mock("discord.js", () => {
  class MockWebhookClient {
    constructor(_opts: { url: string }) {}
    send = sendMock;
    destroy = destroyMock;
  }
  return { WebhookClient: MockWebhookClient };
});

// Import AFTER vi.mock so the WebhookManager picks up the mocked WebhookClient.
import { WebhookManager } from "../webhook-manager.js";
import type { WebhookIdentity } from "../webhook-types.js";

const TEST_IDENTITY: WebhookIdentity = {
  displayName: "TestBot",
  avatarUrl: "https://example.com/avatar.png",
  webhookUrl: "https://discord.com/api/webhooks/0/abc",
};

function makeManager(): WebhookManager {
  const identities = new Map<string, WebhookIdentity>([
    ["test-agent", TEST_IDENTITY],
  ]);
  return new WebhookManager({ identities });
}

describe("WebhookManager.send — markdown table wrapping (regression for 100-fu webhook gap)", () => {
  beforeEach(() => {
    sendMock.mockClear();
    destroyMock.mockClear();
  });

  it("WHM-WRAP-1: wraps raw markdown tables in ```text``` fences before posting", async () => {
    const manager = makeManager();
    const tableContent = [
      "| Col1 | Col2 |",
      "| ---- | ---- |",
      "| A | B |",
      "| C | D |",
    ].join("\n");

    await manager.send("test-agent", tableContent);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.content).toContain("```text");
    // Original table rows survive
    expect(payload.content).toContain("| Col1 | Col2 |");
    expect(payload.content).toContain("| A | B |");
    // Identity reaches the underlying WebhookClient
    expect(payload.username).toBe(TEST_IDENTITY.displayName);
    expect(payload.avatarURL).toBe(TEST_IDENTITY.avatarUrl);
  });

  it("WHM-WRAP-2: idempotent — already-fenced content is NOT double-wrapped", async () => {
    const manager = makeManager();
    const alreadyFenced = [
      "```text",
      "| Col1 | Col2 |",
      "| ---- | ---- |",
      "| A | B |",
      "```",
    ].join("\n");

    await manager.send("test-agent", alreadyFenced);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    // Exactly one pair of fences (opening + closing) — no nesting.
    const fenceMarkerCount = (payload.content.match(/```/g) ?? []).length;
    expect(fenceMarkerCount).toBe(2);
    // Original content preserved verbatim through the wrap step.
    expect(payload.content).toContain(alreadyFenced);
  });

  it("WHM-WRAP-3: pure prose (no tables) reaches WebhookClient unchanged byte-for-byte", async () => {
    const manager = makeManager();
    const prose = "Hello world.\n\nNo tables here.\nJust paragraphs.";

    await manager.send("test-agent", prose);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.content).toBe(prose);
  });

  it("WHM-WRAP-4: existing chunking + identity behavior preserved", async () => {
    const manager = makeManager();
    // Build content larger than 2000 chars to force chunking.
    const big = "line\n".repeat(500); // 5 chars * 500 = 2500 chars
    await manager.send("test-agent", big);

    expect(sendMock.mock.calls.length).toBeGreaterThan(1);
    for (const call of sendMock.mock.calls) {
      expect(call[0].username).toBe(TEST_IDENTITY.displayName);
      expect(call[0].avatarURL).toBe(TEST_IDENTITY.avatarUrl);
      expect(call[0].content.length).toBeLessThanOrEqual(2000);
    }
  });

  it("WHM-WRAP-5: throws when agent has no webhook configured", async () => {
    const manager = makeManager();
    await expect(manager.send("nobody", "hi")).rejects.toThrow(
      /No webhook identity configured/,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });
});
