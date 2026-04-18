/**
 * Conversation memory types.
 *
 * Defines the data contracts for persistent conversation sessions and turns.
 * All types are readonly per project immutability convention.
 *
 * Used by ConversationStore (Phase 64 Plan 02) and downstream consumers.
 */

/** Status of a conversation session lifecycle. */
export type SessionStatus = "active" | "ended" | "crashed" | "summarized";

/**
 * A conversation session — one continuous agent interaction.
 *
 * Sessions track aggregate metrics (turn count, token usage) and link
 * to an optional summary memory entry created during consolidation.
 */
export type ConversationSession = {
  readonly id: string;
  readonly agentName: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly turnCount: number;
  readonly totalTokens: number;
  readonly summaryMemoryId: string | null;
  readonly status: SessionStatus;
};

/**
 * A single turn within a conversation session.
 *
 * Includes provenance fields (SEC-01) for tracking Discord origin:
 * channelId, discordUserId, discordMessageId, isTrustedChannel.
 * The origin field captures the TurnOrigin string from Phase 57.
 */
export type ConversationTurn = {
  readonly id: string;
  readonly sessionId: string;
  readonly turnIndex: number;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly tokenCount: number | null;
  readonly channelId: string | null;
  readonly discordUserId: string | null;
  readonly discordMessageId: string | null;
  readonly isTrustedChannel: boolean;
  readonly origin: string | null;
  readonly instructionFlags: string | null;
  readonly createdAt: string;
};

/**
 * Input for recording a new conversation turn.
 *
 * Optional fields default at the store layer: tokenCount to null,
 * provenance fields to null/false, origin to null.
 */
export type RecordTurnInput = {
  readonly sessionId: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly tokenCount?: number;
  readonly channelId?: string;
  readonly discordUserId?: string;
  readonly discordMessageId?: string;
  readonly isTrustedChannel?: boolean;
  readonly origin?: string;
  readonly instructionFlags?: string;
};

// ---------------------------------------------------------------------------
// Phase 68 — RETR-02: full-text search over conversation turns via FTS5
// ---------------------------------------------------------------------------

/**
 * Options for searching conversation turns via FTS5.
 *
 * `limit`/`offset` are enforced by the caller (the orchestrator clamps to
 * `MAX_RESULTS_PER_PAGE = 10`; ConversationStore itself does not clamp).
 * `includeUntrustedChannels` defaults to `false` for SEC-01 hygiene — keeps
 * memory-poisoning vectors from leaking into agent context via search.
 */
export type SearchTurnsOptions = {
  readonly limit: number;
  readonly offset: number;
  readonly includeUntrustedChannels?: boolean;
};

/**
 * A single FTS5 match against `conversation_turns.content`.
 *
 * `bm25Score` is the raw FTS5 BM25 output — lower values mean better matches
 * (FTS5 multiplies BM25 by -1 internally). Downstream consumers (the scoped
 * search orchestrator) convert to a positive relevance in [0, 1].
 */
export type ConversationTurnSearchResult = {
  readonly turnId: string;
  readonly sessionId: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly bm25Score: number;
  readonly createdAt: string;
  readonly channelId: string | null;
  readonly isTrustedChannel: boolean;
};

/**
 * Pagination envelope returned by `ConversationStore.searchTurns`.
 *
 * `totalMatches` counts every match across the full FTS5 index (not just the
 * returned page) so callers can derive `hasMore` without a second query.
 */
export type SearchTurnsResult = {
  readonly results: readonly ConversationTurnSearchResult[];
  readonly totalMatches: number;
};
