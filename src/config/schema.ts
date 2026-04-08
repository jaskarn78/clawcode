import { z } from "zod/v4";

/**
 * Valid Claude model identifiers.
 */
export const modelSchema = z.enum(["sonnet", "opus", "haiku"]);

/**
 * Schema for a single agent entry in the config.
 * Channel IDs are strings to prevent YAML numeric coercion (Pitfall 1).
 */
export const agentSchema = z.object({
  name: z.string().min(1),
  workspace: z.string().optional(),
  channels: z.array(z.string()).default([]),
  model: modelSchema.optional(),
  skills: z.array(z.string()).default([]),
  soul: z.string().optional(),
  identity: z.string().optional(),
});

/**
 * Schema for top-level defaults that agents inherit.
 */
export const defaultsSchema = z.object({
  model: modelSchema.default("sonnet"),
  skills: z.array(z.string()).default([]),
  basePath: z.string().default("~/.clawcode/agents"),
});

/**
 * Root config schema for clawcode.yaml.
 * Requires version: 1 and at least one agent.
 */
export const configSchema = z.object({
  version: z.literal(1),
  defaults: defaultsSchema.default(() => ({
    model: "sonnet" as const,
    skills: [] as string[],
    basePath: "~/.clawcode/agents",
  })),
  agents: z.array(agentSchema).min(1),
});

/** Fully parsed and validated config. */
export type Config = z.infer<typeof configSchema>;

/** Raw agent entry before defaults merging. */
export type AgentConfig = z.infer<typeof agentSchema>;

/** Top-level defaults section. */
export type DefaultsConfig = z.infer<typeof defaultsSchema>;
