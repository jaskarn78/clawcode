# Phase 17: Context Summary on Resume - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

When a session resumes after compaction or restart, inject a structured summary of the previous conversation into the system prompt. This gives the agent continuity of context. Extends CompactionManager to generate and store summaries. SessionManager injects the summary into system prompt on resume.

</domain>

<decisions>
## Implementation Decisions

### Summary Generation
- **D-01:** CompactionManager generates a structured summary during the compaction workflow
- **D-02:** Summary includes: key topics discussed, decisions made, pending tasks, user preferences observed
- **D-03:** Summary is stored as a markdown file in the agent's memory directory: `context-summary.md`
- **D-04:** Summary is also stored in a `context_summaries` table in SQLite for history

### Summary Injection
- **D-05:** SessionManager reads the latest context summary when building session config
- **D-06:** Summary is injected into the system prompt under a `## Context Summary (from previous session)` section
- **D-07:** If no summary exists (fresh agent), no section is injected
- **D-08:** Summary is kept concise -- max 500 words to avoid bloating the system prompt

### Storage Schema
- **D-09:** SQLite table: `context_summaries(id, agent_name, summary, session_id, created_at)`
- **D-10:** Only the latest summary is injected; historical summaries retained for audit

### Claude's Discretion
- Summary template/format details
- How to handle summary conflicts on rapid compaction
- Whether to version summaries

</decisions>

<canonical_refs>
## Canonical References
- `src/memory/compaction.ts` -- CompactionManager (extend for summary generation)
- `src/manager/session-manager.ts` -- buildSessionConfig (inject summary)
- `src/memory/store.ts` -- MemoryStore (add summary table)
- `src/memory/schema.ts` -- Memory config schema
</canonical_refs>

<code_context>
## Reusable Assets
- CompactionManager.flush() workflow as extension point
- buildSessionConfig contextSummary parameter already exists in AgentSessionConfig
- MemoryStore SQLite migration pattern for new tables
- Session log markdown format for summary input
</code_context>

<specifics>
## Specific Ideas
- Summary could include a "what I was working on" section for task continuity
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 17-context-summary-on-resume*
