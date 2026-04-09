import type { Command } from "commander";
import { sendIpcRequest } from "../../ipc/client.js";
import { SOCKET_PATH } from "../../manager/daemon.js";
import { ManagerNotRunningError } from "../../shared/errors.js";
import { cliLog, cliError } from "../output.js";

/**
 * A single thread binding entry from the IPC response.
 */
type ThreadBindingEntry = {
  readonly threadId: string;
  readonly parentChannelId: string;
  readonly agentName: string;
  readonly sessionName: string;
  readonly createdAt: number;
  readonly lastActivity: number;
};

/**
 * Shape of the "threads" IPC response.
 */
type ThreadsResponse = {
  readonly bindings: readonly ThreadBindingEntry[];
};

/**
 * Format a past timestamp as a relative time string.
 * Examples: "5m ago", "2h 15m ago", "3d ago"
 *
 * @param timestamp - Past timestamp in ms
 * @param now - Current time in ms (for testability)
 * @returns Human-readable relative time string
 */
export function formatTimeAgo(timestamp: number, now?: number): string {
  const currentTime = now ?? Date.now();
  const diffMs = currentTime - timestamp;

  if (diffMs < 0) {
    return "just now";
  }

  const totalMinutes = Math.floor(diffMs / 60_000);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalMinutes < 1) {
    return "just now";
  }
  if (totalMinutes < 60) {
    return `${totalMinutes}m ago`;
  }
  if (totalHours < 24) {
    const remainingMinutes = totalMinutes % 60;
    if (remainingMinutes === 0) {
      return `${totalHours}h ago`;
    }
    return `${totalHours}h ${remainingMinutes}m ago`;
  }
  return `${totalDays}d ago`;
}

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.slice(0, maxLen) + "...";
}

/**
 * Format threads IPC response as a table.
 * Columns: AGENT, THREAD ID, SESSION NAME, PARENT CHANNEL, AGE, LAST ACTIVE
 *
 * @param data - The threads IPC response
 * @param now - Current time in ms (for testability)
 * @returns Formatted table string
 */
export function formatThreadsTable(
  data: ThreadsResponse,
  now?: number,
): string {
  if (data.bindings.length === 0) {
    return "No active thread bindings";
  }

  type Row = {
    readonly agent: string;
    readonly threadId: string;
    readonly sessionName: string;
    readonly source: string;
    readonly parentChannel: string;
    readonly age: string;
    readonly lastActive: string;
  };

  const rows: readonly Row[] = data.bindings.map((entry) => ({
    agent: entry.agentName,
    threadId: truncate(entry.threadId, 20),
    sessionName: truncate(entry.sessionName, 30),
    source: entry.sessionName.includes("-sub-") ? "subagent" : "user-created",
    parentChannel: truncate(entry.parentChannelId, 20),
    age: formatTimeAgo(entry.createdAt, now),
    lastActive: formatTimeAgo(entry.lastActivity, now),
  }));

  // Calculate column widths dynamically
  const agentWidth = Math.max(5, ...rows.map((r) => r.agent.length));
  const threadIdWidth = Math.max(9, ...rows.map((r) => r.threadId.length));
  const sessionWidth = Math.max(12, ...rows.map((r) => r.sessionName.length));
  const sourceWidth = Math.max(6, ...rows.map((r) => r.source.length));
  const parentWidth = Math.max(14, ...rows.map((r) => r.parentChannel.length));
  const ageWidth = Math.max(3, ...rows.map((r) => r.age.length));
  const lastActiveWidth = Math.max(11, ...rows.map((r) => r.lastActive.length));

  // Header
  const header = [
    "AGENT".padEnd(agentWidth),
    "THREAD ID".padEnd(threadIdWidth),
    "SESSION NAME".padEnd(sessionWidth),
    "SOURCE".padEnd(sourceWidth),
    "PARENT CHANNEL".padEnd(parentWidth),
    "AGE".padEnd(ageWidth),
    "LAST ACTIVE".padEnd(lastActiveWidth),
  ].join("  ");

  const separator = "-".repeat(
    agentWidth + threadIdWidth + sessionWidth + sourceWidth + parentWidth + ageWidth + lastActiveWidth + 12,
  );

  // Format rows
  const formattedRows = rows.map((row) =>
    [
      row.agent.padEnd(agentWidth),
      row.threadId.padEnd(threadIdWidth),
      row.sessionName.padEnd(sessionWidth),
      row.source.padEnd(sourceWidth),
      row.parentChannel.padEnd(parentWidth),
      row.age.padEnd(ageWidth),
      row.lastActive.padEnd(lastActiveWidth),
    ].join("  "),
  );

  return ["Active Thread Bindings", "", header, separator, ...formattedRows].join("\n");
}

/**
 * Register the `clawcode threads` command.
 * Sends a "threads" IPC request and displays a formatted table.
 */
export function registerThreadsCommand(program: Command): void {
  program
    .command("threads")
    .description("Show active Discord thread bindings")
    .option("-a, --agent <name>", "Filter by agent name")
    .action(async (opts: { agent?: string }) => {
      try {
        const params: Record<string, unknown> = {};
        if (opts.agent) {
          params.agent = opts.agent;
        }
        const result = (await sendIpcRequest(
          SOCKET_PATH,
          "threads",
          params,
        )) as ThreadsResponse;
        cliLog(formatThreadsTable(result));
      } catch (error) {
        if (error instanceof ManagerNotRunningError) {
          cliError(
            "Manager is not running. Start it with: clawcode start-all",
          );
          process.exit(1);
          return;
        }
        const message =
          error instanceof Error ? error.message : String(error);
        cliError(`Error: ${message}`);
        process.exit(1);
      }
    });
}
