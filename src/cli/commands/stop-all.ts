import type { Command } from "commander";
import { sendIpcRequest } from "../../ipc/client.js";
import { SOCKET_PATH } from "../../manager/daemon.js";
import { ManagerNotRunningError } from "../../shared/errors.js";
import { cliLog, cliError } from "../output.js";

/**
 * Register the `clawcode stop-all` command.
 * Stops all running agents, or shuts down the entire daemon.
 */
export function registerStopAllCommand(program: Command): void {
  program
    .command("stop-all")
    .description("Stop all running agents (daemon stays up)")
    .option("--shutdown", "Also shut down the daemon process")
    .action(async (opts: { shutdown?: boolean }) => {
      try {
        if (opts.shutdown) {
          await sendIpcRequest(SOCKET_PATH, "shutdown", {});
          cliLog("Daemon shutting down.");
        } else {
          await sendIpcRequest(SOCKET_PATH, "stop-all", {});
          cliLog("All agents stopped. Daemon is still running.");
          cliLog("To shut down the daemon: clawcode stop-all --shutdown");
        }
      } catch (error) {
        if (error instanceof ManagerNotRunningError) {
          cliError("Manager is not running.");
          process.exit(1);
        }
        const message =
          error instanceof Error ? error.message : String(error);
        cliError(`Error: ${message}`);
        process.exit(1);
      }
    });
}
