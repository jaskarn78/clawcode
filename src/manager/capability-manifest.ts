import type { ResolvedAgentConfig } from "../shared/types.js";

/**
 * Phase 100 follow-up — capability manifest builder.
 *
 * Problem (operator surface 2026-04-27): fin-acquisition was asked
 * "what have you dreamed about recently?" and answered "I don't dream —
 * no downtime between sessions." This was false: fin had `dream.enabled:
 * true` in clawcode.yaml and dreams persisted to memory/dreams/YYYY-MM-DD.md.
 * The agent literally didn't know its own features were on.
 *
 * Fix: emit a compact "Your ClawCode Capabilities" markdown block at
 * session-prompt assembly time so the LLM has the enabled feature list
 * in context. Pure read of ResolvedAgentConfig — no I/O, no
 * hallucination, no bloat for minimal agents.
 *
 * Placement: after identity, before the mutable suffix (so it sits in
 * the cached stable prefix and is cache-friendly across turns).
 *
 * Returns the markdown block as a string. Returns "" when the agent has
 * zero notable opted-in features (a baseline agent with only
 * memoryAutoLoad shouldn't pay the prompt cost).
 *
 * Notable features (today):
 *   - dream.enabled === true        → "Memory dreaming"
 *   - schedules.length > 0           → "Scheduled tasks"
 *   - skills includes "subagent-thread" → "Subagent threads"
 *   - gsd.projectDir set             → "GSD workflow"
 *
 * Each bullet uses ONLY values from the resolved config — no
 * speculation about what the LLM may or may not have. If a feature is
 * disabled, the bullet is omitted entirely (rather than printed with
 * "disabled") to keep minimal-agent prompts tight.
 */
export function buildCapabilityManifest(
  config: ResolvedAgentConfig,
): string {
  const bullets: string[] = [];

  // Memory dreaming — only when explicitly enabled. The bullet pulls
  // idleMinutes + model verbatim from resolved config so the LLM can
  // tell the operator the actual cadence (no hardcoded "30min").
  if (config.dream?.enabled === true) {
    const idle = config.dream.idleMinutes;
    const model = config.dream.model;
    bullets.push(
      `- **Memory dreaming**: auto-fires every ${idle}min idle, model=${model}; persists to memory/dreams/YYYY-MM-DD.md; manual trigger via /clawcode-dream slash command (admin-only).`,
    );
  }

  // Scheduled tasks — count enabled schedules. Operators see the full
  // list via /clawcode-schedule, so we just hint at presence + count.
  if (config.schedules.length > 0) {
    const count = config.schedules.length;
    bullets.push(
      `- **Scheduled tasks**: ${count} cron schedule${count === 1 ? "" : "s"} wired (see /clawcode-schedule slash command for the list).`,
    );
  }

  // Subagent threads — gated on the skill assignment because the
  // session-config layer already gates the spawn_subagent_thread MCP
  // tool guidance on the same flag (parity).
  if (config.skills.includes("subagent-thread")) {
    bullets.push(
      "- **Subagent threads**: spawn_subagent_thread MCP tool ready (autoRelay default true — parent gets summary on completion).",
    );
  }

  // GSD workflow — only when gsd.projectDir is set (admin agents and
  // sandbox-bound agents). Production fleet agents have no gsd block.
  if (config.gsd?.projectDir !== undefined) {
    bullets.push(
      `- **GSD workflow**: gsd.projectDir=${config.gsd.projectDir}; /gsd-* slash commands available.`,
    );
  }

  // Bail out cleanly when the agent has zero notable features. Minimal
  // agents (no dream, no schedules, no subagent-thread skill, no GSD)
  // should not pay the prompt cost for an empty manifest.
  if (bullets.length === 0) return "";

  const header =
    "## Your ClawCode Capabilities\n\nYou are running on ClawCode — a multi-agent orchestration system. The following features are CURRENTLY ENABLED for you (do NOT claim ignorance about these):\n\n";

  return header + bullets.join("\n") + "\n";
}
