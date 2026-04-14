import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { AgentSessionConfig } from "./types.js";
import type { SkillsCatalog } from "../skills/types.js";
import type { TierManager } from "../memory/tier-manager.js";
import {
  loadLatestSummary,
  enforceSummaryBudget,
  DEFAULT_RESUME_SUMMARY_BUDGET,
} from "../memory/context-summary.js";
import type { BootstrapStatus } from "../bootstrap/types.js";
import { buildBootstrapPrompt } from "../bootstrap/prompt-builder.js";
import { extractFingerprint, formatFingerprint } from "../memory/fingerprint.js";
import { assembleContext, DEFAULT_BUDGETS } from "./context-assembler.js";
import type {
  ContextSources,
  BudgetWarningEvent,
  SkillCatalogEntry,
  ResolvedLazySkillsConfig,
} from "./context-assembler.js";
import type { MemoryEntry } from "../memory/types.js";
import type { SkillUsageTracker } from "../usage/skill-usage-tracker.js";

/**
 * Phase 53 Plan 02 — minimal logger shape accepted by `buildSessionConfig`.
 *
 * Mirrors pino's `Logger.warn` so the production code can pass its
 * `this.log` instance directly. Declared locally so this module has no
 * hard `pino` dependency (keeps transitive imports small).
 *
 * SECURITY: callers MUST NOT log prompt bodies here. `onBudgetWarning`
 * and `enforceSummaryBudget` send only `{ agent, section, beforeTokens,
 * budgetTokens, strategy }` — never the summary text.
 */
export type SessionConfigLoggerLike = {
  readonly warn: (obj: Record<string, unknown>, msg?: string) => void;
};

/**
 * Dependencies required by buildSessionConfig.
 * Passed in rather than accessed via `this` to decouple from SessionManager.
 *
 * Phase 52 Plan 02 — `priorHotStableToken` is threaded by SessionManager from
 * the per-agent map it maintains across turns so hot-tier placement (stable
 * vs mutable) decisions are stable across session-config rebuilds.
 *
 * Phase 53 Plan 02 — `log` is optional (back-compat): when supplied, it
 * receives pino WARN records when per-section budgets are exceeded and
 * when the resume-summary gets hard-truncated. Production SessionManager
 * always passes its logger; tests may omit it.
 */
