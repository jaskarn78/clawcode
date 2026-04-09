import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { AgentSessionConfig } from "./types.js";
import type { SkillsCatalog } from "../skills/types.js";
import type { TierManager } from "../memory/tier-manager.js";
import { loadLatestSummary } from "../memory/context-summary.js";

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
): Promise<AgentSessionConfig> {
  let systemPrompt = "";

  // Read SOUL.md if available
  if (config.soul) {
    systemPrompt += config.soul + "\n\n";
  } else {
    try {
      const soulContent = await readFile(
        join(config.workspace, "SOUL.md"),
        "utf-8",
      );
      systemPrompt += soulContent + "\n\n";
    } catch {
      // No SOUL.md, that's fine
    }
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

  // Append Discord channel binding instructions if channels are configured
  const channels = config.channels ?? [];
  if (channels.length > 0) {
    systemPrompt += "\n\n## Discord Channel Bindings\n";
    systemPrompt += `You are bound to the following Discord channel(s): ${channels.join(", ")}\n`;
    systemPrompt +=
      "ONLY respond to messages from these channels. Ignore messages from any other channel.\n";
    systemPrompt +=
      "When replying, use the reply tool with the chat_id from the incoming message.";
  }

  // Append context summary from compaction restart or persisted summary (D-17)
  const effectiveSummary =
    contextSummary ??
    (await loadLatestSummary(join(config.workspace, "memory")));
  if (effectiveSummary) {
    systemPrompt += `\n\n## Context Summary (from previous session)\n${effectiveSummary}`;
  }

  // Inject hot memories into system prompt (D-11)
  const agentTierManager = deps.tierManagers.get(config.name);
  if (agentTierManager) {
    const hotMemories = agentTierManager.getHotMemories();
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
  };
}
