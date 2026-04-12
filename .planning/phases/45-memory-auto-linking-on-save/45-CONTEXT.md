# Phase 45: Memory auto-linking on save - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning
**Mode:** Infrastructure phase — discuss skipped

<domain>
## Phase Boundary

When a memory is saved (inserted or updated), automatically discover semantically similar existing memories and create graph edges — rather than waiting for the 6-hour heartbeat cycle. The auto-linker heartbeat remains as a background catch-all but linking happens eagerly on write.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Move auto-link discovery from heartbeat-only to trigger-on-save. Reuse existing `discoverAutoLinks` from `src/memory/similarity.ts` or create a focused single-memory variant. Keep the heartbeat auto-linker as a background sweep for missed links.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/memory/similarity.ts` — `discoverAutoLinks(store)` scans all memory pairs for similarity
- `src/heartbeat/checks/auto-linker.ts` — heartbeat check that calls discoverAutoLinks every 6h
- `src/memory/graph.ts` — `extractWikilinks`, `traverseGraph`, graph utilities
- `src/memory/store.ts` — `MemoryStore` with insertMemory, insertLink, prepared statements

### Established Patterns
- Wikilinks extracted on insert via `extractWikilinks(content)` in store.ts
- Graph edges stored in `memory_links` table with INSERT OR IGNORE for idempotency
- Similarity computed via dot product on L2-normalized embeddings (sqlite-vec)
- Auto-linker skips cold-tier memories

### Integration Points
- Hook into MemoryStore's insert/update path to trigger per-memory auto-linking
- Reuse embedding vectors already computed during memory insert
- Keep heartbeat auto-linker as periodic catch-all

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
