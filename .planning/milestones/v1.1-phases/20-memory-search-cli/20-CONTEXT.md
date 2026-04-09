# Phase 20: Memory Search CLI - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Add CLI commands for searching and browsing agent memory. `clawcode memory search <agent> <query>` performs semantic search against the agent's SQLite memory store. `clawcode memory list <agent>` provides browsable memory listings. Results display relevance scores and metadata.

</domain>

<decisions>
## Implementation Decisions

### Search Command
- **D-01:** `clawcode memory search <agent> <query>` performs semantic search via embeddings
- **D-02:** Search connects to the daemon via IPC to use the running agent's memory store and embedder
- **D-03:** Results display: content (truncated), relevance score, source, tier, created date, access count
- **D-04:** Optional `--top-k <N>` flag (default: 10) to control result count
- **D-05:** Optional `--tier <hot|warm|cold>` flag to filter by memory tier

### List Command
- **D-06:** `clawcode memory list <agent>` lists memories sorted by most recently accessed
- **D-07:** Supports `--tier <hot|warm|cold>` filter
- **D-08:** Supports `--limit <N>` for pagination (default: 20)
- **D-09:** Shows: id (truncated), content (truncated), tier, importance, last accessed

### IPC Methods
- **D-10:** New IPC method `memory-search` with params: agent, query, topK, tier
- **D-11:** New IPC method `memory-list` with params: agent, tier, limit, offset

### Claude's Discretion
- Table formatting details
- How to handle agent not running (search requires embedder)
- Whether to support --format json for machine-readable output

</decisions>

<canonical_refs>
## Canonical References
- `src/memory/search.ts` -- SemanticSearch class
- `src/memory/store.ts` -- MemoryStore operations
- `src/memory/embedder.ts` -- EmbeddingService for query embedding
- `src/ipc/protocol.ts` -- IPC methods
- `src/cli/commands/skills.ts` -- CLI command pattern reference
- `src/manager/daemon.ts` -- IPC routing
- `src/manager/session-manager.ts` -- getMemoryStore, getEmbedder accessors
</canonical_refs>

<code_context>
## Reusable Assets
- CLI command registration pattern from skills.ts, schedules.ts
- IPC method routing in daemon.ts
- SemanticSearch.search() for vector queries
- MemoryStore for direct listing
- EmbeddingService.embed() for query embedding
</code_context>

<specifics>
## Specific Ideas
- Color-coded tier indicators in output
- `clawcode memory stats <agent>` showing counts per tier
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 20-memory-search-cli*
