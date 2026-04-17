/**
 * SSE (Server-Sent Events) connection manager.
 * Polls daemon IPC for agent status and broadcasts to connected clients.
 */

import type { ServerResponse } from "node:http";
import type { Logger } from "pino";
import { sendIpcRequest } from "../ipc/client.js";
import type {
  AgentStatusData,
  DashboardState,
  ScheduleData,
  HealthData,
  DeliveryQueueData,
  MemoryStatsData,
} from "./types.js";

type SseManagerConfig = {
  readonly socketPath: string;
  readonly pollIntervalMs: number;
  readonly log: Logger;
};

/** Memory stats are polled less frequently (every 15s). */
const MEMORY_POLL_INTERVAL_MS = 15_000;

/**
 * Manages SSE client connections and periodic polling of agent status.
 */
export class SseManager {
  private readonly clients = new Set<ServerResponse>();
  private readonly socketPath: string;
  private readonly pollIntervalMs: number;
  private readonly log: Logger;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private memoryIntervalId: ReturnType<typeof setInterval> | null = null;

  /** Cached agent names from the last status poll (used for memory queries). */
  private lastAgentNames: readonly string[] = [];

  constructor(config: SseManagerConfig) {
    this.socketPath = config.socketPath;
    this.pollIntervalMs = config.pollIntervalMs;
    this.log = config.log;
  }

  /**
   * Add an SSE client connection. Sets appropriate headers and
   * removes the client on close.
   */
  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.write(":keepalive\n\n");

    this.clients.add(res);
    this.log.debug({ clientCount: this.clients.size }, "SSE client connected");

