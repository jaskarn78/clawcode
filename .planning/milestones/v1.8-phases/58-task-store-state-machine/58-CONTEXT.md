# Phase 58: Task Store + State Machine - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning
**Mode:** Infrastructure phase — discuss skipped

<domain>
## Phase Boundary

Ship the daemon-scoped `tasks.db` SQLite store that every inter-agent task (Phase 59) and every proactive turn (Phase 60) will write to. Deliver: the full schema (`tasks` table + `trigger_state` table + indexes), a Zod-validated task row shape, a canonical state machine (`pending | running | awaiting_input | complete | failed | cancelled | timed_out | orphaned`) that rejects illegal transitions with typed errors, chain metadata fields (`causation_id`, `parent_task_id`, `depth`) wired into row inserts, and daemon-startup orphan reconciliation (tasks with stale `heartbeat_at` marked `orphaned`). No MCP tools, no IPC methods, no CLI commands, no handoff logic, no trigger logic — purely the persistent substrate downstream phases build on.

</domain>

<decisions>
## Implementation Decisions

### Locked Pre-Decisions (from roadmap + STATE.md + REQUIREMENTS.md)

- **Database is daemon-scoped**: `~/.clawcode/manager/tasks.db` — shared across all agents, single daemon process writes it. Agents NEVER write directly (LIFE-01).
- **Single-writer invariant preserved**: any read-only consumer (CLI, dashboard) must use a separate read-only SQLite handle (STATE.md blocker).
- **Task states** (LOCKED set): `pending`, `running`, `awaiting_input`, `complete`, `failed`, `cancelled`, `timed_out`, plus `orphaned` (terminal, reconciler-assigned).
- **Legal transitions** (LOCKED):
  - `pending → running | cancelled`
  - `running → awaiting_input | complete | failed | cancelled | timed_out`
  - `awaiting_input → running | cancelled | timed_out`
  - Terminal (no outbound): `complete`, `failed`, `cancelled`, `timed_out`, `orphaned`
  - Illegal (e.g., `complete → running`) throws `IllegalTaskTransitionError`.
- **Row shape** (LOCKED per LIFE-02): `task_id`, `task_type`, `caller_agent`, `target_agent`, `causation_id`, `parent_task_id` (nullable), `depth`, `input_digest` (hash, not raw payload), `status`, `started_at`, `ended_at` (nullable), `heartbeat_at`, `result_digest` (nullable), `error` (nullable), `chain_token_cost` (default 0).
- **input_digest and result_digest are HASHES**: the full payload lives in traces.db; tasks.db stores only a deterministic hash for dedup + idempotent retry (per HAND-02 payload cap, enforced in Phase 59 — but hash-only storage is decided here).
- **Chain metadata sourced from `TurnOrigin`** (Phase 57): `causation_id := origin.rootTurnId`, `parent_task_id` from caller's in-flight task, `depth := origin.chain.length` (invariant checked at insert time).
- **Orphan reconciliation** runs at daemon startup: scan for `status = 'running' OR 'awaiting_input'` AND `heartbeat_at < now - ORPHAN_THRESHOLD_MS` → transition to `orphaned`. Threshold configurable, default per STATE.md convention.
- **`trigger_state` table** lives here too (per roadmap Phase 60 dep-note): stores watermarks / cursors / replay bookmarks for triggers. Schema: `source_id TEXT PRIMARY KEY`, `last_watermark TEXT`, `cursor_blob TEXT`, `updated_at INTEGER`. No business logic yet — Phase 60 writes to it.
- **Zod schema parity** with row shape: every field validated on insert; parse round-trip used for reads in tests.
- **Task retention** handled in Phase 60 (LIFE-03) — this phase only provides the `ended_at` index for the cleanup query.

