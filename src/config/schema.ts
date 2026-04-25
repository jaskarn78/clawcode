import { z } from "zod/v4";
import { memoryConfigSchema } from "../memory/schema.js";

/**
 * Valid Claude model identifiers.
 */
export const modelSchema = z.enum(["sonnet", "opus", "haiku"]);

/**
 * Valid reasoning effort levels for the Claude API.
 * Controls how much thinking the model does per response.
 *
 * Phase 83 EFFORT-04 — extended from the v2.1 set (`low|medium|high|max`) to
 * the v2.2 set by adding:
 *   - `xhigh` → between `high` and `max` (mirrors OpenClaw's xhigh input)
 *   - `auto`  → reset to model default via q.setMaxThinkingTokens(null)
 *   - `off`   → explicit disable via q.setMaxThinkingTokens(0)
 *
 * Extension is additive: v2.1 migrated YAMLs (all 15 agents carry
 * `effort: low`) parse unchanged.
 */
export const effortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "auto",
  "off",
]);
export type EffortLevel = z.infer<typeof effortSchema>;

/**
 * Phase 90 MEM-01 D-17 — 50KB hard cap on MEMORY.md auto-load.
 *
 * ~12.5K tokens — comfortable in Sonnet stable-prefix budget. Larger files
 * are truncated with a marker at injection time (session-config.ts); a
 * future MEM-02 phase chunks the rest into memory_chunks for retrieval.
 *
 * Exported so session-config.ts can enforce the cap without re-defining
 * the constant and to keep the regression-pin grep target stable.
 */
export const MEMORY_AUTOLOAD_MAX_BYTES = 50 * 1024;

/**
 * Canonical latency segment names — mirrored from src/performance/types.ts
 * `CANONICAL_SEGMENTS`. Kept inline (not imported) to avoid a config -> performance
 * dependency cycle and to keep schema parsing self-contained.
 */
const sloSegmentEnum = z.enum([
  "end_to_end",
  "first_token",
  "context_assemble",
  "tool_call",
]);

/**
 * Per-entry SLO override allowed in clawcode.yaml under `perf.slos`.
 * The Zod parse output is consumed by the daemon (Plan 51-03) via the
 * `ResolvedAgentConfig.perf.slos` TS type and merged with `DEFAULT_SLOS`
 * through `mergeSloOverrides` (src/performance/slos.ts).
 */
export const sloOverrideSchema = z.object({
  segment: sloSegmentEnum,
  metric: z.enum(["p50", "p95", "p99"]),
  thresholdMs: z.number().int().positive(),
});

/** Inferred SLO override type. */
export type SloOverrideConfig = z.infer<typeof sloOverrideSchema>;

/**
 * Memory configuration schema for compaction and search settings.
 * Re-exported from the memory module for config-level use.
 */
export const memorySchema = memoryConfigSchema;

/** Inferred memory config type. */
export type MemoryConfig = z.infer<typeof memorySchema>;

/**
 * Phase 94 TOOL-10 / D-10 — system-prompt directive shape.
 *
 * Each directive carries an enabled flag + the verbatim text the LLM sees
 * prepended to its stable prefix. Defaults (DEFAULT_SYSTEM_PROMPT_DIRECTIVES
 * below) ship two entries — file-sharing (D-09) and cross-agent-routing
 * (D-07) — both default-enabled per operator decision.
 *
 * 8th application of the Phase 83/86/89/90/92 additive-optional schema
 * blueprint: legacy v2.5 migrated configs without this field parse
 * unchanged because `defaultsSchema.systemPromptDirectives` is default-
 * bearing and `agentSchema.systemPromptDirectives` is fully optional.
 */
export const systemPromptDirectiveSchema = z.object({
  enabled: z.boolean(),
  text: z.string(),
});

/** Inferred Phase 94 directive type (per-key shape). */
export type SystemPromptDirective = z.infer<typeof systemPromptDirectiveSchema>;

/**
 * Phase 94 D-09 + D-07 — fleet-wide default directives.
 *
 * Verbatim from 94-CONTEXT.md decisions D-09 (file-sharing) and D-07
 * (cross-agent-routing). The directive TEXT is the LLM-facing instruction;
 * subtle wording changes can change LLM behavior in unobvious ways. Pinned
 * by static-grep regression tests:
 *   - "ALWAYS upload via Discord" (D-09 file-sharing)
 *   - "NEVER just tell the user a local file path" (D-09 NEVER clause)
 *   - "suggest the user ask another agent" (D-07 cross-agent-routing)
 *
 * Frozen so downstream code can't mutate the global default record.
 */
export const DEFAULT_SYSTEM_PROMPT_DIRECTIVES: Readonly<
  Record<string, SystemPromptDirective>
> = Object.freeze({
  "file-sharing": Object.freeze({
    enabled: true,
    text: "When you produce a file the user wants to access, ALWAYS upload via Discord (the channel/thread you're answering in) and return the CDN URL. NEVER just tell the user a local file path they can't reach (e.g., '/home/clawcode/...'). If unsure where to send it, ask which channel.",
  }),
  "cross-agent-routing": Object.freeze({
    enabled: true,
    text: "If a user asks you to do something requiring a tool you don't have, check your tool list. If unavailable, suggest the user ask another agent (mention specific channel/agent name) that has the tool ready.",
  }),
});

/**
 * Phase 94 D-10 — per-agent override shape.
 *
 * Both fields optional so an operator can flip just `enabled` on a
 * default directive without re-stating its `text`. The resolver
 * (`resolveSystemPromptDirectives` in loader.ts) merges per-key:
 * fields not specified in the override fall back to the matching
 * default directive's value.
 */
export const systemPromptDirectiveOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  text: z.string().optional(),
});

/**
 * Phase 96 D-05 — 10th additive-optional schema application — fleet-wide
 * default fileAccess paths.
 *
 * The literal `{agent}` token is preserved verbatim in the schema; the
 * loader's `resolveFileAccess(agentName, ...)` helper substitutes the
 * actual agent name at call time. This indirection lets defaults be
 * defined once for the whole fleet while still resolving to per-agent
 * canonical paths at runtime.
 *
 * Pinned by static-grep regression: `grep -q "DEFAULT_FILE_ACCESS"
 * src/config/schema.ts`. Frozen so downstream code cannot mutate the
 * global default array.
 */
export const DEFAULT_FILE_ACCESS: readonly string[] = Object.freeze([
  "/home/clawcode/.clawcode/agents/{agent}/",
]);

/**
 * Phase 95 DREAM-01..03 — Memory dreaming (autonomous reflection) config.
 *
 * 9th application of the Phase 83/86/89/90/94 additive-optional schema
 * blueprint. v2.5/v2.6 migrated configs (no `dream:` block) parse unchanged
 * because:
 *   - `agents.*.dream` is fully optional (`agentSchema.dream.optional()`)
 *   - `defaults.dream` is default-bearing (resolver fills enabled=false /
 *     idleMinutes=30 / model=haiku when omitted)
 *
 * Bounds:
 *   - `idleMinutes` floor 5 = D-01 hard floor (don't dream more often than
 *     5 minutes — burns tokens). Ceiling 360 = D-01 6-hour hard ceiling
 *     bound (the cron-schedule layer respects the same window in 95-02).
 *   - `model` locked to the modelSchema enum (haiku|sonnet|opus). Default
 *     `haiku` per D-03 (cheap; dream passes are frequent + low-stakes).
 *   - `retentionDays` 1..365 — D-05 dream-log archival cadence; default
 *     applied at the consumer (95-02 dream-log writer), NOT here, to keep
 *     this schema shape minimal and the resolver responsibilities clean.
 *
 * Default `enabled: false` is OPT-IN fleet-wide per D-01 — operators flip
 * `agents.<name>.dream.enabled: true` (or `defaults.dream.enabled: true`)
 * to roll the cycle out gradually.
 */
