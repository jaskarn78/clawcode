/**
 * Phase 999.14 — MCP child process tracker (singleton, daemon-wide).
 *
 * Mirrors SecretsResolver DI shape (constructor captures deps, no module
 * state). Tracks per-agent MCP child PIDs and provides idempotent process-
 * group kills for MCP-02 (agent disconnect) and MCP-04 (daemon shutdown).
 *
 * Canonical log shape (pinned by tests):
 *   { component: "mcp-tracker", action: "sigterm" | "sigkill", pid, cmdline,
 *     reason: "agent-disconnect" | "shutdown" }
 */

import type { Logger } from "pino";
import { readProcInfo } from "./proc-scan.js";

/**
 * Idempotent process-group SIGTERM/SIGKILL helper.
 *
 * Calls `process.kill(-pid, sig)` — negative pid signals every process sharing
 * the pgid. Used for live MCP cleanup. Orphan reaper uses individual
 * `process.kill(pid, sig)` since orphan pgid leadership is unreliable.
 *
 * Refuses pid <= 1 (pid 0 hits caller's group, pid 1 is init). Returns true
 * on success OR ESRCH (idempotent), false on EPERM. Other errors logged +
 * rethrown.
 */
export function killGroup(
  pid: number,
  sig: NodeJS.Signals,
  log: Logger,
): boolean {
  if (pid <= 1) {
    log.error(
      { component: "mcp-tracker", action: "kill", pid, sig },
      "refusing to kill pid <= 1",
    );
    return false;
  }
  try {
    process.kill(-pid, sig);
    return true;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ESRCH") return true; // already gone — idempotent success
    if (e.code === "EPERM") {
      log.warn(
        { component: "mcp-tracker", action: "kill", pid, sig, code: "EPERM" },
        "kill denied (not our process)",
      );
      return false;
    }
    log.error(
      { component: "mcp-tracker", action: "kill", pid, sig, code: e.code },
      "kill failed unexpectedly",
    );
    throw err;
  }
}

export interface McpProcessTrackerDeps {
  readonly uid: number;
  readonly log: Logger;
  readonly clockTicksPerSec: number;
  readonly bootTimeUnix: number;
}

/** Polling interval for the post-SIGTERM grace loop. */
const POLL_MS = 250;

/**
 * Per-agent MCP PID tracker with idempotent process-group kills.
 */
export class McpProcessTracker {
  private readonly pids = new Map<string, ReadonlySet<number>>();
  /** Captured at register-time so kill-time logs include cmdline even after death. */
  private readonly cmdlines = new Map<number, string>();
  private readonly log: Logger;

  constructor(private readonly deps: McpProcessTrackerDeps) {
    this.log = deps.log;
  }

  /** Register PIDs under agent name; replaces prior set; captures cmdlines. */
  async register(agentName: string, pids: readonly number[]): Promise<void> {
    const next = new Set<number>(pids);
    this.pids.set(agentName, next);
    // Best-effort cmdline capture; failure to read just leaves the cache empty
    // (kill log will use "unknown" for cmdline in that case).
    await Promise.all(
      pids.map(async (pid) => {
        try {
          const info = await readProcInfo(pid);
          if (info) {
            this.cmdlines.set(pid, info.cmdline.join(" "));
          }
        } catch {
          /* swallow — best-effort enrichment, not load-bearing */
        }
      }),
    );
  }

  /** Remove an agent's tracked PIDs. Returns the evicted PIDs. */
  unregister(agentName: string): readonly number[] {
    const evicted = this.pids.get(agentName);
    if (!evicted) return [];
    this.pids.delete(agentName);
    // Don't drop cmdline cache yet — killAll/killAgentGroup may still need them.
    return Array.from(evicted);
  }

  /** All tracked PIDs across every agent (deduplicated). */
  list(): readonly number[] {
    const all = new Set<number>();
    for (const set of this.pids.values()) {
      for (const pid of set) all.add(pid);
    }
    return Array.from(all);
  }

