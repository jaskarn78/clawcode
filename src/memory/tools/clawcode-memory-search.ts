/**
 * Phase 115 Plan 05 sub-scope 7 — `clawcode_memory_search` MCP tool.
 *
 * Pure-DI tool function. The agent calls this to search its own per-agent
 * memory store (memory_chunks + memories tables) via the existing
 * Phase 90 MEM-03 hybrid-RRF retrieval primitive. Returns top-K snippets
 * with memory IDs the agent can pass to `clawcode_memory_recall` for the
 * full body.
 *
 * Per-agent isolation: `agentName` is taken from the calling session/auth
 * context (resolved daemon-side via `validateStringParam(params, "agent")`)
 * and threaded through `deps`. Because the per-agent MemoryStore is also
 * resolved daemon-side via `manager.getMemoryStore(agent)`, the tool can
 * only ever see the calling agent's memories. Phase 90's per-agent-DB
 * isolation lock holds.
 *
 * SECURITY: snippets are capped at 500 chars per hit (Pain Point #2 — the
 * pre-115 path leaked giant blobs into the prompt; lazy-load tools must
 * not regress this). Threat model row 4 (prompt injection through memory
 * content) is mitigated by the snippet cap + Phase 999.1 directive set on
 * the calling agent.
 */

import { z } from "zod/v4";
import type { MemoryStore } from "../store.js";
import type { EmbeddingService } from "../embedder.js";
import { retrieveMemoryChunks } from "../memory-retrieval.js";

/** Zod schema for the tool's input — exposed so the MCP server can derive the tool spec shape. */
export const SEARCH_INPUT_SCHEMA = z.object({
  query: z.string().min(1).max(2000),
  k: z.number().int().min(1).max(50).optional().default(10),
  /**
   * Phase 115 sub-scope 7 — optional include-tag filter applied AFTER
   * retrieval. Pre-filtered hits whose tags don't intersect this list are
   * dropped. Empty / undefined → no filter. Memories without tags are NOT
   * returned when this is set.
   */
  includeTags: z.array(z.string()).optional(),
  /** Optional exclude-tag filter passed through to retrieveMemoryChunks. */
  excludeTags: z.array(z.string()).optional(),
});

/** Input shape BEFORE zod defaults apply (k optional). */
export type SearchInput = z.input<typeof SEARCH_INPUT_SCHEMA>;

export interface SearchHit {
  /** Memory ID (chunk_id for memory_chunks, memory_id for memories). */
  readonly memoryId: string;
  /** Optional heading from a memory_chunks row. */
  readonly heading?: string | null;
  /** Snippet — first 500 chars of the body, regardless of source. */
  readonly snippet: string;
  /** Fused RRF + path-derived score. Higher is better. */
  readonly score: number;
  /** Whether the hit came from memory_chunks ("chunk") or memories ("memory"). */
  readonly source: "chunk" | "memory";
  /** Path of the originating file (memory_chunks) or synthetic memory:<id> (memories). */
  readonly path?: string;
}

export interface SearchDeps {
  readonly store: MemoryStore;
  readonly embedder: Pick<EmbeddingService, "embed">;
  /**
   * agentName is sourced from the daemon's session/auth context (via
   * validateStringParam(params, "agent") at the IPC handler), NEVER from
   * the tool input. Threat model row 3 (per-agent isolation breach)
   * mitigation.
   */
  readonly agentName: string;
  readonly log?: {
    readonly debug?: (
      obj: Record<string, unknown>,
      msg?: string,
    ) => void;
    readonly warn?: (msg: string) => void;
  };
}

export interface SearchResult {
  readonly hits: ReadonlyArray<SearchHit>;
  readonly agentName: string;
}

const SNIPPET_MAX_CHARS = 500;

/**
 * Phase 115 Plan 05 sub-scope 7 — `clawcode_memory_search` tool body.
 *
 * Pure-DI: no daemon imports, no fs imports. Production wiring at the
 * daemon edge resolves `store` + `embedder` + `agentName` from the per-
 * agent MemoryStore + manager.getEmbedder().
 */
export async function clawcodeMemorySearch(
  input: SearchInput,
  deps: SearchDeps,
): Promise<SearchResult> {
  const parsed = SEARCH_INPUT_SCHEMA.parse(input);

  const chunks = await retrieveMemoryChunks({
    query: parsed.query,
    store: deps.store,
    embed: (q) => deps.embedder.embed(q),
    topK: parsed.k,
    timeWindowDays: 14,
    tokenBudget: 4000,
    excludeTags: parsed.excludeTags,
    agent: deps.agentName,
    log: deps.log
      ? { debug: deps.log.debug as (obj: Record<string, unknown>, msg?: string) => void }
      : undefined,
  });

  const hits: SearchHit[] = [];
  for (const c of chunks) {
    const memoryId = c.chunkId ?? "";
    if (memoryId.length === 0) continue;
    const body = c.body ?? "";
    hits.push({
      memoryId,
      heading: c.heading,
      snippet: body.length > SNIPPET_MAX_CHARS ? body.slice(0, SNIPPET_MAX_CHARS) : body,
      score: c.fusedScore ?? 0,
      source: c.source,
      path: c.path,
    });
  }

  // Optional includeTags filter: applied post-retrieval since memory_chunks
  // hits don't carry tags through retrieveMemoryChunks (only memories side
  // does, internally). When includeTags is set we conservatively skip
  // memory_chunks hits (no tag info to match) — this preserves "I asked
  // for tagged-only memories" intent.
  if (parsed.includeTags && parsed.includeTags.length > 0) {
    const wanted = new Set(parsed.includeTags);
    const filtered = hits.filter((h) => {
      if (h.source === "chunk") return false;
      // memory-side hit: re-fetch tags via store.getById (per-agent isolated).
      const entry = deps.store.getById(h.memoryId);
      if (!entry) return false;
      return entry.tags.some((t) => wanted.has(t));
    });
    return { hits: Object.freeze(filtered), agentName: deps.agentName };
  }

  return { hits: Object.freeze(hits), agentName: deps.agentName };
}
