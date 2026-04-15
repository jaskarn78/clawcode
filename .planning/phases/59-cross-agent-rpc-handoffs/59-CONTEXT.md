# Phase 59: Cross-Agent RPC (Handoffs) - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning
**Mode:** Smart discuss (3 grey areas, all defaults accepted)

<domain>
## Phase Boundary

Agent A can delegate a typed task to agent B via a single MCP tool call (`delegate_task`), and B's structured result lands back at A as a fresh turn with `TurnOrigin{kind:'task'}`. The daemon owns all safety enforcement: schema validation, allowlist authorization, cycle detection, depth cap (MAX_HANDOFF_DEPTH = 5), self-handoff block, chain-wide wall-clock deadline propagation (AbortSignal), 64 KB payload cap, cost attribution (tokens count against caller's budget by default), and idempotent CLI retry. Explicitly async-ticket semantics — the MCP call returns `{ task_id }` immediately and A's turn ends; no `await`, no deadlock-from-sync-RPC (PITFALL-03).

Phase 59 adds the RPC surface; Phase 60+ adds triggers that fire turns from external events; Phase 63 adds observability CLIs. This phase writes task rows (consuming Phase 58's `TaskStore`) and dispatches B's result turn (consuming Phase 57's `TurnDispatcher` + `TurnOrigin`).

</domain>

<decisions>
## Implementation Decisions

### Area 1 — MCP Surface & Result Flow

- **Registration:** `delegate_task`, `task_status`, `cancel_task` registered in the shared MCP server (`src/mcp/server.ts` TOOL_DEFINITIONS) — consistent with `send_to_agent`, `ask_advisor` pattern. Not per-agent.
- **Return shape:** `delegate_task` returns `{ task_id: string }` — minimal async-ticket per HAND-01. Richer observability fields (status URL, chain cost) land in Phase 63.
- **Tool set shipped:** `delegate_task` + `task_status` + `cancel_task` + `task_complete` as MCP tools (4 tools — matches ROADMAP.md line 95; smart-discuss omitted `task_complete`, added post-research). `task_complete` is how B signals its structured result back to the daemon at the end of its turn — without it, B's result would have to be parsed from assistant text (fragile). `clawcode tasks retry <task_id>` (LIFE-06) is an IPC method + CLI command, not an MCP tool — retry is an operator action, not an agent action.
- **Result flow back to A:** When B's task completes (or fails/times out), the daemon dispatches a fresh turn to agent A through `TurnDispatcher` with `TurnOrigin{kind:'task', id: task_id, rootTurnId, chain}`. A consumes the result via its regular turn-handling pipeline. This matches Phase 57's design and means no ad-hoc side-channel into A's session.

### Area 2 — Task Schema Registry & Authorization

- **Registry location:** `~/.clawcode/task-schemas/` — runtime config location, matches `~/.clawcode/manager/*.db` convention. The roadmap's `.planning/task-schemas/` reference was aspirational; runtime is the right home.
- **File layout:** One YAML file per schema (`research.brief.yaml`, `finmentum.client-followup.yaml`). Easier to version and review than a single monolithic file.
- **Schema format:** JSON Schema in YAML — compiled to Zod at load time via a thin adapter. Portable, readable, matches the planned Phase 62 policy DSL format so operators only learn one YAML style.
- **Payload cap:** 64 KB enforced at validation time (HAND-02, HAND-06). Size check happens BEFORE Zod parse to fail fast on oversize.
- **Allowlist location:** Per-agent `acceptsTasks:` section in `clawcode.yaml`, shape `{ [schemaName]: [callerAgentName, ...] }`. HAND-04 says "each receiver declares which agents are allowed to delegate to it" — per-agent config is the natural home. Default deny (missing schema entry = unauthorized).

### Area 3 — Plan & Wave Breakdown

Three plans matching 57/58 cadence:

- **59-01 (Wave 1):** Task schema registry loader + JSON-Schema→Zod compiler + input/output validation + typed error classes (`ValidationError`, `UnauthorizedError`, `CycleDetectedError`, `DepthExceededError`, `SelfHandoffBlockedError`, `DeadlineExceededError`). Pure data/logic — no daemon state, no DB writes.
- **59-02 (Wave 2):** `TaskManager` class — `delegate()`, `cancel()`, `retry()`, result dispatch. Implements authorization (allowlist lookup), cycle detection (scan causation_id chain), depth cap, self-handoff block, cost attribution (token totals flow to caller budget), deadline + AbortSignal propagation to B's turn, `input_digest` hashing (deterministic SHA-256 of normalized payload — same bytes round-trip same digest), and retry logic (re-dispatch with identical digest).
- **59-03 (Wave 3):** MCP tool registration in `src/mcp/server.ts` (delegate_task / task_status / cancel_task / task_complete); IPC methods (`delegate-task`, `task-status`, `cancel-task`, `task-complete`, `task-retry`); CLI `clawcode tasks retry <task_id>` + `clawcode tasks status <task_id>`; daemon wiring of `TaskManager` singleton in `startDaemon()`; result-back-to-caller dispatch via `TurnDispatcher` on `task_complete` call from B.

### Claude's Discretion (within the above)

- Internal file organization under `src/tasks/` (extend the 58-01/02/03 module) — e.g. `manager.ts`, `schema-registry.ts`, `task-manager.ts`, `digest.ts`, `authorize.ts`, `handoff-errors.ts` — or fewer/more files as natural.
- SHA-256 normalization approach for `input_digest` — canonical JSON (sorted keys, no whitespace) is the de-facto standard; pick the lightest existing dep (node's `crypto.createHash('sha256')`).
- IPC method naming within the established kebab-case convention.
- Test layout under `src/tasks/__tests__/` + `src/mcp/__tests__/` (matches 58-01/02/03 convention).
- Exact error message strings (keep terse and actionable; include `task_id` and chain metadata where available).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/tasks/store.ts` (Phase 58) — `TaskStore` with `insert`, `transition`, `get`, `listStaleRunning`, `markOrphaned`, trigger_state CRUD — TaskManager consumes it directly
- `src/tasks/schema.ts` + `types.ts` + `errors.ts` + `state-machine.ts` (Phase 58) — row shape + `assertLegalTransition` + typed errors — extend with handoff-specific errors
- `src/manager/turn-dispatcher.ts` + `turn-origin.ts` (Phase 57) — dispatch B's result turn with `TurnOrigin{kind:'task'}`
- `src/manager/session-manager.ts` — B's turn flows through `streamFromAgent` via the dispatcher
- `src/performance/trace-collector.ts` — chain-token-cost accumulation; task rows pull from trace spans
- `src/mcp/server.ts` — shared MCP server with `TOOL_DEFINITIONS` + IPC bridging — add 3 new entries
- `src/ipc/protocol.ts` — `IPC_METHODS` registry — add `delegate-task`, `task-status`, `cancel-task`, `task-retry`
- `src/ipc/server.ts` — daemon-side IPC handlers
- `src/usage/budget.ts` + `src/usage/tracker.ts` — cost attribution hooks — delegated turn tokens bucket to caller
- `src/config/schema.ts` — agent config Zod — add `acceptsTasks` field
- `src/config/loader.ts` — config load + validate — picks up the new field automatically
- `src/shared/errors.ts` — typed error base class for the 5 new handoff errors
- `src/shared/logger.ts` — pino child loggers
- `nanoid`, `zod` v4 (both already deps)
- Node `crypto.createHash('sha256')` for `input_digest` (no new dep)

### Established Patterns
- **Shared MCP tools** map to IPC methods (`TOOL_DEFINITIONS[tool].ipcMethod`) — `src/mcp/server.ts` bridges them
- **Zod v4 schemas** co-located per feature (`src/tasks/schema.ts`, `src/config/schema.ts`)
- **Typed errors** extend `Error` in `src/shared/errors.ts` or feature-local `errors.ts`
- **Readonly types** on all domain shapes
- **Daemon-scoped singletons** wired in `src/manager/daemon.ts` `startDaemon()`
- **Idempotent migration pattern** from Phase 52/57-02/58-02 via `PRAGMA table_info()` — NOT needed this phase (no schema changes; Phase 58 already owns the tasks table)
- **Co-located tests** in `src/tasks/__tests__/*.test.ts` and `src/mcp/__tests__/*.test.ts`
- **Protocol parity lesson (Phase 50):** any IPC method must register in `protocol.ts` + have a test in `protocol.test.ts`

### Integration Points
- `src/manager/daemon.ts` `startDaemon()` — instantiate `TaskManager` after `TaskStore`; expose on the daemon return value (follows the `taskStore: TaskStore` precedent from Phase 58-03)
- `src/mcp/server.ts` `TOOL_DEFINITIONS` — three new entries (`delegate_task`, `task_status`, `cancel_task`) each mapped to their IPC method
- `src/ipc/protocol.ts` `IPC_METHODS` — four new entries (`delegate-task`, `task-status`, `cancel-task`, `task-retry`)
- `src/ipc/server.ts` — four new route handlers calling `TaskManager` methods
- `src/cli/commands/` — new `tasks.ts` command with `retry <task_id>` + `status <task_id>` subcommands
- `src/config/schema.ts` `agentSchema` — add optional `acceptsTasks: z.record(z.string(), z.array(z.string()))`
- `src/manager/turn-dispatcher.ts` — TaskManager calls `turnDispatcher.dispatch({ origin: { kind: 'task', id: taskId, rootTurnId, chain } })` on task completion

</code_context>

<specifics>
## Specific Ideas

- **Digest algorithm:** SHA-256 of canonical JSON (sorted keys, no whitespace, UTF-8 bytes) — deterministic, collision-resistant, native to Node `crypto`. Same payload → same 64-hex string.
- **Cycle detection:** Walk the `causation_id` chain via `TaskStore.get(parent_task_id)` recursively up to `depth`; reject if `target_agent` appears anywhere in the chain. Cap at `MAX_HANDOFF_DEPTH` (5) to bound worst-case walk.
- **Deadline propagation:** `delegate_task` accepts optional `deadline_ms` (absolute wall-clock milliseconds). If omitted, inherit from caller's chain deadline (stored on the root task row). AbortSignal fires at the deadline, flipping task status to `timed_out` and aborting B's turn.
- **Cost attribution:** B's `chain_token_cost` is summed and written to the caller's `usage/tracker.ts` bucket at task completion. Per-task override: optional `budgetOwner` param on `delegate_task` (HAND-04 pre-authorized).
- **Retry idempotency proof:** `tasks retry <task_id>` reads the row, re-validates payload, re-computes `input_digest` — must match the original digest byte-exactly before re-dispatching. Mismatch → error.
- **Self-handoff block:** Trivial `if (target_agent === caller_agent) throw SelfHandoffBlockedError` at the top of `delegate()` before any I/O (HAND-07).
- **Payload size check order:** `Buffer.byteLength(JSON.stringify(payload))` BEFORE Zod parse — fail fast with `ValidationError` on oversize without doing schema work on garbage.
- **Authorization check order** (fail fast sequence):
  1. Self-handoff block (cheapest, no I/O)
  2. Schema exists in registry (fast, in-memory)
  3. Payload size cap (one JSON stringify)
  4. Zod validation (full payload walk)
  5. Allowlist check (agent config lookup)
  6. Depth cap + cycle detection (DB read walk)
- **Result turn construction:** When B completes, TaskManager reads the result digest → reconstructs result payload from trace spans → constructs `TurnOrigin{kind:'task', id: task_id, rootTurnId, chain: [...chain, task_id]}` → calls `turnDispatcher.dispatch({ agentName: caller, origin, payload: {resultSchemaName, result} })`.
- **Audit trail:** Every `delegate_task` call logs a structured pino entry at info level with `{caller, target, schema, task_id, causation_id, depth}` — Phase 63 CLIs read trace rows, not audit log, but this helps live debugging during Phase 59.

</specifics>

<deferred>
## Deferred Ideas

- Auto-retry policy (vs CLI-only retry) — LIFE-06 mentions "(future) auto-retry policy" — explicitly out of scope
- `clawcode tasks` list/inspect CLIs — Phase 63 OBS-02 owns
- Dashboard graph panel for in-flight tasks — Phase 63 OBS-03
- `clawcode trace <causation_id>` chain walker — Phase 63 OBS-04
- Policy-driven routing (task target chosen by policy rule rather than explicit `target` param) — Phase 62 POL-02
- Task retention cleanup (7-day default purge) — Phase 60 LIFE-03

</deferred>
