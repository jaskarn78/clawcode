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
 * 24h idle timeout, max 3 concurrent thread sessions per agent.
 *
 * Phase 99 sub-scope N (2026-04-26) — lowered from 10 to 3 to cap
 * blast-radius if Layer 1 disallowedTools is somehow bypassed (e.g. SDK
 * regression, manual config tampering). Operator can override per-agent
 * in clawcode.yaml `threads.maxThreadSessions`. Real incident: a 5-deep
 * Admin Clawdy subagent chain spawned by a single operator task — under
 * the old default of 10, the chain could have grown twice as deep before
 * the per-agent cap stopped it.
 */
export const DEFAULT_THREAD_CONFIG: ThreadConfig = {
  idleTimeoutMinutes: 1440,
  maxThreadSessions: 3,
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
