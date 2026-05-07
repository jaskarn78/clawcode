/**
 * Phase 113 — unit tests for haiku-direct.ts.
 *
 * Mocks @anthropic-ai/sdk (never hits the network) and node:fs/promises
 * (never reads ~/.claude/.credentials.json). _resetClientForTests() is
 * called in beforeEach so the cached client doesn't leak across tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockCreate, MockAnthropic } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  function MockAnthropic(_opts: unknown) {
    return { messages: { create: mockCreate } };
  }
  return { mockCreate, MockAnthropic };
});

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: MockAnthropic,
}));

import { readFile } from "node:fs/promises";

const {
  callHaikuDirect,
  callHaikuVision,
  _resetClientForTests,
} = await import("../haiku-direct.js");

const mockReadFile = vi.mocked(readFile);

const FAKE_TOKEN = "sk-ant-oauth-test-token";
const VALID_CREDS = JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN, expiresAt: 9999999999 } });

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("callHaikuDirect", () => {
  beforeEach(() => {
    _resetClientForTests();
    mockCreate.mockReset();
    mockReadFile.mockReset();
    mockReadFile.mockResolvedValue(VALID_CREDS as unknown as string);
  });

  it("calls messages.create with correct model, system, and user content", async () => {
    mockCreate.mockResolvedValue(textResponse("output"));
    const result = await callHaikuDirect("my system", "my prompt", {});
    expect(result).toBe("output");
    const call = mockCreate.mock.calls[0]![0] as {
      model: string;
      system: string;
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    };
    expect(call.model).toBe("claude-haiku-4-5");
    expect(call.system).toBe("my system");
    expect(call.messages[0]?.role).toBe("user");
    expect(call.messages[0]?.content).toBe("my prompt");
    expect(call.max_tokens).toBe(2048);
  });

  it("returns empty string when response has no text block", async () => {
    mockCreate.mockResolvedValue({ content: [] });
    const result = await callHaikuDirect("s", "u", {});
    expect(result).toBe("");
  });

  it("forwards abort signal to messages.create", async () => {
    const controller = new AbortController();
    mockCreate.mockImplementation(
      (_body: unknown, opts: { signal?: AbortSignal }) => {
        expect(opts?.signal).toBe(controller.signal);
        return Promise.resolve(textResponse("ok"));
      },
    );
    await callHaikuDirect("s", "u", { signal: controller.signal });
  });

  it("throws when credentials file is missing claudeAiOauth.accessToken", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ other: "value" }) as unknown as string);
    await expect(callHaikuDirect("s", "u", {})).rejects.toThrow(
      "claudeAiOauth.accessToken missing",
    );
  });

  it("throws when credentials file is not readable", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await expect(callHaikuDirect("s", "u", {})).rejects.toThrow("ENOENT");
  });

  it("caches the client: credentials file read only once across multiple calls", async () => {
    mockCreate.mockResolvedValue(textResponse("a"));
    await callHaikuDirect("s", "u", {});
    await callHaikuDirect("s", "u", {});
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });
});

describe("callHaikuVision", () => {
  beforeEach(() => {
    _resetClientForTests();
    mockCreate.mockReset();
    mockReadFile.mockReset();
    mockReadFile.mockResolvedValue(VALID_CREDS as unknown as string);
  });

  it("sends image as base64 content block alongside text prompt", async () => {
    mockCreate.mockResolvedValue(textResponse("analysis"));
    const buf = Buffer.from("fake-image-bytes");
    const result = await callHaikuVision("sys", "describe this", buf, "image/png", {});
    expect(result).toBe("analysis");

    const call = mockCreate.mock.calls[0]![0] as {
      model: string;
      messages: Array<{ role: string; content: unknown[] }>;
    };
    expect(call.model).toBe("claude-haiku-4-5");
    const content = call.messages[0]?.content ?? [];
    const imageBlock = content[0] as {
      type: string;
      source: { type: string; media_type: string; data: string };
    };
    const textBlock = content[1] as { type: string; text: string };
    expect(imageBlock.type).toBe("image");
    expect(imageBlock.source.type).toBe("base64");
    expect(imageBlock.source.media_type).toBe("image/png");
    expect(imageBlock.source.data).toBe(buf.toString("base64"));
    expect(textBlock.type).toBe("text");
    expect(textBlock.text).toBe("describe this");
  });

  it("uses max_tokens 1024 for vision calls", async () => {
    mockCreate.mockResolvedValue(textResponse("ok"));
    await callHaikuVision("s", "u", Buffer.alloc(1), "image/jpeg", {});
    const call = mockCreate.mock.calls[0]![0] as { max_tokens: number };
    expect(call.max_tokens).toBe(1024);
  });

  it("returns empty string when response has no text block", async () => {
    mockCreate.mockResolvedValue({ content: [] });
    const result = await callHaikuVision("s", "u", Buffer.alloc(1), "image/png", {});
    expect(result).toBe("");
  });
});