export const dreamConfigSchema = z.object({
  enabled: z.boolean().default(false),
  idleMinutes: z.number().int().min(5).max(360).default(30),
  model: z.enum(["haiku", "sonnet", "opus"]).default("haiku"),
  retentionDays: z.number().int().min(1).max(365).optional(),
});

/** Inferred Phase 95 dream config type. */
export type DreamConfig = z.infer<typeof dreamConfigSchema>;

/**
 * Heartbeat monitoring configuration schema.
 * Controls the periodic health check system for agents.
 */
export const heartbeatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().int().min(10).default(60),
  checkTimeoutSeconds: z.number().int().min(1).default(10),
  contextFill: z.object({
    warningThreshold: z.number().min(0).max(1).default(0.6),
    criticalThreshold: z.number().min(0).max(1).default(0.75),
    zoneThresholds: z.object({
      yellow: z.number().min(0).max(1).default(0.50),
      orange: z.number().min(0).max(1).default(0.70),
      red: z.number().min(0).max(1).default(0.85),
    }).default(() => ({ yellow: 0.50, orange: 0.70, red: 0.85 })),
  }).default(() => ({ warningThreshold: 0.6, criticalThreshold: 0.75, zoneThresholds: { yellow: 0.50, orange: 0.70, red: 0.85 } })),
});

/** Inferred heartbeat config type. */
export type HeartbeatConfig = z.infer<typeof heartbeatConfigSchema>;

/**
 * Schema for a single scheduled task entry.
 * Cron field accepts standard cron expressions or croner's extended format.
 * Validation of the cron expression itself happens at scheduler startup.
 */
export const scheduleEntrySchema = z.object({
  name: z.string().min(1),
  cron: z.string().min(1),
  prompt: z.string().min(1),
  enabled: z.boolean().default(true),
});

/** Inferred schedule entry config type. */
export type ScheduleEntryConfig = z.infer<typeof scheduleEntrySchema>;

/**
 * Schema for a single slash command option.
 * Type field uses Discord's ApplicationCommandOptionType (1-11).
 */
export const slashCommandOptionSchema = z.object({
  name: z.string().min(1),
  type: z.number().int().min(1).max(11),
  description: z.string().min(1),
  required: z.boolean().default(false),
  // Phase 83 UI-01 — optional structured choices for STRING options (type 3).
  // When present, Discord renders a dropdown instead of a free-text input.
  // Capped at 25 entries per Discord API; each name/value must be 1..100 chars.
  // Optional + backward-compatible: pre-existing YAML configs parse unchanged.
  choices: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        value: z.string().min(1).max(100),
      }),
    )
    .max(25)
    .optional(),
});

/**
 * Schema for a single slash command entry.
 * Name must be lowercase alphanumeric with hyphens (Discord requirement).
 */
export const slashCommandEntrySchema = z.object({
  name: z.string().min(1).max(32).regex(/^[\w-]+$/),
  description: z.string().min(1).max(100),
  claudeCommand: z.string().min(1),
  options: z.array(slashCommandOptionSchema).default([]),
});

/** Inferred slash command option type. */
export type SlashCommandOptionConfig = z.infer<typeof slashCommandOptionSchema>;

/** Inferred slash command entry type. */
export type SlashCommandEntryConfig = z.infer<typeof slashCommandEntrySchema>;

/**
 * Webhook identity configuration schema.
 * Allows agents to post to Discord with custom display name and avatar.
 */
export const webhookConfigSchema = z.object({
  displayName: z.string().min(1),
  avatarUrl: z.string().url().optional(),
  webhookUrl: z.string().url().optional(),
});

/** Inferred webhook config type. */
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

/**
 * Thread management configuration schema.
 * Controls idle timeout and max concurrent thread sessions per agent.
 */
export const threadsConfigSchema = z.object({
  idleTimeoutMinutes: z.number().int().min(1).default(1440),
  maxThreadSessions: z.number().int().min(1).default(10),
});

/** Inferred threads config type. */
export type ThreadsConfig = z.infer<typeof threadsConfigSchema>;

/**
 * Schema for a single allowlist entry (glob pattern for command matching).
 */
export const allowlistEntrySchema = z.object({
  pattern: z.string().min(1),
});

/**
 * Security configuration schema for per-agent execution approval.
 *
 * Phase 74 Plan 02 — `denyScopeAll` gates access to this agent from
 * scope='all' (multi-agent) bearer keys. Default `false` preserves
 * back-compat (any scope='all' key can target any configured agent).
 * Set `true` on admin-grade agents (e.g. admin-clawdy) so a compromised
 * OpenClaw-side scope='all' key cannot impersonate them via body.model.
 * The `openclaw:<slug>` template path is ALWAYS exempt from this flag —
 * that branch is a different code path entirely (no admin surface).
 */
export const securityConfigSchema = z.object({
  allowlist: z.array(allowlistEntrySchema).default([]),
  denyScopeAll: z.boolean().default(false),
});

/** Inferred security config type. */
export type SecurityConfig = z.infer<typeof securityConfigSchema>;

/**
 * Schema for an MCP server configuration entry.
 * Defines a server that Claude Code will connect to as an MCP client.
 */
export const mcpServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  // Phase 85 TOOL-01 — when true, this server's readiness handshake
  // failure does NOT block the warm-path gate (agent still transitions
  // to `status: running`). Default false = mandatory (existing behavior
  // for every currently-configured MCP server; v2.1 migrated configs
  // parse unchanged). See src/mcp/readiness.ts.
  optional: z.boolean().default(false),
});

/** Inferred MCP server config type from schema. */
export type McpServerSchemaConfig = z.infer<typeof mcpServerSchema>;

/**
 * Context budget configuration schema.
 * Controls per-source token budgets for the context assembly pipeline.
 * Values represent estimated token counts (chars/4 heuristic).
 */
export const contextBudgetsSchema = z.object({
  identity: z.number().int().positive().default(1000),
  hotMemories: z.number().int().positive().default(3000),
  toolDefinitions: z.number().int().positive().default(2000),
  graphContext: z.number().int().positive().default(2000),
});

/** Inferred context budgets type. */
export type ContextBudgetsConfig = z.infer<typeof contextBudgetsSchema>;

/**
 * Phase 53 — per-section assembly budgets in tokens.
 *
 * Section names are canonical (D-01 from 53-CONTEXT.md) and map 1:1 to
 * the assembler blocks that Wave 2 will emit token counts for. Budgets
 * are optional — unset means "use default" at the consumer. Positive
 * integers only; negative or zero values are rejected.
 */
export const memoryAssemblyBudgetsSchema = z.object({
  identity: z.number().int().positive().optional(),
  soul: z.number().int().positive().optional(),
  skills_header: z.number().int().positive().optional(),
  hot_tier: z.number().int().positive().optional(),
  recent_history: z.number().int().positive().optional(),
  per_turn_summary: z.number().int().positive().optional(),
  resume_summary: z.number().int().positive().optional(),
});

/** Inferred Phase 53 memory-assembly budgets type. */
export type MemoryAssemblyBudgetsConfig = z.infer<
  typeof memoryAssemblyBudgetsSchema
>;

/**
 * Phase 53 — lazy-skill compression configuration.
 *
 * `usageThresholdTurns` has a hard floor of 5 (D-03 from 53-CONTEXT.md) —
 * anything smaller compresses skills too aggressively and defeats the
 * re-inflate cache-warming strategy.
 */
export const lazySkillsSchema = z.object({
  enabled: z.boolean().default(true),
  usageThresholdTurns: z.number().int().min(5).default(20),
  reinflateOnMention: z.boolean().default(true),
});

/** Inferred Phase 53 lazy-skills config type. */
export type LazySkillsConfig = z.infer<typeof lazySkillsSchema>;

/**
 * Phase 53 — session-resume summary hard token budget.
 *
 * Floor of 500 (D-04 from 53-CONTEXT.md) — below that the summary cannot
 * capture enough continuity for a useful session resume. Default 1500
 * applied at the consumer (src/memory/context-summary.ts in Wave 3),
 * NOT in the schema — keeps the Zod parse shape minimal.
 */
