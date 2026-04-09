# Phase 25: Episode Memory - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Agents can record and retrieve significant discrete events as first-class memory objects.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key considerations:
- Episodes are discrete event records (not session logs or digests)
- Structured fields: title, summary, importance, tags, timestamp
- Must be searchable via existing semantic search (sqlite-vec)
- Monthly archival following consolidation pipeline pattern
- OpenClaw reference: memory/episodes/ directory with discrete event records

</decisions>

<code_context>
## Existing Code Insights

### Relevant Files
- `src/memory/store.ts` — MemoryStore (insert, search, tier management)
- `src/memory/types.ts` — MemoryEntry, CreateMemoryInput, MemorySource
- `src/memory/search.ts` — SemanticSearch with relevance-aware ranking
- `src/memory/consolidation.ts` — consolidation pipeline (pattern to follow for archival)
- `src/memory/schema.ts` — memory config schema

### Established Patterns
- MemorySource union: "conversation" | "manual" | "system" | "consolidation"
- SQLite + sqlite-vec for storage and KNN search
- Importance scoring, relevance decay, tiered storage

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
