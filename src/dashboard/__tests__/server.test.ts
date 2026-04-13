import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "node:http";

vi.mock("../../ipc/client.js", () => ({
  sendIpcRequest: vi.fn(),
}));

// Suppress pino output during tests
vi.mock("pino", () => {
  const noop = () => undefined;
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: () => logger,
  };
  return { default: () => logger };
});

import { startDashboardServer } from "../server.js";
import { sendIpcRequest } from "../../ipc/client.js";

const mockedSendIpcRequest = vi.mocked(sendIpcRequest);

function makeStatusResponse() {
  return {
    entries: [
      {
        name: "atlas",
        status: "running",
        startedAt: Date.now() - 60_000,
        restartCount: 0,
        lastError: null,
        sessionId: "sess-1",
        consecutiveFailures: 0,
        lastStableAt: null,
      },
    ],
  };
}

function makeZoneResponse() {
  return {
    agents: {
      atlas: { zone: "green", fillPercentage: 35 },
    },
  };
}

describe("Dashboard Server", () => {
  let closeServer: (() => Promise<void>) | null = null;
  let port: number;

  beforeEach(() => {
    // Use a random high port to avoid collisions
    port = 30_000 + Math.floor(Math.random() * 10_000);

    mockedSendIpcRequest.mockImplementation(async (_socketPath, method) => {
      if (method === "status") return makeStatusResponse();
      if (method === "context-zone-status") return makeZoneResponse();
      if (method === "start" || method === "stop" || method === "restart") return { ok: true };
      throw new Error(`Unknown method: ${method}`);
    });
  });

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
    vi.restoreAllMocks();
  });

  it("starts and accepts connections", async () => {
    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000, // Slow poll for tests
    });
    closeServer = result.close;

    expect(result.server).toBeDefined();
    expect(result.sseManager).toBeDefined();

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.ok).toBe(true);
  });

  it("GET / returns HTML with correct content-type", async () => {
    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000,
    });
    closeServer = result.close;

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("ClawCode");
  });

  it("GET /api/status returns JSON agent data", async () => {
    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000,
    });
    closeServer = result.close;

    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(res.headers.get("content-type")).toContain("application/json");

    const data = (await res.json()) as { agents: Array<{ name: string }> };
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0]!.name).toBe("atlas");
  });

  it("returns 404 for unknown routes", async () => {
    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000,
    });
    closeServer = result.close;

    const res = await fetch(`http://127.0.0.1:${port}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("POST /api/agents/:name/restart calls IPC", async () => {
    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000,
    });
    closeServer = result.close;

    const res = await fetch(`http://127.0.0.1:${port}/api/agents/atlas/restart`, {
      method: "POST",
    });
    expect(res.ok).toBe(true);

    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
    expect(mockedSendIpcRequest).toHaveBeenCalledWith("/tmp/test.sock", "restart", {
      name: "atlas",
    });
  });

  it("GET /styles.css returns CSS", async () => {
    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000,
    });
    closeServer = result.close;

    const res = await fetch(`http://127.0.0.1:${port}/styles.css`);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("GET /app.js returns JavaScript", async () => {
    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000,
    });
    closeServer = result.close;

    const res = await fetch(`http://127.0.0.1:${port}/app.js`);
    expect(res.headers.get("content-type")).toContain("application/javascript");
  });
});

// ── APPENDED BY Phase 50-00 Wave 0 scaffolding ───────────────────────────────
// New "latency endpoint" describe block. Existing tests above remain untouched.

function makeLatencyReport() {
  // Phase 51 Plan 03: the daemon's `latency` IPC handler now augments every
  // segment row with `slo_status`, `slo_threshold_ms`, and `slo_metric`. The
  // REST endpoint is a passthrough so the fields flow through to the client
  // unchanged. Fixture mirrors that shape so tests assert the augmented
  // contract, not the stale Phase 50 one.
  return {
    agent: "alpha",
    since: "2026-04-12T00:00:00.000Z",
    segments: [
      {
        segment: "end_to_end",
        p50: 1000,
        p95: 2000,
        p99: 3000,
        count: 10,
        slo_status: "healthy",
        slo_threshold_ms: 6000,
        slo_metric: "p95",
      },
      {
        segment: "first_token",
        p50: 400,
        p95: 800,
        p99: 1200,
        count: 10,
        slo_status: "healthy",
        slo_threshold_ms: 2000,
        slo_metric: "p50",
      },
      {
        segment: "context_assemble",
        p50: 50,
        p95: 100,
        p99: 150,
        count: 10,
        slo_status: "healthy",
        slo_threshold_ms: 300,
        slo_metric: "p95",
      },
      {
        segment: "tool_call",
        p50: 75,
        p95: 150,
        p99: 225,
        count: 20,
        slo_status: "healthy",
        slo_threshold_ms: 1500,
        slo_metric: "p95",
      },
    ],
  };
}

