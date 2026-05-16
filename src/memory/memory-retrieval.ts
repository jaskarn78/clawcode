/**
 * Phase 90 MEM-03 — hybrid RRF memory retrieval.
 *
 * Pre-turn retrieval entry point called by TurnDispatcher's
 * dispatchStream hook. Combines two rankers:
 *   1. vec_memory_chunks cosine top-20 (semantic similarity).
 *   2. memory_chunks_fts BM25-ranked top-20 (lexical match).
 *
 * Ranks are fused via Reciprocal Rank Fusion (RRF) with k=60 per D-RRF
 * default. Path-derived score_weight (vault/procedures/archive per D-19)
 * is additively applied post-fusion so standing rules nudge ahead of
 * dated session notes at equal distance. The D-24 time-window filter
 * drops stale dated files before top-K truncation. Token-budget cap
 * (~2000 tokens, tunable) stops accumulation to stay under the mutable-
 * suffix budget.
 *
 * Pure module: no side-effects, no ambient state. Store + embed are DI'd
 * so the retrieval path is fully testable without a daemon. Callers
 * (SessionManager.getMemoryRetrieverForAgent) curry per-agent store/embed.
 */

import type { MemoryStore } from "./store.js";
import { applyTimeWindowFilter } from "./memory-chunks.js";
import { rerankTop, type RerankFn, type RerankerLogger } from "./reranker.js";

export type EmbedFn = (text: string) => Promise<Float32Array>;

export type MemoryRetrievalResult = Readonly<{
  chunkId: string;
  path: string;
  heading: string | null;
  body: string;
  /** Fused RRF score + path-derived weight (higher = better). */
  fusedScore: number;
  /** Path-derived nudge (vault +0.2, procedures +0.1, archive -0.2, else 0). */
  scoreWeight: number;
  /**
   * Phase 100-fu — surface the result originated from. "chunk" = file-scanner
   * memory_chunks (MEMORY.md sections). "memory" = the agent's own saved
   * memories (memory_save). Additive field — pre-existing callers that
   * don't read it stay unaffected. The wrapper rendering in
   * turn-dispatcher.augmentWithMemoryContext uses {heading,path,body} only,
   * so memory-sourced results render cleanly via path="memory:<id>" and
   * heading=null fallback.
   */
  source: "chunk" | "memory";
}>;

/**
 * Phase 90 D-RRF — RRF fusion constant. 60 is the Cormack/Clarke
 * canonical value used in most RRF implementations; it compresses the
 * score range enough that small additive weights (scoreWeight ≤ 0.2)
 * act as tiebreakers rather than dominators.
 */
export const RRF_K = 60;

/**
 * Phase 999.43 Plan 03 Task 2 — D-02 score formula applied to memory
 * chunks whose `path` starts with `document:` (cross-ingested via
 * `src/document-ingest/cross-ingest.ts` per Phase 101 Plan 03 CF-1).
 *
 * The post-RRF rank pass calls this helper BEFORE the reranker gate so
 * priority-weighted document chunks influence pre-rerank ordering per
 * Phase 999.43 SC-D. Non-document candidates pass through unchanged.
 *
 * Multipliers (LOCKED VERBATIM):
 *   agentWeight  (D-01 axis 1): 1.5 / 1.0 / 0.7 — caller resolves from
 *     the agent's LIVE `ingestionPriority` config (hot-reload honored).
 *   contentWeight (D-01 axis 2): 1.5 / 1.0 / 0.5 — from
 *     `documents.content_priority_weight`.
 *   recencyBoost (D-07, query-time): 1.3× if `documents.ingested_at` is
 *     within last 7 days, else 1.0×.
 *
 * Missing documents row (e.g. pre-Phase-101 leftover, or a slug that no
 * longer maps to a row) → multipliers all default to 1.0; the candidate
 * is counted in `skippedCount` for telemetry but is NOT dropped.
 *
 * The candidate `T` type is loose so both `Hydrated` (memory-retrieval's
 * internal shape with `path` + `fusedScore`) and other consumers can
 * call this helper without coupling. Output adds a `weightedFused` field
 * to each candidate.
 */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const RECENCY_BOOST = 1.3;
