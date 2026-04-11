# Phase 42: Auto-start agents on daemon boot - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning
**Mode:** Infrastructure phase — discuss skipped

<domain>
## Phase Boundary

Agents boot automatically when the daemon starts. The `start-all` CLI spawns the daemon process and waits for it to become responsive, then prints the status table. No separate IPC `start-all` request is needed from the CLI.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Auto-start wiring in daemon.ts and removal of redundant IPC call in start-all.ts.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `daemon.ts` already has auto-start IIFE at lines 584-591
- `start-all.ts` already has clean spawn-wait-display logic without redundant IPC

### Established Patterns
- Void async IIFE for fire-and-forget async work in daemon boot
- `waitForDaemon()` polling pattern for CLI-to-daemon readiness

### Integration Points
- `manager.startAll(resolvedAgents)` called after `createIpcServer`
- `formatStatusTable()` for CLI output

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
