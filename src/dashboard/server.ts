/**
 * Dashboard HTTP server using Node.js built-in http module.
 * Serves static files, SSE endpoint, and REST API for agent control.
 * No external HTTP framework dependencies.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { sendIpcRequest } from "../ipc/client.js";
import { SseManager } from "./sse.js";
import type { DashboardServerConfig } from "./types.js";

// Runtime lives in dist/cli/ after bundling; static assets are copied to
// dist/dashboard/static by the build script.
const STATIC_DIR = join(import.meta.dirname, "..", "dashboard", "static");

const DEFAULT_POLL_INTERVAL_MS = 3000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

/**
 * Parse URL pathname and extract route segments.
 */
function parseRoute(url: string | undefined): { pathname: string; segments: readonly string[] } {
  const pathname = (url ?? "/").split("?")[0] ?? "/";
  const segments = pathname.split("/").filter(Boolean);
  return { pathname, segments };
}

/**
 * Send a JSON response.
 */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Serve a static file from the static directory.
 */
async function serveStatic(
  res: ServerResponse,
  filename: string,
  contentType: string,
): Promise<void> {
  try {
    const filePath = join(STATIC_DIR, filename);
    const content = await readFile(filePath, "utf-8");
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": Buffer.byteLength(content),
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

/**
 * Start the dashboard HTTP server.
 *
 * @returns Object with server, sseManager, and close function
 */
export async function startDashboardServer(config: DashboardServerConfig): Promise<{
  readonly server: ReturnType<typeof createServer>;
  readonly sseManager: SseManager;
  readonly close: () => Promise<void>;
}> {
  const log = pino({ name: "dashboard", level: "info" });
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const sseManager = new SseManager({
    socketPath: config.socketPath,
    pollIntervalMs,
    log,
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, sseManager, config.socketPath, log, config.webhookHandler);
  });

  sseManager.start();

  const host = config.host ?? "127.0.0.1";
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(config.port, host, () => {
      log.info({ port: config.port, host }, "Dashboard server started");
      resolve({
        server,
        sseManager,
        close: async () => {
          sseManager.stop();
          return new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          });
        },
      });
    });
  });
}

