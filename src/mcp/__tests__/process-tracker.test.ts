/**
 * Phase 999.14 Plan 00 — process-tracker.ts unit tests.
 *
 * Covers MCP-01, MCP-02, MCP-04 substrate:
 *   - killGroup uses NEGATIVE pid (POSIX process-group form)
 *   - ESRCH idempotency (already-dead PID = success, no throw)
 *   - EPERM logged + returns false
 *   - pid <= 1 refused (never call process.kill)
 *   - McpProcessTracker register/unregister/list immutability
 *   - killAgentGroup SIGTERM-then-SIGKILL with grace via fake timers
 *   - killAll iterates all agents
 *   - canonical pino warn log shape pinned
 *   - idempotent killAgentGroup (second call no-op)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";

// Mock proc-scan so killAgentGroup polling can be controlled.
const { readProcInfoMock } = vi.hoisted(() => ({
  readProcInfoMock: vi.fn(),
}));

vi.mock("../proc-scan.js", async () => {
  const actual = await vi.importActual<typeof import("../proc-scan.js")>(
    "../proc-scan.js",
  );
  return {
    ...actual,
    readProcInfo: readProcInfoMock,
  };
});

import { McpProcessTracker, killGroup } from "../process-tracker.js";

function captureLogger(): { log: pino.Logger; lines: () => Array<Record<string, unknown>> } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const log = pino({ level: "debug" }, sink);
  const lines = () =>
    chunks
      .join("")
      .split("\n")
      .filter((s) => s.length > 0)
      .map((s) => JSON.parse(s) as Record<string, unknown>);
  return { log, lines };
}

function silentLogger(): pino.Logger {
  const sink = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  return pino({ level: "silent" }, sink);
}

describe("killGroup", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1: refuses pid <= 1, returns false, never calls process.kill", () => {
    const { log, lines } = captureLogger();
    expect(killGroup(1, "SIGTERM", log)).toBe(false);
    expect(killGroup(0, "SIGTERM", log)).toBe(false);
    expect(killGroup(-5, "SIGTERM", log)).toBe(false);
    expect(killSpy).not.toHaveBeenCalled();
    const errs = lines().filter((l) => l.level === 50);
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });

  it("Test 2: ESRCH returns true (idempotent success), no rethrow", () => {
    killSpy.mockImplementation(() => {
      const e = new Error("no such process") as NodeJS.ErrnoException;
      e.code = "ESRCH";
      throw e;
    });
    const result = killGroup(12345, "SIGTERM", silentLogger());
    expect(result).toBe(true);
  });

  it("Test 3: EPERM returns false + warn log emitted", () => {
    killSpy.mockImplementation(() => {
      const e = new Error("permission denied") as NodeJS.ErrnoException;
      e.code = "EPERM";
      throw e;
    });
    const { log, lines } = captureLogger();
    expect(killGroup(12345, "SIGTERM", log)).toBe(false);
    const warns = lines().filter((l) => l.level === 40);
    expect(warns.length).toBeGreaterThanOrEqual(1);
  });

  it("Test 4: happy path calls process.kill with NEGATIVE pid", () => {
    killGroup(12345, "SIGTERM", silentLogger());
    expect(killSpy).toHaveBeenCalledWith(-12345, "SIGTERM");
  });
});

describe("McpProcessTracker", () => {
  beforeEach(() => {
    readProcInfoMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeTracker(log = silentLogger()): McpProcessTracker {
    return new McpProcessTracker({
      uid: 1000,
      log,
      clockTicksPerSec: 100,
      bootTimeUnix: 1_700_000_000,
    });
  }

  it("Test 5: register/unregister/list/listForAgent — returns are immutable", async () => {
    // readProcInfo returns a stable cmdline for register-time capture
    readProcInfoMock.mockResolvedValue({
      pid: 100,
      ppid: 999,
      uid: 1000,
      cmdline: ["sh", "-c", "mcp-server-mysql"],
      startTimeJiffies: 50000,
    });

    const t = makeTracker();
    await t.register("agent-a", [100, 101]);
    await t.register("agent-b", [200]);

    expect(t.list().sort()).toEqual([100, 101, 200]);
    expect(t.listForAgent("agent-a").sort()).toEqual([100, 101]);
    expect(t.listForAgent("unknown")).toEqual([]);

    // Mutating returned array does not affect tracker (it's a fresh copy)
    const listed = [...t.listForAgent("agent-a")];
    listed.push(9999);
    expect(t.listForAgent("agent-a").sort()).toEqual([100, 101]);

    const evicted = t.unregister("agent-a");
    expect(evicted.sort()).toEqual([100, 101]);
    expect(t.list()).toEqual([200]);
  });

  it("Test 6: killAgentGroup SIGTERM-then-SIGKILL with grace", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    // Register-time readProcInfo returns valid info for cmdline capture.
    // Then during polling, return non-null (still alive) until forced.
    readProcInfoMock.mockResolvedValue({
      pid: 500,
      ppid: 999,
      uid: 1000,
      cmdline: ["sh", "-c", "mcp-server-mysql"],
      startTimeJiffies: 50000,
    });

    const t = makeTracker();
    await t.register("agent-x", [500]);

    // Drive killAgentGroup with a short grace; readProcInfo always returns
    // alive, so SIGKILL must fire after the grace period.
    await t.killAgentGroup("agent-x", 100);

    // SIGTERM via NEGATIVE pid (process group)
    expect(killSpy).toHaveBeenCalledWith(-500, "SIGTERM");
    // SIGKILL via POSITIVE pid (individual proc — group leader may be dead)
    expect(killSpy).toHaveBeenCalledWith(500, "SIGKILL");
  });

  it("Test 7: killAll iterates all agents — one SIGTERM per unique pid", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    readProcInfoMock.mockResolvedValue({
      pid: 0,
      ppid: 999,
      uid: 1000,
      cmdline: ["sh", "-c", "mcp"],
      startTimeJiffies: 50000,
    });

    const t = makeTracker();
    await t.register("agent-a", [100, 200]);
    await t.register("agent-b", [200, 300]); // 200 overlaps

    // After register, immediately make readProcInfo return null so SIGKILL is skipped
    readProcInfoMock.mockResolvedValue(null);

    await t.killAll(50);

    const sigtermCalls = killSpy.mock.calls.filter((c) => c[1] === "SIGTERM");
    const sigtermPids = sigtermCalls.map((c) => Math.abs(Number(c[0]))).sort();
    // Each unique pid SIGTERM'd exactly once
    expect(sigtermPids).toEqual([100, 200, 300]);
    // All sent via NEGATIVE pid (process-group form)
    for (const c of sigtermCalls) {
      expect(Number(c[0])).toBeLessThan(0);
    }
  });

  it("Test 8: canonical log shape — component=mcp-tracker, action=sigterm, reason=agent-disconnect", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => true);

    readProcInfoMock.mockResolvedValueOnce({
      pid: 700,
      ppid: 999,
      uid: 1000,
      cmdline: ["sh", "-c", "mcp-server-mysql"],
      startTimeJiffies: 50000,
    });

    const { log, lines } = captureLogger();
    const t = new McpProcessTracker({
      uid: 1000,
      log,
      clockTicksPerSec: 100,
      bootTimeUnix: 1_700_000_000,
    });
    await t.register("agent-y", [700]);

    // Subsequent readProcInfo returns null (proc dies cleanly after SIGTERM)
    readProcInfoMock.mockResolvedValue(null);

    await t.killAgentGroup("agent-y", 50);

    const allLogs = lines();
    const sigterm = allLogs.find(
      (l) =>
        l.component === "mcp-tracker" &&
        l.action === "sigterm" &&
        l.pid === 700,
    );
    expect(sigterm).toBeDefined();
    expect(sigterm!.reason).toBe("agent-disconnect");
    expect(typeof sigterm!.cmdline).toBe("string");
    expect(sigterm!.cmdline).toContain("mcp-server-mysql");
  });

  it("Test 9: idempotent killAgentGroup — second call is a no-op", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    readProcInfoMock.mockResolvedValue({
      pid: 800,
      ppid: 999,
      uid: 1000,
      cmdline: ["foo"],
      startTimeJiffies: 50000,
    });

    const t = makeTracker();
    await t.register("agent-z", [800]);

    // Make readProcInfo null after first SIGTERM so SIGKILL is skipped
    readProcInfoMock.mockResolvedValue(null);

    await t.killAgentGroup("agent-z", 50);
    const callsAfterFirst = killSpy.mock.calls.length;

    // Second call — agent already evicted, must not throw or kill anything
    await expect(t.killAgentGroup("agent-z", 50)).resolves.not.toThrow();
    expect(killSpy.mock.calls.length).toBe(callsAfterFirst);
  });
});
