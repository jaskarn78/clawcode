import { nanoid } from "nanoid";
import type { ResolvedAgentConfig } from "../shared/types.js";

/**
 * Options for forking an agent session.
 */
export type ForkOptions = {
  readonly systemPromptOverride?: string;
  readonly modelOverride?: "sonnet" | "opus" | "haiku";
};

/**
 * Result of a session fork operation.
 */
export type ForkResult = {
  readonly forkName: string;
  readonly parentAgent: string;
  readonly sessionId: string;
};

/**
 * Build a unique name for a forked session.
 * Format: {agentName}-fork-{nanoid6}
 */
export function buildForkName(agentName: string): string {
  return `${agentName}-fork-${nanoid(6)}`;
}

/**
 * Build the config for a forked session from the parent agent's config.
 * The fork inherits the parent config but:
 * - Gets a new unique name
 * - Has no channel bindings (headless)
 * - Can override system prompt and model
 * - Includes a fork context section in the soul
 *
 * Returns a new object -- never mutates the parent config.
 */
export function buildForkConfig(
  parentConfig: ResolvedAgentConfig,
  forkName: string,
  options?: ForkOptions,
): ResolvedAgentConfig {
  const forkContext = [
    "\n\n## Fork Context",
    `This session was forked from agent "${parentConfig.name}".`,
    `Fork name: ${forkName}`,
    "You have inherited the parent agent's context up to this point.",
    "You are now operating independently.",
  ].join("\n");

  return {
    ...parentConfig,
    name: forkName,
    channels: [], // Forked sessions are headless -- no Discord bindings
    soul: (options?.systemPromptOverride ?? parentConfig.soul ?? "") + forkContext,
    model: options?.modelOverride ?? parentConfig.model,
    schedules: [], // Forked sessions don't inherit scheduled tasks
    slashCommands: [], // No slash commands for forks
    // Phase 83 Plan 02 EFFORT-06 — fork quarantine.
    //
    // buildForkConfig takes the PARENT'S ResolvedAgentConfig, not the
    // parent's live SessionHandle. The parent's runtime override
    // (setEffort called via /clawcode-effort) is NOT visible here by
    // design — ResolvedAgentConfig carries only the config default.
    // The explicit assignment below pins this invariant: any refactor
    // that accidentally threads runtime state into fork config will
    // need to delete this line, at which point fork-effort-quarantine.test.ts
    // fires RED. PITFALLS.md §Pitfall 3 (fork inheritance cost spike).
    effort: parentConfig.effort,
  };
}