describe("latency endpoint", () => {
  let closeServer: (() => Promise<void>) | null = null;
  let port: number;

  beforeEach(() => {
    port = 30_000 + Math.floor(Math.random() * 10_000);

    mockedSendIpcRequest.mockImplementation(async (_socketPath, method) => {
      if (method === "status") return { entries: [] };
      if (method === "context-zone-status") return { agents: {} };
      if (method === "latency") return makeLatencyReport();
      if (method === "start" || method === "stop" || method === "restart") return { ok: true };
      throw new Error(`Unknown method: ${method}`);
    });
  });

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
    vi.restoreAllMocks();
  });

  it("latency: returns 200 with LatencyReport json for valid agent", async () => {
    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000,
    });
    closeServer = result.close;

    const res = await fetch(`http://127.0.0.1:${port}/api/agents/alpha/latency`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(body).toEqual(makeLatencyReport());
  });

  it("latency: segment rows carry slo_threshold_ms (number|null) and slo_metric (string|null) alongside slo_status", async () => {
    // Phase 51 Plan 03 contract: the REST endpoint is a passthrough over the
    // augmented IPC response. Each segment row MUST carry the three new
    // fields so the dashboard renders cell color + "SLO target" subtitle
    // directly from the response (no client-side SLO mirror). We assert the
    // field types permissively (number OR null, string OR null) to stay
    // forward-compatible with segments that have no configured SLO.
    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000,
    });
    closeServer = result.close;

    const res = await fetch(`http://127.0.0.1:${port}/api/agents/alpha/latency`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      segments: Array<{
        segment: string;
        slo_status?: string;
        slo_threshold_ms: number | null;
        slo_metric: string | null;
      }>;
    };

    expect(Array.isArray(body.segments)).toBe(true);
    expect(body.segments.length).toBeGreaterThan(0);

    for (const seg of body.segments) {
      expect(seg).toEqual(
        expect.objectContaining({
          segment: expect.any(String),
          slo_status: expect.stringMatching(/^(healthy|breach|no_data)$/),
        }),
      );
      expect(
        typeof seg.slo_threshold_ms === "number" || seg.slo_threshold_ms === null,
      ).toBe(true);
      expect(
        typeof seg.slo_metric === "string" || seg.slo_metric === null,
      ).toBe(true);
    }
  });

  it("latency: defaults since to 24h when query param absent", async () => {
    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000,
    });
    closeServer = result.close;

    await fetch(`http://127.0.0.1:${port}/api/agents/alpha/latency`);
    expect(mockedSendIpcRequest).toHaveBeenCalledWith(
      "/tmp/test.sock",
      "latency",
      expect.objectContaining({ agent: "alpha", since: "24h" }),
    );
  });

  it("latency: passes ?since=7d through to IPC method", async () => {
    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000,
    });
    closeServer = result.close;

    await fetch(`http://127.0.0.1:${port}/api/agents/alpha/latency?since=7d`);
    expect(mockedSendIpcRequest).toHaveBeenCalledWith(
      "/tmp/test.sock",
      "latency",
      expect.objectContaining({ agent: "alpha", since: "7d" }),
    );
  });

  it("latency: returns 500 with error message when IPC throws", async () => {
    mockedSendIpcRequest.mockImplementation(async (_socketPath, method) => {
      if (method === "latency") throw new Error("daemon unreachable");
      return {};
    });

    const result = await startDashboardServer({
      port,
      socketPath: "/tmp/test.sock",
      pollIntervalMs: 60_000,
    });
    closeServer = result.close;

    const res = await fetch(`http://127.0.0.1:${port}/api/agents/alpha/latency`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("daemon unreachable");
  });
});
