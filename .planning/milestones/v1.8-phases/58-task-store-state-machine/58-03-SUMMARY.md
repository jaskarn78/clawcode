---
phase: 58-task-store-state-machine
plan: 03
subsystem: database
tags: [tasks, reconciler, daemon, lifecycle, life-01, life-04]

# Dependency graph
requires:
  - phase: 58-task-store-state-machine
    plan: 01
    provides: IN_FLIGHT_STATUSES / TaskStatus types (indirect — consumed via TaskStore)
  - phase: 58-task-store-state-machine
    plan: 02
    provides: TaskStore class (listStaleRunning + markOrphaned + close + ctor on dbPath)
provides:
  - runStartupReconciliation(store, thresholdMs, log?): pure-function reconciler for stale in-flight rows
  - ORPHAN_THRESHOLD_MS = 5 * 60 * 1000 (5-min default, 5 × 60s heartbeats)
  - ReconciliationResult { reconciledCount, reconciledTaskIds } — frozen return shape
  - daemon.ts taskStore singleton exposed on startDaemon's Promise return type
  - daemon.ts shutdown path now closes the tasks.db SQLite handle
affects: [59 (TaskManager imports taskStore from startDaemon return), 60 (TriggerEngine consumes trigger_state table via same singleton), 63 (CLIs open READ-ONLY handle against the daemon-created DB)]

# Tech tracking
tech-stack:
  added: []  # Zero new runtime dependencies
  patterns:
    - "Daemon-scoped SQLite singleton initialized inline after TurnDispatcher (mirrors EscalationBudget / AdvisorBudget precedent)"
    - "Startup-only reconciler (not a heartbeat — decided in 58-CONTEXT.md): runs synchronously before SessionManager.startAll"
    - "Source-grep + runtime-schema hybrid test pattern (mirrors daemon-warmup-probe.test.ts from Phase 56)"
    - "Frozen ReconciliationResult + frozen reconciledTaskIds — callers cannot mutate scan snapshot post-hoc"
    - "try/catch wrapping taskStore.close() in shutdown so a close error does not abort socket/pid cleanup"

key-files:
  created:
    - src/tasks/reconciler.ts (95 lines — runStartupReconciliation + ORPHAN_THRESHOLD_MS + ReconciliationResult)
    - src/tasks/__tests__/reconciler.test.ts (282 lines — 9 tests covering LIFE-04)
    - src/manager/__tests__/daemon-task-store.test.ts (214 lines — 17 tests; source-grep + runtime schema + reconciliation-on-reboot)
  modified:
    - src/manager/daemon.ts (4 surgical edits — 2 new imports, TaskStore instantiation + reconciliation block, shutdown close, return type + value expose)

key-decisions:
  - "runStartupReconciliation is a PURE function — no filesystem, no IPC, no SessionManager dependency; testable standalone against a tmp-file TaskStore"
  - "Logger argument is optional (log?: Logger) so unit tests can call the function without pino instrumentation boilerplate"
  - "ORPHAN_THRESHOLD_MS (5min) lives in reconciler.ts; TaskStore ships its own ORPHAN_THRESHOLD_MS_DEFAULT with the same value — Plan 58-02 already shipped the default; reconciler re-exports for the daemon call site to keep the import from reconciler.ts and not the store"
  - "TaskStore slots in as '6-ter' AFTER TurnDispatcher and BEFORE EscalationBudget — the TurnDispatcher precedent (Phase 57 Plan 03) is the closest 'daemon-scoped singleton' pattern to mirror"
  - "Reconciliation runs SYNCHRONOUSLY before SessionManager.startAll so Phase 59 delegate_task on the first tick cannot race a stale row carrying a duplicate task_id"
  - "Shutdown closes TaskStore AFTER manager.stopAll so any in-flight agent transition completes first, BEFORE unlink(SOCKET_PATH) so the socket still identifies the daemon during the close"
  - "Full startDaemon integration test NOT created — the codebase's established pattern (daemon-warmup-probe.test.ts, daemon-cache.test.ts, daemon-daily-summary.test.ts) is source-grep + unit-tested helpers because startDaemon boots Discord/webhooks/dashboard/embedder. Mirror pattern instead"

