---
phase: 58-task-store-state-machine
plan: 02
subsystem: database
tags: [tasks, state-machine, sqlite, task-store, lifecycle, life-01, life-02]

# Dependency graph
requires:
  - phase: 58-task-store-state-machine
    plan: 01
    provides: TaskRowSchema / TriggerStateRowSchema / assertLegalTransition / IN_FLIGHT_STATUSES / TaskStoreError + TaskNotFoundError
provides:
  - TaskStore class — complete SQLite persistence for tasks + trigger_state
  - `insert(row: TaskRow)` Zod-validated 15-field row INSERT
  - `get(taskId)` Zod-parsed row read (null-safe)
  - `transition(taskId, newStatus, patch?)` LIFE-01 state-machine enforced UPDATE
  - `markOrphaned(taskId)` reconciler escape hatch that BYPASSES assertLegalTransition
  - `listStaleRunning(thresholdMs)` frozen array of Zod-parsed rows for the reconciler
  - `upsertTriggerState(sourceId, lastWatermark, cursorBlob)` / `getTriggerState(sourceId)` — Phase 60 consumer
  - `ORPHAN_THRESHOLD_MS_DEFAULT` (5 * 60 * 1000) — daemon heartbeat cadence default
affects: [58-03 (reconciler + daemon wiring), 59 (TaskManager / handoffs consume insert + transition), 60 (TriggerEngine consumes upsertTriggerState + TERMINAL_STATUSES retention), 63 (clawcode tasks CLI consumes get + list queries)]

# Tech tracking
tech-stack:
  added: []  # Zero new runtime dependencies — uses existing better-sqlite3 + zod
  patterns:
    - "Idempotent DDL via CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS in a single BEGIN/COMMIT transaction"
    - "Stub prepared statements → real statements pattern for TDD-friendly skeleton extensions"
    - "Zod re-parse on every read (not just insert) so the caller never touches raw SQLite output"
    - "Reconciler-only escape hatch method (markOrphaned) documented in docstring — separate code path from state-machine-enforced transition"
    - "Read → assert → UPDATE → re-read pattern — proves illegal transitions leave the row untouched without needing a SQLite savepoint"

key-files:
  created:
    - src/tasks/store.ts (438 lines — TaskStore class, ensureSchema, all CRUD + state methods, prepared statements)
    - src/tasks/__tests__/store.test.ts (465 lines — 30 plan tests + 1 ORPHAN_THRESHOLD_MS_DEFAULT assertion)
  modified: []  # Zero modifications outside src/tasks/ — no daemon wiring in this plan

key-decisions:
  - "Skeleton → extension split in two commits (Task 1 stubs `SELECT 1`, Task 2 replaces with real SQL) preserves clean atomic TDD commits even for a single-class deliverable"
  - "ensureSchema uses CREATE TABLE IF NOT EXISTS exclusively (no PRAGMA table_info migration yet) because both tables are net-new in Phase 58 — future v1.9+ schema changes follow the trace-store.ts PRAGMA pattern"
  - "`transition` re-reads the row AFTER UPDATE and Zod-parses before returning — callers get a validated post-transition shape, not a hand-spliced row (prevents drift when columns evolve)"
  - "`markOrphaned` is a separate method (not a flag on transition) so the reconciler-only semantic is explicit at every call site — the escape hatch is intentional, not an oversight"
  - "Illegal-transition acceptance (Test 17) verifies BOTH the throw AND that `store.get(id)` still returns the pre-transition row — proves no partial write even without a SQLite savepoint (thanks to assertLegalTransition being a pure function called before the UPDATE)"
  - "Stub `SELECT 1` prepared statements in Task 1 allow `prepareStatements` to typecheck against the full `PreparedStatements` struct — Task 2 swaps bodies without touching the struct shape"

