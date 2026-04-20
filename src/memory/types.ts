/**
 * Memory module types.
 * All types are readonly per project immutability convention.
 */

/** Valid sources for memory entries. */
export type MemorySource = "conversation" | "manual" | "system" | "consolidation" | "episode";

/** Input for recording a discrete episode event as memory. */
export type EpisodeInput = {
  readonly title: string;
  readonly summary: string;
  readonly importance?: number;
  readonly tags?: readonly string[];
  readonly occurredAt?: string; // ISO 8601, defaults to now
};

/** Memory storage tier. */
export type MemoryTier = "hot" | "warm" | "cold";

/** A stored memory entry with full metadata. */
export type MemoryEntry = {
  readonly id: string;
  readonly content: string;
  readonly source: MemorySource;
  readonly importance: number;
  readonly accessCount: number;
  readonly tags: readonly string[];
  readonly embedding: Float32Array | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly accessedAt: string;
  readonly tier: MemoryTier;
  /** Conversation turn IDs this memory was derived from (CONV-03 lineage). Null for non-conversation memories. */
  readonly sourceTurnIds: readonly string[] | null;
};

/** Input for creating a new memory entry. */
export type CreateMemoryInput = {
  readonly content: string;
  readonly source: MemorySource;
  readonly importance?: number;
  readonly tags?: readonly string[];
  readonly skipDedup?: boolean;
  /** Conversation turn IDs this memory was derived from (CONV-03 lineage). Omit for non-conversation memories. */
  readonly sourceTurnIds?: readonly string[];
  /**
   * Phase 80 MEM-02 — stable per-source-path identifier used to de-duplicate
   * imports across re-runs. Format: "openclaw:<agent>:<sha256-of-relpath>"
   * (path-only hash — content changes don't create duplicates). When
   * provided, insert() uses INSERT OR IGNORE semantics and returns the
   * existing row on collision. Dedup (content-similarity merging) is
   * SKIPPED on the origin_id path — idempotency is the contract.
   */
  readonly origin_id?: string;
};

/** A search result extends MemoryEntry with distance score. */
export type SearchResult = MemoryEntry & {
  readonly distance: number;
};

/** A session log entry tracking a daily markdown file. */
export type SessionLogEntry = {
  readonly id: string;
  readonly date: string;
  readonly filePath: string;
  readonly entryCount: number;
  readonly createdAt: string;
};

/** Embedding vector type alias for clarity. */
export type EmbeddingVector = Float32Array;

/** Re-export RankedSearchResult for consumers. */
export type { RankedSearchResult } from "./relevance.js";