export const resumeSummaryBudgetSchema = z.number().int().min(500);

/**
 * Phase 54 — per-agent Discord streaming cadence.
 *
 * `editIntervalMs` has a HARD FLOOR of 300 ms (CONTEXT D-02 — absolute
 * Discord rate-limit safety net below which the 5-edits-per-5-seconds
 * bucket drains faster than it refills). Default 750 ms is applied at
 * the consumer (src/discord/streaming.ts ProgressiveMessageEditor in
 * Plan 54-03), NOT at the Zod layer — keeps the schema shape minimal.
 *
 * `maxLength` floors at 1 and ceilings at 2000 (Discord message
 * character limit). Default 2000 applied at consumer.
 */
export const streamingConfigSchema = z.object({
  editIntervalMs: z.number().int().min(300).optional(),
  maxLength: z.number().int().min(1).max(2000).optional(),
});

/** Inferred Phase 54 streaming config type. */
export type StreamingConfig = z.infer<typeof streamingConfigSchema>;

/**
 * Phase 55 — default whitelist of idempotent ClawCode tools safe for
 * intra-turn caching. LOCKED verbatim per 55-CONTEXT D-02.
 *
 * These four tools are read-only from the agent's perspective: `memory_lookup`,
 * `search_documents`, `memory_list`, `memory_graph`. Repeated calls with
 * identical args within a single turn return identical results, so the intra-
 * turn cache can return the first result safely.
 *
 * Non-idempotent tools (memory_save, spawn_subagent_thread, ingest_document,
 * delete_document, send_message, send_to_agent, send_attachment, ask_advisor)
 * MUST NOT appear here — caching them is a correctness bug. Adding a tool to
 * this list requires a 55-CONTEXT amendment + explicit review.
 */
export const IDEMPOTENT_TOOL_DEFAULTS: readonly string[] = Object.freeze([
  "memory_lookup",
  "search_documents",
  "memory_list",
  "memory_graph",
  // Phase 71 (SEARCH-03) — web search MCP tools. Both are read-only from the
  // agent's perspective: `web_search` issues a GET to Brave/Exa and returns
  // a ranked list, `web_fetch_url` issues a GET for a URL and returns
  // extracted article text. Duplicate calls with identical args within a
  // single Turn are safe to serve from the intra-turn cache (no side
  // effects, deterministic response within the ~second-scale Turn window).
  "web_search",
  "web_fetch_url",
]);

/**
 * Phase 55 — per-tool SLO override for `perf.tools.slos.<tool_name>`.
 *
 * `thresholdMs` is required and must be a positive integer.
 * `metric` is optional — the consumer (`getPerToolSlo` in
 * src/performance/slos.ts) defaults it to `"p95"` when omitted so the common
 * case stays concise in clawcode.yaml.
 */
export const toolSloOverrideSchema = z.object({
  thresholdMs: z.number().int().positive(),
  metric: z.enum(["p50", "p95", "p99"]).optional(),
});

/** Inferred per-tool SLO override type. */
export type ToolSloOverride = z.infer<typeof toolSloOverrideSchema>;

/**
 * Phase 55 — `perf.tools` config. Three surfaces:
 *
 *   1. `maxConcurrent` — soft cap on concurrent tool-dispatch within a single
 *      turn. Default 10 per 55-CONTEXT D-01. Hard floor of 1 (a value of 0
 *      would deadlock the dispatcher).
 *
 *   2. `idempotent` — string[] whitelist of tools safe for intra-turn caching.
 *      Defaults to `IDEMPOTENT_TOOL_DEFAULTS`. Consumers get the full default
 *      whitelist automatically if they omit this field.
 *
 *   3. `slos` — optional `Record<tool_name, { thresholdMs, metric? }>` for
 *      per-tool SLO overrides. Consumed by `getPerToolSlo` which falls back to
 *      the global `tool_call` SLO (1500ms p95 — from DEFAULT_SLOS) when no
 *      override is set for a given tool.
 *
 * Parse output shape:
 *   { maxConcurrent: number; idempotent: string[]; slos?: Record<string, ToolSloOverride> }
 */
export const toolsConfigSchema = z.object({
  maxConcurrent: z.number().int().min(1).default(10),
  idempotent: z
    .array(z.string().min(1))
    .default([...IDEMPOTENT_TOOL_DEFAULTS]),
  slos: z.record(z.string().min(1), toolSloOverrideSchema).optional(),
});

/** Inferred Phase 55 perf.tools config type. */
export type ToolsConfig = z.infer<typeof toolsConfigSchema>;

/**
 * Phase 69 — OpenAI-compatible endpoint config (OPENAI-01..07).
 *
 * Lives under `defaults.openai` in clawcode.yaml. Controls the HTTP listener
 * that exposes `/v1/chat/completions` + `/v1/models` on the daemon process.
 *
 * DO NOT confuse with `mcpServers.openai` (unrelated MCP server entry). The
 * two keys live at different nesting levels and have no interaction.
 *
 * Every field has a default so omitting the entire block still yields a
 * fully-populated runtime config (enabled listener on 0.0.0.0:3101).
 *
 * Bounds rationale:
 *  - `port` 1..65535 — full TCP range; 0 forbidden to avoid OS-picked port.
 *  - `host` non-empty string; default `0.0.0.0` mirrors the dashboard.
 *  - `maxRequestBodyBytes` 1 KiB..100 MiB — sensible OpenAI message sizing.
 *  - `streamKeepaliveMs` 1s..2min — SSE keepalive comment cadence window.
 */
export const openaiEndpointSchema = z
  .object({
    enabled: z.boolean().default(true),
    port: z.number().int().min(1).max(65535).default(3101),
    host: z.string().min(1).default("0.0.0.0"),
    maxRequestBodyBytes: z
      .number()
      .int()
      .min(1024)
      .max(104857600)
      .default(1048576),
    streamKeepaliveMs: z
      .number()
      .int()
      .min(1000)
      .max(120000)
      .default(15000),
  })
  // IMPORTANT: Must use factory-form default returning a fully-populated
  // literal (matching browserConfigSchema / searchConfigSchema / imageConfigSchema
  // pattern). A bare `.default({})` is a TRAP in Zod — when this schema appears
  // as a field in a parent z.object and the parent input omits the field, Zod
  // injects the literal default VALUE without re-running inner `.default()`
  // validators. Result: `{}` with no `enabled` key → `!config.enabled` trips
  // the disabled branch and the endpoint never binds. See
  // .planning/debug/resolved/clawdy-v2-stability.md (2026-04-19) for the full
  // forensic trail and the empirical reproduction.
  .default(() => ({
    enabled: true,
    port: 3101,
    host: "0.0.0.0",
    maxRequestBodyBytes: 1048576,
    streamKeepaliveMs: 15000,
  }));

/** Inferred Phase 69 OpenAI-endpoint config type. */
export type OpenAiEndpointConfig = z.infer<typeof openaiEndpointSchema>;

/**
 * Phase 70 — browser automation config (BROWSER-01..06).
 *
 * Governs the resident Chromium singleton warmed at daemon boot and the
 * per-agent BrowserContext persistence behavior. The auto-injected browser
 * MCP subprocess (clawcode browser-mcp — wired in Plan 02) delegates to the
 * daemon's BrowserManager; this schema shapes the manager's behavior, not
 * the subprocess transport.
 *
 * Architecture: `chromium.launch()` + per-agent
 * `browser.newContext({ storageState })` (70-RESEARCH.md Option 2 — Pitfall 1
 * forbids `launchPersistentContext` because it cannot share a Browser).
 *
 * DO NOT change `headless` to a string — Playwright 1.59 accepts the boolean
 * form and maps `true` to the new-headless mode. The `"new"` string the
 * CONTEXT.md draft mentioned is NOT a valid Playwright 1.59 launch option.
 *
 * Bounds rationale:
 *  - `navigationTimeoutMs` 1s..10min — 10 min hard ceiling prevents runaway
 *    agent behavior pinning a navigation forever.
 *  - `actionTimeoutMs` 100ms..5min — same ceiling philosophy at the
 *    action granularity (click/fill/wait_for).
 *  - `viewport` 320x240..7680x4320 — floor covers low-end phone emulation,
 *    ceiling matches 8K rendering (well above any realistic agent need).
 *  - `maxScreenshotInlineBytes` 0..5 MiB — 0 means "never inline" (always
 *    return path only); 5 MiB is Claude's per-image vision cap
 *    (70-RESEARCH.md Pitfall 7).
 */
