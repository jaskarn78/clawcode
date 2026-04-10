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

  let systemPrompt = "";

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
    systemPrompt += formatFingerprint(fingerprint) + "\n\n";
  }

  // Read IDENTITY.md if available
  if (config.identity) {
    systemPrompt += config.identity;
  } else {
    try {
      const identityContent = await readFile(
        join(config.workspace, "IDENTITY.md"),
        "utf-8",
      );
      systemPrompt += identityContent;
    } catch {
      // No IDENTITY.md, that's fine
    }
  }

  // Inject agent name and memory_lookup guidance (LOAD-01)
  systemPrompt += `Your name is ${config.name}. When using memory_lookup, pass '${config.name}' as the agent parameter.\n\n`;

  // Append Discord channel binding instructions if channels are configured
  const channels = config.channels ?? [];
  if (channels.length > 0) {
    systemPrompt += "\n\n## Discord Communication\n";
    systemPrompt += `You are bound to Discord channel(s): ${channels.join(", ")}\n`;
    systemPrompt += "Messages from Discord are delivered to you automatically. ";
    systemPrompt += "Your text responses are sent back to Discord automatically — just respond normally. ";
    systemPrompt += "Do NOT use Discord REST API calls, bot tokens, or any Discord tools to reply. ";
    systemPrompt += "Simply output your response as text and the system handles delivery.";
  }

  // Append context summary from compaction restart or persisted summary (D-17)
  const effectiveSummary =
    contextSummary ??
    (await loadLatestSummary(join(config.workspace, "memory")));
  if (effectiveSummary) {
    systemPrompt += `\n\n## Context Summary (from previous session)\n${effectiveSummary}`;
  }

  // Inject hot memories into system prompt — top 3 only (LOAD-02)
  const agentTierManager = deps.tierManagers.get(config.name);
  if (agentTierManager) {
    const hotMemories = agentTierManager.getHotMemories().slice(0, 3);
    if (hotMemories.length > 0) {
      systemPrompt += "\n\n## Key Memories\n\n";
      systemPrompt += hotMemories
        .map((mem) => `- ${mem.content}`)
        .join("\n");
    }
  }

  // Inject assigned skill descriptions into system prompt (D-06, D-08)
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
      systemPrompt += "\n\n## Available Skills\n\n";
      systemPrompt += skillDescriptions.join("\n");
      systemPrompt +=
        "\n\nYour skill directories are symlinked in your workspace under skills/. Read SKILL.md in each for detailed instructions.\n";
    }
  }

  // Inject subagent thread skill guidance (SASK-03)
  const hasSubagentThreadSkill = (config.skills ?? []).includes("subagent-thread");
  if (hasSubagentThreadSkill) {
    systemPrompt += "\n\n## Subagent Thread Skill\n\n";
    systemPrompt += "You have the **subagent-thread** skill. When you need to delegate work to a subagent ";
    systemPrompt += "and want the work visible in Discord, prefer the `spawn_subagent_thread` MCP tool ";
    systemPrompt += "over the raw Agent tool.\n\n";
    systemPrompt += "The `spawn_subagent_thread` tool creates a dedicated Discord thread where the subagent ";
    systemPrompt += "operates. This makes the subagent's work visible to channel members and provides a ";
    systemPrompt += "shareable thread URL.\n\n";
    systemPrompt += "Use the raw Agent tool only when Discord visibility is NOT needed (e.g., quick internal ";
    systemPrompt += "computations, file operations that don't need a thread).\n";
  }

  // Inject MCP tools section into system prompt (MCPC-03)
  const mcpServers = config.mcpServers ?? [];
  if (mcpServers.length > 0) {
    systemPrompt += "\n\n## Available MCP Tools\n\n";
    systemPrompt += "The following external MCP servers are configured and available to you:\n\n";
    for (const server of mcpServers) {
      systemPrompt += `- **${server.name}**: \`${server.command} ${server.args.join(" ")}\`\n`;
    }
    systemPrompt += "\nThese servers are activated automatically. Use their tools as needed for your tasks.\n";
  }

  // Inject admin agent information (per D-11, D-12)
  if (config.admin && deps.allAgentConfigs.length > 0) {
    const otherAgents = deps.allAgentConfigs.filter(
      (a) => a.name !== config.name,
    );
    if (otherAgents.length > 0) {
      systemPrompt += "\n\n## Admin Agent — Managed Agents\n\n";
      systemPrompt +=
        "You are the admin agent. You can read files in any agent's workspace and coordinate cross-agent tasks.\n\n";
      systemPrompt += "| Agent | Workspace | Model |\n";
      systemPrompt += "|-------|-----------|-------|\n";
      for (const agent of otherAgents) {
        systemPrompt += `| ${agent.name} | ${agent.workspace} | ${agent.model} |\n`;
      }
      systemPrompt +=
        "\nTo send a message to another agent, describe what you want to communicate and the system will route it via the messaging system.\n";
    }
  }

  // Inject subagent model guidance (per D-02, D-03)
  if (config.subagentModel) {
    systemPrompt += `\n\n## Subagent Configuration\n\nWhen spawning subagents via the Agent tool, use model: "${config.subagentModel}" unless a specific task requires a different model.\n`;
  }

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
