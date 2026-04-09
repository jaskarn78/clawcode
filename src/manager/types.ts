/**
 * Agent lifecycle status — represents the state machine for each agent.
 * Transitions: stopped -> starting -> running -> stopping -> stopped
 * Error path: running -> crashed -> restarting -> starting
 * Terminal: crashed -> failed (after max retries)
 */
export type AgentStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "crashed"
  | "restarting"
  | "failed";

/**
 * A single agent's entry in the persistent registry.
 * All fields are readonly — updates produce new objects.
 */
export type RegistryEntry = {
  readonly name: string;
  readonly status: AgentStatus;
  readonly sessionId: string | null;
  readonly startedAt: number | null;
  readonly restartCount: number;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  readonly lastStableAt: number | null;
};

/**
 * The full registry — an immutable collection of agent entries.
 */
export type Registry = {
  readonly entries: readonly RegistryEntry[];
  readonly updatedAt: number;
};

/**
 * Configuration for the exponential backoff calculator.
 */
export type BackoffConfig = {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly maxRetries: number;
  readonly stableAfterMs: number;
};

/**
 * Configuration passed to the SessionAdapter when creating a session.
 */
export type AgentSessionConfig = {
  readonly name: string;
  readonly model: "sonnet" | "opus" | "haiku";
  readonly workspace: string;
  readonly systemPrompt: string;
};

/**
 * Default backoff configuration per D-12, D-13, D-14:
 * - 1s base delay
 * - 5 minute cap
 * - 10 max retries
 * - 5 minute stability window
 */
export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseMs: 1_000,
  maxMs: 300_000,
  maxRetries: 10,
  stableAfterMs: 300_000,
} as const;
