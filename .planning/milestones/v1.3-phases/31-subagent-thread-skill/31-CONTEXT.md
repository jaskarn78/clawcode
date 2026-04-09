# Phase 31: Subagent Thread Skill - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Agents seamlessly create Discord-visible subagent threads through a natural skill interface.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key considerations:
- Create a ClawCode skill (SKILL.md + implementation) in the skills directory
- The skill wraps the spawn-subagent-thread IPC call
- Skill accepts task description and optional model selection
- Returns thread URL and subagent session name
- Error handling for no Discord client or no bound channel
- System prompt injection in buildSessionConfig tells agents about this skill
- Agents should prefer this skill over raw Agent tool when Discord visibility matters

### Existing Infrastructure (Phase 27)
- `src/discord/subagent-thread-spawner.ts` — SubagentThreadSpawner service
- `src/discord/subagent-thread-types.ts` — SubagentThreadConfig, SubagentSpawnResult
- IPC methods: `spawn-subagent-thread`, `cleanup-subagent-thread`
- Session end callbacks auto-cleanup thread bindings

</decisions>

<code_context>
## Existing Code Insights

### Relevant Files
- `src/discord/subagent-thread-spawner.ts` — the service to wrap
- `src/manager/session-config.ts` — buildSessionConfig (system prompt assembly)
- `src/skills/registry.ts` — skill scanning and registration
- Existing skills pattern: directory with SKILL.md

</code_context>

<specifics>
## Specific Ideas

User specifically requested seamless subagent-in-thread spawning without agents needing to know about IPC internals.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
