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
 * Phase 110 Stage 0a — runtime classification for an MCP shim/server.
 *
 *   - "node":     Loader-auto-injected `clawcode {search,image,browser}-mcp`
 *                 (or `mcp-broker-shim`) running under the bundled Node
 *                 CLI — current production runtime.
 *   - "static":   Reserved for Stage 0b's static-binary alternate runtime.
 *   - "python":   Reserved for Stage 0b's python-wrapper alternate runtime.
 *   - "external": Yaml-defined entries the loader does NOT auto-inject
 *                 (e.g. brave_search.py, fal_ai.py, mcp-server-mysql).
 *                 These are out of scope for shim-runtime swap.
 */
export type McpRuntime = "node" | "static" | "python" | "external";

/**
 * Per-pattern aggregate over a list of MCP cmdline regexes.
 *
 * Each entry's `pattern` is the human-readable pattern label (e.g.
 * "mcp-server-mysql"); the daemon caller derives these from the configured
 * mcpServers map. Procs whose cmdline matches multiple patterns are
 * counted once per matching pattern (intentional — operator can see which
 * label is responsible). RSS is summed in MB.
 *
 * Phase 110 Stage 0a — `runtime` lets `/api/fleet-stats` consumers split
 * the fleet into shim-runtime cohorts (the targets of Stage 0 / Stage 1
 * memory-reduction work) vs. external servers (out of scope). The summary
 * `shimRuntimeBaseline` field on the parent `FleetStatsData` rolls these
 * up so dashboards can show the win headline without iterating per-pattern.
 */
export type McpFleetAggregate = {
  readonly pattern: string;
  readonly count: number;
  readonly rssMB: number;
  readonly runtime: McpRuntime;
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
  /**
   * Phase 110 Stage 0a — element shape now carries `runtime` so the
   * daemon-side classification (loader-auto-injected shims vs.
   * yaml-defined externals) flows through to /api/fleet-stats consumers
   * without re-deriving from the cmdline at the dashboard boundary.
   */
  readonly mcpPatterns: ReadonlyArray<{
    readonly label: string;
    readonly regex: RegExp;
    readonly runtime: McpRuntime;
  }>;
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
      shimRuntimeBaseline: null,
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
  const aggByLabel = new Map<
    string,
    { count: number; rssKB: number; runtime: McpRuntime }
  >();
  for (const p of args.mcpPatterns) {
    aggByLabel.set(p.label, { count: 0, rssKB: 0, runtime: p.runtime });
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
  for (const [label, { count, rssKB, runtime }] of aggByLabel) {
    mcpFleet.push({
      pattern: label,
      count,
      rssMB: Math.round(rssKB / 1024),
      runtime,
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
    shimRuntimeBaseline: buildShimRuntimeBaseline(mcpFleet),
    sampledAt,
  };
}

/**
 * Phase 110 Stage 0a — roll up `mcpFleet` entries by runtime so dashboards
 * can show "{count} shims, {rssMB} MB on node runtime" without iterating.
 *
 * Skips `runtime: "external"` (yaml-defined entries are not in scope for
 * the Stage 0 swap). Returns `null` when there are no shim-runtime
 * entries at all (e.g. a host without auto-inject — distinguish from
 * "all-zero" baseline so the dashboard renderer can show "unknown" vs.
 * "0 shims").
 */
function buildShimRuntimeBaseline(
  mcpFleet: ReadonlyArray<McpFleetAggregate>,
): FleetStatsData["shimRuntimeBaseline"] {
  const buckets: Partial<Record<
    Exclude<McpRuntime, "external">,
    { count: number; rssMB: number }
  >> = {};
  let any = false;
  for (const entry of mcpFleet) {
    if (entry.runtime === "external") continue;
    any = true;
    const slot = buckets[entry.runtime] ?? { count: 0, rssMB: 0 };
    slot.count += entry.count;
    slot.rssMB += entry.rssMB;
    buckets[entry.runtime] = slot;
  }
  if (!any) return null;
  // Always include "node" key (even at 0/0) so the headline metric shape
  // is stable for dashboards. "static" / "python" only appear when an
  // entry classified as such (Stage 0b widens the enum).
  return {
    node: buckets.node ?? { count: 0, rssMB: 0 },
    ...(buckets.static !== undefined ? { static: buckets.static } : {}),
    ...(buckets.python !== undefined ? { python: buckets.python } : {}),
  };
}

/** Test-only escape hatch — used by the unit tests to inject fake proc info. */
export type _FleetStatsTestArgs = {
  readonly procInfos: ReadonlyArray<ProcInfo>;
};