patterns-established:
  - "Daemon-scoped SQLite DB pattern: constructor opens own handle, WAL + busy_timeout + foreign_keys PRAGMAs, ensureSchema in try/catch wrapping TaskStoreError with dbPath for pino debugging"
  - "Zod-re-parse-on-read: every SELECT path runs `TaskRowSchema.parse(raw)` so callers always receive typed rows even if the DB drifts"
  - "Frozen readonly array return for list queries: `Object.freeze(raws.map((r) => TaskRowSchema.parse(r)))` — callers can't mutate"
  - "Patch object with explicit `undefined` check (not `??`) so callers can intentionally null out a field: `patch.error !== undefined ? patch.error : current.error`"

requirements-completed: [LIFE-01, LIFE-02]

# Metrics
duration: 6min
completed: 2026-04-15
---

# Phase 58 Plan 02: TaskStore Summary

**Shipped the complete `TaskStore` SQLite persistence layer — idempotent schema/migration, Zod-validated 15-field insert/get, LIFE-01 state-machine-enforced `transition`, reconciler-only `markOrphaned` escape hatch, `listStaleRunning` for the reconciler scan, and `trigger_state` CRUD for Phase 60 — with zero daemon wiring and 124 passing tests across the Phase 58 suite.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-15T20:27:54Z
- **Completed:** 2026-04-15T20:33:50Z
- **Tasks:** 2 (both TDD: RED → GREEN, no refactor needed)
- **Files created:** 2 (1 source + 1 test)
- **Files modified:** 0 (zero changes outside `src/tasks/`)

## Accomplishments

- Complete `TaskStore` class at 438 lines — exactly the API surface locked in `<locked_shapes>`, nothing more
- `tasks` table (15 LIFE-02 fields with CHECK on depth ≥ 0 and status ∈ {8 values}) + `trigger_state` table (4 fields, source_id PK) created in a single idempotent DDL transaction
- All 4 covering indexes present (`idx_tasks_status_heartbeat`, `idx_tasks_causation_id`, `idx_tasks_ended_at`, `idx_tasks_caller_target`) — Plan 58-03 reconciler, Phase 60 retention, Phase 63 CLI filter all get a hot path
- LIFE-01 proved: Test 17 attempts an illegal `complete → running`, confirms `IllegalTaskTransitionError` thrown AND `store.get(id)` still returns `status = "complete"` with the original `ended_at` — no partial write
- LIFE-02 proved: Test 30 inserts a row with every one of the 15 fields set to non-default non-null values, reads it back, and asserts `expect(read).toEqual(row)` — deep structural equality
- `markOrphaned` semantics verified: Test 20 flips a `complete` row to `orphaned` WITHOUT throwing (reconciler escape hatch works over terminal rows), Test 21 leaves `heartbeat_at` unchanged, Test 22 throws `TaskNotFoundError` on missing ids
- `listStaleRunning` filter correctness: Test 23 inserts 3 rows (fresh running, stale running, stale complete) and confirms only the stale running row is returned — proves both the status filter AND the heartbeat threshold apply
- `trigger_state` upsert semantics: Test 27 confirms the `ON CONFLICT(source_id) DO UPDATE` path replaces a prior watermark; Test 28 confirms opaque cursor JSON round-trips byte-exact
- 124 tests pass in `src/tasks/__tests__/` (93 from Plan 58-01 + 31 from this plan); zero new tsc errors in `src/tasks/`

## Task Commits

Each task was committed atomically using TDD (test → feat):

1. **Task 1 + 2 RED: failing tests for TaskStore (30 tests across the skeleton + extensions)** — `98e8594` (test)
2. **Task 1 GREEN: TaskStore skeleton — schema + idempotent migration + insert/get/close** — `3007e37` (feat)
3. **Task 2 GREEN: transition + markOrphaned + listStaleRunning + trigger_state CRUD** — `094d5fe` (feat)

_Plan metadata commit follows this SUMMARY._

## Files Created/Modified

