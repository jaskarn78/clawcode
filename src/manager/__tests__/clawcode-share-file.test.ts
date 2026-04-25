/**
 * Phase 94 Plan 05 Task 1 — TDD RED for clawcode_share_file (TOOL-09 / D-09).
 *
 * The tool is auto-injected for every agent and turns the file-sharing
 * system-prompt directive (Plan 94-06) from prose into action: agents
 * stop emitting "see /home/clawcode/output.png" and instead upload to
 * Discord, returning the CDN URL the user can click.
 *
 * Test pins:
 *   SF-HAPPY          — happy share via webhook returns CDN URL + filename + sizeBytes
 *   SF-OVERSIZE       — 26MB file → ToolCallError(unknown) with suggestion mentioning 25MB
 *   SF-PATH-OUTSIDE   — /etc/passwd outside allowedRoots → ToolCallError(permission) "outside"
 *   SF-FILE-NOT-FOUND — stat ENOENT → ToolCallError with verbatim ENOENT message
 *   SF-FALLBACK       — webhook rejects, bot-direct succeeds → success with both calls in order
 *   SF-CAPTION        — input.caption flows through to the upload args verbatim
 */

import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import {
  clawcodeShareFile,
  DISCORD_FILE_SIZE_LIMIT,
} from "../tools/clawcode-share-file.js";
import type { ToolCallError } from "../tool-call-error.js";

const silentLog = pino({ level: "silent" });

const ALLOWED_ROOT = "/home/clawcode/agent/x";
const ALLOWED_PATH = "/home/clawcode/agent/x/out.png";

function makeDeps(overrides: Partial<{
  stat: (path: string) => Promise<{ size: number; isFile: boolean }>;
  sendViaWebhook: (channelId: string, file: { path: string; filename: string; caption?: string }) => Promise<{ url: string }>;
  sendViaBot: (channelId: string, file: { path: string; filename: string; caption?: string }) => Promise<{ url: string }>;
  currentChannelId: () => string | undefined;
  allowedRoots: readonly string[];
}> = {}) {
  return {
    allowedRoots: overrides.allowedRoots ?? [ALLOWED_ROOT],
    stat: overrides.stat ?? vi.fn(async (_path: string) => ({ size: 1024, isFile: true })),
    sendViaWebhook:
      overrides.sendViaWebhook ??
      vi.fn(async (_chan: string, _file: { path: string; filename: string; caption?: string }) => ({
        url: "https://cdn.discord/x",
      })),
    sendViaBot:
      overrides.sendViaBot ??
      vi.fn(async (_chan: string, _file: { path: string; filename: string; caption?: string }) => ({
        url: "https://cdn.discord/bot-direct",
      })),
    currentChannelId: overrides.currentChannelId ?? vi.fn(() => "channel-123"),
    log: silentLog,
  };
}

