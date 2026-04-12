import { WebhookClient, type EmbedBuilder } from "discord.js";
import type { WebhookIdentity } from "./webhook-types.js";
import { logger } from "../shared/logger.js";
import type { Logger } from "pino";

/** Maximum Discord message length. */
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Configuration for creating a WebhookManager.
 */
export type WebhookManagerConfig = {
  readonly identities: ReadonlyMap<string, WebhookIdentity>;
  readonly log?: Logger;
};

/**
 * Manages webhook-based message delivery for agents.
 * Each agent with a configured webhook URL sends messages
 * with its own display name and avatar instead of using the bot identity.
 */
export class WebhookManager {
  private readonly identities: ReadonlyMap<string, WebhookIdentity>;
  private readonly clients: Map<string, WebhookClient> = new Map();
  private readonly log: Logger;

  constructor(config: WebhookManagerConfig) {
    this.identities = config.identities;
    this.log = config.log ?? logger;
  }

  /**
   * Check whether an agent has a webhook identity configured.
   */
  hasWebhook(agentName: string): boolean {
    return this.identities.has(agentName);
  }

  /**
   * Get the webhook identity for an agent, or undefined if not configured.
   */
  getIdentity(agentName: string): WebhookIdentity | undefined {
    return this.identities.get(agentName);
  }

  /**
   * Send a message via the agent's webhook.
   * Handles message splitting for content over 2000 characters.
   *
   * @throws Error if the agent has no webhook configured
   */
  async send(agentName: string, content: string): Promise<void> {
    const identity = this.identities.get(agentName);
    if (!identity) {
      throw new Error(`No webhook identity configured for agent '${agentName}'`);
    }

    const client = this.getOrCreateClient(agentName, identity.webhookUrl);
    const chunks = splitMessage(content, MAX_MESSAGE_LENGTH);

    for (const chunk of chunks) {
      await client.send({
        content: chunk,
        username: identity.displayName,
        avatarURL: identity.avatarUrl ?? undefined,
      });
    }

    this.log.info(
      { agent: agentName, chunks: chunks.length },
      "webhook message sent",
    );
  }

  /**
   * Send an embed to a target agent's channel using the sender's identity.
   * Used for agent-to-agent messages where the embed appears in the target's channel
   * but shows the sender's display name and avatar.
   *
   * @param targetAgent - Name of the target agent whose channel receives the embed
   * @param senderDisplayName - Display name shown as the webhook username
   * @param senderAvatarUrl - Avatar URL for the webhook message (optional)
   * @param embed - The EmbedBuilder to send
   * @returns The Discord message ID
   * @throws Error if target agent has no webhook configured
   */
  async sendAsAgent(
    targetAgent: string,
    senderDisplayName: string,
    senderAvatarUrl: string | undefined,
    embed: EmbedBuilder,
  ): Promise<string> {
    const identity = this.identities.get(targetAgent);
    if (!identity) {
      throw new Error(
        `No webhook identity configured for target agent '${targetAgent}'`,
      );
    }
    const client = this.getOrCreateClient(targetAgent, identity.webhookUrl);
    const result = await client.send({
      embeds: [embed],
      username: senderDisplayName,
      avatarURL: senderAvatarUrl ?? undefined,
    });
    this.log.info(
      { target: targetAgent, sender: senderDisplayName },
      "agent-to-agent embed sent",
    );
    return typeof result === "string" ? result : result.id;
  }

  /**
   * Destroy all cached webhook clients. Call on shutdown.
   */
  destroy(): void {
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
  }

  /**
   * Get or create a cached WebhookClient for an agent.
   */
  private getOrCreateClient(agentName: string, url: string): WebhookClient {
    let client = this.clients.get(agentName);
    if (!client) {
      client = new WebhookClient({ url });
      this.clients.set(agentName, client);
    }
    return client;
  }
}

/**
 * Split a long message into chunks respecting the max length.
 * Tries to split on newlines, falls back to space, then hard split.
 *
 * Exported for testing.
 */
export function splitMessage(
  text: string,
  maxLength: number,
): readonly string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex <= 0 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex <= 0 || splitIndex < maxLength / 2) {
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

/**
 * Build the identities map from resolved agent configs.
 * Only includes agents that have a webhook config with a webhookUrl.
 */
export function buildWebhookIdentities(
  agents: readonly { readonly name: string; readonly webhook?: { readonly displayName: string; readonly avatarUrl?: string; readonly webhookUrl?: string } }[],
): Map<string, WebhookIdentity> {
  const identities = new Map<string, WebhookIdentity>();

  for (const agent of agents) {
    if (agent.webhook?.webhookUrl) {
      identities.set(agent.name, {
        displayName: agent.webhook.displayName,
        avatarUrl: agent.webhook.avatarUrl,
        webhookUrl: agent.webhook.webhookUrl,
      });
    }
  }

  return identities;
}
