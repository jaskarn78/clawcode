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