const DOCUMENT_PATH_PREFIX = "document:";

export function applyDocumentPriorityWeight<
  T extends { path?: string | null; fusedScore?: number },
>(
  candidates: readonly T[],
  deps: {
    /**
     * Resolve a documents row from the doc slug embedded in
     * `path = "document:<slug>"`. Return null when no row is found —
     * the multipliers will fall back to neutral 1.0 each.
     */
    readonly getDocumentRow: (
      docSlug: string,
    ) =>
      | { readonly content_priority_weight: number; readonly ingested_at: string }
      | null;
    /** LIVE per-agent multiplier resolved by caller from config. */
    readonly agentWeight: number;
    /** Test hook: override `Date.now()` for deterministic recency math. */
    readonly now?: number;
    /** Optional log sink for the per-call structured diagnostic. */
    readonly logger?: {
      debug?: (obj: Record<string, unknown>, msg?: string) => void;
    };
  },
): readonly (T & { weightedFused: number })[] {
  const now = deps.now ?? Date.now();
  let appliedCount = 0;
  let skippedCount = 0;

  const out = candidates.map((c) => {
    const fused = c.fusedScore ?? 0;
    const path = c.path ?? "";
    if (!path.startsWith(DOCUMENT_PATH_PREFIX)) {
      // Non-document candidate — pass through unchanged.
      return { ...c, weightedFused: fused };
    }
    const slug = path.slice(DOCUMENT_PATH_PREFIX.length);
    const row = deps.getDocumentRow(slug);
    if (!row) {
      // Missing provenance row → neutral multipliers. Still flagged
      // skipped for diagnostic visibility (filter inactive vs. data race).
      skippedCount += 1;
      return { ...c, weightedFused: fused * deps.agentWeight };
    }
    const contentWeight = row.content_priority_weight ?? 1.0;
    const ingestedTs = row.ingested_at ? Date.parse(row.ingested_at) : 0;
    const ageMs =
      ingestedTs > 0 ? now - ingestedTs : Number.POSITIVE_INFINITY;
    const recencyBoost = ageMs <= SEVEN_DAYS_MS ? RECENCY_BOOST : 1.0;
    appliedCount += 1;
    return {
      ...c,
      weightedFused: fused * deps.agentWeight * contentWeight * recencyBoost,
    };
  });

  if (appliedCount > 0) {
    const payload = {
      tag: "phase999.43-weight",
      appliedCount,
      skippedCount,
      agentWeight: deps.agentWeight,
    };
    deps.logger?.debug?.(payload, "phase999.43-weight applied");
    // Also fire to stdout (daemon captures via systemd) — mirrors the
    // Phase 115 phase115-tag-filter pattern.
    console.info("phase999.43-weight", JSON.stringify(payload));
  }

  return out;
}

/**
 * Fuse two ranked lists into a single score-sorted result set.
 *
 * RRF formula: score(doc) = sum over rankers of 1/(k + rank(doc)).
 * Missing-from-one-ranker docs only contribute from the ranker(s) they
 * appear in, so presence in both rankers beats presence in one.
 *
 * Rank here is POSITION in the input list (0-based), NOT the store's
 * raw distance/rank value — RRF is position-based by design so distance
 * and BM25 rank (which have incompatible units) combine cleanly.
 */
export function rrfFuse(
  vecRanked: readonly { chunk_id: string; distance: number }[],
  ftsRanked: readonly { chunk_id: string; rank: number }[],
  k: number = RRF_K,
): readonly { chunk_id: string; score: number }[] {
  const scoreMap = new Map<string, number>();
  vecRanked.forEach((r, i) => {
    scoreMap.set(
      r.chunk_id,
      (scoreMap.get(r.chunk_id) ?? 0) + 1 / (k + i + 1),
    );
  });
  ftsRanked.forEach((r, i) => {
    scoreMap.set(
      r.chunk_id,
      (scoreMap.get(r.chunk_id) ?? 0) + 1 / (k + i + 1),
    );
  });
  return Object.freeze(
    [...scoreMap.entries()]
      .map(([chunk_id, score]) => ({ chunk_id, score }))
      .sort((a, b) => b.score - a.score),
  );
}

