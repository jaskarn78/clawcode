import type { Command } from "commander";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { cliLog, cliError } from "../output.js";

const MANAGER_DIR = join(
  process.env.CLAWCODE_HOME ?? join(homedir(), ".clawcode"),
  "manager",
);
const REGISTRY_PATH = join(MANAGER_DIR, "registry.json");
const THREAD_REGISTRY_PATH = join(MANAGER_DIR, "thread-registry.json");

/**
 * Register the `clawcode clear` command.
 * Removes stale registry entries when the daemon is not running.
 */
export function registerClearCommand(program: Command): void {
  program
    .command("clear")
    .description("Clear stale agent and thread registry entries")
    .option("--all", "Remove all registry files entirely")
    .action(async (opts: { all?: boolean }) => {
      try {
        if (opts.all) {
          // Delete both registry files
          try {
            await unlink(REGISTRY_PATH);
            cliLog("Removed agent registry.");
          } catch {
            cliLog("No agent registry to remove.");
          }
          try {
            await unlink(THREAD_REGISTRY_PATH);
            cliLog("Removed thread registry.");
          } catch {
            cliLog("No thread registry to remove.");
          }
          cliLog("\nRegistries cleared. Start fresh with: clawcode start-all");
          return;
        }

        // Read and clean the agent registry — remove thread/subagent entries
        let cleaned = 0;
        try {
          const raw = await readFile(REGISTRY_PATH, "utf-8");
          const registry = JSON.parse(raw) as {
            entries: Array<{ name: string; status: string }>;
            updatedAt: number;
          };

          const before = registry.entries.length;
          registry.entries = registry.entries.filter((e) => {
            // Keep only primary agents (not thread sessions or subagents)
            const isThread = e.name.includes("-thread-");
            const isSubagent = e.name.includes("-sub-");
            if (isThread || isSubagent) return false;
            return true;
          });

          // Reset remaining entries to stopped
          for (const entry of registry.entries) {
            entry.status = "stopped";
          }

          registry.updatedAt = Date.now();
          cleaned = before - registry.entries.length;

          await writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
        } catch {
          cliLog("No agent registry found.");
        }

        // Clear thread registry
        let threadsCleaned = 0;
        try {
          const raw = await readFile(THREAD_REGISTRY_PATH, "utf-8");
          const threadRegistry = JSON.parse(raw) as {
            bindings: Array<unknown>;
          };
          threadsCleaned = threadRegistry.bindings.length;
          await writeFile(
            THREAD_REGISTRY_PATH,
            JSON.stringify({ bindings: [] }, null, 2),
          );
        } catch {
          // No thread registry
        }

        cliLog(`Cleared ${cleaned} stale agent entries.`);
        if (threadsCleaned > 0) {
          cliLog(`Cleared ${threadsCleaned} thread bindings.`);
        }
        cliLog("\nStart fresh with: clawcode start-all");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        cliError(`Error: ${message}`);
        process.exit(1);
      }
    });
}
