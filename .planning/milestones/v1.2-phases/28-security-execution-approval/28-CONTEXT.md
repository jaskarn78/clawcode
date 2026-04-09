# Phase 28: Security & Execution Approval - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped per autonomous mode)

<domain>
## Phase Boundary

Agents operate within defined security boundaries with auditable command approval and channel access control.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key considerations:
- Per-agent command allowlists in clawcode.yaml (pattern-based matching)
- Non-allowlisted commands require approval via IPC or Discord reaction
- "Allow-always" persistence for approved command patterns
- JSONL audit log for all approval decisions
- Per-agent SECURITY.md defines channel ACLs (who can message this agent)
- Unauthorized users in bound channels ignored with log entry
- Admin agent can update SECURITY.md via IPC
- OpenClaw reference: exec-approvals.json with per-agent allowlists and pattern matching

</decisions>

<code_context>
## Existing Code Insights

### Relevant Files
- `src/config/schema.ts` — config schema (add allowlists here)
- `src/config/audit-trail.ts` — JSONL audit pattern (reuse for approval log)
- `src/manager/daemon.ts` — IPC routing
- `src/discord/bridge.ts` — message handling (add ACL check here)
- `src/manager/session-adapter.ts` — permissionMode currently set to bypassPermissions

### Established Patterns
- Zod schema validation for config
- JSONL audit trail (from Phase 23)
- IPC methods for CLI commands

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
