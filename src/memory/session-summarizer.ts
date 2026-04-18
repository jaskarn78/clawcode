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
 * MemoryEntry.
 *
 * Pipeline (14 steps):
 *  1. Load session via conversationStore.getSession
 *  2. Idempotency: if status=summarized, short-circuit with skipped
 *  3. State machine: if status=active, reject with session-not-terminal
 *  4. Load turns via getTurnsForSession (Pitfall 2: use turns.length, not
 *     session.turnCount — turn_count is eventually-consistent under
 *     fire-and-forget recordTurn writes from Phase 65)
 *  5. Minimum-turns guard (default 3); skip cleanly with no writes
 *  6. Build prompt (buildSessionSummarizationPrompt)
 *  7. Call deps.summarize with an AbortController-driven timeout
 *  8. On success: use the LLM content verbatim
 *  9. On timeout/error/empty-response: use buildRawTurnFallback + tag
 *     "raw-fallback" so the session still becomes summarized (idempotent)
 *     and operators can find these entries and re-summarize later.
 * 10. Embed the chosen content (summary or raw fallback)
 * 11. Build tags ["session-summary", `session:${id}`, optional "raw-fallback"]
 * 12. memoryStore.insert with source="conversation", sourceTurnIds,
 *     skipDedup=true (summaries are unique by definition)
 * 13. conversationStore.markSummarized — non-fatal if it throws (state
 *     race: session may have been re-transitioned by another caller;
 *     the memory row still exists and is searchable)
 * 14. Return frozen success result
 *
 * All paths are non-fatal: summarizeSession NEVER throws to its caller.
 */
export async function summarizeSession(
  input: SummarizeSessionInput,
  deps: SummarizeSessionDeps,
): Promise<SummarizeSessionResult> {
  const { agentName, sessionId } = input;
  const timeoutMs = deps.config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minTurns = deps.config?.minTurns ?? DEFAULT_MIN_TURNS;
  const importance = deps.config?.importance ?? DEFAULT_IMPORTANCE;

  // Step 1 — load session
  const session = deps.conversationStore.getSession(sessionId);
  if (!session) {
    deps.log.warn(
      { agent: agentName, session: sessionId },
      "summarize: session not found",
    );
    return Object.freeze({
      skipped: true as const,
      reason: "session-not-found" as const,
    });
  }

  // Step 2 — idempotency: already summarized (Pitfall 5)
  if (session.status === "summarized") {
    return Object.freeze({
      skipped: true as const,
      reason: "already-summarized" as const,
    });
  }

  // Step 3 — state machine: must be in terminal status
  if (session.status === "active") {
    deps.log.warn(
      { agent: agentName, session: sessionId, status: session.status },
      "summarize: session still active — caller must end/crash first",
    );
    return Object.freeze({
      skipped: true as const,
      reason: "session-not-terminal" as const,
    });
  }

  // Step 4 — load turns (use .length, NOT session.turnCount — Pitfall 2)
  const turns = deps.conversationStore.getTurnsForSession(sessionId);

  // Step 5 — minimum turns guard
  if (turns.length < minTurns) {
    return Object.freeze({
      skipped: true as const,
      reason: "insufficient-turns" as const,
      turnCount: turns.length,
    });
  }

  // Step 6-9 — build prompt, call summarize with timeout, fallback on failure
  const prompt = buildSessionSummarizationPrompt(turns);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let summaryContent: string;
  let fallback = false;
  try {
    summaryContent = await Promise.race([
      deps.summarize(prompt, { signal: controller.signal }),
      new Promise<string>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error("summarize timeout after " + timeoutMs + "ms")),
        );
      }),
    ]);
    if (!summaryContent || summaryContent.trim().length === 0) {
      // Empty LLM response is treated as failure so the session still
      // gets a (raw-fallback) summary row and becomes idempotent.
      throw new Error("summarize returned empty content");
    }
  } catch (err) {
    deps.log.warn(
      {
        agent: agentName,
        session: sessionId,
        error: (err as Error).message,
      },
      "summarize failed — using raw-turn fallback",
    );
    summaryContent = buildRawTurnFallback(turns);
    fallback = true;
  } finally {
    clearTimeout(timer);
  }

  // Step 10 — embed the chosen content
  let embedding: Float32Array;
  try {
    embedding = await deps.embedder.embed(summaryContent);
  } catch (err) {
    deps.log.warn(
      {
        agent: agentName,
        session: sessionId,
        error: (err as Error).message,
      },
      "embedding failed — aborting summarization",
    );
    // Embedder failed — skip without writing. Session stays in ended/crashed
    // so a later retry (or manual intervention) can try again.
    return Object.freeze({
      skipped: true as const,
      reason: "session-not-terminal" as const,
      turnCount: turns.length,
    });
  }

  // Step 11-12 — build tags, insert MemoryEntry
  const baseTags: string[] = ["session-summary", `session:${sessionId}`];
  if (fallback) baseTags.push("raw-fallback");
  const tags = Object.freeze([...baseTags]);
  const sourceTurnIds = Object.freeze(turns.map((t) => t.id));

  let memoryId: string;
  try {
    const entry = deps.memoryStore.insert(
      {
        content: summaryContent,
        source: "conversation",
        importance,
        tags,
        sourceTurnIds,
        // summaries are unique by definition; dedup would incorrectly
        // merge distinct sessions into one summary row.
        skipDedup: true,
      },
      embedding,
    );
    memoryId = entry.id;
  } catch (err) {
    deps.log.warn(
      {
        agent: agentName,
        session: sessionId,
        error: (err as Error).message,
      },
      "memoryStore.insert failed — summarization aborted",
    );
    return Object.freeze({
      skipped: true as const,
      reason: "session-not-terminal" as const,
      turnCount: turns.length,
    });
  }

  // Step 13 — markSummarized (non-fatal if race/state mismatch)
  try {
    deps.conversationStore.markSummarized(sessionId, memoryId);
  } catch (err) {
    deps.log.warn(
      {
        agent: agentName,
        session: sessionId,
        memoryId,
        error: (err as Error).message,
      },
      "markSummarized failed after insert — memory row present but session FK not set",
    );
    // Non-fatal: the memory exists and is searchable; the session FK
    // just wasn't set. Operators can reconcile later.
  }

  // Step 14 — success
  return Object.freeze({
    success: true as const,
    memoryId,
    fallback,
    turnCount: turns.length,
  });
}
