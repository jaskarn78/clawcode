---
phase: 59-cross-agent-rpc-handoffs
plan: 02
subsystem: tasks
tags: [task-manager, handoffs, rpc, abort-controller, async-ticket, digest, authorization]

# Dependency graph
requires:
  - phase: 58-task-store-state-machine
    provides: TaskStore (insert/get/transition), TaskRow 15-field schema, state machine (assertLegalTransition), error types
  - phase: 57-turndispatcher-foundation
    provides: TurnDispatcher.dispatch, TurnOrigin shape, makeTurnId, TURN_ID_REGEX
  - phase: 59-cross-agent-rpc-handoffs (plan 01)
    provides: errors (6 typed), computeInputDigest, compileJsonSchema, SchemaRegistry, authorize (4 pure checks)
provides:
  - TaskManager class with delegate/completeTask/cancel/retry/getStatus
  - MAX_HANDOFF_DEPTH constant (5)
  - DelegateRequest/DelegateResponse/StatusResponse/TaskManagerOptions types
  - Async-ticket handoff semantics (HAND-01)
  - 6-step authorization pipeline (HAND-02 through HAND-07)
  - Deadline propagation via AbortController + setTimeout (HAND-03)
  - Cost attribution via escalationBudget.recordUsage (LIFE-05)
  - Retry idempotency via digest byte-compare (LIFE-06)
affects: [59-03 (MCP/IPC/CLI wiring), 60 (trigger engine task creation), 63 (observability)]

# Tech tracking
tech-stack:
  added: []
  patterns: [async-ticket-delegation, pinned-schema-per-task, abort-controller-deadline, budget-owner-override]

key-files:
  created:
    - src/tasks/task-manager.ts
    - src/tasks/__tests__/task-manager.test.ts
  modified:
    - src/tasks/schema-registry.ts

key-decisions:
  - "TaskStore.transition(pending->running) uses Date.now() internally, not injected now() -- heartbeat_at in tests asserted as >= mockedNow"
  - "DispatchOptions.signal is cast in 59-02 because DispatchOptions type doesn't include signal yet; 59-03 will extend the type"
  - "SchemaRegistry.fromEntries static factory added for test ergonomics rather than monkey-patching constructor"
  - "Retry creates a fresh task via delegate() re-call with original caller/target/schema/payload (Pitfall 8: charges original caller)"

patterns-established:
  - "Pinned schema Map pattern: cache CompiledSchema at delegate-time, immune to SchemaRegistry hot-reload"
  - "Budget owner override: side Map tracks per-task override agent for cost attribution"
  - "Deadline inheritance: parent chain Map propagates absolute deadline_ms to child tasks"

requirements-completed: [HAND-01, HAND-02, HAND-03, HAND-05, HAND-07, LIFE-05, LIFE-06]

# Metrics
duration: 7min
completed: 2026-04-17
---

# Phase 59 Plan 02: TaskManager Handoff Control Plane Summary

