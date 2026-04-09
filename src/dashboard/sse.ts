/**
 * SSE (Server-Sent Events) connection manager.
 * Polls daemon IPC for agent status and broadcasts to connected clients.
 */

import type { ServerResponse } from "node:http";
import type { Logger } from "pino";
import { sendIpcRequest } from "../ipc/client.js";
import type { AgentStatusData, DashboardState } from "./types.js";

type SseManagerConfig = {
  readonly socketPath: string;
  readonly pollIntervalMs: number;
  readonly log: Logger;
};

/**
 * Manages SSE client connections and periodic polling of agent status.
 */
export class SseManager {
  private readonly clients = new Set<ServerResponse>();
  private readonly socketPath: string;
  private readonly pollIntervalMs: number;
  private readonly log: Logger;
  private intervalId: ReturnType<typeof setInterval> | null = null;

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
    this.intervalId = setInterval(() => {
      void this.pollAndBroadcast();
    }, this.pollIntervalMs);
    this.log.info({ pollIntervalMs: this.pollIntervalMs }, "SSE polling started");
  }

  /**
   * Stop polling.
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.log.info("SSE polling stopped");
    }
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
      };
    });

    return {
      agents,
      updatedAt: Date.now(),
    };
  }

  /**
   * Poll daemon and broadcast agent status to all connected clients.
   */
  private async pollAndBroadcast(): Promise<void> {
    try {
      const state = await this.fetchCurrentState();
      this.broadcast("agent-status", state);
    } catch (err) {
      this.log.warn({ err }, "Failed to poll daemon for dashboard");
      this.broadcast("error", { message: "Daemon not reachable" });
    }
  }
}
