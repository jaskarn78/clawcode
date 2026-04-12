/**
 * Document module types.
 * All types are readonly per project immutability convention.
 */

/** A single chunk of a document stored with its embedding. */
export type DocumentChunk = {
  readonly id: string;
  readonly source: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly startChar: number;
  readonly endChar: number;
  readonly createdAt: string;
};

/** Result of ingesting a document into the store. */
export type IngestResult = {
  readonly source: string;
  readonly chunksCreated: number;
  readonly totalChars: number;
};

/** A search result from the document store with similarity and context. */
export type DocumentSearchResult = {
  readonly chunkId: string;
  readonly source: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly similarity: number;
  readonly contextBefore: string | null;
  readonly contextAfter: string | null;
};