export const browserConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    headless: z.boolean().default(true),
    warmOnBoot: z.boolean().default(true),
    navigationTimeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(600000)
      .default(30000),
    actionTimeoutMs: z
      .number()
      .int()
      .min(100)
      .max(300000)
      .default(10000),
    viewport: z
      .object({
        width: z.number().int().min(320).max(7680).default(1280),
        height: z.number().int().min(240).max(4320).default(720),
      })
      .default(() => ({ width: 1280, height: 720 })),
    userAgent: z.string().nullable().default(null),
    maxScreenshotInlineBytes: z
      .number()
      .int()
      .min(0)
      .max(5242880)
      .default(524288),
  })
  .default(() => ({
    enabled: true,
    headless: true,
    warmOnBoot: true,
    navigationTimeoutMs: 30000,
    actionTimeoutMs: 10000,
    viewport: { width: 1280, height: 720 },
    userAgent: null,
    maxScreenshotInlineBytes: 524288,
  }));

/** Inferred Phase 70 browser config type. */
export type BrowserConfig = z.infer<typeof browserConfigSchema>;

/**
 * Phase 71 — web search MCP config (SEARCH-01..03).
 *
 * Lives under `defaults.search` in clawcode.yaml. Governs the auto-injected
 * web-search MCP subprocess (Plan 02 wires the subprocess + CLI + daemon
 * auto-inject); this schema shapes the two pure tool handlers (`web_search`,
 * `web_fetch_url`) built in Plan 01.
 *
 * Architecture: backend union locked at `["brave", "exa"]` per 71-CONTEXT
 * D-01 (no Google CSE / DuckDuckGo / SerpAPI stubs). Provider API keys are
 * read LAZILY at client `search()` call time — missing keys at daemon boot
 * do NOT crash, they surface as structured `invalid_argument` errors on the
 * first call instead.
 *
 * Zero new npm deps: providers use native `fetch`, Readability extraction
 * reuses Phase 70's `@mozilla/readability` + `jsdom` import via
 * `src/search/readability.ts` (thin wrapper — no hoist).
 *
 * Bounds rationale:
 *  - `maxResults` 1..20 — hard cap 20 matches CONTEXT "maxResults: 20"
 *    (agents don't need more; providers charge per result).
 *  - `timeoutMs` 1s..60s — provider request budget; <1s is unreliable,
 *    >60s defeats intra-turn latency budgets.
 *  - `fetch.timeoutMs` 1s..2min — URL fetch has more variance than search
 *    (slow/redirecting sites); 2 min ceiling prevents runaway fetches.
 *  - `fetch.maxBytes` 1..10 MiB — 1 MiB default per CONTEXT, 10 MiB hard
 *    ceiling to keep agents from fetching absurd resource bundles.
 *  - `country` exactly 2 chars — ISO 3166 alpha-2 code validation.
 */
export const searchConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    backend: z.enum(["brave", "exa"]).default("brave"),
    brave: z
      .object({
        apiKeyEnv: z.string().min(1).default("BRAVE_API_KEY"),
        safeSearch: z.enum(["off", "moderate", "strict"]).default("moderate"),
        country: z.string().length(2).default("us"),
      })
      .default(() => ({
        apiKeyEnv: "BRAVE_API_KEY",
        safeSearch: "moderate" as const,
        country: "us",
      })),
    exa: z
      .object({
        apiKeyEnv: z.string().min(1).default("EXA_API_KEY"),
        useAutoprompt: z.boolean().default(false),
      })
      .default(() => ({
        apiKeyEnv: "EXA_API_KEY",
        useAutoprompt: false,
      })),
    maxResults: z.number().int().min(1).max(20).default(20),
    timeoutMs: z.number().int().min(1000).max(60000).default(10000),
    fetch: z
      .object({
        timeoutMs: z.number().int().min(1000).max(120000).default(30000),
        maxBytes: z.number().int().min(1).max(10485760).default(1048576),
        userAgentSuffix: z.string().nullable().default(null),
      })
      .default(() => ({
        timeoutMs: 30000,
        maxBytes: 1048576,
        userAgentSuffix: null,
      })),
  })
  .default(() => ({
    enabled: true,
    backend: "brave" as const,
    brave: {
      apiKeyEnv: "BRAVE_API_KEY",
      safeSearch: "moderate" as const,
      country: "us",
    },
    exa: {
      apiKeyEnv: "EXA_API_KEY",
      useAutoprompt: false,
    },
    maxResults: 20,
    timeoutMs: 10000,
    fetch: {
      timeoutMs: 30000,
      maxBytes: 1048576,
      userAgentSuffix: null,
    },
  }));

/** Inferred Phase 71 search config type. */
export type SearchConfig = z.infer<typeof searchConfigSchema>;

/**
 * Phase 72 — image generation MCP config (IMAGE-01..04).
 *
 * Lives under `defaults.image` in clawcode.yaml. Governs the auto-injected
 * image-generation MCP subprocess (Plan 02 wires the subprocess + CLI +
 * daemon auto-inject); this schema shapes the three pure tool handlers
 * (`image_generate`, `image_edit`, `image_variations`) built in Plan 01.
 *
 * Architecture: backend union locked at `["openai", "minimax", "fal"]`
 * per 72-CONTEXT D-01 (no Stable Diffusion / Midjourney / video stubs).
 * Provider API keys are read LAZILY at client call time — missing keys at
 * daemon boot do NOT crash, they surface as structured `invalid_input`
 * errors on the first call instead.
 *
 * Zero new npm deps: providers use native `fetch` + native `FormData`
 * (Node 22 has both built-in).
 *
 * Bounds rationale:
 *  - `maxImageBytes` 1..10 MiB — 10 MiB ceiling matches the Discord
 *    attachment limit (Nitro-free guilds get 10 MiB) so generated
 *    artifacts can always be delivered via send_attachment.
 *  - `timeoutMs` 1s..5min — image generation has more variance than text
 *    (DALL-E HD can take 30-60s; flux-pro 10-20s); 5 min ceiling is the
 *    backend's own published max-runtime budget.
 *  - `workspaceSubdir` non-empty — defaults to `"generated-images"`;
 *    written to `<agent-workspace>/<workspaceSubdir>/<timestamp>-<id>.png`.
 */
export const imageConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    backend: z.enum(["openai", "minimax", "fal"]).default("openai"),
    openai: z
      .object({
        apiKeyEnv: z.string().min(1).default("OPENAI_API_KEY"),
        model: z.string().min(1).default("gpt-image-1"),
      })
      .default(() => ({
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-image-1",
      })),
    minimax: z
      .object({
        apiKeyEnv: z.string().min(1).default("MINIMAX_API_KEY"),
        model: z.string().min(1).default("image-01"),
      })
      .default(() => ({
        apiKeyEnv: "MINIMAX_API_KEY",
        model: "image-01",
      })),
    fal: z
      .object({
        apiKeyEnv: z.string().min(1).default("FAL_API_KEY"),
        model: z.string().min(1).default("fal-ai/flux-pro"),
      })
      .default(() => ({
        apiKeyEnv: "FAL_API_KEY",
        model: "fal-ai/flux-pro",
      })),
    maxImageBytes: z.number().int().min(1).max(10485760).default(10485760),
    timeoutMs: z.number().int().min(1000).max(300000).default(60000),
    workspaceSubdir: z.string().min(1).default("generated-images"),
  })
  .default(() => ({
    enabled: true,
    backend: "openai" as const,
    openai: { apiKeyEnv: "OPENAI_API_KEY", model: "gpt-image-1" },
    minimax: { apiKeyEnv: "MINIMAX_API_KEY", model: "image-01" },
    fal: { apiKeyEnv: "FAL_API_KEY", model: "fal-ai/flux-pro" },
    maxImageBytes: 10485760,
    timeoutMs: 60000,
    workspaceSubdir: "generated-images",
  }));

