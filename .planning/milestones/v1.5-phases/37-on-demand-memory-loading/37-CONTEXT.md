# Phase 37: On-Demand Memory Loading - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents pull relevant memories when needed via a `memory_lookup` MCP tool instead of having everything stuffed into context at session start. Agent identity loads as a compact personality fingerprint (~200-300 tokens) with full SOUL.md retrievable on demand. The hot tier is reduced (not removed) per the v1.5 hybrid loading decision.

</domain>

<decisions>
## Implementation Decisions

### Memory Lookup Tool Interface
- Tool accepts `query` (string) + optional `limit` (int, default 5) — matches existing SemanticSearch KNN pattern
- Returns array of `{id, content, relevance_score, tags, created_at}` — enough for agent to decide what's useful
- Does NOT include graph neighbors — Phase 38 adds graph-enriched retrieval (GRAPH-03)
- Registered as MCP tool via existing MCP server (`src/mcp/server.ts`) — agents already consume MCP tools

### Personality Fingerprint
- Static extraction at agent startup — parse SOUL.md headings, extract key traits, condense to bullet list (~200-300 tokens)
- Fingerprint includes: name, emoji, core personality traits (3-5), communication style, key constraints
- Full SOUL.md stored as a memory entry in agent's MemoryStore with tag `soul` and `importance: 1.0` — retrievable via `memory_lookup`
- Agent decides when to pull full SOUL.md — fingerprint includes instruction "Use memory_lookup for deeper identity context when needed"

### Migration Strategy
- Hybrid approach — keep hot memories in prompt but reduce count (top 3 instead of all), add memory_lookup for the rest. Per v1.5 roadmap: "Hybrid hot-tier + on-demand loading (pure on-demand causes confabulation)"
- Refactor `buildSessionConfig` to inject only fingerprint + top-N hot memories. Hot tier still exists but is smaller. Full removal deferred to after empirical validation
- Global rollout — all agents get memory_lookup tool and fingerprint. Consistent behavior across the fleet

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/mcp/server.ts` — MCP server with existing tools (`agent_status`, `send_message`, `spawn_subagent_thread`); add `memory_lookup` here
- `src/memory/search.ts` — `SemanticSearch` with KNN queries; `memory_lookup` delegates to this
- `src/memory/store.ts` — `MemoryStore` with `insert()` for storing SOUL.md as memory entry
- `src/memory/tier-manager.ts` — `getHotMemories()` returns hot-tier entries; reduce to top-N
- `src/manager/session-config.ts` — `buildSessionConfig()` currently injects full SOUL.md + all hot memories into system prompt; refactor target
- `src/manager/session-memory.ts` — `AgentMemoryManager` owns all memory subsystem instances per agent

### Established Patterns
- MCP tools follow `createMcpServer()` pattern with tool definitions and handler functions
- All domain objects returned as frozen with `Object.freeze()`
- Prepared statements for all SQL operations
- Constructor injection for dependencies
- ESM with `.js` extensions and `node:` prefix for built-ins

### Integration Points
- `src/mcp/server.ts` — add `memory_lookup` tool definition and handler
- `src/manager/session-config.ts` — refactor `buildSessionConfig()` for fingerprint + reduced hot tier
- `src/memory/store.ts` or new `src/memory/fingerprint.ts` — SOUL.md parsing and fingerprint generation
- Agent startup flow in `src/manager/session-manager.ts` — store SOUL.md as memory entry during init

</code_context>

<specifics>
## Specific Ideas

- The fingerprint should be generated once at startup and cached — no LLM calls needed
- SOUL.md memory entry should have `importance: 1.0` so it ranks highest in semantic search when identity-related queries are made
- Top-N hot memories (N=3) keeps the most critical memories in prompt while dramatically reducing context size
- The `memory_lookup` tool description in MCP should guide agents to use it: "Search your memory for relevant context, past decisions, and knowledge"

</specifics>

<deferred>
## Deferred Ideas

- Graph-enriched retrieval (Phase 38, GRAPH-03) — memory_lookup will be enhanced to include graph neighbors
- Context assembly pipeline with per-source token budgets (Phase 41, LOAD-03) — will formalize the budget system
- Dynamic fingerprint that evolves with agent experience — identity drift risk, explicitly out of scope

</deferred>
