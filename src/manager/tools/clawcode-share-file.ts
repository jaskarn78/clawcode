/**
 * Phase 94 Plan 05 — TOOL-09 / D-09 auto-injected Discord file-share helper.
 *
 * The tool is auto-injected for every agent and turns the file-sharing
 * system-prompt directive (Plan 94-06) from prose into action: agents
 * stop emitting "see /home/clawcode/output.png" and instead upload to
 * Discord, returning the CDN URL the user can click.
 *
 * DI-pure module. No fs imports, no discord.js imports, no clock
 * construction. Path resolution uses node:path (pure string ops, no I/O).
 * Production wires:
 *   - allowedRoots → [agent.workspacePath, agent.memoryPath].filter(Boolean)
 *   - sendViaWebhook → webhook-manager (Phase 1.6)
 *   - sendViaBot → bot-direct fallback (Phase 90.1) — used when webhook
 *     fails or admin-clawdy / untrusted channels lack webhooks
 *   - currentChannelId → derived from current TurnDispatcher origin
 *   - stat → fs.promises.stat mapped to {size, isFile}
 *
 * Security boundary: path validation refuses anything outside
 * allowedRoots. Without this gate, a bad-actor LLM could pipe
 * /etc/passwd through Discord. allowedRoots is the only acceptable
 * upload surface.
 *
 * Discord 25MB free-tier upload cap is enforced. Higher caps require
 * Nitro per-channel (outside the bot's control).
 *
 * Internal failures wrap via Plan 94-04 wrapMcpToolError.
 */

import { resolve, sep, basename } from "node:path";
import type { Logger } from "pino";
import { wrapMcpToolError, type ToolCallError } from "../tool-call-error.js";

export interface ShareFileInput {
  readonly path: string;
  readonly caption?: string;
}

export interface ShareFileOutput {
  /** Discord CDN URL the user can click. */
  readonly url: string;
  readonly filename: string;
  readonly sizeBytes: number;
}

export interface ShareFileDeps {
  /**
   * Allowed upload roots — paths must resolve to a location inside one
   * of these (security boundary). Production wires
   * [agent.workspacePath, agent.memoryPath].
   */
  readonly allowedRoots: readonly string[];
  /** Phase 1.6 webhook upload surface — primary path. */
  readonly sendViaWebhook: (
    channelId: string,
    file: { path: string; filename: string; caption?: string },
  ) => Promise<{ url: string }>;
  /** Phase 90.1 bot-direct upload — fallback when webhook fails. */
  readonly sendViaBot: (
    channelId: string,
    file: { path: string; filename: string; caption?: string },
  ) => Promise<{ url: string }>;
  /**
   * Inferred from the current dispatch context (TurnDispatcher origin).
   * Returns undefined when the agent is not currently bound to a
   * channel — the tool refuses with a structured error so the LLM
   * surfaces the missing context.
   */
  readonly currentChannelId: () => string | undefined;
  /** Stat indirection — DI-pure (no fs imports in this module). */
  readonly stat: (path: string) => Promise<{ size: number; isFile: boolean }>;
  readonly log: Logger;
}

/**
 * Discord free-tier upload cap. Higher caps require Nitro per-channel.
 * Pinned by static-grep regression test.
 */
export const DISCORD_FILE_SIZE_LIMIT = 25 * 1024 * 1024;

/**
 * Tool definition shape. NO mcpServer attribution: built-in helper, so
 * the Plan 94-02 capability-probe filter never removes it.
 *
 * The example path '/home/clawcode/...' below appears as a NEGATIVE
 * pattern — the directive instructs agents NOT to surface those raw
 * paths to the user; instead, call this tool to get a CDN URL.
 */
export const CLAWCODE_SHARE_FILE_DEF = {
  name: "clawcode_share_file",
  description:
    "Upload a file from the agent's workspace to the Discord channel/thread the agent is currently answering in. " +
    "Returns the CDN URL the user can click. " +
    "Use this WHENEVER the user wants a file — never tell the user a local path " +
    "(e.g. /home/clawcode/...). " +
    "Path must be absolute and inside the agent's workspace or memory directory.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path inside agent workspace or memoryPath",
      },
      caption: {
        type: "string",
        description: "Optional caption sent alongside the file",
      },
    },
    required: ["path"],
  },
} as const;

/**
 * Pure path-validation: returns true iff `absPath` is the same as a
 * resolved allowedRoot OR sits below it (using OS path separator).
 *
 * No I/O. Resolves each root once per call (handles ~ expansion +
 * relative root paths in tests).
 */
