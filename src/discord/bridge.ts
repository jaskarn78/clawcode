import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type User,
  type PartialUser,
} from "discord.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../shared/logger.js";
import type { RoutingTable } from "./types.js";
import type { SessionManager } from "../manager/session-manager.js";
import type { TurnDispatcher } from "../manager/turn-dispatcher.js";
import type { ThreadManager } from "./thread-manager.js";
import type { Logger } from "pino";
import type { DownloadResult } from "./attachment-types.js";
import {
  extractAttachments,
  downloadAllAttachments,
  formatAttachmentMetadata,
  isImageAttachment,
} from "./attachments.js";
import { formatReactionEvent } from "./reactions.js";
import { ProgressiveMessageEditor } from "./streaming.js";
import type { WebhookManager } from "./webhook-manager.js";
import type { DeliveryQueue } from "./delivery-queue.js";
import { checkChannelAccess } from "../security/acl-parser.js";
import type { SecurityPolicy } from "../security/types.js";
import type { Turn, Span } from "../performance/trace-collector.js";
import {
  makeRootOriginWithTurnId,
  DISCORD_SNOWFLAKE_PREFIX,
} from "../manager/turn-origin.js";

/**
 * Configuration for the Discord bridge.
 */
export type BridgeConfig = {
  readonly routingTable: RoutingTable;
  readonly sessionManager: SessionManager;
  /**
   * Phase 57 Plan 03: optional TurnDispatcher injection.
   *
   * Daemon path (`startDaemon`): ALWAYS injects — Discord turns are
   * dispatched through TurnDispatcher.dispatchStream, which attaches the
   * TurnOrigin blob (source.kind='discord', source.id=<snowflake>) to
   * the caller-owned Turn so Plan 57-02's writeTurn persists it.
   *
   * Standalone runner (`src/cli/commands/run.ts`): does NOT inject.
   * `handleMessage` falls back to `this.sessionManager.streamFromAgent(...)`
   * — identical to the v1.7 path. No TurnOrigin is written (expected; the
   * standalone runner is out of v1.8 scope). This keeps TS strict happy
   * for existing callers and unblocks incremental rollout.
   */
  readonly turnDispatcher?: TurnDispatcher;
  readonly threadManager?: ThreadManager;
  readonly webhookManager?: WebhookManager;
  readonly deliveryQueue?: DeliveryQueue;
  readonly securityPolicies?: ReadonlyMap<string, SecurityPolicy>;
  readonly botToken?: string;
  readonly log?: Logger;
};

/**
 * Load the Discord bot token from the standard Claude Code location.
 */
export function loadBotToken(): string {
  const envFile = join(
    homedir(),
    ".claude",
    "channels",
    "discord",
    ".env",
  );
  try {
    const content = readFileSync(envFile, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^DISCORD_BOT_TOKEN=(.+)$/);
      if (match) {
        return match[1].trim();
      }
    }
  } catch {
    // Config file not found or unreadable -- fall through to env var
  }

  const envToken = process.env.DISCORD_BOT_TOKEN;
  if (envToken) {
    return envToken;
  }

  throw new Error(
    "Discord bot token not found. Set DISCORD_BOT_TOKEN or configure in ~/.claude/channels/discord/.env",
  );
}

/**
 * The Discord message bridge.
 * Connects to Discord, listens for messages in bound channels,
 * routes them to the correct agent session, and sends responses back.
 */
export class DiscordBridge {
  private readonly client: Client;
  private readonly routingTable: RoutingTable;
  private readonly sessionManager: SessionManager;
  /**
   * Phase 57 Plan 03: optional TurnDispatcher injected by the daemon path.
   * Undefined in the standalone runner (`src/cli/commands/run.ts`), where
   * handleMessage falls back to `sessionManager.streamFromAgent` directly.
   */
  private readonly turnDispatcher: TurnDispatcher | undefined;
  private readonly threadManager: ThreadManager | undefined;
  private webhookManager: WebhookManager | undefined;
  private readonly deliveryQueue: DeliveryQueue | undefined;
  private readonly securityPolicies: ReadonlyMap<string, SecurityPolicy> | undefined;
  private readonly botToken: string;
  private readonly log: Logger;
  private running = false;
  private readonly recentlySent: Set<string> = new Set();

