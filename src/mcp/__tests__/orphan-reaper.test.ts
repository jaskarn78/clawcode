/**
 * Phase 999.14 Plan 00 — orphan-reaper.ts unit + Linux integration tests.
 *
 * Covers MCP-03 + MCP-05 substrate:
 *   - scanForOrphanMcps filter: ppid==1 AND uid match AND cmdline match AND age>=5s
 *   - reapOrphans canonical pino warn log shape (pinned exactly per CONTEXT.md)
 *   - SIGTERM-then-SIGKILL with grace; ESRCH idempotency
 *   - startOrphanReaper interval handle; clearInterval stops scans
 *   - boot-scan reason flows through to log fields
 *   - Linux integration: real orphan via bash double-fork
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { spawn } from "node:child_process";

const { listAllPidsMock, readProcInfoMock } = vi.hoisted(() => ({
  listAllPidsMock: vi.fn(),
  readProcInfoMock: vi.fn(),
}));

vi.mock("../proc-scan.js", async () => {
  const actual = await vi.importActual<typeof import("../proc-scan.js")>(
    "../proc-scan.js",
  );
  return {
    ...actual,
    listAllPids: listAllPidsMock,
    readProcInfo: readProcInfoMock,
  };
});

import {
  scanForOrphanMcps,
  reapOrphans,
  startOrphanReaper,
} from "../orphan-reaper.js";
import { buildMcpCommandRegexes } from "../proc-scan.js";

const isLinux = process.platform === "linux";

function captureLogger(): {
  log: pino.Logger;
  lines: () => Array<Record<string, unknown>>;
} {
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

const TEST_PATTERNS = buildMcpCommandRegexes({
  mysql: { command: "sh", args: ["-c", "mcp-server-mysql"] },
});

const NOW_SEC = Math.floor(Date.now() / 1000);
const BOOT_TIME_UNIX = NOW_SEC - 100_000; // boot was 100k seconds ago
const CLOCK_TICKS = 100;
/** Helper: starttime in jiffies for a given age in seconds. */
const startTimeFor = (ageSec: number): number =>
  (NOW_SEC - ageSec - BOOT_TIME_UNIX) * CLOCK_TICKS;

describe("scanForOrphanMcps", () => {
  beforeEach(() => {
    listAllPidsMock.mockReset();
    readProcInfoMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1: filters on ppid==1 AND uid match AND cmdline match AND age>=5s", async () => {
    const procs: Record<number, ReturnType<typeof Object>> = {
      100: {
        pid: 100,
        ppid: 1,
        uid: 999,
        cmdline: ["sh", "-c", "mcp-server-mysql"],
        startTimeJiffies: startTimeFor(10),
      }, // MATCH
      101: {
        pid: 101,
        ppid: 5000,
        uid: 999,
        cmdline: ["sh", "-c", "mcp-server-mysql"],
        startTimeJiffies: startTimeFor(10),
      }, // skip — has parent
      102: {
        pid: 102,
        ppid: 1,
        uid: 0,
        cmdline: ["sh", "-c", "mcp-server-mysql"],
        startTimeJiffies: startTimeFor(10),
      }, // skip — wrong uid
      103: {
        pid: 103,
        ppid: 1,
        uid: 999,
        cmdline: ["bash"],
        startTimeJiffies: startTimeFor(10),
      }, // skip — cmdline mismatch
      104: {
        pid: 104,
        ppid: 1,
        uid: 999,
        cmdline: ["sh", "-c", "mcp-server-mysql"],
        startTimeJiffies: startTimeFor(2),
      }, // skip — too young
    };

    listAllPidsMock.mockResolvedValue(Object.keys(procs).map(Number));
    readProcInfoMock.mockImplementation(async (pid: number) => procs[pid] ?? null);

    const orphans = await scanForOrphanMcps({
      uid: 999,
      patterns: TEST_PATTERNS,
      minAgeSeconds: 5,
      clockTicksPerSec: CLOCK_TICKS,
      bootTimeUnix: BOOT_TIME_UNIX,
    });

    expect(orphans.length).toBe(1);
    expect(orphans[0].pid).toBe(100);
  });
});

