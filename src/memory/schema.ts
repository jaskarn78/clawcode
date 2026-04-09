import { z } from "zod/v4";

/** Valid memory source values. */
export const memorySourceSchema = z.enum([
  "conversation",
  "manual",
  "system",
  "consolidation",
]);

/** Schema for creating a new memory entry. */
export const createMemoryInputSchema = z.object({
  content: z.string().min(1),
  source: memorySourceSchema,
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).optional(),
});

/** Schema for consolidation pipeline configuration. */
export const consolidationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  weeklyThreshold: z.number().int().min(1).default(7),
  monthlyThreshold: z.number().int().min(1).default(4),
  summaryModel: z.enum(["sonnet", "opus", "haiku"]).optional(),
});

/** Schema for relevance decay configuration. */
export const decayConfigSchema = z.object({
  halfLifeDays: z.number().int().min(1).default(30),
  semanticWeight: z.number().min(0).max(1).default(0.7),
  decayWeight: z.number().min(0).max(1).default(0.3),
});

/** Schema for memory deduplication configuration. */
export const dedupConfigSchema = z.object({
  enabled: z.boolean().default(true),
  similarityThreshold: z.number().min(0).max(1).default(0.85),
});

/** Schema for memory system configuration. */
export const memoryConfigSchema = z.object({
  compactionThreshold: z.number().min(0).max(1).default(0.75),
  searchTopK: z.number().int().min(1).default(10),
  consolidation: consolidationConfigSchema.default(() => ({
    enabled: true,
    weeklyThreshold: 7,
    monthlyThreshold: 4,
  })),
  decay: decayConfigSchema.default(() => ({
    halfLifeDays: 30,
    semanticWeight: 0.7,
    decayWeight: 0.3,
  })),
  deduplication: dedupConfigSchema.default(() => ({
    enabled: true,
    similarityThreshold: 0.85,
  })),
});

/** Inferred types from schemas. */
export type MemoryConfig = z.infer<typeof memoryConfigSchema>;

/** Inferred consolidation config type. */
export type ConsolidationConfig = z.infer<typeof consolidationConfigSchema>;

/** Inferred decay config type. */
export type DecayConfig = z.infer<typeof decayConfigSchema>;

/** Inferred deduplication config type. */
export type DedupConfig = z.infer<typeof dedupConfigSchema>;
