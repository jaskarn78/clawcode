import type { Command } from "commander";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { sendIpcRequest } from "../../ipc/client.js";
import { startDaemon, SOCKET_PATH } from "../../manager/daemon.js";
import { ManagerNotRunningError } from "../../shared/errors.js";
import { formatStatusTable } from "./status.js";
import type { RegistryEntry } from "../../manager/types.js";
import { cliLog, cliError } from "../output.js";

/** Resolve project root — follows symlinks (e.g. /usr/bin/clawcode -> /opt/clawcode/dist/cli/index.js). */
function resolveProjectRoot(): string {
  const realScript = realpathSync(process.argv[1]);
  const scriptDir = dirname(realScript);
  return resolve(scriptDir, "..", "..");
}

/** Resolve config path: if default and not found at cwd, try project root. */
function resolveConfigPath(configOpt: string): string {
  if (existsSync(configOpt)) return resolve(configOpt);
  if (configOpt === "clawcode.yaml") {
    const fromRoot = resolve(resolveProjectRoot(), "clawcode.yaml");
    if (existsSync(fromRoot)) return fromRoot;
  }
  return resolve(configOpt);
}

/**
 * Check if the daemon is already running by sending a status request.
 * Returns the status entries if running, null if not.
 */
async function checkDaemonRunning(): Promise<readonly RegistryEntry[] | null> {
  try {
    const result = (await sendIpcRequest(SOCKET_PATH, "status", {})) as {
      entries: readonly RegistryEntry[];
    };
    return result.entries;
  } catch (error) {
    if (error instanceof ManagerNotRunningError) {
      return null;
    }
    return null;
  }
}

/**
 * Wait for the daemon to become responsive, retrying a few times.
 */
async function waitForDaemon(
  maxAttempts: number = 5,
  delayMs: number = 500,
): Promise<readonly RegistryEntry[] | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const entries = await checkDaemonRunning();
    if (entries !== null) {
      return entries;
    }
  }
  return null;
}

/**
 * Register the `clawcode start-all` command.
 * Starts the manager daemon and boots all configured agents.
 */
export function registerStartAllCommand(program: Command): void {
  program
    .command("start-all")
    .description("Start the manager daemon and boot all configured agents")
    .option("-c, --config <path>", "Path to config file", "clawcode.yaml")
    .option("--foreground", "Run daemon in foreground (for development)", false)
    .action(async (opts: { config: string; foreground: boolean }) => {
      const configPath = resolveConfigPath(opts.config);
      try {
        if (opts.foreground) {
          cliLog(
            "Manager running in foreground. Press Ctrl+C to stop.",
          );
          await startDaemon(configPath);
          // startDaemon returns when server is created; block forever
          await new Promise(() => {});
        } else {
          // Check if already running
          const existing = await checkDaemonRunning();
          if (existing !== null) {
            cliLog("Manager is already running");
            return;
          }

          // Spawn daemon as detached child process.
          // Prefer the built daemon entry (node dist/...) over npx tsx for production.
          const scriptDir = dirname(resolve(process.argv[1]));
          const projectRoot = resolve(scriptDir, "..", "..");
          const builtEntry = resolve(projectRoot, "dist", "cli", "index.js");
          const sourceEntry = resolve(projectRoot, "src", "manager", "daemon-entry.ts");

          let cmd: string;
          let args: string[];
          if (existsSync(builtEntry)) {
            // Production: use node with the built CLI entry + start-all --foreground
            cmd = process.execPath;
            args = [builtEntry, "start-all", "--foreground", "--config", configPath];
          } else {
            // Development: fall back to npx tsx with daemon-entry
            cmd = "npx";
            args = ["tsx", sourceEntry, "--config", configPath];
          }

          // Clean stale socket/pid before spawning
          const { SOCKET_PATH: sockPath } = await import("../../manager/daemon.js");
          const { unlink: unlinkFile } = await import("node:fs/promises");
          for (const stale of [sockPath, sockPath.replace(".sock", ".pid")]) {
            try { await unlinkFile(stale); } catch { /* may not exist */ }
          }

          const child = spawn(cmd, args, {
              detached: true,
              stdio: ["ignore", "ignore", "pipe"],
              cwd: projectRoot,
              env: (() => {
                const { ANTHROPIC_API_KEY: _, ...rest } = process.env;
                return rest;
              })(),
            },
          );

          // Capture stderr for error reporting
          let stderrOutput = "";
          if (child.stderr) {
            child.stderr.on("data", (chunk: Buffer) => {
              stderrOutput += chunk.toString();
            });
          }

          child.unref();

          // Wait for daemon to become responsive (more retries for slow startup)
          const entries = await waitForDaemon(15, 1000);

          if (entries !== null) {
            cliLog(
              `Manager started. Booting ${entries.length} agent(s)...`,
            );

            // Auto-start all configured agents
            if (entries.length > 0 && entries.every((e) => e.status !== "running")) {
              try {
                await sendIpcRequest(sockPath, "start-all", {});
                const updated = await waitForDaemon(5, 1000);
                if (updated) {
                  cliLog("");
                  cliLog(formatStatusTable(updated));
                }
              } catch {
                cliLog("");
                cliLog(formatStatusTable(entries));
              }
            } else {
              cliLog("");
              cliLog(formatStatusTable(entries));
            }
          } else {
            cliError(
              "Manager failed to start.",
            );
            if (stderrOutput) {
              cliError(stderrOutput.trim());
            } else {
              cliError("Run 'clawcode start-all --foreground' to see the error.");
            }
            process.exit(1);
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        cliError(`Error: ${message}`);
        process.exit(1);
      }
    });
}
