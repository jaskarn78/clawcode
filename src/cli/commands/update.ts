import type { Command } from "commander";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { cliLog, cliError } from "../output.js";

/**
 * Resolve the ClawCode project root from the running binary's location.
 * Works whether invoked as `dist/cli/index.js`, `src/cli/index.ts` via tsx,
 * or a symlinked `clawcode` binary.
 */
function resolveProjectRoot(): string {
  // process.argv[1] is the script path: dist/cli/index.js or src/cli/index.ts
  // Project root is two levels up from cli/index.{ts,js}
  const scriptDir = dirname(resolve(process.argv[1]));
  // scriptDir = .../dist/cli or .../src/cli → go up twice
  return resolve(scriptDir, "..", "..");
}

/**
 * Register the `clawcode update` command.
 * Pulls latest from the git remote, reinstalls dependencies, and rebuilds.
 * Automatically resolves the ClawCode install directory — works from any cwd.
 */
export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update ClawCode from the git remote and rebuild")
    .option("--restart", "Restart the daemon after updating")
    .action((opts: { restart?: boolean }) => {
      const projectRoot = resolveProjectRoot();

      try {
        cliLog(`Updating ClawCode at ${projectRoot}...`);
        cliLog("");

        cliLog("Pulling latest from remote...");
        const pullOutput = execSync("git pull --ff-only", {
          cwd: projectRoot,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        cliLog(pullOutput);

        if (pullOutput.includes("Already up to date")) {
          cliLog("\nAlready on the latest version.");
          return;
        }

        cliLog("\nInstalling dependencies...");
        execSync("npm ci --omit=dev", {
          cwd: projectRoot,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        cliLog("Dependencies installed.");

        cliLog("\nBuilding...");
        execSync("npm run build", {
          cwd: projectRoot,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        cliLog("Build complete.");

        if (opts.restart) {
          cliLog("\nRestarting daemon...");
          try {
            execSync("systemctl restart clawcode", {
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
            });
            cliLog("Daemon restarted.");
          } catch {
            cliLog("systemd service not found — restart the daemon manually.");
          }
        } else {
          cliLog("\nUpdate complete. Restart the daemon to apply changes:");
          cliLog("  clawcode update --restart");
          cliLog("  # or: sudo systemctl restart clawcode");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        cliError(`Update failed: ${message}`);
        process.exit(1);
      }
    });
}
