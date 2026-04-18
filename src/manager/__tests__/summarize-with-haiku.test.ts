/**
 * Phase 66 Plan 03 Task 1 — unit tests for summarizeWithHaiku.
 *
 * The SDK module is mocked via vi.mock() so tests never hit the network
 * and don't require an ANTHROPIC_API_KEY. `_resetSdkCacheForTests()` is
 * called in beforeEach so the cached import reference doesn't leak
 * across tests when the mock is reset.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the SDK BEFORE importing summarizeWithHaiku. vi.mock is hoisted,
// so this registration happens before any subsequent `import` executes.
const mockQuery = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
}));

// Import AFTER the mock is registered (top-level await — idiomatic vitest-4).
const { summarizeWithHaiku, _resetSdkCacheForTests } = await import(
  "../summarize-with-haiku.js"
);

// Helper: turn an array of message objects into an async iterator for mockQuery.
async function* iterateMessages(messages: ReadonlyArray<unknown>) {
  for (const m of messages) yield m;
}

describe("summarizeWithHaiku", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    _resetSdkCacheForTests();
  });

  afterEach(() => {
    mockQuery.mockReset();
  });

  it("resolves with the first successful result message text", async () => {
    mockQuery.mockReturnValue(
      iterateMessages([
        { type: "assistant", text: "thinking..." },
        { type: "result", subtype: "success", result: "## User Preferences\n- terse\n" },
      ]),
    );

    const out = await summarizeWithHaiku("prompt text", {});
    expect(out).toBe("## User Preferences\n- terse\n");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("passes the correct SDK options (model, systemPrompt, skipPermissions, settingSources=[], abortController)", async () => {
    mockQuery.mockReturnValue(
      iterateMessages([{ type: "result", subtype: "success", result: "ok" }]),
    );

    await summarizeWithHaiku("p", {});

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArg = mockQuery.mock.calls[0]![0] as {
      prompt: string;
      options: {
        model: string;
        allowDangerouslySkipPermissions: boolean;
        settingSources: readonly string[];
        abortController: AbortController;
        systemPrompt: string;
      };
    };
    expect(callArg.prompt).toBe("p");
    expect(callArg.options.model).toBe("claude-haiku-4-5");
    expect(callArg.options.allowDangerouslySkipPermissions).toBe(true);
    expect(callArg.options.settingSources).toEqual([]);
    expect(callArg.options.abortController).toBeInstanceOf(AbortController);
    expect(typeof callArg.options.systemPrompt).toBe("string");
    expect(callArg.options.systemPrompt).toContain("summarizer");
  });

  it("forwards caller abort signal to the internal AbortController", async () => {
    let capturedController: AbortController | undefined;
    mockQuery.mockImplementation(
      (args: { options: { abortController?: AbortController } }) => {
        capturedController = args.options.abortController;
        // never resolves naturally; relies on abort. Handle pre-aborted
        // case because the abort may fire before the for-await loop starts
        // consuming (listener-after-abort would hang forever).
        return (async function* () {
          if (capturedController!.signal.aborted) return;
          await new Promise<void>((resolve) => {
            capturedController!.signal.addEventListener(
              "abort",
              () => resolve(),
              { once: true },
            );
          });
        })();
      },
    );

    const outerController = new AbortController();

    // Abort BEFORE starting — summarizeWithHaiku must attach its listener
    // synchronously-enough that it catches a later abort. To exercise the
    // runtime-abort path specifically, we kick off the call, flush the
    // loadSdk() microtask, then abort.
    const p = summarizeWithHaiku("p", { signal: outerController.signal });
    // Flush microtasks so the listener inside summarizeWithHaiku is attached
    // before we abort.
    await Promise.resolve();
    await Promise.resolve();

    outerController.abort();
    await p;

    expect(capturedController).toBeDefined();
    expect(capturedController!.signal.aborted).toBe(true);
  });

  it("returns empty string if no result message ever arrives", async () => {
    mockQuery.mockReturnValue(
      iterateMessages([
        { type: "assistant", text: "..." },
        { type: "other", data: {} },
      ]),
    );
    const out = await summarizeWithHaiku("p", {});
    expect(out).toBe("");
  });

  it("ignores result messages with non-success subtype", async () => {
    mockQuery.mockReturnValue(
      iterateMessages([
        { type: "result", subtype: "error_max_input_tokens", result: "should not use" },
        { type: "result", subtype: "success", result: "use this" },
      ]),
    );
    const out = await summarizeWithHaiku("p", {});
    expect(out).toBe("use this");
  });

  it("handles pre-aborted signal by aborting the internal controller immediately", async () => {
    let capturedController: AbortController | undefined;
    mockQuery.mockImplementation(
      (args: { options: { abortController?: AbortController } }) => {
        capturedController = args.options.abortController;
        return iterateMessages([]);
      },
    );

    const outerController = new AbortController();
    outerController.abort(); // abort BEFORE calling

    await summarizeWithHaiku("p", { signal: outerController.signal });
    expect(capturedController!.signal.aborted).toBe(true);
  });
});
