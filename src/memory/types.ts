/**
 * Memory module types.
 * All types are readonly per project immutability convention.
 */

/** Valid sources for memory entries. */
export type MemorySource = "conversation" | "manual" | "system" | "consolidation";

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
};

/** Input for creating a new memory entry. */
export type CreateMemoryInput = {
  readonly content: string;
  readonly source: MemorySource;
  readonly importance?: number;
  readonly tags?: readonly string[];
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
