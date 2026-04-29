/**
 * Phase 999.2 Plan 03 — pure-DI handler tests for the `ask-agent` IPC handler.
 *
 * Mirrors the Phase 103 daemon-rate-limit-ipc.ts blueprint: we extract the
 * case-body of `case "ask-agent":` (in src/manager/daemon.ts) into a small
 * pure-DI module so the v2 sync-reply contract can be tested without spawning
 * the full daemon.
 *
 * Pins all four Plan 03 requirements:
 *   - A2A-09: response surfaced when target running
 *   - A2A-10: mirror_to_target_channel posts pre + post webhook embeds; webhook
 *             failure does NOT abort the ask (Pitfall 7)
 *   - A2A-11: dispatchTurn errors propagate (no silent catch)
 *   - A2A-12: offline target → response undefined, dispatchTurn never called
 *
 * Plus Pitfall-4 reply-threading prefix pin (`> reply to {from}:`) and the
 * inbox-write-first invariant (covers offline path + sync path symmetrically).
 */
import { describe, it, expect, vi } from "vitest";
import {
  handleAskAgentIpc,
  buildAskAgentDeps,
} from "../daemon-ask-agent-ipc.js";

describe("handleAskAgentIpc — Phase 999.2 Plan 03 sync-reply", () => {
  it("surfaces target's response when target is running (A2A-09)", async () => {
    const dispatchTurn = vi.fn().mockResolvedValue("answer from fin-acquisition");
    const writeInbox = vi.fn().mockResolvedValue({ messageId: "msg-1" });
    const deps = buildAskAgentDeps({
      runningAgents: ["fin-acquisition"],
      dispatchTurn,
      writeInbox,
    });
    const result = await handleAskAgentIpc(
      { from: "admin-clawdy", to: "fin-acquisition", content: "what's our LTV?" },
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      messageId: "msg-1",
      response: "answer from fin-acquisition",
    });
    expect(dispatchTurn).toHaveBeenCalledWith("fin-acquisition", "what's our LTV?");
  });

  it("omits response when target is not running (still ok) (A2A-12)", async () => {
    const dispatchTurn = vi.fn();
    const writeInbox = vi.fn().mockResolvedValue({ messageId: "msg-offline" });
    const deps = buildAskAgentDeps({
      runningAgents: [],
      dispatchTurn,
      writeInbox,
    });
    const result = await handleAskAgentIpc(
      { from: "admin-clawdy", to: "fin-acquisition", content: "ping" },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(result.response).toBeUndefined();
    expect(result.messageId).toBe("msg-offline");
    expect(dispatchTurn).not.toHaveBeenCalled();
  });

  it("propagates dispatch errors (no silent catch) (A2A-11)", async () => {
    const dispatchTurn = vi
      .fn()
      .mockRejectedValue(new Error("MCP server unreachable"));
    const writeInbox = vi.fn().mockResolvedValue({ messageId: "msg-err" });
    const deps = buildAskAgentDeps({
      runningAgents: ["fin"],
      dispatchTurn,
      writeInbox,
    });
    await expect(
      handleAskAgentIpc(
        { from: "admin", to: "fin", content: "x" },
        deps,
      ),
    ).rejects.toThrow("MCP server unreachable");
  });

  it("mirror=true posts prompt embed BEFORE dispatch + response embed AFTER dispatch (A2A-10 + Pitfall 4)", async () => {
    const sendAsAgent = vi.fn().mockResolvedValue(undefined);
    const dispatchTurn = vi.fn().mockResolvedValue("the answer body");
    const writeInbox = vi.fn().mockResolvedValue({ messageId: "msg-mir" });
    const deps = buildAskAgentDeps({
      runningAgents: ["fin"],
      dispatchTurn,
      writeInbox,
      webhookManager: {
        hasWebhook: () => true,
        sendAsAgent,
      },
      configs: [
        { name: "admin", webhook: { displayName: "Admin Clawdy" } },
        { name: "fin", webhook: { displayName: "Finance Bot" } },
      ],
    });
    const result = await handleAskAgentIpc(
      {
        from: "admin",
        to: "fin",
        content: "the prompt body",
        mirror_to_target_channel: true,
      },
      deps,
    );

    expect(result.response).toBe("the answer body");
    expect(sendAsAgent).toHaveBeenCalledTimes(2);

    // First call: prompt embed; description should contain the prompt content.
    const firstCallEmbed = sendAsAgent.mock.calls[0][3];
    const firstDesc = firstCallEmbed.data?.description ?? firstCallEmbed.toJSON?.().description;
    expect(firstDesc).toContain("the prompt body");

    // Second call: response embed; description should contain the response AND
    // the verbatim Pitfall-4 reply-threading prefix `> reply to admin:`.
    const secondCallEmbed = sendAsAgent.mock.calls[1][3];
    const secondDesc = secondCallEmbed.data?.description ?? secondCallEmbed.toJSON?.().description;
    expect(secondDesc).toContain("the answer body");
    expect(secondDesc).toContain("> reply to admin:");

    // Order: pre-mirror < dispatchTurn < post-mirror.
    const preOrder = sendAsAgent.mock.invocationCallOrder[0];
    const dispatchOrder = dispatchTurn.mock.invocationCallOrder[0];
    const postOrder = sendAsAgent.mock.invocationCallOrder[1];
    expect(preOrder).toBeLessThan(dispatchOrder);
    expect(dispatchOrder).toBeLessThan(postOrder);
  });

  it("mirror=true + webhook failure does NOT abort the ask (Pitfall 7)", async () => {
    const sendAsAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("webhook 500"))
      .mockResolvedValueOnce(undefined);
    const dispatchTurn = vi.fn().mockResolvedValue("answer");
    const writeInbox = vi.fn().mockResolvedValue({ messageId: "msg-wf" });
    const warnSpy = vi.fn();
    const deps = buildAskAgentDeps({
      runningAgents: ["fin"],
      dispatchTurn,
      writeInbox,
      webhookManager: {
        hasWebhook: () => true,
        sendAsAgent,
      },
      configs: [{ name: "fin", webhook: { displayName: "Finance Bot" } }],
      log: {
        info: () => {},
        warn: warnSpy,
        error: () => {},
      } as never,
    });

    const result = await handleAskAgentIpc(
      {
        from: "admin",
        to: "fin",
        content: "hi",
        mirror_to_target_channel: true,
      },
      deps,
    );

    // Despite webhook failure, the ask still returned the response.
    expect(result.ok).toBe(true);
    expect(result.response).toBe("answer");
    // dispatchTurn ran even though pre-mirror webhook threw.
    expect(dispatchTurn).toHaveBeenCalled();
    // Warn-log has the best-effort indicator substring.
    const warnMsgs = warnSpy.mock.calls.map((c) => c[1] ?? c[0]);
    expect(
      warnMsgs.some((m: unknown) =>
        typeof m === "string" && m.includes("[ask-agent] mirror prompt webhook failed"),
      ),
    ).toBe(true);
  });

  it("mirror=true + target has no webhook → mirror skipped, ask still succeeds with response", async () => {
    const sendAsAgent = vi.fn();
    const dispatchTurn = vi.fn().mockResolvedValue("answer");
    const writeInbox = vi.fn().mockResolvedValue({ messageId: "msg-nw" });
    const deps = buildAskAgentDeps({
      runningAgents: ["fin"],
      dispatchTurn,
      writeInbox,
      webhookManager: {
        hasWebhook: () => false,
        sendAsAgent,
      },
    });
    const result = await handleAskAgentIpc(
      {
        from: "admin",
        to: "fin",
        content: "hi",
        mirror_to_target_channel: true,
      },
      deps,
    );
    expect(result.response).toBe("answer");
    expect(sendAsAgent).not.toHaveBeenCalled();
  });

  it("mirror=false (default) → no webhook calls regardless of hasWebhook", async () => {
    const sendAsAgent = vi.fn();
    const dispatchTurn = vi.fn().mockResolvedValue("answer");
    const writeInbox = vi.fn().mockResolvedValue({ messageId: "msg-nf" });
    const deps = buildAskAgentDeps({
      runningAgents: ["fin"],
      dispatchTurn,
      writeInbox,
      webhookManager: {
        hasWebhook: () => true,
        sendAsAgent,
      },
    });
    const result = await handleAskAgentIpc(
      { from: "admin", to: "fin", content: "hi" },
      deps,
    );
    expect(result.response).toBe("answer");
    expect(sendAsAgent).not.toHaveBeenCalled();
  });

  it("writeInbox is called BEFORE dispatch and any mirror webhook (offline-path inbox guarantee)", async () => {
    const sendAsAgent = vi.fn().mockResolvedValue(undefined);
    const dispatchTurn = vi.fn().mockResolvedValue("answer");
    const writeInbox = vi.fn().mockResolvedValue({ messageId: "msg-order" });
    const deps = buildAskAgentDeps({
      runningAgents: ["fin"],
      dispatchTurn,
      writeInbox,
      webhookManager: {
        hasWebhook: () => true,
        sendAsAgent,
      },
      configs: [{ name: "fin", webhook: { displayName: "Finance Bot" } }],
    });
    await handleAskAgentIpc(
      {
        from: "admin",
        to: "fin",
        content: "hi",
        mirror_to_target_channel: true,
      },
      deps,
    );

    const inboxOrder = writeInbox.mock.invocationCallOrder[0];
    const dispatchOrder = dispatchTurn.mock.invocationCallOrder[0];
    const preMirrorOrder = sendAsAgent.mock.invocationCallOrder[0];
    const postMirrorOrder = sendAsAgent.mock.invocationCallOrder[1];

    expect(inboxOrder).toBeLessThan(dispatchOrder);
    expect(inboxOrder).toBeLessThan(preMirrorOrder);
    expect(inboxOrder).toBeLessThan(postMirrorOrder);
  });
});