export type RetrieveArgs = Readonly<{
  query: string;
  store: MemoryStore;
  embed: EmbedFn;
  /** Default 5 per D-RETRIEVAL. */
  topK?: number;
  /** Default 14 per D-24. */
  timeWindowDays?: number;
  /**
   * Default 1500 tokens (~6000 chars) per Phase 115 sub-scope 3 (was 2000
   * pre-115 per Phase 90 D-RETRIEVAL; lowered to leave margin for sub-scope
   * 1's tier-1 cap). Caller (SessionManager.getMemoryRetrieverForAgent) reads
   * from ResolvedAgentConfig.memoryRetrievalTokenBudget which loader resolves
   * from agent.X ?? defaults.X. Range enforced upstream by zod (500-8000).
   */
  tokenBudget?: number;
  /**
   * Phase 115 sub-scope 4 — exclude memories whose tags intersect this list
   * from the memories-side fan-out before RRF fusion. Locked operator
   * default ["session-summary","mid-session","raw-fallback"] removes
   * pollution-feedback memories that pre-115 leaked into the prompt as
   * giant blobs (research codebase-memory-retrieval.md Pain Points #3 +
   * #15). Empty / undefined → filter disabled (legacy behavior). The
   * chunks-side does NOT need this filter — memory_chunks rows don't carry
   * these tags (file-scanner only). Defensive note: filter is applied AFTER
   * `getMemoryForRetrieval` hydration since the helper already returns
   * tags as part of its row read — no extra DB query.
   */
  excludeTags?: readonly string[];
  /**
   * Phase 115 sub-scope 4 — optional logger for tag-filter diagnostics.
   * When provided, ALSO emits a structured debug log via the injected
   * sink (used by tests with vi.fn()). Production always fires a
   * `console.info("phase115-tag-filter", ...)` line independently of this
   * sink so the daemon's stdout-captured systemd logs see the event
   * regardless of DI. Mirrors the T01 phase115-quickwin pattern.
   */
  log?: { debug?: (obj: Record<string, unknown>, msg?: string) => void };
  /**
   * Phase 115 sub-scope 4 — agent identifier surfaced in the tag-filter
   * diagnostic so operator can attribute drops to a specific agent.
   * Required for the production console.info diagnostic to be useful.
   */
  agent?: string;
  /** Test hook: override Date.now() for deterministic time-window gating. */
  now?: number;
  /**
   * Phase 101 Plan 04 (D-04, U9, SC-10) — optional local cross-encoder
   * reranker over the post-time-window candidate set. When provided AND
   * `enabled` is true, takes `topNToRerank` candidates (default 20) from
   * the fused+filtered+sorted result, re-scores them with
   * `Xenova/bge-reranker-base` via `rerankTop()`, and returns the top
   * `finalTopK` (default 5) in rerank-order BEFORE the token-budget
   * truncation step. On timeout / runtime error the rerank step falls
   * back to the original RRF order (graceful degradation per T-101-12).
   *
   * Caller (`SessionManager.getMemoryRetrieverForAgent`) reads
   * `defaults.documentIngest.reranker` from `clawcode.yaml` and curries
   * this object in. When omitted entirely (tests, daemon paths that
   * don't wire the resolver, off-switch via `enabled: false`), the
   * legacy non-reranked path runs unchanged — token-budget + topK
   * truncation in fused/RRF order.
   *
   * `rerankFn` is a DI hook for unit tests so they can pass a synthetic
   * scorer without monkey-patching `@huggingface/transformers`. Production
   * callers omit it and the reranker uses the lazy-loaded HF pipeline.
   */
  reranker?: Readonly<{
    enabled: boolean;
    topNToRerank: number;
    finalTopK: number;
    timeoutMs: number;
    rerankFn?: RerankFn;
    logger?: RerankerLogger;
  }>;
  /**
   * Phase 999.43 Plan 03 Task 2 — optional document-priority weighting
   * applied BEFORE the optional reranker gate. When provided, candidates
   * whose `path` starts with `document:` are scaled by the D-02 formula
   * (agentWeight × contentWeight × recencyBoost) and re-sorted; non-doc
   * candidates pass through unchanged. When omitted, the legacy
   * Phase-90-RRF / Phase-101-reranker pipeline runs untouched —
   * back-compat preserved for all callers that don't pass this.
   */
  documentPriority?: Readonly<{
    /**
     * Resolve a documents row from the doc slug embedded in
     * `memory_chunks.path = "document:<slug>"`. Return null when
     * the docs row is absent (e.g. pre-Phase-101 leftover chunk).
     */
    readonly getDocumentRow: (
      docSlug: string,
    ) =>
      | { readonly content_priority_weight: number; readonly ingested_at: string }
      | null;
    /** LIVE per-agent multiplier resolved at call time from agent config. */
    readonly agentWeight: number;
  }>;
}>;