patterns-established:
  - "Daemon singleton wiring test pattern: source-level grep asserts position (indexOf ordering); runtime assertion against a freshly-constructed instance on tmp path proves the schema / behavior"
  - "Reconciler escape-hatch pattern: state-machine terminal status (`orphaned`) entered via a dedicated method that BYPASSES assertLegalTransition, documented at every call site"
  - "Logger injection via optional arg (log?: Logger): consumer-code path, not DI container — simpler and testable"

requirements-completed: [LIFE-01, LIFE-04]

# Metrics
duration: 7min
completed: 2026-04-15
---

# Phase 58 Plan 03: Daemon TaskStore Wiring + Orphan Reconciliation Summary

**Landed the startup-only orphan reconciler, wired TaskStore as a daemon singleton between TurnDispatcher and EscalationBudget, called reconciliation synchronously before SessionManager.startAll, and exposed `taskStore` on startDaemon's return value — closing Phase 58 with LIFE-01 + LIFE-04 proven and zero IPC / MCP / CLI surface added (Phase 59+ own all of that).**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-15T20:37:27Z
- **Completed:** 2026-04-15T20:44:44Z
- **Tasks:** 2 (Task 1 TDD: RED → GREEN; Task 2 auto with integration test)
- **Files created:** 3 (1 source + 2 tests)
- **Files modified:** 1 (src/manager/daemon.ts — 4 surgical edits)
- **Tests passing:** 150 across Phase 58 suite (93 + 31 + 9 + 17; prior suites unchanged)

## Accomplishments

- **`runStartupReconciliation`** pure function shipped at 95 lines — scans in-flight rows via `TaskStore.listStaleRunning`, flips each via `TaskStore.markOrphaned`, emits structured pino logs per row + a summary log, returns a frozen `ReconciliationResult`
- **`ORPHAN_THRESHOLD_MS = 5 * 60 * 1000`** exported with the 5-missed-heartbeats justification in the doc comment (60s default heartbeat cadence × 5 missed ticks = robust "definitely crashed" signal without flapping on long tool_use sequences)
- **daemon.ts wired** with 4 surgical edits: 2 new imports, the TaskStore + reconciliation instantiation block as step "6-ter" (after TurnDispatcher, before EscalationBudget), `taskStore.close()` in shutdown (after `manager.stopAll`, before `unlink(SOCKET_PATH)`, try/catch-wrapped), `taskStore: TaskStore` on the Promise return type + the return object
- **LIFE-04 proven** via the flagship 3-row mix test (fresh running + stale running + stale complete) — only the stale running row transitions to `orphaned`; reconciliation is idempotent (second pass zero-reconciles because orphaned is terminal)
- **LIFE-01 criterion 1 proven** via runtime schema assertions: constructing a fresh TaskStore at a tmp path produces tasks.db with all 15 LIFE-02 columns, trigger_state with 4 columns, and all 4 covering indexes
- **LIFE-04 reboot scenario** proven via a two-phase test: first boot creates the DB and plants a stale running row with `heartbeat_at = Date.now() - 10min`; second boot runs `runStartupReconciliation(store, ORPHAN_THRESHOLD_MS)` and finds `reconciledCount === 1`, with `status === 'orphaned'` + non-null `ended_at` post-pass
- **Zero new runtime dependencies** — uses existing pino + better-sqlite3 transitively via TaskStore
- **Scope boundary respected** — no IPC method additions (`grep -c "delegate_task\|task_status\|cancel_task\|task_complete" src/ipc/protocol.ts` returns 0), no MCP tools, no CLI commands; Phase 59+ own all of that

## Task Commits

Per-task atomic commits (Task 1 TDD, Task 2 auto):

1. **Task 1 RED: failing tests for runStartupReconciliation** — `4a390de` (test)
2. **Task 1 GREEN: runStartupReconciliation + ORPHAN_THRESHOLD_MS** — `09ed1ab` (feat)
3. **Task 2: wire TaskStore into daemon.ts startup + shutdown + return** — `d617718` (feat)

_Plan metadata commit follows this SUMMARY._

## Files Created/Modified