### Claude's Discretion
- SQLite-specific choices: column types (INTEGER vs TEXT for timestamps — use INTEGER unix millis matching v1.7 traces.db convention), index set (at minimum `(status, heartbeat_at)` for reconciliation and `(causation_id)` for chain queries), WAL mode on/off (match existing daemon DB conventions).
- File organization: `src/tasks/store.ts`, `src/tasks/schema.ts` (Zod), `src/tasks/state-machine.ts`, `src/tasks/reconciler.ts` — or fewer files if natural. Follow `src/memory/store.ts` pattern from v1.0.
- Typed error class names and hierarchy: extend `Error` in `src/tasks/errors.ts` or reuse `src/shared/errors.ts` — follow existing convention.
- Migration strategy for schema changes inside v1.8: use CREATE TABLE IF NOT EXISTS + idempotent ALTER guarded by `PRAGMA table_info()` membership checks (established pattern from Phase 52 and Phase 57-02).
- Test layout: `src/tasks/__tests__/*.test.ts` per STRUCTURE.md convention.
- Whether to expose anything over IPC — PRE-DECISION: DO NOT expose over IPC in this phase. Phase 59 adds `delegate_task` / `task_status` / `cancel_task` / `task_complete` IPC methods. This phase's exports are the TaskStore TypeScript class + state machine + Zod schema — all consumed in-process by the Phase 59 TaskManager.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/memory/store.ts` — canonical better-sqlite3 + Zod store pattern (synchronous prepared statements, `loadExtension` pattern if needed); model for `src/tasks/store.ts`
- `src/performance/trace-store.ts` — v1.7 example of `PRAGMA table_info()` idempotent migration + `turn_origin` column add (Phase 57-02 just extended this pattern)
- `src/usage/budget.ts` — daemon-scoped SQLite example (`~/.clawcode/manager/escalation-budget.db`)
- `src/usage/tracker.ts` — per-agent usage log pattern
- `nanoid` (already dep) — `task_id` generation
- `zod` v4 (already dep) — task row schema
- `src/shared/errors.ts` — typed error class conventions (`ManagerError`, `MemoryError` pattern) — add `TaskStoreError`, `IllegalTaskTransitionError`

### Established Patterns
- **Daemon-scoped DBs**: `~/.clawcode/manager/*.db` — singleton created during `startDaemon()` in `src/manager/daemon.ts` (Phase 57-03 now owns the TurnDispatcher wiring alongside other singletons there)
- **Readonly Zod schemas**: `src/config/schema.ts` defines all config shapes with `.readonly()` variants — task row should follow same pattern
- **`schema.ts` per feature directory**: co-located Zod schemas (see `src/ipc/protocol.ts`, `src/memory/schema.ts`)
- **Typed errors extend `Error`**: all subclasses in `src/shared/errors.ts` (or feature-local `errors.ts` for internal-only errors)
- **Co-located tests**: `src/tasks/__tests__/*.test.ts` (matches STRUCTURE.md)
- **Heartbeat integration**: `src/heartbeat/runner.ts` already hosts periodic jobs — Phase 58 DOES NOT add a heartbeat check (reconciler runs once at startup, not periodically — design decision from STATE.md convention)

### Integration Points
- `src/manager/daemon.ts` `startDaemon()` — instantiate `TaskStore` singleton (after TurnDispatcher, before SessionManager or before MCP server — wherever existing DB singletons are created); call `reconciler.runStartupReconciliation()` after construction; close handle on shutdown
- Phase 59 (next milestone phase) will consume `TaskStore.insert`, `TaskStore.transition`, `TaskStore.get` via TypeScript import — no IPC or MCP coupling in this phase
- Phase 60 writes to the `trigger_state` table with the daemon-scoped SQLite handle provided here
- `src/manager/turn-origin.ts` (Phase 57) provides `TurnOrigin.rootTurnId` / `TurnOrigin.chain.length` — consume these when constructing task rows in Phase 59 (no import needed in this phase except to reference the shape in the schema doc comments)

</code_context>

<specifics>
## Specific Ideas

- Keep the store flat: one `TaskStore` class with insert/get/transition/listStale/markOrphaned methods — no `TaskRepository`-style factories
- State machine is a pure function + an error class: `assertLegalTransition(from, to): void` that throws `IllegalTaskTransitionError(from, to)` — no separate state-machine object
- Use `JSON.stringify(cost)` if `chain_token_cost` becomes structured; otherwise keep as `INTEGER` unix millis — default 0
- Include a migration guard that rolls out the schema atomically: `BEGIN; CREATE TABLE IF NOT EXISTS tasks (...); CREATE TABLE IF NOT EXISTS trigger_state (...); CREATE INDEX IF NOT EXISTS ...; COMMIT;`
- Test the state machine with a table-driven enumeration: every `(from, to)` pair either in legal-transitions set or rejected — no implicit paths
- Orphan reconciliation test: populate 3 rows (one `running` w/ fresh heartbeat, one `running` w/ stale heartbeat, one `complete`), run reconciliation, assert only middle row becomes `orphaned`
- Success criterion 1 ("fresh host → tasks.db created") test: point `TaskStore` at a temp dir, assert `~/.clawcode/manager/tasks.db` exists with full schema via `sqlite3 .schema tasks`

</specifics>

<deferred>
## Deferred Ideas

- `delegate_task`, `task_status`, `cancel_task`, `task_complete` IPC methods → Phase 59
- Retention cleanup (7 days default) → Phase 60 (LIFE-03)
- Cost attribution enforcement → Phase 59 (LIFE-05)
- Manual retry CLI → Phase 59 (LIFE-06)
- `clawcode tasks` CLI → Phase 63 (OBS-02)

</deferred>