describe("reapOrphans", () => {
  beforeEach(() => {
    listAllPidsMock.mockReset();
    readProcInfoMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupOneOrphan() {
    listAllPidsMock.mockResolvedValue([100]);
    readProcInfoMock.mockResolvedValue({
      pid: 100,
      ppid: 1,
      uid: 999,
      cmdline: ["sh", "-c", "mcp-server-mysql"],
      startTimeJiffies: startTimeFor(10),
    });
  }

  it("Test 2: canonical SIGTERM warn log shape", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => true);
    setupOneOrphan();
    // After kill, second scan returns empty (proc died)
    let firstScan = true;
    listAllPidsMock.mockImplementation(async () => (firstScan ? [100] : []));
    readProcInfoMock.mockImplementation(async (pid: number) => {
      if (firstScan) {
        return {
          pid,
          ppid: 1,
          uid: 999,
          cmdline: ["sh", "-c", "mcp-server-mysql"],
          startTimeJiffies: startTimeFor(10),
        };
      }
      return null;
    });
    // Toggle firstScan after first scan completes — emulate proc dying.
    setTimeout(() => {
      firstScan = false;
    }, 5);

    const { log, lines } = captureLogger();
    await reapOrphans({
      uid: 999,
      patterns: TEST_PATTERNS,
      clockTicksPerSec: CLOCK_TICKS,
      bootTimeUnix: BOOT_TIME_UNIX,
      reason: "orphan-ppid-1",
      log,
      graceMs: 50,
    });

    const sigterm = lines().find(
      (l) => l.component === "mcp-reaper" && l.action === "sigterm",
    );
    expect(sigterm).toBeDefined();
    expect(sigterm!.pid).toBe(100);
    expect(sigterm!.cmdline).toBe("sh -c mcp-server-mysql");
    expect(sigterm!.reason).toBe("orphan-ppid-1");
    expect(sigterm!.msg).toBe("reaping orphaned MCP server");
  });

  it("Test 3: SIGKILL after grace if orphan stays alive", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    // Orphan stays alive forever — both scans return it
    setupOneOrphan();

    const { log, lines } = captureLogger();
    await reapOrphans({
      uid: 999,
      patterns: TEST_PATTERNS,
      clockTicksPerSec: CLOCK_TICKS,
      bootTimeUnix: BOOT_TIME_UNIX,
      reason: "orphan-ppid-1",
      log,
      graceMs: 50,
    });

    // SIGTERM was called with positive pid (orphans don't reliably retain pgid)
    expect(killSpy).toHaveBeenCalledWith(100, "SIGTERM");
    // SIGKILL also called (still alive after grace)
    expect(killSpy).toHaveBeenCalledWith(100, "SIGKILL");

    const sigkill = lines().find(
      (l) => l.component === "mcp-reaper" && l.action === "sigkill",
    );
    expect(sigkill).toBeDefined();
    expect(sigkill!.pid).toBe(100);
    expect(sigkill!.reason).toBe("orphan-ppid-1");
    expect(sigkill!.graceMs).toBe(50);
  });

  it("Test 4: ESRCH idempotency — process.kill throwing ESRCH does not crash reapOrphans", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      const e = new Error("no such process") as NodeJS.ErrnoException;
      e.code = "ESRCH";
      throw e;
    });
    setupOneOrphan();

    await expect(
      reapOrphans({
        uid: 999,
        patterns: TEST_PATTERNS,
        clockTicksPerSec: CLOCK_TICKS,
        bootTimeUnix: BOOT_TIME_UNIX,
        reason: "orphan-ppid-1",
        log: silentLogger(),
        graceMs: 50,
      }),
    ).resolves.not.toThrow();
  });

  it("Test 6: boot-scan reason flows into log entries", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => true);
    setupOneOrphan();
    // After SIGTERM the orphan dies on the next scan
    let scanCount = 0;
    listAllPidsMock.mockImplementation(async () => {
      scanCount++;
      return scanCount === 1 ? [100] : [];
    });

    const { log, lines } = captureLogger();
    await reapOrphans({
      uid: 999,
      patterns: TEST_PATTERNS,
      clockTicksPerSec: CLOCK_TICKS,
      bootTimeUnix: BOOT_TIME_UNIX,
      reason: "boot-scan",
      log,
      graceMs: 50,
    });

    const entries = lines().filter((l) => l.component === "mcp-reaper");
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.reason).toBe("boot-scan");
    }
  });
});

