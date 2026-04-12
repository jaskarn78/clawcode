import type { Client } from "discord.js";
import type { WebhookIdentity } from "./webhook-types.js";
import type { Logger } from "pino";

/**
 * Configuration for auto-provisioning webhooks.
 */
export type ProvisionConfig = {
  readonly client: Client;
  readonly agents: readonly {
    readonly name: string;
    readonly channels: readonly string[];
    readonly webhook?: {
      readonly displayName: string;
      readonly avatarUrl?: string;
      readonly webhookUrl?: string;
    };
  }[];
  readonly manualIdentities: ReadonlyMap<string, WebhookIdentity>;
  readonly log: Logger;
};

/**
 * Auto-provision Discord webhooks for agents that have a displayName
 * but no manual webhookUrl. Reuses existing bot-owned webhooks when
 * found on the channel to avoid duplication.
 *
 * Returns a merged map of all webhook identities (manual + auto-provisioned).
 * Per-agent errors are caught and logged, never thrown.
 */
export async function provisionWebhooks(
  config: ProvisionConfig,
): Promise<Map<string, WebhookIdentity>> {
  const { client, agents, manualIdentities, log } = config;
  const result = new Map<string, WebhookIdentity>(manualIdentities);

  for (const agent of agents) {
    // Skip agents that already have a manual webhook URL
    if (result.has(agent.name)) {
      continue;
    }

    // Skip agents with no webhook config (no displayName)
    if (!agent.webhook) {
      continue;
    }

    // Skip agents with no bound channels
    if (agent.channels.length === 0) {
      continue;
    }

    try {
      const channelId = agent.channels[0];
      const channel = await client.channels.fetch(channelId);

      // Verify channel supports webhooks (text-based guild channel)
      if (!channel || !("fetchWebhooks" in channel) || typeof (channel as unknown as Record<string, unknown>).fetchWebhooks !== "function") {
        log.warn(
          { agent: agent.name, channelId },
          "channel does not support webhooks, skipping auto-provision",
        );
        continue;
      }

      const textChannel = channel as {
        fetchWebhooks: () => Promise<Map<string, { owner?: { id: string }; url: string }>>;
        createWebhook: (opts: { name: string; avatar: string | null }) => Promise<{ url: string }>;
      };

      const existingWebhooks = await textChannel.fetchWebhooks();
      const botId = client.user?.id;

      // Look for an existing webhook owned by this bot
      let webhookUrl: string | undefined;
      for (const [, webhook] of existingWebhooks) {
        if (webhook.owner?.id === botId) {
          webhookUrl = webhook.url;
          break;
        }
      }

      // Create a new webhook if none found
      if (!webhookUrl) {
        const created = await textChannel.createWebhook({
          name: agent.webhook.displayName,
          avatar: agent.webhook.avatarUrl ?? null,
        });
        webhookUrl = created.url;
        log.info(
          { agent: agent.name, channelId },
          "auto-provisioned new webhook",
        );
      } else {
        log.info(
          { agent: agent.name, channelId },
          "reusing existing bot-owned webhook",
        );
      }

      result.set(agent.name, {
        displayName: agent.webhook.displayName,
        avatarUrl: agent.webhook.avatarUrl,
        webhookUrl,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(
        { agent: agent.name, error: errorMsg },
        "failed to auto-provision webhook, skipping agent",
      );
    }
  }

  return result;
}