function isPathInsideRoots(
  absPath: string,
  allowedRoots: readonly string[],
): boolean {
  for (const root of allowedRoots) {
    const normRoot = resolve(root);
    if (absPath === normRoot) return true;
    if (absPath.startsWith(normRoot + sep)) return true;
  }
  return false;
}

/**
 * Build the suggestion factory for the oversize error so the
 * ToolCallError carries a 25MB-aware hint the LLM can surface to the
 * user instead of silent failure.
 */
function oversizeSuggestionFor(sizeMb: string) {
  return () =>
    `File is ${sizeMb} MB, which exceeds the Discord 25MB upload limit. ` +
    `Consider compressing the file (e.g. an image at lower resolution / a video " +
"re-encoded with lower bitrate) or uploading it to a different host.`;
}

/**
 * Pure handler. Always returns a value — never throws (LLM tool-result
 * contract). Failures wrap via Plan 94-04 wrapMcpToolError.
 *
 * Order:
 *   1. Path validation (no I/O cost paid for refused paths)
 *   2. stat → filesize check (fail-fast on oversize)
 *   3. currentChannelId resolved (refuse with structured error if absent)
 *   4. webhook upload → on failure → bot-direct fallback → on failure → wrap
 */
export async function clawcodeShareFile(
  input: ShareFileInput,
  deps: ShareFileDeps,
): Promise<ShareFileOutput | ToolCallError> {
  const absPath = resolve(input.path);

  // 1. Security boundary — refuse paths outside allowedRoots BEFORE any I/O.
  if (!isPathInsideRoots(absPath, deps.allowedRoots)) {
    return wrapMcpToolError(
      new Error(
        `Path ${absPath} is outside the agent workspace; refused by clawcode_share_file (permission denied)`,
      ),
      { tool: CLAWCODE_SHARE_FILE_DEF.name },
    );
  }

  // 2. Stat — file must exist and be a regular file.
  let stat: { size: number; isFile: boolean };
  try {
    stat = await deps.stat(absPath);
  } catch (err) {
    return wrapMcpToolError(err as Error | string, {
      tool: CLAWCODE_SHARE_FILE_DEF.name,
    });
  }

  if (!stat.isFile) {
    return wrapMcpToolError(
      new Error(`${absPath} is not a regular file`),
      { tool: CLAWCODE_SHARE_FILE_DEF.name },
    );
  }

  // 3. Discord 25MB cap.
  if (stat.size > DISCORD_FILE_SIZE_LIMIT) {
    const sizeMb = (stat.size / 1024 / 1024).toFixed(1);
    return wrapMcpToolError(
      new Error(
        `File ${basename(absPath)} is ${sizeMb} MB; exceeds the Discord 25MB upload limit`,
      ),
      {
        tool: CLAWCODE_SHARE_FILE_DEF.name,
        suggestionFor: oversizeSuggestionFor(sizeMb),
      },
    );
  }

  // 4. Current channel must be known — agent must be inside a dispatch context.
  const channelId = deps.currentChannelId();
  if (!channelId) {
    return wrapMcpToolError(
      new Error(
        "no current channel — clawcode_share_file requires an active Discord dispatch context to determine the upload destination",
      ),
      { tool: CLAWCODE_SHARE_FILE_DEF.name },
    );
  }

  const filename = basename(absPath);
  const fileArg = {
    path: absPath,
    filename,
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
  };

  // 5. Webhook → bot-direct fallback (Phase 90.1).
  try {
    const result = await deps.sendViaWebhook(channelId, fileArg);
    return Object.freeze({
      url: result.url,
      filename,
      sizeBytes: stat.size,
    });
  } catch (webhookErr) {
    // Best-effort log; never break the wrap path.
    try {
      deps.log.warn(
        { err: (webhookErr as Error)?.message, tool: CLAWCODE_SHARE_FILE_DEF.name },
        "webhook send failed; falling back to bot-direct",
      );
    } catch {
      // Logger threw — swallow.
    }
    try {
      const result = await deps.sendViaBot(channelId, fileArg);
      return Object.freeze({
        url: result.url,
        filename,
        sizeBytes: stat.size,
      });
    } catch (botErr) {
      return wrapMcpToolError(botErr as Error | string, {
        tool: CLAWCODE_SHARE_FILE_DEF.name,
      });
    }
  }
}
