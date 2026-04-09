# Phase 4: Memory System - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the per-agent persistent memory system. After this phase, each agent has its own SQLite database for storing and retrieving memories, conversations are flushed to daily markdown session logs, context auto-compacts at a configurable threshold with memory preservation, and semantic search returns relevant results ranked by similarity. No consolidation, no decay, no deduplication — those are v1.x features.

</domain>

<decisions>
## Implementation Decisions

### SQLite Schema
- **D-01:** Each agent gets its own SQLite database file at `{workspace}/memory/memories.db`
- **D-02:** Primary `memories` table: id (TEXT UUID), content (TEXT), source (TEXT: conversation|manual|system), importance (REAL 0-1, default 0.5), access_count (INTEGER, default 0), embedding (BLOB, 384-dim float32 via sqlite-vec), tags (TEXT, JSON array), created_at (TEXT ISO), updated_at (TEXT ISO), accessed_at (TEXT ISO)
- **D-03:** `session_logs` table: id (TEXT UUID), date (TEXT YYYY-MM-DD), file_path (TEXT), entry_count (INTEGER), created_at (TEXT ISO)
- **D-04:** Use better-sqlite3 for synchronous SQLite access (faster, simpler for single-process use)
- **D-05:** WAL mode enabled for concurrent read performance
- **D-06:** sqlite-vec extension loaded for vector similarity search

### Embedding Strategy
- **D-07:** Local embeddings via `@huggingface/transformers` with `all-MiniLM-L6-v2` model (384 dimensions)
- **D-08:** Embeddings generated on memory write, stored as BLOB in SQLite
- **D-09:** Pre-warm embedding model on agent startup (first call downloads ONNX model)
- **D-10:** Semantic search uses cosine similarity via sqlite-vec `vec_distance_cosine`

### Session Logs
- **D-11:** Daily markdown files at `{workspace}/memory/YYYY-MM-DD.md`
- **D-12:** Each log entry has timestamp, role (user/assistant), and content
- **D-13:** Logs flushed on compaction trigger or end-of-day boundary
- **D-14:** Session log table tracks which daily files exist with entry counts

### Auto-Compaction
- **D-15:** Context fill monitored via Agent SDK session metadata (token usage)
- **D-16:** Compaction triggers at 75% context fill threshold (configurable in clawcode.yaml)
- **D-17:** On compaction: flush current conversation to daily log, extract key facts as memories, create context summary, start fresh session with summary injected
- **D-18:** Memory extraction uses the agent itself to identify important facts from the conversation before compaction

### Memory Metadata
- **D-19:** Each memory entry has: source, importance (0-1 float), access_count, tags
- **D-20:** access_count incremented on every retrieval (search hit)
- **D-21:** accessed_at updated on every retrieval
- **D-22:** importance defaults to 0.5, can be adjusted by the agent or manually

### Claude's Discretion
- UUID generation library choice
- Exact sqlite-vec extension loading path on this Linux system
- Session log markdown formatting details
- Context summary prompt for compaction
- Number of top-K results for semantic search (recommend 10)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Codebase
- `src/manager/session-manager.ts` — SessionManager (extend for memory integration)
- `src/manager/daemon.ts` — Daemon startup (extend for memory initialization)
- `src/manager/types.ts` — AgentSessionConfig (extend with memory config)
- `src/config/schema.ts` — Config schema (extend with memory settings)
- `src/shared/errors.ts` — Error classes (extend with MemoryError)

### Research
- `.planning/research/STACK.md` — sqlite-vec 0.1.9, better-sqlite3, @huggingface/transformers 4.0.1
- `.planning/research/ARCHITECTURE.md` — Tiered memory architecture
- `.planning/research/PITFALLS.md` — SQLite concurrent access, embedding cold start

### OpenClaw Reference
- `~/.openclaw/memory/*.sqlite` — Reference SQLite memory databases
- `~/.openclaw/workspace-general/MEMORY.md` — Reference curated memory format

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/manager/session-manager.ts`: SessionManager — extend with memory store per agent
- `src/manager/registry.ts`: Atomic JSON file writes — reuse pattern for session log tracking
- `src/shared/errors.ts`: Error class pattern — extend with MemoryError, EmbeddingError
- Agent workspace `memory/` directory already created by Phase 1

### Established Patterns
- Immutable data patterns (readonly types, new objects)
- Zod schema validation for config
- better-sqlite3 not yet in project — new dependency
- @huggingface/transformers not yet in project — new dependency

### Integration Points
- SessionManager: hook into session lifecycle to flush memories on compaction
- Daemon: initialize memory stores for each agent at startup
- Config schema: add memory settings (compaction threshold, search top-K)

</code_context>

<specifics>
## Specific Ideas

- Memory store should be a standalone module usable independently from the agent lifecycle
- Consider a `clawcode memory search <agent> <query>` CLI command for manual memory search
- Memory extraction on compaction should be conservative — better to miss a fact than store noise

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-memory-system*
*Context gathered: 2026-04-09*
