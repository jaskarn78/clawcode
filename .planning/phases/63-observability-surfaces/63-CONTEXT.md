# Phase 63: Observability Surfaces - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Operators get full visibility into the trigger→handoff→result chain via CLI commands (`clawcode triggers`, `clawcode tasks`, `clawcode trace`), a real-time dashboard task graph, and enriched trace metadata. Every question — why did an agent wake up, what did it delegate, what did it cost, where is a chain stuck — is answerable from these surfaces.

</domain>

<decisions>
## Implementation Decisions

### CLI Commands (OBS-01, OBS-02, OBS-05)
- `clawcode triggers` reads trigger_events from tasks.db via read-only SQLite (no running daemon needed). Shows source, matched rule, target agent, result, duration. `--source` and `--agent` filter flags.
- `clawcode tasks` reads tasks table from tasks.db directly. Shows caller, target, state, duration, depth, chain_token_cost. `--agent` and `--state` filter flags.
- chain_token_cost already on task rows (Phase 58 schema) — just expose in CLI table, format as human-readable (e.g., "1.2K tokens").
- Both commands: formatted table with color-coded states (running=yellow, complete=green, failed=red). `--json` flag for machine-readable. Same pattern as `clawcode policy dry-run`.

### Dashboard Task Graph (OBS-03)
- SVG-based force-directed graph rendered client-side with vanilla JS. Nodes = agents (circles), edges = in-flight tasks (arrows with state color). Lightweight — no D3 or heavy library. CSS animations for state transitions.
- Extend existing SSE endpoint with `task-state-change` event type alongside existing dashboard events. Client-side JS updates graph on each event.
- New `/tasks` route on dashboard server — dedicated page for the task graph. Link from main dashboard.
- IPC `list-tasks` call to running daemon for live data — returns in-flight tasks with caller, target, state. Graph shows active tasks only. Completed tasks fade after 30s.

### Trace Chain Walking (OBS-04)
- `clawcode trace <causation_id>` walks traces.db + tasks.db — query traces by causation_id (stored in TurnOrigin), join with task rows for handoff metadata. Build tree from root turn → child turns → handoff tasks.
- causation_id accessed via TurnOrigin.causationId on trace rows (added Phase 60). Query: `SELECT * FROM traces WHERE turn_origin LIKE '%"causationId":"<id>"%'`.
- Output as indented tree showing chain hierarchy: trigger → turn → handoff → delegated turn → result. Each node shows agent, duration, token cost. `--json` flag.
- Cross-agent chain stitching via parent_task_id links in tasks table + causation_id in traces.

### Claude's Discretion
- SVG graph layout algorithm details (simple spring simulation vs grid-based).
- Exact SSE event payload shape for task-state-change.
- Dashboard static file organization for the tasks page.
- Trace tree formatting details (indentation depth, color scheme).
- IPC method naming for list-tasks.
- Test strategy for dashboard client-side JS (unit tests for data transforms, skip browser tests).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/commands/policy.ts` — Pattern for read-only SQLite CLI commands with formatted table + --json
- `src/dashboard/server.ts` — Dashboard HTTP server with route handling
- `src/dashboard/sse.ts` — SSE manager for live updates
- `src/tasks/store.ts` — TaskStore with tasks + trigger_events tables
- `src/performance/trace-store.ts` — TraceStore for traces.db access
- `src/manager/turn-origin.ts` — TurnOrigin with causationId field

### Established Patterns
- CLI commands registered in src/cli/index.ts
- Read-only SQLite for CLI: `{ readonly: true, fileMustExist: true }`
- Formatted table output with --json flag (policy dry-run pattern)
- Dashboard routes with static file serving
- SSE events via SseManager

### Integration Points
- src/cli/index.ts — register triggers, tasks, trace commands
- src/dashboard/server.ts — add /tasks route + task-state-change SSE
- src/ipc/protocol.ts — add list-tasks IPC method
- src/manager/daemon.ts — handle list-tasks IPC + emit task state changes to SSE

</code_context>

<specifics>
## Specific Ideas

- `clawcode trace` tree output should use box-drawing characters (├── └──) for visual hierarchy.
- Dashboard task graph should show agent names inside node circles and task state as edge color.
- CLI tables should default to last 1 hour of data with `--since` override.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
