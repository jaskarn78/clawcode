# Phase 63: Observability Surfaces - Research

**Researched:** 2026-04-17
**Domain:** CLI observability commands, dashboard task graph, trace chain walking
**Confidence:** HIGH

## Summary

Phase 63 is the capstone observability layer for v1.8. It surfaces all trigger/handoff/task metadata that Phases 57-62 accumulated in SQLite stores (tasks.db and traces.db) through three channels: CLI commands (`clawcode triggers`, `clawcode tasks`, `clawcode trace`), a real-time dashboard task graph page, and trace chain walking. No new runtime dependencies are needed. The phase is pure read-side work: query existing stores, format output, extend the dashboard with one new page and SSE event type, and add one new IPC method.

The codebase has mature, reusable patterns for every dimension of this phase. The `policy dry-run` CLI (Phase 62) is the exact template for read-only SQLite CLI commands with table + --json output. The existing dashboard server, SSE manager, and graph.html page provide the template for the task graph page. The trace-store and turn-origin modules provide the schema and query surface for chain walking.

**Primary recommendation:** Follow the established patterns exactly. Every CLI command mirrors `policy.ts` (read-only SQLite, formatted table, --json flag). The dashboard task graph mirrors `graph.html` (vanilla JS + SVG, sidebar, SSE events). The trace walker queries both traces.db and tasks.db using causation_id joins. No new libraries needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `clawcode triggers` reads trigger_events from tasks.db via read-only SQLite (no running daemon needed). Shows source, matched rule, target agent, result, duration. `--source` and `--agent` filter flags.
- `clawcode tasks` reads tasks table from tasks.db directly. Shows caller, target, state, duration, depth, chain_token_cost. `--agent` and `--state` filter flags.
- chain_token_cost already on task rows (Phase 58 schema) -- just expose in CLI table, format as human-readable (e.g., "1.2K tokens").
- Both commands: formatted table with color-coded states (running=yellow, complete=green, failed=red). `--json` flag for machine-readable. Same pattern as `clawcode policy dry-run`.
- SVG-based force-directed graph rendered client-side with vanilla JS. Nodes = agents (circles), edges = in-flight tasks (arrows with state color). Lightweight -- no D3 or heavy library. CSS animations for state transitions.
- Extend existing SSE endpoint with `task-state-change` event type alongside existing dashboard events. Client-side JS updates graph on each event.
- New `/tasks` route on dashboard server -- dedicated page for the task graph. Link from main dashboard.
- IPC `list-tasks` call to running daemon for live data -- returns in-flight tasks with caller, target, state. Graph shows active tasks only. Completed tasks fade after 30s.
- `clawcode trace <causation_id>` walks traces.db + tasks.db -- query traces by causation_id (stored in TurnOrigin), join with task rows for handoff metadata. Build tree from root turn -> child turns -> handoff tasks.
- causation_id accessed via TurnOrigin.causationId on trace rows (added Phase 60). Query: `SELECT * FROM traces WHERE turn_origin LIKE '%"causationId":"<id>"%'`.
- Output as indented tree showing chain hierarchy: trigger -> turn -> handoff -> delegated turn -> result. Each node shows agent, duration, token cost. `--json` flag.
- Cross-agent chain stitching via parent_task_id links in tasks table + causation_id in traces.
- `clawcode trace` tree output should use box-drawing characters for visual hierarchy.
- Dashboard task graph should show agent names inside node circles and task state as edge color.
- CLI tables should default to last 1 hour of data with `--since` override.

