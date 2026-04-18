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
