# Phase 30: Web Dashboard - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped per autonomous mode)

<domain>
## Phase Boundary

Operators can monitor and control the entire ClawCode system through a web interface.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key considerations:
- Web server on configurable port serves dashboard UI
- Real-time agent status (running/stopped/error, uptime, model, channels)
- Memory statistics per agent (entry count, tier distribution, last consolidation)
- Scheduled tasks with next run, last status, error history
- Health monitoring (context fill zones, heartbeat results, system metrics)
- Recent Discord message activity (last N messages per agent)
- Agent start/stop/restart controls via UI
- Delivery queue status and failed message log
- Use existing IPC methods as the data source (dashboard is an IPC client)
- Consider: Express/Fastify for server, SSE or polling for real-time updates, vanilla HTML/CSS/JS or lightweight framework

### UI Approach
Per project CLAUDE.md frontend design rules:
- Bold aesthetic direction — not generic admin panel
- Distinctive typography (no Inter/Roboto/Arial)
- Dark theme with sharp accent colors fitting the "ClawCode" brand
- CSS variables for consistency
- Responsive layout

</decisions>

<code_context>
## Existing Code Insights

### Data Sources (all via IPC)
- `status` — agent status (running/stopped, uptime, model)
- `schedules` — scheduled tasks and their states
- `skills` — skill catalog per agent
- `threads` — active thread bindings
- `webhooks` — webhook identity configs
- `context-zone-status` — health zones per agent
- `episode-list` — episode memory entries
- `delivery-queue-status` — queue stats and failed entries
- `memory-search` / `memory-list` — memory contents
- `heartbeat-status` — heartbeat check results

### Established Patterns
- IPC client in src/ipc/client.ts (sendIpcRequest)
- CLI commands already format IPC data for display
- Daemon runs on Unix socket

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
