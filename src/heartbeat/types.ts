import type { SessionManager } from "../manager/session-manager.js";
import type { Registry } from "../manager/types.js";

/**
 * Health check status values.
 */
export type CheckStatus = "healthy" | "warning" | "critical";

/**
 * Result of a single health check execution.
 */
export type CheckResult = {
  readonly status: CheckStatus;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/**
 * Context provided to each check during execution.
 */
export type CheckContext = {
  readonly agentName: string;
  readonly sessionManager: SessionManager;
  readonly registry: Registry;
  readonly config: HeartbeatConfig;
};

/**
 * A discoverable health check module.
 * Each check file exports a default CheckModule.
 */
export type CheckModule = {
  readonly name: string;
  readonly interval?: number;
  readonly execute: (context: CheckContext) => Promise<CheckResult>;
};

/**
 * Resolved heartbeat configuration from the config schema.
 */
export type HeartbeatConfig = {
  readonly enabled: boolean;
  readonly intervalSeconds: number;
  readonly checkTimeoutSeconds: number;
  readonly contextFill: {
    readonly warningThreshold: number;
    readonly criticalThreshold: number;
  };
};

/**
 * A single NDJSON log entry written to heartbeat.log.
 */
export type HeartbeatLogEntry = {
  readonly timestamp: string;
  readonly agent: string;
  readonly check: string;
  readonly status: CheckStatus;
  readonly message: string;
  readonly metadata?: Record<string, unknown>;
};
