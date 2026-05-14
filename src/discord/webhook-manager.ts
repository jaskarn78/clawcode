import { WebhookClient, type EmbedBuilder } from "discord.js";
import type { WebhookIdentity } from "./webhook-types.js";
import { logger } from "../shared/logger.js";
import { wrapMarkdownTablesInCodeFence } from "./markdown-table-wrap.js";
import type { Logger } from "pino";

/** Maximum Discord message length. */
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Reprovisioner closure shape. Called when a webhook send fails with a
 * Discord 401 (revoked) or 404 (deleted) so the manager can request a fresh
 * webhook URL for the agent. Returns the new identity or `undefined` if
 * reprovisioning is not possible (no channel, Discord-side error). Phase 119
 * A2A-02 — kept as a DI seam so the manager stays decoupled from the Discord
 * Client and the provisioning helper lives in webhook-provisioner.ts.
 */
export type WebhookReprovisioner = (
  agentName: string,
) => Promise<WebhookIdentity | undefined>;

/**
 * Configuration for creating a WebhookManager.
 */
export type WebhookManagerConfig = {
  readonly identities: ReadonlyMap<string, WebhookIdentity>;
  readonly log?: Logger;
  /**
   * Phase 119 A2A-02 — optional reprovisioner. When set, sendAsAgent
   * recovers from Discord 401/404 by calling this to obtain a fresh
   * webhook URL, then retrying the send ONCE with the new identity.
   * Bounded retry — second failure surfaces normally.
   */
  readonly reprovisionWebhook?: WebhookReprovisioner;
};

/**
 * Manages webhook-based message delivery for agents.
 * Each agent with a configured webhook URL sends messages
 * with its own display name and avatar instead of using the bot identity.
 */
export class WebhookManager {
  private readonly identities: Map<string, WebhookIdentity>;
  private readonly clients: Map<string, WebhookClient> = new Map();
  private readonly log: Logger;
  private readonly reprovisionWebhook?: WebhookReprovisioner;

  constructor(config: WebhookManagerConfig) {
    this.identities = new Map(config.identities);
    this.log = config.log ?? logger;
    this.reprovisionWebhook = config.reprovisionWebhook;
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
    // Wrap raw markdown tables in ```text``` code fences so Discord renders
    // them as monospace. wrapMarkdownTablesInCodeFence is pure + idempotent
    // (already-fenced content passes through unchanged), so callers that
    // pre-wrap or send pure prose are unaffected. Closes the regression
    // gap left by Phase 100-fu where bridge.ts:917 sendDirect fallback,
    // daemon.ts:3544, and usage/daily-summary.ts:111 reached webhook
    // delivery without the wrap.
    const wrapped = wrapMarkdownTablesInCodeFence(content);
    const chunks = splitMessage(wrapped, MAX_MESSAGE_LENGTH);

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
    try {
      return await this.attemptSendAsAgent(
        targetAgent,
        identity.webhookUrl,
        senderDisplayName,
        senderAvatarUrl,
        embed,
      );
    } catch (err) {
      const code = extractDiscordStatusCode(err);
      if (
        (code === 401 || code === 404) &&
        this.reprovisionWebhook
      ) {
        this.log.warn(
          { channel: targetAgent, code, action: "invalidate-and-reprovision" },
          "webhook 401/404 — invalidating cache and reprovisioning once",
        );
        this.invalidate(targetAgent);
        const fresh = await this.reprovisionWebhook(targetAgent);
        if (!fresh) {
          throw err;
        }
        this.identities.set(targetAgent, fresh);
        return await this.attemptSendAsAgent(
          targetAgent,
          fresh.webhookUrl,
          senderDisplayName,
          senderAvatarUrl,
          embed,
        );
      }
      throw err;
    }
  }

  /**
   * Phase 119 A2A-02 — drop the cached identity + WebhookClient for an agent.
   * Used by the 401/404 reprovision-once retry path. Idempotent.
   */
  invalidate(agentName: string): void {
    this.identities.delete(agentName);
    const client = this.clients.get(agentName);
    if (client) {
      client.destroy();
      this.clients.delete(agentName);
    }
  }

  private async attemptSendAsAgent(
    targetAgent: string,
    webhookUrl: string,
    senderDisplayName: string,
    senderAvatarUrl: string | undefined,
    embed: EmbedBuilder,
  ): Promise<string> {
    const client = this.getOrCreateClient(targetAgent, webhookUrl);
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
 * Phase 119 A2A-02 — pull the HTTP status code off a discord.js
 * DiscordAPIError. discord.js v14 exposes both `status` (HTTP code) and
 * `code` (Discord error code). Either may match 401/404 depending on the
 * error path; we check both and return whichever is the HTTP-status-shape.
 */
function extractDiscordStatusCode(err: unknown): number | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const candidate = err as { status?: unknown; code?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.code === "number") return candidate.code;
  return undefined;
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
