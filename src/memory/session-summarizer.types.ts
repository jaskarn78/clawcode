/**
 * Session-boundary summarizer types.
 *
 * Pure type module — no runtime imports beyond peer types.
 *
 * SESS-01 + SESS-04: compresses a completed conversation session into a
 * standard MemoryEntry tagged as a session summary. Types are injected so
 * the pipeline is testable in isolation (no SDK, no daemon coupling).
 */

import type { ConversationStore } from "./conversation-store.js";
import type { MemoryStore } from "./store.js";
import type { EmbeddingService } from "./embedder.js";
import type { Logger } from "pino";

/**
 * Pluggable LLM call. Production wires this to sdk.query() with Haiku.
 * Tests wire a mock (vi.fn()) that returns canned markdown.
 *
 * The AbortSignal is passed so well-behaved implementations can cancel
 * the underlying HTTP request when the summarizer-level timeout fires.
 */
export type SummarizeFn = (
  prompt: string,
  opts: { readonly signal?: AbortSignal },
) => Promise<string>;

/** Tunable behavior for the summarizer pipeline. */
export type SummarizerConfig = {
  /** Hard timeout for the summarize() call in milliseconds. Default 10_000. */
  readonly timeoutMs?: number;
  /** Minimum turn count required to produce a summary. Default 3. */
  readonly minTurns?: number;
  /** Importance assigned to the resulting MemoryEntry. Default 0.78. */
  readonly importance?: number;
};

/** All dependencies required by the summarizer. Injected for testability. */
export type SummarizeSessionDeps = {
  readonly conversationStore: ConversationStore;
  readonly memoryStore: MemoryStore;
  readonly embedder: EmbeddingService;
  readonly summarize: SummarizeFn;
  readonly log: Logger;
  readonly config?: SummarizerConfig;
};

/** Input to summarizeSession. */
export type SummarizeSessionInput = {
  readonly agentName: string;
  readonly sessionId: string;
};

/**
 * Discriminated union of possible outcomes.
 *
 * `success: true` — a MemoryEntry was written and the session was transitioned
 * to status="summarized" (or attempted to — markSummarized failure is
 * logged but non-fatal).
 *
 * `skipped: true` — no MemoryEntry was written; the reason discriminates why.
 */
export type SummarizeSessionResult =
  | {
      readonly success: true;
      readonly memoryId: string;
      /** True when the LLM call timed out or errored and raw-turn fallback was used. */
      readonly fallback: boolean;
      readonly turnCount: number;
    }
  | {
      readonly skipped: true;
      readonly reason:
        | "already-summarized"
        | "insufficient-turns"
        | "session-not-found"
        | "session-not-terminal";
      readonly turnCount?: number;
    };
