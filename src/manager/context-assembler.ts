/**
 * Pure context assembly function with per-source token budgets.
 * No side effects, no external imports beyond types + node:crypto.
 *
 * Phase 52 Plan 02 — two-block split for prompt caching:
 *   - `stablePrefix` — identity + hotMemories (when stable) + toolDefinitions
 *     + graphContext. This is the block fed to `systemPrompt.append` so the
 *     SDK's `claude_code` preset can auto-cache it across turns.
 *   - `mutableSuffix` — discordBindings + contextSummary (and hot-tier
 *     entries WHEN the hot-tier composition just changed). Prepended to the
 *     user message so it sits OUTSIDE the cached block.
 *
 * Hot-tier `stable_token`: if the caller passes `priorHotStableToken` and it
 * does NOT match the current hot-tier signature, hot-tier slides out of the
 * cacheable block for THIS TURN ONLY and lands in the mutable suffix. The
 * NEXT turn with unchanged hot-tier re-enters the stable prefix. This
 * prevents cache thrashing on a single hot-tier update.
 */

import { createHash } from "node:crypto";
import type { Turn } from "../performance/trace-collector.js";

export type ContextBudgets = {
  readonly identity: number;
  readonly hotMemories: number;
  readonly toolDefinitions: number;
  readonly graphContext: number;
};

export type ContextSources = {
  readonly identity: string;
  readonly hotMemories: string;
  readonly toolDefinitions: string;
  readonly graphContext: string;
  readonly discordBindings: string;
  readonly contextSummary: string;
};

export const DEFAULT_BUDGETS: ContextBudgets = Object.freeze({
  identity: 1000,
  hotMemories: 3000,
  toolDefinitions: 2000,
  graphContext: 2000,
});

/**
 * Phase 52 Plan 02 — options for `assembleContext`.
 *
 * `priorHotStableToken` is the hot-tier `stable_token` from the PRIOR turn
 * (stored per-agent by SessionManager). When set and when the current turn's
 * token differs, hot-tier migrates from stable to mutable for this turn only.
 */
export type AssembleOptions = {
  readonly priorHotStableToken?: string;
};

/**
 * Phase 52 Plan 02 — return shape of `assembleContext`.
 *
 * Two separate strings: callers plug `stablePrefix` into
 * `systemPrompt.append` (cached) and `mutableSuffix` into the user-message
 * preamble (uncached). `hotStableToken` is the sha256 of the hot-tier
 * signature THIS turn and should be carried forward into the NEXT turn's
 * `priorHotStableToken`.
 */
export type AssembledContext = {
  readonly stablePrefix: string;
  readonly mutableSuffix: string;
  readonly hotStableToken: string;
};

/**
 * Phase 52 Plan 02 — sha256 hex of the rendered hot-tier string.
 *
 * Exposed as a named export so SessionManager and tests can compute the token
 * deterministically. This hashes the RENDERED hot-memory block (the same data
 * the assembler would emit) so any textual change flips the hash.
 */
export function computeHotStableToken(hotMemoriesStr: string): string {
  return createHash("sha256").update(hotMemoriesStr, "utf8").digest("hex");
}

/**
 * Phase 52 Plan 02 — sha256 hex of the stable prefix string.
 *
 * Consumed by `SdkSessionAdapter.iterateWithTracing` via the
 * `prefixHashProvider` closure. Per-turn comparison against the prior turn's
 * hash for the same agent drives `cache_eviction_expected` recording.
 *
 * SECURITY: the hash is a 64-char lowercase hex and is safe to log. NEVER
 * log the pre-image (the stable prefix) since it contains the agent's
 * identity/soul text.
 */
export function computePrefixHash(stablePrefix: string): string {
  return createHash("sha256").update(stablePrefix, "utf8").digest("hex");
}

/**
 * Estimate token count using chars/4 heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check whether assembled context exceeds a token ceiling.
 * Default ceiling: 8000 tokens (32000 chars).
 */
export function exceedsCeiling(
  assembled: string,
  ceiling: number = 8000,
): boolean {
  return estimateTokens(assembled) > ceiling;
}

/**
 * Truncate text to fit within a token budget.
 * For bullet-list content (lines starting with "- "), truncates at line
 * boundaries by dropping trailing bullets.
 * For other content, hard-truncates at maxChars with "..." suffix.
 */
function truncateToBudget(text: string, tokenBudget: number): string {
  const maxChars = tokenBudget * 4;

  if (text.length <= maxChars) {
    return text;
  }

  // Check if content is bullet-list style (lines starting with "- ")
  const lines = text.split("\n");
  const isBulletList = lines.some((line) => line.startsWith("- "));

  if (isBulletList) {
    const kept: string[] = [];
    let charCount = 0;

    for (const line of lines) {
      const lineWithNewline = line.length + (kept.length > 0 ? 1 : 0);
      if (charCount + lineWithNewline > maxChars) {
        break;
      }
      kept.push(line);
      charCount += lineWithNewline;
    }

    return kept.join("\n");
  }

  // Hard truncate for non-bullet content
  return text.slice(0, maxChars) + "...";
}

