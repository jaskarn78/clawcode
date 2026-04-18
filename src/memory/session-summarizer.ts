/**
 * Session-boundary summarizer — compresses conversation turns into a
 * MemoryEntry at session end/crash.
 *
 * Mirrors consolidation.ts structure: pure helpers + dep-injected pipeline.
 * The pipeline is pure in the "no SDK / no daemon imports" sense; the LLM
 * call is injected as `deps.summarize` so unit tests can exercise every
 * branch (happy path, timeout fallback, LLM error, idempotency, short-
 * session skip) without touching the network.
 *
 * SESS-01: on session end/restart, raw turns compressed via haiku call.
 * SESS-04: stored as MemoryEntry with source="conversation".
 */

import type { ConversationTurn } from "./conversation-types.js";
import type {
  SummarizeSessionDeps,
  SummarizeSessionInput,
  SummarizeSessionResult,
} from "./session-summarizer.types.js";

/** Maximum combined character length before proportional truncation. */
export const MAX_PROMPT_CHARS = 30_000;

/** Default timeout for the summarize() LLM call. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Default minimum turn count to trigger summarization. */
export const DEFAULT_MIN_TURNS = 3;

/** Default importance for session-summary MemoryEntries. */
export const DEFAULT_IMPORTANCE = 0.78;

/**
 * Build the structured prompt for Haiku.
 *
 * Format: a 4-category instruction block (User Preferences, Decisions,
 * Open Threads, Commitments) followed by role-annotated turn headers.
 * Truncates proportionally if total content exceeds MAX_PROMPT_CHARS
 * (mirrors consolidation.ts:199-244 pattern — Pitfall 6 in 66-RESEARCH).
 *
 * An empty `turns` array still returns a valid prompt — the instruction
 * block is always present so callers cannot produce a malformed request.
 */
export function buildSessionSummarizationPrompt(
  turns: readonly ConversationTurn[],
): string {
  const totalChars = turns.reduce((sum, t) => sum + t.content.length, 0);
  const needsTruncation = totalChars > MAX_PROMPT_CHARS;
  const maxPerTurn =
    turns.length > 0
      ? Math.floor(MAX_PROMPT_CHARS / turns.length)
      : MAX_PROMPT_CHARS;

  const sections: string[] = [];
  for (const turn of turns) {
    let content = turn.content;
    if (needsTruncation && content.length > maxPerTurn) {
      content =
        content.slice(0, maxPerTurn) + "\n\n[...truncated due to length]";
    }
    sections.push(`### ${turn.role} (turn ${turn.turnIndex})\n\n${content}`);
  }

  const instructions = `You are summarizing a completed conversation session into a structured memory entry.
Extract and organize the following from the turns below:

## User Preferences
List preferences the user expressed (communication style, tool choices, formatting).

## Decisions
List concrete decisions made during the session, with brief rationale.

## Open Threads
List topics, questions, or tasks that were discussed but not resolved.

## Commitments
List explicit commitments made by either party (deadlines, promised actions, follow-ups).

Format your response as clean markdown with the exact section headers above.
If a category has nothing, write "(none)" under it — do not omit the header.
Be concise but preserve specific names, dates, and technical details.
${needsTruncation ? "\nNote: Some turn content was truncated due to length. Summarize what is available." : ""}

---

# Conversation Turns

`;

  return instructions + sections.join("\n\n");
}

/**
 * Deterministic fallback used when the LLM call times out or errors.
 *
 * Returns a markdown dump of raw turns — still embeds and becomes
 * searchable, still marks the session summarized for idempotency. The
 * "raw-fallback" tag is added by the pipeline so operators can find
 * these entries and re-summarize later if desired.
 */
export function buildRawTurnFallback(
  turns: readonly ConversationTurn[],
): string {
  if (turns.length === 0) {
    return "## Raw Turns\n\n(no turns)\n";
  }
  const sections = turns.map(
    (t) => `### ${t.role} (turn ${t.turnIndex})\n\n${t.content}`,
  );
  return `## Raw Turns\n\n${sections.join("\n\n")}\n`;
}

/**
 * Summarize a completed conversation session and write the result as a
 * MemoryEntry. Implementation lands in Task 2 of this plan.
 *
 * See `session-summarizer.types.ts` for the result discriminated union.
 */
export async function summarizeSession(
  _input: SummarizeSessionInput,
  _deps: SummarizeSessionDeps,
): Promise<SummarizeSessionResult> {
  // TASK 2 implements this pipeline. For now, a stub that throws.
  throw new Error("summarizeSession not yet implemented (Task 2)");
}
