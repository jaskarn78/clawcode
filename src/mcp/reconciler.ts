/**
 * Phase 999.15 — Tracker reconciliation engine (TRACK-01 + TRACK-04).
 *
 * Per-tick self-healing for the McpProcessTracker. Wakes up via
 * onTickAfter on the existing 60s orphan-reaper interval (wired in
 * src/manager/daemon.ts) and walks every registered agent:
 *
 *   - If recorded claudePid is dead → re-discover with minAge=10s.
 *       - Found → updateAgent(name, newPid). reason="stale-claude".
 *       - Not found → unregister(name). reason="agent-gone".
 *   - If reason is "stale-claude" OR oldMcpCount === 0 → re-walk MCP
 *     children → replaceMcpPids(name, newMcpPids). reason upgraded to
 *     "agent-restart" if oldMcpCount > 0 AND new mcpPids differ.
 *
 * Logging is DIFF-BASED: emits ONE warn log per agent per cycle ONLY when
 * tracker state actually changed (canonical envelope below). No-op cycles
 * are silent (CONTEXT determinism — required for journal cleanliness on
 * busy hosts where 14+ agents tick every 60s).
 *
 * Canonical log envelope (pinned by reconciler.test.ts Test 7):
 *   { component: "mcp-tracker", action: "reconcile", agent,
 *     oldClaudePid, newClaudePid, oldMcpCount, newMcpCount, reason,
 *     msg: "tracker state reconciled" }
 *
 * agent-gone variant:
 *   { component: "mcp-tracker", action: "reconcile", agent,
 *     oldClaudePid, oldMcpCount, reason: "agent-gone",
 *     msg: "tracker entry dropped — claude proc gone" }
 *
 * Iteration safety: snapshots agent NAMES via Array.from(...keys()) before
 * iterating so that mid-iteration mutations (unregister on agent-gone,
 * concurrent register from session-manager.ts polled discovery) don't
 * corrupt the walk (CONTEXT Pitfall 4).
 *
 * Error swallow: each agent's reconcile is in its own try/catch. A failure
 * for one agent NEVER propagates to the caller (onTickAfter must not
 * crash the reaper interval) and never blocks sibling agents.
 */

import type { Logger } from "pino";
import {
  discoverAgentMcpPids,
  discoverClaudeSubprocessPid,
  isPidAlive,
} from "./proc-scan.js";
import type { McpProcessTracker } from "./process-tracker.js";

export type ReconcileReason =
  | "stale-claude"
  | "missing-mcps"
  | "agent-restart"
  | "agent-gone";

export interface ReconcileDeps {
  readonly tracker: McpProcessTracker;
  readonly daemonPid: number;
  readonly log: Logger;
  /** Required when proc-scan opts.minAge is exercised — caller (daemon) caches at boot. */
  readonly bootTimeUnix?: number;
  readonly clockTicksPerSec?: number;
}

/**
 * Reconcile every registered agent. Snapshots names BEFORE iterating to
 * survive mid-iteration mutations. Per-agent failures are caught + logged;
 * function never throws.
 */
export async function reconcileAllAgents(deps: ReconcileDeps): Promise<void> {
  const names = Array.from(deps.tracker.getRegisteredAgents().keys());
  for (const name of names) {
    // Phase 108 (Pitfall 6) — broker-owned pool children are registered
    // under synthetic owners with the `__broker:` prefix. The OnePassword
    // broker is the SOLE entity allowed to SIGTERM those PIDs (it knows
    // the per-pool refcount + drain ceiling). Per-tick reconciliation
    // must never treat them as per-agent entries — skipping them here
    // also prevents stale-claude detection from running, which would
    // otherwise see the daemon PID as the "claude" process and never
    // mark these entries as dead. Broker's own onPoolExit callback
    // unregisters the synthetic entry on child exit.
    if (name.startsWith("__broker:")) continue;
    try {
      await reconcileAgent(name, deps);
    } catch (err) {
      deps.log.warn(
        {
          component: "mcp-tracker",
          action: "reconcile",
          agent: name,
          err: String(err),
        },
        "reconcile failed for agent",
      );
    }
  }
}

