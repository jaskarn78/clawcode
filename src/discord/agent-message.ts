import { EmbedBuilder } from "discord.js";

/** Discord embed description limit. */
const MAX_EMBED_DESCRIPTION = 4096;

/**
 * Build a Discord embed for an agent-to-agent message.
 *
 * @param senderName - Machine name of the sending agent
 * @param senderDisplayName - Human-friendly display name of the sender
 * @param content - Message content (truncated to 4096 chars if too long)
 * @returns Configured EmbedBuilder ready to send via webhook
 */
export function buildAgentMessageEmbed(
  senderName: string,
  senderDisplayName: string,
  content: string,
): EmbedBuilder {
  const description =
    content.length > MAX_EMBED_DESCRIPTION
      ? content.slice(0, MAX_EMBED_DESCRIPTION - 3) + "..."
      : content;

  return new EmbedBuilder()
    .setAuthor({ name: `${senderDisplayName} [Agent]` })
    .setDescription(description)
    .setColor(0x5865F2)
    .setFooter({ text: `Agent-to-agent message from ${senderName}` })
    .setTimestamp();
}