  /** Tracked PIDs for a specific agent (empty array if unknown). */
  listForAgent(agentName: string): readonly number[] {
    const set = this.pids.get(agentName);
    return set ? Array.from(set) : [];
  }

  /**
   * SIGTERM agent's PGs, await grace, SIGKILL stragglers. Idempotent — second
   * call after eviction is a no-op. Used by MCP-02.
   */
  async killAgentGroup(agentName: string, graceMs: number = 5000): Promise<void> {
    const pids = this.listForAgent(agentName);
    if (pids.length === 0) return; // already evicted — no-op
    await this.killPids(pids, graceMs, "agent-disconnect");
    // Evict on success so a second call is a no-op.
    this.pids.delete(agentName);
    for (const pid of pids) this.cmdlines.delete(pid);
  }

  /** SIGTERM every tracked PID (deduplicated), grace, SIGKILL. Used by MCP-04. */
  async killAll(graceMs: number = 5000): Promise<void> {
    const pids = this.list();
    if (pids.length === 0) return;
    await this.killPids(pids, graceMs, "shutdown");
    this.pids.clear();
    this.cmdlines.clear();
  }

  /** SIGTERM each pid, poll for liveness, SIGKILL stragglers after grace. */
  private async killPids(
    pids: readonly number[],
    graceMs: number,
    reason: "agent-disconnect" | "shutdown",
  ): Promise<void> {
    // Snapshot starttime per pid so we can detect PID recycling during the grace.
    const initialStartTime = new Map<number, number>();
    await Promise.all(
      pids.map(async (pid) => {
        try {
          const info = await readProcInfo(pid);
          if (info) initialStartTime.set(pid, info.startTimeJiffies);
        } catch {
          /* unreachable in practice; leave starttime unset → treat liveness as gone */
        }
      }),
    );

    // SIGTERM each pid via NEGATIVE pid (process-group form).
    for (const pid of pids) {
      const cmdline = this.cmdlines.get(pid) ?? "unknown";
      this.log.warn(
        {
          component: "mcp-tracker",
          action: "sigterm",
          pid,
          cmdline,
          reason,
        },
        "terminating MCP process group",
      );
      killGroup(pid, "SIGTERM", this.log);
    }

    // Poll until every pid is gone OR grace expires.
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      const alive = await this.checkAlive(pids, initialStartTime);
      if (alive.length === 0) return;
      await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
    }

    // Grace expired: SIGKILL stragglers via POSITIVE pid (orphan group leader
    // may already be dead; fall back to individual kill).
    const stragglers = await this.checkAlive(pids, initialStartTime);
    for (const pid of stragglers) {
      const cmdline = this.cmdlines.get(pid) ?? "unknown";
      this.log.warn(
        {
          component: "mcp-tracker",
          action: "sigkill",
          pid,
          cmdline,
          reason,
          graceMs,
        },
        "force-killing MCP process after grace",
      );
      try {
        process.kill(pid, "SIGKILL");
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "ESRCH") {
          this.log.error(
            { component: "mcp-tracker", action: "sigkill", pid, code: e.code },
            "SIGKILL failed unexpectedly",
          );
        }
      }
    }
  }

  /** Filter pids to those still alive with same starttime (no PID recycling). */
  private async checkAlive(
    pids: readonly number[],
    initialStartTime: Map<number, number>,
  ): Promise<readonly number[]> {
    const alive: number[] = [];
    for (const pid of pids) {
      try {
        const info = await readProcInfo(pid);
        if (!info) continue; // gone
        const expected = initialStartTime.get(pid);
        if (expected !== undefined && info.startTimeJiffies !== expected) {
          // PID recycled to unrelated process — treat as gone.
          continue;
        }
        alive.push(pid);
      } catch {
        // Treat I/O failure as gone (proc disappeared mid-read).
      }
    }
    return alive;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
