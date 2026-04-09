import { Command } from "commander";
import { loadConfig, resolveAllAgents } from "../config/loader.js";
import { createWorkspaces } from "../agent/workspace.js";
import {
  ConfigValidationError,
  ConfigFileNotFoundError,
} from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import { cliLog, cliError } from "./output.js";
import { registerStartCommand } from "./commands/start.js";
import { registerStopCommand } from "./commands/stop.js";
import { registerRestartCommand } from "./commands/restart.js";
import { registerStartAllCommand } from "./commands/start-all.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerRoutesCommand } from "./commands/routes.js";
import { registerHealthCommand } from "./commands/health.js";
import { registerSchedulesCommand } from "./commands/schedules.js";
import { registerSkillsCommand } from "./commands/skills.js";
import { registerSendCommand } from "./commands/send.js";
import { registerThreadsCommand } from "./commands/threads.js";
import { registerWebhooksCommand } from "./commands/webhooks.js";
import { registerForkCommand } from "./commands/fork.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerUsageCommand } from "./commands/usage.js";
import { registerDeliveryQueueCommand } from "./commands/delivery-queue.js";
import { registerSecurityCommand } from "./commands/security.js";

/**
 * Options for the init action.
 */
export type InitOptions = {
  readonly config: string;
  readonly dryRun?: boolean;
};

/**
 * Initialize agent workspaces from config.
 *
 * Exported as a named function so integration tests can call it directly
 * without spawning a subprocess. Throws on errors rather than calling
 * process.exit -- the CLI wrapper handles exit codes.
 *
 * @param options - Config path and optional dry-run flag
 * @throws ConfigFileNotFoundError if config file doesn't exist
 * @throws ConfigValidationError if config fails schema validation
 */
export async function initAction(options: InitOptions): Promise<void> {
  const config = await loadConfig(options.config);
  const resolvedAgents = resolveAllAgents(config);

  if (options.dryRun) {
    cliLog("Dry run -- showing what would be created:\n");
    for (const agent of resolvedAgents) {
      cliLog(`  Agent: ${agent.name}`);
      cliLog(`    Workspace: ${agent.workspace}`);
      cliLog(`    Files: SOUL.md, IDENTITY.md`);
      cliLog(`    Dirs: memory/, skills/`);
      cliLog("");
    }
    cliLog(`Would initialize ${resolvedAgents.length} agent workspace(s)`);
    return;
  }

  const results = await createWorkspaces(resolvedAgents);

  for (const result of results) {
    if (result.filesWritten.length > 0) {
      cliLog(`Created: ${result.path}`);
    } else {
      cliLog(`Exists: ${result.path}`);
    }
  }

  cliLog(`\nInitialized ${results.length} agent workspace(s)`);
  logger.info({ count: results.length }, "workspaces initialized");
}

/**
 * CLI program definition.
 * Wires initAction into Commander for `clawcode init` usage.
 */
const program = new Command()
  .name("clawcode")
  .description("Multi-agent orchestration for Claude Code")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize agent workspaces from config")
  .option("-c, --config <path>", "Path to config file", "clawcode.yaml")
  .option("--dry-run", "Show what would be created without creating it")
  .action(async (opts: { config: string; dryRun?: boolean }) => {
    try {
      await initAction({ config: opts.config, dryRun: opts.dryRun });
    } catch (error) {
      if (error instanceof ConfigFileNotFoundError) {
        cliError(`Error: ${error.message}`);
        process.exit(1);
      }
      if (error instanceof ConfigValidationError) {
        cliError(`Error: Invalid config:\n${error.issues.join("\n")}`);
        process.exit(1);
      }
      const message = error instanceof Error ? error.message : String(error);
      cliError(`Error: ${message}`);
      process.exit(1);
    }
  });

// Register lifecycle commands
registerStartCommand(program);
registerStopCommand(program);
registerRestartCommand(program);
registerStartAllCommand(program);
registerStatusCommand(program);
registerRoutesCommand(program);
registerHealthCommand(program);
registerSchedulesCommand(program);
registerSkillsCommand(program);
registerSendCommand(program);
registerThreadsCommand(program);
registerWebhooksCommand(program);
registerForkCommand(program);
registerMcpCommand(program);
registerMemoryCommand(program);
registerUsageCommand(program);
registerDeliveryQueueCommand(program);
registerSecurityCommand(program);

// Only parse when run as CLI entry point (not when imported by tests)
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/cli/index.ts") ||
    process.argv[1].endsWith("/cli/index.js"));

if (isDirectRun) {
  program.parse();
}

export { program };
