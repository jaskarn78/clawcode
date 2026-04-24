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
}>;

/**
 * Phase 90 D-RRF — RRF fusion constant. 60 is the Cormack/Clarke
 * canonical value used in most RRF implementations; it compresses the
 * score range enough that small additive weights (scoreWeight ≤ 0.2)
 * act as tiebreakers rather than dominators.
 */
export const RRF_K = 60;

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
  /** Default 2000 tokens (~8000 chars) per D-RETRIEVAL. */
  tokenBudget?: number;
  /** Test hook: override Date.now() for deterministic time-window gating. */
  now?: number;
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
  const tokenBudget = args.tokenBudget ?? 2000;
  const windowDays = args.timeWindowDays ?? 14;
  const now = args.now ?? Date.now();

  if (args.query.trim().length === 0) return Object.freeze([]);

  const qEmb = await args.embed(args.query);
  const vecTop = args.store.searchMemoryChunksVec(qEmb, 20);
  const ftsTop = args.store.searchMemoryChunksFts(args.query, 20);
  const fused = rrfFuse(vecTop, ftsTop, RRF_K);

  // Hydrate + apply path weighting
  type Hydrated = {
    chunkId: string;
    path: string;
    heading: string | null;
    body: string;
    file_mtime_ms: number;
    fusedScore: number;
    scoreWeight: number;
  };
  const hydrated: Hydrated[] = [];
  for (const f of fused) {
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
    });
  }

  const windowed = [...applyTimeWindowFilter(hydrated, windowDays, now)];
  windowed.sort((a: Hydrated, b: Hydrated) => b.fusedScore - a.fusedScore);

  // Token budget truncation. ~4 chars/token — stop accumulating when the
  // next chunk would push cumulative body chars past budget*4. Always emit
  // at least the first chunk (don't leave the caller with an empty block
  // just because it's a big one).
  const out: MemoryRetrievalResult[] = [];
  let acc = 0;
  const limited = windowed.slice(0, topK);
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
      }),
    );
    acc += len;
  }
  return Object.freeze(out);
}
