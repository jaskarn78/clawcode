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
  // vi.fn() wrapping a function expression (NOT arrow — arrows aren't
  // constructable with `new`) so tests can assert MockAnthropic.mock.calls
  // for verifying the token-identity cache (token unchanged → no reconstruction).
  const MockAnthropic = vi.fn(function MockAnthropicImpl(this: unknown, _opts: unknown) {
    return { messages: { create: mockCreate } };
  });
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

function credsWithToken(token: string): string {
  return JSON.stringify({
    claudeAiOauth: { accessToken: token, expiresAt: 9999999999 },
  });
}

describe("callHaikuDirect", () => {
  beforeEach(() => {
    _resetClientForTests();
    mockCreate.mockReset();
    mockReadFile.mockReset();
    MockAnthropic.mockClear();
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

  it("reuses client when access token is unchanged across calls", async () => {
    // Token-identity cache: file is read every call (page-cached, cheap), but
    // the Anthropic SDK client is reconstructed only when the token differs.
    mockCreate.mockResolvedValue(textResponse("a"));
    await callHaikuDirect("s", "u", {});
    await callHaikuDirect("s", "u", {});
    expect(mockReadFile).toHaveBeenCalledTimes(2);
    expect(MockAnthropic).toHaveBeenCalledTimes(1);
  });

  it("rebuilds client when access token rotates (auto-refresh, manual relogin)", async () => {
    // Regression pin for the 2026-05-11 Discord 401 incident: cached client
    // bakes the old token at construction time; refresh rotates the token in
    // the credentials file; without re-checking identity the daemon replays
    // the dead token forever and every call hits 401.
    mockReadFile.mockReset();
    mockReadFile.mockResolvedValueOnce(credsWithToken("TOKEN_A"));
    mockReadFile.mockResolvedValueOnce(credsWithToken("TOKEN_B"));
    mockCreate.mockResolvedValue(textResponse("ok"));

    await callHaikuDirect("s", "u", {});
    await callHaikuDirect("s", "u", {});

    expect(MockAnthropic).toHaveBeenCalledTimes(2);
    const firstCallOpts = MockAnthropic.mock.calls[0]![0] as {
      authToken: string;
    };
    const secondCallOpts = MockAnthropic.mock.calls[1]![0] as {
      authToken: string;
    };
    expect(firstCallOpts.authToken).toBe("TOKEN_A");
    expect(secondCallOpts.authToken).toBe("TOKEN_B");
  });

  it("retries once on 401, invalidating cache and reloading credentials", async () => {
    // Defense-in-depth: handles the race where the token rotates between
    // loadOAuthToken() and the SDK's HTTP send. Without this, callers still
    // see occasional 401s at rotation boundaries every ~8h.
    mockReadFile.mockReset();
    mockReadFile.mockResolvedValueOnce(credsWithToken("STALE"));
    mockReadFile.mockResolvedValueOnce(credsWithToken("FRESH"));

    const error401 = Object.assign(new Error("Unauthorized"), { status: 401 });
    mockCreate.mockRejectedValueOnce(error401);
    mockCreate.mockResolvedValueOnce(textResponse("recovered"));

    const result = await callHaikuDirect("s", "u", {});
    expect(result).toBe("recovered");
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(MockAnthropic).toHaveBeenCalledTimes(2);
    const retryClientOpts = MockAnthropic.mock.calls[1]![0] as {
      authToken: string;
    };
    expect(retryClientOpts.authToken).toBe("FRESH");
  });

  it("does not retry on non-401 errors", async () => {
    const error500 = Object.assign(new Error("Server error"), { status: 500 });
    mockCreate.mockRejectedValueOnce(error500);

    await expect(callHaikuDirect("s", "u", {})).rejects.toThrow("Server error");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe("callHaikuVision", () => {
  beforeEach(() => {
    _resetClientForTests();
    mockCreate.mockReset();
    mockReadFile.mockReset();
    MockAnthropic.mockClear();
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
