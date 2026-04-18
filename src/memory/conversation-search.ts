/**
 * Scoped conversation search orchestrator.
 *
 * Merges three retrieval surfaces into a single paginated page:
 *   1. General memories (MemoryStore) — for scope="memories" and scope="all"
 *   2. Session-summary MemoryEntries (findByTag) — for scope="conversations" and scope="all"
 *   3. Raw conversation turns (ConversationStore.searchTurns / FTS5) — for scope="conversations" and scope="all"
 *
 * Pure dependency-injected function. All I/O flows through `deps`. `now: Date`
 * is injectable so decay tests are deterministic without `vi.setSystemTime()`.
 *
 * Design notes:
 *   - MVP matching strategy is a case-insensitive substring match over memory
 *     content. The locked decision in 68-CONTEXT.md is that this layer
 *     orchestrates; the MCP/IPC wiring in Plan 68-02 can swap in
 *     `SemanticSearch` for KNN-backed memory recall. Picking substring here
 *     keeps unit tests deterministic (no embedder warmup) and matches the
 *     "Alternative cleaner implementation" noted in 68-01-PLAN.md Step 2.
 *   - BM25 sign inversion happens at `bm25ToRelevance` — FTS5 produces
 *     negative values (more-negative = more relevant) so we normalise to
 *     [0, 1] via `1 / (1 + |bm25|)` before combining (Pitfall 3).
 *   - For scope="all", `dedupPreferSummary` drops raw-turn results for any
 *     sessionId that also has a session-summary hit — the distilled summary
 *     carries more signal per token (Pitfall 4).
 *   - `MAX_RESULTS_PER_PAGE` is a hard cap, NOT configurable, per the
 *     locked 68-CONTEXT.md decision.
 *   - Offset-based pagination has a known caveat under concurrent writes:
 *     if new turns are recorded between page requests, boundaries may
 *     shift (Pitfall 5). Acceptable for MVP; cursor-based is future work.
 *
 * Phase 68 — RETR-01 (scope dispatch), RETR-02 (FTS5 path), RETR-03 (decay + pagination).
 */

import { calculateRelevanceScore } from "./decay.js";
import type { MemoryEntry } from "./types.js";
import {
  SNIPPET_MAX_CHARS,
  MAX_RESULTS_PER_PAGE,
  DEFAULT_RETRIEVAL_HALF_LIFE_DAYS,
  type ScopedSearchDeps,
  type ScopedSearchOptions,
  type ScopedSearchPage,
  type ScopedSearchResult,
} from "./conversation-search.types.js";

/** Weight applied to raw relevance score in the combined score formula. */
const SEMANTIC_WEIGHT = 0.7;

/** Weight applied to decay factor in the combined score formula. */
const DECAY_WEIGHT = 0.3;

/**
 * Default importance used for conversation-turn decay math.
 *
 * Raw turns lack an `importance` field — 0.5 matches the
 * `createMemoryInputSchema` default so decay math stays consistent with
 * how MemoryEntries behave.
 */
const CONVERSATION_TURN_DEFAULT_IMPORTANCE = 0.5;

/** Maximum memories to consider before filtering/ranking (avoids unbounded scans). */
const MEMORY_CANDIDATE_POOL = 200;

/** Multiplier for FTS5 over-fetch headroom to leave room for dedup. */
const FTS5_OVERFETCH_MULTIPLIER = 3;

/**
 * Orchestrate scoped search across memory + session-summary + FTS5 paths.
 *
 * Pure function: all I/O flows through `deps`. Returns a single paginated
 * page; caller constructs the next request with `offset + results.length`.
 */
