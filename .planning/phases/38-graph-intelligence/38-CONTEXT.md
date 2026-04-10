# Phase 38: Graph Intelligence - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Memory search leverages graph structure for richer retrieval, and the graph grows automatically. This phase enhances the `memory_lookup` tool to include 1-hop graph neighbors with KNN results, adds a background auto-linker job that discovers semantically similar unlinked memories and creates edges, and ensures graph expansion respects token budgets via relevance gating.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key constraints from prior phases and project decisions:
- Phase 36 built the graph foundation (memory_links adjacency table, wikilink parsing, backlink/forward-link queries)
- Phase 37 built memory_lookup MCP tool (delegates to SemanticSearch via IPC)
- Graph-enriched retrieval means enhancing SemanticSearch results to include 1-hop neighbors from memory_links
- Auto-linker uses existing EmbeddingService for similarity comparison — no new dependencies
- Token budgets mean relevance-gated neighbor inclusion (not unbounded fan-out)
- Local embeddings stay (384-dim sufficient for graph similarity) — per v1.5 roadmap decision

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/memory/graph.ts` — `getBacklinks()`, `getForwardLinks()`, `traverseGraph()` from Phase 36
- `src/memory/search.ts` — `SemanticSearch` KNN queries; enhance to include graph neighbors
- `src/memory/embedder.ts` — `EmbeddingService` for computing similarity between unlinked memories
- `src/memory/store.ts` — `MemoryStore` with `memory_links` table, `findByTag()`, graph statements
- `src/heartbeat/` — pluggable check modules; auto-linker can be a heartbeat check
- `src/mcp/server.ts` — `memory_lookup` tool from Phase 37 (result format: `{id, content, relevance_score, tags, created_at}`)
- `src/manager/daemon.ts` — `memory-lookup` IPC handler that calls SemanticSearch

### Established Patterns
- Heartbeat checks in `src/heartbeat/checks/` auto-discovered by `HeartbeatRunner`
- All domain objects frozen with `Object.freeze()`, `readonly` types
- Prepared statements for SQL operations
- Constructor injection, ESM with `.js` extensions

### Integration Points
- `src/memory/search.ts` — enhance `search()` to include 1-hop graph neighbors from results
- `src/heartbeat/checks/` — new auto-linker check module
- `src/memory/store.ts` — may need new query for unlinked memory pairs
- `src/memory/graph.ts` — may add graph-aware search helper

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
