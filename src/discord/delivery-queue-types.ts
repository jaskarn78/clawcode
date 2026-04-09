/**
 * Types and constants for the Discord delivery queue system.
 * Messages are persisted to SQLite before delivery, enabling retry on failure.
 */

/**
 * Status of a delivery queue entry through its lifecycle.
 */
export type DeliveryStatus = "pending" | "in_flight" | "failed" | "delivered";

/**
 * A single entry in the delivery queue.
 * Immutable -- new objects are created for state transitions.
 */
export type DeliveryEntry = {
  readonly id: string;
  readonly agentName: string;
  readonly channelId: string;
  readonly content: string;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly lastAttemptAt: string | null;
  readonly nextRetryAt: string | null;
  readonly lastError: string | null;
  readonly deliveredAt: string | null;
};

/**
 * Configuration for the delivery queue behavior.
 */
export type DeliveryQueueConfig = {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly processingIntervalMs: number;
};

/**
 * Default delivery queue configuration.
 * - maxAttempts: 3 retries before permanent failure
 * - baseDelayMs: 1s initial retry delay
 * - maxDelayMs: 30s maximum retry delay
 * - processingIntervalMs: 500ms polling interval
 */
export const DEFAULT_DELIVERY_QUEUE_CONFIG: DeliveryQueueConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  processingIntervalMs: 500,
} as const;

/**
 * Aggregate statistics for the delivery queue.
 */
export type DeliveryStats = {
  readonly pending: number;
  readonly inFlight: number;
  readonly failed: number;
  readonly delivered: number;
  readonly totalEnqueued: number;
};

/**
 * Function signature for the actual message delivery mechanism.
 * Accepts agent name, channel ID, and content; throws on failure.
 */
export type DeliverFn = (
  agentName: string,
  channelId: string,
  content: string,
) => Promise<void>;