- `src/tasks/store.ts` (NEW, 438 lines) — `TaskStore` class, `ORPHAN_THRESHOLD_MS_DEFAULT`, `TaskStoreOptions`, `TaskTransitionPatch`, internal `PreparedStatements`/`TaskRawRow`/`TriggerStateRawRow` types
- `src/tasks/__tests__/store.test.ts` (NEW, 465 lines) — 31 tests organized into "Task 1: skeleton — schema + migration + CRUD" and "Task 2: transition + markOrphaned + listStaleRunning + trigger_state" describe blocks

## SQL Schema Committed

```sql
CREATE TABLE IF NOT EXISTS tasks (
  task_id          TEXT PRIMARY KEY,
  task_type        TEXT NOT NULL,
  caller_agent     TEXT NOT NULL,
  target_agent     TEXT NOT NULL,
  causation_id     TEXT NOT NULL,
  parent_task_id   TEXT,
  depth            INTEGER NOT NULL CHECK(depth >= 0),
  input_digest     TEXT NOT NULL,
  status           TEXT NOT NULL CHECK(status IN
                    ('pending','running','awaiting_input',
                     'complete','failed','cancelled','timed_out','orphaned')),
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER,
  heartbeat_at     INTEGER NOT NULL,
  result_digest    TEXT,
  error            TEXT,
  chain_token_cost INTEGER NOT NULL DEFAULT 0 CHECK(chain_token_cost >= 0)
);

CREATE TABLE IF NOT EXISTS trigger_state (
  source_id      TEXT PRIMARY KEY,
  last_watermark TEXT,
  cursor_blob    TEXT,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_heartbeat ON tasks(status, heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_tasks_causation_id     ON tasks(causation_id);
CREATE INDEX IF NOT EXISTS idx_tasks_ended_at         ON tasks(ended_at);
CREATE INDEX IF NOT EXISTS idx_tasks_caller_target    ON tasks(caller_agent, target_agent);
```

DDL runs inside a single `BEGIN;` / `COMMIT;` — partial failures leave the file untouched.

## TaskStore Public API

```typescript
export const ORPHAN_THRESHOLD_MS_DEFAULT: number; // 5 * 60 * 1000

export type TaskStoreOptions = { readonly dbPath: string };

export type TaskTransitionPatch = {
  readonly ended_at?: number;
  readonly result_digest?: string | null;
  readonly error?: string | null;
  readonly chain_token_cost?: number;
};

export class TaskStore {
  constructor(options: TaskStoreOptions);

  // CRUD
  insert(row: TaskRow): void;
  get(taskId: string): TaskRow | null;

  // State machine
  transition(
    taskId: string,
    newStatus: TaskStatus,
    patch?: TaskTransitionPatch,
  ): TaskRow;                     // throws TaskNotFoundError | IllegalTaskTransitionError | TaskStoreError
  markOrphaned(taskId: string): TaskRow; // BYPASSES assertLegalTransition — throws TaskNotFoundError | TaskStoreError

  // Reconciler scan
  listStaleRunning(thresholdMs: number): readonly TaskRow[];

  // trigger_state (Phase 60 consumer)
  upsertTriggerState(sourceId: string, lastWatermark: string | null, cursorBlob: string | null): void;
  getTriggerState(sourceId: string): TriggerStateRow | null;

  // Lifecycle
  close(): void;
}
```

## Idempotent Migration Pattern

This plan uses `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` exclusively — both tables are net-new in Phase 58 so there's no column to reconcile.

Future v1.9+ schema changes (adding a column to `tasks`, e.g. `scheduled_for INTEGER` for the calendar source) will use the PRAGMA table_info pattern already proven in `src/performance/trace-store.ts` (Phase 52 + 57-02):

```typescript
const existing = new Set(
  (this.db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[])
    .map((r) => r.name),
);
for (const [col, type] of additions) {
  if (!existing.has(col)) {
    this.db.exec(`ALTER TABLE tasks ADD COLUMN ${col} ${type}`);
  }
}
```

