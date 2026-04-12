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

/**
 * Configuration for the Discord bridge.
 */
export type BridgeConfig = {
  readonly routingTable: RoutingTable;
  readonly sessionManager: SessionManager;
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
  private readonly threadManager: ThreadManager | undefined;
  private readonly webhookManager: WebhookManager | undefined;
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

  constructor(config: BridgeConfig) {
    this.routingTable = config.routingTable;
    this.sessionManager = config.sessionManager;
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

    // Thread creation listener -- spawns thread sessions for bound channels
    this.client.on("threadCreate", (thread) => {
      if (!this.threadManager) return;
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
        // Download attachments for thread messages using agent workspace (not /tmp)
        let downloadResults: readonly DownloadResult[] | undefined;
        if (message.attachments.size > 0) {
          const agentConfig = this.sessionManager.getAgentConfig(sessionName);
          const workspace = agentConfig?.workspace ?? "/tmp";
          const attachDir = join(workspace, "inbox", "attachments");
          const attachments = extractAttachments(message.attachments);
          downloadResults = await downloadAllAttachments(attachments, attachDir, this.log);
        }

        const formattedMessage = formatDiscordMessage(message, downloadResults);

        // Show typing indicator for thread messages
        if ("sendTyping" in message.channel && typeof message.channel.sendTyping === "function") {
          void message.channel.sendTyping();
        }

        await this.sessionManager.forwardToAgent(sessionName, formattedMessage);
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

    this.log.info(
      {
        channel: channelId,
        agent: agentName,
        user: message.author.username,
        messageId: message.id,
      },
      "routing message to agent",
    );

    // Show typing indicator immediately
    if ("sendTyping" in message.channel && typeof message.channel.sendTyping === "function") {
      void message.channel.sendTyping();
    }

    // Track editor and typing interval for cleanup in error path
    let editor: ProgressiveMessageEditor | undefined;
    let typingInterval: ReturnType<typeof setInterval> | undefined;

    try {
      // Download attachments if present, before formatting the message
      let downloadResults: readonly DownloadResult[] | undefined;

      if (message.attachments.size > 0) {
        const agentConfig = this.sessionManager.getAgentConfig(agentName);
        const workspace = agentConfig?.workspace ?? "/tmp";
        const attachDir = join(workspace, "inbox", "attachments");

        const attachments = extractAttachments(message.attachments);
        downloadResults = await downloadAllAttachments(attachments, attachDir, this.log);
      }

      // Format message for the agent (include Discord context + attachment metadata)
      const formattedMessage = formatDiscordMessage(message, downloadResults);

      // Refresh typing indicator every 8s (Discord typing lasts 10s)
      typingInterval = setInterval(() => {
        if ("sendTyping" in message.channel && typeof message.channel.sendTyping === "function") {
          void message.channel.sendTyping();
        }
      }, 8000);

      // Set up progressive message editor for streaming responses
      const channel = message.channel;
      // Mutable ref to track the sent message (avoids TS narrowing issue with async callbacks)
      const messageRef: { current: Message | null } = { current: null };
      editor = new ProgressiveMessageEditor({
        editFn: async (content: string) => {
          if (!messageRef.current) {
            // First chunk: send a new message
            if ("send" in channel && typeof channel.send === "function") {
              messageRef.current = await channel.send(content);
            }
          } else {
            // Subsequent chunks: edit the existing message
            await messageRef.current.edit(content);
          }
        },
      });

      // Stream from agent with progressive updates
      const response = await this.sessionManager.streamFromAgent(
        agentName,
        formattedMessage,
        (accumulated) => editor!.update(accumulated),
      );

      clearInterval(typingInterval);
      typingInterval = undefined;
      await editor.flush();

      // Final response handling
      if (response && response.trim().length > 0) {
        if (response.length > 2000) {
          // Delete the streaming preview and send properly split messages
          if (messageRef.current) {
            try { await messageRef.current.delete(); } catch (err) { this.log.debug({ error: (err as Error).message }, "failed to delete typing indicator message"); }
          }
          await this.sendResponse(message, response, agentName);
        } else if (messageRef.current) {
          // Final edit with complete text
          await messageRef.current.edit(response);
        } else {
          // No streaming message was created (fast response or no assistant chunks)
          // Send the response as a new message
          await this.sendResponse(message, response, agentName);
        }
        this.log.info({ agent: agentName, channel: channelId, responseLength: response.length }, "agent response sent to Discord");
      } else if (!messageRef.current) {
        this.log.warn({ agent: agentName, channel: channelId }, "agent returned empty response");
      }
    } catch (error) {
      if (typingInterval) {
        clearInterval(typingInterval);
      }
      if (editor) {
        editor.dispose();
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error(
        { agent: agentName, channel: channelId, error: errorMsg },
        "failed to route message",
      );

      // Optionally send error indicator to Discord
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
    parts.unshift(`(replying to message ${message.reference.messageId})`);
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
