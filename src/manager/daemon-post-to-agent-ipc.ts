/**
 * Quick 260511-pw2 — daemon `post-to-agent` IPC handler (pure-DI).
 *
 * Extracted from `src/manager/daemon.ts` `case "post-to-agent":` body so the
 * fire-and-forget delivery contract can be exercised without spawning the full
 * daemon. Mirrors the Phase 999.2 Plan 03 `daemon-ask-agent-ipc.ts` blueprint.
 *
 * Background — why this module exists today:
 *
 *   Admin Clawdy observed (2026-05-11 Discord) that messages sent via
 *   `post_to_agent` to the Projects agent appeared to vanish — no error
 *   surfaced to the sender's LLM, no Discord embed reached the recipient's
 *   channel, and the returned id was opaque (looked task-shaped, but
 *   `task_status` returned "not found" because nanoid post-ids are a
 *   different system from delegate-task ids). Three failure modes compound:
 *
 *     1. Recipient has no Discord webhook configured  → inbox-only delivery.
 *     2. Recipient agent not running (process not up)  → inbox written, but
 *        the InboxSource watcher / heartbeat reconciler can't dispatch a
 *        turn to a dead process.
 *     3. Recipient has no channels in the routing table → webhook can't
 *        target anything.
 *
 *   Pre-2026-05-11 the daemon caught the webhook failure and logged a
 *   `console.warn` then returned `{ delivered: false, messageId }` to the
 *   caller. The MCP wrapper then rendered that as `"Message queued for X
 *   (id: <nanoid>)"`, which the sender's LLM interpreted as a queryable
 *   task id. The post-id-looks-task-shaped confusion is the *user-visible*
 *   half of the silent-drop class of bug described in:
 *     ~/.claude/projects/.../memory/feedback_silent_path_bifurcation.md
 *
 * Contract this module enforces:
 *
 *   ALL six silent-return / silent-catch points emit a structured
 *   `"post-to-agent skipped"` pino info log with a `reason` tag. Reasons:
 *
 *     - "target-not-found"        target name absent from configs
 *     - "inbox-write-failed"      writeMessage threw (disk / permissions)
 *     - "no-target-channels"      routing table has no channel for target
 *     - "no-webhook"              target has no webhook identity
 *     - "webhook-send-failed"     webhookManager.sendAsAgent threw
 *     - "target-not-running"      target not in runningAgents — best-effort
 *                                 heartbeat reconciler delivery only
 *
 *   The return shape preserves backward compat (`{ delivered, messageId }`)
 *   but adds two new fields:
 *
 *     - `ok: boolean`             true iff inbox-write succeeded
 *     - `reason?: string`         present iff `delivered=false`; one of the
 *                                 reason tags above
 *
 *   Errors propagate. The only failure that throws is `target-not-found`
 *   (validation; matches pre-existing behavior). Webhook + routing failures
 *   degrade to inbox-only with `delivered=false, reason=...` because the
 *   inbox path is the canonical fallback (heartbeat inbox check drains it
 *   for every agent fleet-wide — see src/heartbeat/checks/inbox.ts).
 *
 *   The MCP wrapper at src/mcp/server.ts:postToAgentHandler reads `reason`
 *   and renders explicit text so the sender's LLM can NEVER mistake the
 *   inbox id for a queryable task id.
 */

import type { EmbedBuilder } from "discord.js";
import { ManagerError } from "../shared/errors.js";
import { buildAgentMessageEmbed } from "../discord/agent-message.js";

/** Reason discriminator surfaced in `reason` on the response. */
export type PostToAgentSkipReason =
  | "target-not-found"
  | "inbox-write-failed"
  | "no-target-channels"
  | "no-webhook"
  | "webhook-send-failed"
  | "target-not-running";

/** Minimal config shape consumed by the handler. */
export type PostToAgentAgentConfigLike = Readonly<{
  name: string;
  memoryPath: string;
  webhook?: Readonly<{
    displayName: string;
    avatarUrl?: string;
    webhookUrl?: string;
  }>;
  /**
   * Phase 119 A2A-01 — bound channel IDs. Mirrors daemon-ask-agent-ipc.ts:53.
   * Used as the bot-direct fallback channel resolver when the routing-table
   * snapshot has no binding.
   */
  channels?: readonly string[];
}>;

/** Minimal pino-like logger surface. */
export type PostToAgentLogger = Readonly<{
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}>;

/** Minimal WebhookManager surface. */
export type PostToAgentWebhookManagerLike = Readonly<{
  hasWebhook(agentName: string): boolean;
  sendAsAgent(
    targetAgent: string,
    senderDisplayName: string,
    senderAvatarUrl: string | undefined,
    embed: EmbedBuilder,
  ): Promise<string | void>;
}>;

/** Inbox-write closure (production wraps writeMessage + createMessage). */
export type PostToAgentInboxWriter = (params: {
  from: string;
  to: string;
  content: string;
}) => Promise<{ messageId: string }>;

export type PostToAgentDeps = Readonly<{
  runningAgents: readonly string[];
  configs: readonly PostToAgentAgentConfigLike[];
  agentChannels: ReadonlyMap<string, readonly string[]>;
  webhookManager: PostToAgentWebhookManagerLike;
  writeInbox: PostToAgentInboxWriter;
  log: PostToAgentLogger;
  /**
   * Phase 119 A2A-01 — optional bot-direct sender. Mirrors the
   * daemon-ask-agent-ipc.ts:104 shape verbatim per D-01. When set AND the
   * target has no webhook AND a channel is bound, the handler dispatches
   * the message via the bot client instead of falling straight through to
   * the inbox-heartbeat path. Unwired in pre-bridge boot windows — when
   * undefined the no-webhook path retains its prior inbox-only behavior.
   */
  botDirectSender?: { sendText(channelId: string, text: string): Promise<void> };
}>;

