import type { Command } from "commander";
import { sendIpcRequest } from "../../ipc/client.js";
import { SOCKET_PATH, REGISTRY_PATH } from "../../manager/daemon.js";
import { readRegistry } from "../../manager/registry.js";
import { ManagerNotRunningError } from "../../shared/errors.js";
import type { RegistryEntry } from "../../manager/types.js";
import { cliLog, cliError } from "../output.js";

// ANSI color codes
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RED_BOLD = "\x1b[1;31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

/**
 * Format a duration in milliseconds to a human-readable uptime string.
 * <60s = "Xs", <60m = "Xm Ys", <24h = "Xh Ym", else "Xd Yh"
 */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${days}d ${hours % 24}h`;
}

/**
 * Colorize a status string with ANSI escape codes.
 */
function colorizeStatus(status: string): string {
  switch (status) {
    case "running":
      return `${GREEN}${status}${RESET}`;
    case "stopped":
      return `${DIM}${status}${RESET}`;
    case "crashed":
      return `${RED}${status}${RESET}`;
    case "failed":
      return `${RED_BOLD}${status}${RESET}`;
    case "restarting":
    case "starting":
    case "stopping":
      return `${YELLOW}${status}${RESET}`;
    default:
      return status;
  }
}

/**
 * Format registry entries as a status table.
 * Columns: NAME, STATUS, UPTIME, RESTARTS
 *
 * @param entries - Registry entries to display
 * @param now - Current timestamp (for testability)
 * @returns Formatted table string
 */
export function formatStatusTable(
  entries: readonly RegistryEntry[],
  now?: number,
): string {
  if (entries.length === 0) {
    return "No agents configured";
  }

  const currentTime = now ?? Date.now();

  // Calculate column widths
  const nameWidth = Math.max(4, ...entries.map((e) => e.name.length));
  const statusWidth = Math.max(6, ...entries.map((e) => e.status.length));
  const uptimeWidth = 10;
  const restartsWidth = 8;

  // Header
  const header = [
    "NAME".padEnd(nameWidth),
    "STATUS".padEnd(statusWidth),
    "UPTIME".padEnd(uptimeWidth),
    "RESTARTS".padEnd(restartsWidth),
  ].join("  ");

  const separator = "-".repeat(header.length);

  // Rows
  const rows = entries.map((entry) => {
    const uptime =
      entry.status === "running" && entry.startedAt !== null
        ? formatUptime(currentTime - entry.startedAt)
        : "-";

    return [
      entry.name.padEnd(nameWidth),
      colorizeStatus(entry.status.padEnd(statusWidth)),
      uptime.padEnd(uptimeWidth),
      String(entry.restartCount).padEnd(restartsWidth),
    ].join("  ");
  });

  return [header, separator, ...rows].join("\n");
}

/**
 * Register the `clawcode status` command.
 * Sends a "status" IPC request to the daemon and displays a formatted table.
 * Falls back to reading the registry file directly if daemon is not running.
 */
export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show status of all agents")
    .action(async () => {
      try {
        // Try IPC first
        const result = (await sendIpcRequest(SOCKET_PATH, "status", {})) as {
          entries: readonly RegistryEntry[];
        };
        cliLog(formatStatusTable(result.entries));
      } catch (error) {
        if (error instanceof ManagerNotRunningError) {
          // Fallback: try reading registry file directly
          try {
            const registry = await readRegistry(REGISTRY_PATH);
            if (registry.entries.length === 0) {
              cliLog("No agents configured");
            } else {
              cliLog(
                `${DIM}(Manager is not running -- showing last known state)${RESET}\n`,
              );
              cliLog(formatStatusTable(registry.entries));
            }
          } catch {
            cliError(
              "Manager is not running. Start it with: clawcode start-all",
            );
            process.exit(1);
          }
          return;
        }
        const message =
          error instanceof Error ? error.message : String(error);
        cliError(`Error: ${message}`);
        process.exit(1);
      }
    });
}
