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

// Phase 116 — Vite-built React SPA root. Output ships to dist/dashboard/spa/
// via `npm run build:spa` (vite.config.ts → build.outDir). Served at
// `/dashboard/v2/*` so the v1 dashboard at `/` stays byte-identical while
// the rewrite incrementally lands.
const STATIC_SPA_DIR = join(import.meta.dirname, "..", "dashboard", "spa");

const DEFAULT_POLL_INTERVAL_MS = 3000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  // Phase 116 — SPA asset MIME extensions. Self-hosted WOFF2 fonts (Cabinet
  // Grotesk / Geist / JetBrains Mono) land under /dashboard/v2/fonts/ in T06;
  // PNGs ship from public/ via vite's asset pipeline; .map files are
  // sourcemaps that Vite emits when build.sourcemap is on (off in v1).
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Phase 116 — infer the MIME type for a SPA static file from its extension.
 * Falls back to application/octet-stream when the extension is unknown
 * (defensive — Vite only emits the extensions in MIME_TYPES above).
 */
function inferMimeType(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex < 0) return "application/octet-stream";
  const ext = filename.slice(dotIndex).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Phase 116 — serve a SPA asset from dist/dashboard/spa.
 *
 * Reads the file as a Buffer (binary-safe — WOFF2 / PNG / sourcemaps would
 * corrupt if read as utf-8). 404s on missing files rather than falling
 * through to the SPA index — Vite-built asset paths are content-hashed and
 * a 404 here means the build is out of sync with the page, which the
 * operator should see, not paper over.
 */
