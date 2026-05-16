/**
 * Phase 999.14 — orphan MCP server reaper.
 *
 * Three callsites share one scanner:
 *   - MCP-03: 60s periodic sweep (startOrphanReaper)
 *   - MCP-05: one-shot at boot (reapOrphans with reason='boot-scan')
 *   - FIND-123-A: one-shot at daemon shutdown after mcpTracker.killAll
 *     (reapOrphans with reason='shutdown-scan'). ClawCode does not own the
 *     `claude` subprocess spawn so the tracker's negative-pid kills cannot
 *     reach `mcp-server-mysql` grandchildren; the shutdown sweep is the
 *     deterministic backstop that closes the reparent-to-PID-1 window.
 *
 * Filter: ppid===1 AND uid===configuredUid AND cmdline matches union regex
 * AND age >= minAgeSeconds (default 5; prevents racing freshly-spawned MCPs
 * during the npm-wrapper exec handoff — Pitfall 3).
 *
 * Orphans use POSITIVE pid kills (their pgid leaders may already be dead and
 * the original pgid value may have been recycled — RESEARCH Open Question 2).
 * Live MCP cleanup uses NEGATIVE pid via process-tracker.ts.
 *
 * Canonical log shape (pinned by tests + CONTEXT.md):
 *   { component: "mcp-reaper", action: "sigterm" | "sigkill", pid, cmdline,
 *     reason: "orphan-ppid-1" | "boot-scan" | "shutdown-scan", graceMs?, msg }
 */

import type { Logger } from "pino";
import {
  listAllPids,
  readProcInfo,
  matchesAnyMcpCommand,
  procAgeSeconds,
} from "./proc-scan.js";

/** Reaper trigger source — used as the canonical `reason` log field. */
export type ReaperReason = "orphan-ppid-1" | "boot-scan" | "shutdown-scan";

/** A single orphan candidate returned by scanForOrphanMcps. */
export type OrphanCandidate = {
  readonly pid: number;
  readonly cmdline: readonly string[];
  readonly startTimeJiffies: number;
};

export interface ScanForOrphansArgs {
  readonly uid: number;
  readonly patterns: RegExp;
  readonly minAgeSeconds?: number;
  readonly clockTicksPerSec: number;
  readonly bootTimeUnix: number;
}

/** Walk /proc and return orphan MCP candidates. Pure — no kills, no logs. */
export async function scanForOrphanMcps(
  args: ScanForOrphansArgs,
): Promise<readonly OrphanCandidate[]> {
  const minAge = args.minAgeSeconds ?? 5;
  const pids = await listAllPids();
  const candidates: OrphanCandidate[] = [];
  for (const pid of pids) {
    const info = await readProcInfo(pid);
    if (!info) continue;
    if (info.ppid !== 1) continue;
    if (info.uid !== args.uid) continue;
    const cmdlineStr = info.cmdline.join(" ");
    if (!matchesAnyMcpCommand(cmdlineStr, args.patterns)) continue;
    const age = procAgeSeconds({
      startTimeJiffies: info.startTimeJiffies,
      bootTimeUnix: args.bootTimeUnix,
      clockTicksPerSec: args.clockTicksPerSec,
    });
    if (age < minAge) continue;
    candidates.push({
      pid: info.pid,
      cmdline: info.cmdline,
      startTimeJiffies: info.startTimeJiffies,
    });
  }
  return candidates;
}

export interface ReapOrphansArgs extends ScanForOrphansArgs {
  readonly reason: ReaperReason;
  readonly log: Logger;
  readonly graceMs?: number;
}

/**
 * Scan for orphan MCPs, SIGTERM each, await grace, SIGKILL stragglers.
 * Idempotent on ESRCH; errors logged but never propagate (would crash the
 * daemon's setInterval host).
 */
export async function reapOrphans(args: ReapOrphansArgs): Promise<void> {
  const graceMs = args.graceMs ?? 10_000;
  const candidates = await scanForOrphanMcps(args);
  if (candidates.length === 0) return;

  // SIGTERM each candidate (positive pid — orphans don't reliably retain pgid).
  for (const c of candidates) {
    args.log.warn(
      {
        component: "mcp-reaper",
        action: "sigterm",
        pid: c.pid,
        cmdline: c.cmdline.join(" "),
        reason: args.reason,
      },
      "reaping orphaned MCP server",
    );
    try {
      process.kill(c.pid, "SIGTERM");
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ESRCH") {
        args.log.error(
          {
            component: "mcp-reaper",
            action: "sigterm",
            pid: c.pid,
            code: e.code,
          },
          "SIGTERM failed unexpectedly",
        );
      }
    }
  }

  // Grace period — let SIGTERM-handlers exit cleanly.
  await sleep(graceMs);

  // Rescan; survivors get SIGKILL.
  const survivors = await scanForOrphanMcps(args);
  for (const c of survivors) {
    args.log.warn(
      {
        component: "mcp-reaper",
        action: "sigkill",
        pid: c.pid,
        cmdline: c.cmdline.join(" "),
        reason: args.reason,
        graceMs,
      },
      "orphan MCP server force-killed after grace",
    );
    try {
      process.kill(c.pid, "SIGKILL");
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ESRCH") {
        args.log.error(
          {
            component: "mcp-reaper",
            action: "sigkill",
            pid: c.pid,
            code: e.code,
          },
          "SIGKILL failed unexpectedly",
        );
      }
    }
  }
}

export interface StartOrphanReaperArgs extends ScanForOrphansArgs {
  readonly intervalMs?: number;
  readonly log: Logger;
  readonly graceMs?: number;
  /**
   * Optional callback invoked AFTER the orphan reap completes on each tick.
   * Wave 1 wires the MCP-09 stale-binding sweep here so the sweep runs
   * after the orphan reaper (locked decision per CONTEXT.md). Errors from
   * this callback are logged but never propagate (would crash setInterval).
   */
  readonly onTickAfter?: () => Promise<void>;
}

/**
 * Start the periodic orphan reaper. Returns the timer handle for clearInterval
 * on daemon shutdown. First tick fires AFTER intervalMs (boot-scan covers t=0).
 * Errors caught and logged — never propagate out of setInterval.
 *
 * The optional `onTickAfter` callback runs sequentially AFTER reapOrphans
 * completes — not in parallel — so Wave 1's MCP-09 sweep observes the
 * post-reap registry state on each tick.
 */
export function startOrphanReaper(args: StartOrphanReaperArgs): NodeJS.Timeout {
  const intervalMs = args.intervalMs ?? 60_000;
  const handle = setInterval(() => {
    void (async () => {
      try {
        await reapOrphans({
          uid: args.uid,
          patterns: args.patterns,
          minAgeSeconds: args.minAgeSeconds,
          clockTicksPerSec: args.clockTicksPerSec,
          bootTimeUnix: args.bootTimeUnix,
          reason: "orphan-ppid-1",
          log: args.log,
          graceMs: args.graceMs,
        });
      } catch (err: unknown) {
        args.log.error(
          { component: "mcp-reaper", err: String(err) },
          "reaper tick failed",
        );
      }
      if (args.onTickAfter) {
        try {
          await args.onTickAfter();
        } catch (err: unknown) {
          args.log.error(
            { component: "mcp-reaper", err: String(err) },
            "onTickAfter callback failed",
          );
        }
      }
    })();
  }, intervalMs);
  return handle;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