export type PostToAgentRequest = Readonly<{
  from: string;
  to: string;
  message: string;
}>;

export type PostToAgentResponse = Readonly<{
  ok: boolean;
  delivered: boolean;
  messageId: string;
  reason?: PostToAgentSkipReason;
}>;

/**
 * Execute the post-to-agent IPC contract.
 *
 * Throws `ManagerError("Target agent 'X' not found")` when validation fails
 * — matches pre-extraction behavior so existing callers stay green.
 *
 * For every other skip path returns `{ ok: true, delivered: false, reason }`
 * after writing to the inbox (so the heartbeat reconciler can still deliver).
 */
export async function handlePostToAgentIpc(
  req: PostToAgentRequest,
  deps: PostToAgentDeps,
): Promise<PostToAgentResponse> {
  const { from, to, message } = req;

  // 1. Validate target — fail loud (existing contract).
  const targetConfig = deps.configs.find((c) => c.name === to);
  if (!targetConfig) {
    deps.log.info(
      { from, to, reason: "target-not-found" satisfies PostToAgentSkipReason },
      "post-to-agent skipped",
    );
    throw new ManagerError(`Target agent '${to}' not found`);
  }

  // 2. Inbox-write first — the canonical fallback. Heartbeat reconciler
  //    (src/heartbeat/checks/inbox.ts) drains this for every agent so the
  //    message still lands eventually even when webhook delivery fails.
  let messageId: string;
  try {
    const written = await deps.writeInbox({ from, to, content: message });
    messageId = written.messageId;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    deps.log.warn(
      {
        from,
        to,
        reason: "inbox-write-failed" satisfies PostToAgentSkipReason,
        error: errMsg,
      },
      "post-to-agent skipped",
    );
    // Throw — inbox write is the floor of the delivery contract. If we
    // can't even write the inbox file we have nothing to return.
    throw new ManagerError(`Inbox write failed for '${to}': ${errMsg}`);
  }

  // 3. Webhook delivery — best-effort. Each silent-skip emits a structured
  //    log with `reason`.
  const targetChannels = deps.agentChannels.get(to);
  if (!targetChannels || targetChannels.length === 0) {
    deps.log.info(
      { from, to, messageId, reason: "no-target-channels" satisfies PostToAgentSkipReason },
      "post-to-agent skipped",
    );
    return inboxOnlyResponse(messageId, "no-target-channels", deps, from, to);
  }

  if (!deps.webhookManager.hasWebhook(to)) {
    // Phase 119 A2A-01 — bot-direct fallback rung (mirror of
    // daemon-ask-agent-ipc.ts:262-299 per D-01). Attempts plain-text
    // delivery via the bot client BEFORE falling through to the inbox-
    // heartbeat path. On success returns delivered=true; on send failure
    // or no resolved channel, falls through to inboxOnlyResponse.
    if (deps.botDirectSender) {
      const channelId =
        deps.agentChannels.get(to)?.[0] ??
        deps.configs.find((c) => c.name === to)?.channels?.[0];
      if (channelId) {
        try {
          await deps.botDirectSender.sendText(channelId, message);
          deps.log.info(
            {
              agent: to,
              channel: channelId,
              reason: "bot-direct-fallback",
            },
            "[A2A-01] bot-direct dispatch",
          );
          return { ok: true, delivered: true, messageId };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          deps.log.warn(
            { from, to, channelId, error: errMsg },
            "[A2A-01] bot-direct dispatch failed (falling through to inbox)",
          );
        }
      }
    }
    deps.log.info(
      { from, to, messageId, reason: "no-webhook" satisfies PostToAgentSkipReason },
      "post-to-agent skipped",
    );
    return inboxOnlyResponse(messageId, "no-webhook", deps, from, to);
  }

  const senderConfig = deps.configs.find((c) => c.name === from);
  const senderDisplayName = senderConfig?.webhook?.displayName ?? from;
  const senderAvatarUrl = senderConfig?.webhook?.avatarUrl;
  const embed = buildAgentMessageEmbed(from, senderDisplayName, message);

  try {
    await deps.webhookManager.sendAsAgent(
      to,
      senderDisplayName,
      senderAvatarUrl,
      embed,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    deps.log.warn(
      {
        from,
        to,
        messageId,
        reason: "webhook-send-failed" satisfies PostToAgentSkipReason,
        error: errMsg,
      },
      "post-to-agent skipped",
    );
    return inboxOnlyResponse(messageId, "webhook-send-failed", deps, from, to);
  }

  return { ok: true, delivered: true, messageId };
}

/**
 * Build the "inbox-only" return shape AND log the optional second-degree
 * skip reason: `target-not-running`. Heartbeat reconciler can't dispatch a
 * turn to a stopped process, so when both webhook is unreachable AND the
 * agent is offline we surface that secondary reason for operator visibility.
 */
function inboxOnlyResponse(
  messageId: string,
  reason: PostToAgentSkipReason,
  deps: PostToAgentDeps,
  from: string,
  to: string,
): PostToAgentResponse {
  if (!deps.runningAgents.includes(to)) {
    deps.log.info(
      {
        from,
        to,
        messageId,
        reason: "target-not-running" satisfies PostToAgentSkipReason,
        primaryReason: reason,
      },
      "post-to-agent skipped",
    );
  }
  return { ok: true, delivered: false, messageId, reason };
}