/** Inferred Phase 72 image config type. */
export type ImageConfig = z.infer<typeof imageConfigSchema>;

/**
 * Schema for a single agent entry in the config.
 * Channel IDs are strings to prevent YAML numeric coercion (Pitfall 1).
 */
export const agentSchema = z.object({
  name: z.string().min(1),
  workspace: z.string().optional(),
  // Phase 75 SHARED-01 — per-agent override for the directory that owns
  // this agent's private runtime state (memories.db, traces.db, inbox/,
  // heartbeat.log, context-summary files). When unset, loader.ts falls
  // back to `workspace`. Enables multiple agents (e.g., the finmentum family)
  // to share one basePath while keeping memory/inbox/heartbeat isolated.
  // Raw string — expansion via expandHome() happens in loader.ts (Plan 02).
  memoryPath: z.string().min(1).optional(),
  channels: z.array(z.string()).default([]),
  model: modelSchema.optional(),
  // Phase 86 MODEL-01 — per-agent allowlist for /clawcode-model picker.
  // Additive + optional: v2.1 migrated configs (15 agents) parse
  // unchanged; the loader's resolver fills defaults.allowedModels when
  // this is omitted. Each entry must be a valid modelSchema alias —
  // unknown aliases are rejected at parse time. Max 25 enforced
  // downstream (Discord StringSelectMenuBuilder cap in Plan 03).
  allowedModels: z.array(modelSchema).optional(),
  // Phase 89 GREET-07 — per-agent override for restart-greeting emission.
  // Additive + optional: v2.1 migrated configs parse unchanged when omitted;
  // loader resolver fills from defaults.greetOnRestart. Reloadable.
  greetOnRestart: z.boolean().optional(),
  // Phase 89 GREET-10 — per-agent override for in-memory cool-down window (ms).
  // Additive + optional; resolver falls back to defaults.greetCoolDownMs.
  greetCoolDownMs: z.number().int().positive().optional(),
  // Phase 90 MEM-01 — Auto-load workspace MEMORY.md into the v1.7
  // stable prefix at session boot (AFTER IDENTITY, BEFORE MCP status).
  // Additive + optional: v2.1 migrated configs parse unchanged; loader
  // resolver fills from defaults.memoryAutoLoad when omitted. Reloadable
  // per D-18 — next session boot picks up a YAML edit. 50KB hard cap
  // enforced downstream in session-config.ts (MEMORY_AUTOLOAD_MAX_BYTES).
  memoryAutoLoad: z.boolean().optional(),
  // Phase 90 MEM-01 — Override default MEMORY.md path (absolute or ~/...).
  // When unset, session-config.ts reads `{workspace}/MEMORY.md`. Raw
  // string here; expansion via expandHome() happens in loader.ts.
  memoryAutoLoadPath: z.string().min(1).optional(),
  // Phase 90 MEM-03 — per-agent override for the hybrid-RRF top-K. When
  // omitted, resolver falls back to defaults.memoryRetrievalTopK (5 per
  // D-RETRIEVAL). Reloadable (next turn picks up the new value).
  memoryRetrievalTopK: z.number().int().positive().max(50).optional(),
  // Phase 90 MEM-02 — per-agent gate for the chokidar scanner. Default true
  // (via defaults.memoryScannerEnabled). Set to false to skip scanner start
  // for an agent whose memory/ is managed externally.
  memoryScannerEnabled: z.boolean().optional(),
  // Phase 90 MEM-04 — per-agent override for the mid-session flush cadence
  // in milliseconds (D-26). When omitted, resolver falls back to
  // defaults.memoryFlushIntervalMs (15 min). Positive integer only —
  // set defaults to a huge value (e.g. 24h) to effectively disable.
  memoryFlushIntervalMs: z.number().int().positive().optional(),
  // Phase 90 MEM-05 — per-agent override for the ✅ reaction emoji posted
  // on cue-detection (D-32). Short string (1–4 chars so a single unicode
  // glyph or short custom emoji name fits). Fallback via
  // defaults.memoryCueEmoji.
  memoryCueEmoji: z.string().min(1).max(8).optional(),
  // Phase 94 TOOL-10 / D-10 — per-agent override of fleet directives.
  // Additive + optional: v2.5 migrated configs parse unchanged (loader
  // resolver fills from DEFAULT_SYSTEM_PROMPT_DIRECTIVES via
  // defaults.systemPromptDirectives). Per-key partial merge — setting
  // `agents.foo.systemPromptDirectives["file-sharing"].enabled = false`
  // disables that directive for foo only; cross-agent-routing still
  // inherits the default. Reloadable (next-turn boundary).
  systemPromptDirectives: z
    .record(z.string(), systemPromptDirectiveOverrideSchema)
    .optional(),
  // Phase 95 DREAM-01..03 — per-agent autonomous reflection cycle.
  // Additive + optional: v2.5/v2.6 migrated configs parse unchanged when
  // omitted; loader resolver fills from defaults.dream. Per-agent override
  // wins for any field set; partial overrides inherit unset fields from
  // defaults. 9th application of the Phase 83/86/89/90/94 additive-
  // optional schema blueprint.
  dream: dreamConfigSchema.optional(),
  // Phase 96 D-05 — 10th additive-optional schema application; per-agent
  // operator-shared filesystem path candidates verified by runFsProbe at
  // boot + heartbeat tick. Schema preserves literal `{agent}` token; loader
  // resolveFileAccess expands it at call time. Each entry must be a non-
  // empty string; empty array allowed for explicit no-access fleet config.
  // Resolved set merges defaults.fileAccess (default-bearing) + per-agent
  // override (additive). v2.5 migrated configs parse unchanged. Reload
  // classification deferred to Plan 96-07 (config-watcher hot-reload).
  fileAccess: z.array(z.string().min(1)).optional(),
  skills: z.array(z.string()).default([]),
  soul: z.string().optional(),
  identity: z.string().optional(),
  // Phase 78 CONF-01 — file-pointer SOUL/IDENTITY. Mutually exclusive with
  // inline `soul` / `identity` (enforced at configSchema level via
  // superRefine below). Raw string stored here — expansion via
  // expandHome() happens in loader.ts in the same plan. Absolute or
  // `~/...` paths. When set, the daemon reads the file lazily at session
  // boot (see src/manager/session-config.ts precedence chain).
  soulFile: z.string().min(1).optional(),
  identityFile: z.string().min(1).optional(),
  memory: memorySchema.optional(),
  // Phase 90 Plan 07 WIRE-02 — per-agent heartbeat config.
  //
  // Legacy shape: `heartbeat: true|false` — a simple enable/disable flag
  // (behavior pre-Phase-90; `false` disables the heartbeat for this agent,
  // `true` defers to `defaults.heartbeat`).
  //
  // Extended shape: `heartbeat: { every?, model?, prompt? }` — carries an
  // OpenClaw-style per-agent heartbeat prompt + cadence (e.g. the 50-minute
  // context-zone monitor used by fin-acquisition). All fields optional so
  // a partial override is fine; resolver falls back to `defaults.heartbeat`
  // for unset fields.
  //
  // Accepted as a `z.union` so v2.1 migrated configs (all use boolean)
  // parse unchanged.
  heartbeat: z
    .union([
      z.boolean(),
      z.object({
        enabled: z.boolean().optional(),
        every: z.string().min(1).optional(),
        model: modelSchema.optional(),
        prompt: z.string().optional(),
      }),
    ])
    .default(true),
  schedules: z.array(scheduleEntrySchema).default([]),
  admin: z.boolean().default(false),
  subagentModel: modelSchema.optional(),
  effort: effortSchema.default("low"),
  slashCommands: z.array(slashCommandEntrySchema).default([]),
  threads: threadsConfigSchema.optional(),
  webhook: webhookConfigSchema.optional(),
  reactions: z.boolean().default(true),
  security: securityConfigSchema.optional(),
  mcpServers: z.array(z.union([mcpServerSchema, z.string()])).default([]),
  acceptsTasks: z                      // Phase 59 HAND-04
    .record(z.string().min(1), z.array(z.string().min(1)))
    .optional(),
  contextBudgets: contextBudgetsSchema.optional(),
  escalationBudget: z.object({
    daily: z.object({
      sonnet: z.number().int().positive().optional(),
      opus: z.number().int().positive().optional(),
    }).optional(),
    weekly: z.object({
      sonnet: z.number().int().positive().optional(),
      opus: z.number().int().positive().optional(),
    }).optional(),
  }).optional(),
  perf: z
    .object({
      traceRetentionDays: z.number().int().positive().optional(),
      taskRetentionDays: z.number().int().positive().default(7),
      slos: z.array(sloOverrideSchema).optional(),
      memoryAssemblyBudgets: memoryAssemblyBudgetsSchema.optional(),
      lazySkills: lazySkillsSchema.optional(),
      resumeSummaryBudget: resumeSummaryBudgetSchema.optional(),
      streaming: streamingConfigSchema.optional(),
      tools: toolsConfigSchema.optional(),
    })
    .optional(),
});

