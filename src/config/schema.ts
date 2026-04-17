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
  })),
  mcpServers: z.record(z.string(), mcpServerSchema).default({}),
  agents: z.array(agentSchema).min(1),
});

/** Fully parsed and validated config. */
export type Config = z.infer<typeof configSchema>;

/** Raw agent entry before defaults merging. */
export type AgentConfig = z.infer<typeof agentSchema>;

/** Top-level defaults section. */
export type DefaultsConfig = z.infer<typeof defaultsSchema>;
