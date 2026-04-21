import type { CheckModule, CheckContext, CheckResult } from "../types.js";
import {
  performMcpReadinessHandshake,
  type McpServerState,
} from "../../mcp/readiness.js";

/**
 * Phase 85 Plan 01 Task 2 — `mcp-reconnect` heartbeat check.
 *
 * Runs every heartbeat tick (default 60s; per-agent override honored by
 * the heartbeat runner). Re-probes every configured MCP server via the
 * shared `performMcpReadinessHandshake` (same function used by the warm-
 * path startup gate in Task 1 — single regression lane).
 *
 * State machine over the per-agent `McpServerState` map exposed by
 * `SessionManager.getMcpStateForAgent` / `setMcpStateForAgent`:
 *
 *   Prior status    | Probe fresh  | Next status     | Notes
 *   ----------------+--------------+-----------------+---------------------
 *   ready/reconn.   | ready        | ready           | Steady-state; no-op
 *   ready           | failed       | degraded        | First flap
 *   degraded        | failed       | failed          | Persistent failure
 *   failed          | failed       | failed          | Still down
 *   failed          | ready        | ready           | Recovery — `lastSuccessAt`
 *                                                     refreshed, `failureCount`
 *                                                     reset to 0
 *
 * `failureCount` monotonically increments on each failed tick within a
 * `BACKOFF_RESET_MS` (5min) window measured from the last `lastSuccessAt`.
 * After that window elapses without success, the counter resets to 1
 * so operators get a fresh "recently-flapping" signal instead of a
 * monotonically-growing integer.
 *
 * NOT a real reconnect driver — the SDK owns the MCP subprocess lifecycle
 * and will transparently reconnect once the server's transport is healthy.
 * This check classifies + surfaces the health; Plans 02 and 03 read the
 * state to render it in the prompt + slash commands.
 *
 * Invariants:
 *   - Returns `healthy` when all ready, `warning` when any degraded but
 *     none failed, `critical` when any failed.
 *   - Optional-server failures count toward `degraded`/`failed` tallies
 *     but DO NOT escalate the check status past `warning` on their own
 *     (an optional-only failure still surfaces but shouldn't page ops).
 *   - Side-effect contract: persists merged state via both
 *     `sessionManager.setMcpStateForAgent` AND the handle's
 *     `setMcpState` (when reachable), so downstream consumers see the
 *     freshest data via whichever accessor they hold.
 */

/**
 * Rolling-window reset threshold. After this many ms without a successful
 * handshake the `failureCount` recycles to 1. Aligns with human-scale
 * "recent" for the `/clawcode-tools` reporting surface.
 */
const BACKOFF_RESET_MS = 5 * 60_000;

/**
 * Handle shape exposed by the persistent session for state mirroring.
 * Keeps this module's `ctx.sessionManager` access read-only beyond the
 * documented setters/getters.
 */
type HandleWithMcpState = {
  readonly setMcpState?: (s: ReadonlyMap<string, McpServerState>) => void;
};

const mcpReconnectCheck: CheckModule = {
  name: "mcp-reconnect",
  // 60s matches the default heartbeat interval; per-agent config can
  // override to a tighter/looser cadence.
  interval: 60,
  // 20s cap per tick is a conservative bound since the probe spawns
  // one child process per server in parallel, each with its own
  // MCP_HANDSHAKE_TIMEOUT_MS (5s). A fleet of 4 parallel MCPs fits
  // comfortably under 20s even on a cold host.
  timeout: 20,

  async execute(ctx: CheckContext): Promise<CheckResult> {
    const agentConfig = ctx.sessionManager.getAgentConfig(ctx.agentName);
    const servers = agentConfig?.mcpServers ?? [];
    if (servers.length === 0) {
      return {
        status: "healthy",
        message: "no MCP servers configured",
        metadata: { ready: 0, degraded: 0, failed: 0 },
      };
    }

    const priorState = ctx.sessionManager.getMcpStateForAgent(ctx.agentName);
    const rep = await performMcpReadinessHandshake(servers);
    const now = Date.now();
    const merged = new Map<string, McpServerState>();

    let ready = 0;
    let degraded = 0;
    let failed = 0;

    for (const [name, fresh] of rep.stateByName) {
      const prior = priorState.get(name);

      if (fresh.status === "ready") {
        // Recovery (prior was not ready) OR steady-state. Either way the
        // counters reset and lastSuccessAt advances to the fresh value.
        merged.set(
          name,
          Object.freeze({
            ...fresh,
            failureCount: 0,
          }),
        );
        ready++;
        continue;
      }

      // fresh.status === "failed" — probe just couldn't reach it.
      // Decide whether this is a first flap (prior ready) or a continued
      // failure (prior already unhealthy).
      const priorFailures = prior?.failureCount ?? 0;
      const sinceLastSuccess =
        prior?.lastSuccessAt !== null && prior?.lastSuccessAt !== undefined
          ? now - prior.lastSuccessAt
          : Number.POSITIVE_INFINITY;
      const windowExpired = sinceLastSuccess > BACKOFF_RESET_MS;
      const nextCount = windowExpired ? 1 : priorFailures + 1;

      const nextStatus: McpServerState["status"] =
        prior?.status === "ready" ? "degraded" : "failed";

      if (nextStatus === "degraded") {
        degraded++;
      } else {
        failed++;
      }

      merged.set(
        name,
        Object.freeze({
          ...fresh,
          status: nextStatus,
          failureCount: nextCount,
          // Preserve prior lastSuccessAt so the backoff-window timer is
          // measurable across ticks. Fresh probe doesn't know history;
          // we do.
          lastSuccessAt: prior?.lastSuccessAt ?? null,
        }),
      );
    }

    // Persist merged state through the SessionManager accessor (primary
    // surface — read by IPC `list-mcp-status`, slash commands, and
    // Plan 02's prompt-builder) AND mirror onto the session handle for
    // TurnDispatcher-scope reads.
    ctx.sessionManager.setMcpStateForAgent(ctx.agentName, merged);

    // Best-effort handle mirror. The sessions map + setMcpState live on
    // the handle contract introduced alongside this check; tolerate
    // absence so tests with a minimal fake context still run.
    try {
      const sm = ctx.sessionManager as unknown as {
        readonly sessions: Map<string, HandleWithMcpState>;
      };
      const handle = sm.sessions?.get(ctx.agentName);
      handle?.setMcpState?.(merged);
    } catch {
      // Observational — never break the heartbeat tick on a handle miss.
    }

    const message = `${ready} ready, ${degraded} degraded, ${failed} failed`;
    const metadata = { ready, degraded, failed };

    if (failed > 0) {
      return { status: "critical", message, metadata };
    }
    if (degraded > 0) {
      return { status: "warning", message, metadata };
    }
    return { status: "healthy", message, metadata };
  },
};

export default mcpReconnectCheck;