/**
 * Schema for top-level defaults that agents inherit.
 */
export const defaultsSchema = z.object({
  model: modelSchema.default("haiku"),
  effort: effortSchema.default("low"),
  // Phase 86 MODEL-01 — fleet-wide allowlist default. When an agent
  // omits `allowedModels`, the resolver substitutes this array. The
  // default ["haiku","sonnet","opus"] matches modelSchema's full set
  // so existing agents see no behavior change.
  allowedModels: z
    .array(modelSchema)
    .default(() => ["haiku", "sonnet", "opus"] as ("haiku" | "sonnet" | "opus")[]),
  // Phase 89 GREET-07 — fleet-wide default for restart-greeting emission.
  // Default true per D-09 — every agent greets on restart unless opted out.
  greetOnRestart: z.boolean().default(true),
  // Phase 89 GREET-10 — fleet-wide default for the cool-down window (ms).
  // 300_000 ms = 5 minutes per D-14.
  greetCoolDownMs: z.number().int().positive().default(300_000),
  // Phase 90 MEM-01 — Fleet-wide default: true (every agent auto-loads
  // its workspace MEMORY.md unless explicitly opted out). D-17 + D-18.
  memoryAutoLoad: z.boolean().default(true),
  // Phase 90 MEM-03 — fleet-wide hybrid-RRF retrieval top-K (default 5
  // per D-RETRIEVAL). Reloadable — next turn picks up the new value via
  // the getMemoryRetrieverForAgent closure re-read.
  memoryRetrievalTopK: z.number().int().positive().max(50).default(5),
  // Phase 90 MEM-03 — fleet-wide token budget for retrieved chunks injected
  // into the mutable suffix. 2000 tokens ≈ ~8000 chars; keeps the per-turn
  // payload well under any sane model's context ceiling.
  memoryRetrievalTokenBudget: z.number().int().positive().default(2000),
  // Phase 90 MEM-02 — fleet-wide scanner on/off. Default true — every
  // agent starts a chokidar watcher on its {workspace}/memory/**/*.md.
  memoryScannerEnabled: z.boolean().default(true),
  // Phase 90 MEM-04 — fleet-wide mid-session flush cadence (D-26). Default
  // 15 minutes. Every active session's MemoryFlushTimer fires this often
  // (skip heuristic bails if no meaningful turns since last flush).
  memoryFlushIntervalMs: z.number().int().positive().default(900_000),
  // Phase 90 MEM-05 — fleet-wide default reaction emoji for cue detection
  // (D-32). Standard ✅ — operators can override per-agent or fleet-wide.
  memoryCueEmoji: z.string().min(1).max(8).default("✅"),
  // Phase 94 TOOL-10 / D-10 — fleet-wide default system-prompt directives.
  //
  // Default-bearing: when omitted from clawcode.yaml, the loader resolves
  // to DEFAULT_SYSTEM_PROMPT_DIRECTIVES (D-09 file-sharing + D-07 cross-
  // agent-routing). v2.5 migrated configs parse unchanged (REG-V25-BACKCOMPAT
  // — additive-optional, 8th application of the Phase 83/86/89/90/92
  // schema blueprint).
  //
  // Reloadable — next agent prompt assembly picks up edits without daemon
  // restart (RELOADABLE_FIELDS in src/config/types.ts).
  systemPromptDirectives: z
    .record(z.string(), systemPromptDirectiveSchema)
    .default(() => ({ ...DEFAULT_SYSTEM_PROMPT_DIRECTIVES })),
  // Phase 95 DREAM-01..03 — fleet-wide default dream cycle config.
  // Default-bearing via dreamConfigSchema's own field defaults
  // (enabled:false / idleMinutes:30 / model:haiku). v2.5/v2.6 migrated
  // configs parse unchanged when omitted. Reloadable: a YAML edit takes
  // effect on the NEXT cron tick / NEXT dream-pass invocation; current
  // in-flight dream passes complete at the previous setting.
  dream: dreamConfigSchema.default(() => ({
    enabled: false,
    idleMinutes: 30,
    model: "haiku" as const,
  })),
  // Phase 96 D-05 — 10th additive-optional schema application; fleet-wide
  // default filesystem path candidates. The `{agent}` literal token is
  // preserved here verbatim (NOT expanded at parse time) — loader
  // resolveFileAccess(agentName, ...) substitutes the actual agent name
  // at call time. v2.5/v2.6 migrated configs parse unchanged when omitted.
  // Reload classification deferred to Plan 96-07 (config-watcher hot-reload).
  fileAccess: z
    .array(z.string().min(1))
    .default(() => [...DEFAULT_FILE_ACCESS]),
  skills: z.array(z.string()).default([]),
  basePath: z.string().default("~/.clawcode/agents"),
  skillsPath: z.string().default("~/.clawcode/skills"),
  // Phase 88 MKT-02 — optional list of legacy skill source roots (typically
  // ~/.openclaw/skills) unioned with the local skillsPath into the /clawcode-
  // skills-browse marketplace catalog. Each entry names a filesystem path
  // (expanded via expandHome at resolution time) and an optional human-
  // readable label shown in the Discord picker.
  // Additive + optional: v2.1/v2.2 migrated configs parse unchanged when
  // omitted; Plan 02 resolver emits a concrete [] for downstream catalog
  // loaders. `path.min(1)` rejects empty strings at parse time.
  // Phase 90 Plan 04 HUB-01 — marketplace sources now accepts a union of
  // (legacy path-based) and (ClawHub registry) entries. The legacy branch
  // matches the pre-Phase-90 shape byte-for-byte so v2.1/v2.2 migrated
  // configs parse unchanged (regression pin: clawhub-schema.test.ts
  // HUB-SCH-2a). The ClawHub branch carries a full HTTPS baseUrl,
  // optional authToken (op://... ref or literal), and optional per-source
  // cacheTtlMs override. When cacheTtlMs is absent, the daemon-wide
  // `clawhubCacheTtlMs` default below applies.
  marketplaceSources: z
    .array(
      z.union([
        // Legacy / v2.2 path-based entry — read-only filesystem source
        // (typically ~/.openclaw/skills). Expanded via expandHome in
        // loader.ts.
        z.object({
          path: z.string().min(1),
          label: z.string().optional(),
        }),
        // Phase 90 HUB-01 — ClawHub registry source. baseUrl points at the
        // root (e.g. https://clawhub.ai); the HTTP client appends
        // /api/v1/skills?... paths. authToken can be literal or op://ref;
        // Plan 90-06 adds the interactive GitHub-OAuth flow that populates
        // it. cacheTtlMs overrides the fleet-wide default for this one
        // source (D-05).
        z.object({
          kind: z.literal("clawhub"),
          baseUrl: z.string().url(),
          authToken: z.string().min(1).optional(),
          cacheTtlMs: z.number().int().positive().optional(),
        }),
      ]),
    )
    .optional(),
  // Phase 90 Plan 04 HUB-01 — ClawHub registry base URL used when an
  // agent invokes /clawcode-skills-browse without an explicit
  // marketplaceSources[kind:"clawhub"] entry. Default mirrors the D-01
  // decision (confirmed via probe 2026-04-24).
  clawhubBaseUrl: z.string().url().default("https://clawhub.ai"),
  // Phase 90 Plan 04 HUB-08 — In-memory cache TTL for ClawHub registry
  // responses, keyed by {endpoint, query, cursor}. Default 10 min per
  // D-05. Per-source overrides via marketplaceSources[].cacheTtlMs.
  clawhubCacheTtlMs: z.number().int().positive().default(600_000),
  memory: memorySchema.default(() => ({
    compactionThreshold: 0.75,
    searchTopK: 10,
    consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *" },
    decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 },
    deduplication: { enabled: true, similarityThreshold: 0.85 },
    tiers: { hotAccessThreshold: 3, hotAccessWindowDays: 7, hotDemotionDays: 7, coldRelevanceThreshold: 0.05, hotBudget: 20 },
    episodes: { archivalAgeDays: 90 },
  })),
  heartbeat: heartbeatConfigSchema.default(() => ({
    enabled: true,
    intervalSeconds: 60,
    checkTimeoutSeconds: 10,
    contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75, zoneThresholds: { yellow: 0.50, orange: 0.70, red: 0.85 } },
  })),
  threads: threadsConfigSchema.default(() => ({
    idleTimeoutMinutes: 1440,
    maxThreadSessions: 10,
  })),
  perf: z
    .object({
      traceRetentionDays: z.number().int().positive().optional(),
      taskRetentionDays: z.number().int().positive().default(7),
      slos: z.array(sloOverrideSchema).optional(),
      memoryAssemblyBudgets: memoryAssemblyBudgetsSchema.optional(),
      lazySkills: lazySkillsSchema.optional(),
      resumeSummaryBudget: resumeSummaryBudgetSchema.optional(),
      streaming: streamingConfigSchema.optional(),
      tools: toolsConfigSchema.optional(),
    })
    .optional(),
  // Phase 69: OpenAI-compatible endpoint config. DO NOT confuse with
  // mcpServers.openai (unrelated MCP entry at a different nesting level).
  openai: openaiEndpointSchema,
  // Phase 70: browser automation config (BROWSER-01..06). Governs the
  // resident Chromium singleton + per-agent BrowserContext persistence.
  browser: browserConfigSchema,
  // Phase 71: web search MCP config (SEARCH-01..03). Governs the Brave /
  // Exa provider clients + URL fetcher + Readability adapter. Backend
  // union locked at brave|exa; API keys read lazily at client call time.
  search: searchConfigSchema,
  // Phase 72: image generation MCP config (IMAGE-01..04). Governs the
  // OpenAI / MiniMax / fal.ai provider clients + workspace writer + cost
  // recorder. Backend union locked at openai|minimax|fal; API keys read
  // lazily at client call time. image_generate / edit / variations are
  // NOT idempotent (different images for same prompt) — explicitly
  // excluded from IDEMPOTENT_TOOL_DEFAULTS.
  image: imageConfigSchema,
});