- `src/tasks/reconciler.ts` (NEW, 95 lines) — `runStartupReconciliation`, `ORPHAN_THRESHOLD_MS`, `ReconciliationResult`
- `src/tasks/__tests__/reconciler.test.ts` (NEW, 282 lines) — 9 tests covering LIFE-04 flagship + awaiting_input + idempotence + empty DB + logging contract + no-log path + threshold semantics + frozen return + constant sanity
- `src/manager/__tests__/daemon-task-store.test.ts` (NEW, 214 lines) — 17 tests: 11 source-grep assertions on daemon.ts wiring + 5 runtime schema assertions (LIFE-01 criterion 1) + 1 reboot-reconciliation test (LIFE-04)
- `src/manager/daemon.ts` (MODIFIED, 4 surgical edits) — 2 new imports; TaskStore instantiation + reconciliation block between lines 447–475; `taskStore.close()` in shutdown at line 940; return type + value expose

## How daemon.ts Now Wires TaskStore

```typescript
// 6-ter. Create TaskStore singleton (Phase 58 Plan 03).
// Daemon-scoped SQLite — shared across all agents, single-writer owned by
// the daemon. Consumers (Phase 59 TaskManager, Phase 60 TriggerEngine,
// Phase 63 CLIs via READ-ONLY handle) import the instance from startDaemon's
// return value. Agents NEVER write directly — the single-writer invariant
// (STATE.md Phase 58 blockers) must be preserved.
const taskStore = new TaskStore({
  dbPath: join(MANAGER_DIR, "tasks.db"),
});
log.info({ path: join(MANAGER_DIR, "tasks.db") }, "TaskStore initialized");

// Reconcile stale in-flight tasks from the previous daemon run BEFORE
// SessionManager.startAll fires — so any Phase 59 delegate_task on the
// first tick does not race against a stale row carrying a duplicate
// task_id (LIFE-04).
const reconciliation = runStartupReconciliation(
  taskStore,
  ORPHAN_THRESHOLD_MS,
  log,
);
if (reconciliation.reconciledCount > 0) {
  log.warn(
    {
      count: reconciliation.reconciledCount,
      taskIds: reconciliation.reconciledTaskIds,
    },
    "startup reconciliation marked stale tasks orphaned",
  );
}
```

Ordering invariants enforced by `daemon-task-store.test.ts`:

- `new TurnDispatcher(` comes BEFORE `new TaskStore(`
- `new TaskStore(` comes BEFORE `new EscalationBudget(`
- `new TaskStore(` comes BEFORE `runStartupReconciliation(`
- `runStartupReconciliation(` comes BEFORE `manager.startAll(`
- `await manager.stopAll();` (in shutdown) comes BEFORE `taskStore.close()`
- `taskStore.close()` comes BEFORE `unlink(SOCKET_PATH)`

## ORPHAN_THRESHOLD_MS Justification

**Value:** `5 * 60 * 1000` = 5 minutes.

**Reasoning** (from the `reconciler.ts` doc comment + 58-03-PLAN.md `<locked_shapes>`):

- Default daemon heartbeat cadence from `src/heartbeat/runner.ts` is **60 seconds**.
- A running agent's TaskManager (Phase 59) will refresh `heartbeat_at` at least every 60 seconds while a turn is active.
- **5 minutes = 5 missed heartbeats** — robust threshold for "definitely crashed vs slow turn".
- Smaller thresholds (e.g. 2 min) risk **flapping during long `tool_use` sequences** — one busy batch could spuriously orphan a healthy task.
- Larger thresholds (e.g. 30 min) **defeat LIFE-04's goal of prompt reconciliation** — a crashed task would sit stuck for half an hour before anyone notices.

Value is exposed as `ORPHAN_THRESHOLD_MS` (constant export, reconciler.ts) and also lives in store.ts as `ORPHAN_THRESHOLD_MS_DEFAULT` (shipped in Plan 58-02). Daemon imports from `reconciler.ts` so the call site reads naturally: `runStartupReconciliation(taskStore, ORPHAN_THRESHOLD_MS, log)`.

## LIFE-01 + LIFE-04 Acceptance Proof

**LIFE-01 criterion 1** ("Fresh host boot creates `~/.clawcode/manager/tasks.db` with the full Phase 58 schema"):

- `daemon-task-store.test.ts > runtime schema > creates the tasks.db file on construction`
- `> tasks table has all 15 LIFE-02 columns in order`
- `> trigger_state table has 4 columns (Phase 60 consumer)`
- `> has all 4 covering indexes on tasks`
- Uses the **exact construction call** daemon.ts runs — `new TaskStore({ dbPath })` — so the schema produced in the test IS the schema the daemon produces on boot.

