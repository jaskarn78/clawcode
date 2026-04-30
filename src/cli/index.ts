import { Command } from "commander";
import { join } from "node:path";
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
import { registerStopAllCommand } from "./commands/stop-all.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerRoutesCommand } from "./commands/routes.js";
import { registerHealthCommand } from "./commands/health.js";
import { registerTierTickCommand } from "./commands/tier-tick.js";
import { registerSchedulesCommand } from "./commands/schedules.js";
import { registerSkillsCommand } from "./commands/skills.js";
import { registerSendCommand } from "./commands/send.js";
import { registerThreadsCommand } from "./commands/threads.js";
import { registerWebhooksCommand } from "./commands/webhooks.js";
import { registerForkCommand } from "./commands/fork.js";
import { registerMcpCommand, registerMcpProbeCommand } from "./commands/mcp.js";
import { registerBrowserMcpCommand } from "./commands/browser-mcp.js";
import { registerSearchMcpCommand } from "./commands/search-mcp.js";
import { registerImageMcpCommand } from "./commands/image-mcp.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerUsageCommand } from "./commands/usage.js";
import { registerDeliveryQueueCommand } from "./commands/delivery-queue.js";
import { registerSecurityCommand } from "./commands/security.js";
import { registerSpawnThreadCommand } from "./commands/spawn-thread.js";
import { registerMcpServersCommand } from "./commands/mcp-servers.js";
import { registerMcpStatusCommand } from "./commands/mcp-status.js";
import { registerDashboardCommand } from "./commands/dashboard.js";
import { registerAgentCreateCommand } from "./commands/agent-create.js";
import { registerRunCommand } from "./commands/run.js";
import { registerCostsCommand } from "./commands/costs.js";
import { registerLatencyCommand } from "./commands/latency.js";
import { registerCacheCommand } from "./commands/cache.js";
import { registerToolsCommand } from "./commands/tools.js";
import { registerBenchCommand } from "./commands/bench.js";
import { registerContextAuditCommand } from "./commands/context-audit.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerTasksCommand } from "./commands/tasks.js";
import { registerPolicyCommand } from "./commands/policy.js";
import { registerTriggersCommand } from "./commands/triggers.js";
import { registerTraceCommand } from "./commands/trace.js";
import { registerOpenAiKeyCommand } from "./commands/openai-key.js";
import { registerOpenAiLogCommand } from "./commands/openai-log.js";
import { registerRegistryCommand } from "./commands/registry.js";
import { registerMigrateOpenclawCommand } from "./commands/migrate-openclaw.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerCutoverCommand } from "./commands/cutover.js";
import { registerDreamCommand } from "./commands/dream.js";
// Phase 96 Plan 05 — filesystem-capability operator surfaces. Both invoke
// the SAME daemon IPC primitives ('probe-fs' for clawcode probe-fs, and
// 'list-fs-status' for clawcode fs-status) used by the Discord slash
// /clawcode-probe-fs (single source of truth — Discord/CLI parity invariant).
import { registerProbeFsCommand } from "./commands/probe-fs.js";
import { registerFsStatusCommand } from "./commands/fs-status.js";
// Phase 100 Plan 06 — operator-driven GSD install (symlinks + sandbox bootstrap).
// Local-only; production deploy on clawdy is operator-run per Plan 08 runbook.
import { registerGsdInstallCommand } from "./commands/gsd-install.js";
import { installWorkspaceSkills } from "../skills/installer.js";

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

  // Install workspace skills to ~/.claude/skills/
  await installWorkspaceSkills(join(process.cwd(), "skills"));

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
  .version("0.2.0");

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
registerStopAllCommand(program);
registerStatusCommand(program);
registerRoutesCommand(program);
registerHealthCommand(program);
registerTierTickCommand(program);
registerSchedulesCommand(program);
registerSkillsCommand(program);
registerSendCommand(program);
registerThreadsCommand(program);
registerWebhooksCommand(program);
registerForkCommand(program);
registerMcpCommand(program);
registerBrowserMcpCommand(program);
registerSearchMcpCommand(program);
registerImageMcpCommand(program);
registerMemoryCommand(program);
registerUsageCommand(program);
registerDeliveryQueueCommand(program);
registerSecurityCommand(program);
registerSpawnThreadCommand(program);
registerMcpServersCommand(program);
registerMcpStatusCommand(program);
registerMcpProbeCommand(program);
registerDashboardCommand(program);
registerAgentCreateCommand(program);
registerRunCommand(program);
registerCostsCommand(program);
registerLatencyCommand(program);
registerCacheCommand(program);
registerToolsCommand(program);
registerBenchCommand(program);
registerContextAuditCommand(program);
registerUpdateCommand(program);
registerTasksCommand(program);
registerPolicyCommand(program);
registerTriggersCommand(program);
registerTraceCommand(program);
registerOpenAiKeyCommand(program);
registerOpenAiLogCommand(program);
registerRegistryCommand(program);
registerMigrateOpenclawCommand(program);
registerSyncCommand(program);
registerCutoverCommand(program);
registerDreamCommand(program);
// Phase 96 Plan 05 — filesystem capability operator surfaces.
registerProbeFsCommand(program);
registerFsStatusCommand(program);
// Phase 100 Plan 06 — `clawcode gsd install` operator-driven pre-flight.
registerGsdInstallCommand(program);

// Only parse when run as CLI entry point (not when imported by tests).
// Check for common CLI invocation patterns: direct .ts/.js execution,
// tsx runner, or npm-linked binary (symlink won't match file extension).
const entryPath = process.argv[1] ?? "";
const isDirectRun =
  entryPath.endsWith("/cli/index.ts") ||
  entryPath.endsWith("/cli/index.js") ||
  entryPath.endsWith("/bin/clawcode");

if (isDirectRun) {
  program.parse();
}

export { program };