**TaskManager class implementing async-ticket delegation with 6-step authorization, AbortController deadline propagation, pinned schema hot-reload immunity, and digest-based retry idempotency**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-17T13:12:34Z
- **Completed:** 2026-04-17T13:19:40Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments
- TaskManager class (525 LOC) implementing full handoff lifecycle: delegate, completeTask, cancel, retry, getStatus
- 6-step authorization in locked order (self-handoff, schema lookup, payload size, Zod parse, allowlist, depth+cycle)
- HAND-01 async-ticket semantics: delegate returns task_id immediately, never awaits B's turn completion
- HAND-03 deadline propagation: parent chain inheritance via Map + setTimeout(.unref()) + AbortController.abort()
- LIFE-05 cost attribution: escalationBudget.recordUsage charged to caller_agent or budgetOwner override
- LIFE-06 retry idempotency: digest byte-compare prevents mutated payload re-dispatch
- Pitfall 5: pinned CompiledSchema Map survives SchemaRegistry hot-reload mid-flight
- 32 tests pass; 223 total across Phase 58+59 test suite (zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing tests for TaskManager** - `8fc7edd` (test)
2. **Task 1 (GREEN): TaskManager implementation** - `5cba354` (feat)

## Files Created/Modified
- `src/tasks/task-manager.ts` - TaskManager class: delegate/completeTask/cancel/retry/getStatus, 6-step auth, deadline propagation, cost attribution, retry idempotency (525 LOC)
- `src/tasks/__tests__/task-manager.test.ts` - 32 integration tests: authorization steps, async-ticket, deadline, completion, cancel, retry, resource cleanup (421 LOC)
- `src/tasks/schema-registry.ts` - Added `static fromEntries()` test-only factory (micro-edit, 10 lines)

## TaskManager API

| Method | Purpose | Requirements |
|--------|---------|-------------|
| `delegate(req)` | 6-step authorize then insert row + dispatch B's turn; returns `{task_id}` synchronously | HAND-01, HAND-02, HAND-04, HAND-05, HAND-06, HAND-07 |
| `completeTask(taskId, result, tokenCost?)` | Validate result against pinned output schema, transition to complete, dispatch result-back to A | HAND-02, LIFE-05 |
| `cancel(taskId, cancellerName?)` | Abort + transition to cancelled + notify caller | -- |
| `retry(taskId)` | Re-read row, byte-compare digest, re-delegate as fresh task | LIFE-06 |
| `getStatus(taskId)` | Return `{task_id, status, error?, result?}` | -- |
| `schemaCount` (getter) | Number of loaded schemas | -- |

### Authorization Order (lines 120-177 in task-manager.ts)

1. `checkSelfHandoff(caller, target)` -- cheapest, HAND-07
2. `schemaRegistry.get(schema)` -- in-memory lookup
3. `Buffer.byteLength(JSON.stringify(payload)) <= MAX_PAYLOAD_BYTES` -- 64KB cap
4. `compiled.input.parse(payload)` -- Zod walk with .strict()
5. `getAgentConfig(target) + checkAllowlist(config, caller, schema)` -- HAND-04
6. `checkDepth(newDepth, 5) + checkCycle(store, target, parentTaskId, 5)` -- HAND-05

## Decisions Made
- `TaskStore.transition()` uses `Date.now()` internally for heartbeat refresh; tests assert `>= mockedNow` instead of exact match
- `DispatchOptions.signal` passed as a type cast -- Plan 59-03 will extend the DispatchOptions type to include `signal?: AbortSignal` natively
- `SchemaRegistry.fromEntries()` static factory chosen over monkey-patching the private constructor -- cleaner test ergonomics
- Retry re-delegates via `this.delegate()` internally (reuses all 6 auth steps) with original caller/target/schema (Pitfall 8)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed heartbeat_at assertion in Test 12**
- **Found during:** Task 1 GREEN phase
- **Issue:** TaskStore.transition(pending->running) refreshes heartbeat_at via Date.now() internally, not the injected `now()` function. Test expected exact match with mockedNow.
- **Fix:** Changed assertion from `.toBe(mockedNow)` to `.toBeGreaterThanOrEqual(mockedNow)`
- **Files modified:** src/tasks/__tests__/task-manager.test.ts
- **Committed in:** 5cba354

**2. [Rule 1 - Bug] Fixed Test 16 cycle detection false positive**
- **Found during:** Task 1 GREEN phase
- **Issue:** Nested handoff test used same agent pair (A->B then A->B with parent), triggering cycle detection because parent row's target_agent matched the child's target.
- **Fix:** Used a third agent (agent-C) for the child task: parent A->B, child B->C. No cycle.
- **Files modified:** src/tasks/__tests__/task-manager.test.ts
- **Committed in:** 5cba354

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs in test setup)
**Impact on plan:** Test correctness fixes only. No scope creep. Implementation unchanged.

## Issues Encountered
None -- implementation followed the plan's locked shapes exactly.

## What Plan 59-03 Wires

```typescript
const taskManager = new TaskManager({
  store: taskStore,
  turnDispatcher,
  schemaRegistry: await SchemaRegistry.load(),
  escalationBudget,
  getAgentConfig: (name) => resolvedConfigs.get(name) ?? null,
  storePayload: (id, p) => { /* side table or filesystem */ },
  getStoredPayload: (id) => { /* read from store */ },
  storeResult: (id, r) => { /* side table or filesystem */ },
  getStoredResult: (id) => { /* read from store */ },
  log: daemonLogger,
});
```

MCP tools: `delegate_task` -> `taskManager.delegate()`, `task_status` -> `taskManager.getStatus()`, `task_cancel` -> `taskManager.cancel()`, `task_complete` -> `taskManager.completeTask()`.
CLI: `clawcode tasks retry <id>` -> `taskManager.retry()`.

## Known Limitations

- `DispatchOptions.signal` is a type cast in 59-02; 59-03 extends the type properly
- `getStoredPayload` / `getStoredResult` are optional dependencies; 59-03 provides real implementations (side table or workspace filesystem)
- `handleTimeout` throws `DeadlineExceededError` inside setTimeout callback (swallowed by runtime); tests inspect row status instead

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- TaskManager ready for wiring in Plan 59-03 (daemon.ts, MCP tools, IPC protocol, CLI)
- All types exported for Plan 59-03 consumption
- Zero daemon.ts / mcp/server.ts / ipc/protocol.ts modifications (those are 59-03's job)

## Known Stubs

None -- all data paths wired via injectable dependencies (getStoredPayload, getStoredResult, storePayload, storeResult).

---
*Phase: 59-cross-agent-rpc-handoffs*
*Completed: 2026-04-17*
