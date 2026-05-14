/**
 * Quick 260511-pw2 — sentinel + behavior tests for the post-to-agent IPC
 * handler.
 *
 * Anti-pattern guard (feedback_silent_path_bifurcation.md):
 *   The reason-tagged "post-to-agent skipped" logs are observable only by
 *   absence. A grep-only test would have shipped Phase 115-08 green. These
 *   tests are FUNCTIONAL sentinels — they invoke handlePostToAgentIpc
 *   with synthesized failure conditions and assert each reason tag fires
 *   with the documented log message.
 *
 *   The static-grep sentinel below (Sentinel A) ALSO pins the production
 *   caller chain: `case "post-to-agent":` in daemon.ts must `await import`
 *   the handler so a future refactor cannot silently bifurcate the path
 *   (e.g., land logging on a function the daemon never calls).
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  handlePostToAgentIpc,
  type PostToAgentDeps,
} from "../daemon-post-to-agent-ipc.js";
import {
  _resetNoWebhookFallbacks,
  snapshotNoWebhookFallbacks,
} from "../fleet-stats.js";

// ---------------------------------------------------------------------------
// Test fixture builders
// ---------------------------------------------------------------------------

function makeLog() {
  const calls: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const record = (obj: unknown, msg: unknown) => {
    calls.push({
      obj: obj as Record<string, unknown>,
      msg: String(msg),
    });
  };
  return {
    log: {
      info: record,
      warn: record,
      error: record,
    },
    calls,
  };
}

function makeDeps(overrides: Partial<PostToAgentDeps> = {}): {
  deps: PostToAgentDeps;
  calls: ReturnType<typeof makeLog>["calls"];
  writeInbox: ReturnType<typeof vi.fn>;
  sendAsAgent: ReturnType<typeof vi.fn>;
} {
  const writeInbox = vi.fn().mockResolvedValue({ messageId: "inbox-msg-1" });
  const sendAsAgent = vi.fn().mockResolvedValue("webhook-msg-1");
  const { log, calls } = makeLog();
  const deps: PostToAgentDeps = {
    runningAgents: ["projects"],
    configs: [
      {
        name: "admin-clawdy",
        memoryPath: "/tmp/admin-clawdy",
        webhook: { displayName: "Admin Clawdy" },
      },
      {
        name: "projects",
        memoryPath: "/tmp/projects",
        webhook: { displayName: "Projects" },
      },
    ],
    agentChannels: new Map([["projects", ["chan-1"]]]),
    webhookManager: {
      hasWebhook: () => true,
      sendAsAgent,
    },
    writeInbox,
    log,
    ...overrides,
  };
  return { deps, calls, writeInbox, sendAsAgent };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("handlePostToAgentIpc — happy path", () => {
  it("delivers via webhook when target has channels + webhook + is reachable", async () => {
    const { deps, calls, writeInbox, sendAsAgent } = makeDeps();
    const result = await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "hi" },
      deps,
    );
    expect(result).toEqual({
      ok: true,
      delivered: true,
      messageId: "inbox-msg-1",
    });
    expect(writeInbox).toHaveBeenCalledTimes(1);
    expect(sendAsAgent).toHaveBeenCalledTimes(1);
    // No skipped logs on the happy path.
    expect(calls.filter((c) => c.msg === "post-to-agent skipped")).toHaveLength(
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// Skip path 1: target-not-found (throws — validation contract preserved)
// ---------------------------------------------------------------------------

describe("handlePostToAgentIpc — target-not-found", () => {
  it("throws ManagerError AND logs reason=target-not-found", async () => {
    const { deps, calls } = makeDeps({ configs: [] });
    await expect(
      handlePostToAgentIpc(
        { from: "admin-clawdy", to: "nobody", message: "x" },
        deps,
      ),
    ).rejects.toThrow(/Target agent 'nobody' not found/);
    const hit = calls.find(
      (c) =>
        c.msg === "post-to-agent skipped" &&
        c.obj["reason"] === "target-not-found",
    );
    expect(hit).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Skip path 2: inbox-write-failed (throws — floor of delivery contract)
// ---------------------------------------------------------------------------

describe("handlePostToAgentIpc — inbox-write-failed", () => {
  it("throws ManagerError AND logs reason=inbox-write-failed", async () => {
    const writeInbox = vi.fn().mockRejectedValue(new Error("EACCES /tmp"));
    const { deps, calls } = makeDeps({ writeInbox });
    await expect(
      handlePostToAgentIpc(
        { from: "admin-clawdy", to: "projects", message: "x" },
        deps,
      ),
    ).rejects.toThrow(/Inbox write failed/);
    const hit = calls.find(
      (c) =>
        c.msg === "post-to-agent skipped" &&
        c.obj["reason"] === "inbox-write-failed",
    );
    expect(hit).toBeDefined();
    expect(hit?.obj["error"]).toBe("EACCES /tmp");
  });
});

// ---------------------------------------------------------------------------
// Skip path 3: no-target-channels (inbox-only)
// ---------------------------------------------------------------------------

describe("handlePostToAgentIpc — no-target-channels", () => {
  it("returns inbox-only AND logs reason=no-target-channels", async () => {
    const { deps, calls, sendAsAgent } = makeDeps({
      agentChannels: new Map(), // empty routing
    });
    const result = await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    expect(result).toEqual({
      ok: true,
      delivered: false,
      messageId: "inbox-msg-1",
      reason: "no-target-channels",
    });
    expect(sendAsAgent).not.toHaveBeenCalled();
    const hit = calls.find(
      (c) =>
        c.msg === "post-to-agent skipped" &&
        c.obj["reason"] === "no-target-channels",
    );
    expect(hit).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Skip path 4: no-webhook (inbox-only)
// ---------------------------------------------------------------------------

describe("handlePostToAgentIpc — no-webhook", () => {
  it("returns inbox-only AND logs reason=no-webhook", async () => {
    const { deps, calls, sendAsAgent } = makeDeps({
      webhookManager: { hasWebhook: () => false, sendAsAgent: vi.fn() },
    });
    const result = await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("no-webhook");
    expect(sendAsAgent).not.toHaveBeenCalled();
    const hit = calls.find(
      (c) =>
        c.msg === "post-to-agent skipped" && c.obj["reason"] === "no-webhook",
    );
    expect(hit).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Skip path 5: webhook-send-failed (inbox-only)
// ---------------------------------------------------------------------------

describe("handlePostToAgentIpc — webhook-send-failed", () => {
  it("returns inbox-only AND logs reason=webhook-send-failed when sendAsAgent throws", async () => {
    const sendAsAgent = vi.fn().mockRejectedValue(new Error("Discord 503"));
    const { deps, calls } = makeDeps({
      webhookManager: { hasWebhook: () => true, sendAsAgent },
    });
    const result = await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("webhook-send-failed");
    const hit = calls.find(
      (c) =>
        c.msg === "post-to-agent skipped" &&
        c.obj["reason"] === "webhook-send-failed",
    );
    expect(hit).toBeDefined();
    expect(hit?.obj["error"]).toBe("Discord 503");
  });
});

// ---------------------------------------------------------------------------
// Skip path 6: target-not-running (secondary log when webhook also failed)
// ---------------------------------------------------------------------------

describe("handlePostToAgentIpc — target-not-running secondary log", () => {
  it("logs reason=target-not-running in addition to the primary reason when target offline", async () => {
    const { deps, calls } = makeDeps({
      runningAgents: [], // target offline
      webhookManager: { hasWebhook: () => false, sendAsAgent: vi.fn() },
    });
    const result = await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("no-webhook");
    // Primary skip log
    const primary = calls.find((c) => c.obj["reason"] === "no-webhook");
    expect(primary).toBeDefined();
    // Secondary skip log — operator visibility for "inbox written but
    // heartbeat reconciler can't dispatch a turn to a dead process".
    const secondary = calls.find(
      (c) => c.obj["reason"] === "target-not-running",
    );
    expect(secondary).toBeDefined();
    expect(secondary?.obj["primaryReason"]).toBe("no-webhook");
  });

  it("does NOT log target-not-running when target IS running", async () => {
    const { deps, calls } = makeDeps({
      runningAgents: ["projects"],
      webhookManager: { hasWebhook: () => false, sendAsAgent: vi.fn() },
    });
    await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    const secondary = calls.find(
      (c) => c.obj["reason"] === "target-not-running",
    );
    expect(secondary).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 119 A2A-01 — bot-direct fallback rung (mirrors daemon-ask-agent-ipc.ts
// IPC-02 pattern). Inserts between the no-webhook skip and the inbox-only
// return: when there is no webhook AND a channel is bound for the target AND
// botDirectSender is wired, dispatch via the bot client and return delivered.
// ---------------------------------------------------------------------------

describe("handlePostToAgentIpc — bot-direct fallback (A2A-01)", () => {
  it("delivers via botDirectSender when no webhook + bound channel + sender wired", async () => {
    const sendText = vi.fn().mockResolvedValue(undefined);
    const { deps, calls, sendAsAgent } = makeDeps({
      webhookManager: { hasWebhook: () => false, sendAsAgent: vi.fn() },
      botDirectSender: { sendText },
    });
    const result = await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "hello" },
      deps,
    );
    expect(result).toEqual({
      ok: true,
      delivered: true,
      messageId: "inbox-msg-1",
    });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("chan-1", "hello");
    expect(sendAsAgent).not.toHaveBeenCalled();
    const hit = calls.find(
      (c) =>
        c.msg === "[A2A-01] bot-direct dispatch" &&
        c.obj["agent"] === "projects" &&
        c.obj["channel"] === "chan-1" &&
        c.obj["reason"] === "bot-direct-fallback",
    );
    expect(hit).toBeDefined();
  });

  it("falls through to inbox when botDirectSender throws", async () => {
    const sendText = vi.fn().mockRejectedValue(new Error("Discord 500"));
    const { deps } = makeDeps({
      webhookManager: { hasWebhook: () => false, sendAsAgent: vi.fn() },
      botDirectSender: { sendText },
    });
    const result = await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("no-webhook");
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("does NOT call botDirectSender when no bound channel — falls through to inbox", async () => {
    const sendText = vi.fn();
    const { deps } = makeDeps({
      webhookManager: { hasWebhook: () => false, sendAsAgent: vi.fn() },
      botDirectSender: { sendText },
      agentChannels: new Map([["projects", []]]),
    });
    const result = await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("no-target-channels");
    expect(sendText).not.toHaveBeenCalled();
  });

  it("does NOT call botDirectSender when webhook IS present (webhook path wins)", async () => {
    const sendText = vi.fn();
    const sendAsAgent = vi.fn().mockResolvedValue("ok");
    const { deps } = makeDeps({
      webhookManager: { hasWebhook: () => true, sendAsAgent },
      botDirectSender: { sendText },
    });
    const result = await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    expect(result.delivered).toBe(true);
    expect(sendAsAgent).toHaveBeenCalledTimes(1);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("does NOT attempt bot-direct when botDirectSender is unwired (undefined)", async () => {
    const { deps, sendAsAgent } = makeDeps({
      webhookManager: { hasWebhook: () => false, sendAsAgent: vi.fn() },
    });
    const result = await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("no-webhook");
    expect(sendAsAgent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sentinel A — static grep that pins the production caller chain.
//
// Asserts:
//   1. daemon.ts `case "post-to-agent":` body dynamically imports the new
//      handler. Without this, future refactors could silently bifurcate the
//      path (Phase 115-08 anti-pattern).
//   2. The handler module emits all six reason tags. Without this, a future
//      refactor could remove a log line and the diagnostic surface degrades
//      silently.
// ---------------------------------------------------------------------------

describe("Sentinel A — production caller chain pinned", () => {
  const repoRoot = join(__dirname, "..", "..", "..");
  const daemonSrc = readFileSync(
    join(repoRoot, "src/manager/daemon.ts"),
    "utf8",
  );
  const handlerSrc = readFileSync(
    join(repoRoot, "src/manager/daemon-post-to-agent-ipc.ts"),
    "utf8",
  );

  it("daemon.ts case post-to-agent imports daemon-post-to-agent-ipc.js", () => {
    // Grep for the dynamic import in the post-to-agent case body. The
    // `case "post-to-agent":` block must reach the new handler — anything
    // else is a silent-path bifurcation.
    expect(daemonSrc).toMatch(
      /case "post-to-agent":[\s\S]*?await import\(["']\.\/daemon-post-to-agent-ipc\.js["']\)/,
    );
  });

  it("handler emits all six reason tags", () => {
    const required = [
      "target-not-found",
      "inbox-write-failed",
      "no-target-channels",
      "no-webhook",
      "webhook-send-failed",
      "target-not-running",
    ];
    for (const reason of required) {
      expect(handlerSrc).toContain(`"${reason}"`);
    }
    // All log messages use the SAME substrate string so operators can grep
    // ONE phrase to inventory every skip.
    const skippedCount = (
      handlerSrc.match(/"post-to-agent skipped"/g) ?? []
    ).length;
    expect(skippedCount).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// Phase 119 D-05 — no-webhook-fallback counter wiring.
//
// Two call sites in the handler. Bot-direct success increments once; inbox-
// only return with a resolved channel increments once. Webhook success does
// NOT increment. Bot-direct success does NOT also fire the inbox path
// (no double-counting).
// ---------------------------------------------------------------------------
describe("handlePostToAgentIpc — no_webhook_fallbacks_total counter (D-05)", () => {
  beforeEach(() => {
    _resetNoWebhookFallbacks();
  });

  it("bot-direct success increments counter exactly once for (agent, channel)", async () => {
    const sendText = vi.fn().mockResolvedValue(undefined);
    const { deps } = makeDeps({
      webhookManager: { hasWebhook: () => false, sendAsAgent: vi.fn() },
      botDirectSender: { sendText },
    });
    await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "hi" },
      deps,
    );
    const snap = snapshotNoWebhookFallbacks();
    expect(snap["projects:chan-1"]).toBe(1);
    // Bot-direct success means inbox-only path NOT entered — no double-count.
    expect(Object.values(snap).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("bot-direct sendText throws → falls through to inbox; counter increments exactly ONCE (no double-count)", async () => {
    const sendText = vi.fn().mockRejectedValue(new Error("Discord 500"));
    const { deps } = makeDeps({
      webhookManager: { hasWebhook: () => false, sendAsAgent: vi.fn() },
      botDirectSender: { sendText },
    });
    await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    const snap = snapshotNoWebhookFallbacks();
    expect(snap["projects:chan-1"]).toBe(1);
    expect(Object.values(snap).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("no-webhook + no botDirectSender → inbox-only path increments counter once", async () => {
    const { deps } = makeDeps({
      webhookManager: { hasWebhook: () => false, sendAsAgent: vi.fn() },
    });
    await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    const snap = snapshotNoWebhookFallbacks();
    expect(snap["projects:chan-1"]).toBe(1);
  });

  it("webhook-send-failed → inbox-only path increments counter once", async () => {
    const sendAsAgent = vi.fn().mockRejectedValue(new Error("Discord 503"));
    const { deps } = makeDeps({
      webhookManager: { hasWebhook: () => true, sendAsAgent },
    });
    await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    const snap = snapshotNoWebhookFallbacks();
    expect(snap["projects:chan-1"]).toBe(1);
  });

  it("webhook success does NOT increment counter", async () => {
    const { deps } = makeDeps();
    await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    const snap = snapshotNoWebhookFallbacks();
    expect(Object.keys(snap)).toHaveLength(0);
  });

  it("no-target-channels → inbox-only path with no channelId; counter NOT incremented (channelId absent)", async () => {
    const { deps } = makeDeps({
      agentChannels: new Map(), // no channels resolved
    });
    await handlePostToAgentIpc(
      { from: "admin-clawdy", to: "projects", message: "x" },
      deps,
    );
    const snap = snapshotNoWebhookFallbacks();
    // No channel resolvable → counter would key on empty string. Skip
    // increment when channelId is undefined (counter measures fallbacks
    // per channel; a request with no resolvable channel can't have one).
    expect(Object.keys(snap)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sentinel B — silent-path-bifurcation guard for the counter call sites.
//
// The counter call lives at exactly TWO sites in daemon-post-to-agent-ipc.ts:
//   1. bot-direct rung success branch
//   2. inboxOnlyResponse helper body
// A future refactor that adds a third increment site or removes one breaks
// the D-05 contract (over/under-counting on the dashboard tile). Pin the
// count to exactly 2 so the regression surfaces in CI, not in production.
// ---------------------------------------------------------------------------
describe("Sentinel B — incrementNoWebhookFallback call-site count pinned", () => {
  const repoRoot = join(__dirname, "..", "..", "..");
  const handlerSrc = readFileSync(
    join(repoRoot, "src/manager/daemon-post-to-agent-ipc.ts"),
    "utf8",
  );
  it("daemon-post-to-agent-ipc.ts has exactly 2 incrementNoWebhookFallback call sites", () => {
    const calls = (
      handlerSrc.match(/incrementNoWebhookFallback\(/g) ?? []
    ).length;
    expect(calls).toBe(2);
  });
  it("handler imports the counter helper from fleet-stats", () => {
    expect(handlerSrc).toMatch(
      /from\s+["']\.\/fleet-stats\.js["']|import\s+\{[^}]*incrementNoWebhookFallback/,
    );
  });
});
