import { z } from "zod/v4";

/** Valid memory source values. */
export const memorySourceSchema = z.enum(["conversation", "manual", "system"]);

/** Schema for creating a new memory entry. */
export const createMemoryInputSchema = z.object({
  content: z.string().min(1),
  source: memorySourceSchema,
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).optional(),
});

/** Schema for memory system configuration. */
export const memoryConfigSchema = z.object({
  compactionThreshold: z.number().min(0).max(1).default(0.75),
  searchTopK: z.number().int().min(1).default(10),
});

/** Inferred types from schemas. */
export type MemoryConfig = z.infer<typeof memoryConfigSchema>;
