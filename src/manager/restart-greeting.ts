/**
 * Phase 89 Plan 01 Task 2 — restart-greeting.ts
 *
 * Pure helper module for the agent-restart greeting flow. Composes every
 * greeting rule into a single exported function `sendRestartGreeting` with
 * dependency injection for ALL I/O surfaces (webhook, conversation store,
 * summarizer, clock, logger, cool-down Map). Zero coupling to the session
 * manager's internals — Plan 89-02 wires the call at the restart chokepoint.
 *
 * Decisions honoured:
 *   - D-03/GREET-02: skip forks (`-fork-<nanoid6>`) and subagent threads
 *     (`-sub-<nanoid6>`) by name-suffix regex.
 *   - D-04/GREET-03: `classifyRestart(prevConsecutiveFailures)` returns
 *     "crash-suspected" when >0, "clean" otherwise.
 *   - D-05/D-06/GREET-04: fresh Haiku summarization at restart-time with
 *     a 10s AbortController; no fallback greeting on timeout.
 *   - D-07/GREET-03: embed carries the summary ONLY (no last-active
 *     timestamp, no model, no effort, no open-loops).
 *   - D-08/GREET-06: agent's own webhook identity via
 *     webhookManager.sendAsAgent (self-send).
 *   - D-09/GREET-07: `config.greetOnRestart === false` short-circuits.
 *   - D-10/GREET-05: dormancy threshold 7d; skip when last-activity >7d.
 *   - D-11/GREET-05: empty-state (zero terminated sessions OR zero turns
 *     OR empty summary) skips entirely — no fallback.
 *   - D-14/GREET-10: per-agent cool-down via a Map<string, number> owned by
 *     the caller (5-minute default window, configurable per-agent).
 *   - D-15/GREET-06: new message every restart (no edit-in-place, no
 *     messageId persistence across boots).
 *   - D-16/GREET-06: on send failure, returns `{kind: "send-failed"}`;
 *     caller owns the fire-and-forget `.catch` + log-and-swallow.
 *
 * This module imports NOTHING from the session manager. All types are
 * parameterized via the dep struct so tests can inject `vi.fn()` shims.
 */

import { EmbedBuilder } from "discord.js";
import type { Logger } from "pino";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { ConversationTurn } from "../memory/conversation-types.js";
import type { ConversationSession } from "../memory/conversation-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Signature of the injected Haiku summarizer. Matches the existing
 * `summarizeWithHaiku(prompt, opts)` in `src/manager/summarize-with-haiku.ts`
 * so the session manager (Plan 89-02) can pass it directly.
 */
export type SummarizeFn = (
  prompt: string,
  opts: { readonly signal?: AbortSignal },
) => Promise<string>;

/**
 * Narrow structural surface from WebhookManager used by the greeting helper.
 * We accept the structural shape rather than the concrete class so tests can
 * pass a plain object without instantiating a real WebhookManager.
 */
export type WebhookSender = Readonly<{
  hasWebhook(agentName: string): boolean;
  sendAsAgent(
    targetAgent: string,
    senderDisplayName: string,
    senderAvatarUrl: string | undefined,
    embed: EmbedBuilder,
  ): Promise<string>;
}>;

/**
 * Narrow ConversationStore surface used by the greeting helper. Tests build
 * a plain object implementing just these two methods. Production code passes
 * the real ConversationStore which already satisfies this shape.
 */
export type ConversationReader = Readonly<{
  listRecentTerminatedSessions(
    agentName: string,
    limit: number,
  ): readonly ConversationSession[];
  getTurnsForSession(
    sessionId: string,
    limit?: number,
  ): readonly ConversationTurn[];
}>;

/**
 * Fallback sender used when no per-agent webhook is provisioned. Sends the
 * greeting embed to the bound Discord channel under the bot's own identity
 * (instead of the per-agent webhook identity). Less pretty (no custom
 * avatar/display name), but keeps the greeting functional when the bot lacks
 * MANAGE_WEBHOOKS or the auto-provisioner hasn't created webhooks yet.
 * Phase 90.1 hotfix — 2026-04-24.
 */
export type BotDirectSender = Readonly<{
  sendEmbed(channelId: string, embed: EmbedBuilder): Promise<string>;
}>;

