import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFleetStats, cmdlineMatchesClaude } from "../fleet-stats.js";
import * as procScan from "../../mcp/proc-scan.js";
import * as cgroupStats from "../cgroup-stats.js";

describe("cmdlineMatchesClaude", () => {
  it("matches /usr/bin/claude argv0", () => {
    expect(cmdlineMatchesClaude(["/usr/bin/claude"])).toBe(true);
  });
  it("matches bare 'claude' argv0", () => {
    expect(cmdlineMatchesClaude(["claude"])).toBe(true);
  });
  it("matches with args present", () => {
    expect(cmdlineMatchesClaude(["/usr/bin/claude", "--mcp", "1password"])).toBe(true);
  });
  it("rejects /usr/bin/claudec (suffix collision)", () => {
    expect(cmdlineMatchesClaude(["/usr/bin/claudec"])).toBe(false);
  });
  it("rejects empty cmdline", () => {
    expect(cmdlineMatchesClaude([])).toBe(false);
  });
});

describe("buildFleetStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aggregates MCP procs by pattern with summed RSS", async () => {
    vi.spyOn(cgroupStats, "readCgroupMemoryStats").mockResolvedValue({
      memoryCurrent: 1_000_000,
      memoryMax: 10_000_000,
      memoryPercent: 10,
      path: "/x",
    });
    vi.spyOn(procScan, "listAllPids").mockResolvedValue([100, 101, 102, 103]);
    vi.spyOn(procScan, "readProcInfo").mockImplementation(async (pid) => {
      const map: Record<number, procScan.ProcInfo> = {
        100: {
          pid: 100,
          ppid: 1,
          uid: 1000,
          cmdline: ["/usr/bin/claude"],
          startTimeJiffies: 1,
        },
        101: {
          pid: 101,
          ppid: 100,
          uid: 1000,
          cmdline: ["npx", "-y", "mcp-server-mysql@latest"],
          startTimeJiffies: 2,
        },
        102: {
          pid: 102,
          ppid: 100,
          uid: 1000,
          cmdline: ["sh", "-c", "mcp-server-mysql"],
          startTimeJiffies: 3,
        },
        103: {
          pid: 103,
          ppid: 100,
          uid: 1000,
          cmdline: ["node", "/usr/local/lib/node_modules/brave-search/index.js"],
          startTimeJiffies: 4,
        },
      };
      return map[pid] ?? null;
    });
    const stats = await buildFleetStats({
      daemonPid: 99,
      trackedClaudeCount: 0,
      mcpPatterns: [
        { label: "finmentum-db", regex: /\bmcp-server-mysql\b/, runtime: "external" },
        { label: "brave-search", regex: /brave-search/, runtime: "external" },
      ],
      readRssMB: async () => 100,
    });

    expect(stats.cgroup).toEqual({
      memoryCurrentBytes: 1_000_000,
      memoryMaxBytes: 10_000_000,
      memoryPercent: 10,
    });
    expect(stats.claudeProcDrift).toEqual({
      liveCount: 1,
      trackedCount: 0,
      drift: 1,
    });
    expect(stats.mcpFleet).toEqual([
      { pattern: "brave-search", count: 1, rssMB: 100, runtime: "external" },
      { pattern: "finmentum-db", count: 2, rssMB: 200, runtime: "external" },
    ]);
    // Phase 110 Stage 0a — both entries are external; no shim-runtime
    // entries means baseline is null.
    expect(stats.shimRuntimeBaseline).toBeNull();
  });

  it("returns cgroup=null when readCgroupMemoryStats fails", async () => {
    vi.spyOn(cgroupStats, "readCgroupMemoryStats").mockResolvedValue(null);
    vi.spyOn(procScan, "listAllPids").mockResolvedValue([]);
    const stats = await buildFleetStats({
      daemonPid: 1,
      trackedClaudeCount: 0,
      mcpPatterns: [],
    });
    expect(stats.cgroup).toBeNull();
    expect(stats.claudeProcDrift).toEqual({ liveCount: 0, trackedCount: 0, drift: 0 });
    expect(stats.mcpFleet).toEqual([]);
    expect(stats.shimRuntimeBaseline).toBeNull();
  });

  it("returns claudeProcDrift=null when /proc is unavailable", async () => {
    vi.spyOn(cgroupStats, "readCgroupMemoryStats").mockResolvedValue(null);
    vi.spyOn(procScan, "listAllPids").mockRejectedValue(new Error("ENOENT"));
    const stats = await buildFleetStats({
      daemonPid: 1,
      trackedClaudeCount: 0,
      mcpPatterns: [],
    });
    expect(stats.claudeProcDrift).toBeNull();
    expect(stats.mcpFleet).toEqual([]);
    expect(stats.shimRuntimeBaseline).toBeNull();
  });

  it("clamps drift to 0 when tracker count exceeds live count", async () => {
    vi.spyOn(cgroupStats, "readCgroupMemoryStats").mockResolvedValue(null);
    vi.spyOn(procScan, "listAllPids").mockResolvedValue([100]);
    vi.spyOn(procScan, "readProcInfo").mockResolvedValue({
      pid: 100,
      ppid: 1,
      uid: 1000,
      cmdline: ["/usr/bin/claude"],
      startTimeJiffies: 1,
    });
    const stats = await buildFleetStats({
      daemonPid: 99,
      trackedClaudeCount: 5,
      mcpPatterns: [],
    });
    expect(stats.claudeProcDrift).toEqual({
      liveCount: 1,
      trackedCount: 5,
      drift: 0,
    });
  });
});