### Claude's Discretion
- SVG graph layout algorithm details (simple spring simulation vs grid-based).
- Exact SSE event payload shape for task-state-change.
- Dashboard static file organization for the tasks page.
- Trace tree formatting details (indentation depth, color scheme).
- IPC method naming for list-tasks.
- Test strategy for dashboard client-side JS (unit tests for data transforms, skip browser tests).

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OBS-01 | `clawcode triggers` CLI lists recent trigger fires with source, matched rule, target agent, result, duration | Read-only SQLite pattern from policy.ts; trigger_events table has source_id, idempotency_key, created_at, source_kind, payload columns; formatTable pattern from costs.ts/policy.ts |
| OBS-02 | `clawcode tasks` CLI lists recent inter-agent tasks with caller, target, state, duration, depth -- filterable by agent + state | Tasks table has all 15 LIFE-02 fields including chain_token_cost; idx_tasks_caller_target index supports agent filter; status column + CHECK constraint supports state filter |
| OBS-03 | Dashboard panel shows in-flight inter-agent task graph (nodes = agents, edges = tasks) with real-time updates via SSE | Dashboard server.ts has route + static file serving pattern; SseManager.broadcast() for events; graph.html provides vanilla JS + SVG force-directed graph template; new IPC `list-tasks` method needed |
| OBS-04 | `clawcode trace <causation_id>` walks entire chain across all agents | traces.db has turn_origin TEXT column (JSON with causationId field); tasks.db has causation_id + parent_task_id columns; idx_tasks_causation_id index supports lookups; TraceStore is per-agent (need to scan multiple traces.db files) |
| OBS-05 | Handoff chain cumulative token count visible in task list and trace metadata | chain_token_cost field on TaskRow (INTEGER, default 0); already persisted by Phase 59 TaskManager; just needs formatting in CLI output |
</phase_requirements>

## Standard Stack

No new dependencies. Phase 63 uses only existing project libraries.

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | Read-only SQLite queries | CLI commands open tasks.db/traces.db with `{ readonly: true, fileMustExist: true }` -- established pattern from policy.ts |
| commander | (existing) | CLI command registration | All CLI commands registered via `registerXCommand(program)` pattern |
| pino | 9.x | Dashboard logging | Dashboard server uses pino for request/SSE logging |

### Supporting (already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | 4.3.6 | Schema validation | Validate IPC params for list-tasks; reuse TaskRowSchema for CLI output |
| date-fns | 4.x | Duration formatting | Format task durations, --since parsing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vanilla JS SVG force layout | D3.js | CONTEXT explicitly says "no D3 or heavy library" -- vanilla spring simulation sufficient for <20 node graph |
| LIKE query for causation_id | JSON_EXTRACT() | SQLite JSON_EXTRACT requires JSON1 extension; LIKE is universal and sufficient for exact string match in JSON blob |

## Architecture Patterns

### Recommended Project Structure
```
src/
  cli/
    commands/
      triggers.ts          # NEW: clawcode triggers (read-only SQLite)
      trace.ts             # NEW: clawcode trace <causation_id>
      tasks.ts             # EXTEND: add list subcommand alongside existing retry/status
  dashboard/
    server.ts              # EXTEND: add /tasks route, add /api/tasks endpoint
    sse.ts                 # EXTEND: add task-state-change broadcast (via pollAndBroadcast)
    static/
      tasks.html           # NEW: task graph page
  ipc/
    protocol.ts            # EXTEND: add "list-tasks" to IPC_METHODS
  manager/
    daemon.ts              # EXTEND: handle list-tasks IPC, emit task SSE events
```

### Pattern 1: Read-Only SQLite CLI (from policy.ts)
**What:** CLI commands that bypass the running daemon by opening SQLite in read-only mode
**When to use:** `clawcode triggers`, `clawcode tasks list`, `clawcode trace`
**Example:**
```typescript
// Source: src/cli/commands/policy.ts (lines 99-119)
const db = new Database(opts.dbPath, { readonly: true, fileMustExist: true });
try {
  rows = db.prepare("SELECT ... WHERE created_at > ? ORDER BY created_at ASC").all(sinceEpoch);
} finally {
  db.close();
}
```

### Pattern 2: Formatted Table with --json Flag (from costs.ts + policy.ts)
**What:** Aligned table output with column-width padding, color-coded values, and optional --json
**When to use:** All three CLI commands
**Example:**
```typescript
// Source: src/cli/commands/policy.ts (lines 178-225)
// Column widths calculated from max cell length, headers + separator, ANSI color for state
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
```

### Pattern 3: CLI Command Registration (from cli/index.ts)
**What:** Each command exports a `registerXCommand(program)` function, called in index.ts
**When to use:** All new CLI commands
**Example:**
```typescript
// Source: src/cli/index.ts (lines 131-165)
import { registerTriggersCommand } from "./commands/triggers.js";
import { registerTraceCommand } from "./commands/trace.js";
registerTriggersCommand(program);
registerTraceCommand(program);
```

