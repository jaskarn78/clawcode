/**
 * Phase 85 Plan 03 — `clawcode mcp-status` CLI subcommand.
 *
 * Prints per-agent MCP readiness (ready / degraded / failed / reconnecting /
 * unknown) as an aligned 6-column table: AGENT / SERVER / STATUS /
 * LAST SUCCESS / FAILURES / LAST ERROR. Reads from the same `list-mcp-status`
 * IPC method consumed by Plan 03's Discord /clawcode-tools slash command —
 * single source of truth across both operator surfaces.
 *
 * Naming rationale:
 *   The plan called this `clawcode tools`, but `src/cli/commands/tools.ts`
 *   already exists (Phase 55 — per-tool call latency with p50/p95/p99 SLO
 *   reporting). The two commands answer different questions: `tools` reports
 *   on TOOL CALL PERFORMANCE; `mcp-status` reports on SERVER READINESS.
 *   Keeping both by using the `mcp-status` name, which parallels the existing
 *   `mcp-servers` command and stays in the MCP-subsystem namespace.
 *
 * Parity with `mcp-servers`:
 *   - Same imports, same IPC pattern, same ManagerNotRunningError handling
 *   - Same cliLog / cliError surfaces
 *   - Same padding style
 *
 * Pitfall 12 closure:
 *   No `command`, `args`, or `env` fields are surfaced — only readiness
 *   state. Secrets stored in MCP env blocks cannot leak through this path.
 */

import type { Command } from "commander";
import { sendIpcRequest } from "../../ipc/client.js";
import { SOCKET_PATH } from "../../manager/daemon.js";
import { ManagerNotRunningError } from "../../shared/errors.js";
import { cliLog, cliError } from "../output.js";

/**
 * Shape of a single server entry returned by the `list-mcp-status` IPC
 * method (src/manager/daemon.ts case "list-mcp-status" — shipped in Plan 01).
 *
 * Phase 94 Plan 01 — additive `capabilityProbe?:` field carries the per-
 * server capability probe snapshot (set by mcp-reconnect heartbeat). The
 * full display column is owned by Plan 94-07; this Plan 94-01 just makes
 * the field reachable through the existing IPC payload.
 */
export type CapabilityProbeSnapshot = {
  readonly lastRunAt: string;
  readonly status: "ready" | "degraded" | "reconnecting" | "failed" | "unknown";
  readonly error?: string;
  readonly lastSuccessAt?: string;
};

export type McpStatusServer = {
  readonly name: string;
  readonly status: "ready" | "degraded" | "failed" | "reconnecting" | "unknown";
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly failureCount: number;
  readonly optional: boolean;
  readonly lastError: string | null;
  readonly capabilityProbe?: CapabilityProbeSnapshot;
};

export type McpStatusResponse = {
  readonly agent: string;
  readonly servers: readonly McpStatusServer[];
};

/**
 * Relative time formatter: "3s ago", "1m ago", "2h ago", "4d ago", "never".
 * Keeps the table compact — full ISO timestamps are overkill for an operator
 * glance and would blow up the LAST SUCCESS column width.
 */
function formatRelative(ts: number | null, now: number = Date.now()): string {
  if (ts === null) return "never";
  const delta = Math.max(0, now - ts);
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Format a `list-mcp-status` IPC response as an aligned 6-column table.
 * Empty-servers case returns a single-line message (no empty table).
 *
 * Columns: AGENT / SERVER / STATUS / LAST SUCCESS / FAILURES / LAST ERROR.
 */
export function formatMcpStatusTable(
  resp: McpStatusResponse,
  now: number = Date.now(),
): string {
  if (resp.servers.length === 0) {
    return `No MCP servers configured for ${resp.agent}`;
  }

  type Row = {
    readonly agent: string;
    readonly server: string;
    readonly status: string;
    readonly lastSuccess: string;
    readonly failures: string;
    readonly lastError: string;
    /**
     * Phase 94 Plan 01 — capability probe column. Surfaces the
     * capabilityProbe.status from the IPC payload (or "unknown" when the
     * field is absent). Plan 94-07 will swap this minimal column for a
     * richer display with timestamps + recovery hints.
     */
    readonly capability: string;
  };

  const rows: readonly Row[] = resp.servers.map((s) => ({
    agent: resp.agent,
    server: s.optional ? `${s.name} (opt)` : s.name,
    status: s.status,
    lastSuccess: formatRelative(s.lastSuccessAt, now),
    failures: String(s.failureCount),
    lastError: s.lastError ?? "",
    capability: s.capabilityProbe?.status ?? "unknown",
  }));

  const widths = {
    agent: Math.max("AGENT".length, ...rows.map((r) => r.agent.length)),
    server: Math.max("SERVER".length, ...rows.map((r) => r.server.length)),
    status: Math.max("STATUS".length, ...rows.map((r) => r.status.length)),
    capability: Math.max(
      "CAPABILITY".length,
      ...rows.map((r) => r.capability.length),
    ),
    lastSuccess: Math.max(
      "LAST SUCCESS".length,
      ...rows.map((r) => r.lastSuccess.length),
    ),
    failures: Math.max("FAILURES".length, ...rows.map((r) => r.failures.length)),
    lastError: Math.max(
      "LAST ERROR".length,
      ...rows.map((r) => r.lastError.length),
    ),
  };

  const header = [
    "AGENT".padEnd(widths.agent),
    "SERVER".padEnd(widths.server),
    "STATUS".padEnd(widths.status),
    "CAPABILITY".padEnd(widths.capability),
    "LAST SUCCESS".padEnd(widths.lastSuccess),
    "FAILURES".padEnd(widths.failures),
    "LAST ERROR".padEnd(widths.lastError),
  ].join("  ");

  const totalWidth =
    widths.agent +
    widths.server +
    widths.status +
    widths.capability +
    widths.lastSuccess +
    widths.failures +
    widths.lastError +
    12; // 6 separators of 2 spaces each
  const separator = "-".repeat(totalWidth);

  const body = rows.map((r) =>
    [
      r.agent.padEnd(widths.agent),
      r.server.padEnd(widths.server),
      r.status.padEnd(widths.status),
      r.capability.padEnd(widths.capability),
      r.lastSuccess.padEnd(widths.lastSuccess),
      r.failures.padEnd(widths.failures),
      r.lastError.padEnd(widths.lastError),
    ].join("  "),
  );

  return [header, separator, ...body].join("\n");
}

/**
 * Register the `clawcode mcp-status` command.
 *
 * Sends a `list-mcp-status` IPC request and renders the response as an
 * aligned table (or a single-line message when the agent has no MCPs).
 *
 * Exits 1 with a friendly message when the daemon is not running.
 *
 * `--agent` is REQUIRED — the CLI has no channel binding to infer from
 * (unlike the Discord slash path). Matches `clawcode start -a <name>`-style
 * required flags on other subcommands.
 */
export function registerMcpStatusCommand(program: Command): void {
  program
    .command("mcp-status")
    .description(
      "Show per-agent MCP tool readiness (ready / degraded / failed)",
    )
    .requiredOption("-a, --agent <name>", "Agent to query")
    .action(async (opts: { agent: string }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "list-mcp-status", {
          agent: opts.agent,
        })) as McpStatusResponse;
        cliLog(formatMcpStatusTable(result));
      } catch (error) {
        if (error instanceof ManagerNotRunningError) {
          cliError("Manager is not running. Start it with: clawcode start-all");
          process.exit(1);
          return;
        }
        const msg = error instanceof Error ? error.message : String(error);
        cliError(`Error: ${msg}`);
        process.exit(1);
      }
    });
}
