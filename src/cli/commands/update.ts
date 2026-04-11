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
  const scriptDir = dirname(resolve(process.argv[1]));
  return resolve(scriptDir, "..", "..");
}

/** Run a shell command in the project root, returning trimmed stdout. */
function run(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Register the `clawcode update` command.
 * Updates to latest or a specific release version, rebuilds, and optionally restarts.
 * Automatically resolves the ClawCode install directory — works from any cwd.
 */
export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update ClawCode to latest or a specific release")
    .option("--restart", "Restart the daemon after updating")
    .option("--version <tag>", "Update to a specific release (e.g. v1.0.0)")
    .option("--list", "List available releases")
    .option("--check", "Check for updates without applying")
    .action((opts: { restart?: boolean; version?: string; list?: boolean; check?: boolean }) => {
      const projectRoot = resolveProjectRoot();

      try {
        // Fetch latest tags from remote
        run("git fetch --tags --quiet", projectRoot);

        // --list: show available releases
        if (opts.list) {
          const tags = run("git tag -l 'v*' --sort=-v:refname", projectRoot);
          const current = getCurrentVersion(projectRoot);
          cliLog(`Current: ${current}`);
          cliLog("");
          if (tags) {
            cliLog("Available releases:");
            for (const tag of tags.split("\n").slice(0, 20)) {
              const marker = tag === current ? " (current)" : "";
              cliLog(`  ${tag}${marker}`);
            }
          } else {
            cliLog("No releases found. Create one with: bash scripts/release.sh v1.0.0");
          }
          return;
        }

        // --check: show if update available
        if (opts.check) {
          const current = getCurrentVersion(projectRoot);
          const latest = getLatestTag(projectRoot);
          cliLog(`Current: ${current}`);
          cliLog(`Latest:  ${latest || "(no releases)"}`);
          if (latest && latest !== current) {
            cliLog(`\nUpdate available: ${current} → ${latest}`);
            cliLog(`Run: clawcode update --version ${latest}`);
          } else {
            cliLog("\nAlready up to date.");
          }
          return;
        }

        const targetVersion = opts.version;
        cliLog(`Updating ClawCode at ${projectRoot}...`);
        cliLog("");

        if (targetVersion) {
          // Update to specific version tag
          const tag = targetVersion.startsWith("v") ? targetVersion : `v${targetVersion}`;

          // Verify tag exists
          try {
            run(`git rev-parse --verify "refs/tags/${tag}"`, projectRoot);
          } catch {
            cliError(`Release '${tag}' not found. Run 'clawcode update --list' to see available releases.`);
            process.exit(1);
            return;
          }

          const current = getCurrentVersion(projectRoot);
          cliLog(`Updating: ${current} → ${tag}`);
          run(`git checkout "${tag}"`, projectRoot);
        } else {
          // Update to latest on current branch
          cliLog("Pulling latest from remote...");
          const pullOutput = run("git pull --ff-only", projectRoot);
          cliLog(pullOutput);

          if (pullOutput.includes("Already up to date")) {
            // Check if there's a newer tag
            const current = getCurrentVersion(projectRoot);
            const latest = getLatestTag(projectRoot);
            if (latest && latest !== current) {
              cliLog(`\nA newer release is available: ${latest}`);
              cliLog(`Run: clawcode update --version ${latest}`);
            } else {
              cliLog("\nAlready on the latest version.");
            }
            return;
          }
        }

        cliLog("\nInstalling dependencies...");
        run("npm ci --omit=dev", projectRoot);
        cliLog("Dependencies installed.");

        cliLog("\nBuilding...");
        run("npm run build", projectRoot);
        cliLog("Build complete.");

        const newVersion = getCurrentVersion(projectRoot);
        cliLog(`\nUpdated to: ${newVersion}`);

        if (opts.restart) {
          cliLog("\nRestarting daemon...");
          try {
            run("systemctl restart clawcode", projectRoot);
            cliLog("Daemon restarted.");
          } catch {
            cliLog("systemd service not found — restart the daemon manually.");
          }
        } else {
          cliLog("\nRestart the daemon to apply changes:");
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

/** Get the current version: nearest tag or branch+commit. */
function getCurrentVersion(cwd: string): string {
  try {
    return run("git describe --tags --abbrev=0", cwd);
  } catch {
    // No tags yet — fall back to branch + short hash
    const branch = run("git rev-parse --abbrev-ref HEAD", cwd);
    const hash = run("git rev-parse --short HEAD", cwd);
    return `${branch}@${hash}`;
  }
}

/** Get the latest semver tag. */
function getLatestTag(cwd: string): string | null {
  try {
    return run("git tag -l 'v*' --sort=-v:refname | head -1", cwd) || null;
  } catch {
    return null;
  }
}
