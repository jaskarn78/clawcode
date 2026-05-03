/**
 * Shared type definitions for the web dashboard.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Configuration for the dashboard HTTP server.
 */
export type DashboardServerConfig = {
  readonly port: number;
  readonly socketPath: string;
  readonly pollIntervalMs?: number;
  /**
   * Interface to bind the HTTP listener to. Defaults to "127.0.0.1"
   * (localhost only). Set to "0.0.0.0" to expose on all interfaces --
   * only safe when the host is behind a private network boundary
   * (Tailscale, VPN, LAN with firewall). Never expose to the public
   * internet without adding authentication first.
   */
  readonly host?: string;
  /**
   * Phase 61 TRIG-03: Optional webhook handler injected by daemon.ts.
   * Routes POST /webhook/<triggerId> to the WebhookSource's HTTP handler
   * for HMAC verification and event ingestion.
   */
  readonly webhookHandler?: (
    triggerId: string,
    req: IncomingMessage,
    res: ServerResponse,
  ) => Promise<void>;
};

/**
 * Agent status data as presented to the dashboard UI.
 * Merged from registry entries and context zone status.
 *
 * Phase 56 Plan 02 — warm-path fields flow through verbatim from the
 * registry entry (server-emit pattern). The dashboard reads these without
 * computing any thresholds: `warm_path_ready` toggles the badge color,
 * `warm_path_readiness_ms` drives the label. Both are optional so legacy
 * entries (pre-Phase-56) render a neutral '—' badge.
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
  readonly warm_path_ready?: boolean;
  readonly warm_path_readiness_ms?: number | null;
};

/**
 * Full dashboard state snapshot broadcast via SSE.
 */
export type DashboardState = {
  readonly agents: readonly AgentStatusData[];
  readonly updatedAt: number;
};

/**
 * Scheduled task data from the scheduler IPC endpoint.
 */
export type ScheduleData = {
  readonly name: string;
  readonly agentName: string;
  readonly cron: string;
  readonly enabled: boolean;
  readonly lastRun: number | null;
  readonly lastStatus: string;
  readonly lastError: string | null;
  readonly nextRun: number | null;
};

/**
 * Context health check data from the heartbeat IPC endpoint.
 */
export type HealthData = {
  readonly agents: Record<
    string,
    {
      readonly checks: Record<
        string,
        {
          readonly status: string;
          readonly message: string;
          readonly lastChecked: string;
        }
      >;
      readonly overall: string;
      readonly zone?: string;
      readonly fillPercentage?: number;
    }
  >;
};

/**
 * Delivery queue statistics and failed entries.
 */
export type DeliveryQueueData = {
  readonly stats: {
    readonly pending: number;
    readonly inFlight: number;
    readonly failed: number;
    readonly delivered: number;
    readonly totalEnqueued: number;
  };
  readonly failed: ReadonlyArray<{
    readonly id: string;
    readonly agentName: string;
    readonly content: string;
    readonly lastError: string | null;
    readonly createdAt: string;
    readonly attempts: number;
  }>;
};

/**
 * Aggregated memory statistics per agent.
 */
export type MemoryStatsData = {
  readonly agents: Record<
    string,
    {
      readonly entryCount: number;
      readonly episodeCount: number;
      readonly tierDistribution: Record<string, number>;
    }
  >;
};

/**
 * Phase 109-D — fleet-wide observability snapshot.
 *
 * Surfaced via the `fleet-stats` IPC method and the `/api/fleet-stats`
 * dashboard endpoint. All fields are optional/nullable so a host without
 * the underlying source (non-Linux dev machine, broker not running, etc.)
 * still produces a valid response — operators see "unknown" rather than
 * a 500.
 *
 * Back-compat invariant: this type is NOT folded into DashboardState.
 * The existing /api/status payload stays byte-identical so the current
 * dashboard JS keeps rendering. Operators who want fleet-stats poll the
 * new endpoint.
 */
export type FleetStatsData = {
  /** cgroup memory pressure snapshot (Linux only — null on other hosts). */
  readonly cgroup: {
    readonly memoryCurrentBytes: number;
    readonly memoryMaxBytes: number | null;
    readonly memoryPercent: number | null;
  } | null;
  /**
   * Live `claude` proc count (from /proc) minus daemon-tracked agent count.
   * Positive value = orphan claudes the daemon doesn't see (109-B target).
   * null when /proc is unavailable.
   */
  readonly claudeProcDrift: {
    readonly liveCount: number;
    readonly trackedCount: number;
    readonly drift: number;
  } | null;
  /** Per-MCP-cmdline-pattern aggregate (count + summed VmRSS in MB). */
  readonly mcpFleet: ReadonlyArray<{
    readonly pattern: string;
    readonly count: number;
    readonly rssMB: number;
  }>;
  /** Epoch ms — when this snapshot was taken. */
  readonly sampledAt: number;
};

/** A single task edge for the dashboard task graph (OBS-03). */
export type TaskGraphEdge = {
  readonly task_id: string;
  readonly caller_agent: string;
  readonly target_agent: string;
  readonly status: string;
  readonly started_at: number;
  readonly ended_at: number | null;
  readonly chain_token_cost: number;
};

/** Payload for the task-state-change SSE event and /api/tasks endpoint. */
export type TaskGraphData = {
  readonly tasks: readonly TaskGraphEdge[];
};
