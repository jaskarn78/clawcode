/**
 * A webhook identity for an agent — allows agents to post
 * to Discord with their own display name and avatar.
 */
export type WebhookIdentity = {
  readonly displayName: string;
  readonly avatarUrl: string | undefined;
  readonly webhookUrl: string;
};

/**
 * Webhook configuration from clawcode.yaml.
 * webhookUrl is optional — if omitted, the agent uses the bot identity.
 */
export type WebhookConfig = {
  readonly displayName: string;
  readonly avatarUrl: string | undefined;
  readonly webhookUrl: string | undefined;
};
