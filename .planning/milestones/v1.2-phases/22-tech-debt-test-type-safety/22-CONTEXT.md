# Phase 22: Tech Debt - Test & Type Safety - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Test suite runs cleanly without type workarounds and CLI commands have unit test coverage.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

### Known Issues (from tech debt audit)
- Test fixtures missing required fields (reactions, tiers) — using `as unknown as` casts
- CLI commands (schedules, skills, send, threads, webhooks, fork, memory, mcp, usage) have zero test coverage
- SDK v2 unstable API uses `any` types in src/manager/session-adapter.ts:195-198

### Established Patterns
- Tests use vitest with mocks in `__tests__/` directories
- CLI commands follow commander.js pattern in `src/cli/commands/`
- Each CLI command has a register function and uses IPC client

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discuss phase skipped.

</deferred>
