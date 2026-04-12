# Phase 36: Knowledge Graph Foundation - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Agent memories are structurally linked via wikilinks and queryable as a graph. This phase adds `[[wikilink]]` syntax support to the memory system, builds an SQLite adjacency list for graph edges, and exposes backlink queries — all within the existing per-agent memory architecture.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key constraints from project decisions:
- Knowledge graph uses SQLite adjacency list (no graphology), zero new dependencies
- Local embeddings stay (384-dim sufficient for graph similarity)
- Per-agent SQLite isolation — graph edges stored in same per-agent memory.db

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/memory/store.ts` — `MemoryStore` class with prepared statements, WAL mode, sqlite-vec loaded
- `src/memory/search.ts` — `SemanticSearch` with KNN vector queries
- `src/memory/consolidation.ts` — time-based memory consolidation (must preserve edges)
- `src/memory/tiers.ts` / `tier-manager.ts` — hot/warm/cold tiering (must preserve edges on tier transitions)
- `src/memory/episode-store.ts` / `episode-archival.ts` — episodic memory archival (edge preservation model)
- `src/memory/decay.ts` — relevance decay scoring
- `src/memory/dedup.ts` — duplicate detection on insert

### Established Patterns
- All domain objects returned as frozen with `Object.freeze()`
- `readonly` on all type properties
- Prepared statements for all SQL operations
- Zod schemas for config validation (import from `zod/v4`)
- Named error classes extending `Error` with contextual readonly fields
- `.js` extension on all imports (ESM with NodeNext resolution)
- `node:` prefix for Node built-ins
- Constructor injection for dependencies
- Tests in `__tests__/` subdirectory with vitest

### Integration Points
- `MemoryStore` in `src/memory/store.ts` — add graph tables to schema, add link extraction on insert
- `AgentMemoryManager` in `src/manager/session-memory.ts` — expose graph queries
- `src/memory/consolidation.ts` — hook edge preservation into consolidation operations
- `src/memory/tiers.ts` — ensure tier transitions preserve graph edges

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
