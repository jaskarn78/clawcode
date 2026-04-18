/**
 * Types for cross-scope conversation search (Phase 68 — RETR-01/02/03).
 *
 * The orchestrator (`searchByScope` in `./conversation-search.ts`) receives
 * all I/O via `ScopedSearchDeps` — pure dependency-injected function makes
 * decay tests deterministic (`now: Date` injection) and keeps the module
 * unit-testable in isolation from the MCP/IPC layers that wire it in
 * (Plan 68-02).
 */

import type { MemoryStore } from "./store.js";
import type { ConversationStore } from "./conversation-store.js";
import type { EmbeddingService } from "./embedder.js";

/** Where to look: memories only (default), conversations only, or both. */
export type ConversationSearchScope = "memories" | "conversations" | "all";

/**
 * A single merged result, discriminated by `origin`.
 *
 * `relevanceScore` is the pre-decay semantic/FTS5 score in [0, 1]. For
 * FTS5 matches we invert BM25's lower-is-better sign via `1 / (1 + |bm25|)`
 * before combining; semantic matches reuse the KNN-derived combinedScore
 * from `SemanticSearch`.
 *
 * `combinedScore = relevanceScore * SEMANTIC_WEIGHT + decayScore * DECAY_WEIGHT`
 * mirrors `relevance.ts:scoreAndRank` (0.7/0.3).
 */
export type ScopedSearchResult = {
  readonly id: string;
  readonly content: string;
  readonly snippet: string;
  readonly origin: "memory" | "session-summary" | "conversation-turn";
  readonly relevanceScore: number;
  readonly combinedScore: number;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly sessionId: string | null;
};

export type ScopedSearchOptions = {
  readonly scope: ConversationSearchScope;
  readonly query: string;
  readonly limit: number;
  readonly offset: number;
  readonly halfLifeDays?: number;
  readonly now?: Date;
};

export type ScopedSearchPage = {
  readonly results: readonly ScopedSearchResult[];
  readonly hasMore: boolean;
  readonly nextOffset: number | null;
  readonly totalCandidates: number;
};

export type ScopedSearchDeps = {
  readonly memoryStore: MemoryStore;
  readonly conversationStore: ConversationStore;
  readonly embedder: EmbeddingService;
};

/** Maximum characters returned in a single result's `snippet` field. */
export const SNIPPET_MAX_CHARS = 500;

/**
 * Hard cap on results per page. Not configurable per 68-CONTEXT.md locked
 * decision — keeps agent-visible response sizes bounded.
 */
export const MAX_RESULTS_PER_PAGE = 10;

/**
 * Default half-life for decay weighting in conversation retrieval.
 *
 * Conversations decay faster than general memories (14 vs. 30 days) because
 * recency is disproportionately valuable for "what did we talk about?"
 * queries. Caller can override via `ScopedSearchOptions.halfLifeDays`.
 */
export const DEFAULT_RETRIEVAL_HALF_LIFE_DAYS = 14;
