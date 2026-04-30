import type { SessionManager } from "../manager/session-manager.js";
import type { Registry } from "../manager/types.js";
import type { ThreadManager } from "../discord/thread-manager.js";
import type { TaskStore } from "../tasks/store.js";
import type { SecretsResolver } from "../manager/secrets-resolver.js";

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
  readonly threadManager?: ThreadManager;
  readonly taskStore?: TaskStore;
  /**
   * Phase 999.10 plan 03 (SEC-05) — exposed to checks that build
   * RecoveryDeps so the op-refresh recovery handler can invalidate the
   * secrets cache before re-resolving stale auth-error values. Optional
   * because most checks (auto-linker, fs-probe, etc.) don't need it; only
   * mcp-reconnect builds RecoveryDeps. Tests for those unrelated checks
   * leave it undefined and continue working unchanged.
   */
  readonly secretsResolver?: SecretsResolver;
};

/**
 * A discoverable health check module.
 * Each check file exports a default CheckModule.
 */
export type CheckModule = {
  readonly name: string;
  readonly interval?: number;
  readonly timeout?: number; // Per-check timeout in seconds. Overrides config.checkTimeoutSeconds.
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
    readonly zoneThresholds?: {
      readonly yellow: number;
      readonly orange: number;
      readonly red: number;
    };
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