### Pattern 4: Dashboard SSE Event Broadcasting
**What:** SseManager polls daemon via IPC, broadcasts typed events to connected clients
**When to use:** Task graph real-time updates
**Example:**
```typescript
// Source: src/dashboard/sse.ts (line 71)
broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of this.clients) {
    client.write(payload);
  }
}
```

### Pattern 5: Dashboard Route + Static File (from server.ts)
**What:** GET route serves a static HTML file, with corresponding API endpoint
**When to use:** /tasks page + /api/tasks data endpoint
**Example:**
```typescript
// Source: src/dashboard/server.ts (lines 145-148)
if (method === "GET" && pathname === "/graph") {
  await serveStatic(res, "graph.html", MIME_TYPES[".html"]!);
  return;
}
```

### Pattern 6: IPC Method Extension
**What:** Add method to IPC_METHODS array, handle in routeMethod switch, expose via sendIpcRequest
**When to use:** `list-tasks` IPC method
**Example:**
```typescript
// Source: src/ipc/protocol.ts (lines 7-81)
// Add "list-tasks" to IPC_METHODS array
// Source: src/manager/daemon.ts routeMethod function
// Add case "list-tasks": return taskStore.query(...)
```

### Anti-Patterns to Avoid
- **Querying traces.db for all agents in one call:** TraceStore is per-agent. The trace walker must enumerate agent workspace directories and open each agent's traces.db separately. Do NOT assume a single traces.db.
- **Using the daemon for read-only CLI commands:** CONTEXT locks that triggers/tasks CLIs read SQLite directly. The daemon is only needed for the dashboard (live task graph via list-tasks IPC).
- **Mutating task state from CLI:** All CLI commands are read-only. task state mutation happens only via daemon IPC (retry, cancel are existing Phase 59 commands).
- **Adding D3 to the task graph page:** CONTEXT explicitly forbids D3. The existing graph.html uses D3 for the knowledge graph but the task graph decision says "no D3 or heavy library" -- vanilla JS spring simulation is required.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Table alignment | Custom column-width math | Copy formatDryRunTable/formatCostsTable pattern | Proven, handles ANSI escape width correctly |
| Duration formatting | Custom ms-to-human converter | parseDuration from policy.ts (for --since parsing) + simple ms-to-string helper | parseDuration already handles s/m/h/d units |
| SQLite read-only access | Custom DB opener | `new Database(path, { readonly: true, fileMustExist: true })` | Established pattern, prevents accidental writes |
| Box-drawing tree output | Complex recursive formatter | Linear pass: sorted-by-depth array with prefix computation | Tree is shallow (max depth 5 per HAND-05), linear approach sufficient |

**Key insight:** Phase 63 is 100% read-side work. Every building block already exists in the codebase. The risk is deviation from established patterns, not technical complexity.

## Common Pitfalls

### Pitfall 1: Per-Agent traces.db Discovery for Trace Walking
**What goes wrong:** Assuming traces.db is daemon-scoped like tasks.db. It is NOT. Each agent has its own traces.db in its workspace directory.
**Why it happens:** tasks.db IS daemon-scoped (shared at `~/.clawcode/manager/tasks.db`). traces.db is per-agent (at `<agent_workspace>/traces.db`).
**How to avoid:** The trace walker must: (1) read agent configs to get workspace paths, OR (2) glob for traces.db files under `~/.clawcode/agents/*/traces.db`. Open each in read-only mode, query for matching causation_id, merge results.
**Warning signs:** Trace command returns empty results when there should be cross-agent data.

### Pitfall 2: JSON LIKE Query for causation_id in turn_origin Column
**What goes wrong:** LIKE query `WHERE turn_origin LIKE '%"causationId":"<id>"%'` can match partial strings or fail on escaped characters.
**Why it happens:** causation_id is stored inside a JSON blob in the turn_origin TEXT column, not as a top-level column.
**How to avoid:** Use exact match with delimiters: `'%"causationId":"' || ? || '"%'`. Since causation_id values are nanoid strings (alphanumeric + dash + underscore), no JSON escaping issues arise. For extra safety, parse the JSON in application code and filter.
**Warning signs:** False matches on partial causation_id values.

