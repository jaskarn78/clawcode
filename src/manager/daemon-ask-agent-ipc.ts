/**
 * Phase 999.2 Plan 03 — daemon `ask-agent` IPC handler (pure-DI).
 *
 * Extracted from `src/manager/daemon.ts` `case "ask-agent":` body so the v2
 * sync-reply contract can be exercised without spawning the full daemon.
 * Mirrors the Phase 103 daemon-rate-limit-ipc.ts blueprint and the Phase 96
 * daemon-fs-ipc.ts shape.
 *
 * Behavior contract (D-SYN-01..06, D-PST-03):
 *   1. ALWAYS write inbox first (preserves offline-path inbox guarantee).
 *   2. If target is NOT running → return {ok: true, messageId, response: undef}.
 *      MCP wrapper renders explicit-offline text. (A2A-12)
 *   3. If mirror_to_target_channel=true AND target has a webhook → post a
 *      prompt embed (caller's identity) BEFORE dispatch. Webhook failure is
 *      best-effort logged and does NOT abort the ask (Pitfall 7).
 *   4. Dispatch the turn (`deps.dispatchTurn(to, content)`). Errors PROPAGATE
 *      — there is no `try {...} catch {}` around this call. The MCP wrapper
 *      renders `Failed to ask {to}: {error.message}` on caught error. (A2A-11)
 *   5. If mirror=true AND target has a webhook AND response truthy → post a
 *      response embed (target's identity, description prepended with the
 *      Pitfall-4 reply-threading blockquote `> reply to {from}:\n\n`). Same
 *      best-effort wrapping as the prompt mirror.
 *   6. Return {ok: true, messageId, response}. MCP wrapper renders the reply
 *      in the tool-result text — fixes the 2026-04-29 smoking-gun bug. (A2A-09)
 *
 * Notes:
 * - Escalation handling stays in the daemon edge (the `escalationMonitor`
 *   path inspects `response` text for indicator strings AND can re-dispatch
 *   on a fork). Plan 03 keeps that path UNCHANGED — escalation reads the
 *   response returned by this module and may overwrite it before returning
 *   to the IPC client. The decision to keep escalation outside this module
 *   matches the deps shape: escalation needs the SessionManager, not just a
 *   dispatcher closure.
 * - `webhookManager.sendAsAgent` returns the message id `Promise<string>`;
 *   we don't read it (best-effort fire-and-forget for the mirror).
 */
import type { EmbedBuilder } from "discord.js";
import { buildAgentMessageEmbed } from "../discord/agent-message.js";

/** Minimal config shape consumed by the handler — readonly subset. */
export type AskAgentAgentConfigLike = Readonly<{
  name: string;
  webhook?: Readonly<{
    displayName: string;
    avatarUrl?: string;
    webhookUrl?: string;
  }>;
}>;

/** Minimal pino-like logger surface. */
export type AskAgentLogger = Readonly<{
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}>;

/** Minimal WebhookManager surface — extends to whatever the production class exposes. */
export type AskAgentWebhookManagerLike = Readonly<{
  hasWebhook(agentName: string): boolean;
  sendAsAgent(
    targetAgent: string,
    senderDisplayName: string,
    senderAvatarUrl: string | undefined,
    embed: EmbedBuilder,
  ): Promise<string | void>;
}>;

/** Inbox-write closure (production wraps `writeMessage` + `createMessage`). */
export type AskAgentInboxWriter = (params: {
  from: string;
  to: string;
  content: string;
  priority: string;
}) => Promise<{ messageId: string }>;

/** Dependency surface — pure-DI for testability. */
export type AskAgentDeps = Readonly<{
  /** Names of currently-running agents. Array or Set both supported. */
  runningAgents: readonly string[] | ReadonlySet<string>;
  /** Dispatches a turn to the target and returns its response text. */
  dispatchTurn: (to: string, content: string) => Promise<string>;
  /** Persists the message to the target's inbox; returns the message id. */
  writeInbox: AskAgentInboxWriter;
  /** Webhook manager for the optional `mirror_to_target_channel` path. */
  webhookManager: AskAgentWebhookManagerLike;
  /** Resolved agent configs — used to look up webhook display name + avatar. */
  configs: readonly AskAgentAgentConfigLike[];
  /** Logger for best-effort mirror-failure warnings. */
  log: AskAgentLogger;
}>;

