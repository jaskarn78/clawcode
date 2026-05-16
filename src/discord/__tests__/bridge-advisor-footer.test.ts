import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Message, Collection, Attachment } from "discord.js";

/**
 * Plan 117-09 — Discord visibility (💭 reaction + footer) via the
 * advisor:invoked / advisor:resulted event consumer in
 * `src/discord/bridge.ts`.
 *
 * Behavior matrix (RESEARCH §13.4, §13.2, §6 Pitfall 1):
 *
 *   A — advisor fired + advisor_result + normal level
 *       → 💭 reaction on triggering user message
 *       → footer "*— consulted advisor (Opus) before responding*"
 *
 *   B — no advisor event fired
 *       → no reaction, no footer
 *
 *   C — advisor fired + advisor_result + response > 2000 chars
 *       → footer appended; sendResponse-large exit path taken;
 *         the augmented (with-footer) response is what `sendResponse`
 *         receives. Silent-path-bifurcation regression assertion.
 *
 *   D — advisor_tool_result_error
 *       → footer "*— advisor unavailable (<errorCode>)*"
 *
 *   E — advisor_redacted_result + normal level
 *       → plain "consulted advisor" footer (NO plaintext leak)
 *
 *   F — verbose seam (Plan 117-11 wires real VerboseState)
 *       → with stub verboseState returning "verbose" + advisor_result,
 *         response includes a fenced 💭 advice block.
 *
 *   G — single mutation point regression
 *       → All three delivery exits (sendResponse-large at >2000ch,
 *         messageRef.current.edit when typing-indicator was sent,
 *         sendResponse when no typing-indicator placeholder was sent)
 *         receive the SAME augmented `response` from the one mutation
 *         point. This is the silent-path-bifurcation prevention
 *         (RESEARCH §6 Pitfall 1, feedback_silent_path_bifurcation
 *         memory — bit us 3× in 2026).
 */

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Build a minimal discord.js Message-like object for these tests. */
function makeMessage(overrides: {
  content?: string;
  channelId?: string;
  messageId?: string;
  username?: string;
} = {}): Message {
  const attMap = new Map<string, Attachment>();
  const collection = {
    size: 0,
    values: () => attMap.values(),
    [Symbol.iterator]: () => attMap.values(),
    map: <T>(_fn: (att: Attachment) => T): T[] => [],
  } as unknown as Collection<string, Attachment>;

  const message = {
    content: overrides.content ?? "hello",
    channelId: overrides.channelId ?? "chan-1",
    id: overrides.messageId ?? "msg-1",
    author: {
      username: overrides.username ?? "user-a",
      bot: false,
      id: "user-1",
    },
    createdAt: new Date("2026-05-13T00:00:00Z"),
    attachments: collection,
    reference: null,
    webhookId: null,
    embeds: [],
    react: vi.fn().mockResolvedValue(undefined),
    channel: {
      sendTyping: vi.fn(),
      send: vi.fn().mockImplementation(async (content: string) => {
        // Returned Message has .edit / .delete used by the progressive editor.
        return {
          id: "placeholder-msg",
          edit: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockResolvedValue(undefined),
          content,
        };
      }),
    },
  };

  return message as unknown as Message;
}

// ── Module mock: avoid loading the real Discord client construction logic ───

// We do NOT mock the bridge itself — we exercise the real
// `streamAndPostResponse` private method. The Discord client `new Client(...)`
// in the bridge constructor is fine because it does NOT connect until
// `start()` is called, which we never do.