export type SendRestartGreetingDeps = Readonly<{
  webhookManager: WebhookSender;
  conversationStore: ConversationReader;
  summarize: SummarizeFn;
  now: () => number;
  log: Logger;
  /**
   * Per-agent last-greeting-at timestamp in epoch ms. Owned by the caller
   * (the session manager) and mutated by this helper on successful send.
   * The caller is responsible for clearing entries on stopAgent() so a
   * clean restart does not trip the cool-down gate.
   */
  coolDownState: Map<string, number>;
  /** Optional bot-direct fallback when no webhook is provisioned (Phase 90.1). */
  botDirectSender?: BotDirectSender;
}>;

export type RestartKind = "clean" | "crash-suspected";

export type SendRestartGreetingInput = Readonly<{
  agentName: string;
  config: ResolvedAgentConfig;
  restartKind: RestartKind;
  /** Default 7 * 24 * 3600_000 ms (7 days). */
  dormancyThresholdMs?: number;
  /** Default 10_000 ms. */
  summaryTimeoutMs?: number;
  /** Default 50 turns. */
  maxTurnsForSummary?: number;
}>;

/**
 * Discriminated union of every observable outcome. Plan 89-02 (the caller)
 * ignores the value (fire-and-forget), but callers of this module in tests
 * or future observability code can exhaustively switch on `.kind`.
 */
