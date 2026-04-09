import {
  Client,
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

/**
 * Configuration for the Discord bridge.
 */
export type BridgeConfig = {
  readonly routingTable: RoutingTable;
  readonly sessionManager: SessionManager;
  readonly threadManager?: ThreadManager;
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
    // Fall through to env var check
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
  private readonly botToken: string;
  private readonly log: Logger;
  private running = false;
  private readonly recentlySent: Set<string> = new Set();

  constructor(config: BridgeConfig) {
    this.routingTable = config.routingTable;
    this.sessionManager = config.sessionManager;
    this.threadManager = config.threadManager;
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
    this.running = true;
  }

  /**
   * Stop the bridge — disconnect from Discord.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
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
    // Ignore bot messages (including our own)
    if (message.author.bot) {
      return;
    }

    // Thread routing takes priority over channel routing (per D-09)
    if (this.threadManager && message.channel.isThread()) {
      const sessionName = await this.threadManager.routeMessage(message.channelId);
      if (sessionName) {
        // Download attachments for thread messages the same way as channel messages
        let downloadResults: readonly DownloadResult[] | undefined;
        if (message.attachments.size > 0) {
          const attachments = extractAttachments(message.attachments);
          downloadResults = await downloadAllAttachments(attachments, "/tmp/thread-attachments", this.log);
        }

        const formattedMessage = formatDiscordMessage(message, downloadResults);
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

    this.log.info(
      {
        channel: channelId,
        agent: agentName,
        user: message.author.username,
        messageId: message.id,
      },
      "routing message to agent",
    );

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

      // One-way forward: send message to agent, let it reply via its own Discord plugin.
      // The agent's Claude Code session inherits the Discord MCP plugin and will
      // use the reply tool directly. We do NOT send responses from the bridge
      // to avoid duplicate messages.
      await this.sessionManager.forwardToAgent(agentName, formattedMessage);

      this.log.info({ agent: agentName, channel: channelId }, "message forwarded to agent");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error(
        { agent: agentName, channel: channelId, error: errorMsg },
        "failed to route message",
      );

      // Optionally send error indicator to Discord
      try {
        await message.react("❌");
      } catch {
        // Ignore reaction failure
      }
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
  private async sendResponse(
    originalMessage: Message,
    response: string,
  ): Promise<void> {
    // Deduplicate — don't send the same response twice within 5s
    const dedupeKey = `${originalMessage.channelId}:${response.slice(0, 100)}`;
    if (this.recentlySent.has(dedupeKey)) {
      return;
    }
    this.recentlySent.add(dedupeKey);
    setTimeout(() => this.recentlySent.delete(dedupeKey), 5000);

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
