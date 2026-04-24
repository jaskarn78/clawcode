/**
 * Phase 92 Plan 01 — Cutover-pipeline types (D-11 amended).
 *
 * Schemas + discriminated unions consumed by:
 *   - src/cutover/mc-history-ingestor.ts (PRIMARY source per D-11)
 *   - src/cutover/discord-ingestor.ts   (FALLBACK / SECONDARY source per D-11)
 *   - src/cutover/source-profiler.ts    (reads UNION of both staging JSONLs)
 *   - Plans 92-02 / 92-05 / 92-06 (downstream consumers via the AgentProfile
 *     7-key contract + the IngestOutcome / ProfileOutcome unions)
 *
 * Source-of-truth references:
 *   - 92-CONTEXT.md D-01 (SUPERSEDED by D-11)
 *   - 92-CONTEXT.md D-02 (single-LLM-pass profiler with 7-key output)
 *   - 92-CONTEXT.md D-11 (Mission Control REST API as PRIMARY source corpus)
 *   - 92-CONTEXT.md "Claude's Discretion" (PROFILER_CHUNK_THRESHOLD_MSGS = 50000)
 *
 * Invariants pinned for static-grep regression:
 *   - PROFILER_CHUNK_THRESHOLD_MSGS = 50000 stays a top-level export
 *   - MC_DEFAULT_BASE_URL = "http://100.71.14.96:4000" stays a top-level export
 *   - agentProfileSchema enumerates EXACTLY the 7 contract keys
 *   - historyEntrySchema is a discriminatedUnion("origin", [...])
 *   - The IngestOutcome / McIngestOutcome / DiscordIngestOutcome / ProfileOutcome
 *     unions form closed sets exhaustively switched downstream
 */

import { z } from "zod/v4";

/**
 * Chunking threshold (D-Claude's-Discretion).
 *
 * When the union of mc-history.jsonl + discord-history.jsonl exceeds this
 * many entries, the profiler splits the corpus into ≤30-day windows and
 * runs one TurnDispatcher pass per window. Pinned in source as an exported
 * constant for both grep-regression and cross-plan reference.
 */
export const PROFILER_CHUNK_THRESHOLD_MSGS = 50000;

/**
 * D-11 — Mission Control default base URL. Override via env MC_API_BASE
 * or --mc-base CLI flag. Pinned as a top-level export so grep-discoverable.
 */
export const MC_DEFAULT_BASE_URL = "http://100.71.14.96:4000";

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
 *   - Plan 92-05 canary synthesizer reads topIntents[] for prompt batteries.
 *     D-11: cron-clustered intents prefixed `cron:` so Phase 47 cron parity
 *     surfaces in the canary battery distinct from user-initiated intents.
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
 * D-11 — One Mission Control session-history entry, post JSONL flattening.
 *
 * Mirrors the relayed message records that MC's
 * GET /api/openclaw/sessions/{id}/history returns from the OpenClaw gateway,
 * narrowed to the fields the profiler actually consumes.
 *
 * Idempotency key: (sessionId, sequenceIndex). The ingestor maintains a
 * dedup Set populated from the existing JSONL so reruns never duplicate.
 *
 * `kind` is propagated from the parent session and is critical for the
 * profiler's cron-prefix rule — when kind === "cron", the LLM clusters
 * the intent under "cron:<intent-name>" so cutover parity covers cron
 * dispatch as a distinct surface.
 */
export const mcHistoryEntrySchema = z.object({
  origin: z.literal("mc"),
  sessionId: z.string().min(1),
  sequenceIndex: z.number().int().nonnegative(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  model: z.string().optional(),
  ts: z.string(), // ISO 8601
  kind: z.enum(["direct", "cron", "orchestra", "scheduled", "unknown"]),
  label: z.string().optional(),
});
export type McHistoryEntry = z.infer<typeof mcHistoryEntrySchema>;

/**
 * One Discord message after JSONL flattening. Mirrors the
 * plugin:discord:fetch_messages payload — narrowed to the fields the
 * profiler actually consumes. Per D-11, the ingestor injects
 * `origin: "discord"` before validating so the profiler can discriminate
 * when reading the merged corpus.
 */
export const discordHistoryEntrySchema = z.object({
  origin: z.literal("discord"),
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
 * D-11 — discriminated union of history entries from EITHER origin.
 *
 * The profiler reads BOTH staging JSONL files (mc-history.jsonl and
 * discord-history.jsonl), parses each line through this union, and uses
 * the `origin` discriminator to:
 *   - Build per-origin dedup keys: (sessionId, sequenceIndex) for "mc",
 *     (channel_id, message_id) for "discord"
 *   - Render LLM-prompt entries with the right context tags
 *   - Cluster cron intents under the "cron:" prefix when origin==="mc"
 *     and kind==="cron"
 */
export const historyEntrySchema = z.discriminatedUnion("origin", [
  mcHistoryEntrySchema,
  discordHistoryEntrySchema,
]);
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/**
 * D-11 — Outcome of a Mission Control ingest cycle. Discriminated by
 * `kind`. Downstream (Plan 92-06 report writer + the CLI exit-code branch
 * in cutover-ingest.ts) does an exhaustive switch on this.
 *
 * SECURITY: error strings in this outcome MUST NOT contain the bearer
 * token. mc-history-ingestor.ts uses a sanitizeError() helper that strips
 * the token literal before propagation.
 */
export type McIngestOutcome =
  | {
      kind: "ingested";
      agent: string;
      sessionsProcessed: number;
      newEntries: number;
      totalEntries: number;
      durationMs: number;
      jsonlPath: string;
    }
  | {
      kind: "no-changes";
      agent: string;
      totalEntries: number;
      durationMs: number;
      jsonlPath: string;
    }
  | {
      kind: "agent-not-found-in-mc";
      agent: string;
      gatewayAgentId: string;
    }
  | {
      kind: "missing-bearer-token";
      agent: string;
    }
  | {
      kind: "mc-gateway-503";
      agent: string;
      error: string;
      durationMs: number;
    }
  | {
      kind: "mc-fetch-failed";
      agent: string;
      phase: "agents" | "sessions" | "history";
      error: string;
      durationMs: number;
    };

/**
 * Outcome of a single Discord ingest cycle. Same exhaustive-switch
 * contract as McIngestOutcome.
 */
export type DiscordIngestOutcome =
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
 * D-11 — CLI-level combined outcome. The cutover ingest CLI emits one of
 * these to stdout summarizing what happened across both sources.
 */
export type IngestOutcome =
  | {
      kind: "ingested-both";
      agent: string;
      mc: McIngestOutcome;
      discord: DiscordIngestOutcome;
    }
  | {
      kind: "ingested-mc-only";
      agent: string;
      mc: McIngestOutcome;
    }
  | {
      kind: "ingested-discord-only";
      agent: string;
      discord: DiscordIngestOutcome;
    };

/**
 * Outcome of a single profile cycle. Same exhaustive-switch contract
 * as the ingest outcomes.
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
      jsonlPaths: readonly string[];
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