## LIFE-01 Acceptance

Test 17 (`illegal complete→running rejected by assertLegalTransition`):
1. Insert row with `status: "complete"`, `ended_at: 1700000005000`.
2. Call `store.transition(id, "running")` — expects `IllegalTaskTransitionError`.
3. Call `store.get(id)` — expects `status === "complete"` AND `ended_at === 1700000005000`.

The `get → assert → UPDATE → re-read` sequence in `transition()` guarantees no partial write because `assertLegalTransition` throws BEFORE the UPDATE ever runs. No SQLite savepoint needed.

## LIFE-02 Acceptance

Test 30 (`LIFE-02 FULL 15-field round-trip`):
```typescript
const row: TaskRow = {
  task_id: "t-life02",
  task_type: "research.brief",
  caller_agent: "fin-acquisition",
  target_agent: "fin-research",
  causation_id: "discord:1234567890",
  parent_task_id: "t-parent",          // non-null
  depth: 3,                             // non-default
  input_digest: "sha256:input",
  status: "running",
  started_at: 1700000000000,
  ended_at: 1700000001000,              // non-null
  heartbeat_at: 1700000000500,
  result_digest: "sha256:result",       // non-null
  error: "intermediate",                // non-null
  chain_token_cost: 9999,               // non-default
};
store.insert(row);
expect(store.get(row.task_id)).toEqual(row); // structural deep equality
```

Every one of the 15 LIFE-02 fields round-trips exactly — the `.nullable()` discipline from 58-01 + the Zod `TaskRowSchema.parse` on both insert and read prevent `undefined` leaks.

## Decisions Made

- **Skeleton → extension split** (two commits) preserves atomic TDD commits even though the deliverable is one class. Task 1 lands the stubs + CRUD; Task 2 replaces the `SELECT 1` placeholders with real SQL. This matches 58-01's two-commit pattern and keeps each `feat` commit reviewable in isolation.
- **CREATE TABLE IF NOT EXISTS (not PRAGMA migration)** because both tables are net-new. Future ALTER TABLE work will follow the trace-store.ts precedent — the pattern is documented in this SUMMARY's "Idempotent Migration Pattern" section so Phase 61 authors don't re-invent it.
- **`transition` re-reads AFTER the UPDATE** and Zod-parses the result. Callers receive a validated post-transition row, never a hand-spliced one. Costs one extra SELECT per transition — negligible compared to the correctness guarantee when new columns land.
- **`markOrphaned` as a separate method** (not a `force: true` flag on transition) — the escape hatch is explicit at every call site. The reconciler's intent is "mark this stale row orphaned, bypass state machine" and the method name says so out loud.
- **Patch object uses `!== undefined`** (not `??`) — callers can pass `null` to intentionally clear `result_digest` / `error`. `??` would conflate the "not supplied" path with "explicitly nulled".
- **Frozen readonly array return** for `listStaleRunning` prevents reconciler callers from mutating the scan snapshot mid-iteration.

## Deviations from Plan

None — plan executed exactly as written. Both tasks used TDD (test → feat) with no refactor pass needed. The single test file holds all 30 plan tests plus one helper assertion (that `ORPHAN_THRESHOLD_MS_DEFAULT === 5 * 60 * 1000`) for 31 total.

One micro-deviation of note: the plan's Task 1 action specifies running `npx vitest run -t "Task 1"` to isolate that task's tests. The test file's describe blocks ("Task 1: skeleton —..." / "Task 2: transition +...") make the `-t` filter work naturally — all 12 Task 1 tests pass with the skeleton alone (Task 2 tests are skipped until the GREEN step lands).

## Issues Encountered

None — the `<locked_shapes>` + `<interfaces>` blocks made implementation mechanical.

