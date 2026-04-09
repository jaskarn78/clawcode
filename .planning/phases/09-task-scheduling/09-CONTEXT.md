# Phase 9: Task Scheduling - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds cron-like scheduled tasks per agent. After this phase, users can define recurring tasks in clawcode.yaml that execute within the agent's persistent session at configurable intervals. A CLI command shows schedule status. No cross-agent coordination — that's Phase 11.

</domain>

<decisions>
## Implementation Decisions

### Schedule Definition
- **D-01:** Scheduled tasks defined in clawcode.yaml per agent under a `schedules` array
- **D-02:** Each task has: name, cron expression (or interval string like "every 30m"), prompt (message to send to agent), enabled flag
- **D-03:** Use `croner` library for cron expression parsing (recommended by stack research — used by PM2, Uptime Kuma)

### Execution Model
- **D-04:** Scheduled tasks execute within the agent's existing persistent session via `sendToAgent()`
- **D-05:** Tasks run one at a time per agent (no parallel scheduled tasks within same agent)
- **D-06:** Task execution tracked: last run time, last status (success/error), next run time
- **D-07:** Failed tasks log the error but don't stop the scheduler — next run proceeds normally

### Scheduler Architecture
- **D-08:** Scheduler runs as part of the daemon process (alongside heartbeat), not as a separate service
- **D-09:** Uses `croner` Cron class for precise scheduling with timezone support
- **D-10:** Scheduler initialized at daemon startup after agents are booted

### Status & CLI
- **D-11:** Schedule status queryable via IPC (`schedules` method) returning all tasks with timing info
- **D-12:** `clawcode schedules` CLI command displays formatted table: agent, task name, cron, next run, last status

### Claude's Discretion
- Exact cron expression format supported (standard 5-field or extended 6-field)
- Timezone handling details
- Maximum concurrent scheduled tasks across all agents

</decisions>

<canonical_refs>
## Canonical References

### Existing Codebase
- `src/manager/daemon.ts` — Daemon startup (add scheduler initialization)
- `src/manager/session-manager.ts` — sendToAgent() for task execution
- `src/config/schema.ts` — Config schema (extend with schedules)
- `src/ipc/protocol.ts` — IPC methods (extend with schedules)
- `src/cli/index.ts` — CLI commands (add schedules command)
- `.planning/research/STACK.md` — croner v10 recommended

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- SessionManager.sendToAgent() — execute scheduled task prompts
- IPC pattern — extend with schedules method
- CLI command pattern — follow status/routes/health pattern
- Config schema extension pattern — well established

### Integration Points
- Daemon: initialize scheduler after agent boot
- Config: per-agent schedules array
- IPC: schedules status method
- CLI: schedules command

</code_context>

<specifics>
## Specific Ideas
- Schedule config should support both cron expressions ("0 */6 * * *") and human-readable intervals ("every 30m", "every 6h")
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 09-task-scheduling*
*Context gathered: 2026-04-09*