async function serveSpaAsset(
  res: ServerResponse,
  relativePath: string,
  contentType: string,
): Promise<void> {
  try {
    const filePath = join(STATIC_SPA_DIR, relativePath);
    const content = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

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
 * Read a JSON-encoded request body. Phase 116-03 added the first non-empty
 * POST/PUT routes to the dashboard (F26 config edits + F28 task creation /
 * transitions). 1 MiB cap is generous for any agent-config partial; an
 * over-cap stream throws so we surface 413 → 400 to the operator instead of
 * accumulating an attacker-controlled allocation.
 */
const MAX_BODY_BYTES = 1024 * 1024;
async function readJsonBody(
  req: import("node:http").IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    throw new Error("Empty request body");
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid JSON";
    throw new Error(`Invalid JSON body: ${msg}`);
  }
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
    void handleRequest(
      req,
      res,
      sseManager,
      config.socketPath,
      log,
      config.webhookHandler,
      config.cutoverRedirectEnabled,
      config.auditTrail,
    );
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
  cutoverRedirectEnabled?: DashboardServerConfig["cutoverRedirectEnabled"],
  dashboardAuditTrail?: DashboardServerConfig["auditTrail"],
): Promise<void> {
  const method = req.method ?? "GET";
  const { pathname, segments } = parseRoute(req.url);

  try {
    // -----------------------------------------------------------------
    // Phase 116 — /dashboard/v2 SPA routes (Vite-built React shell).
    //
    // Three patterns to handle:
    //   1. /dashboard/v2  or  /dashboard/v2/        → serve index.html
    //   2. /dashboard/v2/assets/<filename>          → serve from spa/assets/
    //   3. /dashboard/v2/<other-static-path>        → serve from spa/ (fonts,
    //                                                  favicon, sub-public)
    //
    // These MUST be evaluated before the v1 `/` route so /dashboard/v2/ does
    // not accidentally fall through. They are ALSO evaluated before /api/*
    // so a future /api/v2/* namespace cannot collide with the SPA root.
    //
    // Old /  /index.html / /app.js / /styles.css / /graph / /tasks routes
    // below are UNCHANGED — operator can still hit the v1 dashboard
    // byte-identical to the pre-Phase-116 deploy while v2 lands.
    // -----------------------------------------------------------------
    if (
      method === "GET" &&
      (pathname === "/dashboard/v2" || pathname === "/dashboard/v2/")
    ) {
      await serveSpaAsset(res, "index.html", MIME_TYPES[".html"]!);
      return;
    }

    if (method === "GET" && pathname.startsWith("/dashboard/v2/assets/")) {
      // Strip the route prefix; what's left is "assets/<file>" relative to
      // STATIC_SPA_DIR. Vite emits content-hashed filenames so each request
      // unambiguously identifies one cached asset.
      const relativePath = pathname.slice("/dashboard/v2/".length);
      await serveSpaAsset(res, relativePath, inferMimeType(relativePath));
      return;
    }

    if (method === "GET" && pathname.startsWith("/dashboard/v2/")) {
      // Catch-all for SPA static under spa/ root (fonts/, favicon.svg, etc.).
      // Strict prefix-strip — anything matching /dashboard/v2/<x> serves
      // STATIC_SPA_DIR/<x>.
      //
      // Phase 116-05 — SPA-fallback for client routes. The SPA owns
      // /dashboard/v2/{fleet,costs,conversations,tasks,...} via the App.tsx
      // path↔view sync layer. These look like file paths but no file exists
      // under STATIC_SPA_DIR for them. Heuristic: if the path has no file
      // extension (no `.` in the last segment), treat it as a client route
      // and serve index.html. Paths with extensions (e.g. fonts/x.woff2,
      // favicon.svg) keep the strict 404-on-miss behavior so operators
      // catch stale-build issues.
      const relativePath = pathname.slice("/dashboard/v2/".length);
      const lastSegment = relativePath.split("/").pop() ?? "";
      const hasExtension = lastSegment.includes(".");
      if (!hasExtension) {
        await serveSpaAsset(res, "index.html", MIME_TYPES[".html"]!);
        return;
      }
      await serveSpaAsset(res, relativePath, inferMimeType(relativePath));
      return;
    }

    // Static file routes
    if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      // Phase 116-06 T08 — operator-driven cutover gate. When the flag is
      // flipped to true (via `clawcode config set defaults.dashboardCutoverRedirect true`)
      // the legacy dashboard root 301-redirects to the SPA. The flag is a
      // CLOSURE OVER THE LIVE CONFIG REF in daemon.ts, so the flip takes
      // effect on the very next request after ConfigWatcher debounces the
      // YAML edit — no daemon restart.
      //
      // Hardening: only redirect `pathname === "/"`. The `/index.html`
      // legacy path keeps serving the old asset literally — operators who
      // bookmarked or scripted `/index.html` shouldn't get bounced. The
      // redirect target ends with `/` so the SPA's path↔view layer reads
      // the canonical home view.
      if (pathname === "/" && cutoverRedirectEnabled?.() === true) {
        res.writeHead(301, { Location: "/dashboard/v2/" });
        res.end();
        return;
      }
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
        // 116-06 T04: audit log the operator action AFTER it succeeded.
        if (dashboardAuditTrail) {
          await dashboardAuditTrail.recordAction({
            action: `agent-${action}`,
            target: agentName,
          });
        }
        sendJson(res, 200, { ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ err, agentName, action }, "Agent control failed");
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // =====================================================================
    // Phase 116-02 routes — keep grouped to minimize 116-03 merge surface.
    //
    // F09 — embedding migration tracker:
    //   GET  /api/migrations            -> proxies daemon `embedding-migration-status` (no agent filter)
    //   POST /api/migrations/:agent/pause     -> daemon `embedding-migration-pause`
    //   POST /api/migrations/:agent/resume    -> daemon `embedding-migration-resume`
    //   POST /api/migrations/:agent/rollback  -> daemon `embedding-migration-transition` with toPhase=rolled-back
    //
    // F10 — MCP server health panel:
    //   GET  /api/mcp-servers                          -> proxies daemon `mcp-servers` (config-derived list w/ healthy=null)
    //   GET  /api/mcp-servers/:agent                   -> proxies daemon `list-mcp-status` (live runtime status + capability probe)
    //   POST /api/mcp-servers/:agent/:server/reconnect -> proxies daemon `mcp-probe` (re-runs readiness handshake + capability probe)
    //
    // The migration `list-migrations` IPC method name in the plan doesn't exist;
    // daemon ships `embedding-migration-status` which returns the same shape.
    // Aliased at the REST layer rather than adding a duplicate handler.
    //
    // Reconnect maps to `mcp-probe` because the daemon has no operator-fired
    // reconnect IPC — the heartbeat does reconnects internally; `mcp-probe`
    // re-runs the readiness handshake which is the equivalent of "kick this
    // server now". Status flips through degraded → ready as a side effect.
    // =====================================================================

    // GET /api/migrations  (fleet-wide migration phase snapshot)
    if (method === "GET" && pathname === "/api/migrations") {
      try {
        const data = await sendIpcRequest(
          socketPath,
          "embedding-migration-status",
          {},
        );
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 503, { error: message });
      }
      return;
    }

    // POST /api/migrations/:agent/{pause,resume,rollback}
    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "migrations"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      const action = segments[3];
      let ipcMethod: string | null = null;
      let ipcParams: Record<string, unknown> = { agent: agentName };
      if (action === "pause") {
        ipcMethod = "embedding-migration-pause";
      } else if (action === "resume") {
        ipcMethod = "embedding-migration-resume";
      } else if (action === "rollback") {
        // Rollback is a legal transition from every phase except v1-dropped
        // (see src/memory/migrations/embedding-v2.ts LEGAL_TRANSITIONS).
        ipcMethod = "embedding-migration-transition";
        ipcParams = { agent: agentName, toPhase: "rolled-back" };
      } else {
        sendJson(res, 400, {
          error: `Unknown migration action: ${action} (expected pause|resume|rollback)`,
        });
        return;
      }
      try {
        const result = await sendIpcRequest(socketPath, ipcMethod, ipcParams);
        if (dashboardAuditTrail) {
          await dashboardAuditTrail.recordAction({
            action: `migration-${action}`,
            target: agentName,
          });
        }
        sendJson(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ err, agentName, action }, "Migration action failed");
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // GET /api/mcp-servers  (config-derived list across all agents; healthy=null)
    if (method === "GET" && pathname === "/api/mcp-servers") {
      try {
        const data = await sendIpcRequest(socketPath, "mcp-servers", {});
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 503, { error: message });
      }
      return;
    }

    // GET /api/mcp-servers/:agent  (live runtime status from McpServerState)
    if (
      method === "GET" &&
      segments.length === 3 &&
      segments[0] === "api" &&
      segments[1] === "mcp-servers"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      try {
        const data = await sendIpcRequest(socketPath, "list-mcp-status", {
          agent: agentName,
        });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 503, { error: message });
      }
      return;
    }

    // POST /api/mcp-servers/:agent/:server/reconnect
    if (
      method === "POST" &&
      segments.length === 5 &&
      segments[0] === "api" &&
      segments[1] === "mcp-servers" &&
      segments[4] === "reconnect"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      // Server name retained in URL for parity with future per-server retry
      // IPC. Today daemon `mcp-probe` re-runs the readiness handshake for ALL
      // servers of the agent; per-server kick lands when daemon ships it.
      try {
        const data = await sendIpcRequest(socketPath, "mcp-probe", {
          agent: agentName,
        });
        if (dashboardAuditTrail) {
          await dashboardAuditTrail.recordAction({
            action: "mcp-reconnect",
            target: agentName,
          });
        }
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ err, agentName }, "MCP reconnect (mcp-probe) failed");
        sendJson(res, 500, { error: message });
      }
      return;
    }
    // === end Phase 116-02 routes ===

    // =====================================================================
    // Phase 116-03 routes — Tier 1.5 operator workflow (F26/F27/F28).
    // Grouped contiguously after 116-02 so sibling plans can append their
    // own block without touching this diff. All routes proxy daemon IPC
    // methods added in the closure-intercept block in daemon.ts (search for
    // "Phase 116-03 — Tier 1.5 operator workflow IPC handlers").
    //
    // F26 — agent config editor:
    //   GET  /api/config/agents/:name           -> daemon `get-agent-config`
    //   PUT  /api/config/agents/:name           -> daemon `update-agent-config`
    //   POST /api/config/hot-reload             -> daemon `hot-reload-now`
    //
    // F27 — conversations view:
    //   GET  /api/conversations/search          -> daemon `search-conversations`
    //   GET  /api/conversations/:agent/recent   -> daemon `list-recent-conversations`
    //
    // F28 — Kanban task board:
    //   GET  /api/tasks/kanban                  -> daemon `list-tasks-kanban`
    //   POST /api/tasks                         -> daemon `create-task`
    //   POST /api/tasks/:id/transition          -> daemon `transition-task`
    // =====================================================================

    // F26 — GET /api/config/agents/:name
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "config" &&
      segments[2] === "agents"
    ) {
      const agentName = decodeURIComponent(segments[3]!);
      try {
        const data = await sendIpcRequest(socketPath, "get-agent-config", {
          agent: agentName,
        });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 404, { error: message });
      }
      return;
    }

    // F26 — PUT /api/config/agents/:name
    if (
      method === "PUT" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "config" &&
      segments[2] === "agents"
    ) {
      const agentName = decodeURIComponent(segments[3]!);
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        const message = err instanceof Error ? err.message : "bad request body";
        sendJson(res, 400, { error: message });
        return;
      }
      if (typeof body !== "object" || body === null) {
        sendJson(res, 400, { error: "Body must be a JSON object with `partial`" });
        return;
      }
      const partial = (body as { partial?: unknown }).partial;
      if (typeof partial !== "object" || partial === null) {
        sendJson(res, 400, {
          error: "Body must contain `partial` (object of agent-block fields)",
        });
        return;
      }
      try {
        const result = await sendIpcRequest(socketPath, "update-agent-config", {
          agent: agentName,
          partial,
        });
        if (dashboardAuditTrail) {
          // Carry the partial as metadata so the F23 viewer can render a
          // before/after-style row. Daemon already validated the partial
          // via zod before patching, so what we log is the schema-clean
          // shape that actually landed on disk.
          await dashboardAuditTrail.recordAction({
            action: "update-agent-config",
            target: agentName,
            metadata: { partial: partial as Record<string, unknown> },
          });
        }
        sendJson(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ err, agentName }, "F26 update-agent-config failed");
        // Distinguish validation failures (Zod / missing) from server errors.
        // Daemon throws ManagerError with the validation reason; surface as 400
        // unless it's a transport failure (in which case 500 is fine).
        const status =
          message.includes("not found") || message.includes("Cannot patch")
            ? 400
            : 500;
        sendJson(res, status, { error: message });
      }
      return;
    }

    // F26 — POST /api/config/hot-reload  (no body; forces chokidar tick)
    if (method === "POST" && pathname === "/api/config/hot-reload") {
      try {
        const data = await sendIpcRequest(socketPath, "hot-reload-now", {});
        if (dashboardAuditTrail) {
          await dashboardAuditTrail.recordAction({
            action: "hot-reload-now",
            target: null,
          });
        }
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ err }, "F26 hot-reload-now failed");
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // F27 — GET /api/conversations/search?q=&agent=&since=&limit=
    if (method === "GET" && pathname === "/api/conversations/search") {
      const queryString = (req.url ?? "").split("?")[1] ?? "";
      const queryParams = new URLSearchParams(queryString);
      const q = queryParams.get("q");
      if (!q || q.length === 0) {
        sendJson(res, 400, { error: "Missing required query param: q" });
        return;
      }
      const agent = queryParams.get("agent") ?? null;
      const limitRaw = queryParams.get("limit");
      const limit = limitRaw ? Math.min(Number(limitRaw) || 50, 200) : 50;
      const sinceMs = queryParams.get("since");
      try {
        const data = await sendIpcRequest(socketPath, "search-conversations", {
          q,
          agent,
          limit,
          sinceMs: sinceMs ? Number(sinceMs) : null,
        });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ err, q, agent }, "F27 conversation search failed");
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // F27 — GET /api/conversations/:agent/recent?limit=50
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "conversations" &&
      segments[3] === "recent"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      const queryString = (req.url ?? "").split("?")[1] ?? "";
      const queryParams = new URLSearchParams(queryString);
      const limitRaw = queryParams.get("limit");
      const limit = limitRaw ? Math.min(Number(limitRaw) || 50, 200) : 50;
      try {
        const data = await sendIpcRequest(
          socketPath,
          "list-recent-conversations",
          { agent: agentName, limit },
        );
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // F28 — GET /api/tasks/kanban
    if (method === "GET" && pathname === "/api/tasks/kanban") {
      try {
        const data = await sendIpcRequest(socketPath, "list-tasks-kanban", {});
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // F28 — POST /api/tasks  (create a new operator-authored task)
    if (method === "POST" && pathname === "/api/tasks") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        const message = err instanceof Error ? err.message : "bad request body";
        sendJson(res, 400, { error: message });
        return;
      }
      if (typeof body !== "object" || body === null) {
        sendJson(res, 400, { error: "Body must be a JSON object" });
        return;
      }
      try {
        const result = await sendIpcRequest(
          socketPath,
          "create-task",
          body as Record<string, unknown>,
        );
        if (dashboardAuditTrail) {
          await dashboardAuditTrail.recordAction({
            action: "create-task",
            target:
              typeof (body as { target_agent?: unknown }).target_agent === "string"
                ? ((body as { target_agent: string }).target_agent)
                : null,
            metadata: body as Record<string, unknown>,
          });
        }
        sendJson(res, 201, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ err }, "F28 create-task failed");
        sendJson(res, 400, { error: message });
      }
      return;
    }

    // F28 — POST /api/tasks/:id/transition
    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "tasks" &&
      segments[3] === "transition"
    ) {
      const taskId = decodeURIComponent(segments[2]!);
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        const message = err instanceof Error ? err.message : "bad request body";
        sendJson(res, 400, { error: message });
        return;
      }
      if (typeof body !== "object" || body === null) {
        sendJson(res, 400, {
          error: "Body must include { status, patch? }",
        });
        return;
      }
      const status = (body as { status?: unknown }).status;
      if (typeof status !== "string") {
        sendJson(res, 400, { error: "Body.status is required (string)" });
        return;
      }
      const patch = (body as { patch?: unknown }).patch ?? {};
      try {
        const result = await sendIpcRequest(socketPath, "transition-task", {
          task_id: taskId,
          status,
          patch,
        });
        if (dashboardAuditTrail) {
          await dashboardAuditTrail.recordAction({
            action: "transition-task",
            target: taskId,
            metadata: { status, patch: patch as Record<string, unknown> },
          });
        }
        sendJson(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ err, taskId, status }, "F28 transition-task failed");
        // Illegal transition vs. not found vs. other → operator-actionable.
        const code =
          message.includes("not found") ||
          message.includes("Illegal") ||
          message.includes("transition")
            ? 400
            : 500;
        sendJson(res, code, { error: message });
      }
      return;
    }
    // === end Phase 116-03 routes ===

    // =====================================================================
    // Phase 116-04 routes — Tier 2 deep-dive (F11/F12/F13/F14/F15).
    // Same contiguous-block convention as 116-02 + 116-03 so 116-05 can
    // append its own fence without touching this diff. Every route proxies
    // a daemon IPC method registered in the "Phase 116-04" closure-
    // intercept block in src/manager/daemon.ts.
    //
    // F11 — per-agent detail drawer transcript:
    //   GET  /api/agents/:name/recent-turns       -> daemon `list-recent-turns`
    //
    // F12 — per-turn trace waterfall:
    //   GET  /api/agents/:name/traces/:turnId     -> daemon `get-turn-trace`
    //
    // F13 — cross-agent IPC inbox + fleet delivery snapshot:
    //   GET  /api/ipc/inboxes                     -> daemon `list-ipc-inboxes`
    //
    // F14 — memory subsystem (READ-ONLY in v1 per 116-DEFERRED):
    //   GET  /api/agents/:name/memory-snapshot    -> daemon `get-memory-snapshot`
    //
    // F15 — dream-pass queue + D-10 veto windows:
    //   GET  /api/agents/:name/dream-queue        -> daemon `get-dream-queue`
    //   POST /api/agents/:name/dream-veto/:runId  -> daemon `veto-dream-run`
    //                                                ({ reason: string } body)
    //
    // Naming note: F15 URL says `:runId` for parity with VetoStore.vetoRun()
    // (the canonical identifier in the store). The plan referred to this
    // as `:windowId` but it's the same value — see 116-04-SUMMARY.md.
    // =====================================================================

    // GET /api/agents/:name/recent-turns?limit=50&includeUntrusted=false&sessionId=…
    //
    // 116-postdeploy Bug 2 — when `sessionId` is supplied the result is
    // restricted to that one session's turns in chronological order (used
    // by the F27 conversations transcript pane). When absent the original
    // F11 drawer behaviour applies (recent N turns across all sessions,
    // reverse-chronological).
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "agents" &&
      segments[3] === "recent-turns"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      const queryString = (req.url ?? "").split("?")[1] ?? "";
      const queryParams = new URLSearchParams(queryString);
      const limitParam = queryParams.get("limit");
      const limit = limitParam ? parseInt(limitParam, 10) : 50;
      const includeUntrustedChannels =
        queryParams.get("includeUntrusted") === "true";
      const sessionIdParam = queryParams.get("sessionId");
      const ipcParams: Record<string, unknown> = {
        agent: agentName,
        limit: Number.isFinite(limit) ? limit : 50,
        includeUntrustedChannels,
      };
      if (sessionIdParam && sessionIdParam.length > 0) {
        ipcParams.sessionId = sessionIdParam;
      }
      try {
        const data = await sendIpcRequest(
          socketPath,
          "list-recent-turns",
          ipcParams,
        );
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // GET /api/agents/:name/traces/:turnId
    if (
      method === "GET" &&
      segments.length === 5 &&
      segments[0] === "api" &&
      segments[1] === "agents" &&
      segments[3] === "traces"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      const turnId = decodeURIComponent(segments[4]!);
      try {
        const data = await sendIpcRequest(socketPath, "get-turn-trace", {
          agent: agentName,
          turnId,
        });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        // 404 for "Turn not found"; everything else is 500. The daemon
        // surfaces the exact reason in `message`, so the SPA can render it
        // verbatim in the waterfall's error slot.
        const code = message.startsWith("Turn not found") ? 404 : 500;
        sendJson(res, code, { error: message });
      }
      return;
    }

    // GET /api/ipc/inboxes
    if (
      method === "GET" &&
      segments.length === 3 &&
      segments[0] === "api" &&
      segments[1] === "ipc" &&
      segments[2] === "inboxes"
    ) {
      try {
        const data = await sendIpcRequest(socketPath, "list-ipc-inboxes", {});
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // GET /api/agents/:name/memory-snapshot
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "agents" &&
      segments[3] === "memory-snapshot"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      try {
        const data = await sendIpcRequest(socketPath, "get-memory-snapshot", {
          agent: agentName,
        });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const code = message.startsWith("Agent not found") ? 404 : 500;
        sendJson(res, code, { error: message });
      }
      return;
    }

    // GET /api/agents/:name/dream-queue
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "agents" &&
      segments[3] === "dream-queue"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      try {
        const data = await sendIpcRequest(socketPath, "get-dream-queue", {
          agent: agentName,
        });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const code = message.startsWith("Agent not found") ? 404 : 500;
        sendJson(res, code, { error: message });
      }
      return;
    }

    // POST /api/agents/:name/dream-veto/:runId  body: { reason: string }
    if (
      method === "POST" &&
      segments.length === 5 &&
      segments[0] === "api" &&
      segments[1] === "agents" &&
      segments[3] === "dream-veto"
    ) {
      // agentName is currently unused by the IPC handler (VetoStore is keyed
      // by runId only), but we keep it in the URL for symmetry with the
      // other agent-scoped routes + to future-proof a per-agent ACL.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _agentName = decodeURIComponent(segments[2]!);
      const runId = decodeURIComponent(segments[4]!);
      try {
        const body = await readJsonBody(req);
        const reason =
          body && typeof (body as { reason?: unknown }).reason === "string"
            ? (body as { reason: string }).reason
            : "";
        if (reason.length === 0) {
          sendJson(res, 400, { error: "reason is required (non-empty string)" });
          return;
        }
        const data = await sendIpcRequest(socketPath, "veto-dream-run", {
          runId,
          reason,
        });
        if (dashboardAuditTrail) {
          await dashboardAuditTrail.recordAction({
            action: "veto-dream-run",
            target: _agentName,
            metadata: { runId, reason },
          });
        }
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message });
      }
      return;
    }
    // === end Phase 116-04 routes ===

    // =====================================================================
    // Phase 116-05 routes — Fleet-scale + cost (F16/F17).
    // Same contiguous-block convention as 116-02/116-03/116-04 so 116-06
    // can append its own fence without touching this diff. Both routes
    // proxy daemon IPC methods registered in the "Phase 116-05" closure-
    // intercept block in src/manager/daemon.ts.
    //
    // F16 — fleet comparison table:
    //   No new backend — the page aggregates over the existing per-agent
    //   /api/agents/:name/cache + /api/agents/:name/latency + /api/costs
    //   endpoints. CSV serialization is client-side (Blob + download).
    //
    // F17 — cost dashboard:
    //   GET /api/costs/daily?days=30&agent=X  -> daemon `costs-daily`
    //   GET /api/budgets                      -> daemon `budget-status`
    //
    // Note: `/api/costs` (Phase 1.5) already covers today/week/month
    // totals; 116-05 builds on top of it without replacing.
    // =====================================================================

    // GET /api/costs/daily?days=30&agent=X
    // F17 — per-day cost trend rows for the dashboard's trend chart +
    // anomaly detection + linear projection.
    if (method === "GET" && pathname === "/api/costs/daily") {
      try {
        const queryString = (req.url ?? "").split("?")[1] ?? "";
        const params = new URLSearchParams(queryString);
        const daysRaw = params.get("days");
        const days = daysRaw ? Number.parseInt(daysRaw, 10) : 30;
        const agent = params.get("agent");
        const ipcParams: Record<string, unknown> = {};
        if (Number.isFinite(days)) ipcParams.days = days;
        if (agent) ipcParams.agent = agent;
        const data = await sendIpcRequest(socketPath, "costs-daily", ipcParams);
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 503, { error: message });
      }
      return;
    }

    // GET /api/budgets
    // F17 — EscalationBudget gauges. Units are TOKENS by schema; the
    // dashboard renders these alongside (not inside) the USD spend cards.
    if (method === "GET" && pathname === "/api/budgets") {
      try {
        const data = await sendIpcRequest(socketPath, "budget-status", {});
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 503, { error: message });
      }
      return;
    }
    // === end Phase 116-05 routes ===

    // =====================================================================
    // Phase 116-06 routes — Tier 3 polish + cutover gate (F18/F20/F22/F23
    // + telemetry). Same contiguous-block convention as the earlier 116-XX
    // fences. All routes proxy daemon IPC methods registered in the
    // "Phase 116-06" closure-intercept block in src/manager/daemon.ts.
    //
    // F18 + F22 — activity heatmap:
    //   GET /api/activity?days=30&agent=X   -> daemon `activity-by-day`
    //
    // F20 notification feed — derives entirely from existing SSE +
    //   /api/fleet-stats; no new backend.
    // F21 theme toggle — pure client state (localStorage); no backend.
    //
    // F23 + T07 audit log:
    //   GET  /api/audit?since=&action=&agent=&limit=  -> daemon `list-dashboard-audit`
    //   POST /api/dashboard-telemetry                  -> append to dashboard-audit.jsonl
    //   GET  /api/dashboard-telemetry/summary          -> daemon `dashboard-telemetry-summary`
    //
    // F24 graph re-skin — SPA-side React route; no new backend (re-uses
    //   the existing `memory-graph` IPC via /api/graph/:agent).
    //
    // F25 already absorbed into F28 (Kanban) in Plan 116-03; no work here.
    // T08 cutover gate — wired at GET / above (calls cutoverRedirectEnabled
    //   closure injected by daemon.ts; 301 to /dashboard/v2/ when true).
    // =====================================================================

    // GET /api/activity?days=30&agent=X
    // F18 (per-agent in F11 drawer) + F22 (fleet aggregate on /dashboard/v2/fleet).
    if (method === "GET" && pathname === "/api/activity") {
      try {
        const queryString = (req.url ?? "").split("?")[1] ?? "";
        const params = new URLSearchParams(queryString);
        const daysRaw = params.get("days");
        const days = daysRaw ? Number.parseInt(daysRaw, 10) : 30;
        const agent = params.get("agent");
        const ipcParams: Record<string, unknown> = {};
        if (Number.isFinite(days)) ipcParams.days = days;
        if (agent) ipcParams.agent = agent;
        const data = await sendIpcRequest(socketPath, "activity-by-day", ipcParams);
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 503, { error: message });
      }
      return;
    }

    // GET /api/audit?since=&action=&agent=&limit=
    // F23 — read the dashboard audit log JSONL (tail with filters).
    if (method === "GET" && pathname === "/api/audit") {
      try {
        const queryString = (req.url ?? "").split("?")[1] ?? "";
        const qp = new URLSearchParams(queryString);
        const ipcParams: Record<string, unknown> = {};
        const since = qp.get("since");
        const action = qp.get("action");
        const agent = qp.get("agent");
        const limit = qp.get("limit");
        if (since) ipcParams.since = since;
        if (action) ipcParams.action = action;
        if (agent) ipcParams.agent = agent;
        if (limit) {
          const n = Number.parseInt(limit, 10);
          if (Number.isFinite(n)) ipcParams.limit = n;
        }
        const data = await sendIpcRequest(socketPath, "list-dashboard-audit", ipcParams);
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 503, { error: message });
      }
      return;
    }

    // POST /api/dashboard-telemetry { event: "page-view" | "error", path?, message?, stack? }
    // T07 — SPA-emitted telemetry. The audit-trail acts as the sink so we
    // don't multiply on-disk JSONL files. Body bounded by MAX_BODY_BYTES.
    if (method === "POST" && pathname === "/api/dashboard-telemetry") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        const message = err instanceof Error ? err.message : "bad request body";
        sendJson(res, 400, { error: message });
        return;
      }
      if (typeof body !== "object" || body === null) {
        sendJson(res, 400, { error: "Body must be a JSON object" });
        return;
      }
      const event = (body as { event?: unknown }).event;
      if (event !== "page-view" && event !== "error") {
        sendJson(res, 400, { error: "event must be 'page-view' or 'error'" });
        return;
      }
      if (dashboardAuditTrail) {
        await dashboardAuditTrail.recordAction({
          action: event === "page-view" ? "dashboard_v2_page_view" : "dashboard_v2_error",
          target: null,
          metadata: body as Record<string, unknown>,
        });
      }
      sendJson(res, 204, {});
      return;
    }

    // GET /api/dashboard-telemetry/summary  — T07 badge counts (24h).
    if (method === "GET" && pathname === "/api/dashboard-telemetry/summary") {
      try {
        const data = await sendIpcRequest(
          socketPath,
          "dashboard-telemetry-summary",
          {},
        );
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 503, { error: message });
      }
      return;
    }
    // === end Phase 116-06 routes ===

    // =====================================================================
    // Phase 116-postdeploy routes — Usage page (subscription utilisation).
    //
    // The Costs page over-emphasised theoretical API-equivalent USD on an
    // operator who runs on Claude Max ($200/mo flat). The real constraint
    // is subscription rate limits (5h session window + 7d weekly + per-
    // model carve-outs), already captured by Phase 103's RateLimitTracker.
    // These routes expose that data so the redesigned Usage view can lead
    // with utilisation bars instead of dollar totals.
    //
    //   GET /api/usage          -> daemon `list-rate-limit-snapshots-fleet`
    //                              returns `{agents: [{agent, snapshots}]}`
    //   GET /api/usage/:agent   -> daemon `list-rate-limit-snapshots`
    //                              returns `{agent, snapshots}`
    //
    // Backwards compat: /api/costs and /api/costs/daily are untouched.
    // =====================================================================

    // GET /api/usage — fleet aggregate.
    if (method === "GET" && pathname === "/api/usage") {
      try {
        const data = await sendIpcRequest(
          socketPath,
          "list-rate-limit-snapshots-fleet",
          {},
        );
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 503, { error: message });
      }
      return;
    }

    // GET /api/usage/:agent — single-agent snapshots.
    if (
      method === "GET" &&
      segments.length === 3 &&
      segments[0] === "api" &&
      segments[1] === "usage"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      try {
        const data = await sendIpcRequest(
          socketPath,
          "list-rate-limit-snapshots",
          { agent: agentName },
        );
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 503, { error: message });
      }
      return;
    }

    // GET /api/agents/:name/activity?windowHours=24
    // Phase 116-postdeploy 2026-05-12 — F03 tile 24h activity sparkline.
    // Proxies to the daemon's `agent-activity` IPC handler. The route
    // mirrors the per-agent latency shape (`/api/agents/:name/latency`).
    // windowHours is forwarded as a number; the daemon clamps to 1..168.
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "agents" &&
      segments[3] === "activity"
    ) {
      const agentName = decodeURIComponent(segments[2]!);
      const queryString = (req.url ?? "").split("?")[1] ?? "";
      const queryParams = new URLSearchParams(queryString);
      const windowHoursRaw = queryParams.get("windowHours");
      const windowHoursParsed = windowHoursRaw
        ? Number.parseInt(windowHoursRaw, 10)
        : NaN;
      const ipcParams: { agent: string; windowHours?: number } = {
        agent: agentName,
      };
      if (Number.isFinite(windowHoursParsed)) {
        ipcParams.windowHours = windowHoursParsed;
      }
      try {
        const data = await sendIpcRequest(
          socketPath,
          "agent-activity",
          ipcParams,
        );
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 500, { error: message });
      }
      return;
    }
    // === end Phase 116-postdeploy routes ===

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
