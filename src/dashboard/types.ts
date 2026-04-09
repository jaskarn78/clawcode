/**
 * Shared type definitions for the web dashboard.
 */

/**
 * Configuration for the dashboard HTTP server.
 */
export type DashboardServerConfig = {
  readonly port: number;
  readonly socketPath: string;
  readonly pollIntervalMs?: number;
};

/**
 * Agent status data as presented to the dashboard UI.
 * Merged from registry entries and context zone status.
 */
export type AgentStatusData = {
  readonly name: string;
  readonly status: string;
  readonly uptime: number | null;
  readonly startedAt: number | null;
  readonly restartCount: number;
  readonly lastError: string | null;
  readonly zone: string | null;
  readonly fillPercentage: number | null;
  readonly model?: string;
  readonly channels?: readonly string[];
};

/**
 * Full dashboard state snapshot broadcast via SSE.
 */
export type DashboardState = {
  readonly agents: readonly AgentStatusData[];
  readonly updatedAt: number;
};