**LIFE-04** ("Stale in-flight tasks get marked orphaned on daemon startup — never stuck in running forever"):

- `reconciler.test.ts Test 1` — the flagship 3-row mix (fresh running + stale running + stale complete): only the stale running row reconciles.
- `reconciler.test.ts Test 2` — `awaiting_input` with stale heartbeat also orphans (IN_FLIGHT_STATUSES covers both).
- `reconciler.test.ts Test 3` — idempotence: second pass reconciles zero rows because `orphaned` is terminal.
- `reconciler.test.ts Test 7` — threshold semantics: a 4-min-old row is skipped at 5-min threshold, caught at 3-min.
- `daemon-task-store.test.ts reboot test` — first boot plants a stale running row, second boot's reconciliation path transitions it to orphaned.

## Decisions Made

- **Reconciler is a pure function** (not a class) — no state to carry between passes, no lifecycle to manage. Takes `TaskStore` + `thresholdMs` + optional `Logger`, returns a frozen `ReconciliationResult`. Testable standalone against a tmp-file TaskStore; callers (daemon.ts) don't need to remember to `new Reconciler()` + dispose.
- **Logger is optional** (`log?: Logger`) so the reconciler tests can exercise the 9 scenarios without constructing a pino instance. The daemon always passes one, but unit tests don't need to.
- **Reconciliation runs synchronously before `SessionManager.startAll`** — if Phase 59's delegate_task on the first tick raced against a stale row carrying a duplicate `task_id`, the stale row's UNIQUE constraint would fail the new task. Reconciling first closes that gap.
- **`taskStore.close()` goes AFTER `manager.stopAll()`** — any in-flight agent transition that writes to the store completes first. Still before `unlink(SOCKET_PATH)` because the socket should identify the daemon during the close (logs arriving over IPC during shutdown shouldn't be orphaned).
- **try/catch wraps `taskStore.close()`** — a close error shouldn't abort the rest of the cleanup (socket + pid unlink). Follows the same pattern as `unlink(SOCKET_PATH).catch(...)` already in shutdown.
- **`log?.info` (optional chain) per row + summary** — explicit two-call pattern: per-row for the audit trail (which task, which agent, how stale), summary for the operator dashboard (how bad was the crash). Both at info level because a non-zero count is a daemon-restart evidence point, not a warning on its own — daemon.ts separately promotes `count > 0` to a `log.warn` for operator visibility.
- **`reconciledTaskIds` is frozen** (both the array and the `ReconciliationResult` object) — daemon.ts passes it straight to `log.warn`; no risk of a downstream caller mutating the audit snapshot post-hoc.
- **Source-grep + runtime-schema test pattern** (NOT full `startDaemon` integration) — the codebase's `daemon-warmup-probe.test.ts`, `daemon-cache.test.ts`, `daemon-daily-summary.test.ts`, and `daemon-latency-slo.test.ts` all use this pattern because `startDaemon` boots Discord + webhooks + dashboard + embedder (~30s warmup, network + Discord token required). Source-grep proves the wiring is in the documented position; runtime schema on the exact `new TaskStore({ dbPath })` call proves the bytes produced match LIFE-01 criterion 1.

## Deviations from Plan

**One deviation (Rule 3 — fix blocking issue): initial source-grep used `lastIndexOf("await manager.stopAll();")`** to find the shutdown call, but that picked up a later occurrence inside `routeMethod`'s IPC handler. Switched to `indexOf` with a comment explaining which `manager.stopAll()` is being selected. Found by running the test — one assertion failure, one-line fix.

**Plan's integration-test fallback honored:** the plan explicitly allowed downgrading to unit-style tests if HOME override for a full `startDaemon` boot proves infeasible — which it does here because `MANAGER_DIR` is computed at module load via `homedir()` (line 303 of daemon.ts). No existing test in `src/manager/__tests__/` calls `startDaemon()` directly; the established pattern is source-grep + unit-tested helpers. Adopted that pattern, documented the reasoning in the test file header.

Every acceptance-criterion grep from the plan's Task 2 block passes (11/11 checked).

## Issues Encountered

One pre-existing, unrelated `tsc` error on `src/manager/daemon.ts(2018,24): error TS2345 — CostByAgentModel is not assignable to { agent, model, input_tokens, output_tokens, cost_usd }`. Verified this error exists with and without my changes via `git stash -u`. Out of scope per plan's acceptance criterion ("pre-existing unrelated errors from Phase 57 SUMMARY are out of scope") and the Phase 57 SUMMARY precedent.

Zero new errors in `src/tasks/` or `src/manager/__tests__/daemon-task-store.test.ts`.

## How Downstream Plans Consume This

**Phase 59 (TaskManager / handoffs) will:**

```typescript
// No daemon.ts edits needed — taskStore is already on startDaemon's return value.
const { taskStore, manager, /* ... */ } = await startDaemon(configPath);

const taskManager = new TaskManager({
  taskStore,                    // <-- from Phase 58-03 daemon wiring
  sessionManager: manager,
  /* ... */
});

// delegate_task MCP tool handler:
taskStore.insert({
  task_id: nanoid(),
  task_type: "research.brief",
  caller_agent,
  target_agent,
  causation_id: turnOrigin.rootTurnId,
  parent_task_id: activeTaskId ?? null,
  depth: turnOrigin.chain.length - 1,
  status: "pending",
  /* ... */
});
```

**Phase 60 (TriggerEngine) will:**

```typescript
// On every source tick:
const state = taskStore.getTriggerState("mysql:orders");
const cursor = state?.cursor_blob ? JSON.parse(state.cursor_blob) : null;
// ...poll source with cursor...
taskStore.upsertTriggerState("mysql:orders", lastWatermark, JSON.stringify(newCursor));
```

**Phase 63 (clawcode tasks CLI)** opens a separate READ-ONLY handle against `~/.clawcode/manager/tasks.db` — daemon is the single writer; CLI is a reader only (STATE.md invariant). The 4 covering indexes (`idx_tasks_caller_target`, `idx_tasks_causation_id`, `idx_tasks_ended_at`, `idx_tasks_status_heartbeat`) give CLI filter queries a hot path.

## Ready-for-Phase-59 Handoff

**Phase 59 TaskManager constructor accepts `taskStore: TaskStore` from `startDaemon`'s return; NO daemon.ts edits needed to wire in `delegate_task` MCP tool + IPC handler.** The singleton is already constructed, reconciled, exposed on the return value, and cleanly closed on shutdown.

Phase 59 work:

1. Define `TaskManager` class that consumes `taskStore` injected via constructor.
2. Register the `delegate_task` MCP tool — handler calls `taskStore.insert` + `taskStore.transition`.
3. Register IPC methods (`delegate_task`, `task_status`, `cancel_task`) — handlers delegate to `TaskManager`.
4. Standalone runner (`src/cli/commands/run.ts`) — optionally also constructs a per-process `TaskStore` if running outside the daemon (decision deferred to Phase 59).

## Next Phase Readiness

- TaskStore is feature-complete across Plans 58-01 + 58-02 + 58-03: types, schema, errors, state machine, persistence layer, idempotent DDL, reconciler, daemon wiring.
- 150 tests pass across `src/tasks/__tests__/` + `src/manager/__tests__/daemon-task-store.test.ts`.
- Zero IPC / MCP / CLI surface added — scope boundary fully respected.
- `src/cli/commands/run.ts` unchanged — standalone runner remains on its own path (daemon-scoped store does not affect it).
- Zero new tsc errors introduced by this plan.
- Phase 58 closed. Phase 59 (handoffs) can proceed.

## Self-Check: PASSED

- `src/tasks/reconciler.ts`: FOUND
- `src/tasks/__tests__/reconciler.test.ts`: FOUND
- `src/manager/__tests__/daemon-task-store.test.ts`: FOUND
- `src/manager/daemon.ts`: FOUND (modified — 4 surgical edits verified via grep)
- Commit `4a390de`: FOUND (test: failing tests for runStartupReconciliation)
- Commit `09ed1ab`: FOUND (feat: runStartupReconciliation + ORPHAN_THRESHOLD_MS)
- Commit `d617718`: FOUND (feat: wire TaskStore into daemon.ts startup + shutdown + return)
- All 9 reconciler.test.ts tests pass
- All 17 daemon-task-store.test.ts tests pass
- All 150 Phase 58 suite tests pass
- Zero new tsc errors in modified files

---
*Phase: 58-task-store-state-machine*
*Completed: 2026-04-15*
