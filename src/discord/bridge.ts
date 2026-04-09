import {
  Client,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../shared/logger.js";
import type { RoutingTable } from "./types.js";
import type { SessionManager } from "../manager/session-manager.js";
import type { Logger } from "pino";

/**
 * Configuration for the Discord bridge.
 */
export type BridgeConfig = {
  readonly routingTable: RoutingTable;
  readonly sessionManager: SessionManager;
  readonly botToken?: string;
  readonly log?: Logger;
};

/**
 * Load the Discord bot token from the standard Claude Code location.
 */
function loadBotToken(): string {
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
  private readonly botToken: string;
  private readonly log: Logger;
  private running = false;
  private readonly recentlySent: Set<string> = new Set();

  constructor(config: BridgeConfig) {
    this.routingTable = config.routingTable;
    this.sessionManager = config.sessionManager;
    this.botToken = config.botToken ?? loadBotToken();
    this.log = config.log ?? logger;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
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
      // Format message for the agent (include Discord context)
      const formattedMessage = formatDiscordMessage(message);

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
 */
function formatDiscordMessage(message: Message): string {
  const parts = [
    `<channel source="discord" chat_id="${message.channelId}" message_id="${message.id}" user="${message.author.username}" ts="${message.createdAt.toISOString()}">`,
    message.content,
    `</channel>`,
  ];

  // Include attachments if any
  if (message.attachments.size > 0) {
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