/**
 * Assemble context into stable + mutable blocks with per-source budgets.
 *
 * Stable prefix (cacheable via SDK preset+append):
 *   identity → hotMemories (when stable) → toolDefinitions → graphContext
 *
 * Mutable suffix (per-turn, outside cache):
 *   [hotMemories (when hot-tier composition just changed)] → discordBindings
 *   → contextSummary
 *
 * The hot-tier placement decision:
 *   - If `opts.priorHotStableToken` is undefined → hot-tier in stable
 *     (first turn of a fresh session — no thrashing signal yet).
 *   - If `opts.priorHotStableToken === currentHotToken` → hot-tier in stable
 *     (composition unchanged since prior turn).
 *   - Otherwise → hot-tier in mutable FOR THIS TURN ONLY (composition drift
 *     on the boundary; next unchanged turn re-enters the cached block).
 *
 * Empty sources are omitted entirely (no empty headers).
 * Discord bindings and context summary are pass-through (no truncation).
 */
export function assembleContext(
  sources: ContextSources,
  budgets: ContextBudgets = DEFAULT_BUDGETS,
  opts?: AssembleOptions,
): AssembledContext {
  const stableParts: string[] = [];
  const mutableParts: string[] = [];

  // Identity: no section header (fingerprint has its own formatting). Stable.
  if (sources.identity) {
    stableParts.push(truncateToBudget(sources.identity, budgets.identity));
  }

  // Hot memories: composition-driven placement. Always compute the current
  // token so SessionManager can carry it forward even when hot-tier is empty
  // (empty-case hash is the known sha256("") constant).
  const currentHotToken = computeHotStableToken(sources.hotMemories);
  if (sources.hotMemories) {
    const rendered =
      "## Key Memories\n\n" +
      truncateToBudget(sources.hotMemories, budgets.hotMemories);
    const priorToken = opts?.priorHotStableToken;
    // Place in mutable ONLY when we have a prior token and it differs — the
    // hot-tier composition boundary case. Otherwise (no prior, or matching
    // prior) keep hot-tier in the cacheable stable block.
    const hotInMutable =
      priorToken !== undefined && priorToken !== currentHotToken;
    if (hotInMutable) {
      mutableParts.push(rendered);
    } else {
      stableParts.push(rendered);
    }
  }

  // Tool definitions: stable (skills header + MCP catalog + subagent-model).
  if (sources.toolDefinitions) {
    stableParts.push(
      "## Available Tools\n\n" +
        truncateToBudget(sources.toolDefinitions, budgets.toolDefinitions),
    );
  }

  // Graph context: stable (runtime-derived but session-scoped).
  if (sources.graphContext) {
    stableParts.push(
      "## Related Context\n\n" +
        truncateToBudget(sources.graphContext, budgets.graphContext),
    );
  }

  // Discord bindings: pass-through in MUTABLE (per-turn context).
  if (sources.discordBindings) {
    mutableParts.push(sources.discordBindings);
  }

  // Context summary: pass-through in MUTABLE.
  if (sources.contextSummary) {
    mutableParts.push(sources.contextSummary);
  }

  return Object.freeze({
    stablePrefix: stableParts.join("\n\n"),
    mutableSuffix: mutableParts.join("\n\n"),
    hotStableToken: currentHotToken,
  });
}

/**
 * Traced wrapper around {@link assembleContext}.
 *
 * Opens a `context_assemble` span before invoking `assembleContext` and ends
 * it in a `finally` block regardless of outcome (success or throw). When
 * `turn` is undefined the wrapper is a pass-through — no span is started.
 *
 * Phase 52 Plan 02 — signature widened to forward `AssembleOptions` through
 * so per-turn callers that thread `priorHotStableToken` preserve the
 * hot-tier stable_token semantic.
 *
 * WIRING NOTE (Phase 50 Plan 02 Case A carried forward): all current call
 * sites of `assembleContext` live inside `buildSessionConfig` and run at
 * agent-startup / session-resume — NOT per turn. The traced wrapper exists
 * for future per-turn refresh paths; today the segment row reports count=0
 * unless a caller opts in.
 */
export function assembleContextTraced(
  sources: ContextSources,
  budgets: ContextBudgets = DEFAULT_BUDGETS,
  opts?: AssembleOptions,
  turn?: Turn,
): AssembledContext {
  const span = turn?.startSpan("context_assemble");
  try {
    return assembleContext(sources, budgets, opts);
  } finally {
    span?.end();
  }
}
