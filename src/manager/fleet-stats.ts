/**
 * Phase 109-D — fleet-wide observability snapshot builder.
 *
 * Pure helper that walks /proc once + reads the cgroup memory files once
 * and assembles the FleetStatsData shape for the daemon's `fleet-stats`
 * IPC handler.
 *
 * Linux-only signals (cgroup, /proc) degrade to null on hosts where they
 * are unavailable rather than throwing — observability must never crash
 * the daemon.
 *
 * Reuses (no new substrate):
 *   - `listAllPids`, `readProcInfo`, `matchesAnyMcpCommand` from proc-scan
 *   - `readCgroupMemoryStats` from cgroup-stats
 *
 * Emits no logs of its own; the IPC handler logs success/failure once per
 * call.
 */

import { readFile } from "node:fs/promises";
import {
  listAllPids,
  readProcInfo,
  type ProcInfo,
} from "../mcp/proc-scan.js";
import { readCgroupMemoryStats } from "./cgroup-stats.js";
import type { FleetStatsData } from "../dashboard/types.js";

/** A claude proc cmdline like `/usr/bin/claude` or just `claude` (npm bin shim). */
const CLAUDE_CMDLINE_RE = /(?:^|\/)claude$/;

/**
 * Match the argv0 of a /proc cmdline against the canonical claude binary
 * shape. Identical regex to `discoverClaudeSubprocessPid` in
 * proc-scan.ts:306 — keep them in sync.
 */
export function cmdlineMatchesClaude(cmdline: readonly string[]): boolean {
  const argv0 = cmdline[0] ?? "";
  return CLAUDE_CMDLINE_RE.test(argv0);
}

/**
 * Per-pattern aggregate over a list of MCP cmdline regexes.
 *
 * Each entry's `pattern` is the human-readable pattern label (e.g.
 * "mcp-server-mysql"); the daemon caller derives these from the configured
 * mcpServers map. Procs whose cmdline matches multiple patterns are
 * counted once per matching pattern (intentional — operator can see which
 * label is responsible). RSS is summed in MB.
 */
export type McpFleetAggregate = {
  readonly pattern: string;
  readonly count: number;
  readonly rssMB: number;
};

/** Read VmRSS from /proc/[pid]/status (kB). Returns 0 on failure. */
export async function readProcRssMB(pid: number): Promise<number> {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const match = status.match(/^VmRSS:\s*(\d+)\s*kB/m);
    if (!match) return 0;
    return Number(match[1]) / 1024;
  } catch {
    return 0;
  }
}

/**
 * Walk every pid in /proc once and aggregate by MCP pattern + count
 * claude procs. Cheap when /proc has ~1k entries (single readdir, 1k
 * concurrent reads).
 *
 * Returns null when /proc is unavailable (non-Linux dev machines, sealed
 * containers without procfs).
 */
export async function buildFleetStats(args: {
  readonly daemonPid: number;
  readonly trackedClaudeCount: number;
  readonly mcpPatterns: ReadonlyArray<{ readonly label: string; readonly regex: RegExp }>;
  readonly cgroupPath?: string;
  /** Test seam — defaults to readProcRssMB. Tests inject deterministic values. */
  readonly readRssMB?: (pid: number) => Promise<number>;
}): Promise<FleetStatsData> {
  const readRss = args.readRssMB ?? readProcRssMB;
  const sampledAt = Date.now();
  const cgroupSnap = await readCgroupMemoryStats(args.cgroupPath);
  const cgroup = cgroupSnap
    ? {
        memoryCurrentBytes: cgroupSnap.memoryCurrent,
        memoryMaxBytes: cgroupSnap.memoryMax,
        memoryPercent: cgroupSnap.memoryPercent,
      }
    : null;

  let pids: readonly number[];
  try {
    pids = await listAllPids();
  } catch {
    return {
      cgroup,
      claudeProcDrift: null,
      mcpFleet: [],
      sampledAt,
    };
  }

  const infos = await Promise.all(
    pids.map(async (pid) => {
      try {
        return await readProcInfo(pid);
      } catch {
        return null;
      }
    }),
  );

  let claudeLiveCount = 0;
  const aggByLabel = new Map<string, { count: number; rssKB: number }>();
  for (const label of args.mcpPatterns.map((p) => p.label)) {
    aggByLabel.set(label, { count: 0, rssKB: 0 });
  }

  const rssReads: Array<Promise<void>> = [];
  for (const info of infos) {
    if (!info) continue;
    if (cmdlineMatchesClaude(info.cmdline)) claudeLiveCount += 1;
    const cmdlineStr = info.cmdline.join(" ");
    for (const { label, regex } of args.mcpPatterns) {
      if (regex.test(cmdlineStr)) {
        const slot = aggByLabel.get(label)!;
        slot.count += 1;
        rssReads.push(
          readRss(info.pid).then((mb) => {
            slot.rssKB += mb * 1024;
          }),
        );
      }
    }
  }
  await Promise.all(rssReads);

  const mcpFleet: McpFleetAggregate[] = [];
  for (const [label, { count, rssKB }] of aggByLabel) {
    mcpFleet.push({
      pattern: label,
      count,
      rssMB: Math.round(rssKB / 1024),
    });
  }
  // Stable order: alphabetical, plays well with snapshot tests + greppable
  // operator output.
  mcpFleet.sort((a, b) => a.pattern.localeCompare(b.pattern));

  return {
    cgroup,
    claudeProcDrift: {
      liveCount: claudeLiveCount,
      trackedCount: args.trackedClaudeCount,
      drift: Math.max(0, claudeLiveCount - args.trackedClaudeCount),
    },
    mcpFleet,
    sampledAt,
  };
}

/** Test-only escape hatch — used by the unit tests to inject fake proc info. */
export type _FleetStatsTestArgs = {
  readonly procInfos: ReadonlyArray<ProcInfo>;
};