  /**
   * Expose the Discord client for use by SubagentThreadSpawner.
   */
  get discordClient(): Client {
    return this.client;
  }

  /**
   * Set the webhook manager after construction.
   * Used when webhooks are auto-provisioned after the Client connects.
   */
  setWebhookManager(wm: WebhookManager): void {
    this.webhookManager = wm;
  }

  constructor(config: BridgeConfig) {
    this.routingTable = config.routingTable;
    this.sessionManager = config.sessionManager;
    this.turnDispatcher = config.turnDispatcher;
    this.threadManager = config.threadManager;
    this.webhookManager = config.webhookManager;
    this.deliveryQueue = config.deliveryQueue;
    this.securityPolicies = config.securityPolicies;
    this.botToken = config.botToken ?? loadBotToken();
    this.log = config.log ?? logger;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message, Partials.Reaction],
    });
  }

  /**
   * Start the bridge — connect to Discord and begin routing messages.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.client.on("messageCreate", (message) => {
      this.log.info(
        { channel: message.channelId, author: message.author.username, bot: message.author.bot, content: message.content.slice(0, 50) },
        "messageCreate event received",
      );
      void this.handleMessage(message);
    });

    // Thread creation listener -- spawns thread sessions for bound channels.
    // Threads the bot creates itself (via SubagentThreadSpawner) are already
    // handled end-to-end by that path; handling them here too races on the
    // binding registry and produces duplicate threads.
    this.client.on("threadCreate", (thread) => {
      if (!this.threadManager) return;
      const botUserId = this.client.user?.id;
      if (botUserId && thread.ownerId === botUserId) {
        this.log.debug(
          { threadId: thread.id, threadName: thread.name },
          "threadCreate from own bot, ignoring (handled by SubagentThreadSpawner)",
        );
        return;
      }
      this.log.info(
        { threadId: thread.id, threadName: thread.name, parentId: thread.parentId },
        "threadCreate event received",
      );
      if (thread.parentId) {
        void this.threadManager.handleThreadCreate(
          thread.id,
          thread.name ?? "unnamed",
          thread.parentId,
        );
      }
    });

    // Reaction event listeners -- forward reactions in bound channels to agents
    this.client.on("messageReactionAdd", (reaction, user) => {
      void this.handleReaction(reaction, user, "add");
    });

    this.client.on("messageReactionRemove", (reaction, user) => {
      void this.handleReaction(reaction, user, "remove");
    });

    // Debug: log ALL events to see what's coming through
    this.client.on("debug", (info) => {
      if (info.includes("Heartbeat") || info.includes("Session")) return; // skip noise
      this.log.debug({ info }, "discord debug");
    });

    this.client.on("warn", (info) => {
      this.log.warn({ info }, "discord warning");
    });

    this.client.on("ready", () => {
      const guilds = this.client.guilds.cache.map(g => ({ id: g.id, name: g.name }));
      this.log.info(
        { user: this.client.user?.tag, channels: this.routingTable.channelToAgent.size, guilds },
        "Discord bridge connected",
      );
    });

    this.client.on("error", (error) => {
      this.log.error({ error: error.message }, "Discord client error");
    });

    await this.client.login(this.botToken);
    this.deliveryQueue?.start();
    this.running = true;
  }

  /**
   * Send a budget alert embed to a Discord channel.
   * Fire-and-forget: errors are logged, never thrown.
   */
  async sendBudgetAlert(
    channelId: string,
    data: {
      readonly agent: string;
      readonly model: string;
      readonly tokensUsed: number;
      readonly tokenLimit: number;
      readonly period: string;
      readonly threshold: "warning" | "exceeded";
    },
  ): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !("send" in channel) || typeof channel.send !== "function") {
        this.log.warn({ channelId }, "cannot send budget alert: channel not sendable");
        return;
      }

      const percentage = Math.round((data.tokensUsed / data.tokenLimit) * 100);
      const isExceeded = data.threshold === "exceeded";

      const embed = new EmbedBuilder()
        .setTitle(isExceeded ? "Budget Exceeded" : "Budget Warning")
        .setColor(isExceeded ? 0xFF0000 : 0xFFCC00)
        .addFields(
          { name: "Agent", value: data.agent, inline: true },
          { name: "Model", value: data.model, inline: true },
          { name: "Usage", value: `${data.tokensUsed.toLocaleString()} / ${data.tokenLimit.toLocaleString()} (${percentage}%)`, inline: true },
          { name: "Period", value: data.period, inline: true },
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error({ channelId, error: errorMsg, agent: data.agent }, "failed to send budget alert");
    }
  }

  /**
   * Stop the bridge — disconnect from Discord.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.deliveryQueue?.stop();
    this.client.removeAllListeners();
    await this.client.destroy();
    this.running = false;
    this.log.info("Discord bridge disconnected");
  }

  /**
   * Phase 54 Plan 02 — Discord.js Message.type === 0 (Default) or 19 (Reply)
   * are the only message types that represent a user-authored chat message.
   * Everything else (pin notices, thread-created system messages, channel
   * follow adds, etc.) is NOT a user message and should NOT trigger the
   * typing indicator.
   *
   * CONTEXT D-04 guard #4: "Message type is a user message (not system/pin/etc)".
   */
  private isUserMessageType(message: Message): boolean {
    return message.type === 0 || message.type === 19;
  }

  /**
   * Phase 54 Plan 02 — fire the Discord typing indicator AND record a
   * `typing_indicator` span on the caller-owned Turn. The span opens on
   * entry and ends synchronously right after the sendTyping() call, so
   * its duration captures the fire latency (not any downstream work).
   *
   * Wrapped in try/catch so that typing failures NEVER block the response
   * path (CONTEXT D-04: typing is observational only). A rejected
   * sendTyping() promise is caught separately and logged at pino.debug.
   */
  private fireTypingIndicator(message: Message, turn: Turn | undefined): void {
    let span: Span | undefined;
    try {
      span = turn?.startSpan("typing_indicator", {});
      if ("sendTyping" in message.channel && typeof message.channel.sendTyping === "function") {
        void message.channel.sendTyping().catch((err) => {
          this.log.debug(
            { error: (err as Error).message, channelId: message.channelId },
            "sendTyping failed — observational, non-fatal",
          );
        });
      }
    } catch (err) {
      this.log.debug(
        { error: (err as Error).message, channelId: message.channelId },
        "typing indicator setup failed — observational, non-fatal",
      );
    } finally {
      try { span?.end(); } catch { /* non-fatal */ }
    }
  }

  /**
   * Handle an incoming Discord message.
   * Routes to the correct agent based on channel binding.
   */
  private async handleMessage(message: Message): Promise<void> {
    // Handle bot messages: allow agent-to-agent webhooks, ignore everything else
    if (message.author.bot) {
      // Webhook messages from known agents are allowed through
      if (message.webhookId && this.webhookManager) {
        const senderAgent = this.extractAgentSender(message);
        if (senderAgent) {
          await this.handleAgentMessage(message, senderAgent);
          return;
        }
      }
      // All other bot messages (including our own) are ignored
      return;
    }

    // Thread routing takes priority over channel routing (per D-09)
    if (this.threadManager && message.channel.isThread()) {
      const sessionName = await this.threadManager.routeMessage(message.channelId);
      if (sessionName) {
        // Phase 50: open Turn + receive span for thread-routed messages (parity with channel route)
        // Phase 57 Plan 03: turnId is `discord:<snowflake>` so Turn.id matches
        // TurnOrigin.rootTurnId (the invariant TurnDispatcher expects). Raw
        // snowflake queries against traces.id require rewriting to
        // `'discord:' || <snowflake>` — see 57-01-SUMMARY.md locked_shapes.
        let turn: Turn | undefined;
        let receiveSpan: Span | undefined;
        try {
          const collector = this.sessionManager.getTraceCollector(sessionName);
          turn = collector?.startTurn(`${DISCORD_SNOWFLAKE_PREFIX}${message.id}`, sessionName, message.channelId);
          receiveSpan = turn?.startSpan("receive", {
            channel: message.channelId,
            user: message.author.id,
            is_thread: true,
          });
        } catch (err) {
          this.log.warn(
            { error: (err as Error).message, agent: sessionName },
            "trace setup failed — continuing without tracing",
          );
        }

        // Phase 54: fire typing indicator at the EARLIEST point where we know
        // the message is ours to answer — after thread routing resolved an
        // agent, before attachment download + session dispatch. Guard #4
        // (user-message-type) from CONTEXT D-04 applies here.
        if (this.isUserMessageType(message)) {
          this.fireTypingIndicator(message, turn);
        }

        // Download attachments for thread messages using agent workspace (not /tmp)
        let downloadResults: readonly DownloadResult[] | undefined;
        if (message.attachments.size > 0) {
          const agentConfig = this.sessionManager.getAgentConfig(sessionName);
          const workspace = agentConfig?.workspace ?? "/tmp";
          const attachDir = join(workspace, "inbox", "attachments");
          const attachments = extractAttachments(message.attachments);
          downloadResults = await downloadAllAttachments(attachments, attachDir, this.log);
        }

        // Fetch the referenced message if this is a reply, so the agent sees
        // the quoted content (not just an opaque message_id).
        let referencedMessage: Message | undefined;
        if (message.reference?.messageId) {
          try {
            referencedMessage = (await message.fetchReference()) as Message;
          } catch (err) {
            this.log.debug({ err, refId: message.reference.messageId }, "fetchReference failed");
          }
        }

        const formattedMessage = formatDiscordMessage(message, downloadResults, referencedMessage);
        // End the receive span right before dispatching to the session (end_to_end still open)
        try { receiveSpan?.end(); } catch { /* non-fatal */ }
        await this.streamAndPostResponse(message, sessionName, formattedMessage, turn);
        this.log.info({ sessionName, threadId: message.channelId }, "message routed to thread session");
        return;
      }
    }

    const channelId = message.channelId;
    const agentName = this.routingTable.channelToAgent.get(channelId);

    if (!agentName) {
      // Channel not bound to any agent — ignore
      return;
    }

    // Check channel ACL before routing (SECR-01, SECR-02)
    if (this.securityPolicies) {
      const policy = this.securityPolicies.get(agentName);
      if (policy && policy.channelAcls.length > 0) {
        const allowed = checkChannelAccess(channelId, message.author.id, [], policy.channelAcls);
        if (!allowed) {
          this.log.info(
            { agent: agentName, user: message.author.username, userId: message.author.id, channel: channelId },
            "message blocked by channel ACL",
          );
          return; // Silent ignore per SECR-02
        }
      }
    }

    // Phase 50: open Turn + receive span for channel-routed messages.
    // Caller-owned lifecycle — streamAndPostResponse ends the Turn with success/error.
    // Phase 57 Plan 03: turnId is `discord:<snowflake>` (see thread-route
    // branch above for the trace-id continuity rationale).
    let turn: Turn | undefined;
    let receiveSpan: Span | undefined;
    try {
      const collector = this.sessionManager.getTraceCollector(agentName);
      turn = collector?.startTurn(`${DISCORD_SNOWFLAKE_PREFIX}${message.id}`, agentName, channelId);
      receiveSpan = turn?.startSpan("receive", {
        channel: channelId,
        user: message.author.id,
        is_thread: false,
      });
    } catch (err) {
      this.log.warn(
        { error: (err as Error).message, agent: agentName },
        "trace setup failed — continuing without tracing",
      );
    }

    // Phase 54: fire typing indicator at the EARLIEST point where we know
    // the message is ours to answer — after channel routing + ACL pass +
    // non-bot author (all 3 already enforced above), before attachment
    // download + session dispatch. Guard #4 (user-message-type) is the
    // last check.
    if (this.isUserMessageType(message)) {
      this.fireTypingIndicator(message, turn);
    }

    this.log.info(
      {
        channel: channelId,
        agent: agentName,
        user: message.author.username,
        messageId: message.id,
      },
      "routing message to agent",
    );

    // Download attachments if present, before formatting the message
    let downloadResults: readonly DownloadResult[] | undefined;
    if (message.attachments.size > 0) {
      const agentConfig = this.sessionManager.getAgentConfig(agentName);
      const workspace = agentConfig?.workspace ?? "/tmp";
      const attachDir = join(workspace, "inbox", "attachments");
      const attachments = extractAttachments(message.attachments);
      downloadResults = await downloadAllAttachments(attachments, attachDir, this.log);
    }

    // Fetch the referenced message if this is a reply, so the agent sees
    // the quoted content (not just an opaque message_id).
    let referencedMessage: Message | undefined;
    if (message.reference?.messageId) {
      try {
        referencedMessage = (await message.fetchReference()) as Message;
      } catch (err) {
        this.log.debug({ err, refId: message.reference.messageId }, "fetchReference failed");
      }
    }

    const formattedMessage = formatDiscordMessage(message, downloadResults, referencedMessage);
    // End the receive span right before session dispatch; end_to_end remains open
    try { receiveSpan?.end(); } catch { /* non-fatal */ }
    await this.streamAndPostResponse(message, agentName, formattedMessage, turn);
  }

  /**
   * Stream a response from the named session and post it back to the incoming
   * message's channel (regular channel or thread). Handles typing indicators,
   * progressive message editing, multi-message splitting for long output, and
   * error reactions.
   */
  private async streamAndPostResponse(
    message: Message,
    sessionName: string,
    formattedMessage: string,
    turn?: Turn,
  ): Promise<void> {
    const channelId = message.channelId;

    // Phase 54: the eager-first sendTyping() fire that used to live here was
    // relocated to DiscordBridge.handleMessage so it fires at message arrival
    // (before session dispatch). The 8-second re-typing heartbeat below is
    // a separate concern (extends typing during long responses) and stays.

    let editor: ProgressiveMessageEditor | undefined;
    let typingInterval: ReturnType<typeof setInterval> | undefined;

    try {
      typingInterval = setInterval(() => {
        if ("sendTyping" in message.channel && typeof message.channel.sendTyping === "function") {
          void message.channel.sendTyping();
        }
      }, 8000);

      const channel = message.channel;
      const messageRef: { current: Message | null } = { current: null };
      // Phase 54 Plan 03: per-agent streaming cadence override. When
      // perf.streaming.editIntervalMs is present on the agent config, thread
      // it into the editor (falls back to the 750ms default). The Turn is
      // passed through so the editor can emit its first-visible-token span
      // on the first editFn call. Log + agent + turnId power the single
      // WARN per turn emitted on rate-limit detection.
      const agentConfig = this.sessionManager.getAgentConfig(sessionName);
      const streamingCfg = agentConfig?.perf?.streaming;
      editor = new ProgressiveMessageEditor({
        editFn: async (content: string) => {
          if (!messageRef.current) {
            if ("send" in channel && typeof channel.send === "function") {
              messageRef.current = await channel.send(content);
            }
          } else {
            await messageRef.current.edit(content);
          }
        },
        editIntervalMs: streamingCfg?.editIntervalMs,
        maxLength: streamingCfg?.maxLength,
        turn,
        log: this.log,
        agent: sessionName,
        turnId: message.id,
      });

      // Phase 57 Plan 03: route through TurnDispatcher when injected (daemon
      // path) so the trace row carries a TurnOrigin JSON blob. Fall back to
      // the v1.7 streamFromAgent path when the dispatcher is undefined
      // (standalone runner — src/cli/commands/run.ts). The Turn is
      // caller-owned on both branches: streamAndPostResponse keeps ownership
      // of turn.end() so it can fire on success/error in the try/catch
      // below. TurnDispatcher on the caller-owned-Turn path calls
      // turn.recordOrigin(origin) but NOT turn.end().
      let response: string;
      if (this.turnDispatcher) {
        const turnId = `${DISCORD_SNOWFLAKE_PREFIX}${message.id}`;
        const origin = makeRootOriginWithTurnId("discord", message.id, turnId);
        response = await this.turnDispatcher.dispatchStream(
          origin,
          sessionName,
          formattedMessage,
          (accumulated) => editor!.update(accumulated),
          { turn, channelId },
        );
      } else {
        // v1.7 fallback — preserves standalone runner (src/cli/commands/run.ts)
        response = await this.sessionManager.streamFromAgent(
          sessionName,
          formattedMessage,
          (accumulated) => editor!.update(accumulated),
          turn,
        );
      }

      clearInterval(typingInterval);
      typingInterval = undefined;
      await editor.flush();

      if (response && response.trim().length > 0) {
        if (response.length > 2000) {
          if (messageRef.current) {
            try { await messageRef.current.delete(); } catch (err) { this.log.debug({ error: (err as Error).message }, "failed to delete typing indicator message"); }
          }
          await this.sendResponse(message, response, sessionName);
        } else if (messageRef.current) {
          await messageRef.current.edit(response);
        } else {
          await this.sendResponse(message, response, sessionName);
        }
        this.log.info({ agent: sessionName, channel: channelId, responseLength: response.length }, "agent response sent to Discord");
      } else if (!messageRef.current) {
        this.log.warn({ agent: sessionName, channel: channelId }, "agent returned empty response");
      }

      // Phase 50: end Turn on success after all post-processing completes
      try { turn?.end("success"); } catch { /* non-fatal */ }
    } catch (error) {
      if (typingInterval) clearInterval(typingInterval);
      if (editor) editor.dispose();

      // Phase 50: end Turn on error before the reaction attempt so the trace
      // records the failure status even if the reaction call itself throws.
      try { turn?.end("error"); } catch { /* non-fatal */ }

      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error(
        { agent: sessionName, channel: channelId, error: errorMsg },
        "failed to route message",
      );

      try {
        await message.react("\u274C");
      } catch (err) {
        this.log.debug({ error: (err as Error).message }, "failed to add error reaction");
      }
    }
  }

  /**
   * Extract the sender agent name from a webhook message's embed footer.
   * Agent-to-agent messages have footer text: "Agent-to-agent message from {agentName}"
   * Returns the sender agent name or undefined if not an agent message.
   */
  private extractAgentSender(message: Message): string | undefined {
    if (!message.embeds || message.embeds.length === 0) return undefined;
    const footer = message.embeds[0].footer?.text;
    if (!footer) return undefined;
    const match = footer.match(/^Agent-to-agent message from (.+)$/);
    return match ? match[1] : undefined;
  }

  /**
   * Handle an incoming agent-to-agent webhook message.
   * Extracts content from the embed, prefixes with sender context, and forwards to the bound agent.
   */
  private async handleAgentMessage(message: Message, senderAgent: string): Promise<void> {
    const channelId = message.channelId;
    const agentName = this.routingTable.channelToAgent.get(channelId);
    if (!agentName) {
      this.log.debug({ channelId, senderAgent }, "agent webhook message in unbound channel -- ignoring");
      return;
    }

    // Extract content from the embed description
    const embedContent = message.embeds[0]?.description ?? message.content ?? "";

    // Format with agent message prefix per user decision (A2A-04)
    const prefixedContent = `[Agent Message from ${senderAgent}]\n${embedContent}`;

    this.log.info(
      { from: senderAgent, to: agentName, channel: channelId, messageId: message.id },
      "routing agent-to-agent message",
    );

    try {
      await this.sessionManager.forwardToAgent(agentName, prefixedContent);
      this.log.info({ from: senderAgent, to: agentName }, "agent-to-agent message forwarded");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error(
        { from: senderAgent, to: agentName, error: errorMsg },
        "failed to forward agent-to-agent message",
      );
    }
  }

  /**
   * Handle a reaction event (add or remove).
   * Routes to the bound agent in the channel.
   */
  private async handleReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
    type: "add" | "remove",
  ): Promise<void> {
    // Ignore bot reactions (prevent feedback loops)
    if (user.bot) {
      return;
    }

    const channelId = reaction.message.channelId;
    const agentName = this.routingTable.channelToAgent.get(channelId);

    if (!agentName) {
      return;
    }

    // Fetch partial reaction if needed
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        this.log.warn({ channelId, type }, "failed to fetch partial reaction");
        return;
      }
    }

    const emoji = reaction.emoji.name ?? reaction.emoji.id ?? "unknown";
    const userName = user.username ?? user.id;

    const formatted = formatReactionEvent({
      type,
      emoji,
      userName,
      messageId: reaction.message.id,
      channelId,
      messageContent: reaction.message.content ?? undefined,
    });

    try {
      await this.sessionManager.forwardToAgent(agentName, formatted);
      this.log.info(
        { agent: agentName, emoji, type, user: userName },
        "reaction forwarded to agent",
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error(
        { agent: agentName, error: errorMsg },
        "failed to forward reaction",
      );
    }
  }

  /**
   * Send a response back to the Discord channel.
   * Handles message length limits (2000 chars) by splitting.
   */
  /**
   * Resolve the agent name for a channel, checking thread bindings first.
   */
  private resolveAgentForChannel(channelId: string): string | undefined {
    return this.routingTable.channelToAgent.get(channelId);
  }

  private async sendResponse(
    originalMessage: Message,
    response: string,
    agentName?: string,
  ): Promise<void> {
    // Deduplicate — don't send the same response twice within 5s
    const dedupeKey = `${originalMessage.channelId}:${response.slice(0, 100)}`;
    if (this.recentlySent.has(dedupeKey)) {
      return;
    }
    this.recentlySent.add(dedupeKey);
    setTimeout(() => this.recentlySent.delete(dedupeKey), 5000);

    const resolvedAgent = agentName ?? this.resolveAgentForChannel(originalMessage.channelId);

    // Route through delivery queue if available — queue handles retry on failure
    if (this.deliveryQueue && resolvedAgent) {
      this.deliveryQueue.enqueue(resolvedAgent, originalMessage.channelId, response);
      return;
    }

    // Fallback: direct send (backward compatible when no queue configured)
    await this.sendDirect(originalMessage, response, resolvedAgent);
  }

  /**
   * Send a response directly to Discord without the delivery queue.
   * Tries webhook first, then falls back to channel.send with splitting.
   */
  private async sendDirect(
    originalMessage: Message,
    response: string,
    resolvedAgent?: string,
  ): Promise<void> {
    // Try webhook delivery if agent has a webhook configured
    if (resolvedAgent && this.webhookManager?.hasWebhook(resolvedAgent)) {
      await this.webhookManager.send(resolvedAgent, response);
      return;
    }

    const MAX_LENGTH = 2000;
    const channel = originalMessage.channel;

    if (!("send" in channel) || typeof channel.send !== "function") {
      return;
    }

    if (response.length <= MAX_LENGTH) {
      await channel.send(response);
      return;
    }

    // Split long responses
    const chunks = splitMessage(response, MAX_LENGTH);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }
}

