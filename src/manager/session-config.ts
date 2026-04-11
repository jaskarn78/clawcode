import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { AgentSessionConfig } from "./types.js";
import type { SkillsCatalog } from "../skills/types.js";
import type { TierManager } from "../memory/tier-manager.js";
import { loadLatestSummary } from "../memory/context-summary.js";
import type { BootstrapStatus } from "../bootstrap/types.js";
import { buildBootstrapPrompt } from "../bootstrap/prompt-builder.js";
import { extractFingerprint, formatFingerprint } from "../memory/fingerprint.js";
import { assembleContext, DEFAULT_BUDGETS } from "./context-assembler.js";
import type { ContextSources } from "./context-assembler.js";

/**
 * Dependencies required by buildSessionConfig.
 * Passed in rather than accessed via `this` to decouple from SessionManager.
 */
export type SessionConfigDeps = {
  readonly tierManagers: Map<string, TierManager>;
  readonly skillsCatalog: SkillsCatalog;
  readonly allAgentConfigs: readonly ResolvedAgentConfig[];
};

/**
 * Build an AgentSessionConfig from a ResolvedAgentConfig.
 * Reads SOUL.md and IDENTITY.md from the workspace for systemPrompt.
 * Injects hot memories, skills, admin info, subagent config, and context summary.
 */