// ---------------------------------------------------------------------------
// Phase 61 — Per-source trigger config schemas
// ---------------------------------------------------------------------------

/**
 * MySQL DB-change polling trigger config (TRIG-02).
 * Polls `SELECT ... WHERE id > ?` on a configurable table with committed-read
 * confirmation to avoid phantom triggers from ROLLBACKed inserts.
 */
export const mysqlTriggerSourceSchema = z.object({
  table: z.string().min(1),
  idColumn: z.string().min(1).default("id"),
  pollIntervalMs: z.number().int().positive().default(30_000),
  targetAgent: z.string().min(1),
  batchSize: z.number().int().positive().default(100),
  filter: z.string().optional(),
});
export type MysqlTriggerSourceConfig = z.infer<typeof mysqlTriggerSourceSchema>;

/**
 * Webhook HTTP trigger config (TRIG-03).
 * Accepts POST to `/webhook/<triggerId>` with HMAC-SHA256 signature verification.
 */
export const webhookTriggerSourceSchema = z.object({
  triggerId: z.string().min(1),
  secret: z.string().min(1),
  targetAgent: z.string().min(1),
  maxBodyBytes: z.number().int().positive().default(65_536),
});
export type WebhookTriggerSourceConfig = z.infer<typeof webhookTriggerSourceSchema>;

/**
 * Inbox filesystem trigger config (TRIG-04).
 * Watches collaboration inbox directory via chokidar with awaitWriteFinish.
 */
export const inboxTriggerSourceSchema = z.object({
  targetAgent: z.string().min(1),
  stabilityThresholdMs: z.number().int().min(0).default(500),
});
export type InboxTriggerSourceConfig = z.infer<typeof inboxTriggerSourceSchema>;

/**
 * Google Calendar polling trigger config (TRIG-05).
 * Polls upcoming events via MCP server and fires at configurable offsets.
 */
export const calendarTriggerSourceSchema = z.object({
  user: z.string().min(1),
  targetAgent: z.string().min(1),
  calendarId: z.string().min(1).default("primary"),
  pollIntervalMs: z.number().int().positive().default(300_000),
  offsetMs: z.number().int().min(0).default(900_000),
  maxResults: z.number().int().min(1).max(100).default(50),
  mcpServer: z.string().min(1),
  eventRetentionDays: z.number().int().positive().default(7),
});
export type CalendarTriggerSourceConfig = z.infer<typeof calendarTriggerSourceSchema>;

/**
 * Aggregate trigger sources config — optional object with arrays for each
 * source type. Each array defaults to empty (source type disabled).
 */
export const triggerSourcesConfigSchema = z.object({
  mysql: z.array(mysqlTriggerSourceSchema).default([]),
  webhook: z.array(webhookTriggerSourceSchema).default([]),
  inbox: z.array(inboxTriggerSourceSchema).default([]),
  calendar: z.array(calendarTriggerSourceSchema).default([]),
}).optional();
export type TriggerSourcesConfig = z.infer<typeof triggerSourcesConfigSchema>;

/**
 * Phase 60 — trigger engine configuration section.
 *
 * Lives at root level in clawcode.yaml under `triggers`. Optional — when
 * omitted, TriggerEngine uses the defaults from types.ts
 * (DEFAULT_REPLAY_MAX_AGE_MS, DEFAULT_DEBOUNCE_MS).
 *
 * Phase 61 extends this with an optional `sources` sub-object containing
 * per-source-type config arrays.
 */
export const triggersConfigSchema = z.object({
  replayMaxAgeMs: z.number().int().positive().default(86400000),
  defaultDebounceMs: z.number().int().min(0).default(5000),
  sources: triggerSourcesConfigSchema,
}).optional();

/** Inferred triggers config type. */
export type TriggersConfig = z.infer<typeof triggersConfigSchema>;

/**
 * Schema for optional Discord configuration.
 * botToken can be a literal token or an op:// reference resolved via 1Password CLI.
 */