/**
 * Format a Discord message for the agent, including metadata.
 * When downloadResults are provided, replaces the simple attachment listing
 * with structured metadata from formatAttachmentMetadata, plus multimodal
 * hints for image attachments.
 *
 * Exported for testing.
 */
export function formatDiscordMessage(
  message: Message,
  downloadResults?: readonly DownloadResult[],
  referencedMessage?: Message,
): string {
  const parts = [
    `<channel source="discord" chat_id="${message.channelId}" message_id="${message.id}" user="${message.author.username}" ts="${message.createdAt.toISOString()}">`,
    message.content,
    `</channel>`,
  ];

  // Include attachments: use structured metadata if download results provided
  if (downloadResults && downloadResults.length > 0) {
    const metadata = formatAttachmentMetadata(downloadResults);
    if (metadata) {
      parts.push(`\n${metadata}`);
    }

    // Add multimodal reading hints for successfully downloaded images
    for (const result of downloadResults) {
      if (
        result.success &&
        result.path !== null &&
        isImageAttachment(result.attachmentInfo.contentType)
      ) {
        parts.push(
          `(Image downloaded -- read the file at ${result.path} to see its contents)`,
        );
      }
    }
  } else if (message.attachments.size > 0) {
    // Fallback: simple attachment listing (backward compatible)
    const attachmentList = [...message.attachments.values()]
      .map((a) => `  - ${a.name} (${a.contentType ?? "unknown"}, ${a.size} bytes): ${a.url}`)
      .join("\n");
    parts.push(`\nAttachments:\n${attachmentList}`);
  }

  // Include reply context if this is a reply
  if (message.reference?.messageId) {
    if (referencedMessage) {
      const refUser = referencedMessage.author.username;
      const refContent = referencedMessage.content || "(no text content)";
      const refTs = referencedMessage.createdAt.toISOString();
      parts.unshift(
        `<replying-to message_id="${message.reference.messageId}" user="${refUser}" ts="${refTs}">\n${refContent}\n</replying-to>`,
      );
    } else {
      // Fallback: ID only when fetch failed or wasn't attempted
      parts.unshift(`(replying to message ${message.reference.messageId})`);
    }
  }

  return parts.join("\n");
}

/**
 * Split a long message into chunks respecting the max length.
 * Tries to split on newlines, falls back to hard split.
 */
function splitMessage(text: string, maxLength: number): readonly string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Try to split at a newline
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex <= 0 || splitIndex < maxLength / 2) {
      // No good newline — try space
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex <= 0 || splitIndex < maxLength / 2) {
      // Hard split
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