/**
 * Route incoming HTTP requests.
 */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sseManager: SseManager,
  socketPath: string,
  log: Logger,
  webhookHandler?: DashboardServerConfig["webhookHandler"],
): Promise<void> {
  const method = req.method ?? "GET";
  const { pathname, segments } = parseRoute(req.url);

  try {
    // Static file routes
    if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      await serveStatic(res, "index.html", MIME_TYPES[".html"]!);
      return;
    }

    if (method === "GET" && pathname === "/styles.css") {
      await serveStatic(res, "styles.css", MIME_TYPES[".css"]!);
      return;
    }

    if (method === "GET" && pathname === "/app.js") {
      await serveStatic(res, "app.js", MIME_TYPES[".js"]!);
      return;
    }

    // Phase 999.8 Plan 02 follow-up — graph-color.js is imported as an ES
    // module by graph.html via `import { nodeClr } from "./graph-color.js"`.
    // Browsers resolve "./graph-color.js" relative to the URL `/graph` →
    // `/graph-color.js`. Without this explicit route the request 404s and
    // the entire `<script type="module">` block fails to execute, leaving
    // the graph blank and the menu wiring inert. Caught 2026-04-30 in prod.
    if (method === "GET" && pathname === "/graph-color.js") {
      await serveStatic(res, "graph-color.js", MIME_TYPES[".js"]!);
      return;
    }

    if (method === "GET" && pathname === "/graph") {
      await serveStatic(res, "graph.html", MIME_TYPES[".html"]!);
      return;
    }

    if (method === "GET" && pathname === "/tasks") {
      await serveStatic(res, "tasks.html", MIME_TYPES[".html"]!);
      return;
    }

    // Message history: GET /api/messages/:agent?date=YYYY-MM-DD
    if (
      method === "GET" &&
      segments.length === 3 &&
      segments[0] === "api" &&
      segments[1] === "messages"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      const queryString = (req.url ?? "").split("?")[1] ?? "";
      const queryParams = new URLSearchParams(queryString);
      const date = queryParams.get("date") ?? undefined;
      try {
        const data = await sendIpcRequest(socketPath, "message-history", { agent: agentName, date });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message, messages: [], dates: [] });
      }
      return;
    }

    // Latency percentiles: GET /api/agents/:name/latency?since=24h
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "agents" &&
      segments[3] === "latency"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      const queryString = (req.url ?? "").split("?")[1] ?? "";
      const queryParams = new URLSearchParams(queryString);
      const since = queryParams.get("since") ?? "24h";
      try {
        const data = await sendIpcRequest(socketPath, "latency", {
          agent: agentName,
          since,
        });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // Prompt cache hit-rate: GET /api/agents/:name/cache?since=24h
    // Phase 52 Plan 03: proxies to the daemon's `cache` IPC method which
    // returns the augmented CacheTelemetryReport (report + status +
    // cache_effect_ms). The dashboard renders a per-agent Prompt Cache
    // panel adjacent to the Latency panel from this payload.
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "agents" &&
      segments[3] === "cache"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      const queryString = (req.url ?? "").split("?")[1] ?? "";
      const queryParams = new URLSearchParams(queryString);
      const since = queryParams.get("since") ?? "24h";
      try {
        const data = await sendIpcRequest(socketPath, "cache", {
          agent: agentName,
          since,
        });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // Tool-call latency: GET /api/agents/:name/tools?since=24h
    // Phase 55 Plan 03: proxies to the daemon's `tools` IPC method which
    // returns a ToolsReport with augmented ToolPercentileRow[] (each row
    // carries slo_status + slo_threshold_ms + slo_metric). The dashboard
    // renders a per-agent Tool Call Latency panel adjacent to the Prompt
    // Cache panel from this payload.
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "agents" &&
      segments[3] === "tools"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      const queryString = (req.url ?? "").split("?")[1] ?? "";
      const queryParams = new URLSearchParams(queryString);
      const since = queryParams.get("since") ?? "24h";
      try {
        const data = await sendIpcRequest(socketPath, "tools", {
          agent: agentName,
          since,
        });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // Phase 115 Plan 08 T03 — tool-latency audit: GET /api/tool-latency-audit?windowHours=24[&agent=name]
    // Surfaces sub-scope 17(a/b/c) split-latency + 6-A tool_use_rate + 6-B
    // gate decision for the dashboard panel rendered alongside the Cache /
    // Tools panels. Mirrors the CLI subcommand (src/cli/commands/tool-latency-audit.ts).
    if (
      method === "GET" &&
      pathname === "/api/tool-latency-audit"
    ) {
      const queryString = (req.url ?? "").split("?")[1] ?? "";
      const queryParams = new URLSearchParams(queryString);
      const windowHours = parseInt(queryParams.get("windowHours") ?? "24", 10);
      const agent = queryParams.get("agent") ?? undefined;
      const params: Record<string, unknown> = {
        windowHours: Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24,
      };
      if (agent) params.agent = agent;
      try {
        const data = await sendIpcRequest(socketPath, "tool-latency-audit", params);
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // Knowledge graph data: GET /api/graph/:agent
    if (
      method === "GET" &&
      segments.length === 3 &&
      segments[0] === "api" &&
      segments[1] === "graph"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      try {
        const data = await sendIpcRequest(socketPath, "memory-graph", { agent: agentName });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message, nodes: [], links: [] });
      }
      return;
    }

    // SSE endpoint
    if (method === "GET" && pathname === "/api/events") {
      sseManager.addClient(res);
      return;
    }

    // One-shot status endpoint
    if (method === "GET" && pathname === "/api/status") {
      try {
        const state = await sseManager.fetchCurrentState();
        sendJson(res, 200, state);
      } catch {
        sendJson(res, 503, { error: "Daemon not reachable" });
      }
      return;
    }

    // One-shot schedules endpoint
    if (method === "GET" && pathname === "/api/schedules") {
      try {
        const data = await sseManager.fetchSchedules();
        sendJson(res, 200, data);
      } catch {
        sendJson(res, 503, { error: "Daemon not reachable" });
      }
      return;
    }

    // Phase 109-D — fleet-wide observability snapshot. Cgroup memory pressure,
    // claude proc drift, per-MCP-pattern RSS aggregate. Read-only; safe to
    // poll. Adjacent to /api/status (which keeps its byte-stable shape) so
    // existing dashboard JS keeps rendering unchanged.
    if (method === "GET" && pathname === "/api/fleet-stats") {
      try {
        const data = await sendIpcRequest(socketPath, "fleet-stats", {});
        sendJson(res, 200, data);
      } catch {
        sendJson(res, 503, { error: "Daemon not reachable" });
      }
      return;
    }

    // One-shot health endpoint
    if (method === "GET" && pathname === "/api/health") {
      try {
        const data = await sseManager.fetchHealth();
        sendJson(res, 200, data);
      } catch {
        sendJson(res, 503, { error: "Daemon not reachable" });
      }
      return;
    }

    // One-shot costs endpoint
    if (method === "GET" && pathname === "/api/costs") {
      try {
        const queryString = (req.url ?? "").split("?")[1] ?? "";
        const params = new URLSearchParams(queryString);
        const period = params.get("period") ?? "today";
        const data = await sendIpcRequest(socketPath, "costs", { period });
        sendJson(res, 200, data);
      } catch {
        sendJson(res, 503, { error: "Daemon not reachable" });
      }
      return;
    }

    // One-shot delivery queue endpoint
    if (method === "GET" && pathname === "/api/delivery-queue") {
      try {
        const data = await sseManager.fetchDeliveryQueue();
        sendJson(res, 200, data);
      } catch {
        sendJson(res, 503, { error: "Daemon not reachable" });
      }
      return;
    }

    // One-shot task graph endpoint (Phase 63 OBS-03)
    if (method === "GET" && pathname === "/api/tasks") {
      try {
        const data = await sendIpcRequest(socketPath, "list-tasks", {});
        sendJson(res, 200, data);
      } catch {
        sendJson(res, 503, { error: "Daemon not reachable" });
      }
      return;
    }

    // Agent control: POST /api/agents/:name/:action
    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "agents"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      const action = segments[3];

      if (action !== "start" && action !== "stop" && action !== "restart") {
        sendJson(res, 400, { error: `Unknown action: ${action}` });
        return;
      }

      try {
        await sendIpcRequest(socketPath, action, { name: agentName });
        sendJson(res, 200, { ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ err, agentName, action }, "Agent control failed");
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // Phase 61 TRIG-03: Webhook trigger endpoint
    if (method === "POST" && segments[0] === "webhook" && segments.length === 2) {
      const triggerId = decodeURIComponent(segments[1]!);
      if (webhookHandler) {
        await webhookHandler(triggerId, req, res);
        return;
      }
      sendJson(res, 404, { error: "Webhook handler not configured" });
      return;
    }

    // 404 for everything else
    res.writeHead(404);
    res.end("Not Found");
  } catch (err) {
    log.error({ err, pathname }, "Request handler error");
    res.writeHead(500);
    res.end("Internal Server Error");
  }
}

type Logger = pino.Logger;

export type { DashboardServerConfig };