### Pitfall 3: Dashboard Task Graph -- Vanilla Spring Layout Without D3
**What goes wrong:** Force-directed layouts are non-trivial to implement from scratch. Naive spring simulation can have unstable oscillation or nodes clustering.
**Why it happens:** The existing graph.html uses D3 force simulation. The task graph must NOT use D3 per CONTEXT decision.
**How to avoid:** For the task graph (typically <15 agent nodes), a simple approach works: (1) Position nodes in a circle or grid initially, (2) Apply spring forces between connected nodes and repulsion between all nodes, (3) Dampen each tick (velocity *= 0.9), (4) Stop after N iterations. The graph is small enough that a non-optimized O(n^2) approach runs in <16ms per frame.
**Warning signs:** Nodes overlapping, jittering, or flying off-screen.

### Pitfall 4: Existing tasks.ts Already Has Subcommands
**What goes wrong:** Trying to register a new top-level `tasks` command conflicts with the existing Phase 59 `tasks` command group that has `retry` and `status` subcommands.
**Why it happens:** Phase 59 already registered `clawcode tasks retry` and `clawcode tasks status`.
**How to avoid:** Add `list` as a new subcommand under the existing `tasks` command group. The CONTEXT says "clawcode tasks" which maps to `clawcode tasks list` (or as the default action when no subcommand is given).
**Warning signs:** Commander throws "duplicate command" error.

### Pitfall 5: SSE Polling vs Event-Driven for Task State Changes
**What goes wrong:** Adding a separate high-frequency poll for task state changes adds load, or events arrive stale.
**Why it happens:** The current SSE manager polls daemon IPC on a 3-second interval for agent status.
**How to avoid:** Piggyback task graph data on the existing poll cycle. Add a `list-tasks` IPC call to `pollAndBroadcast()` and broadcast as a `task-state-change` event. The 3-second interval is adequate for task graph updates. Alternatively, if finer granularity is needed, TaskManager could emit events directly to SseManager, but that adds coupling.
**Warning signs:** Dashboard task graph feels laggy or has inconsistent state.

### Pitfall 6: Token Cost Formatting
**What goes wrong:** Displaying raw token counts as large integers (e.g., 125000) is unreadable.
**Why it happens:** chain_token_cost is stored as raw INTEGER.
**How to avoid:** Format as human-readable: "1.2K", "45.3K", "1.2M". Simple function: if < 1000 show raw, if < 1M show X.XK, else X.XM.
**Warning signs:** CLI tables with long number columns misaligning.

## Code Examples

Verified patterns from the existing codebase:

### Read-Only SQLite CLI Command Template
```typescript
// Source: src/cli/commands/policy.ts
// Pattern: registerXCommand(program) -> read-only DB -> format table/json -> cliLog
export function registerTriggersCommand(program: Command): void {
  program
    .command("triggers")
    .description("List recent trigger fires")
    .option("--since <duration>", "Time window (e.g., 1h, 30m, 2d)", "1h")
    .option("--source <source>", "Filter by source")
    .option("--agent <name>", "Filter by target agent")
    .option("--json", "Output as JSON")
    .option("--db <path>", "Path to tasks.db", defaultDbPath)
    .action(async (opts) => {
      const sinceMs = parseDuration(opts.since);
      const db = new Database(opts.db, { readonly: true, fileMustExist: true });
      try {
        // query trigger_events + format
      } finally {
        db.close();
      }
    });
}
```

### Task Table Query with Filters
```typescript
// Source: inferred from src/tasks/store.ts schema
// tasks table columns: task_id, task_type, caller_agent, target_agent,
//   causation_id, parent_task_id, depth, input_digest, status,
//   started_at, ended_at, heartbeat_at, result_digest, error, chain_token_cost
//
// Index: idx_tasks_caller_target ON tasks(caller_agent, target_agent)
// Index: idx_tasks_ended_at ON tasks(ended_at)
// Index: idx_tasks_causation_id ON tasks(causation_id)
//
// For CLI: SELECT * FROM tasks WHERE started_at > ? ORDER BY started_at DESC
// With filters: AND (caller_agent = ? OR target_agent = ?) AND status = ?
```