/**
 * Phase 90 MEM-03 — hybrid-RRF pre-turn retrieval.
 *
 * Pipeline:
 *   1. Embed the query via the injected EmbedFn (MiniLM 384-dim).
 *   2. Cosine top-20 from vec_memory_chunks.
 *   3. FTS5 BM25 top-20 from memory_chunks_fts (query sanitized in store).
 *   4. RRF fuse via 1/(k+rank) with k=60.
 *   5. Hydrate metadata (path/heading/body/file_mtime_ms/score_weight).
 *   6. Apply D-19 path weighting: fusedScore += scoreWeight.
 *   7. Apply D-24 time-window filter (drop stale dated files).
 *   8. Re-sort by fusedScore desc.
 *   9. Token-budget truncate (stop when cumulative body chars > budget*4).
 *  10. topK cap.
 *
 * Returns a frozen readonly array so callers can't accidentally mutate the
 * retrieval set between turns.
 */
export async function retrieveMemoryChunks(
  args: RetrieveArgs,
): Promise<readonly MemoryRetrievalResult[]> {
  const topK = args.topK ?? 5;
  // Phase 115 sub-scope 3 — was 2000; lowered to 1500 to align with the
  // wired-through defaults.memoryRetrievalTokenBudget. Operator override via
  // YAML; per-agent override on agentSchema. See SessionManager.getMemoryRetriever
  // ForAgent for the resolution chain.
  const tokenBudget = args.tokenBudget ?? 1500;
  const windowDays = args.timeWindowDays ?? 14;
  const now = args.now ?? Date.now();

  if (args.query.trim().length === 0) return Object.freeze([]);

  const qEmb = await args.embed(args.query);

  // Phase 100-fu — fan out chunk-side AND memory-side searches in parallel.
  // The chunks side is the file-scanner content (MEMORY.md). The memories
  // side is the agent's own saved memories (memory_save). Pre-100-fu only
  // chunks were searched, so the agent's saved memory was invisible in the
  // pre-turn <memory-context> block. After 100-fu both surface together
  // ranked by RRF — the agent sees relevant content regardless of which
  // store wrote it.
  const [vecTop, ftsTop, memoriesTop] = await Promise.all([
    Promise.resolve(args.store.searchMemoryChunksVec(qEmb, 20)),
    Promise.resolve(args.store.searchMemoryChunksFts(args.query, 20)),
    Promise.resolve(args.store.searchMemoriesVec(qEmb, 20)),
  ]);

  // Chunks side: RRF-fuse vec + FTS as before.
  const fusedChunks = rrfFuse(vecTop, ftsTop, RRF_K);

  // Memories side: pseudo-RRF score from rank position only (vec is the
  // sole ranker since memories has no FTS index). 1/(k+rank+1) keeps the
  // score scale identical to chunk-side fused scores so they sort cleanly
  // in a single combined list.
  const memoriesScored = memoriesTop.map((r, i) => ({
    memory_id: r.memory_id,
    score: 1 / (RRF_K + i + 1),
  }));

  type Hydrated = {
    chunkId: string;
    path: string;
    heading: string | null;
    body: string;
    file_mtime_ms: number;
    fusedScore: number;
    scoreWeight: number;
    source: "chunk" | "memory";
  };
  const hydrated: Hydrated[] = [];

  // Hydrate chunk-side
  for (const f of fusedChunks) {
    const meta = args.store.getMemoryChunk(f.chunk_id);
    if (!meta) continue;
    hydrated.push({
      chunkId: f.chunk_id,
      path: meta.path,
      heading: meta.heading,
      body: meta.body,
      file_mtime_ms: meta.file_mtime_ms,
      fusedScore: f.score + meta.score_weight,
      scoreWeight: meta.score_weight,
      source: "chunk",
    });
  }

  // Hydrate memory-side. Memories don't have path/heading/file_mtime_ms,
  // so we synthesize values that keep downstream rendering and the
  // time-window filter both happy:
  //   - path: "memory:<id>" — the time-window filter only excludes paths
  //     that fail the cutoff AND aren't under /memory/vault/ or
  //     /memory/procedures/. Synthetic memory: paths trivially fail the
  //     vault/procedures check, so the file_mtime_ms gate decides. We pass
  //     `now` as file_mtime_ms (memories are always "fresh" — the agent
  //     just saved them; mtime is a chunk-file concept) so the cutoff
  //     comparison ALWAYS passes.
  //   - heading: null — turn-dispatcher's renderer falls back to path on
  //     null heading, producing "### memory:<id>\n<body>" in the prompt.
  //   - score_weight: 0 — no path-derived nudge for memories.
  //
  // Phase 115 sub-scope 4 — `excludeTags` filter applied here AFTER the
  // hydration call (which already returns tags via getMemoryForRetrieval).
  // No second DB lookup needed. The filter only fires on the memories-side
  // (chunks-side rows from MEMORY.md / file scanner don't carry these
  // tags). When a memory's tags intersect excludeTags it is dropped from
  // the hydrated set BEFORE time-window + token-budget passes, preventing
  // pollution-feedback memories from consuming any of the budget. The
  // null-meta path (memory deleted between vec-search and hydration) is
  // counted as a stale-skip, NOT a tag-drop, so the diagnostic accurately
  // reflects filter activity vs. data-race silently.
  const excludeTags = args.excludeTags ?? [];
  let memTagDroppedCount = 0;
  for (const m of memoriesScored) {
    const meta = args.store.getMemoryForRetrieval(m.memory_id);
    if (!meta) continue;
    if (
      excludeTags.length > 0 &&
      meta.tags.some((t) => excludeTags.includes(t))
    ) {
      memTagDroppedCount += 1;
      continue;
    }
    hydrated.push({
      chunkId: m.memory_id,
      path: `memory:${m.memory_id}`,
      heading: null,
      body: meta.content,
      file_mtime_ms: now,
      fusedScore: m.score,
      scoreWeight: 0,
      source: "memory",
    });
  }
  // Phase 115 sub-scope 4 — operator-visible diagnostic when the filter
  // drops one or more rows. Helps operators spot when an agent's
  // pollution-feedback memories are being suppressed (good signal: filter
  // is doing work) vs always at zero (filter inactive). Two channels:
  //   1. console.info — fires unconditionally in production. Daemon
  //      captures stdout into structured logs via systemd. Mirrors the
  //      T01 phase115-quickwin pattern (session-adapter.ts).
  //   2. args.log?.debug?.() — optional sink injected by tests via vi.fn()
  //      (and by future operator-facing surfaces that want structured
  //      access without grep on stdout).
  if (memTagDroppedCount > 0) {
    const payload = {
      action: "phase115-tag-filter",
      agent: args.agent,
      dropped: memTagDroppedCount,
      excludeTags: [...excludeTags],
    };
    console.info("phase115-tag-filter", JSON.stringify(payload));
    args.log?.debug?.(payload, "phase115-tag-filter dropped memories");
  }

  const windowed = [...applyTimeWindowFilter(hydrated, windowDays, now)];
  windowed.sort((a: Hydrated, b: Hydrated) => b.fusedScore - a.fusedScore);

  // Phase 999.43 Plan 03 Task 2 — D-02 priority weighting for
  // `document:` prefix candidates BEFORE the optional reranker gate.
  // When `documentPriority` is omitted (legacy callers, tests) the
  // pipeline runs unchanged. When present, document candidates are
  // scaled by agentWeight × contentWeight × recencyBoost and re-sorted
  // so pre-rerank rank reflects priority. The reranker (next step) then
  // operates on the priority-weighted ordering — reranker logic itself
  // is unchanged (Phase 101 Plan 04 invariant honored).
  let prioritized: Hydrated[] = windowed;
  if (args.documentPriority) {
    const weighted = applyDocumentPriorityWeight<Hydrated>(windowed, {
      getDocumentRow: args.documentPriority.getDocumentRow,
      agentWeight: args.documentPriority.agentWeight,
      now,
    });
    // The weighted entries carry an extra `weightedFused` field; sort by
    // it DESC then strip it back to plain Hydrated for the downstream
    // pipeline (Hydrated.fusedScore stays at its RRF value so the
    // returned MemoryRetrievalResult.fusedScore semantics don't shift).
    const sorted = [...weighted].sort(
      (a, b) => (b.weightedFused ?? 0) - (a.weightedFused ?? 0),
    );
    prioritized = sorted.map(({ weightedFused: _drop, ...rest }) => rest);
  }

  // Phase 101 Plan 04 (D-04, U9, SC-10) — optional bge-reranker-base
  // cross-encoder pass applied to the post-time-window, RRF-sorted set
  // BEFORE the token-budget loop. Takes `reranker.topNToRerank` candidates,
  // re-scores via `(query, passage)` pairs, returns the top
  // `reranker.finalTopK` in rerank-order. The downstream token-budget +
  // topK cap then runs over this reordered list — so a more-relevant
  // candidate that was rank 6 under raw RRF can surface into the kept
  // set when rerank elevates it to top-5.
  //
  // Graceful degradation: `rerankTop` handles its own timeout + error
  // fallback (returns the original-order slice) so this code path never
  // throws even if the ONNX runtime crashes. The off-switch path
  // (`reranker.enabled === false` or `reranker` omitted) preserves the
  // pre-101-04 behavior exactly.
  let postRerank: Hydrated[] = prioritized;
  if (args.reranker && args.reranker.enabled && prioritized.length > 0) {
    const candidates = prioritized.slice(0, args.reranker.topNToRerank);
    const reranked = await rerankTop<Hydrated>(args.query, candidates, {
      topK: Math.min(args.reranker.finalTopK, candidates.length),
      timeoutMs: args.reranker.timeoutMs,
      logger: args.reranker.logger,
      rerankFn: args.reranker.rerankFn,
      getText: (h) => h.body,
    });
    postRerank = [...reranked];
  }

  // Token budget truncation. ~4 chars/token — stop accumulating when the
  // next chunk would push cumulative body chars past budget*4. Always emit
  // at least the first chunk (don't leave the caller with an empty block
  // just because it's a big one). Applied across BOTH surfaces (chunks +
  // memories) so a flood of large memories can't blow the prompt budget.
  const out: MemoryRetrievalResult[] = [];
  let acc = 0;
  const limited = postRerank.slice(0, topK);
  for (const h of limited) {
    const len = h.body.length;
    if (out.length > 0 && acc + len > tokenBudget * 4) break;
    out.push(
      Object.freeze({
        chunkId: h.chunkId,
        path: h.path,
        heading: h.heading,
        body: h.body,
        fusedScore: h.fusedScore,
        scoreWeight: h.scoreWeight,
        source: h.source,
      }),
    );
    acc += len;
  }
  return Object.freeze(out);
}
