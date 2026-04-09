# Phase 8: Tiered Memory Storage - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds hot/warm/cold memory tiers with automatic promotion. After this phase, agent context contains only hot-tier memories, warm memories are searchable in SQLite but not auto-loaded, cold memories are archived markdown excluded from search until promoted. Access patterns drive promotion between tiers.

</domain>

<decisions>
## Implementation Decisions

### Tier Definitions
- **D-01:** Hot tier: memories loaded into agent's active context (system prompt). Limited by context budget
- **D-02:** Warm tier: memories in SQLite, searchable via semantic search, not loaded by default
- **D-03:** Cold tier: archived markdown files in `memory/archive/cold/`, excluded from SQLite search
- **D-04:** Default tier for new memories: warm (they earn hot status through access frequency)

### Tier Transitions
- **D-05:** Warm → Hot: memory accessed 3+ times in last 7 days (configurable thresholds)
- **D-06:** Hot → Warm: memory not accessed for 7 days (drops from active context on next refresh)
- **D-07:** Warm → Cold: relevance score drops below configurable threshold (default 0.05, from Phase 7 decay)
- **D-08:** Cold → Warm: search hit promotes back to warm (re-inserted into SQLite with fresh embedding)

### Hot Tier Management
- **D-09:** Hot tier budget: configurable max memories in context (default 20)
- **D-10:** Hot tier refreshed on session start and after compaction — queries warm tier for top candidates
- **D-11:** Hot memories injected into system prompt as a "## Key Memories" section
- **D-12:** Refresh uses combined relevance score (Phase 7) to select top-N from warm tier

### Cold Storage
- **D-13:** Cold tier uses archived markdown format (one file per memory with metadata header)
- **D-14:** Cold memories removed from SQLite `memories` and `vec_memories` tables to keep DB lean
- **D-15:** Cold archive includes embedding as base64 in markdown metadata for fast re-warming

### Claude's Discretion
- Exact format of cold archive markdown files
- Hot tier refresh frequency beyond session start
- Whether to add a `clawcode memory tiers <agent>` CLI command

</decisions>

<canonical_refs>
## Canonical References

### Existing Codebase
- `src/memory/store.ts` — MemoryStore (extend with tier management)
- `src/memory/search.ts` — SemanticSearch (warm tier search, already has relevance scoring)
- `src/memory/decay.ts` — calculateRelevanceScore (used for cold threshold)
- `src/memory/relevance.ts` — scoreAndRank (used for hot selection)
- `src/memory/types.ts` — MemoryEntry (add tier field)
- `src/manager/session-manager.ts` — buildSessionConfig (inject hot memories into system prompt)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 7's relevance scoring selects hot candidates from warm tier
- Phase 7's decay score determines cold demotion threshold
- Phase 6's archive pattern (move files to subdirectory) reusable for cold storage
- SessionManager.buildSessionConfig() — inject hot memories section

### Integration Points
- MemoryStore: add tier field, cold archival, warm re-insertion
- SemanticSearch: only search warm tier (cold excluded from SQLite)
- SessionManager: hot tier injection into system prompt
- Heartbeat: optional tier maintenance check

</code_context>

<specifics>
## Specific Ideas
- Tier transitions should be logged for debugging
- Cold archive should be browsable (`memory/archive/cold/`) with human-readable filenames

</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 08-tiered-memory-storage*
*Context gathered: 2026-04-09*
