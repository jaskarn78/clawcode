# Phase 68: Conversation Search + Deep Retrieval - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped per established v1.9 pattern)

<domain>
## Phase Boundary

Agents can search older conversation history on demand when the auto-injected brief from Phase 67 is insufficient — via semantic search over session summaries (existing MemoryStore + sqlite-vec path) and full-text search over raw turns (new FTS5 path on the `conversation_turns` table created in Phase 64), with paginated (max 10 per page) and time-decay-weighted results.

Scope is:
- Extend the existing `memory_lookup` MCP tool with a `scope` parameter (`"memories"` default, `"conversations"`, or `"all"`) — backward-compatible (omitting `scope` preserves current behavior)
- Add an FTS5-backed search API on raw conversation turns (`src/memory/conversation-store.ts` or sibling module)
- Implement pagination + time-decay weighting across the merged result set
- Wire through the daemon IPC handler + MCP server tool definition so agents can call it

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase. Use ROADMAP phase goal, success criteria, research findings, and codebase conventions to guide decisions.

Key research guidance (locked in prior decisions logged in STATE.md):

- FTS5 virtual table already created on raw-turn text in Phase 64 (per REQUIREMENTS.md CONV-03 traceability). Phase 68 ADDs the query surface, not the schema.
- Semantic search reuses `MemoryStore` + `sqlite-vec` KNN search — session summaries are already standard MemoryEntries with `source="conversation"` tag from Phase 66 (SESS-04).
- `memory_lookup` MCP tool already exists (src/mcp/server.ts) — extend its parameter schema with `scope` (Zod enum: `"memories" | "conversations" | "all"`, default `"memories"` for backward compatibility)
- Pagination: max 10 results per page, cursor or offset-based (Claude's discretion; cursor is more robust if multiple writes happen between pages, but offset is simpler for agent-facing consumption)
- Time-decay weighting: reuse the existing decay formula from `src/memory/decay.ts` if compatible, otherwise a multiplicative decay factor applied to combined relevance score (half-life configurable — default reuse memory default of 14 days)
- Zero new npm dependencies
- Integration point: daemon IPC handler in `src/manager/daemon.ts` or `src/ipc/server.ts` for the search method; MCP tool wrapper in `src/mcp/server.ts`
- Response shape should include origin tag per result (`source: "memory"` vs `source: "conversation-turn"` vs `source: "session-summary"`) so the agent can reason about provenance

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `MemoryStore.searchSimilar(query, k)` — existing KNN search via sqlite-vec
- `MemoryStore.findByTag("session-summary")` — reusable for `scope="conversations"` with summary filtering
- `ConversationStore` — existing session+turn CRUD (Phase 64); needs a search method added
- `src/memory/decay.ts` — existing time-decay utility to reuse (or mirror)
- `src/mcp/server.ts` — existing `memory_lookup` tool definition to extend
- `src/ipc/server.ts` + `src/ipc/protocol.ts` — existing JSON-RPC 2.0 over Unix socket; add a new method or extend existing

### Established Patterns
- Tool parameter schema validation via Zod
- Daemon IPC method → SessionManager/MemoryStore method → MCP tool exposure
- Prepared SQL statements + Object.freeze on returned arrays
- Per-agent DB access (never cross-agent)
- Pagination via explicit page/limit parameters passed through IPC

### Integration Points
- `src/memory/conversation-store.ts` — add `searchTurns(query, options)` (FTS5 MATCH query)
- `src/memory/store.ts` — existing semantic search path; maybe a `searchByScope` helper
- `src/mcp/server.ts::memory_lookup` tool schema + handler — add `scope` parameter
- `src/manager/daemon.ts` or `src/ipc/server.ts` IPC handler — route the enhanced lookup
- `src/ipc/protocol.ts` — extend the Zod schema for the IPC method if a new method is added

</code_context>

<specifics>
## Specific Ideas

- The `scope="all"` path should merge (semantic MemoryEntry results) + (FTS5 raw-turn results) and rank by decay-weighted combined relevance; duplicates (e.g., a raw turn whose containing session is also in the summary list) should prefer the summary.
- Session-summary entries should be searchable under both `scope="memories"` (by default, since they are MemoryEntries) AND `scope="conversations"` (because they are logically conversation data) — document this clearly in the tool description so agent policies can choose.
- "Max 10 per page" is a hard cap — even if `scope="all"` produces more, the first page returns at most 10 and the agent must request additional pages.
- Pagination response should include `hasMore: boolean` and either a `nextCursor` or `nextOffset` field.

</specifics>

<deferred>
## Deferred Ideas

- Cross-agent conversation search (ADV-03) — out of scope; per-agent DB is the boundary
- Proactive mid-turn conversation surfacing (ADV-02) — out of scope
- Conversation topic threading across sessions (ADV-01) — out of scope
- FACT-01 / FACT-02 (structured fact extraction, preference tracking) — v1.9.x, not this phase

</deferred>
