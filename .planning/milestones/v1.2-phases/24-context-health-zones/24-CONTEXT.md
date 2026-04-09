# Phase 24: Context Health Zones - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Operators and agents have visibility into context window utilization with automatic protective actions.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key considerations:
- Zone thresholds: green (0-50%), yellow (50-70%), orange (70-85%), red (85%+) — configurable
- Zone transitions should trigger log entries and optional Discord notifications
- Auto-snapshot on yellow+ should save context to agent memory store
- Zone should be visible in IPC status, CLI, and dashboard (when built)
- OpenClaw reference: zone-based context health with green/yellow/orange/red alerts exists

</decisions>

<code_context>
## Existing Code Insights

### Relevant Files
- `src/heartbeat/checks/context-fill.ts` — existing context fill check (basic percentage)
- `src/heartbeat/types.ts` — CheckModule, CheckResult types
- `src/manager/session-manager.ts` — getContextFillProvider()
- `src/shared/types.ts` — shared type definitions

### Established Patterns
- Heartbeat checks auto-discovered from checks directory
- Context fill already monitored but without zone classification
- Pino structured logging throughout

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
