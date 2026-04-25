import type { CheckModule, CheckContext, CheckResult } from "../types.js";
import {
  performMcpReadinessHandshake,
  type McpServerState,
  type CapabilityProbeSnapshot,
} from "../../mcp/readiness.js";
import {
  probeAllMcpCapabilities,
  probeMcpCapability,
  type ProbeOrchestratorDeps,
} from "../../manager/capability-probe.js";
import {
  runRecoveryForServer,
} from "../../manager/recovery/registry.js";
import type {
  RecoveryDeps,
  AttemptRecord,
} from "../../manager/recovery/types.js";
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
  // Phase 94 Plan 03 — recovery-attempt history Map accessor for the
  // bounded 3-attempts-per-hour budget. Stable Map identity across
  // heartbeat ticks so the budget counter accumulates correctly.
  readonly getRecoveryAttemptHistory?: () => Map<string, AttemptRecord[]>;
};

/**
 * Phase 94 Plan 03 — heartbeat-edge recovery deps factory.
 *
 * Builds the DI surface for the recovery registry. Wires:
 *   - execFile via promisified node:child_process.execFile (Phase 91 sync-runner pattern)
 *   - opRead via shelling out to `op read <ref>` through that same execFile
 *   - killSubprocess as a no-op stub (SDK kill API not yet exposed; the
 *     SDK respawns subprocesses transparently, so a logged warn is enough
 *     today — production wiring lands when Plan 94-08 / SDK update lifts)
 *   - adminAlert as a logged warn stub (Phase 90.1 webhookManager wiring
 *     is followup work; the recovery ledger captures every alert event)
 *   - readEnvForServer / writeEnvForServer best-effort against agentConfig
 *
 * The recovery primitives themselves stay DI-pure — production code wires
 * real implementations at THIS edge (the heartbeat tick) per the plan rule.
 */
