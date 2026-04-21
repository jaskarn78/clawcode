/**
 * Phase 82 OPS-01 — pilot recommendation scorer and line formatter.
 *
 * Purely functional module: zero I/O, zero side effects, zero env reads.
 * Wave 2 CLI will call pickPilot + formatPilotLine on the PlanReport.agents
 * to emit the final line after the main plan diff:
 *
 *   ✨ Recommended pilot: <sourceId> (<reason>)
 *
 * Scoring formula (locked per 82-CONTEXT D-01):
 *   score = memoryChunkCount * 0.6 + mcpCount * 0.2 + (isFinmentumFamily ? 100 : 0)
 *
 * Rationale:
 *   - memoryChunkCount dominates — lower memory = lower migration risk
 *     (less to translate, fewer chances of drift).
 *   - mcpCount is a minor secondary signal (more MCPs = more surface area).
 *   - The +100 finmentum penalty unconditionally disqualifies the family
 *     from piloting — they share a workspace (business-critical, high-risk).
 *     100 is larger than any realistic (memoryChunkCount * 0.6) on the
 *     on-box fleet (~300 chunks × 0.6 = 180 max, but finmentum scores are
 *     all +100 so any non-finmentum with chunks<166 beats any finmentum).
 *     The test fleet pins this.
 *
 * Tie-break: alphabetical by sourceId (localeCompare). Ensures deterministic
 * winner when scores collide exactly.
 *
 * DO NOT:
 *   - Read process.env or os.homedir() — all inputs are injected.
 *   - Change the +100 penalty constant — encoded in success criteria.
 *   - Use Math.random / Date.now — the module must be deterministic.
 *   - Re-rank on tie using heuristics other than alphabetical — the tie-break
 *     is load-bearing for reproducibility across planning sessions.
 */
import type { AgentPlan } from "./diff-builder.js";

/**
 * Literal prefix for the pilot recommendation line. Grep-pinned by
 * pilot-selector.test.ts — any character drift (including the leading
 * sparkle emoji) is a PR-block.
 */
export const PILOT_RECOMMEND_PREFIX = "✨ Recommended pilot: ";

/**
 * Pure scoring function. Lower score is better. Input shape is a single
 * agent plus its resolved mcpCount — the caller passes a ReadonlyMap<string,
 * number> to pickPilot and we look up per-agent.
 *
 * Formula (grep-pinned):
 *   memoryChunkCount * 0.6 + mcpCount * 0.2 + (isFinmentumFamily ? 100 : 0)
 */
export function scorePilot(args: {
  readonly agent: AgentPlan;
  readonly mcpCount: number;
}): number {
  const { agent, mcpCount } = args;
  return (
    agent.memoryChunkCount * 0.6 +
    mcpCount * 0.2 +
    (agent.isFinmentumFamily ? 100 : 0)
  );
}

/**
 * Pick the recommended pilot from a list of agents + a map of
 * per-agent MCP server counts. Returns null on empty input.
 *
 * Selection:
 *   1. Compute scorePilot for each agent (mcpCounts.get(id) ?? 0).
 *   2. Lowest score wins.
 *   3. Tie-break: alphabetical by sourceId (localeCompare — stable across
 *      locales for our ASCII identifier set).
 *
 * `reason` (returned alongside winner) is the human-readable explanation
 * included in the formatted line. Currently pins:
 *   "lowest memory count (<N> chunks), dedicated workspace, not-business-critical"
 *
 * Finmentum agents are NEVER winners in practice (penalty dominates every
 * realistic memory count on the fleet), so the "not-business-critical"
 * suffix always matches the winner's shape.
 */
export function pickPilot(
  agents: readonly AgentPlan[],
  mcpCounts: ReadonlyMap<string, number>,
): { readonly winner: AgentPlan; readonly reason: string } | null {
  if (agents.length === 0) return null;

  let best: AgentPlan | undefined;
  let bestScore = Infinity;
  for (const agent of agents) {
    const mcpCount = mcpCounts.get(agent.sourceId) ?? 0;
    const s = scorePilot({ agent, mcpCount });
    if (
      s < bestScore ||
      (s === bestScore &&
        best !== undefined &&
        agent.sourceId.localeCompare(best.sourceId) < 0)
    ) {
      best = agent;
      bestScore = s;
    }
  }
  if (best === undefined) return null;

  const reason = `lowest memory count (${best.memoryChunkCount} chunks), dedicated workspace, not-business-critical`;
  return { winner: best, reason };
}

/**
 * Format the recommendation line. Byte-exact output:
 *   "✨ Recommended pilot: <sourceId> (<reason>)"
 *
 * Wave 2 CLI appends this line to `plan` output after the main diff table.
 * Test pilot-selector.test.ts pins the literal string.
 */
export function formatPilotLine(winner: AgentPlan, reason: string): string {
  return `${PILOT_RECOMMEND_PREFIX}${winner.sourceId} (${reason})`;
}
