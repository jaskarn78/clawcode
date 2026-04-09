# Phase 6: Memory Consolidation Pipeline - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers automatic consolidation of daily session logs into weekly and monthly digests. After this phase, an agent's daily conversation noise becomes structured knowledge — weekly digests summarize 7 days of logs, monthly digests synthesize 4 weeks, and raw daily logs are archived out of active search. No relevance decay, no deduplication, no tiering — those build on top of this.

</domain>

<decisions>
## Implementation Decisions

### Consolidation Trigger
- **D-01:** Consolidation runs as a heartbeat check (daily check interval) — reuses Phase 5's extensible check framework
- **D-02:** Weekly consolidation triggers when 7+ daily logs exist without a corresponding weekly digest
- **D-03:** Monthly consolidation triggers when 4+ weekly digests exist without a corresponding monthly digest
- **D-04:** Consolidation is idempotent — running it multiple times doesn't create duplicate digests

### Digest Format
- **D-05:** LLM-powered structured extraction via the agent's own session
- **D-06:** Each digest contains: key facts, decisions made, topics discussed, important context preserved
- **D-07:** Digests stored as both markdown files (`memory/digests/weekly-YYYY-WNN.md`, `memory/digests/monthly-YYYY-MM.md`) and as memory entries in SQLite with embeddings
- **D-08:** Digest memory entries have source="consolidation" and higher default importance (0.7 for weekly, 0.8 for monthly)

### Archive Behavior
- **D-09:** Consolidated daily logs moved to `memory/archive/YYYY/` subdirectory
- **D-10:** Archived logs removed from session_logs table in SQLite (excluded from active search)
- **D-11:** Archive preserves original files unmodified — they're still accessible on disk if needed
- **D-12:** Weekly source dailies archived after weekly digest created; weekly digests archived after monthly digest created

### Summarization
- **D-13:** Use the agent's own session via `sendAndCollect` to generate summaries — the agent knows what matters in its context
- **D-14:** Summary prompt includes the raw daily logs and asks for structured extraction
- **D-15:** Configurable summarization model override in clawcode.yaml (default: agent's model, can set to haiku for cost)

### Claude's Discretion
- Exact summary prompt wording
- Digest markdown template layout
- How to handle partial weeks (< 7 days at month boundary)
- Whether to include token/word count metadata in digests

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Codebase
- `src/memory/session-log.ts` — SessionLogger (writes daily logs, tracks in session_logs table)
- `src/memory/store.ts` — MemoryStore (insert memories with embeddings)
- `src/memory/embedder.ts` — EmbeddingService (generate embeddings for digest entries)
- `src/memory/types.ts` — MemoryEntry, SessionLogEntry types
- `src/heartbeat/runner.ts` — HeartbeatRunner (add consolidation as a check)
- `src/heartbeat/checks/` — Directory for pluggable checks (drop in consolidation check)
- `src/manager/session-manager.ts` — SessionManager with sendToAgent/forwardToAgent
- `src/config/schema.ts` — Config schema (extend with consolidation settings)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/memory/session-log.ts`: SessionLogger with `getLogFiles()` — can list daily logs for consolidation
- `src/memory/store.ts`: MemoryStore.insert() — store digest memory entries with embeddings
- `src/memory/embedder.ts`: EmbeddingService — embed digest content for semantic search
- `src/heartbeat/checks/`: Drop-in check directory — add `consolidation.ts` check module
- `src/manager/session-manager.ts`: `sendToAgent()` — use agent's own session for summarization

### Established Patterns
- Heartbeat checks: `{ name, interval?, execute }` interface
- Memory entries: `{ content, source, importance, tags }` structure
- Daily logs: `memory/YYYY-MM-DD.md` format with timestamped entries
- Atomic file operations from registry pattern

### Integration Points
- HeartbeatRunner: consolidation check runs on daily interval
- SessionLogger: needs `getLogFiles()` and `archiveLog()` methods
- MemoryStore: store digest entries with "consolidation" source
- Config: add consolidation settings (enable, model override, intervals)

</code_context>

<specifics>
## Specific Ideas

- Consolidation should log progress to heartbeat.log so the user can track what was consolidated
- If summarization fails (agent error, token limit), mark the period as "failed" and retry next cycle
- Weekly digest file naming: `weekly-YYYY-W01.md` through `weekly-YYYY-W52.md`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-memory-consolidation-pipeline*
*Context gathered: 2026-04-09*