export const discordConfigSchema = z.object({
  botToken: z.string().min(1).optional(),
}).optional();

/** Discord config type. */
export type DiscordConfig = z.infer<typeof discordConfigSchema>;

/**
 * Root config schema for clawcode.yaml.
 * Requires version: 1 and at least one agent.
 */
export const configSchema = z.object({
  version: z.literal(1),
  discord: discordConfigSchema,
  defaults: defaultsSchema.default(() => ({
    model: "haiku" as const,
    effort: "low" as const,
    // Phase 86 MODEL-01 — fleet-wide allowlist default matches the full
    // modelSchema enum so configs that omit `defaults` see identical
    // behavior to v2.1 (all three model aliases pickable).
    allowedModels: ["haiku", "sonnet", "opus"] as ("haiku" | "sonnet" | "opus")[],
    // Phase 89 GREET-07 / GREET-10 — fleet-wide defaults mirroring the
    // zod-populated values in defaultsSchema above.
    greetOnRestart: true,
    greetCoolDownMs: 300_000,
    // Phase 90 MEM-01 — fleet-wide default mirrors the zod-populated value.
    memoryAutoLoad: true,
    // Phase 90 MEM-02 / MEM-03 — fleet-wide defaults mirror the zod-populated
    // values in defaultsSchema above. Scanner on by default; retrieval
    // topK=5 + token budget 2000 per D-RETRIEVAL.
    memoryRetrievalTopK: 5,
    memoryRetrievalTokenBudget: 2000,
    memoryScannerEnabled: true,
    // Phase 90 MEM-04 / MEM-05 — fleet-wide defaults mirror defaultsSchema.
    memoryFlushIntervalMs: 900_000,
    memoryCueEmoji: "✅",
    // Phase 94 TOOL-10 / D-10 — fleet-wide default directives mirror
    // DEFAULT_SYSTEM_PROMPT_DIRECTIVES (D-09 file-sharing + D-07 cross-
    // agent-routing). Spread to a fresh object so the configSchema-default
    // record is independent of the frozen exported constant (defensive
    // copy — downstream merges via resolveSystemPromptDirectives never
    // see the frozen reference).
    systemPromptDirectives: { ...DEFAULT_SYSTEM_PROMPT_DIRECTIVES },
    // Phase 95 DREAM-01..03 — fleet-wide default dream cycle config
    // mirrors the zod-populated value in defaultsSchema above.
    dream: { enabled: false, idleMinutes: 30, model: "haiku" as const },
    // Phase 90 Plan 04 HUB-01 / HUB-08 — ClawHub registry defaults
    // mirroring the zod-populated values in defaultsSchema above.
    clawhubBaseUrl: "https://clawhub.ai",
    clawhubCacheTtlMs: 600_000,
    skills: [] as string[],
    basePath: "~/.clawcode/agents",
    skillsPath: "~/.clawcode/skills",
    memory: { compactionThreshold: 0.75, searchTopK: 10, consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *" }, decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 }, deduplication: { enabled: true, similarityThreshold: 0.85 }, tiers: { hotAccessThreshold: 3, hotAccessWindowDays: 7, hotDemotionDays: 7, coldRelevanceThreshold: 0.05, hotBudget: 20 }, episodes: { archivalAgeDays: 90 } },
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75, zoneThresholds: { yellow: 0.50, orange: 0.70, red: 0.85 } },
    },
    threads: {
      idleTimeoutMinutes: 1440,
      maxThreadSessions: 10,
    },
    // Phase 69 — OpenAI-compatible endpoint defaults (OPENAI-01..07).
    openai: {
      enabled: true,
      port: 3101,
      host: "0.0.0.0",
      maxRequestBodyBytes: 1048576,
      streamKeepaliveMs: 15000,
    },
    // Phase 70 — browser automation defaults (BROWSER-01..06).
    browser: {
      enabled: true,
      headless: true,
      warmOnBoot: true,
      navigationTimeoutMs: 30000,
      actionTimeoutMs: 10000,
      viewport: { width: 1280, height: 720 },
      userAgent: null,
      maxScreenshotInlineBytes: 524288,
    },
    // Phase 71 — web search MCP defaults (SEARCH-01..03).
    search: {
      enabled: true,
      backend: "brave" as const,
      brave: {
        apiKeyEnv: "BRAVE_API_KEY",
        safeSearch: "moderate" as const,
        country: "us",
      },
      exa: {
        apiKeyEnv: "EXA_API_KEY",
        useAutoprompt: false,
      },
      maxResults: 20,
      timeoutMs: 10000,
      fetch: {
        timeoutMs: 30000,
        maxBytes: 1048576,
        userAgentSuffix: null,
      },
    },
    // Phase 72 — image generation MCP defaults (IMAGE-01..04).
    image: {
      enabled: true,
      backend: "openai" as const,
      openai: { apiKeyEnv: "OPENAI_API_KEY", model: "gpt-image-1" },
      minimax: { apiKeyEnv: "MINIMAX_API_KEY", model: "image-01" },
      fal: { apiKeyEnv: "FAL_API_KEY", model: "fal-ai/flux-pro" },
      maxImageBytes: 10485760,
      timeoutMs: 60000,
      workspaceSubdir: "generated-images",
    },
  })),
  mcpServers: z.record(z.string(), mcpServerSchema).default({}),
  triggers: triggersConfigSchema,
  agents: z.array(agentSchema).min(1),
}).superRefine((cfg, ctx) => {
  // Phase 75 SHARED-01 — detect two agents declaring the SAME memoryPath.
  // Raw-string comparison is sufficient at this layer: loader.ts handles
  // expansion + path resolution; identical user-facing YAML values are
  // guaranteed to collide post-expansion. Path-normalization edge cases
  // (trailing slash, ./ prefixes) are explicitly out of scope per the
  // deferred section of 75-CONTEXT.md and are handled downstream.
  const byPath = new Map<string, string[]>();
  for (const agent of cfg.agents) {
    if (!agent.memoryPath) continue;
    const list = byPath.get(agent.memoryPath) ?? [];
    list.push(agent.name);
    byPath.set(agent.memoryPath, list);
  }
  for (const [path, names] of byPath) {
    if (names.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents"],
        message: `memoryPath conflict: "${path}" is declared by multiple agents (${names.join(", ")}). Each agent must have a distinct memoryPath or omit it to fall back to workspace.`,
      });
    }
  }

  // Phase 78 CONF-01 — mutual exclusion: inline `soul`/`identity` cannot
  // coexist with file-pointer `soulFile`/`identityFile` on the same agent.
  // Ambiguous precedence would silently prefer one over the other; we fail
  // loud at load time instead. Per-agent scope (cross-agent mix is fine).
  for (const agent of cfg.agents) {
    if (agent.soul !== undefined && agent.soulFile !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents"],
        message: `agent "${agent.name}": inline "soul" and "soulFile" cannot be used together — pick one (soulFile is preferred for migrated agents).`,
      });
    }
    if (agent.identity !== undefined && agent.identityFile !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents"],
        message: `agent "${agent.name}": inline "identity" and "identityFile" cannot be used together — pick one (identityFile is preferred for migrated agents).`,
      });
    }
  }
});

/** Fully parsed and validated config. */
export type Config = z.infer<typeof configSchema>;

/** Raw agent entry before defaults merging. */
export type AgentConfig = z.infer<typeof agentSchema>;

/** Top-level defaults section. */
export type DefaultsConfig = z.infer<typeof defaultsSchema>;

/**
 * Phase 88 MKT-02 — one raw marketplace source entry as it appears in
 * clawcode.yaml `defaults.marketplaceSources`. `path` is the yaml-native
 * string (possibly `~/...`); expansion happens in loader.ts via
 * `resolveMarketplaceSources`. `label` is the optional human-readable
 * caption shown in the Discord picker.
 */
export type MarketplaceSourceConfig = NonNullable<
  DefaultsConfig["marketplaceSources"]
>[number];