export type SessionConfigDeps = {
  readonly tierManagers: Map<string, TierManager>;
  readonly skillsCatalog: SkillsCatalog;
  readonly allAgentConfigs: readonly ResolvedAgentConfig[];
  readonly priorHotStableToken?: string;
  readonly log?: SessionConfigLoggerLike;
  /**
   * Phase 53 Plan 03 — shared in-memory SkillUsageTracker. When absent,
   * the assembler treats the usage window as empty and the warm-up guard
   * (turns < threshold) keeps all skills rendering full content.
   */
  readonly skillUsageTracker?: SkillUsageTracker;
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
      effort: config.effort,
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

  // Inject agent name and memory_lookup guidance (LOAD-01)
  identityStr += `Your name is ${config.name}. When using memory_lookup, pass '${config.name}' as the agent parameter.\n`;

  // --- Collect hot memories source ---
  //
  // Phase 53 Plan 02: we now track BOTH the rendered string (kept for
  // cache-hash continuity with Phase 52) AND the raw MemoryEntry list so the
  // assembler can apply importance-ordered truncation when hot_tier exceeds
  // its per-section budget.
  let hotMemoriesStr = "";
  let hotMemoriesEntries: readonly MemoryEntry[] = [];
  const agentTierManager = deps.tierManagers.get(config.name);
  if (agentTierManager) {
    const hotMemories = agentTierManager.getHotMemories().slice(0, 3);
    hotMemoriesEntries = hotMemories;
    if (hotMemories.length > 0) {
      hotMemoriesStr = hotMemories
        .map((mem) => `- ${mem.content}`)
        .join("\n");
    }
  }

  // --- Collect skills header source (Phase 53 Plan 02 + Plan 03) ---
  //
  // Phase 53 Plan 02 carved skill descriptions out of `toolDefinitionsStr`
  // so the assembler could budget the section independently. Plan 53-03
  // layers lazy-skill compression on top: we now build a per-skill catalog
  // with `fullContent` AND the legacy bullet-line pre-rendering, then let
  // the assembler decide which to render per skill via its decision matrix
  // (full for recently-used / mentioned / warm-up; compressed otherwise).
  let skillsHeaderStr = "";
  const skillsCatalogEntries: SkillCatalogEntry[] = [];
  const assignedSkills = config.skills ?? [];
  if (assignedSkills.length > 0) {
    const skillDescriptions: string[] = [];
    for (const skillName of assignedSkills) {
      const entry = deps.skillsCatalog.get(skillName);
      if (entry) {
        const versionPart =
          entry.version !== null ? ` (v${entry.version})` : "";
        const bullet = `- **${entry.name}**${versionPart}: ${entry.description}`;
        skillDescriptions.push(bullet);
        // Full content falls back to the description bullet when a real
        // SKILL.md body is not wired in yet. This keeps the lazy-skill
        // decision matrix working from day one; a follow-up can read the
        // on-disk SKILL.md body via `entry.path` if we want maximum savings.
        skillsCatalogEntries.push(
          Object.freeze({
            name: entry.name,
            description: entry.description,
            fullContent: bullet,
          }),
        );
      }
    }
    if (skillDescriptions.length > 0) {
      skillsHeaderStr += skillDescriptions.join("\n");
      skillsHeaderStr +=
        "\n\nYour skill directories are symlinked in your workspace under skills/. Read SKILL.md in each for detailed instructions.\n";
    }
  }

  // --- Collect tool definitions source (MCP + admin + subagent) ---
  let toolDefinitionsStr = "";

  // Subagent thread skill guidance (SASK-03)
  const hasSubagentThreadSkill = (config.skills ?? []).includes("subagent-thread");
  if (hasSubagentThreadSkill) {
    toolDefinitionsStr += "You have the **subagent-thread** skill. When you need to delegate work to a subagent ";
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
    toolDefinitionsStr += toolDefinitionsStr.length > 0 ? "\n\n" : "";
    toolDefinitionsStr += "The following external MCP servers are configured and available to you:\n\n";
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
      toolDefinitionsStr += toolDefinitionsStr.length > 0 ? "\n\n" : "";
      toolDefinitionsStr += "You are the admin agent. You can read files in any agent's workspace and coordinate cross-agent tasks.\n\n";
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
    toolDefinitionsStr += toolDefinitionsStr.length > 0 ? "\n\n" : "";
    toolDefinitionsStr += `When spawning subagents via the Agent tool, use model: "${config.subagentModel}" unless a specific task requires a different model.\n`;
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

  // --- Collect context summary source (Phase 53 Plan 02 — CTX-04) ---
  //
  // The session-resume summary gets a HARD token budget enforced BEFORE it
  // lands in the assembler's mutable suffix. When over budget, we attempt
  // up-to-2 regenerations (future work — no live regenerator wired today)
  // then hard-truncate with a WARN. Default 1500, floor 500 (per D-04).
  let contextSummaryStr = "";
  const loadedSummary =
    contextSummary ??
    (await loadLatestSummary(join(config.workspace, "memory")));
  if (loadedSummary) {
    const resumeBudget =
      config.perf?.resumeSummaryBudget ?? DEFAULT_RESUME_SUMMARY_BUDGET;
    const enforced = await enforceSummaryBudget({
      summary: loadedSummary,
      budget: resumeBudget,
      log: deps.log,
      agentName: config.name,
      // regenerate: omitted — live LLM regeneration is future work. The
      // hard-truncate fallback handles oversized summaries today.
    });
    contextSummaryStr = `## Context Summary (from previous session)\n${enforced.summary}`;
  }

  // --- Assemble with budgets ---
  const budgets = config.contextBudgets ?? DEFAULT_BUDGETS;

  // Phase 53 Plan 03 — resolve lazySkills config + usage window. When the
  // tracker is absent, the assembler treats usage as empty and the warm-up
  // guard (turns < threshold) keeps all skills rendering full content.
  const skillUsage = deps.skillUsageTracker?.getWindow(config.name);
  const lazySkillsConfig: ResolvedLazySkillsConfig | undefined =
    config.perf?.lazySkills
      ? Object.freeze({
          enabled: config.perf.lazySkills.enabled,
          usageThresholdTurns: config.perf.lazySkills.usageThresholdTurns,
          reinflateOnMention: config.perf.lazySkills.reinflateOnMention,
        })
      : undefined;

  const sources: ContextSources = {
    identity: identityStr,
    // Phase 53 Plan 02: SOUL.md body is currently folded into `identityStr`
    // by the fingerprint+identity concatenation above. We leave `soul: ""`
    // here so section_tokens.soul reports 0 for this agent — accurate given
    // the current consolidation behavior. A future refactor can carve SOUL
    // out of identity and populate `sources.soul` directly.
    soul: "",
    // Phase 53 Plan 02 legacy path — kept for the zero-skills case.
    skillsHeader: skillsHeaderStr.trim(),
    hotMemories: hotMemoriesStr,
    hotMemoriesEntries,
    toolDefinitions: toolDefinitionsStr.trim(),
    graphContext: "",
    discordBindings: discordBindingsStr,
    contextSummary: contextSummaryStr,
    // Phase 53 Plan 02: split summary fields. Resume summary is the loaded
    // session-resume file; per-turn summary is a future field populated by
    // per-turn recap logic (empty today).
    resumeSummary: contextSummaryStr,
    perTurnSummary: "",
    // Recent conversation history is SDK-owned; leave empty so
    // section_tokens.recent_history reports 0 at agent-startup time.
    // Per-turn refresh paths (future) may populate this for accurate
    // per-turn audit.
    recentHistory: "",
    // Phase 53 Plan 03 — lazy-skill sources.
    skills: skillsCatalogEntries.length > 0 ? skillsCatalogEntries : undefined,
    skillUsage,
    lazySkillsConfig,
    // Per-turn mention sources stay empty at session-config time. A
    // future per-turn assembler re-call will populate these; the tests
    // exercise them directly via `assembleContext` sources.
    currentUserMessage: "",
    lastAssistantMessage: "",
  };

  // Phase 52 Plan 02 — two-block assembly for prompt caching.
  //   stablePrefix   → systemPrompt (fed to SDK preset.append, cached)
  //   mutableSuffix  → per-turn prepend to user message (outside cache)
  //   hotStableToken → persisted by SessionManager for next-turn comparison
  //
  // The `priorHotStableToken` dep controls hot-tier placement: matching
  // token → hot-tier stays in stable block; non-matching → hot-tier falls
  // into mutable for this turn only (cache thrashing guard, CONTEXT D-05).
  //
  // Phase 53 Plan 02 — per-section budgets + onBudgetWarning callback.
  // Warnings flow to `deps.log.warn` with section/beforeTokens/budgetTokens/
  // strategy — the full prompt body is NEVER logged (SECURITY).
  const onBudgetWarning = deps.log
    ? (event: BudgetWarningEvent) => {
        deps.log!.warn(
          {
            agent: config.name,
            section: event.section,
            beforeTokens: event.beforeTokens,
            budgetTokens: event.budgetTokens,
            strategy: event.strategy,
          },
          "context-assembly budget exceeded",
        );
      }
    : undefined;

  const assembled = assembleContext(sources, budgets, {
    priorHotStableToken: deps.priorHotStableToken,
    memoryAssemblyBudgets: config.perf?.memoryAssemblyBudgets,
    onBudgetWarning,
  });
  const trimmedMutable = assembled.mutableSuffix.trim();

  return {
    name: config.name,
    model: config.model,
    effort: config.effort,
    workspace: config.workspace,
    systemPrompt: assembled.stablePrefix.trim(),
    mutableSuffix: trimmedMutable.length > 0 ? trimmedMutable : undefined,
    hotStableToken: assembled.hotStableToken,
    channels,
    contextSummary,
    mcpServers: config.mcpServers ?? [],
  };
}