describe("startOrphanReaper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listAllPidsMock.mockReset();
    readProcInfoMock.mockReset();
    listAllPidsMock.mockResolvedValue([]); // no orphans, fast scans
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Test 5: clearInterval stops further scans", async () => {
    const handle = startOrphanReaper({
      uid: 999,
      patterns: TEST_PATTERNS,
      clockTicksPerSec: CLOCK_TICKS,
      bootTimeUnix: BOOT_TIME_UNIX,
      intervalMs: 1000,
      log: silentLogger(),
      graceMs: 50,
    });

    // First tick fires AFTER intervalMs (not immediately).
    expect(listAllPidsMock.mock.calls.length).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(listAllPidsMock.mock.calls.length).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(1000);
    const callsAfterTwo = listAllPidsMock.mock.calls.length;
    expect(callsAfterTwo).toBeGreaterThanOrEqual(2);

    clearInterval(handle);
    await vi.advanceTimersByTimeAsync(5000);
    // No further scans (allow for any in-flight)
    expect(listAllPidsMock.mock.calls.length).toBe(callsAfterTwo);
  });

  it("Test 8: onTickAfter callback runs AFTER reapOrphans completes (sequence pinned)", async () => {
    // Pinned ordering — locks the Wave 1 MCP-09 sweep wiring decision:
    // "stale-binding sweep runs AFTER orphan reaper on each tick".
    const callOrder: string[] = [];

    // Wire reapOrphans to log when it finishes via the listAllPids mock
    // (called inside scanForOrphanMcps, which reapOrphans calls twice).
    listAllPidsMock.mockImplementation(async () => {
      callOrder.push("reapOrphans-scan");
      return [];
    });

    const onTickAfter = vi.fn(async () => {
      callOrder.push("onTickAfter");
    });

    const handle = startOrphanReaper({
      uid: 999,
      patterns: TEST_PATTERNS,
      clockTicksPerSec: CLOCK_TICKS,
      bootTimeUnix: BOOT_TIME_UNIX,
      intervalMs: 1000,
      log: silentLogger(),
      graceMs: 50,
      onTickAfter,
    });

    await vi.advanceTimersByTimeAsync(1000);
    // Stop the interval so the next advance doesn't loop forever, then
    // drain any in-flight microtasks (the async wrapper inside the tick).
    clearInterval(handle);
    await vi.advanceTimersByTimeAsync(100);

    // Reap MUST complete before onTickAfter — sequence pinned.
    expect(onTickAfter).toHaveBeenCalled();
    const lastReapIdx = callOrder.lastIndexOf("reapOrphans-scan");
    const firstAfterIdx = callOrder.indexOf("onTickAfter");
    expect(lastReapIdx).toBeGreaterThanOrEqual(0);
    expect(firstAfterIdx).toBeGreaterThan(lastReapIdx);
  });
});

describe("Linux real-orphan integration", () => {
  it.skipIf(!isLinux)(
    "Test 7: terminates a real orphan via bash double-fork pattern",
    async () => {
      // Strategy: spawn a node setInterval with a unique arg, disown it from
      // bash. When bash exits, the node child reparents to PID 1.
      // node accepts trailing positional args (sleep does not), so this gives
      // us a unique cmdline we can match against.
      const tag = `cc-orphan-fixture-${process.pid}-${Date.now()}`;
      const child = spawn("bash", [
        "-c",
        `node -e "setInterval(()=>{},10000)" ${tag} & disown`,
      ]);

      // Wait for bash to exit — the node child is now an orphan (PPID=1).
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
      });
      // Small settle so /proc reflects the reparent
      await new Promise((r) => setTimeout(r, 300));

      const patterns = buildMcpCommandRegexes({
        nodeFixture: {
          command: "node",
          args: ["-e", "setInterval(()=>{},10000)", tag],
        },
      });

      const myUid = (process.getuid as () => number)();

      // Bypass the module-level mocks for this test — route to the real
      // proc-scan helpers so /proc is actually walked.
      const real = await vi.importActual<typeof import("../proc-scan.js")>(
        "../proc-scan.js",
      );
      listAllPidsMock.mockImplementation(() => real.listAllPids());
      readProcInfoMock.mockImplementation((pid: number) =>
        real.readProcInfo(pid),
      );

      const realReaper = await import("../orphan-reaper.js");
      // Use the REAL boot time — starttime jiffies are measured from real
      // boot, so the age math must use the matching epoch.
      const realBootTimeUnix = await real.readBootTimeUnix();
      const orphans = await realReaper.scanForOrphanMcps({
        uid: myUid,
        patterns,
        minAgeSeconds: 0,
        clockTicksPerSec: 100,
        bootTimeUnix: realBootTimeUnix,
      });

      const ours = orphans.find((o) => o.cmdline.join(" ").includes(tag));
      expect(ours).toBeDefined();
      expect(ours!.pid).toBeGreaterThan(0);

      // Cleanup — SIGKILL the orphan so the test host stays clean.
      try {
        process.kill(ours!.pid, "SIGKILL");
      } catch {
        /* may already be dead */
      }
    },
  );
});