/** Wire param shape accepted by the handler. */
export type AskAgentParams = Readonly<{
  from: string;
  to: string;
  content: string;
  priority?: string;
  mirror_to_target_channel?: boolean;
}>;

/** Wire result shape returned by the handler. */
export type AskAgentResult = Readonly<{
  ok: true;
  messageId: string;
  /** Undefined when target was not running (offline path — A2A-12). */
  response?: string;
}>;

/**
 * Build a fully-defaulted `AskAgentDeps` from partial overrides. Used by tests
 * to wire only the fields each test cares about; production daemon constructs
 * the full deps directly at the case-body call site.
 */
export function buildAskAgentDeps(
  overrides: Partial<AskAgentDeps> = {},
): AskAgentDeps {
  const noopLog: AskAgentLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const noopWebhookManager: AskAgentWebhookManagerLike = {
    hasWebhook: () => false,
    sendAsAgent: async () => {},
  };
  return {
    runningAgents: overrides.runningAgents ?? [],
    dispatchTurn: overrides.dispatchTurn ?? (async () => ""),
    writeInbox:
      overrides.writeInbox ??
      (async () => ({ messageId: "test-msg-id" })),
    webhookManager: overrides.webhookManager ?? noopWebhookManager,
    configs: overrides.configs ?? [],
    log: overrides.log ?? noopLog,
  };
}

function isRunning(
  set: AskAgentDeps["runningAgents"],
  name: string,
): boolean {
  if (Array.isArray(set)) return set.includes(name);
  // ReadonlySet<string>
  return (set as ReadonlySet<string>).has(name);
}

/**
 * Handle an `ask-agent` IPC request. See module docstring for behavior.
 *
 * Errors from `deps.dispatchTurn` propagate (D-SYN-05) — caller is expected
 * to surface them as `Failed to ask {to}: {error.message}` text in the MCP
 * wrapper.
 */
export async function handleAskAgentIpc(
  params: AskAgentParams,
  deps: AskAgentDeps,
): Promise<AskAgentResult> {
  const { from, to, content } = params;
  const priority = params.priority ?? "normal";
  const mirror = params.mirror_to_target_channel === true;

  // 1. Always write inbox first — preserves offline-path inbox guarantee even
  //    when the target is running (a record of the prompt is durable).
  const { messageId } = await deps.writeInbox({ from, to, content, priority });

  if (!isRunning(deps.runningAgents, to)) {
    // A2A-12 — offline path. No dispatch, no mirror.
    return { ok: true, messageId };
  }

  // 2. Pre-dispatch mirror — best-effort, never aborts the ask (Pitfall 7).
  if (mirror && deps.webhookManager.hasWebhook(to)) {
    try {
      const senderConfig = deps.configs.find((c) => c.name === from);
      const senderDisplayName =
        senderConfig?.webhook?.displayName ?? from;
      const senderAvatarUrl = senderConfig?.webhook?.avatarUrl;
      const embed = buildAgentMessageEmbed(from, senderDisplayName, content);
      await deps.webhookManager.sendAsAgent(
        to,
        senderDisplayName,
        senderAvatarUrl,
        embed,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      deps.log.warn(
        { from, to, err: errMsg },
        "[ask-agent] mirror prompt webhook failed (best-effort, ask continues)",
      );
    }
  }

  // 3. Dispatch the turn — errors PROPAGATE (D-SYN-05). No try/catch here.
  const response = await deps.dispatchTurn(to, content);

  // 4. Post-dispatch mirror — best-effort, never aborts the ask.
  if (mirror && response && deps.webhookManager.hasWebhook(to)) {
    try {
      const targetConfig = deps.configs.find((c) => c.name === to);
      const targetDisplayName =
        targetConfig?.webhook?.displayName ?? to;
      const targetAvatarUrl = targetConfig?.webhook?.avatarUrl;
      // Pitfall 4 — Discord webhooks can't natively reply-thread; prepend the
      // description with a blockquote `> reply to {from}:\n\n` so an operator
      // scrolling the target's channel sees the visual link.
      const embedBody = `> reply to ${from}:\n\n${response}`;
      const embed = buildAgentMessageEmbed(
        to,
        targetDisplayName,
        embedBody,
      );
      await deps.webhookManager.sendAsAgent(
        to,
        targetDisplayName,
        targetAvatarUrl,
        embed,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      deps.log.warn(
        { from, to, err: errMsg },
        "[ask-agent] mirror response webhook failed (best-effort, ask continues)",
      );
    }
  }

  return { ok: true, messageId, response };
}