export async function buildSessionConfig(
  config: ResolvedAgentConfig,
  deps: SessionConfigDeps,
  contextSummary?: string,
  bootstrapStatus?: BootstrapStatus,
): Promise<AgentSessionConfig> {
  // Bootstrap-needed agents get the walkthrough prompt instead of normal config
  if (bootstrapStatus === "needed") {
    let systemPrompt = buildBootstrapPrompt({
      workspace: config.workspace,
      agentName: config.name,
      channels: [...config.channels],
    });

    // Still include Discord channel bindings even during bootstrap
    const channels = config.channels ?? [];
    if (channels.length > 0) {
      systemPrompt += "\n\n## Discord Communication\n";
      systemPrompt += `You are bound to Discord channel(s): ${channels.join(", ")}\n`;
      systemPrompt += "Messages from Discord are delivered to you automatically. ";
      systemPrompt += "Your text responses are sent back to Discord automatically — just respond normally. ";
      systemPrompt += "Do NOT use Discord REST API calls, bot tokens, or any Discord tools to reply. ";
      systemPrompt += "Simply output your response as text and the system handles delivery.";
    }

    return {
      name: config.name,
      model: config.model,
      workspace: config.workspace,
      systemPrompt: systemPrompt.trim(),
      channels,
      contextSummary,
    };
  }

  // --- Collect identity source ---
  let identityStr = "";

  // Read SOUL.md content for fingerprint extraction (LOAD-02)
  let soulContent = config.soul ?? "";
  if (!soulContent) {
    try {
      soulContent = await readFile(join(config.workspace, "SOUL.md"), "utf-8");
    } catch {
      // No SOUL.md
    }
  }

  if (soulContent) {
    const fingerprint = extractFingerprint(soulContent);
    identityStr += formatFingerprint(fingerprint) + "\n\n";
  }

  // Read IDENTITY.md if available
  if (config.identity) {
    identityStr += config.identity;
  } else {
    try {
      const identityContent = await readFile(
        join(config.workspace, "IDENTITY.md"),
        "utf-8",
      );
      identityStr += identityContent;
    } catch {
      // No IDENTITY.md, that's fine
    }
  }

  // Inject agent name and memory guidance (LOAD-01)
  identityStr += `Your name is ${config.name}. When using memory_lookup or memory_save, pass '${config.name}' as the agent parameter.\n`;
  identityStr += `Use memory_lookup to recall past conversations, decisions, and knowledge. Use memory_save to store important things you learn for future sessions.\n`;

  // --- Collect hot memories source ---
  let hotMemoriesStr = "";
  const agentTierManager = deps.tierManagers.get(config.name);
  if (agentTierManager) {
    const hotMemories = agentTierManager.getHotMemories().slice(0, 3);
    if (hotMemories.length > 0) {
      hotMemoriesStr = hotMemories
        .map((mem) => `- ${mem.content}`)
        .join("\n");
    }
  }

  // --- Collect tool definitions source ---
  let toolDefinitionsStr = "";

  // Skill descriptions (D-06, D-08)
  const assignedSkills = config.skills ?? [];
  if (assignedSkills.length > 0) {
    const skillDescriptions: string[] = [];
    for (const skillName of assignedSkills) {
      const entry = deps.skillsCatalog.get(skillName);
      if (entry) {
        const versionPart =
          entry.version !== null ? ` (v${entry.version})` : "";
        skillDescriptions.push(
          `- **${entry.name}**${versionPart}: ${entry.description}`,
        );
      }
    }
    if (skillDescriptions.length > 0) {
      toolDefinitionsStr += skillDescriptions.join("\n");
      toolDefinitionsStr +=
        "\n\nYour skill directories are symlinked in your workspace under skills/. Read SKILL.md in each for detailed instructions.\n";
    }
  }

  // Subagent thread skill guidance (SASK-03)
  const hasSubagentThreadSkill = (config.skills ?? []).includes("subagent-thread");
  if (hasSubagentThreadSkill) {
    toolDefinitionsStr += "\n\nYou have the **subagent-thread** skill. When you need to delegate work to a subagent ";
    toolDefinitionsStr += "and want the work visible in Discord, prefer the `spawn_subagent_thread` MCP tool ";
    toolDefinitionsStr += "over the raw Agent tool.\n\n";
    toolDefinitionsStr += "The `spawn_subagent_thread` tool creates a dedicated Discord thread where the subagent ";
    toolDefinitionsStr += "operates. This makes the subagent's work visible to channel members and provides a ";
    toolDefinitionsStr += "shareable thread URL.\n\n";
    toolDefinitionsStr += "Use the raw Agent tool only when Discord visibility is NOT needed (e.g., quick internal ";
    toolDefinitionsStr += "computations, file operations that don't need a thread).\n";
  }

  // MCP tools section (MCPC-03)
  const mcpServers = config.mcpServers ?? [];
  if (mcpServers.length > 0) {
    toolDefinitionsStr += "\n\nThe following external MCP servers are configured and available to you:\n\n";
    for (const server of mcpServers) {
      toolDefinitionsStr += `- **${server.name}**: \`${server.command} ${server.args.join(" ")}\`\n`;
    }
    toolDefinitionsStr += "\nThese servers are activated automatically. Use their tools as needed for your tasks.\n";
  }

  // Admin agent information (per D-11, D-12)
  if (config.admin && deps.allAgentConfigs.length > 0) {
    const otherAgents = deps.allAgentConfigs.filter(
      (a) => a.name !== config.name,
    );
    if (otherAgents.length > 0) {
      toolDefinitionsStr += "\n\nYou are the admin agent. You can read files in any agent's workspace and coordinate cross-agent tasks.\n\n";
      toolDefinitionsStr += "| Agent | Workspace | Model |\n";
      toolDefinitionsStr += "|-------|-----------|-------|\n";
      for (const agent of otherAgents) {
        toolDefinitionsStr += `| ${agent.name} | ${agent.workspace} | ${agent.model} |\n`;
      }
      toolDefinitionsStr +=
        "\nTo send a message to another agent, describe what you want to communicate and the system will route it via the messaging system.\n";
    }
  }

  // Subagent model guidance (per D-02, D-03)
  if (config.subagentModel) {
    toolDefinitionsStr += `\n\nWhen spawning subagents via the Agent tool, use model: "${config.subagentModel}" unless a specific task requires a different model.\n`;
  }

  // --- Collect Discord bindings source ---
  let discordBindingsStr = "";
  const channels = config.channels ?? [];
  if (channels.length > 0) {
    discordBindingsStr += "## Discord Communication\n";
    discordBindingsStr += `You are bound to Discord channel(s): ${channels.join(", ")}\n`;
    discordBindingsStr += "Messages from Discord are delivered to you automatically. ";
    discordBindingsStr += "Your text responses are sent back to Discord automatically — just respond normally. ";
    discordBindingsStr += "Do NOT use Discord REST API calls, bot tokens, or any Discord tools to reply. ";
    discordBindingsStr += "Simply output your response as text and the system handles delivery.";
  }

  // --- Collect context summary source ---
  let contextSummaryStr = "";
  const effectiveSummary =
    contextSummary ??
    (await loadLatestSummary(join(config.workspace, "memory")));
  if (effectiveSummary) {
    contextSummaryStr = `## Context Summary (from previous session)\n${effectiveSummary}`;
  }

  // --- Assemble with budgets ---
  const budgets = config.contextBudgets ?? DEFAULT_BUDGETS;
  const sources: ContextSources = {
    identity: identityStr,
    hotMemories: hotMemoriesStr,
    toolDefinitions: toolDefinitionsStr.trim(),
    graphContext: "",
    discordBindings: discordBindingsStr,
    contextSummary: contextSummaryStr,
  };
  const systemPrompt = assembleContext(sources, budgets);

  return {
    name: config.name,
    model: config.model,
    workspace: config.workspace,
    systemPrompt: systemPrompt.trim(),
    channels,
    contextSummary,
    mcpServers: config.mcpServers ?? [],
  };
}