describe("clawcodeShareFile — TOOL-09 D-09", () => {
  it("SF-HAPPY: stat 1KB + webhook resolves → output.url is the CDN URL", async () => {
    const deps = makeDeps();
    const result = await clawcodeShareFile({ path: ALLOWED_PATH }, deps);

    if ("kind" in result && result.kind === "ToolCallError") {
      throw new Error(`expected success, got error: ${result.message}`);
    }
    expect(result.url).toBe("https://cdn.discord/x");
    expect(result.filename).toBe("out.png");
    expect(result.sizeBytes).toBe(1024);
    expect(deps.sendViaWebhook).toHaveBeenCalledTimes(1);
    expect(deps.sendViaBot).not.toHaveBeenCalled();
  });

  it("SF-OVERSIZE: 26MB file → ToolCallError(unknown) with suggestion mentioning 25MB", async () => {
    const oversize = 26 * 1024 * 1024;
    const deps = makeDeps({
      stat: vi.fn(async () => ({ size: oversize, isFile: true })),
    });
    const result = await clawcodeShareFile({ path: ALLOWED_PATH }, deps);

    expect("kind" in result).toBe(true);
    const err = result as ToolCallError;
    expect(err.kind).toBe("ToolCallError");
    expect(err.errorClass).toBe("unknown");
    // Suggestion must mention the 25MB limit so the LLM understands the boundary.
    const suggestion = err.suggestion ?? "";
    const messageOrSuggestion = `${suggestion} ${err.message}`;
    expect(/25\s*MB/i.test(messageOrSuggestion)).toBe(true);
    // Webhook + bot-direct must NOT have been called — fail-fast on size.
    expect(deps.sendViaWebhook).not.toHaveBeenCalled();
    expect(deps.sendViaBot).not.toHaveBeenCalled();
    // Sentinel: confirms our test references the 26 * 1024 * 1024 boundary.
    expect(oversize).toBeGreaterThan(DISCORD_FILE_SIZE_LIMIT);
  });

  it("SF-PATH-OUTSIDE: /etc/passwd outside allowedRoots → ToolCallError(permission) mentions 'outside'", async () => {
    const deps = makeDeps({
      allowedRoots: [ALLOWED_ROOT],
      stat: vi.fn(async () => ({ size: 100, isFile: true })),
    });
    const result = await clawcodeShareFile({ path: "/etc/passwd" }, deps);

    expect("kind" in result).toBe(true);
    const err = result as ToolCallError;
    expect(err.kind).toBe("ToolCallError");
    expect(err.errorClass).toBe("permission");
    expect(/outside|permission/i.test(err.message)).toBe(true);
    // Path validation MUST fail before any I/O — stat + webhook never invoked.
    expect(deps.stat).not.toHaveBeenCalled();
    expect(deps.sendViaWebhook).not.toHaveBeenCalled();
    expect(deps.sendViaBot).not.toHaveBeenCalled();
  });

  it("SF-FILE-NOT-FOUND: stat rejects with ENOENT → ToolCallError with verbatim message", async () => {
    const enoent = new Error(
      "ENOENT: no such file or directory, stat '/home/clawcode/agent/x/missing.png'",
    );
    const deps = makeDeps({
      stat: vi.fn(async () => {
        throw enoent;
      }),
    });
    const result = await clawcodeShareFile(
      { path: "/home/clawcode/agent/x/missing.png" },
      deps,
    );

    expect("kind" in result).toBe(true);
    const err = result as ToolCallError;
    expect(err.kind).toBe("ToolCallError");
    expect(err.message).toBe(enoent.message); // verbatim pass-through
  });

  it("SF-FALLBACK: webhook rejects once → bot-direct resolves → success; both called in order", async () => {
    const callOrder: string[] = [];
    const sendViaWebhook = vi.fn(async () => {
      callOrder.push("webhook");
      throw new Error("webhook 500 cloudflare");
    });
    const sendViaBot = vi.fn(async () => {
      callOrder.push("bot");
      return { url: "https://cdn.discord/via-bot" };
    });
    const deps = makeDeps({ sendViaWebhook, sendViaBot });

    const result = await clawcodeShareFile({ path: ALLOWED_PATH }, deps);

    if ("kind" in result && result.kind === "ToolCallError") {
      throw new Error(`expected fallback success, got error: ${result.message}`);
    }
    expect(result.url).toBe("https://cdn.discord/via-bot");
    expect(callOrder).toEqual(["webhook", "bot"]);
  });

  it("SF-CAPTION: input.caption flows through verbatim to the upload args", async () => {
    const sendViaWebhook = vi.fn(async () => ({ url: "https://cdn.discord/x" }));
    const deps = makeDeps({ sendViaWebhook });

    await clawcodeShareFile(
      { path: ALLOWED_PATH, caption: "my output" },
      deps,
    );

    expect(sendViaWebhook).toHaveBeenCalledTimes(1);
    const args = sendViaWebhook.mock.calls[0];
    const fileArg = args?.[1] as { caption?: string };
    expect(fileArg.caption).toBe("my output");
  });
});
