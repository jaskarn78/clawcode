/**
 * Pure context assembly function with per-source token budgets.
 * No side effects, no external imports beyond types.
 *
 * Each source gets an independent token budget. Slack is NOT redistributed.
 * Discord bindings and context summary are pass-through (no budget applied).
 */

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
 * Assemble context from multiple sources with per-source budget enforcement.
 *
 * Section order: identity, hot memories, tool definitions, graph context,
 * discord bindings, context summary.
 *
 * Empty sources are omitted entirely (no empty headers).
 * Discord bindings and context summary are pass-through (no truncation).
 */
export function assembleContext(
  sources: ContextSources,
  budgets: ContextBudgets = DEFAULT_BUDGETS,
): string {
  const sections: string[] = [];

  // Identity: no section header (fingerprint has its own formatting)
  if (sources.identity) {
    sections.push(truncateToBudget(sources.identity, budgets.identity));
  }

  // Hot memories: with section header (header not counted against budget)
  if (sources.hotMemories) {
    sections.push(
      "## Key Memories\n\n" +
        truncateToBudget(sources.hotMemories, budgets.hotMemories),
    );
  }

  // Tool definitions: with section header
  if (sources.toolDefinitions) {
    sections.push(
      "## Available Tools\n\n" +
        truncateToBudget(sources.toolDefinitions, budgets.toolDefinitions),
    );
  }

  // Graph context: with section header
  if (sources.graphContext) {
    sections.push(
      "## Related Context\n\n" +
        truncateToBudget(sources.graphContext, budgets.graphContext),
    );
  }

  // Discord bindings: pass-through, no truncation
  if (sources.discordBindings) {
    sections.push(sources.discordBindings);
  }

  // Context summary: pass-through, no truncation
  if (sources.contextSummary) {
    sections.push(sources.contextSummary);
  }

  return sections.join("\n\n");
}

/**
 * Traced wrapper around {@link assembleContext}.
 *
 * Opens a `context_assemble` span before invoking `assembleContext` and ends
 * it in a `finally` block regardless of outcome (success or throw). When
 * `turn` is undefined the wrapper is a pass-through — no span is started.
 *
 * WIRING RESOLUTION (Phase 50 Plan 02, Case A — session-scoped):
 * All current call sites of `assembleContext` live inside `buildSessionConfig`
 * (src/manager/session-config.ts), which runs at agent startup or session
 * resume — NOT per turn. Threading a per-turn Turn into `buildSessionConfig`
 * is out of scope for Phase 50; the segment row therefore reports `count=0`
 * for context_assemble until a per-turn assembly path is introduced (future
 * cache_control work in Phase 52). This wrapper exists so that callers with
 * a per-turn Turn (e.g., future per-turn context refresh) can opt-in with a
 * single-line swap — no signature changes required.
 */
export function assembleContextTraced(
  sources: ContextSources,
  budgets: ContextBudgets = DEFAULT_BUDGETS,
  turn?: Turn,
): string {
  const span = turn?.startSpan("context_assemble");
  try {
    return assembleContext(sources, budgets);
  } finally {
    span?.end();
  }
}
