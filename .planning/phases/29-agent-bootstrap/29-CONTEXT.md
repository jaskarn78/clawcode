# Phase 29: Agent Bootstrap - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped per autonomous mode)

<domain>
## Phase Boundary

New agents get a guided first-run experience that establishes their identity and personality.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key considerations:
- Detect first-run: check for SOUL.md in agent workspace
- Bootstrap generates SOUL.md and IDENTITY.md from guided prompts
- Bootstrap triggered once on first agent start (flag persisted)
- OpenClaw reference: BOOTSTRAP.md per agent with first-run walkthrough

</decisions>

<code_context>
## Existing Code Insights

### Relevant Files
- `src/manager/session-manager.ts` — agent start lifecycle
- `src/manager/session-config.ts` — buildSessionConfig (system prompt assembly)
- `src/shared/types.ts` — ResolvedAgentConfig

### Established Patterns
- Agent workspace has SOUL.md for personality, IDENTITY.md for name/avatar
- System prompt includes SOUL.md content via buildSessionConfig

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
