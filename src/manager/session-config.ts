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
// Phase 67 — Resume Auto-Injection (SESS-02, SESS-03)
import type { ConversationStore } from "../memory/conversation-store.js";
import type { MemoryStore } from "../memory/store.js";
import {
  assembleConversationBrief,
  DEFAULT_RESUME_SESSION_COUNT,
  DEFAULT_RESUME_GAP_THRESHOLD_HOURS,
  DEFAULT_CONVERSATION_CONTEXT_BUDGET,
} from "../memory/conversation-brief.js";
// Phase 73 Plan 02 — per-agent conversation-brief cache (LAT-02).
import {
  ConversationBriefCache,
  computeBriefFingerprint,
} from "./conversation-brief-cache.js";
// Phase 85 Plan 02 — MCP section renderer (TOOL-02 / TOOL-05 / TOOL-07).
import { renderMcpPromptBlock } from "./mcp-prompt-block.js";
import type { McpServerState } from "../mcp/readiness.js";
// Phase 90 MEM-01 — 50KB hard cap on MEMORY.md auto-inject (D-17).
import { MEMORY_AUTOLOAD_MAX_BYTES } from "../config/schema.js";

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
  /**
   * Phase 67 — per-agent ConversationStore map. When set (and `memoryStores`
   * also carries an entry for the agent), `buildSessionConfig` invokes
   * `assembleConversationBrief` and threads the rendered brief into the
   * `conversation_context` mutable-suffix section. Absent entries degrade
   * gracefully — no brief renders, no error.
   */
  readonly conversationStores?: Map<string, ConversationStore>;
  /**
   * Phase 67 — per-agent MemoryStore map. Required alongside
   * `conversationStores` for the brief-assembler path to run. Session
   * summaries are queried via `memoryStore.findByTag("session-summary")`.
   */
  readonly memoryStores?: Map<string, MemoryStore>;
  /**
   * Phase 67 — epoch-millisecond clock override. Defaults to `Date.now()` in
   * production. Injected so integration tests can simulate a 4-hour gap
   * boundary without `vi.setSystemTime()` or Date monkey-patching.
   */
  readonly now?: number;
  /**
   * Phase 73 Plan 02 — per-agent conversation-brief cache (LAT-02).
   *
   * When supplied, `buildSessionConfig` short-circuits `assembleConversationBrief`
   * when the current terminated-session-id fingerprint matches the cached
   * entry's fingerprint. Absent → legacy behavior (brief re-assembled every
   * call). Owned by SessionManager; invalidated on stopAgent + crash.
   */
  readonly briefCache?: ConversationBriefCache;
  /**
   * Phase 85 Plan 02 — per-agent MCP state provider (TOOL-02).
   *
   * When absent (tests, legacy bootstrap paths, first-boot before the
   * readiness handshake runs), the MCP renderer falls back to an empty
   * Map and every server renders as `status: unknown`. Production
   * SessionManager wires this to `this.getMcpStateForAgent` so the
   * prompt carries live readiness state.
   */
  readonly mcpStateProvider?: (
    agentName: string,
  ) => ReadonlyMap<string, McpServerState>;
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

  // Phase 78 CONF-01 — Read SOUL content via 3-branch precedence:
  //   config.soulFile (absolute path, lazy-read) → <workspace>/SOUL.md → inline config.soul.
  // Silent fall-through on read errors at every step: a configured soulFile
  // pointing at a deleted file must not crash session boot; it falls through
  // to the workspace file, then the inline string. Content is used for
  // fingerprint extraction only (LOAD-02) — full SOUL.md text is never
  // embedded in the system prompt.
  let soulContent = "";
  if (config.soulFile) {
    try {
      soulContent = await readFile(config.soulFile, "utf-8");
    } catch {
      // soulFile configured but unreadable — fall through to workspace/SOUL.md
    }
  }
  if (!soulContent) {
    try {
      soulContent = await readFile(join(config.workspace, "SOUL.md"), "utf-8");
    } catch {
      // No SOUL.md in workspace
    }
  }
  if (!soulContent) soulContent = config.soul ?? "";

  if (soulContent) {
    const fingerprint = extractFingerprint(soulContent);
    identityStr += formatFingerprint(fingerprint) + "\n\n";
  }

  // Phase 78 CONF-01 — Read IDENTITY content via 3-branch precedence:
  //   config.identityFile (absolute path, lazy-read) → <workspace>/IDENTITY.md → inline config.identity.
  // Same silent fall-through semantics as soul. Unlike soul, the full identity
  // text is appended to the system prompt (no fingerprint extraction).
  let identityContent = "";
  if (config.identityFile) {
    try {
      identityContent = await readFile(config.identityFile, "utf-8");
    } catch {
      // identityFile configured but unreadable — fall through
    }
  }
  if (!identityContent) {
    try {
      identityContent = await readFile(
        join(config.workspace, "IDENTITY.md"),
        "utf-8",
      );
    } catch {
      // No IDENTITY.md, that's fine
    }
  }
  if (!identityContent) identityContent = config.identity ?? "";

  if (identityContent) {
    identityStr += identityContent;
  }

  // Inject agent name and memory_lookup guidance (LOAD-01)
  identityStr += `Your name is ${config.name}. When using memory_lookup, pass '${config.name}' as the agent parameter.\n`;

  // Phase 90 MEM-01 — MEMORY.md auto-load into stable prefix, AFTER
  // SOUL+IDENTITY and BEFORE MCP status (per D-18). 50KB hard cap
  // (MEMORY_AUTOLOAD_MAX_BYTES) with truncation marker per D-17.
  // Silent fall-through on missing file (same semantics as SOUL/IDENTITY
  // branches above — configured-but-unreadable must not crash session
  // boot). Opt-out via config.memoryAutoLoad === false; override path via
  // config.memoryAutoLoadPath (absolute, loader expanded ~/...).
  if (config.memoryAutoLoad !== false) {
    const memoryPath =
      config.memoryAutoLoadPath ?? join(config.workspace, "MEMORY.md");
    try {
      const raw = await readFile(memoryPath, "utf-8");
      let body = raw;
      if (Buffer.byteLength(body, "utf8") > MEMORY_AUTOLOAD_MAX_BYTES) {
        // Byte-level truncation (UTF-8 safe via Buffer slice + toString).
        // Mid-multibyte-codepoint truncation is a theoretical concern but
        // acceptable: MEMORY.md is markdown prose (mostly ASCII), and the
        // assembler downstream treats the payload as opaque text.
        const buf = Buffer.from(body, "utf8");
        body = buf.slice(0, MEMORY_AUTOLOAD_MAX_BYTES).toString("utf8");
        body += "\n\n…(truncated at 50KB cap)\n";
      }
      identityStr += "\n## Long-term memory (MEMORY.md)\n\n" + body + "\n";
    } catch {
      // MEMORY.md not present OR override path unreadable — silently skip.
      // No warn log: absence is the common case on first-boot agents.
    }
  }

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

  // Phase 85 TOOL-02 / TOOL-05 / TOOL-07 — MCP block rendered by a pure
  // helper that includes (a) the pre-authenticated framing, (b) a live
  // status table sourced from mcpStateProvider, (c) the verbatim-error
  // rule. The concatenation lands in `sources.toolDefinitions`, which the
  // v1.7 two-block assembler places in the STABLE PREFIX — survives
  // compaction-driven prompt-cache eviction.
  //
  // Pitfall 12 closure: the replaced block leaked `command`/`args` into
  // every prompt. renderMcpPromptBlock reads only `name`, `optional`, and
  // `state.lastError.message` — command/args/env values never reach the
  // prompt surface.
  const mcpServers = config.mcpServers ?? [];
  if (mcpServers.length > 0) {
    const mcpState = deps.mcpStateProvider?.(config.name) ?? new Map();
    const mcpBlock = renderMcpPromptBlock({
      servers: mcpServers,
      stateByName: mcpState,
    });
    if (mcpBlock.length > 0) {
      toolDefinitionsStr += toolDefinitionsStr.length > 0 ? "\n\n" : "";
      toolDefinitionsStr += mcpBlock;
    }
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
    // Phase 75 SHARED-02 — loadLatestSummary must resolve against
    // memoryPath (not workspace) so shared-workspace agents find the
    // context-summary.md that saveContextSummary wrote under
    // memoryPath/memory/. For dedicated-workspace agents the loader
    // fallback makes workspace === memoryPath, so this is a no-op.
    (await loadLatestSummary(join(config.memoryPath, "memory")));
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

  // --- Phase 67 — Resume Auto-Injection (SESS-02 / SESS-03) ---
  //
  // When both per-agent stores are wired, render the conversation brief via
  // the pure helper from Plan 01. The helper handles:
  //   - SESS-03 gap check (short-circuits when last session <4h ago by default)
  //   - SESS-02 last-N tag-scoped retrieval with accumulate-budget enforcement
  //   - Markdown rendering under a stable "## Recent Sessions" heading
  // Result is threaded into `ContextSources.conversationContext` and lands
  // in the MUTABLE SUFFIX — never in the cached stable prefix (Pitfall 1).
  // Graceful degradation: when EITHER store is absent (legacy startup path,
  // tests that don't wire stores), skip the helper entirely — no throw.
  let conversationContextStr = "";
  const convStore = deps.conversationStores?.get(config.name);
  const memStore = deps.memoryStores?.get(config.name);
  if (convStore && memStore) {
    const sessionCount =
      config.memory.conversation?.resumeSessionCount ??
      DEFAULT_RESUME_SESSION_COUNT;
    // Phase 73 Plan 02 — compute fingerprint over the actual brief inputs
    // (terminated-session IDs) so invalidation is driven by content-change,
    // not by a coarse agent-name key (73-RESEARCH Pitfall 7).
    const terminatedIds = convStore
      .listRecentTerminatedSessions(config.name, sessionCount)
      .map((s) => s.id);
    const fingerprint = computeBriefFingerprint(terminatedIds);
    const cached = deps.briefCache?.get(config.name);
    if (cached && cached.fingerprint === fingerprint) {
      // Cache HIT — skip assembleConversationBrief entirely, inline the
      // cached rendered block.
      conversationContextStr = cached.briefBlock;
    } else {
      // Cache MISS (or no cache wired) — compute the brief and, if a cache
      // is present and the result is non-skipped, write it back keyed by
      // the fresh fingerprint.
      const briefResult = assembleConversationBrief(
        { agentName: config.name, now: deps.now ?? Date.now() },
        {
          conversationStore: convStore,
          memoryStore: memStore,
          config: {
            sessionCount,
            gapThresholdHours:
              config.memory.conversation?.resumeGapThresholdHours ??
              DEFAULT_RESUME_GAP_THRESHOLD_HOURS,
            budgetTokens:
              config.memory.conversation?.conversationContextBudget ??
              DEFAULT_CONVERSATION_CONTEXT_BUDGET,
          },
          log: deps.log,
        },
      );
      if (!briefResult.skipped) {
        conversationContextStr = briefResult.brief; // already budget-enforced
        deps.briefCache?.set(config.name, {
          fingerprint,
          briefBlock: briefResult.brief,
        });
      }
    }
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
    // Phase 67 — conversation brief threaded into the MUTABLE SUFFIX.
    // Empty string when stores are not wired or gap-skip fired.
    conversationContext: conversationContextStr,
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
