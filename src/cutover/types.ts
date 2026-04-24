/**
 * Phase 92 Plan 01 — Cutover-pipeline types.
 *
 * Schemas + discriminated unions consumed by:
 *   - src/cutover/discord-ingestor.ts (this plan)
 *   - src/cutover/source-profiler.ts (this plan)
 *   - Plans 92-02 / 92-05 / 92-06 (downstream consumers via the AgentProfile
 *     7-key contract + the IngestOutcome / ProfileOutcome unions)
 *
 * Source-of-truth references:
 *   - 92-CONTEXT.md D-01 (Discord message store as authoritative corpus)
 *   - 92-CONTEXT.md D-02 (single-LLM-pass profiler with 7-key output)
 *   - 92-CONTEXT.md "Claude's Discretion" (PROFILER_CHUNK_THRESHOLD_MSGS = 50000)
 *
 * Invariants pinned for static-grep regression:
 *   - PROFILER_CHUNK_THRESHOLD_MSGS = 50000 stays a top-level export
 *   - agentProfileSchema enumerates EXACTLY the 7 contract keys
 *   - The 4 IngestOutcome kinds + 4 ProfileOutcome kinds form a closed union
 */

import { z } from "zod/v4";

/**
 * Chunking threshold (D-Claude's-Discretion).
 *
 * When a Discord history JSONL exceeds this many entries, the profiler
 * splits the corpus into ≤30-day windows and runs one TurnDispatcher
 * pass per window. Pinned in source as an exported constant for both
 * grep-regression and cross-plan reference.
 */
export const PROFILER_CHUNK_THRESHOLD_MSGS = 50000;

/** One {intent, count} row for the profiler's topIntents[] output. */
export const topIntentSchema = z.object({
  intent: z.string().min(1),
  count: z.number().int().nonnegative(),
});

/** Inferred TopIntent type. */
export type TopIntent = z.infer<typeof topIntentSchema>;

/**
 * The canonical AgentProfile shape (D-02). Exactly 7 keys, no extras.
 * Downstream:
 *   - Plan 92-02 diff engine reads tools/skills/mcpServers/memoryRefs/
 *     models/uploads to compute CutoverGap rows
 *   - Plan 92-05 canary synthesizer reads topIntents[] for prompt batteries
 */
export const agentProfileSchema = z.object({
  tools: z.array(z.string()),
  skills: z.array(z.string()),
  mcpServers: z.array(z.string()),
  memoryRefs: z.array(z.string()),
  models: z.array(z.string()),
  uploads: z.array(z.string()),
  topIntents: z.array(topIntentSchema),
});

export type AgentProfile = z.infer<typeof agentProfileSchema>;

/**
 * One Discord message after JSONL flattening. Mirrors the
 * plugin:discord:fetch_messages payload — narrowed to the fields the
 * profiler actually consumes.
 */
export const discordHistoryEntrySchema = z.object({
  message_id: z.string().min(1),
  channel_id: z.string().min(1),
  author_id: z.string().min(1),
  author_name: z.string().optional(),
  ts: z.string(), // ISO 8601 — sort + 30-day chunking key
  content: z.string(),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().optional(),
        type: z.string().optional(),
        size: z.number().optional(),
      }),
    )
    .default([]),
  is_bot: z.boolean().default(false),
});

export type DiscordHistoryEntry = z.infer<typeof discordHistoryEntrySchema>;

/**
 * Outcome of a single ingest cycle. Discriminated by `kind`. Downstream
 * (Plan 92-06 report writer + the CLI exit-code branch in
 * cutover-ingest.ts) does an exhaustive switch on this.
 */
export type IngestOutcome =
  | {
      kind: "ingested";
      agent: string;
      channelsProcessed: number;
      newMessages: number;
      totalMessages: number;
      durationMs: number;
      jsonlPath: string;
    }
  | {
      kind: "no-changes";
      agent: string;
      totalMessages: number;
      durationMs: number;
      jsonlPath: string;
    }
  | {
      kind: "discord-fetch-failed";
      agent: string;
      channelId: string;
      error: string;
      durationMs: number;
    }
  | {
      kind: "no-channels";
      agent: string;
    };

/**
 * Outcome of a single profile cycle. Same exhaustive-switch contract
 * as IngestOutcome.
 */
export type ProfileOutcome =
  | {
      kind: "profiled";
      agent: string;
      chunksProcessed: number;
      messagesProcessed: number;
      profilePath: string;
      durationMs: number;
    }
  | {
      kind: "no-history";
      agent: string;
      jsonlPath: string;
    }
  | {
      kind: "dispatcher-failed";
      agent: string;
      error: string;
      durationMs: number;
    }
  | {
      kind: "schema-validation-failed";
      agent: string;
      error: string;
      rawResponse: string;
    };

/**
 * Phase 92 Plan 01 — Composite "AgentProfilerOutcome" alias for the plan
 * frontmatter's artifact spec. Most call-sites can use ProfileOutcome
 * directly; this alias exists so cross-plan references in 92-02..06 can
 * import a single name when they want the union.
 */
export type AgentProfilerOutcome = ProfileOutcome;
