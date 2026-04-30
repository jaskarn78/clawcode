/**
 * Phase 95 Plan 01 Task 2 — D-02/D-03 dream prompt builder.
 *
 * Pure module:
 *   - No SDK imports
 *   - No fs imports
 *   - No clock — input is fully deterministic for the same DreamPromptInput
 *
 * Assembles the dream context from 4 sections (D-02):
 *   1. Recent memory chunks (most recent N from memory_chunks SQLite,
 *      sorted lastModified DESC)
 *   2. Current MEMORY.md content
 *   3. Recent conversation summaries (last-3 session-end summaries)
 *   4. Existing wikilinks (graph-edges.json snapshot, raw text)
 *
 * Token budget: ≤32K input. Truncate oldest chunks first if over budget.
 * Estimation: chars/4 heuristic (consistent with v1.7 token budget tuning).
 *
 * D-03 system-prompt template is verbatim from 95-CONTEXT specifics:
 *   "You are <agent>'s reflection daemon..."
 * Subtle wording changes can change LLM output behavior — pinned by
 * static-grep regression tests in 95-01-PLAN action 5.
 */

/** Hard cap on the assembled user-prompt input tokens (D-02). */
export const DREAM_PROMPT_INPUT_TOKEN_BUDGET = 32_000;

import { renderAgentVisibleTimestamp } from "../shared/agent-visible-time.js";

/** chars/4 heuristic — matches v1.7 token-budget tuning. */
const CHARS_PER_TOKEN = 4;

/**
 * Memory chunk shape consumed by the dream prompt. Minimal — id + path
 * for citation, body for content, lastModified for oldest-first sort.
 *
 * Distinct from `src/memory/memory-chunks.MemoryChunk` (which is the
 * chunker's output shape) — this is the DI getter contract that 95-02
 * adapts the SQLite getter to. Keep them decoupled so the schema in this
 * file evolves with the dream pass without affecting the chunker.
 */
export type MemoryChunk = Readonly<{
  id: string;
  path: string;
  body: string;
  lastModified: Date;
}>;

/**
 * Conversation-summary shape consumed by the dream prompt. Minimal —
 * sessionId + summary for content, endedAt for ordering. Distinct from
 * the full ConversationSession to keep the DI surface narrow.
 */
export type ConversationSummary = Readonly<{
  sessionId: string;
  summary: string;
  endedAt: Date;
}>;

export interface DreamPromptInput {
  readonly recentChunks: readonly MemoryChunk[];
  readonly memoryMd: string;
  readonly recentSummaries: readonly ConversationSummary[];
  readonly graphEdges: string;
  readonly agentName: string;
  /**
   * Phase 999.13 TZ-04 (Q2=YES) — operator-local IANA TZ used for the
   * `lastModified=…` (chunk header) and `ended …` (summary header)
   * timestamps. The dream-pass agent reads these prompts as agent-visible
   * context. When omitted, falls back to host TZ via the helper. Internal
   * `MemoryChunk.lastModified` and `ConversationSummary.endedAt` Date
   * objects stay UTC; only the rendered prompt uses operator-local time.
   */
  readonly agentTz?: string;
}

export interface BuildDreamPromptResult {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly estimatedInputTokens: number;
}

/**
 * Estimate token count via chars/4 heuristic (Math.ceil so empty strings
 * round up to 0 and one-char strings round up to 1). Pure function.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Build the D-03 system prompt. Verbatim from 95-CONTEXT specifics —
 * "<agent>'s reflection daemon" is the LLM-facing marker line. Pinned
 * by P1 test + static-grep regression rules.
 */
function buildSystemPrompt(agentName: string): string {
  return `You are ${agentName}'s reflection daemon. Your job is to read recent memory chunks, the core MEMORY.md, recent conversation summaries, and the existing wikilink graph, then emit a structured reflection.

CRITICAL OUTPUT RULES:
1. Your response MUST be valid JSON, parseable by JSON.parse() with no preprocessing.
2. The FIRST character MUST be '{' (no narrative preamble like "Picking up...", "Here's the reflection...", or "Sure!").
3. The LAST character MUST be '}' (no trailing commentary, no closing remarks).
4. NO markdown code fences (no \`\`\`json wrapper).
5. NO explanation text before or after the JSON object.

Required JSON schema (all 4 fields mandatory; use empty arrays/strings if no content):
{
  "newWikilinks": [{"from": "memory/path.md", "to": "memory/other.md", "rationale": "..."}],
  "promotionCandidates": [{"chunkId": "...", "currentPath": "memory/...", "rationale": "...", "priorityScore": 0-100}],
  "themedReflection": "1-3 paragraph narrative summary of recent activity",
  "suggestedConsolidations": [{"sources": ["memory/A.md", "memory/B.md"], "newPath": "memory/consolidations/X.md", "rationale": "..."}]
}

Focus on:
- Connections that are NEW (not already in graph-edges.json)
- Chunks referenced 3+ times in recent memory but NOT in MEMORY.md (promotion candidates)
- Themes spanning multiple recent chunks (consolidation candidates)
- 1-3 paragraph narrative on what happened recently (placed inside the themedReflection JSON string)`;
}

