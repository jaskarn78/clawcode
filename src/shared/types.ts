// Phase 95 DREAM-01..03 — dream config type lives in the config schema.
// We import the inferred zod type so ResolvedAgentConfig.dream stays in
// lockstep with the schema definition (one source of truth).
import type { DreamConfig } from "../config/schema.js";

/**
 * Resolved agent configuration after defaults merging.
 * All optional fields from the raw config are resolved to concrete values.
 */
export type ResolvedAgentConfig = {
  readonly name: string;
  readonly workspace: string;
  /**
   * Phase 75 SHARED-01 — resolved filesystem path for the agent's
   * private runtime state (memories.db, traces.db, inbox/, heartbeat.log,
   * context-summary files, session-state). When the YAML omitted
   * `memoryPath:`, loader.ts populates this from `workspace` so downstream
   * consumers can always read it unconditionally. Always absolute
   * (expanded via expandHome in loader.ts Plan 02).
   */
  readonly memoryPath: string;
  readonly channels: readonly string[];
  readonly model: "sonnet" | "opus" | "haiku";
  readonly effort: "low" | "medium" | "high" | "max";
  /**
   * Phase 86 MODEL-01 — per-agent allowlist for the /clawcode-model
   * Discord picker and the SessionManager.setModelForAgent guard.
   *
   * ALWAYS populated after resolution (loader.ts fills from
   * defaults.allowedModels when the agent omits the field). Downstream
   * consumers (Plan 02 daemon IPC, Plan 03 slash command) read this
   * unconditionally. Default is the full modelSchema enum.
   */
  readonly allowedModels: readonly ("haiku" | "sonnet" | "opus")[];
  /**
   * Phase 89 GREET-07 — ALWAYS populated by loader.ts from
   * agent.greetOnRestart ?? defaults.greetOnRestart. Downstream
   * (SessionManager.restartAgent → restart-greeting.ts) reads unconditionally.
   */
  readonly greetOnRestart: boolean;
  /**
   * Phase 89 GREET-10 — ALWAYS populated by loader.ts. Milliseconds.
   */
  readonly greetCoolDownMs: number;
  /**
   * Phase 96 D-05 — per-agent fileAccess override. UNDEFINED when the agent
   * does not declare it (loader does not inherit defaults here — defaults
   * are merged by `resolveFileAccess(agent, cfg, defaults)` at IPC handler
   * call time). Daemon `probe-fs` / `list-fs-status` IPC handlers read this
   * via `manager.getAgentConfig(agent).fileAccess`.
   *
   * Bug fix 2026-04-25 (deploy): 96-01 added the schema field but missed
   * propagating it into the resolved type — daemon never saw per-agent
   * fileAccess, only defaults.fileAccess (zod default).
   */
  readonly fileAccess?: readonly string[];
  /**
   * Phase 96 D-09 — per-agent outputDir template (LITERAL string with
   * tokens preserved: {date}, {client_slug}, {channel_name}, {agent}).
   * UNDEFINED when the agent does not override defaults.outputDir.
   * Runtime `resolveOutputDir(template, ctx, deps)` expands tokens at
   * write time with fresh per-call ctx.
   */
  readonly outputDir?: string;
  /**
   * Phase 100 GSD-02 — per-agent SDK settingSources. ALWAYS populated by
   * loader.ts (defaults to ["project"]). Plan 02's session-adapter.ts will
   * read this verbatim to replace the hardcoded `settingSources: ["project"]`
   * at lines 592 + 631. The SDK loads ~/.claude/skills/, ~/.claude/commands/,
   * and ~/.claude/CLAUDE.md when 'user' is included; 'project' loads the
   * cwd's local .claude/ tree; 'local' loads .claude/local/ (gitignored).
   * Admin Clawdy sets ["project","user"] for GSD support; production agents
   * stay at ["project"].
   */
  readonly settingSources: readonly ("project" | "user" | "local")[];
  /**
   * Phase 100 GSD-04 — per-agent gsd block. UNDEFINED when agent.gsd.projectDir
   * is unset. Plan 02's session-adapter.ts will read `config.gsd?.projectDir
   * ?? config.workspace` to choose the SDK cwd. expandHome() already applied
   * by the loader (raw `~/...` paths are resolved before reaching this type).
   */
  readonly gsd?: { readonly projectDir: string };
  /**
   * Phase 100 follow-up — dream config propagated via resolveAgentConfig
   * (without this field, daemon's getResolvedDreamConfig sees undefined
   * and silently disables auto-fire). Same root-cause shape as Phase 100
   * settingSources / gsd.projectDir and Phase 96 fileAccess: schema
   * parsed `dream` but resolver dropped it before reaching the daemon.
   *
   * Populated when the agent declares a `dream:` block OR when
   * `defaults.dream` is set (resolver merges agent over defaults).
   * `enabled: false` (the schema default) is preserved verbatim — the
   * daemon's IPC handler checks `dream?.enabled === true`.
   */
  readonly dream?: DreamConfig;
  /**
   * Phase 99 sub-scope N (2026-04-26) — SDK-level deny-list. When set, the
   * LLM physically cannot invoke any tool whose name matches an entry. Used
   * for the subagent recursion guard: SubagentThreadSpawner.spawnInThread
   * injects `["mcp__clawcode__spawn_subagent_thread"]` on the subagent's
   * config so subagents cannot chain further subagents (they inherit the
   * parent's "delegate, don't execute" soul and would otherwise loop).
   * session-config.ts propagates this verbatim into AgentSessionConfig and
   * session-adapter.ts forwards it into the SDK's disallowedTools option.
   * UNDEFINED for the existing 15+ agent fleet — no behavior change.
   */
  readonly disallowedTools?: readonly string[];
  /**
   * Phase 90 MEM-01 — ALWAYS populated by loader.ts from
   * agent.memoryAutoLoad ?? defaults.memoryAutoLoad. Downstream
   * (session-config.ts MEMORY.md injection) reads unconditionally.
   * When false, the MEMORY.md block is omitted from the stable prefix.
   */
  readonly memoryAutoLoad: boolean;
  /**
   * Phase 90 MEM-01 — Optional absolute path override for MEMORY.md.
   * When set (expanded via expandHome in loader.ts), session-config.ts
   * reads from this path instead of `{workspace}/MEMORY.md`. Undefined
   * when the agent did not declare an override — the workspace-relative
   * default path wins.
   */
  readonly memoryAutoLoadPath?: string;
  /**
   * Phase 90 MEM-03 — ALWAYS populated by loader.ts from
   * agent.memoryRetrievalTopK ?? defaults.memoryRetrievalTopK. Consumed
   * by SessionManager.getMemoryRetrieverForAgent to cap the retrieved
   * chunk set per turn.
   */
  readonly memoryRetrievalTopK: number;
  /**
   * Phase 90 MEM-02 — ALWAYS populated by loader.ts from
   * agent.memoryScannerEnabled ?? defaults.memoryScannerEnabled.
   * When false, daemon.ts skips the MemoryScanner construction for
   * this agent (memory/ content is managed externally).
   */
  readonly memoryScannerEnabled: boolean;
  /**
   * Phase 90 MEM-04 — ALWAYS populated by loader.ts from
   * agent.memoryFlushIntervalMs ?? defaults.memoryFlushIntervalMs.
   * Consumed by SessionManager.startAgent when constructing the per-agent
   * MemoryFlushTimer. Milliseconds — default 900_000 (15 minutes) per D-26.
   */
  readonly memoryFlushIntervalMs: number;
  /**
   * Phase 90 MEM-05 — ALWAYS populated by loader.ts from
   * agent.memoryCueEmoji ?? defaults.memoryCueEmoji. Consumed by
   * TurnDispatcher's cue-detection post-turn hook to determine which
   * reaction emoji to post (D-32). Default "✅".
   */
  readonly memoryCueEmoji: string;
  readonly skills: readonly string[];
  readonly soul: string | undefined;
  readonly identity: string | undefined;
  /**
   * Phase 78 CONF-01 — absolute expanded path to a SOUL markdown file.
   * Undefined unless the agent's YAML entry set `soulFile:`. When set,
   * session-config.ts reads this file lazily at session boot and prefers
   * it over `<workspace>/SOUL.md` and the inline `soul` field.
   * Expansion via expandHome() happens in loader.ts — never raw `~/...`.
   */
  readonly soulFile?: string;
  /**
   * Phase 78 CONF-01 — absolute expanded path to an IDENTITY markdown file.
   * Same precedence rules as soulFile; session-config.ts reads lazily.
   */
  readonly identityFile?: string;
  readonly memory: {
    readonly compactionThreshold: number;
    readonly searchTopK: number;
    readonly consolidation: {
      readonly enabled: boolean;
      readonly weeklyThreshold: number;
      readonly monthlyThreshold: number;
      readonly summaryModel?: "sonnet" | "opus" | "haiku";
      readonly schedule: string;
    };
    readonly decay: {
      readonly halfLifeDays: number;
      readonly semanticWeight: number;
      readonly decayWeight: number;
    };
    readonly deduplication: {
      readonly enabled: boolean;
      readonly similarityThreshold: number;
    };
    readonly tiers?: {
      readonly hotAccessThreshold: number;
      readonly hotAccessWindowDays: number;
      readonly hotDemotionDays: number;
      readonly coldRelevanceThreshold: number;
      readonly hotBudget: number;
    };
    /**
     * Phase 67 — conversation persistence knobs. Shape mirrors the resolved
     * `conversationConfigSchema` output from `src/memory/schema.ts`. Kept
     * optional because the raw agent config may omit the block entirely;
     * when present, all five fields are supplied by Zod defaults.
     */
    readonly conversation?: {
      readonly enabled: boolean;
      readonly turnRetentionDays: number;
      /** SESS-02 — last-N session summaries rendered in the conversation brief. */
      readonly resumeSessionCount: number;
      /** SESS-03 — skip auto-injection when gap from last session is under this many hours. */
      readonly resumeGapThresholdHours: number;
      /** Dedicated token budget for the conversation_context section (NOT shared with resume_summary). */
      readonly conversationContextBudget: number;
      /** Phase 68 — RETR-03: half-life (days) for retrieval-time decay weighting over conversation search results. */
      readonly retrievalHalfLifeDays: number;
      /**
       * Gap 3 (memory-persistence-gaps) — how often to write a non-terminating
       * mid-session summary while a session is live. 0 disables the timer;
       * positive values produce one MemoryEntry tagged "mid-session" per
       * interval. Default 15 min.
       */
      readonly flushIntervalMinutes: number;
    };
  };
  readonly heartbeat: {
    readonly enabled: boolean;
    readonly intervalSeconds: number;
    readonly checkTimeoutSeconds: number;
    readonly contextFill: {
      readonly warningThreshold: number;
      readonly criticalThreshold: number;
      readonly zoneThresholds?: {
        readonly yellow: number;
        readonly orange: number;
        readonly red: number;
      };
    };
    /**
     * Phase 100 follow-up — operator-specified per-agent heartbeat cadence
     * (e.g., "50m" for fin-acquisition's context-zone monitor). Populated
     * by loader.ts when the agent declares the extended `heartbeat: {every,
     * model, prompt}` shape; undefined when the agent uses the boolean form.
     * Surfaced verbatim in the capability manifest.
     */
    readonly every?: string;
    /**
     * Phase 100 follow-up — operator-specified model for the per-agent
     * heartbeat prompt. Same population rules as `every`.
     */
    readonly model?: "haiku" | "sonnet" | "opus";
  };
  readonly skillsPath: string;
  readonly schedules: readonly {
    readonly name: string;
    readonly cron: string;
    readonly prompt: string;
    readonly enabled: boolean;
  }[];
  readonly admin: boolean;
  readonly subagentModel: "sonnet" | "opus" | "haiku" | undefined;
  readonly threads: {
    readonly idleTimeoutMinutes: number;
    readonly maxThreadSessions: number;
  };
  readonly webhook?: {
    readonly displayName: string;
    readonly avatarUrl?: string;
    readonly webhookUrl?: string;
  };
  readonly reactions: boolean;
  readonly security?: {
    readonly allowlist: readonly { readonly pattern: string }[];
    /**
     * Phase 74 Plan 02 — per-agent gate against scope='all' bearer keys.
     * When `true`, the OpenAI endpoint returns 403 agent_forbids_multi_agent_key
     * for any scope='all' bearer targeting this agent. Default `false`.
     * Does NOT affect the `openclaw:<slug>` template-driver path.
     */
    readonly denyScopeAll: boolean;
  };
  readonly mcpServers: readonly {
    readonly name: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
    /**
     * Phase 85 TOOL-01 — when true, readiness-gate failure is
     * warn-logged but does NOT block the agent transitioning to
     * `status: running`. Default false = mandatory. Populated by
     * config/loader.ts from mcpServerSchema.
     */
    readonly optional: boolean;
    /**
     * Phase 100 follow-up — operator-curated annotations surfaced in the
     * capability manifest. UNDEFINED for legacy entries without
     * description/accessPattern (back-compat).
     */
    readonly description?: string;
    readonly accessPattern?: "read-only" | "read-write" | "write-only";
  }[];
  readonly acceptsTasks?: Readonly<Record<string, readonly string[]>>;  // Phase 59
  readonly escalationBudget?: {
    readonly daily?: {
      readonly sonnet?: number;
      readonly opus?: number;
    };
    readonly weekly?: {
      readonly sonnet?: number;
      readonly opus?: number;
    };
  };
  readonly contextBudgets?: {
    readonly identity: number;
    readonly hotMemories: number;
    readonly toolDefinitions: number;
    readonly graphContext: number;
  };
  readonly slashCommands: readonly {
    readonly name: string;
    readonly description: string;
    readonly claudeCommand: string;
    readonly options: readonly {
      readonly name: string;
      readonly type: number;
      readonly description: string;
      readonly required: boolean;
    }[];
  }[];
  readonly perf?: {
    readonly traceRetentionDays?: number;
    readonly slos?: readonly {
      readonly segment:
        | "end_to_end"
        | "first_token"
        | "context_assemble"
        | "tool_call";
      readonly metric: "p50" | "p95" | "p99";
      readonly thresholdMs: number;
    }[];
    readonly memoryAssemblyBudgets?: {
      readonly identity?: number;
      readonly soul?: number;
      readonly skills_header?: number;
      readonly hot_tier?: number;
      readonly recent_history?: number;
      readonly per_turn_summary?: number;
      readonly resume_summary?: number;
    };
    readonly lazySkills?: {
      readonly enabled: boolean;
      readonly usageThresholdTurns: number;
      readonly reinflateOnMention: boolean;
    };
    readonly resumeSummaryBudget?: number;
    readonly streaming?: {
      readonly editIntervalMs?: number;
      readonly maxLength?: number;
    };
    /**
     * Phase 55 — per-agent tool dispatch / cache / SLO overrides. Mirrors the
     * Zod `toolsConfigSchema` parse output verbatim. Inline literal shape
     * (no cross-module import) preserves the `src/shared/types.ts` low-dep
     * boundary established in Phase 51 / 53 / 54.
     *
     * `maxConcurrent` + `idempotent` are REQUIRED when `tools` is present
     * (the Zod schema supplies defaults), so consumers can read them without
     * an optional-chain fallback. The whole `tools` block remains optional.
     */
    readonly tools?: {
      readonly maxConcurrent: number;
      readonly idempotent: readonly string[];
      readonly slos?: Readonly<Record<string, {
        readonly thresholdMs: number;
        readonly metric?: "p50" | "p95" | "p99";
      }>>;
    };
  };
};

/**
 * Phase 88 MKT-02 + Phase 90 Plan 04 HUB-01 — resolved marketplace source
 * entry (post-expandHome). Discriminated union covering both legacy
 * filesystem sources and ClawHub registry sources.
 *
 * Legacy branch: `kind: "legacy"` — path already expandHome'd. Mirrors the
 * Phase 88 shape (label optional) and is produced from the raw path-only
 * zod variant of marketplaceSources.
 *
 * ClawHub branch: `kind: "clawhub"` — baseUrl + optional authToken/
 * cacheTtlMs pass through verbatim. `authToken` may be a literal or an
 * `op://` reference; downstream consumers decide whether to resolve it.
 */
export type ResolvedMarketplaceSource =
  | Readonly<{
      kind: "legacy";
      path: string;
      label?: string;
    }>
  | Readonly<{
      kind: "clawhub";
      baseUrl: string;
      authToken?: string;
      cacheTtlMs?: number;
    }>;

export type ResolvedMarketplaceSources = readonly ResolvedMarketplaceSource[];

/**
 * Result of creating or verifying a workspace directory.
 */
export type WorkspaceResult = {
  readonly agentName: string;
  readonly path: string;
  readonly created: boolean;
  readonly filesWritten: readonly string[];
};
