# Phase 21: Tech Debt - Code Quality - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Codebase uses consistent structured logging, handles errors properly, and has clean module boundaries.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

### Known Issues (from tech debt audit)
- DATT-06: `cleanupAttachments()` exists in `src/discord/attachments.ts` but is never called
- `console.error` in: `src/memory/consolidation.ts:440,473`, `src/collaboration/inbox.ts:82,88`, `src/manager/daemon-entry.ts:21`
- Silent catches in: `src/discord/bridge.ts:309`, `src/manager/daemon.ts:294,298`, `src/collaboration/inbox.ts:89`, `src/heartbeat/checks/inbox.ts:51`, `src/heartbeat/checks/thread-idle.ts:66`
- `src/manager/session-manager.ts` is 960 lines — needs splitting

### Established Patterns
- Heartbeat checks in `src/heartbeat/checks/` with auto-discovery
- Pino logger via `src/shared/logger.ts`
- Immutable patterns throughout

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discuss phase skipped.

</deferred>