describe("buildFleetStats — Phase 110 Stage 0a runtime classification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rolls up `node` runtime entries into shimRuntimeBaseline.node", async () => {
    vi.spyOn(cgroupStats, "readCgroupMemoryStats").mockResolvedValue(null);
    vi.spyOn(procScan, "listAllPids").mockResolvedValue([200, 201, 202]);
    vi.spyOn(procScan, "readProcInfo").mockImplementation(async (pid) => {
      const map: Record<number, procScan.ProcInfo> = {
        200: {
          pid: 200,
          ppid: 1,
          uid: 1000,
          cmdline: ["clawcode", "search-mcp"],
          startTimeJiffies: 1,
        },
        201: {
          pid: 201,
          ppid: 1,
          uid: 1000,
          cmdline: ["clawcode", "image-mcp"],
          startTimeJiffies: 2,
        },
        202: {
          pid: 202,
          ppid: 1,
          uid: 1000,
          cmdline: ["clawcode", "browser-mcp"],
          startTimeJiffies: 3,
        },
      };
      return map[pid] ?? null;
    });

    const stats = await buildFleetStats({
      daemonPid: 99,
      trackedClaudeCount: 0,
      mcpPatterns: [
        { label: "search", regex: /clawcode search-mcp/, runtime: "node" },
        { label: "image", regex: /clawcode image-mcp/, runtime: "node" },
        { label: "browser", regex: /clawcode browser-mcp/, runtime: "node" },
      ],
      readRssMB: async () => 147,
    });

    expect(stats.mcpFleet).toEqual([
      { pattern: "browser", count: 1, rssMB: 147, runtime: "node" },
      { pattern: "image", count: 1, rssMB: 147, runtime: "node" },
      { pattern: "search", count: 1, rssMB: 147, runtime: "node" },
    ]);
    expect(stats.shimRuntimeBaseline).toEqual({
      node: { count: 3, rssMB: 441 },
    });
  });

  it("excludes `external` entries from shimRuntimeBaseline (mixed case)", async () => {
    vi.spyOn(cgroupStats, "readCgroupMemoryStats").mockResolvedValue(null);
    vi.spyOn(procScan, "listAllPids").mockResolvedValue([300, 301]);
    vi.spyOn(procScan, "readProcInfo").mockImplementation(async (pid) => {
      const map: Record<number, procScan.ProcInfo> = {
        300: {
          pid: 300,
          ppid: 1,
          uid: 1000,
          cmdline: ["clawcode", "search-mcp"],
          startTimeJiffies: 1,
        },
        301: {
          pid: 301,
          ppid: 1,
          uid: 1000,
          cmdline: ["python3", "/x/brave_search.py"],
          startTimeJiffies: 2,
        },
      };
      return map[pid] ?? null;
    });

    const stats = await buildFleetStats({
      daemonPid: 99,
      trackedClaudeCount: 0,
      mcpPatterns: [
        { label: "search", regex: /clawcode search-mcp/, runtime: "node" },
        { label: "brave-search", regex: /brave_search\.py/, runtime: "external" },
      ],
      readRssMB: async (pid) => (pid === 300 ? 147 : 57),
    });

    // External entry visible in mcpFleet but excluded from baseline.
    expect(stats.mcpFleet).toContainEqual({
      pattern: "brave-search",
      count: 1,
      rssMB: 57,
      runtime: "external",
    });
    expect(stats.shimRuntimeBaseline).toEqual({
      node: { count: 1, rssMB: 147 },
    });
  });
});
