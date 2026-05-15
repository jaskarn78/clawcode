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
  // Mirrors `effortSchema` in config/schema.ts. Phase note: the schema was
  // extended with `xhigh`, `auto`, and `off` but this resolved-type union
  // had not been widened to match — keep them in sync.
  readonly effort: "low" | "medium" | "high" | "xhigh" | "max" | "auto" | "off";
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
   * Phase 124 Plan 02 D-06 — ALWAYS populated by loader.ts from
   * `agent['auto-compact-at'] ?? defaults['auto-compact-at']` (zod default
   * 0.7). The auto-compaction trigger ratio (0..1) of the context window.
   * Plan 125 consumes this to decide when to fire compaction automatically;
   * Phase 124 only ships the schema + loader resolver + this field so that
   * `clawcode reload` picks up YAML edits without a daemon restart.
   */
  readonly autoCompactAt: number;
  /**
   * Phase 125 Plan 02 — count of trailing turns the verbatim gate ALWAYS
   * preserves during auto-compaction. Populated by loader.ts from
   * `agent.preserveLastTurns ?? defaults.preserveLastTurns ?? 10`. Range
   * 1..100 (zod-validated). Optional at the type level for back-compat
   * with existing ResolvedAgentConfig test factories (consumers default
   * to 10).
   */
  readonly preserveLastTurns?: number;
  /**
   * Phase 125 Plan 02 (SC-8) — per-agent verbatim regex patterns. The
   * loader compiles each pattern string once via `new RegExp(p)`; invalid
   * patterns reject at config-resolve time (loader throws). UNDEFINED
   * when neither agent nor defaults provide entries — daemon treats this
   * as the empty pattern set.
   */
  readonly preserveVerbatimPatterns?: readonly RegExp[];
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
   * Phase 127 — stream-stall supervisor threshold (ms). Populated by
   * loader.ts via cascade:
   *   agent.streamStallTimeoutMs ??
   *   defaults.modelOverrides?.[resolved.model]?.streamStallTimeoutMs ??
   *   defaults.streamStallTimeoutMs (180000 baseline).
   * Consumed by the SDK iteration loop (persistent-session-handle.ts
   * production path + wrapSdkQuery test path) — the per-turn stall checker
   * compares Date.now() - lastUsefulTokenAt against this value, aborting
   * the in-flight turn on trip. Reloadable: the checker re-reads on each
   * setInterval tick so a yaml edit applies within
   * Math.min(threshold/4, 30000)ms without daemon restart.
   *
   * Optional at the type level for back-compat with the ~25 existing
   * ResolvedAgentConfig test factories (same precedent as
   * `memoryRetrievalTokenBudget?: number` above). Production loader.ts
   * always populates it; consumers default to 180000ms when undefined.
   */
  readonly streamStallTimeoutMs?: number;
  /**
   * Phase 115 sub-scope 3 — populated by loader.ts from
   * agent.memoryRetrievalTokenBudget ?? defaults.memoryRetrievalTokenBudget.
   * Range 500-8000 (zod-validated). Consumed by
   * SessionManager.getMemoryRetrieverForAgent and forwarded to
   * retrieveMemoryChunks as the per-turn <memory-context> token cap.
   * Down from the pre-115 hardcoded 2000 default; the zod knob existed
   * in defaultsSchema since Phase 90 MEM-03 but was never wired through —
   * Phase 115 Plan 01 lit it up. Optional at the type level so existing
   * ResolvedAgentConfig test factories don't need updates; consumers
   * default to 1500 (matches defaults.memoryRetrievalTokenBudget).
   */
  readonly memoryRetrievalTokenBudget?: number;
  /**
   * Phase 115 sub-scope 4 — populated by loader.ts from
   * agent.memoryRetrievalExcludeTags ?? defaults.memoryRetrievalExcludeTags.
   * Tag list whose memories are excluded from the per-turn <memory-context>
   * block at hybrid-RRF retrieval. Locked default
   * ["session-summary","mid-session","raw-fallback"] removes pollution-
   * feedback memories that pre-115 leaked into the prompt as giant blobs
   * (research codebase-memory-retrieval.md Pain Points #3 + #15). Empty
   * array disables filtering. Consumed by
   * SessionManager.getMemoryRetrieverForAgent and forwarded to
   * retrieveMemoryChunks as `excludeTags`. Optional at the type level for
   * back-compat with existing ResolvedAgentConfig factory test code;
   * consumers default to the locked Phase 115 list.
   */
  readonly memoryRetrievalExcludeTags?: readonly string[];
  /**
   * Phase 115 sub-scope 2 — populated by loader.ts from
   * agent.excludeDynamicSections ?? defaults.excludeDynamicSections (zod
   * default true). When true, the SDK strips per-machine dynamic sections
   * (cwd, auto-memory paths, git status) from the cached system prompt and
   * re-injects them as the first user message — improves cross-agent
   * prompt-cache reuse. Consumed by session-config.ts's buildSessionConfig
   * to thread into AgentSessionConfig and on into the SDK options.
   * Reload classification: NEXT-SESSION only. Optional at the type level
   * for back-compat with ~20 existing ResolvedAgentConfig test factories;
   * consumers default to true (matches defaults.excludeDynamicSections).
   */
  readonly excludeDynamicSections?: boolean;
  /**
   * Phase 115 sub-scope 5 (Plan 04) — populated by loader.ts from
   * agent.cacheBreakpointPlacement ?? defaults.cacheBreakpointPlacement
   * (zod default "static-first"). Controls the assembled stable-prefix
   * section ordering: "static-first" (default) places static sections
   * (identity, soul, skills, tools, fs-capability, delegates) BEFORE the
   * CACHE_BREAKPOINT_MARKER and dynamic sections (hot memories, graph
   * context) AFTER, recovering prompt-cache hit rate on turns where only
   * dynamic content changed; "legacy" keeps the pre-115-04 interleaved
   * order with no marker. Consumed by session-config.ts to pass into
   * `assembleContext` via AssembleOptions.cacheBreakpointPlacement. Reload
   * classification: NEXT-SESSION only — placement is baked into the
   * assembled stable prefix at session create/resume. Optional at the
   * type level for back-compat with existing ResolvedAgentConfig test
   * factories; consumers default to "static-first".
   */
  readonly cacheBreakpointPlacement?: "static-first" | "legacy";
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
  /**
   * Phase 100 follow-up — ALWAYS populated by loader.ts from
   * agent.autoStart ?? defaults.autoStart (both default-bearing in zod, so
   * the resolved value is always a concrete boolean). Consumed by the
   * daemon's auto-start IIFE (src/manager/daemon.ts) to filter the array
   * passed to manager.startAll on boot — autoStart=false agents are NOT
   * spawned on the daemon's start-all loop, but their config remains in
   * the routeMethod `configs` array so the operator can manually start
   * them via `clawcode start <name>` (the IPC handler does
   * `configs.find((c) => c.name === name)`, NOT a `getAgentConfig` lookup,
   * so dormant agents are findable on demand).
   */
  readonly autoStart: boolean;
  /**
   * Phase 999.25 — boot-time wake-order priority. Lower numbers boot first.
   * `undefined` means "boot last in YAML order" (stable sort). Consumed by
   * the daemon's auto-start IIFE which sorts `autoStartAgents` by
   * `(wakeOrder ?? Infinity)` before passing to `manager.startAll`.
   *
   * Pass-through from agent yaml — no defaults.X fallback (defaults has no
   * wakeOrder field; ordering is per-agent or undefined).
   */
  readonly wakeOrder?: number;
  readonly skills: readonly string[];
  /**
   * Phase 999.13 DELEG-02 — per-agent specialty → target-agent map.
   * UNDEFINED when the agent does not declare `delegates:` in yaml
   * (back-compat: existing 15-agent fleet sees no behavior change).
   * When set, session-config.ts renders this via `renderDelegatesBlock`
   * and threads the resulting string into `ContextSources.delegatesBlock`,
   * which the assembler appends to the END of the stable prefix.
   *
   * configSchema.superRefine has already validated that every value
   * points to a configured agent name at config load time — runtime
   * consumers can trust the data.
   */
  readonly delegates?: Readonly<Record<string, string>>;
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
      // Phase 100-fu — backlink-count threshold for centrality-based hot
      // promotion. Mirrored on the zod schema and in DEFAULT_TIER_CONFIG.
      // Was missing from this resolved type, which surfaced as TS2741 at
      // session-memory.ts:88 when passing tierConfig to TierManager.
      readonly centralityPromoteThreshold: number;
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
    /**
     * Phase 999.54 (D-01a) — SDK alwaysLoad passthrough. UNDEFINED for legacy
     * entries that don't set the field; spread-conditional construction at
     * src/config/loader.ts (Plan 02) keeps the field OMITTED from the resolved
     * entry when yaml didn't declare it, preserving byte-stable deep-equality
     * for the existing fleet. Forwarded verbatim through AgentSessionConfig
     * → transformMcpServersForSdk → SDK Options.mcpServers[].alwaysLoad.
     */
    readonly alwaysLoad?: boolean;
  }[];
  /**
   * Phase 100 follow-up — per-agent MCP env override map (vault-scoped
   * service account distribution). UNDEFINED on the existing 15-agent fleet
   * (all inherit the daemon's clawdbot full-fleet token via shared
   * mcpServers[].env). Populated only on agents that explicitly declare
   * `mcpEnvOverrides` in YAML — currently the 5 finmentum agents (fin-
   * acquisition, fin-research, fin-tax, fin-playground, finmentum-content-
   * creator) which scope down to the Finmentum vault SA token.
   *
   * Values are stored VERBATIM here (loader does NOT call op read at
   * config-load time). The daemon resolves op:// URIs at agent-start via
   * `resolveMcpEnvOverrides` (src/manager/op-env-resolver.ts) before the
   * MCP subprocess spawns. Resolved tokens NEVER appear in this type — they
   * land directly in the spawn-time mcpServers[].env passed to the SDK.
   */
  readonly mcpEnvOverrides?: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
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
  // Phase 113 — per-agent Haiku vision pre-pass config.
  readonly vision?: {
    readonly enabled: boolean;
    readonly preserveImage: boolean;
  };
  /**
   * Phase 115 sub-scope 14 — per-agent operator-toggle for the diagnostic
   * baseopts dump. UNDEFINED on the existing fleet (no behavior change). When
   * `dumpBaseOptionsOnSpawn === true`, session-adapter.ts writes a per-agent
   * baseopts dump on every createSession/resumeSession (secrets redacted).
   * Replaces the temporary hardcoded fin-acquisition + Admin Clawdy allowlist
   * deployed during the 2026-05-07 incident response. The schema parses
   * `agents[*].debug` as optional; this resolved type mirrors the optional
   * shape verbatim.
   */
  readonly debug?: {
    readonly dumpBaseOptionsOnSpawn: boolean;
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
