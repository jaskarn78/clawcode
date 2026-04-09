/**
 * Represents a reaction event from Discord.
 */
export type ReactionEvent = {
  readonly type: "add" | "remove";
  readonly emoji: string;
  readonly userName: string;
  readonly messageId: string;
  readonly channelId: string;
  readonly messageContent?: string;
};

/**
 * Format a reaction event as a structured message for the agent.
 * Uses XML-like tags consistent with the Discord message format.
 *
 * @param event - The reaction event details
 * @returns Formatted string for agent consumption
 */
export function formatReactionEvent(event: ReactionEvent): string {
  const parts = [
    `<reaction type="${event.type}" emoji="${event.emoji}" user="${event.userName}" message_id="${event.messageId}" channel_id="${event.channelId}">`,
  ];

  if (event.messageContent) {
    parts.push(`Original message: ${event.messageContent}`);
  }

  parts.push("</reaction>");

  return parts.join("\n");
}
