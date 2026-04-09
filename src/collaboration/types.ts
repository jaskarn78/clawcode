/**
 * Priority levels for inbox messages.
 * - normal: standard messages, processed in order
 * - high: elevated priority, processed before normal
 * - urgent: immediate attention required
 */
export type MessagePriority = "normal" | "high" | "urgent";

/**
 * A message in an agent's inbox.
 * All fields are readonly to enforce immutability.
 */
export type InboxMessage = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly content: string;
  readonly timestamp: number;
  readonly priority: MessagePriority;
};
