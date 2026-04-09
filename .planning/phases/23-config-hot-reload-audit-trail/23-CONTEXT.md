# Phase 23: Config Hot-Reload & Audit Trail - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Operators can update agent configuration without restarting the daemon, with a full change history.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase with clear success criteria. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key considerations:
- Use chokidar (already in project deps) for file watching
- Hot-reloadable: channels, skills, schedules, heartbeat settings
- Non-reloadable: model, workspace (require restart — log warning)
- JSONL audit trail with timestamp, field path, before/after values
- Config diffing should be at the field level, not file level

</decisions>

<code_context>
## Existing Code Insights

### Relevant Files
- `src/config/loader.ts` — current config loading (Zod validation)
- `src/config/schema.ts` — config schema definitions
- `src/manager/daemon.ts` — daemon lifecycle, manager initialization
- `src/manager/session-manager.ts` — agent session management (now split into modules)

### Established Patterns
- Zod schema validation for all config
- Daemon manages all lifecycle (start, IPC, bridge, scheduler)
- Config loaded once at startup currently

</code_context>

<specifics>
## Specific Ideas

OpenClaw reference: config hot-reload capability exists in the predecessor system.

</specifics>

<deferred>
## Deferred Ideas

None — discuss phase skipped.

</deferred>
