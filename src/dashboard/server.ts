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

const STATIC_DIR = join(import.meta.dirname, "static");

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
    void handleRequest(req, res, sseManager, config.socketPath, log);
  });

  sseManager.start();

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(config.port, "127.0.0.1", () => {
      log.info({ port: config.port }, "Dashboard server started");
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
