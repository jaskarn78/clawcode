import { describe, it, expect, vi, beforeEach } from "vitest";
import { runVisionPrepass, _resetSdkCacheForTests } from "../vision-prepass.js";

// Minimal SdkStreamMessage shapes for mock
type MockResultMsg = { type: "result"; subtype: "success"; result: string };
type MockOtherMsg = { type: "assistant" };
type MockMsg = MockResultMsg | MockOtherMsg;

function makeMockSdk(messages: MockMsg[]) {
  return {
    query: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const msg of messages) yield msg;
      },
    }),
  };
}

beforeEach(() => {
  _resetSdkCacheForTests();
  vi.resetModules();
});

describe("runVisionPrepass", () => {
  it("returns the result string on a successful Haiku response", async () => {
    const mockSdk = makeMockSdk([{ type: "result", subtype: "success", result: "TEXT: Hello world\nUI: button\nALERTS: none\nLAYOUT: simple screen" }]);
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSdk);

    const { runVisionPrepass: fn, _resetSdkCacheForTests: reset } = await import("../vision-prepass.js");
    reset();

    const buf = Buffer.from("fake-image-data");
    const result = await fn(buf, "image/jpeg");
    expect(result).toBe("TEXT: Hello world\nUI: button\nALERTS: none\nLAYOUT: simple screen");
  });

  it("returns empty string when SDK throws", async () => {
    const mockSdk = {
      query: vi.fn().mockImplementation(() => {
        throw new Error("SDK unavailable");
      }),
    };
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSdk);

    const { runVisionPrepass: fn, _resetSdkCacheForTests: reset } = await import("../vision-prepass.js");
    reset();

    const buf = Buffer.from("fake-image-data");
    const result = await fn(buf, "image/jpeg");
    expect(result).toBe("");
  });

  it("returns empty string when no result message is emitted", async () => {
    const mockSdk = makeMockSdk([{ type: "assistant" }]);
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSdk);

    const { runVisionPrepass: fn, _resetSdkCacheForTests: reset } = await import("../vision-prepass.js");
    reset();

    const buf = Buffer.from("fake-image-data");
    const result = await fn(buf, "image/jpeg");
    expect(result).toBe("");
  });

  it("passes an image content block to sdk.query", async () => {
    let capturedPrompt: unknown = null;
    const mockSdk = {
      query: vi.fn().mockImplementation(({ prompt }: { prompt: AsyncIterable<unknown> }) => {
        capturedPrompt = prompt;
        return {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "result", subtype: "success", result: "TEXT: test" };
          },
        };
      }),
    };
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSdk);

    const { runVisionPrepass: fn, _resetSdkCacheForTests: reset } = await import("../vision-prepass.js");
    reset();

    const buf = Buffer.from("fake-image-data");
    await fn(buf, "image/jpeg");

    // Consume the async iterable to get the yielded message
    expect(capturedPrompt).not.toBeNull();
    const messages: unknown[] = [];
    for await (const msg of capturedPrompt as AsyncIterable<unknown>) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(1);
    const msg = messages[0] as { message: { content: Array<{ type: string }> } };
    const content = msg.message.content;
    expect(content[0].type).toBe("image");
    expect(content[1].type).toBe("text");
  });

  it("returns empty string when SDK returns API error text as a successful result", async () => {
    const mockSdk = makeMockSdk([{ type: "result", subtype: "success", result: "Credit balance is too low to complete this request." }]);
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSdk);

    const { runVisionPrepass: fn, _resetSdkCacheForTests: reset } = await import("../vision-prepass.js");
    reset();

    const buf = Buffer.from("fake-image-data");
    const result = await fn(buf, "image/jpeg");
    expect(result).toBe("");
  });

  it("respects an already-aborted signal", async () => {
    const mockSdk = makeMockSdk([{ type: "result", subtype: "success", result: "TEXT: hello" }]);
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSdk);

    const { runVisionPrepass: fn, _resetSdkCacheForTests: reset } = await import("../vision-prepass.js");
    reset();

    const controller = new AbortController();
    controller.abort();

    const buf = Buffer.from("fake-image-data");
    // Should not throw — SDK call still happens with aborted controller,
    // but no error propagates to caller.
    const result = await fn(buf, "image/jpeg", { signal: controller.signal });
    expect(typeof result).toBe("string");
  });
});