/**
 * Reconcile a single agent. Used both by reconcileAllAgents (per-tick loop)
 * and by McpProcessTracker.killAgentGroup (TRACK-06 reconcile-before-kill —
 * Plan 02 wires the closure via deps.reconcileAgent in daemon.ts).
 *
 * No-op when the agent is no longer registered (race-safe).
 */
export async function reconcileAgent(
  name: string,
  deps: ReconcileDeps,
): Promise<void> {
  // Phase 108 (Pitfall 6) — defensive skip for broker-owned synthetic
  // owners. reconcileAllAgents already filters them, but reconcileAgent
  // is also wired into tracker.killAgentGroup's reconcile-before-kill
  // closure (TRACK-06). A future caller passing a `__broker:` name here
  // would otherwise probe a non-existent claude proc, mark it dead, and
  // unregister the entry behind the broker's back.
  if (name.startsWith("__broker:")) return;
  const entry = deps.tracker.getRegisteredAgents().get(name);
  if (!entry) return;

  const oldClaudePid = entry.claudePid;
  const oldMcpPids: readonly number[] = [...entry.mcpPids];
  const oldMcpCount = oldMcpPids.length;

  let newClaudePid = oldClaudePid;
  let reason: ReconcileReason | null = null;

  // Stale-claude detection: re-discover if recorded PID is dead.
  if (!isPidAlive(oldClaudePid)) {
    const discovered = await discoverClaudeSubprocessPid(deps.daemonPid, {
      minAge: 10,
      bootTimeUnix: deps.bootTimeUnix,
      clockTicksPerSec: deps.clockTicksPerSec,
    });
    if (discovered === null) {
      // Agent fully gone — drop entry + emit agent-gone log.
      deps.tracker.unregister(name);
      deps.log.warn(
        {
          component: "mcp-tracker",
          action: "reconcile",
          agent: name,
          oldClaudePid,
          oldMcpCount,
          reason: "agent-gone" satisfies ReconcileReason,
        },
        "tracker entry dropped — claude proc gone",
      );
      return;
    }
    deps.tracker.updateAgent(name, discovered);
    newClaudePid = discovered;
    reason = "stale-claude";
  }

  // Re-walk MCP children when claude changed OR mcpCount was 0 (initial
  // registration race). Otherwise leave existing tracker state untouched.
  if (reason === "stale-claude" || oldMcpCount === 0) {
    const newMcpPids = await discoverAgentMcpPids(
      newClaudePid,
      deps.tracker.patterns,
    );
    deps.tracker.replaceMcpPids(name, newMcpPids);

    // Reason classifier: upgrade to "agent-restart" when BOTH claude and
    // mcpPids changed (RESEARCH Pattern 4). Only "missing-mcps" when
    // claude was alive and we filled in an empty mcp list.
    if (reason === "stale-claude") {
      if (oldMcpCount > 0 && pidSetsDiffer(oldMcpPids, newMcpPids)) {
        reason = "agent-restart";
      }
    } else {
      reason = "missing-mcps";
    }

    // Diff-based logging: only emit when state actually changed.
    if (snapshotsDiffer(
      { claudePid: oldClaudePid, mcpPids: oldMcpPids },
      { claudePid: newClaudePid, mcpPids: newMcpPids },
    )) {
      deps.log.warn(
        {
          component: "mcp-tracker",
          action: "reconcile",
          agent: name,
          oldClaudePid,
          newClaudePid,
          oldMcpCount,
          newMcpCount: newMcpPids.length,
          reason,
        },
        "tracker state reconciled",
      );
    }
  }
}

/**
 * Sorted-set equality for two pid arrays. True when sets differ in size or
 * contents.
 */
function pidSetsDiffer(
  a: readonly number[],
  b: readonly number[],
): boolean {
  if (a.length !== b.length) return true;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return true;
  }
  return false;
}

/**
 * Deep-equal on { claudePid, mcpPids[].sort() } — TRACK-04 diff predicate.
 * Returns true when the two snapshots represent different tracker state
 * (and therefore the reconciler emits a state-change log line).
 */
function snapshotsDiffer(
  a: { readonly claudePid: number; readonly mcpPids: readonly number[] },
  b: { readonly claudePid: number; readonly mcpPids: readonly number[] },
): boolean {
  if (a.claudePid !== b.claudePid) return true;
  return pidSetsDiffer(a.mcpPids, b.mcpPids);
}