### Causation Chain Walk Query
```typescript
// Source: inferred from trace-store.ts schema + turn-origin.ts
// Step 1: Query tasks.db for all tasks with matching causation_id
//   SELECT * FROM tasks WHERE causation_id = ? ORDER BY depth ASC, started_at ASC
//
// Step 2: For each agent workspace, query traces.db for matching turns
//   SELECT id, agent, started_at, ended_at, total_ms, status, turn_origin
//   FROM traces WHERE turn_origin LIKE '%"causationId":"' || ? || '"%'
//   ORDER BY started_at ASC
//
// Step 3: Parse turn_origin JSON, build tree by parent_task_id + chain links
// Step 4: Merge task rows + trace rows into unified tree output
```

### Box-Drawing Tree Output
```typescript
// Pattern for indented tree output with Unicode box-drawing characters
// CONTEXT specifies: indented tree with box-drawing characters (they are safe)
//
// Output example:
// trigger:cron:daily-report (scheduler, causation: abc123def)
//   turnId: trigger:Xk9m2pQ3Rz (acquisition, 1.2s, 450 tokens)
//     task: generate-report (acquisition -> research, complete, 3.4s, 1.2K tokens)
//       turnId: task:Ym8n3qR4Sz (research, 2.1s, 800 tokens)
//     task: format-output (acquisition -> studio, complete, 1.8s, 600 tokens)
//       turnId: task:Zn9o4rS5Tz (studio, 1.5s, 500 tokens)
```

### Dashboard SSE Integration for Tasks
```typescript
// Source: src/dashboard/sse.ts pollAndBroadcast (lines 198-231)
// Add task state poll alongside existing status/schedules/health/delivery-queue polls:
//
// In pollAndBroadcast():
// try {
//   const tasks = await sendIpcRequest(this.socketPath, "list-tasks", {});
//   this.broadcast("task-state-change", tasks);
// } catch (err) {
//   this.log.debug({ err }, "Failed to poll tasks");
// }
```

