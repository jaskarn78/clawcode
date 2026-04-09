// Memory module barrel export

export { MemoryStore } from "./store.js";
export { EmbeddingService } from "./embedder.js";
export { SemanticSearch } from "./search.js";
export { SessionLogger } from "./session-log.js";

export type {
  MemoryEntry,
  CreateMemoryInput,
  SearchResult,
  SessionLogEntry,
  MemorySource,
  EmbeddingVector,
} from "./types.js";

export {
  memorySourceSchema,
  createMemoryInputSchema,
  memoryConfigSchema,
  type MemoryConfig,
} from "./schema.js";

export { MemoryError, EmbeddingError } from "./errors.js";
