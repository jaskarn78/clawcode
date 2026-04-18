# Phase 65: Capture Integration - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped per research coverage)

<domain>
## Phase Boundary

Every Discord message exchange is automatically recorded in the ConversationStore as it happens, with instruction-pattern detection flagging potential injection attempts before they enter the persistent record.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase. Use ROADMAP phase goal, success criteria, and research findings to guide decisions.

Key research guidance:
- Capture point is DiscordBridge post-response (fire-and-forget, ~5 lines) — never blocks Discord message delivery
- Instruction-pattern detection runs before storage — flags potential injection, does NOT block storage
- Session start/end detection via ConversationStore.startSession()/endSession() lifecycle
- Background embedding queue for session summaries (not per-turn embedding)
- Failure in capture never blocks the Discord message path (try/catch with log.warn)

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discuss phase skipped.

</deferred>