describe("Plan 117-09 — Discord bridge advisor footer + reaction", () => {
  let DiscordBridge: typeof import("../bridge.js").DiscordBridge;
  let bridge: InstanceType<typeof DiscordBridge>;
  let advisorEvents: EventEmitter;
  let mockSendResponse: ReturnType<typeof vi.fn>;

  const fakeRoutingTable = {
    channelToAgent: new Map([["chan-1", "test-agent"]]),
    agentToChannels: new Map([["test-agent", ["chan-1"]]]),
  };

  const fakeLog = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  /**
   * Build a TurnDispatcher mock whose `dispatchStream` synchronously emits
   * the supplied advisor events on `advisorEvents` BEFORE resolving with
   * the given response text. This matches the production timing: the
   * advisor observer in `persistent-session-handle.ts` emits during the
   * SDK stream loop, which is upstream of `dispatchStream`'s resolution.
   */
  function buildTurnDispatcher(
    response: string,
    emit?: {
      invoked?: { agent: string };
      resulted?: {
        agent: string;
        kind: "advisor_result" | "advisor_redacted_result" | "advisor_tool_result_error";
        text?: string;
        errorCode?: string;
      };
    },
  ): { dispatchStream: ReturnType<typeof vi.fn> } {
    return {
      dispatchStream: vi.fn().mockImplementation(
        async (
          _origin: unknown,
          _sessionName: string,
          _formatted: string,
          _onChunk: (s: string) => void,
        ) => {
          if (emit?.invoked) {
            advisorEvents.emit("advisor:invoked", {
              agent: emit.invoked.agent,
              turnId: "turn-1",
              toolUseId: "tool-1",
            });
          }
          if (emit?.resulted) {
            advisorEvents.emit("advisor:resulted", {
              agent: emit.resulted.agent,
              turnId: "turn-1",
              toolUseId: "tool-1",
              kind: emit.resulted.kind,
              text: emit.resulted.text,
              errorCode: emit.resulted.errorCode,
            });
          }
          return response;
        },
      ),
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    advisorEvents = new EventEmitter();
    mockSendResponse = vi.fn().mockResolvedValue(undefined);

    const mod = await import("../bridge.js");
    DiscordBridge = mod.DiscordBridge;

    bridge = new DiscordBridge({
      routingTableRef: { current: fakeRoutingTable },
      sessionManager: {
        forwardToAgent: vi.fn(),
        streamFromAgent: vi.fn(),
        getAgentConfig: vi.fn().mockReturnValue({ workspace: "/tmp/test-agent" }),
        getTraceCollector: vi.fn().mockReturnValue(undefined),
        advisorEvents,
      } as unknown as import("../../manager/session-manager.js").SessionManager,
      // turnDispatcher is replaced per-test via direct field assignment below
      // (each test wants its own dispatchStream emitter behavior).
      botToken: "fake-token",
      log: fakeLog as unknown as import("pino").Logger,
    });

    // Replace the (real) `sendResponse` method with a spy so we can assert
    // the augmented response text that reaches the >2000-char delivery exit.
    (bridge as unknown as { sendResponse: typeof mockSendResponse }).sendResponse =
      mockSendResponse;
  });

  // ── Case A — reaction + footer (normal level, advisor_result) ──────────────

  it("A: advisor fired (advisor_result, normal level) → 💭 reaction + plain footer", async () => {
    const msg = makeMessage({ messageId: "1234567890123450001" });
    const turnDispatcher = buildTurnDispatcher("Here is your answer.", {
      invoked: { agent: "test-agent" },
      resulted: { agent: "test-agent", kind: "advisor_result", text: "advice text" },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    // 💭 reaction landed on the triggering user message
    expect((msg as any).react).toHaveBeenCalledWith("💭");

    // Short response (<= 2000) with no progressive-edit placeholder created
    // (channel.send never called by the editor because dispatchStream did
    // not invoke onChunk) ⇒ delivery exit is `sendResponse(message, response, ...)`.
    expect(mockSendResponse).toHaveBeenCalledTimes(1);
    const [, deliveredResponse] = mockSendResponse.mock.calls[0]!;
    expect(deliveredResponse).toBe(
      "Here is your answer.\n\n*— consulted advisor (Opus) before responding*",
    );
  });

  // ── Case B — no advisor event fired ────────────────────────────────────────

  it("B: no advisor event fired → no reaction, no footer", async () => {
    const msg = makeMessage({ messageId: "1234567890123450002" });
    const turnDispatcher = buildTurnDispatcher("Plain response.", /* no emit */);
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    expect((msg as any).react).not.toHaveBeenCalled();
    expect(mockSendResponse).toHaveBeenCalledTimes(1);
    const [, deliveredResponse] = mockSendResponse.mock.calls[0]!;
    expect(deliveredResponse).toBe("Plain response.");
    expect(deliveredResponse).not.toContain("advisor");
  });

  // ── Case C — long response (>2000 chars) with advisor footer ───────────────

  it("C: response > 2000 chars + advisor fired → footer applied; sendResponse-large exit receives augmented text", async () => {
    const msg = makeMessage({ messageId: "1234567890123450003" });
    const longBody = "x".repeat(2050);
    const turnDispatcher = buildTurnDispatcher(longBody, {
      invoked: { agent: "test-agent" },
      resulted: { agent: "test-agent", kind: "advisor_result", text: "advice" },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    expect(mockSendResponse).toHaveBeenCalledTimes(1);
    const [, deliveredResponse] = mockSendResponse.mock.calls[0]!;
    expect(deliveredResponse.endsWith(
      "*— consulted advisor (Opus) before responding*",
    )).toBe(true);
    expect(deliveredResponse.length).toBe(
      longBody.length +
        "\n\n*— consulted advisor (Opus) before responding*".length,
    );
  });

  // ── Case D — advisor_tool_result_error footer ──────────────────────────────

  it("D: advisor_tool_result_error → unavailable footer with errorCode", async () => {
    const msg = makeMessage({ messageId: "1234567890123450004" });
    const turnDispatcher = buildTurnDispatcher("Best-effort answer.", {
      invoked: { agent: "test-agent" },
      resulted: {
        agent: "test-agent",
        kind: "advisor_tool_result_error",
        errorCode: "max_uses_exceeded",
      },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    expect((msg as any).react).toHaveBeenCalledWith("💭");
    const [, deliveredResponse] = mockSendResponse.mock.calls[0]!;
    expect(deliveredResponse).toBe(
      "Best-effort answer.\n\n*— advisor unavailable (max_uses_exceeded)*",
    );
  });

  // ── Case E — advisor_redacted_result (normal level): plain footer, no leak ─

  it("E: advisor_redacted_result + normal level → plain consulted-advisor footer (no plaintext leak)", async () => {
    const msg = makeMessage({ messageId: "1234567890123450005" });
    const turnDispatcher = buildTurnDispatcher("Response body.", {
      invoked: { agent: "test-agent" },
      resulted: { agent: "test-agent", kind: "advisor_redacted_result" },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    const [, deliveredResponse] = mockSendResponse.mock.calls[0]!;
    expect(deliveredResponse).toBe(
      "Response body.\n\n*— consulted advisor (Opus) before responding*",
    );
    // Critical: no fenced block, no plaintext advice anywhere.
    expect(deliveredResponse).not.toContain("```");
    expect(deliveredResponse).not.toContain("encrypted_content");
  });

  // ── Case F — verbose seam (Plan 117-11 wires real state) ──────────────────

  it("F: verbose seam — stub verboseState returns 'verbose' + advisor_result → fenced advice block", async () => {
    const msg = makeMessage({ messageId: "1234567890123450006" });
    const adviceText = "Consider the edge case where the cache is stale.";
    const turnDispatcher = buildTurnDispatcher("Main reply.", {
      invoked: { agent: "test-agent" },
      resulted: { agent: "test-agent", kind: "advisor_result", text: adviceText },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;
    // Inject the verbose seam stub — Plan 117-11 will replace this with a
    // real VerboseState; today the seam is `this.verboseState?.getLevel(...)`.
    (bridge as unknown as { verboseState: { getLevel: (id: string) => string } }).verboseState =
      { getLevel: () => "verbose" };

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    const [, deliveredResponse] = mockSendResponse.mock.calls[0]!;
    expect(deliveredResponse).toContain("Main reply.");
    expect(deliveredResponse).toContain("💭 advisor consulted (Opus)");
    expect(deliveredResponse).toContain(adviceText);
    // Code fence opens and closes — fenced block, not inline footer.
    expect(deliveredResponse).toContain("\n```\n");
  });

  it("F': verbose seam — advice > 500 chars is truncated with ellipsis", async () => {
    const msg = makeMessage({ messageId: "1234567890123450007" });
    const longAdvice = "a".repeat(800);
    const turnDispatcher = buildTurnDispatcher("Main reply.", {
      invoked: { agent: "test-agent" },
      resulted: { agent: "test-agent", kind: "advisor_result", text: longAdvice },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;
    (bridge as unknown as { verboseState: { getLevel: (id: string) => string } }).verboseState =
      { getLevel: () => "verbose" };

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    const [, deliveredResponse] = mockSendResponse.mock.calls[0]!;
    // First 500 of advice + ellipsis appear; nothing past 500.
    expect(deliveredResponse).toContain("a".repeat(500) + "…");
    expect(deliveredResponse).not.toContain("a".repeat(501));
  });

  // ── Case G — single mutation point regression across all three exits ───────

  it("G1 (silent-path-bifurcation regression): sendResponse-large exit (>2000 chars) carries the footer", async () => {
    const msg = makeMessage({ messageId: "1234567890123450008" });
    const longBody = "y".repeat(2100);
    const turnDispatcher = buildTurnDispatcher(longBody, {
      invoked: { agent: "test-agent" },
      resulted: { agent: "test-agent", kind: "advisor_result", text: "advice" },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    expect(mockSendResponse).toHaveBeenCalledTimes(1);
    const [, deliveredResponse] = mockSendResponse.mock.calls[0]!;
    expect(deliveredResponse).toContain("*— consulted advisor (Opus) before responding*");
  });

  it("G2 (silent-path-bifurcation regression): edit-small exit (placeholder edited) carries the footer", async () => {
    const msg = makeMessage({ messageId: "1234567890123450009" });
    const editSpy = vi.fn().mockResolvedValue(undefined);
    // Make `channel.send` return a Message-like with `edit` so the editor's
    // first onChunk creates a placeholder; the final delivery then hits the
    // `messageRef.current.edit(response)` exit (NOT sendResponse).
    (msg as any).channel.send = vi.fn().mockResolvedValue({
      id: "placeholder",
      edit: editSpy,
      delete: vi.fn().mockResolvedValue(undefined),
    });

    const turnDispatcher = {
      dispatchStream: vi.fn().mockImplementation(
        async (
          _origin: unknown,
          _sessionName: string,
          _formatted: string,
          onChunk: (s: string) => void,
        ) => {
          // First emit advisor events, then push a chunk so the editor
          // creates a placeholder message — that drives delivery into the
          // `messageRef.current.edit(response)` branch on flush.
          advisorEvents.emit("advisor:invoked", {
            agent: "test-agent",
            turnId: "turn-G2",
            toolUseId: "tool-G2",
          });
          advisorEvents.emit("advisor:resulted", {
            agent: "test-agent",
            turnId: "turn-G2",
            toolUseId: "tool-G2",
            kind: "advisor_result",
            text: "advice",
          });
          onChunk("partial");
          // Wait a tick so the editor's debounced/scheduled write fires
          // through (creates the placeholder via channel.send).
          await new Promise((r) => setTimeout(r, 0));
          return "Short final reply.";
        },
      ),
    };
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    // The edit-small exit was taken (placeholder existed, final < 2000 chars):
    // edit() received the augmented response with the footer.
    expect(editSpy).toHaveBeenCalled();
    const lastEditCall = editSpy.mock.calls[editSpy.mock.calls.length - 1]!;
    const edited = lastEditCall[0] as string;
    expect(edited).toContain("*— consulted advisor (Opus) before responding*");
    // sendResponse-large is NOT the path here:
    expect(mockSendResponse).not.toHaveBeenCalled();
  });

  it("G3 (silent-path-bifurcation regression): sendResponse-no-placeholder exit carries the footer", async () => {
    // This is the same path as Case A — short response, no placeholder
    // ever created (no onChunk emitted by dispatchStream), so flush()'s
    // delivery falls to the `else { sendResponse(...) }` branch at the
    // third exit. Asserts that exit ALSO inherits the single-mutation
    // augmented response.
    const msg = makeMessage({ messageId: "1234567890123450010" });
    const turnDispatcher = buildTurnDispatcher("Short reply.", {
      invoked: { agent: "test-agent" },
      resulted: { agent: "test-agent", kind: "advisor_result", text: "advice" },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    expect(mockSendResponse).toHaveBeenCalledTimes(1);
    const [, deliveredResponse] = mockSendResponse.mock.calls[0]!;
    expect(deliveredResponse.endsWith(
      "*— consulted advisor (Opus) before responding*",
    )).toBe(true);
  });

  // ── Listener lifecycle: leaks would break this test ────────────────────────

  it("listeners are unregistered after each turn (no leak across turns)", async () => {
    const msg1 = makeMessage({ messageId: "1234567890123450011" });
    const msg2 = makeMessage({ messageId: "1234567890123450012" });
    const turnDispatcher = buildTurnDispatcher("ok", {
      invoked: { agent: "test-agent" },
      resulted: { agent: "test-agent", kind: "advisor_result", text: "advice" },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    // Baseline: emitter has zero advisor listeners.
    expect(advisorEvents.listenerCount("advisor:invoked")).toBe(0);
    expect(advisorEvents.listenerCount("advisor:resulted")).toBe(0);

    await (bridge as any).streamAndPostResponse(msg1, "test-agent", "hello");
    expect(advisorEvents.listenerCount("advisor:invoked")).toBe(0);
    expect(advisorEvents.listenerCount("advisor:resulted")).toBe(0);

    await (bridge as any).streamAndPostResponse(msg2, "test-agent", "hello again");
    expect(advisorEvents.listenerCount("advisor:invoked")).toBe(0);
    expect(advisorEvents.listenerCount("advisor:resulted")).toBe(0);
  });

  // ── Plan 117.1-01 — INFO log telemetry on advisor events ──────────────────
  //
  // Production gap discovered in the Phase 117 operator smoke: the bridge's
  // `onInvoked` / `onResulted` callbacks emitted no telemetry, so the daemon
  // log contained no evidence of native advisor invocations (Issue 2 in
  // .planning/phases/117.1-.../117.1-CONTEXT.md). 117.1-01 added two
  // `this.log.info(...)` calls. These tests pin the structured-field shape so
  // future refactors can't silently drop production observability. Pattern
  // match: `feedback_silent_path_bifurcation` memory (bit us 3× in 2026).

  it("telemetry: advisor:invoked fires INFO log with { agent, channel, userMessageId }", async () => {
    const msg = makeMessage({ messageId: "1234567890123450014" });
    const turnDispatcher = buildTurnDispatcher("Reply.", {
      invoked: { agent: "test-agent" },
      resulted: { agent: "test-agent", kind: "advisor_result", text: "advice" },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    const invokedCall = fakeLog.info.mock.calls.find(
      ([, message]) => message === "advisor invoked (native server tool fired)",
    );
    expect(invokedCall).toBeDefined();
    expect(invokedCall![0]).toEqual({
      agent: "test-agent",
      channel: "chan-1",
      userMessageId: "1234567890123450014",
    });
  });

  it("telemetry: advisor:resulted (advisor_result variant) fires INFO log with variant, no errorCode", async () => {
    const msg = makeMessage({ messageId: "1234567890123450015" });
    const turnDispatcher = buildTurnDispatcher("Reply.", {
      invoked: { agent: "test-agent" },
      resulted: { agent: "test-agent", kind: "advisor_result", text: "advice" },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    const resultedCall = fakeLog.info.mock.calls.find(
      ([, message]) => message === "advisor resulted",
    );
    expect(resultedCall).toBeDefined();
    const fields = resultedCall![0] as Record<string, unknown>;
    expect(fields.agent).toBe("test-agent");
    expect(fields.channel).toBe("chan-1");
    expect(fields.variant).toBe("advisor_result");
    // Non-error variant: errorCode field MUST be absent (not present-undefined).
    expect("errorCode" in fields).toBe(false);
  });

  it("telemetry: advisor:resulted (advisor_redacted_result variant) fires INFO log with variant, no errorCode", async () => {
    const msg = makeMessage({ messageId: "1234567890123450016" });
    const turnDispatcher = buildTurnDispatcher("Reply.", {
      invoked: { agent: "test-agent" },
      resulted: { agent: "test-agent", kind: "advisor_redacted_result" },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    const resultedCall = fakeLog.info.mock.calls.find(
      ([, message]) => message === "advisor resulted",
    );
    expect(resultedCall).toBeDefined();
    const fields = resultedCall![0] as Record<string, unknown>;
    expect(fields.agent).toBe("test-agent");
    expect(fields.channel).toBe("chan-1");
    expect(fields.variant).toBe("advisor_redacted_result");
    expect("errorCode" in fields).toBe(false);
  });

  it("telemetry: advisor:resulted (advisor_tool_result_error variant) fires INFO log with variant + errorCode", async () => {
    const msg = makeMessage({ messageId: "1234567890123450017" });
    const turnDispatcher = buildTurnDispatcher("Reply.", {
      invoked: { agent: "test-agent" },
      resulted: {
        agent: "test-agent",
        kind: "advisor_tool_result_error",
        errorCode: "max_uses_exceeded",
      },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    const resultedCall = fakeLog.info.mock.calls.find(
      ([, message]) => message === "advisor resulted",
    );
    expect(resultedCall).toBeDefined();
    const fields = resultedCall![0] as Record<string, unknown>;
    expect(fields.agent).toBe("test-agent");
    expect(fields.channel).toBe("chan-1");
    expect(fields.variant).toBe("advisor_tool_result_error");
    expect(fields.errorCode).toBe("max_uses_exceeded");
  });

  // ── Agent-name guard: cross-agent events are ignored ──────────────────────

  it("ignores advisor events for a different agent (agent-name guard)", async () => {
    const msg = makeMessage({ messageId: "1234567890123450013" });
    const turnDispatcher = buildTurnDispatcher("Plain.", {
      invoked: { agent: "other-agent" }, // different agent
      resulted: { agent: "other-agent", kind: "advisor_result", text: "advice" },
    });
    (bridge as unknown as { turnDispatcher: unknown }).turnDispatcher = turnDispatcher;

    await (bridge as any).streamAndPostResponse(msg, "test-agent", "hello");

    expect((msg as any).react).not.toHaveBeenCalled();
    const [, deliveredResponse] = mockSendResponse.mock.calls[0]!;
    expect(deliveredResponse).toBe("Plain.");
  });
});