### IPC Method Registration
```typescript
// Source: src/ipc/protocol.ts
// Add to IPC_METHODS array:
//   "list-tasks",
//
// Source: src/manager/daemon.ts routeMethod function:
// case "list-tasks": {
//   // Query tasks with in-flight + recently-completed statuses
//   const rows = taskStore.rawDb.prepare(
//     "SELECT * FROM tasks WHERE status IN ('pending','running','awaiting_input') OR (ended_at > ? AND status IN ('complete','failed'))"
//   ).all(Date.now() - 30_000);
//   return { tasks: rows };
// }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tasks command had only retry + status | Add list subcommand (Phase 63) | v1.8 | Operators can view task history offline |
| No trigger visibility | clawcode triggers CLI reads trigger_events | v1.8 | Operators see why agents woke up |
| Trace viewer per-agent only | Cross-agent causation chain walking | v1.8 | Full end-to-end visibility across handoff chains |
| Dashboard had agent status only | Task graph with live SSE updates | v1.8 | Visual real-time handoff monitoring |

## Open Questions

1. **Trigger Result Column**
   - What we know: trigger_events table has source_id, idempotency_key, created_at, source_kind, payload. CONTEXT says "result, duration" should be shown.
   - What's unclear: There is no explicit "result" or "duration" column on trigger_events. The result of a trigger fire is the task it spawned (in tasks table via causation_id). Duration would need to be derived from the task's started_at to ended_at.
   - Recommendation: Join trigger_events with tasks on causation_id to get the task status (as "result") and task duration. If no matching task exists, show "--" for result and duration.

2. **Agent Workspace Discovery for Trace Walking**
   - What we know: TraceStore is per-agent. traces.db lives in each agent's workspace directory.
   - What's unclear: The exact workspace path pattern. Likely `~/.clawcode/agents/<name>/traces.db` based on codebase conventions.
   - Recommendation: Read the clawcode.yaml config to resolve agent workspaces, or glob `~/.clawcode/agents/*/traces.db`. Config-based is more reliable.

3. **Vanilla Force-Directed Layout Stability**
   - What we know: CONTEXT says no D3. Agent count is small (typically 5-15).
   - What's unclear: Whether a simple spring simulation will produce good-looking layouts without extensive tuning.
   - Recommendation: Start with circular initial positioning (agents evenly spaced on a circle), apply spring forces for connected nodes, repulsion for all nodes, and damping. For <15 nodes this converges quickly. The graph.html D3 layout can serve as a reference for the physics parameters.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBS-01 | triggers CLI reads trigger_events, formats table, filters by source/agent | unit | `npx vitest run src/cli/commands/__tests__/triggers.test.ts -x` | Wave 0 |
| OBS-02 | tasks list CLI reads tasks table, formats table, filters by agent/state | unit | `npx vitest run src/cli/commands/__tests__/tasks-list.test.ts -x` | Wave 0 |
| OBS-03 | Dashboard task graph page renders, SSE updates graph, IPC list-tasks returns data | unit (data transforms only, skip browser) | `npx vitest run src/dashboard/__tests__/task-graph.test.ts -x` | Wave 0 |
| OBS-04 | trace CLI walks causation chain across agents, builds tree, formats output | unit | `npx vitest run src/cli/commands/__tests__/trace.test.ts -x` | Wave 0 |
| OBS-05 | chain_token_cost visible in tasks list and trace output | unit | Covered by OBS-02 + OBS-04 tests | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/commands/__tests__/ src/dashboard/__tests__/ -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/cli/commands/__tests__/triggers.test.ts` -- covers OBS-01 (trigger_events query, table format, filters, --json)
- [ ] `src/cli/commands/__tests__/tasks-list.test.ts` -- covers OBS-02 (tasks query, table format, filters, token cost format)
- [ ] `src/cli/commands/__tests__/trace.test.ts` -- covers OBS-04 (causation chain walk, tree output, cross-db merge)
- [ ] `src/dashboard/__tests__/task-graph.test.ts` -- covers OBS-03 (list-tasks IPC response shape, SSE event shape, data transform for graph)

## Project Constraints (from CLAUDE.md)

- **Immutability:** All returned data must use Object.freeze or readonly types (per coding-style.md)
- **Error handling:** CLI commands must handle missing DB files, empty results, and daemon-not-running gracefully (per coding-style.md)
- **File organization:** New files <400 lines typical, <800 max (per coding-style.md)
- **Security:** No prompt bodies or message content in trace metadata (per TraceStore security comment). Validate all user input (--since, --source, --agent flags)
- **Git workflow:** Meaningful commits, review before push (per git-workflow.md)
- **No hardcoded secrets:** CLI default paths use `$HOME/.clawcode/` convention (per security.md)
- **GSD Workflow:** All work through GSD commands (per CLAUDE.md)

## Sources

### Primary (HIGH confidence)
- `src/cli/commands/policy.ts` -- Read-only SQLite CLI pattern, parseDuration, formatTable, --json
- `src/cli/commands/costs.ts` -- Table formatting pattern with column alignment
- `src/cli/commands/tasks.ts` -- Existing tasks command group (retry, status subcommands)
- `src/dashboard/server.ts` -- Dashboard route handling, static file serving, API endpoints
- `src/dashboard/sse.ts` -- SSE manager polling and broadcast pattern
- `src/dashboard/static/graph.html` -- Existing force-directed graph page (D3-based, reference only)
- `src/tasks/store.ts` -- TaskStore schema (tasks + trigger_events + trigger_state tables), indexes, query patterns
- `src/tasks/schema.ts` -- TaskRowSchema (15 LIFE-02 fields), TriggerStateRowSchema
- `src/tasks/types.ts` -- TaskStatus union (8 values), TERMINAL_STATUSES, IN_FLIGHT_STATUSES
- `src/performance/trace-store.ts` -- TraceStore schema (traces + trace_spans), turn_origin column, per-agent scope
- `src/performance/trace-collector.ts` -- Turn/Span recording, TurnOrigin attachment via recordOrigin
- `src/manager/turn-origin.ts` -- TurnOrigin schema (causationId field), makeRootOriginWithCausation
- `src/ipc/protocol.ts` -- IPC_METHODS array, ipcRequestSchema
- `src/manager/daemon.ts` -- routeMethod IPC handler, taskStore/taskManager initialization
- `src/dashboard/types.ts` -- DashboardState, DashboardServerConfig types

### Secondary (MEDIUM confidence)
- `src/cli/index.ts` -- Command registration pattern (all commands registered sequentially)
- `src/cli/output.ts` -- cliLog/cliError helpers

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new dependencies, all existing libraries
- Architecture: HIGH -- All patterns directly visible in codebase with exact line references
- Pitfalls: HIGH -- Per-agent traces.db scope, existing tasks.ts subcommands, LIKE query for JSON field are all verified from source code

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable -- no external dependency changes)