/**
 * Render one memory chunk as a fenced markdown block. Path + lastModified
 * appear so the LLM can cite specific chunks in its output.
 *
 * Phase 999.13 TZ-04 (Q2=YES) — `agentTz` (optional) controls operator-
 * local rendering of `lastModified`. Falls back to host TZ when omitted.
 */
function renderChunk(c: MemoryChunk, agentTz?: string): string {
  return `### ${c.path} (id=${c.id}, lastModified=${renderAgentVisibleTimestamp(c.lastModified, agentTz)})\n\n${c.body}`;
}

/**
 * Render one conversation summary as a fenced markdown block.
 *
 * Phase 999.13 TZ-04 (Q2=YES) — `agentTz` (optional) controls operator-
 * local rendering of `endedAt`. Falls back to host TZ when omitted.
 */
function renderSummary(s: ConversationSummary, agentTz?: string): string {
  return `### Session ${s.sessionId} (ended ${renderAgentVisibleTimestamp(s.endedAt, agentTz)})\n\n${s.summary}`;
}

/**
 * Compose the user prompt from the 4 D-02 sections + a chunk list. Each
 * empty source falls back to "(none)" so the LLM gets a stable structure
 * regardless of input cardinality.
 */
function buildUserPrompt(
  chunks: readonly MemoryChunk[],
  memoryMd: string,
  summaries: readonly ConversationSummary[],
  graphEdges: string,
  agentTz?: string,
): string {
  const chunkSection =
    chunks.length === 0
      ? "(none)"
      : chunks.map((c) => renderChunk(c, agentTz)).join("\n\n");
  const memorySection = memoryMd.trim().length === 0 ? "(none)" : memoryMd;
  const summarySection =
    summaries.length === 0
      ? "(none)"
      : summaries.map((s) => renderSummary(s, agentTz)).join("\n\n");
  const wikiSection = graphEdges.trim().length === 0 ? "(none)" : graphEdges;

  return `## Recent memory chunks

${chunkSection}

## MEMORY.md

${memorySection}

## Recent conversation summaries

${summarySection}

## Existing wikilinks

${wikiSection}`;
}

/**
 * Assemble the dream system + user prompts within the 32K input-token
 * budget. Oldest-first chunk truncation drops the LEAST recent entries
 * if the rendered prompt exceeds DREAM_PROMPT_INPUT_TOKEN_BUDGET.
 *
 * Truncation algorithm:
 *   1. Sort chunks lastModified DESC (newest first)
 *   2. Render full prompt
 *   3. While estimated > budget AND chunks > 0: drop tail (oldest)
 *   4. Return final shape with the post-truncation token estimate
 *
 * Pure function — no I/O, no clock. Same input → same output (modulo
 * Date.toISOString() which is itself deterministic).
 */
export function buildDreamPrompt(
  input: DreamPromptInput,
): BuildDreamPromptResult {
  const systemPrompt = buildSystemPrompt(input.agentName);

  // Sort newest first so dropping from the tail removes the oldest.
  // Slice + sort to avoid mutating the caller's input array.
  let chunks: MemoryChunk[] = [...input.recentChunks].sort(
    (a, b) => b.lastModified.getTime() - a.lastModified.getTime(),
  );

  let userPrompt = buildUserPrompt(
    chunks,
    input.memoryMd,
    input.recentSummaries,
    input.graphEdges,
    input.agentTz,
  );

  // Tighten until under budget. The non-chunk sections (MEMORY.md +
  // summaries + graph + section headers + system prompt) are NOT
  // truncated here — if those alone exceed the budget the caller is
  // misusing the primitive (caller's responsibility per D-02 narrow
  // scope).
  while (
    estimateTokens(systemPrompt + userPrompt) > DREAM_PROMPT_INPUT_TOKEN_BUDGET &&
    chunks.length > 0
  ) {
    chunks = chunks.slice(0, -1);
    userPrompt = buildUserPrompt(
      chunks,
      input.memoryMd,
      input.recentSummaries,
      input.graphEdges,
      input.agentTz,
    );
  }

  const estimatedInputTokens = estimateTokens(systemPrompt + userPrompt);
  return { systemPrompt, userPrompt, estimatedInputTokens };
}