export type GreetingOutcome =
  | { readonly kind: "sent"; readonly messageId: string }
  | { readonly kind: "skipped-disabled" }
  | { readonly kind: "skipped-fork" }
  | { readonly kind: "skipped-subagent-thread" }
  | { readonly kind: "skipped-no-channel" }
  | { readonly kind: "skipped-no-webhook" }
  | { readonly kind: "skipped-dormant"; readonly lastActivityMs: number }
  | { readonly kind: "skipped-empty-state" }
  | { readonly kind: "skipped-cool-down"; readonly lastGreetingAtMs: number }
  | { readonly kind: "send-failed"; readonly error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** D-10: dormancy threshold — skip greeting when last-activity > 7 days. */
export const DEFAULT_DORMANCY_THRESHOLD_MS = 7 * 24 * 3600_000;

/** D-05/D-06: Haiku timeout — mirrors SessionSummarizer's 10s budget. */
export const DEFAULT_SUMMARY_TIMEOUT_MS = 10_000;

/** Cap turn count handed to the Haiku prompt so the prompt stays bounded. */
export const DEFAULT_MAX_TURNS_FOR_SUMMARY = 50;

/** D-06: hard cap on embed description length (500 chars incl. ellipsis). */
export const DESCRIPTION_MAX_CHARS = 500;

/** D-13: Discord blurple — "I'm back online" neutral brand color. */
export const CLEAN_EMBED_COLOR = 0x5865f2;

/** D-13: amber — matches sendBudgetAlert's "warning" color. */
export const CRASH_EMBED_COLOR = 0xffcc00;

/**
 * D-03 fork name pattern: `{parent}-fork-{nanoid6}`.
 * nanoid(6) alphabet: [A-Za-z0-9_-].
 * Source: src/manager/fork.ts:25-27.
 */
const FORK_SUFFIX_RE = /-fork-[A-Za-z0-9_-]{6}$/;

/**
 * D-03 subagent-thread name pattern: `{parent}-sub-{nanoid6}`.
 * Source: src/discord/subagent-thread-spawner.ts:97-98.
 */
const THREAD_SUFFIX_RE = /-sub-[A-Za-z0-9_-]{6}$/;

// ---------------------------------------------------------------------------
// Pure predicates (exported for the session manager + tests)
// ---------------------------------------------------------------------------

export function isForkAgent(agentName: string): boolean {
  return FORK_SUFFIX_RE.test(agentName);
}

export function isSubagentThread(agentName: string): boolean {
  return THREAD_SUFFIX_RE.test(agentName);
}

/**
 * GREET-03 classifier: single signal, single rule.
 *   prevConsecutiveFailures > 0 ? "crash-suspected" : "clean"
 *
 * `consecutiveFailures` is reset by the 5-min stability timer in
 * session-recovery.ts, so restarts that happen after stability reset
 * are treated as clean — acceptable semantics per D-04.
 */
export function classifyRestart(prevConsecutiveFailures: number): RestartKind {
  return prevConsecutiveFailures > 0 ? "crash-suspected" : "clean";
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Assemble the Haiku prompt for a Discord-tuned prior-session summary.
 * Enforces the <500-char target through explicit instruction; the embed
 * builder truncates as a belt-and-suspenders safeguard.
 */
export function buildRestartGreetingPrompt(
  turns: readonly ConversationTurn[],
  agentConfig: ResolvedAgentConfig,
  restartKind: RestartKind,
): string {
  const agentVoice = agentConfig.webhook?.displayName ?? agentConfig.name;
  const turnsMarkdown = turns
    .map((t) => `### ${t.role} (turn ${t.turnIndex})\n${t.content}`)
    .join("\n\n");
  const situation =
    restartKind === "crash-suspected"
      ? "an unexpected shutdown"
      : "a clean restart";
  return `You are ${agentVoice}. You just came back online after ${situation}.

Summarize the PRIOR session below into a single first-person paragraph of AT MOST 400 characters (hard limit 500). Speak as "${agentVoice}" — "I was working on…", "We decided…", "I'm still waiting on…". NO bullet points. NO markdown headers. NO meta-commentary about being an AI or being restarted.

Prior session:

${turnsMarkdown}`;
}

// ---------------------------------------------------------------------------
// Embed builders
// ---------------------------------------------------------------------------

function truncateDesc(s: string): string {
  if (s.length <= DESCRIPTION_MAX_CHARS) return s;
  // U+2026 horizontal ellipsis counts as 1 char; slice to (max - 1) and
  // append. Result length === DESCRIPTION_MAX_CHARS.
  return s.slice(0, DESCRIPTION_MAX_CHARS - 1) + "\u2026";
}

export function buildCleanRestartEmbed(
  agentDisplayName: string,
  agentAvatarUrl: string | undefined,
  priorSessionSummary: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setAuthor({ name: agentDisplayName, iconURL: agentAvatarUrl })
    .setDescription(truncateDesc(priorSessionSummary))
    .setColor(CLEAN_EMBED_COLOR)
    .setFooter({ text: "Back online" })
    .setTimestamp();
}

export function buildCrashRecoveryEmbed(
  agentDisplayName: string,
  agentAvatarUrl: string | undefined,
  priorSessionSummary: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setAuthor({ name: agentDisplayName, iconURL: agentAvatarUrl })
    .setDescription(truncateDesc(priorSessionSummary))
    .setColor(CRASH_EMBED_COLOR)
    .setFooter({ text: "Recovered after unexpected shutdown" })
    .setTimestamp();
}

// ---------------------------------------------------------------------------
// Main helper
// ---------------------------------------------------------------------------

export async function sendRestartGreeting(
  deps: SendRestartGreetingDeps,
  input: SendRestartGreetingInput,
): Promise<GreetingOutcome> {
  const {
    agentName,
    config,
    restartKind,
    dormancyThresholdMs = DEFAULT_DORMANCY_THRESHOLD_MS,
    summaryTimeoutMs = DEFAULT_SUMMARY_TIMEOUT_MS,
    maxTurnsForSummary = DEFAULT_MAX_TURNS_FOR_SUMMARY,
  } = input;

  // 1. Opt-out gate (D-09 / GREET-07)
  if (config.greetOnRestart === false) {
    return { kind: "skipped-disabled" };
  }

  // 2. Fork / thread skip (D-03 / GREET-02)
  if (isForkAgent(agentName)) return { kind: "skipped-fork" };
  if (isSubagentThread(agentName)) return { kind: "skipped-subagent-thread" };

  // 3. Channel / webhook presence gates. Defensive — forks/threads already
  //    carve themselves out via the name regexes above; these catch any
  //    future headless agent pattern OR a runtime webhook-provisioning miss.
  if (!config.channels || config.channels.length === 0) {
    return { kind: "skipped-no-channel" };
  }
  // Phase 90.1: only skip here if NEITHER webhook nor bot-direct fallback is
  // available. If bot-direct is wired, we fall through and use it at the
  // send step (branch below).
  const hasWebhook = deps.webhookManager.hasWebhook(agentName);
  if (!hasWebhook && !deps.botDirectSender) {
    return { kind: "skipped-no-webhook" };
  }

  // 4. Cool-down gate (D-14 / GREET-10) — BEFORE the expensive summarize call.
  const lastSentAt = deps.coolDownState.get(agentName);
  if (
    lastSentAt !== undefined &&
    deps.now() - lastSentAt < config.greetCoolDownMs
  ) {
    return { kind: "skipped-cool-down", lastGreetingAtMs: lastSentAt };
  }

  // 5/6. Dormancy + empty-state (D-10 / D-11 / GREET-05)
  //
  // Phase 90.1 — iterate back through the last few terminated sessions to
  // find one with actual turns. Without this, a restart-immediately-after-
  // restart (common during operator testing or debugging) reads the most-
  // recent session (0 turns) and silently skips the greeting with
  // `skipped-empty-state`. That looks identical to a broken greeting even
  // though the agent has plenty of history. We cap the lookback at 5 sessions
  // to avoid pathological scans — anything older than that is effectively
  // ancient and the dormancy rule would kick in anyway.
  const recent = deps.conversationStore.listRecentTerminatedSessions(
    agentName,
    5,
  );
  if (recent.length === 0) return { kind: "skipped-empty-state" };

  // Find the most-recent session that actually has turns to summarize.
  let lastSession: ConversationSession | undefined;
  let turns: readonly ConversationTurn[] = [];
  for (const candidate of recent) {
    const candidateTurns = deps.conversationStore.getTurnsForSession(
      candidate.id,
      maxTurnsForSummary,
    );
    if (candidateTurns.length > 0) {
      lastSession = candidate;
      turns = candidateTurns;
      break;
    }
  }
  if (!lastSession) return { kind: "skipped-empty-state" };

  // Dormancy check applies to the chosen session's activity time.
  const lastActivityIso = lastSession.endedAt ?? lastSession.startedAt;
  const lastActivityMs = new Date(lastActivityIso).getTime();
  // Clock-skew clamp mirrors src/memory/conversation-brief.ts:110.
  const ageMs = Math.max(0, deps.now() - lastActivityMs);
  if (ageMs > dormancyThresholdMs) {
    return { kind: "skipped-dormant", lastActivityMs };
  }

  // 7. Haiku summarization with timeout (D-05 / D-06 / GREET-04).
  //    Timeout is OWNED BY THIS CALLER (summarizeWithHaiku's docstring
  //    explicitly delegates the timer to the caller). On timeout / SDK
  //    error / abort / empty-string we stay silent — D-11 forbids a
  //    fallback greeting.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), summaryTimeoutMs);
  let summary: string;
  try {
    summary = await deps.summarize(
      buildRestartGreetingPrompt(turns, config, restartKind),
      { signal: controller.signal },
    );
  } catch {
    return { kind: "skipped-empty-state" };
  } finally {
    clearTimeout(timer);
  }
  if (summary.trim().length === 0) {
    return { kind: "skipped-empty-state" };
  }

  // 8. Build embed (D-04 / D-13 / GREET-03)
  const displayName = config.webhook?.displayName ?? agentName;
  const avatarUrl = config.webhook?.avatarUrl;
  const embed =
    restartKind === "crash-suspected"
      ? buildCrashRecoveryEmbed(displayName, avatarUrl, summary)
      : buildCleanRestartEmbed(displayName, avatarUrl, summary);

  // 9. Send via webhook (D-08 / D-13 / D-15 / GREET-06), OR fall back to
  //    bot-direct (Phase 90.1) when no webhook is provisioned / webhook send
  //    fails. Bot-direct targets the first bound channel directly under the
  //    bot's own identity — less pretty (no per-agent avatar) but functional
  //    when MANAGE_WEBHOOKS is missing. A failure here is still non-fatal at
  //    the session-manager layer — our caller wraps the whole invocation in
  //    `.catch(log-and-swallow)`.
  let messageId: string;
  const channelId = config.channels?.[0];
  if (hasWebhook) {
    try {
      messageId = await deps.webhookManager.sendAsAgent(
        agentName,
        displayName,
        avatarUrl,
        embed,
      );
    } catch (err) {
      // Webhook send failed — try bot-direct fallback if available.
      if (deps.botDirectSender && channelId) {
        try {
          messageId = await deps.botDirectSender.sendEmbed(channelId, embed);
        } catch (err2) {
          return {
            kind: "send-failed",
            error: err2 instanceof Error ? err2.message : String(err2),
          };
        }
      } else {
        return {
          kind: "send-failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  } else {
    // No webhook — use bot-direct. (hasWebhook=false here implies
    // deps.botDirectSender is truthy per the guard at step 3.)
    if (!deps.botDirectSender || !channelId) {
      return { kind: "skipped-no-webhook" };
    }
    try {
      messageId = await deps.botDirectSender.sendEmbed(channelId, embed);
    } catch (err) {
      return {
        kind: "send-failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // 10. Cool-down write-back (D-14). MUST run AFTER the successful send —
  //     failed sends should not block the next retry.
  deps.coolDownState.set(agentName, deps.now());
  return { kind: "sent", messageId };
}
