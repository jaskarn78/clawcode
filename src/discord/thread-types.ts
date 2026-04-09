import { join } from "node:path";
import { homedir } from "node:os";

/**
 * A single thread-to-agent binding.
 * Maps a Discord thread to an agent session for message routing.
 */
export type ThreadBinding = {
  readonly threadId: string;
  readonly parentChannelId: string;
  readonly agentName: string;
  readonly sessionName: string;
  readonly createdAt: number;
  readonly lastActivity: number;
};

/**
 * The full thread binding registry -- an immutable collection of bindings.
 */
export type ThreadBindingRegistry = {
  readonly bindings: readonly ThreadBinding[];
  readonly updatedAt: number;
};

/**
 * Per-agent thread configuration.
 */
export type ThreadConfig = {
  readonly idleTimeoutMinutes: number;
  readonly maxThreadSessions: number;
};

/**
 * Default thread configuration values.
 * 24h idle timeout, max 10 concurrent thread sessions per agent.
 */
export const DEFAULT_THREAD_CONFIG: ThreadConfig = {
  idleTimeoutMinutes: 1440,
  maxThreadSessions: 10,
} as const;

/**
 * Default path for the thread bindings registry file.
 */
export const THREAD_REGISTRY_PATH: string = join(
  homedir(),
  ".clawcode",
  "manager",
  "thread-bindings.json",
);
