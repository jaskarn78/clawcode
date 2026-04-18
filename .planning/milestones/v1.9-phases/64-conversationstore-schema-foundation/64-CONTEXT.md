# Phase 64: ConversationStore + Schema Foundation - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped per research coverage)

<domain>
## Phase Boundary

Every Discord conversation turn has a durable, queryable home in per-agent SQLite with session grouping, provenance tracking, and lineage links from extracted memories back to their source turns.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, research findings (ARCHITECTURE.md, STACK.md, PITFALLS.md), and codebase conventions to guide decisions.

Key research guidance:
- New tables (conversation_turns, conversation_sessions) go in existing memories.db via migrateGraphLinks-style migration
- ConversationStore class follows episode-store.ts pattern
- Provenance fields (discord_user_id, channel_id, is_trusted_channel) on every turn from day one
- source_turn_ids FK on memories table for lineage tracking
- No per-turn embeddings — only session summaries get embedded later

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discuss phase skipped.

</deferred>