    res.on("close", () => {
      this.clients.delete(res);
      this.log.debug({ clientCount: this.clients.size }, "SSE client disconnected");
    });
  }

  /**
   * Broadcast an event to all connected SSE clients.
   */
  broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
  }

  /**
   * Start periodic polling of daemon IPC for agent status.
   */
  start(): void {
    if (this.intervalId !== null) return;

    // Primary poll: agent status, schedules, health, delivery queue
    this.intervalId = setInterval(() => {
      void this.pollAndBroadcast();
    }, this.pollIntervalMs);

    // Slower poll: memory stats (every 15s)
    this.memoryIntervalId = setInterval(() => {
      void this.pollMemoryStats();
    }, MEMORY_POLL_INTERVAL_MS);

    this.log.info({ pollIntervalMs: this.pollIntervalMs }, "SSE polling started");
  }

  /**
   * Stop polling.
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.memoryIntervalId !== null) {
      clearInterval(this.memoryIntervalId);
      this.memoryIntervalId = null;
    }
    this.log.info("SSE polling stopped");
  }

  /**
   * Fetch current status from daemon and broadcast to all SSE clients.
   * Exported for direct use by the /api/status endpoint.
   */
  async fetchCurrentState(): Promise<DashboardState> {
    const [statusResult, zoneResult] = await Promise.all([
      sendIpcRequest(this.socketPath, "status", {}),
      sendIpcRequest(this.socketPath, "context-zone-status", {}).catch(() => ({
        agents: {},
      })),
    ]);

    const statusData = statusResult as {
      entries: ReadonlyArray<{
        name: string;
        status: string;
        startedAt: number | null;
        restartCount: number;
        lastError: string | null;
        // Phase 56 Plan 02 — optional passthrough from the registry.
        warm_path_ready?: boolean;
        warm_path_readiness_ms?: number | null;
      }>;
    };

    const zoneData = zoneResult as {
      agents: Record<string, { zone: string; fillPercentage: number }>;
    };

    const agents: AgentStatusData[] = statusData.entries.map((entry) => {
      const zoneInfo = zoneData.agents[entry.name];
      const uptime =
        entry.startedAt !== null ? Date.now() - entry.startedAt : null;

      return {
        name: entry.name,
        status: entry.status,
        uptime,
        startedAt: entry.startedAt,
        restartCount: entry.restartCount,
        lastError: entry.lastError,
        zone: zoneInfo?.zone ?? null,
        fillPercentage: zoneInfo?.fillPercentage ?? null,
        // Phase 56 Plan 02 — warm-path fields flow verbatim from the daemon.
        // Server-emit pattern: no client-side threshold logic anywhere.
        warm_path_ready: entry.warm_path_ready,
        warm_path_readiness_ms: entry.warm_path_readiness_ms,
      };
    });

    // Cache agent names for memory poll
    this.lastAgentNames = agents.map((a) => a.name);

    return {
      agents,
      updatedAt: Date.now(),
    };
  }

  /**
   * Fetch schedule data from daemon.
   */
  async fetchSchedules(): Promise<{ schedules: readonly ScheduleData[] }> {
    const result = await sendIpcRequest(this.socketPath, "schedules", {});
    return result as { schedules: readonly ScheduleData[] };
  }

  /**
   * Fetch health/heartbeat data from daemon.
   */
  async fetchHealth(): Promise<HealthData> {
    const result = await sendIpcRequest(this.socketPath, "heartbeat-status", {});
    return result as HealthData;
  }

  /**
   * Fetch delivery queue status from daemon.
   */
  async fetchDeliveryQueue(): Promise<DeliveryQueueData> {
    const result = await sendIpcRequest(this.socketPath, "delivery-queue-status", {});
    return result as DeliveryQueueData;
  }

  /**
   * Poll daemon and broadcast agent status plus additional data to all connected clients.
   */
  private async pollAndBroadcast(): Promise<void> {
    // Agent status (primary)
    try {
      const state = await this.fetchCurrentState();
      this.broadcast("agent-status", state);
    } catch (err) {
      this.log.warn({ err }, "Failed to poll daemon for dashboard");
      this.broadcast("error", { message: "Daemon not reachable" });
    }

    // Schedules
    try {
      const schedules = await this.fetchSchedules();
      this.broadcast("schedules", schedules);
    } catch (err) {
      this.log.debug({ err }, "Failed to poll schedules");
    }

    // Health
    try {
      const health = await this.fetchHealth();
      this.broadcast("health", health);
    } catch (err) {
      this.log.debug({ err }, "Failed to poll health");
    }

    // Delivery queue
    try {
      const deliveryQueue = await this.fetchDeliveryQueue();
      this.broadcast("delivery-queue", deliveryQueue);
    } catch (err) {
      this.log.debug({ err }, "Failed to poll delivery queue");
    }

    // Task graph (Phase 63 OBS-03)
    try {
      const taskData = await sendIpcRequest(this.socketPath, "list-tasks", {});
      this.broadcast("task-state-change", taskData);
    } catch (err) {
      this.log.debug({ err }, "Failed to poll tasks");
    }
  }

  /**
   * Poll per-agent memory stats (slower interval).
   */
  private async pollMemoryStats(): Promise<void> {
    const agentNames = [...this.lastAgentNames];
    if (agentNames.length === 0) return;

    const agents: Record<
      string,
      { entryCount: number; episodeCount: number; tierDistribution: Record<string, number> }
    > = {};

    const results = await Promise.allSettled(
      agentNames.map(async (name) => {
        const [memResult, epResult] = await Promise.all([
          sendIpcRequest(this.socketPath, "memory-list", { agent: name, limit: 1 }),
          sendIpcRequest(this.socketPath, "episode-list", { agent: name, count: true }),
        ]);

        const memData = memResult as {
          entries: ReadonlyArray<{ tier?: string }>;
          totalCount?: number;
          tierCounts?: Record<string, number>;
        };
        const epData = epResult as { count: number };

        return {
          name,
          entryCount: memData.totalCount ?? memData.entries?.length ?? 0,
          episodeCount: epData.count ?? 0,
          tierDistribution: memData.tierCounts ?? {},
        };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { name, ...stats } = result.value;
        agents[name] = stats;
      }
    }

    const memoryStats: MemoryStatsData = { agents };
    this.broadcast("memory-stats", memoryStats);
  }
}