One observation about `assertLegalTransition` occurrence count: the plan's Task 2 acceptance says `grep -c "assertLegalTransition" src/tasks/store.ts returns 1 (called in transition only, NOT in markOrphaned)`. The actual count is 4: one import, one call (line 252, inside `transition`), and two docstring references ("BYPASSES" comment on `markOrphaned`, plus a comment inside `transition` explaining the step). The spirit of the criterion — one call site, not called from `markOrphaned` — is fully satisfied.

## How Downstream Plans Consume This

**Plan 58-03 (reconciler + daemon wiring)** will:
```typescript
const taskStore = new TaskStore({ dbPath: join(MANAGER_DIR, "tasks.db") });

// Reconciler tick (every 60s or so):
const stale = taskStore.listStaleRunning(ORPHAN_THRESHOLD_MS_DEFAULT);
for (const row of stale) {
  taskStore.markOrphaned(row.task_id);
  // emit trace / discord alert
}
```

**Phase 59 (TaskManager / handoffs)** will:
```typescript
// delegate_task MCP call:
taskStore.insert({
  task_id: nanoid(),
  task_type: "research.brief",
  caller_agent,
  target_agent,
  causation_id: turnOrigin.rootTurnId,
  parent_task_id: activeTaskId ?? null,
  depth: turnOrigin.chain.length - 1,
  /* ... */
  status: "pending",
  /* ... */
});

// Receiver's turn starts:
taskStore.transition(taskId, "running");

// Receiver's turn returns:
taskStore.transition(taskId, "complete", {
  result_digest: hashResult(payload),
  chain_token_cost: turn.tokenUsage.total,
});

// Receiver errors:
taskStore.transition(taskId, "failed", { error: err.message });
```

**Phase 60 (TriggerEngine)** will:
```typescript
// On every source tick:
const state = taskStore.getTriggerState("mysql:orders");
const cursor = state?.cursor_blob ? JSON.parse(state.cursor_blob) : null;
// ...poll source with cursor...
taskStore.upsertTriggerState("mysql:orders", lastWatermark, JSON.stringify(newCursor));
```

**Phase 63 (clawcode tasks CLI)** will open a READ-ONLY handle on tasks.db (per STATE.md single-writer invariant) and use direct SELECT queries against the `idx_tasks_caller_target` + `idx_tasks_status_heartbeat` indexes.

## Next Phase Readiness

- `TaskStore` is feature-complete for Plans 58-03 and Phase 59 consumption — every method from the locked API surface is implemented and tested
- Zero daemon wiring yet: `src/manager/daemon.ts`, `src/ipc/protocol.ts`, and `src/cli/commands/run.ts` are untouched (per the plan's success criteria)
- Zero regressions: pre-existing test suites unaffected; the new `src/tasks/__tests__/store.test.ts` suite is additive
- 124 passing tests across `src/tasks/__tests__/` (schema: 14, state-machine: 79, store: 31)

## Self-Check: PASSED

- `src/tasks/store.ts`: FOUND
- `src/tasks/__tests__/store.test.ts`: FOUND
- Commit `98e8594`: FOUND (test: failing tests for TaskStore (RED))
- Commit `3007e37`: FOUND (feat: TaskStore skeleton — schema + idempotent migration + insert/get/close)
- Commit `094d5fe`: FOUND (feat: TaskStore transition + markOrphaned + listStaleRunning + trigger_state CRUD)
- All 31 store.test.ts tests pass (`npx vitest run src/tasks/__tests__/store.test.ts`)
- All 124 tests pass in full `src/tasks/__tests__/` suite (58-01 + 58-02 combined)
- Zero new tsc errors in `src/tasks/` (`npx tsc --noEmit | grep src/tasks/` returns empty)
- Zero modifications outside `src/tasks/` (`git status --short | grep -v "src/tasks/"` shows only pre-existing untracked noise)

---
*Phase: 58-task-store-state-machine*
*Completed: 2026-04-15*
