# Phase 67: Resume Auto-Injection - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped per established v1.9 pattern)

<domain>
## Phase Boundary

An agent waking up after a gap receives a structured context brief of recent sessions so it can naturally reference prior conversations without the user repeating themselves.

The scope is the wiring between `ConversationStore` session summaries (MemoryEntries with `source="conversation"`, tagged `["session-summary", "session:{id}"]` from Phase 66) and the context assembly pipeline (`src/manager/context-assembler.ts`, `src/manager/session-config.ts`). It introduces a new dedicated context-assembly section (`conversation_context`) with its own token budget and its own injection logic. It does NOT replace or share the existing `resume_summary` section.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase. Use ROADMAP phase goal, success criteria, research findings, and codebase conventions to guide decisions.

Key research guidance (locked in prior decisions logged in STATE.md):

- Auto-inject uses a **dedicated `conversation_context` budget** (default 2000-3000 tokens, configurable via `conversation.conversationContextBudget` or equivalent perf field) — does **NOT** share the `resume_summary` budget introduced in Phase 52/53
- Injection lands in the **mutable suffix** of the context-assembler output (same block as `discordBindings` and `contextSummary`) so it never invalidates the cached stable prefix
- Gap threshold default **4 hours**, configurable (e.g. `conversation.resumeGapThresholdHours`) — on restart, if time-since-last-session-end < threshold, skip injection entirely (SESS-03)
- Recent session count default **3**, configurable via `conversation.resumeSessionCount` (SESS-02)
- Source data: query the agent's MemoryStore for entries with `source === "conversation"` and tag `"session-summary"`, ordered by `createdAt DESC`, limit N — reuses standard MemoryStore APIs (SESS-04 means summaries are already standard MemoryEntries)
- Zero history → produce empty string (not an empty heading or placeholder) — caller/renderer must handle empty gracefully so no broken section appears in the prompt
- New context-assembler `SectionName` addition: `"conversation_context"` — added to `SECTION_NAMES` in both `context-assembler.ts` and `performance/context-audit.ts` for traceability on `section_tokens`
- Budget strategy: `passthrough` (measured, not auto-truncated) — budget enforcement happens BEFORE the string is handed to the assembler, mirroring how `resumeSummary` is enforced in `src/memory/context-summary.ts::enforceSummaryBudget`
- Integration point: `buildSessionConfig` in `src/manager/session-config.ts` — assembles `conversationContext` source string from ConversationStore + MemoryStore before calling `assembleContext`
- Schema additions flow through `src/config/schema.ts` (Zod) + `src/shared/types.ts` → `ResolvedAgentConfig.conversation` branch

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConversationStore.listSessions(agentName, options)` — already queries session rows; can fetch last N ended/crashed/summarized sessions ordered by start time
- `MemoryStore.searchByTag("session-summary")` / tag-based lookups — session summaries land here as standard MemoryEntries (Phase 66)
- `context-assembler.ts` — existing per-section budget infrastructure (`MemoryAssemblyBudgets`, `SectionTokenCounts`, `BudgetWarningEvent`) is the correct plug-in point
- `context-summary.ts::enforceSummaryBudget` — reference pattern for pre-enforcement budget truncation
- `session-config.ts::buildSessionConfig` — existing orchestrator that composes all context sources before calling `assembleContext`

### Established Patterns
- Per-section token budgets with named strategy (warn-and-keep / drop-lowest-importance / truncate-bullets / passthrough)
- Dedicated section name added to canonical `SECTION_NAMES` in both assembler + audit tooling
- Zod schema additions: add under `conversation` branch in agent config schema, flow through `resolveAgentConfig`
- Immutable frozen returns, prepared statements, nanoid-based identifiers
- Test doubles via in-memory SQLite fixtures; SessionAdapter/MemoryStore injection via constructor options

### Integration Points
- `src/manager/session-config.ts` — where the conversation brief is assembled from MemoryStore + ConversationStore
- `src/manager/context-assembler.ts` — new section `conversation_context` with its own budget + section_tokens entry
- `src/performance/context-audit.ts` — add `conversation_context` to `SECTION_NAMES` for audit CLI visibility
- `src/config/schema.ts` + `src/shared/types.ts` — new `conversation.resumeSessionCount`, `conversation.resumeGapThresholdHours`, and budget knob

</code_context>

<specifics>
## Specific Ideas

- The 4-hour gap threshold explicitly targets short restarts (crash recovery, config reload, systemd restart) — these should NOT reinject context that's already fresh in the user's memory. Measured from last session's `endedAt` (or `startedAt` if still active when process exited) to "now" at session-start time.
- "Zero history" covers two cases: (a) first session ever (no ConversationStore sessions exist), (b) sessions exist but none have `summaryMemoryId` yet. Both → empty brief, no section rendered.
- The brief structure should be markdown-rendered with a stable heading (so prompt-cache remains stable turn-to-turn when the brief is unchanged) but the heading is omitted when the body is empty.
- Budget enforcement happens on the **rendered brief string** (not per-summary) so the last N summaries can overflow naturally and the enforcer trims the oldest first.

</specifics>

<deferred>
## Deferred Ideas

- Cross-agent conversation handoff context (ADV-03 in REQUIREMENTS.md) — out of scope for v1.9
- Proactive mid-turn conversation surfacing (ADV-02) — out of scope
- Topic threading across sessions (ADV-01) — out of scope; session summaries provide sufficient grouping
- Deep on-demand search (RETR-01/02/03) — belongs to Phase 68, not 67

</deferred>
