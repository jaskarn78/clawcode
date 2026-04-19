import { z } from "zod/v4";
import { memoryConfigSchema } from "../memory/schema.js";

/**
 * Valid Claude model identifiers.
 */
export const modelSchema = z.enum(["sonnet", "opus", "haiku"]);

/**
 * Valid reasoning effort levels for the Claude API.
 * Controls how much thinking the model does per response.
 */
export const effortSchema = z.enum(["low", "medium", "high", "max"]);

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
 */
export const securityConfigSchema = z.object({
  allowlist: z.array(allowlistEntrySchema).default([]),
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
  .default({});

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
  channels: z.array(z.string()).default([]),
  model: modelSchema.optional(),
  skills: z.array(z.string()).default([]),
  soul: z.string().optional(),
  identity: z.string().optional(),
  memory: memorySchema.optional(),
  heartbeat: z.boolean().default(true),
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
  skills: z.array(z.string()).default([]),
  basePath: z.string().default("~/.clawcode/agents"),
  skillsPath: z.string().default("~/.clawcode/skills"),
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
});

/** Fully parsed and validated config. */
export type Config = z.infer<typeof configSchema>;

/** Raw agent entry before defaults merging. */
export type AgentConfig = z.infer<typeof agentSchema>;

/** Top-level defaults section. */
export type DefaultsConfig = z.infer<typeof defaultsSchema>;
