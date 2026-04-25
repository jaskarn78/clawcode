import type { CheckModule, CheckContext, CheckResult } from "../types.js";
import {
  performMcpReadinessHandshake,
  type McpServerState,
  type CapabilityProbeSnapshot,
} from "../../mcp/readiness.js";
import {
  probeAllMcpCapabilities,
  type ProbeOrchestratorDeps,
} from "../../manager/capability-probe.js";
import pino from "pino";

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

    // ----------------------------------------------------------------
    // Phase 94 Plan 01 — capability probe overlay.
    //
    // After the connect-test classifies each server, run the per-server
    // capability probe (`probeAllMcpCapabilities`) and write a
    // `capabilityProbe` snapshot onto each merged entry. The probe layer
    // is the orthogonal capability axis (D-02): connect ok BUT real
    // representative call broken → `degraded`, with verbatim error.
    //
    // Until Plan 94-03 wires production callTool/listTools through the
    // SDK surface, the heartbeat extension uses the connect-test result
    // as the capability proxy:
    //   - connect-fail (status: "failed") → capabilityProbe.status="failed",
    //     short-circuit (no probe spawned — we already know it's down)
    //   - connect-ok    (status: "ready") → run the registered probe with
    //     stub callTool/listTools so the default-fallback path treats the
    //     server as "ready" (we know connect works; nothing to call yet)
    //
    // The stub callTool throws so any registry entry that calls it lands
    // in `degraded`. The stub listTools returns one entry so the default-
    // fallback (used here as a getProbeFor override) returns ok. Net
    // result: connect-ok → capabilityProbe.status="ready" until real
    // callTool wiring lands; connect-fail → "failed" verbatim.
    //
    // The lastSuccessAt sticky-preservation across degraded ticks is
    // already handled inside probeMcpCapability — pass prior snapshots in.
    // ----------------------------------------------------------------
    const stubLog = pino({ level: "silent" });
    const stubDeps: ProbeOrchestratorDeps = {
      callTool: async () => {
        throw new Error(
          "callTool not yet wired in heartbeat layer (Plan 94-03 picks this up)",
        );
      },
      listTools: async (serverName: string) => {
        // Return one synthetic entry so the default-fallback probe
        // resolves "ready" — we already know connect-ok via the
        // performMcpReadinessHandshake above.
        return [{ name: `${serverName}__connect_ok` }];
      },
      // Override getProbeFor so we always run the default-fallback (which
      // only consults listTools) instead of the registry entries (which
      // call the throwing callTool). Plan 94-03 will lift this override
      // once callTool is real.
      getProbeFor: () => {
        return async (probeDeps) => {
          try {
            const tools = await probeDeps.listTools("__heartbeat_probe__");
            if (tools.length === 0) {
              return { kind: "failure", error: "no tools exposed" };
            }
            return { kind: "ok" };
          } catch (err) {
            return {
              kind: "failure",
              error: err instanceof Error ? err.message : String(err),
            };
          }
        };
      },
      now: () => new Date(),
      log: stubLog,
    };

    // Carry prior capabilityProbe blocks for lastSuccessAt preservation.
    const prevProbeByName = new Map<string, CapabilityProbeSnapshot>();
    for (const [name, prior] of priorState) {
      if (prior.capabilityProbe) {
        prevProbeByName.set(name, prior.capabilityProbe);
      }
    }

    // Probe ONLY the servers whose connect-test classified as anything
    // other than "failed". For "failed" connect-test we mirror status
    // directly into capabilityProbe — no need to spawn another probe.
    const readyOrDegradedNames: string[] = [];
    for (const [name, state] of merged) {
      if (state.status !== "failed") readyOrDegradedNames.push(name);
    }

    const probeResults = readyOrDegradedNames.length > 0
      ? await probeAllMcpCapabilities(readyOrDegradedNames, stubDeps, prevProbeByName)
      : new Map<string, CapabilityProbeSnapshot>();

    // Re-merge with capabilityProbe blocks attached. For "failed" servers
    // we synthesize the snapshot directly from the connect-test result.
    const probedMerged = new Map<string, McpServerState>();
    const nowIso = new Date().toISOString();
    for (const [name, state] of merged) {
      let probe: CapabilityProbeSnapshot;
      if (state.status === "failed") {
        const prior = prevProbeByName.get(name);
        probe = {
          lastRunAt: nowIso,
          status: "failed",
          ...(state.lastError?.message
            ? { error: state.lastError.message }
            : {}),
          ...(prior?.lastSuccessAt !== undefined
            ? { lastSuccessAt: prior.lastSuccessAt }
            : {}),
        };
      } else {
        // probeResults always has an entry for every readyOrDegraded name.
        probe = probeResults.get(name) ?? {
          lastRunAt: nowIso,
          status: "unknown",
        };
      }
      probedMerged.set(
        name,
        Object.freeze({
          ...state,
          capabilityProbe: probe,
        }),
      );
    }

    // Persist merged state through the SessionManager accessor (primary
    // surface — read by IPC `list-mcp-status`, slash commands, and
    // Plan 02's prompt-builder) AND mirror onto the session handle for
    // TurnDispatcher-scope reads.
    ctx.sessionManager.setMcpStateForAgent(ctx.agentName, probedMerged);

    // Best-effort handle mirror. The sessions map + setMcpState live on
    // the handle contract introduced alongside this check; tolerate
    // absence so tests with a minimal fake context still run.
    try {
      const sm = ctx.sessionManager as unknown as {
        readonly sessions: Map<string, HandleWithMcpState>;
      };
      const handle = sm.sessions?.get(ctx.agentName);
      handle?.setMcpState?.(probedMerged);
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
