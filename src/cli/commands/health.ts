import type { Command } from "commander";
import { sendIpcRequest } from "../../ipc/client.js";
import { SOCKET_PATH } from "../../manager/daemon.js";
import { ManagerNotRunningError } from "../../shared/errors.js";

// ANSI color codes
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

/**
 * Shape of a single check result from the heartbeat-status IPC response.
 */
type CheckEntry = {
  readonly status: "healthy" | "warning" | "critical";
  readonly message: string;
  readonly lastChecked: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/**
 * Shape of a single agent entry from the heartbeat-status IPC response.
 */
type AgentEntry = {
  readonly checks: Readonly<Record<string, CheckEntry>>;
  readonly overall: "healthy" | "warning" | "critical";
};

/**
 * Shape of the heartbeat-status IPC response.
 */
type HeartbeatStatusResponse = {
  readonly agents: Readonly<Record<string, AgentEntry>>;
};

/**
 * Format an ISO timestamp as a relative "time ago" string.
 * Examples: "12s ago", "2m ago", "1h ago", "3d ago"
 *
 * @param isoTimestamp - ISO 8601 timestamp string
 * @param now - Current time in ms (for testability)
 * @returns Human-readable relative time string
 */
export function formatTimeAgo(isoTimestamp: string, now?: number): string {
  const then = new Date(isoTimestamp).getTime();
  const currentTime = now ?? Date.now();
  const diffMs = currentTime - then;

  if (diffMs < 0) {
    return "just now";
  }

  const seconds = Math.floor(diffMs / 1_000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${days}d ago`;
}

/**
 * Colorize a health status string with ANSI escape codes.
 */
function colorizeStatus(status: string): string {
  switch (status) {
    case "healthy":
      return `${GREEN}${status}${RESET}`;
    case "warning":
      return `${YELLOW}${status}${RESET}`;
    case "critical":
      return `${RED}${status}${RESET}`;
    default:
      return status;
  }
}

/**
 * Format heartbeat-status IPC response as a health table.
 * Columns: AGENT, CHECK, STATUS, MESSAGE, LAST CHECK
 *
 * @param data - The heartbeat-status IPC response
 * @param now - Current time in ms (for testability)
 * @returns Formatted table string
 */
export function formatHealthTable(
  data: HeartbeatStatusResponse,
  now?: number,
): string {
  const agentNames = Object.keys(data.agents);

  if (agentNames.length === 0) {
    return "No heartbeat data available";
  }

  // Collect all rows first to calculate column widths
  type Row = {
    readonly agent: string;
    readonly check: string;
    readonly status: string;
    readonly statusRaw: string;
    readonly message: string;
    readonly lastCheck: string;
  };

  const rows: Row[] = [];

  for (const agentName of agentNames) {
    const agent = data.agents[agentName];
    const checkNames = Object.keys(agent.checks);

    for (const checkName of checkNames) {
      const check = agent.checks[checkName];
      rows.push({
        agent: agentName,
        check: checkName,
        status: colorizeStatus(check.status),
        statusRaw: check.status,
        message: check.message,
        lastCheck: formatTimeAgo(check.lastChecked, now),
      });
    }

    // Overall row for agent
    const latestChecked = checkNames.length > 0
      ? Object.values(agent.checks).reduce((latest, c) =>
          c.lastChecked > latest ? c.lastChecked : latest,
        Object.values(agent.checks)[0].lastChecked)
      : "";

    rows.push({
      agent: agentName,
      check: "(overall)",
      status: colorizeStatus(agent.overall),
      statusRaw: agent.overall,
      message: "",
      lastCheck: latestChecked ? formatTimeAgo(latestChecked, now) : "",
    });
  }

  // Calculate column widths
  const agentWidth = Math.max(5, ...rows.map((r) => r.agent.length));
  const checkWidth = Math.max(5, ...rows.map((r) => r.check.length));
  const statusWidth = Math.max(6, ...rows.map((r) => r.statusRaw.length));
  const messageWidth = Math.max(7, ...rows.map((r) => r.message.length));
  const lastCheckWidth = Math.max(10, ...rows.map((r) => r.lastCheck.length));

  // Header
  const header = [
    "AGENT".padEnd(agentWidth),
    "CHECK".padEnd(checkWidth),
    "STATUS".padEnd(statusWidth),
    "MESSAGE".padEnd(messageWidth),
    "LAST CHECK".padEnd(lastCheckWidth),
  ].join("  ");

  const separator = "-".repeat(
    agentWidth + checkWidth + statusWidth + messageWidth + lastCheckWidth + 8,
  );

  // Format rows
  const formattedRows = rows.map((row) => {
    // ANSI codes add invisible characters, so pad using raw status length
    const statusPadded = row.status + " ".repeat(Math.max(0, statusWidth - row.statusRaw.length));

    return [
      row.agent.padEnd(agentWidth),
      row.check.padEnd(checkWidth),
      statusPadded,
      row.message.padEnd(messageWidth),
      `${DIM}${row.lastCheck}${RESET}`,
    ].join("  ");
  });

  return [header, separator, ...formattedRows].join("\n");
}

/**
 * Register the `clawcode health` command.
 * Sends a "heartbeat-status" IPC request and displays a formatted health table.
 */
export function registerHealthCommand(program: Command): void {
  program
    .command("health")
    .description("Show agent health status")
    .action(async () => {
      try {
        const result = (await sendIpcRequest(
          SOCKET_PATH,
          "heartbeat-status",
          {},
        )) as HeartbeatStatusResponse;
        console.log(formatHealthTable(result));
      } catch (error) {
        if (error instanceof ManagerNotRunningError) {
          console.error(
            "Manager is not running. Start it with: clawcode start-all",
          );
          process.exit(1);
          return;
        }
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