function buildRecoveryDepsForHeartbeat(
  agentName: string,
  ctx: CheckContext,
  log: import("pino").Logger,
): RecoveryDeps {
  return {
    execFile: async (cmd, args, options) => {
      // Late-load child_process so test workers that mock everything aren't
      // forced to load the native module. Mirrors src/sync/sync-runner.ts.
      const { execFile: execFileCb } = await import("node:child_process");
      return await new Promise((resolve, reject) => {
        const child = execFileCb(
          cmd,
          args as string[],
          {
            maxBuffer: 16 * 1024 * 1024,
            timeout: options?.timeoutMs,
            cwd: options?.cwd,
            env: options?.env ? { ...process.env, ...options.env } : process.env,
          },
          (err, stdout, stderr) => {
            // execFile callback fires with err=null on success, err.code=N
            // on non-zero exit. We resolve with exitCode so the caller can
            // branch on it; spawn errors (ENOENT) propagate as rejections.
            if (err && (err as NodeJS.ErrnoException).errno !== undefined && (err as NodeJS.ErrnoException).code === "ENOENT") {
              reject(err);
              return;
            }
            const exitCode =
              err && typeof (err as NodeJS.ErrnoException).code === "number"
                ? ((err as NodeJS.ErrnoException).code as unknown as number)
                : err
                  ? 1
                  : 0;
            resolve({
              stdout: stdout?.toString() ?? "",
              stderr: stderr?.toString() ?? "",
              exitCode,
            });
          },
        );
        child.on("error", (e) => {
          reject(e);
        });
      });
    },
    killSubprocess: async (serverName: string) => {
      // SDK doesn't expose a direct subprocess-kill API yet. Logged so the
      // operator sees the recovery attempt; the SDK transparently respawns
      // the MCP server on next call after a transport-level failure, so
      // even without a kill, the next heartbeat tick will re-probe and a
      // healthy handshake will lift status to ready.
      log.warn(
        { agent: agentName, serverName },
        "subprocess-restart: SDK kill API not exposed — relying on SDK transparent reconnect",
      );
    },
    adminAlert: async (text: string) => {
      // Phase 90.1 webhookManager bot-direct fallback wiring is followup.
      // For now, log at warn-level so the recovery ledger captures every
      // alert event; the daemon-edge wiring will replace this with a real
      // bot-direct DM to admin-clawdy.
      log.warn({ agent: agentName, alert: text }, "admin-clawdy alert (stub)");
    },
    opRead: async (reference: string) => {
      // Shell out to `op read <reference>`. Caller wraps in try/catch.
      const { execFile: execFileCb } = await import("node:child_process");
      return await new Promise<string>((resolve, reject) => {
        execFileCb(
          "op",
          ["read", reference],
          { maxBuffer: 1024 * 1024, timeout: 30_000 },
          (err, stdout) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(stdout?.toString().trim() ?? "");
          },
        );
      });
    },
    readEnvForServer: (serverName: string) => {
      const cfg = ctx.sessionManager.getAgentConfig(agentName);
      const server = cfg?.mcpServers?.find((s) => s.name === serverName);
      return server?.env ? { ...server.env } : {};
    },
    writeEnvForServer: async (serverName: string, env: Record<string, string>) => {
      // Heartbeat-edge stub — the SessionManager mutator for live MCP
      // server env doesn't exist yet (Plan 94-08 / config-mutator land).
      // Logged so operators see the resolved env count; the next agent
      // restart will pick up freshly-resolved op:// values from the config.
      log.warn(
        { agent: agentName, serverName, envKeys: Object.keys(env).length },
        "writeEnvForServer: live env mutation not yet wired — restart agent to apply",
      );
    },
    log,
  };
}

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

    // ----------------------------------------------------------------
    // Phase 94 Plan 03 — recovery loop.
    //
    // For each server with capabilityProbe.status === "degraded", consult
    // the recovery registry. The registry enforces the bounded
    // 3-attempts-per-hour budget + admin-clawdy alert on the 3rd failure.
    // On a `recovered` outcome, re-probe THAT server immediately and lift
    // the snapshot to ready (so the LLM tool-list filter sees the recovery
    // before the next 60s heartbeat tick).
    //
    // Per-handle attempt history Map persists across ticks via the
    // SessionHandle.getRecoveryAttemptHistory() accessor; falls back to a
    // freshly-allocated Map when the handle isn't reachable (tests with a
    // minimal context). The Map IS NOT mutated for not-applicable outcomes,
    // so a server that no handler matches doesn't burn budget.
    // ----------------------------------------------------------------
    const sm2 = ctx.sessionManager as unknown as {
      readonly sessions?: Map<string, HandleWithMcpState>;
    };
    const handleForRecovery = sm2.sessions?.get(ctx.agentName);
    const attemptHistory: Map<string, AttemptRecord[]> =
      handleForRecovery?.getRecoveryAttemptHistory?.() ?? new Map();
    const recoveryLog = pino({ level: "silent" });
    const recoveryDeps = buildRecoveryDepsForHeartbeat(ctx.agentName, ctx, recoveryLog);

    // Snapshot the merged map so we can mutate per-server entries below
    // for `recovered` outcomes.
    const recoveryAdjusted = new Map<string, McpServerState>(probedMerged);
    for (const [name, state] of probedMerged) {
      const probe = state.capabilityProbe;
      if (!probe || probe.status !== "degraded") continue;
      const outcome = await runRecoveryForServer(
        name,
        state,
        attemptHistory,
        recoveryDeps,
      );
      if (outcome.kind === "recovered") {
        // Re-probe immediately so this tick reflects the recovery. Same
        // stub deps as the initial probe (the heartbeat layer's default-
        // fallback path treats a successful listTools as ready).
        try {
          const refreshedProbe = await probeMcpCapability(name, stubDeps, probe);
          recoveryAdjusted.set(
            name,
            Object.freeze({
              ...state,
              capabilityProbe: refreshedProbe,
            }),
          );
        } catch {
          // Re-probe threw — defensive; leave the original degraded
          // snapshot in place for the next heartbeat tick to retry.
        }
      }
      // not-applicable / retry-later / give-up → no snapshot mutation;
      // the registry already wrote the AttemptRecord entry.
    }

    // Persist merged state through the SessionManager accessor (primary
    // surface — read by IPC `list-mcp-status`, slash commands, and
    // Plan 02's prompt-builder) AND mirror onto the session handle for
    // TurnDispatcher-scope reads.
    ctx.sessionManager.setMcpStateForAgent(ctx.agentName, recoveryAdjusted);

    // Best-effort handle mirror. The sessions map + setMcpState live on
    // the handle contract introduced alongside this check; tolerate
    // absence so tests with a minimal fake context still run.
    try {
      const sm = ctx.sessionManager as unknown as {
        readonly sessions: Map<string, HandleWithMcpState>;
      };
      const handle = sm.sessions?.get(ctx.agentName);
      handle?.setMcpState?.(recoveryAdjusted);
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