export async function searchByScope(
  deps: ScopedSearchDeps,
  options: ScopedSearchOptions,
): Promise<ScopedSearchPage> {
  // Clamp limit to the hard cap (MAX_RESULTS_PER_PAGE=10). Caller requesting
  // limit:20 gets limit:10 — matches the 68-CONTEXT locked decision.
  const clampedLimit = Math.min(
    Math.max(options.limit, 1),
    MAX_RESULTS_PER_PAGE,
  );
  const offset = Math.max(options.offset, 0);
  const now = options.now ?? new Date();
  const halfLifeDays =
    options.halfLifeDays ?? DEFAULT_RETRIEVAL_HALF_LIFE_DAYS;
  const decayParams = { halfLifeDays };
  const normalizedQuery = options.query.trim().toLowerCase();

  const candidates: ScopedSearchResult[] = [];

  // ------------------------------------------------------------------
  // 1. Memory path — general memories (excluding session-summaries)
  //    Applies to scope="memories" and scope="all".
  // ------------------------------------------------------------------
  if (options.scope === "memories" || options.scope === "all") {
    const memories = deps.memoryStore.listRecent(MEMORY_CANDIDATE_POOL);
    for (const m of memories) {
      const isSummary = m.tags.includes("session-summary");
      if (isSummary) continue; // session-summaries belong to the conversations bucket
      if (!contentMatches(m.content, normalizedQuery)) continue;

      const decay = calculateRelevanceScore(
        m.importance,
        m.accessedAt,
        now,
        decayParams,
      );
      candidates.push(
        buildResult({
          id: m.id,
          content: m.content,
          origin: "memory",
          relevanceScore: m.importance,
          decayScore: decay,
          tags: m.tags,
          createdAt: m.createdAt,
          sessionId: extractSessionId(m.tags),
        }),
      );
    }
  }

  // ------------------------------------------------------------------
  // 2. Session-summary path — MemoryEntries tagged "session-summary".
  //    Applies to scope="conversations" and scope="all".
  // ------------------------------------------------------------------
  if (options.scope === "conversations" || options.scope === "all") {
    const summaries = deps.memoryStore.findByTag("session-summary");
    for (const m of summaries) {
      if (!contentMatches(m.content, normalizedQuery)) continue;
      const decay = calculateRelevanceScore(
        m.importance,
        m.accessedAt,
        now,
        decayParams,
      );
      candidates.push(
        buildResult({
          id: m.id,
          content: m.content,
          origin: "session-summary",
          relevanceScore: m.importance,
          decayScore: decay,
          tags: m.tags,
          createdAt: m.createdAt,
          sessionId: extractSessionId(m.tags),
        }),
      );
    }
  }

  // ------------------------------------------------------------------
  // 3. FTS5 raw-turn path — conversation_turns via ConversationStore.
  //    Applies to scope="conversations" and scope="all".
  // ------------------------------------------------------------------
  if (options.scope === "conversations" || options.scope === "all") {
    const turnPage = deps.conversationStore.searchTurns(options.query, {
      limit: MAX_RESULTS_PER_PAGE * FTS5_OVERFETCH_MULTIPLIER,
      offset: 0,
    });
    for (const t of turnPage.results) {
      const decay = calculateRelevanceScore(
        CONVERSATION_TURN_DEFAULT_IMPORTANCE,
        t.createdAt,
        now,
        decayParams,
      );
      const relevance = bm25ToRelevance(t.bm25Score);
      candidates.push(
        buildResult({
          id: t.turnId,
          content: t.content,
          origin: "conversation-turn",
          relevanceScore: relevance,
          decayScore: decay,
          tags: [],
          createdAt: t.createdAt,
          sessionId: t.sessionId,
        }),
      );
    }
  }

  // ------------------------------------------------------------------
  // 4. Dedup + sort + paginate
  // ------------------------------------------------------------------
  const deduped =
    options.scope === "all" ? dedupPreferSummary(candidates) : candidates;

  // Highest combinedScore first; stable fallback on createdAt DESC so equal
  // scores render deterministic order across test runs.
  const sorted = [...deduped].sort((a, b) => {
    if (b.combinedScore !== a.combinedScore) {
      return b.combinedScore - a.combinedScore;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });

  const totalCandidates = sorted.length;
  const pageSlice = sorted.slice(offset, offset + clampedLimit);
  const hasMore = offset + pageSlice.length < totalCandidates;
  const nextOffset = hasMore ? offset + pageSlice.length : null;

  return Object.freeze({
    results: Object.freeze(pageSlice),
    hasMore,
    nextOffset,
    totalCandidates,
  });
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

/** Case-insensitive substring match, trimming empty queries to a nominal mismatch. */
function contentMatches(content: string, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return false;
  return content.toLowerCase().includes(normalizedQuery);
}

/**
 * Convert FTS5 BM25 output to a positive relevance score in [0, 1].
 *
 * FTS5 returns negative values (more-negative = more-relevant per SQLite's
 * "-1 * bm25" convention). Without this conversion, sorting ascending would
 * place the WORST matches first when combined with positive decay scores.
 * See Pitfall 3 in 68-RESEARCH.md.
 */
function bm25ToRelevance(bm25: number): number {
  return 1 / (1 + Math.abs(bm25));
}

/** Truncate content to SNIPPET_MAX_CHARS, appending an ellipsis if clipped. */
function makeSnippet(content: string): string {
  if (content.length <= SNIPPET_MAX_CHARS) return content;
  return content.slice(0, SNIPPET_MAX_CHARS) + "…";
}

/** Extract the sessionId from a `session:<id>` tag, or null if no such tag. */
function extractSessionId(tags: readonly string[]): string | null {
  for (const t of tags) {
    if (t.startsWith("session:")) return t.slice("session:".length);
  }
  return null;
}

type BuildResultInput = {
  readonly id: string;
  readonly content: string;
  readonly origin: ScopedSearchResult["origin"];
  readonly relevanceScore: number;
  readonly decayScore: number;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly sessionId: string | null;
};

/**
 * Build a ScopedSearchResult combining raw relevance + decay via
 * `relevance * 0.7 + decay * 0.3`. Mirrors `relevance.ts:scoreAndRank`
 * weights so agents see consistent scoring across semantic + conversation
 * retrieval.
 */
function buildResult(r: BuildResultInput): ScopedSearchResult {
  const combinedScore =
    r.relevanceScore * SEMANTIC_WEIGHT + r.decayScore * DECAY_WEIGHT;
  return Object.freeze({
    id: r.id,
    content: r.content,
    snippet: makeSnippet(r.content),
    origin: r.origin,
    relevanceScore: r.relevanceScore,
    combinedScore,
    tags: Object.freeze([...r.tags]),
    createdAt: r.createdAt,
    sessionId: r.sessionId,
  });
}

/**
 * Deduplicate scope="all" candidates: if a sessionId has a session-summary
 * result, drop any conversation-turn results for that same sessionId
 * (prefer the distilled summary — Pitfall 4 in 68-RESEARCH.md).
 *
 * Memory-origin results and turn results without a sessionId are always
 * preserved.
 */
function dedupPreferSummary(
  results: readonly ScopedSearchResult[],
): ScopedSearchResult[] {
  const sessionsWithSummary = new Set<string>();
  for (const r of results) {
    if (r.origin === "session-summary" && r.sessionId !== null) {
      sessionsWithSummary.add(r.sessionId);
    }
  }
  return results.filter((r) => {
    if (r.origin !== "conversation-turn") return true;
    if (r.sessionId === null) return true;
    return !sessionsWithSummary.has(r.sessionId);
  });
}

// Re-export the MemoryEntry type for downstream convenience (the orchestrator
// does not construct MemoryEntries itself, but callers of this module often
// need the shape).
export type { MemoryEntry };
