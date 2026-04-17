/**
 * Phase 59 Plan 03 -- CLI `clawcode tasks` subcommands.
 *
 * Provides `retry <task_id>` and `status <task_id>` against a running daemon
 * via IPC. Mirrors the `schedules` command pattern (sendIpcRequest + error
 * handling for ManagerNotRunningError).
 */

import type { Command } from "commander";
import { sendIpcRequest } from "../../ipc/client.js";
import { SOCKET_PATH } from "../../manager/daemon.js";
import { ManagerNotRunningError } from "../../shared/errors.js";
import { cliLog, cliError } from "../output.js";

export function registerTasksCommand(program: Command): void {
  const tasks = program
    .command("tasks")
    .description("Cross-agent task commands (Phase 59)");

  tasks
    .command("retry <task_id>")
    .description("Re-run a failed/cancelled/timed_out task with the identical payload")
    .action(async (taskId: string) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "task-retry", {
          task_id: taskId,
        })) as { task_id: string };
        cliLog(`Retried ${taskId} as ${result.task_id} (digest preserved).`);
      } catch (error) {
        if (error instanceof ManagerNotRunningError) {
          cliError("Manager is not running. Start it with: clawcode start-all");
          process.exit(1);
          return;
        }
        cliError(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  tasks
    .command("status <task_id>")
    .description("Print the status of a delegated task")
    .action(async (taskId: string) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "task-status", {
          task_id: taskId,
        })) as {
          task_id: string;
          status: string;
          error?: string;
          result?: unknown;
        };
        cliLog(`Task ${result.task_id}: ${result.status}`);
        if (result.error) cliLog(`  error: ${result.error}`);
        if (result.result !== undefined) {
          cliLog(`  result: ${JSON.stringify(result.result, null, 2)}`);
        }
      } catch (error) {
        if (error instanceof ManagerNotRunningError) {
          cliError("Manager is not running. Start it with: clawcode start-all");
          process.exit(1);
          return;
        }
        cliError(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
