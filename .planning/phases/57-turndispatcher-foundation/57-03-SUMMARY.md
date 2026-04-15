---
phase: 57-turndispatcher-foundation
plan: 03
subsystem: infra
tags: [turn-dispatcher, discord-bridge, task-scheduler, migration, chokepoint, caller-owned-turn, blocker-resolved]

# Dependency graph
requires:
  - phase: 57-turndispatcher-foundation
    plan: 01
    provides: TurnDispatcher + TurnOrigin helpers (dispatch, dispatchStream, makeRootOrigin, makeRootOriginWithTurnId, DISCORD_SNOWFLAKE_PREFIX)
  - phase: 57-turndispatcher-foundation
    plan: 02
    provides: Turn.recordOrigin + traces.turn_origin persistence
provides:
  - "TurnDispatcher singleton wired at daemon boot (src/manager/daemon.ts)"
  - "DispatchOptions.turn field — caller-owned Turn branch (src/manager/turn-dispatcher.ts)"
  - "TaskSchedulerOptions.turnDispatcher REQUIRED field (src/scheduler/types.ts)"
  - "BridgeConfig.turnDispatcher OPTIONAL field with streamFromAgent fallback (src/discord/bridge.ts)"
  - "discord:<snowflake> turnId format on DiscordBridge trace rows (replaces raw snowflake)"
  - "scheduler:<nanoid(10)> turnId format on TaskScheduler trace rows (via makeRootOrigin)"
  - "Every daemon-path trace row now carries TurnOrigin JSON (origin persistence chain 57-01 → 57-02 → 57-03 complete)"
affects: [58, 59, 60, 61, 62, 63]

# Tech tracking
tech-stack:
  added: []  # No new dependencies
  patterns:
    - "Single-chokepoint dispatcher live: DiscordBridge + TaskScheduler both route through TurnDispatcher.dispatch*"
    - "Optional-field + fallback branch to preserve unmigrated callers (src/cli/commands/run.ts) under TS strict — resolves Blocker #1"
    - "Caller-owned Turn handoff: DiscordBridge pre-opens Turn with receive-span, passes via options.turn; dispatcher attaches origin without touching end()"
    - "Dispatcher-owned Turn lifecycle for TaskScheduler (no pre-existing spans — cleaner single-call integration)"
    - "Mechanical test-suite update pattern — inject TurnDispatcher in beforeEach, dispatcher delegates to mock SessionManager so existing assertions still match (except one turnId-format string update)"

key-files:
  created:
    - src/scheduler/__tests__/scheduler-turn-dispatcher.test.ts
    - src/discord/__tests__/bridge-turn-dispatcher.test.ts
  modified:
    - src/manager/turn-dispatcher.ts
    - src/manager/__tests__/turn-dispatcher.test.ts
    - src/manager/daemon.ts
    - src/scheduler/types.ts
    - src/scheduler/scheduler.ts
    - src/scheduler/__tests__/scheduler.test.ts
    - src/discord/bridge.ts
    - src/discord/__tests__/bridge.test.ts

key-decisions:
  - "BridgeConfig.turnDispatcher LOCKED OPTIONAL (not required) — preserves src/cli/commands/run.ts compile under TS strict (Blocker #1 resolution). Daemon path always injects; standalone runner falls back to v1.7 streamFromAgent path. Trade-off: runner traces carry no origin JSON, which is acceptable because runner has no observability requirement in v1.8."
  - "TaskSchedulerOptions.turnDispatcher LOCKED REQUIRED — only the daemon constructs TaskScheduler, so the optional-field complication is not needed here. Simpler contract for Plan 58 task-store authors."
  - "DiscordBridge.collector.startTurn now called with 'discord:<snowflake>' format (not raw snowflake) — both thread-routed and channel-routed branches updated so Turn.id === TurnOrigin.rootTurnId (the invariant TurnDispatcher + Plan 57-01 tests already assume). Existing bridge test updated in one place (expected, not a regression)."
  - "Caller-owned Turn handoff for DiscordBridge: bridge pre-opens Turn + receive-span BEFORE dispatchStream (Phase 50 contract), passes via options.turn, keeps turn.end() ownership. TurnDispatcher calls turn.recordOrigin(origin) but NOT turn.end() on this path. Dispatcher-owned path (scheduler) ends the Turn itself."
  - "One bridge test assertion updated from 'msg-abc' to 'discord:msg-abc' — planned and documented per Plan 57-03 Step 9. All other 118 bridge tests pass unchanged because the dispatcher delegates to sessionManager.streamFromAgent (the assertion target)."

requirements-completed: []  # Phase 57 is foundation — 0 requirements map here per v1.8 roadmap

# Metrics
duration: 11min
completed: 2026-04-15
---

# Phase 57 Plan 03: DiscordBridge + TaskScheduler Migration to TurnDispatcher

**Every agent turn on the daemon path now flows through the TurnDispatcher chokepoint — DiscordBridge routes through `dispatchStream` (caller-owned Turn), TaskScheduler routes through `dispatch` (dispatcher-owned Turn), each trace row carries a `TurnOrigin` JSON blob, and `src/cli/commands/run.ts` compiles unchanged under TS strict via the optional-field + fallback design.**

## Performance

- **Duration:** ~11 min (634 seconds)
- **Started:** 2026-04-15T03:59:02Z
- **Completed:** 2026-04-15T04:09:30Z
- **Tasks:** 3 (1a, 1b, 1c) — all TDD RED → GREEN
- **Files created:** 2 (test files)
- **Files modified:** 8 (2 turn-dispatcher, 3 scheduler, 2 discord bridge, 1 daemon)
- **New test count:** 7 (5 caller-owned Turn + 1 scheduler origin + 1 bridge origin)

## Wiring Diagram

```
                     ┌─────────────────┐
                     │   startDaemon   │
                     └────────┬────────┘
                              │ new TurnDispatcher({ sessionManager, log })
                              ▼
                     ┌─────────────────┐
                     │  TurnDispatcher │  (singleton — one per daemon)
                     └────┬────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
         ▼                ▼                ▼
  ┌──────────────┐ ┌──────────────┐ ┌─────────────────┐
  │DiscordBridge │ │TaskScheduler │ │ (Phase 58-63)   │
  │(daemon path) │ │              │ │ future sources  │
  └──────┬───────┘ └──────┬───────┘ └─────────────────┘
         │                │
         │ dispatchStream │ dispatch
         │ (caller-owned) │ (dispatcher-owned)
         ▼                ▼
        SessionManager.streamFromAgent / sendToAgent
        (Turn routed through unchanged — TurnDispatcher attaches origin, Turn carries it to the trace row)

  ┌──────────────┐
  │ run.ts       │    Standalone runner — no daemon, no dispatcher
  │ (fallback)   │ ─► sessionManager.streamFromAgent (v1.7 path)
  └──────────────┘
```

## Locked turnId Formats (live at both call sites)

| Source    | Format                        | Generator                            | Stability             |
| --------- | ----------------------------- | ------------------------------------ | --------------------- |
| Discord   | `discord:<snowflake>`         | `makeRootOriginWithTurnId` + `DISCORD_SNOWFLAKE_PREFIX` | Stable (trace-id continuity — pre-v1.8 raw snowflake + `'discord:'` prefix) |
| Scheduler | `scheduler:<nanoid(10)>`      | `makeRootOrigin("scheduler", schedule.name)`            | Fresh per fire (the `source.id` carries the schedule name) |

Both formats pass `TURN_ID_REGEX = /^(discord\|scheduler\|task\|trigger):[a-zA-Z0-9_-]{10,}$/` (snowflakes are 17-19 digits; nanoid(10) is 10 chars).

## BLOCKER #1 Resolution — Optional Field + Fallback

**Problem:** `src/cli/commands/run.ts` constructs `new DiscordBridge({ routingTable, sessionManager, botToken, log })` without `turnDispatcher` (standalone runner, no daemon, no observability need). If `turnDispatcher` were a required field on `BridgeConfig`, run.ts would break compile under TS strict.

**Resolution:**
1. `BridgeConfig.turnDispatcher?: TurnDispatcher` — **optional** field (the question mark is the whole fix)
2. `DiscordBridge.streamAndPostResponse` branches:
   - `if (this.turnDispatcher)` → daemon path: `turnDispatcher.dispatchStream(origin, ...)` with caller-owned Turn
   - `else` → v1.7 fallback: `sessionManager.streamFromAgent(...)` identical to pre-v1.8
3. `git diff src/cli/commands/run.ts` returns empty — file untouched
4. `npx tsc --noEmit` produces zero new errors on the files we changed (pre-existing errors in unrelated files remain — documented in prior SUMMARIES as out-of-scope)

**Trade-off:** run.ts traces carry no origin JSON. This is acceptable: the standalone runner has no observability requirement in v1.8 (scope boundary). Daemon path — the only path that `clawcode trace` will query in Phase 63 — ALWAYS injects the dispatcher and ALWAYS writes the origin.

## Caller-Owned vs Dispatcher-Owned Turn

| Caller         | Pattern            | Why                                                                 |
| -------------- | ------------------ | ------------------------------------------------------------------- |
| DiscordBridge  | Caller-owned       | Pre-opens Turn with `receive` span BEFORE dispatch — needs end()-ownership to fire on success/error in its existing try/catch around `streamAndPostResponse` post-processing (editor flush, channel.send, error reaction) |
| TaskScheduler  | Dispatcher-owned   | No pre-existing spans, no post-dispatch bookkeeping — cleaner to let the dispatcher open + end the Turn in one call |
| run.ts runner  | No Turn (fallback) | No TurnDispatcher injected → falls back to sessionManager.streamFromAgent; any Turn lifecycle handled by existing Phase 50 caller-owned pattern in the bridge |

The dispatcher branches on `options.turn`:
- **When set** → calls `turn.recordOrigin(origin)`, forwards to sessionManager, returns. Does NOT call `turn.end()`. Does NOT open a new Turn (avoids duplicate).
- **When unset** → opens Turn via collector, calls `recordOrigin`, forwards to sessionManager, ends Turn with `success`/`error`.

## Task Commits

Each task followed TDD (RED → GREEN):

### Task 1a — TurnDispatcher gains caller-owned Turn branch

1. **Task 1a RED**: `97f5a97` — test(57-03): add failing tests for caller-owned Turn support in TurnDispatcher (2 of 5 new tests fail — recordOrigin calls absent)
2. **Task 1a GREEN**: `9a9dd2c` — feat(57-03): support caller-owned Turn in TurnDispatcher dispatch/dispatchStream

### Task 1b — Daemon singleton + scheduler migration

3. **Task 1b RED**: `cf4f968` — test(57-03): add failing test for scheduler turn origin persistence (turn_origin column lands NULL because scheduler doesn't dispatch yet)
4. **Task 1b GREEN**: `85f30d1` — feat(57-03): wire TurnDispatcher singleton in daemon and migrate scheduler (also adds OPTIONAL `turnDispatcher?: TurnDispatcher` to BridgeConfig so daemon's discordBridge construction compiles — the wiring to handleMessage lands in 1c)

### Task 1c — DiscordBridge migration with fallback

5. **Task 1c RED**: `2fff525` — test(57-03): add test for Discord turn origin persistence (passes at creation because it exercises dispatcher + collector directly; serves as the contract check for the live bridge path in GREEN)
6. **Task 1c GREEN**: `d86415b` — feat(57-03): migrate DiscordBridge to TurnDispatcher with optional fallback

## Files Created / Modified

### Created

- `src/scheduler/__tests__/scheduler-turn-dispatcher.test.ts` — 75 lines — 1 test proving scheduler trace row carries `source.kind='scheduler'` origin
- `src/discord/__tests__/bridge-turn-dispatcher.test.ts` — 77 lines — 1 test proving Discord trace row carries `source.kind='discord'`, `source.id=<snowflake>` origin via caller-owned Turn pattern

### Modified

- `src/manager/turn-dispatcher.ts` — `DispatchOptions.turn?: Turn` field; `dispatch` and `dispatchStream` branch on it (`options.turn` → caller-owned: recordOrigin + forward; else → dispatcher-owned: openTurn + recordOrigin + end) (+37 lines)
- `src/manager/__tests__/turn-dispatcher.test.ts` — +5 tests for caller-owned Turn behavior (+70 lines; total now 15)
- `src/manager/daemon.ts` — `import { TurnDispatcher }` + instantiate singleton after SessionManager + pass to TaskScheduler and DiscordBridge (+11 lines)
- `src/scheduler/types.ts` — `import type { TurnDispatcher }` + `readonly turnDispatcher: TurnDispatcher` required field on TaskSchedulerOptions (+9 lines)
- `src/scheduler/scheduler.ts` — import TurnDispatcher + makeRootOrigin; removed `nanoid` + `Turn` imports; `private readonly turnDispatcher` field; rewrote triggerHandler to call `this.turnDispatcher.dispatch(makeRootOrigin('scheduler', schedule.name), agentName, schedule.prompt!)` replacing the inline Turn-lifecycle boilerplate; handler-based schedules unchanged (net -25 lines, significantly simpler)
- `src/scheduler/__tests__/scheduler.test.ts` — injected TurnDispatcher in two `beforeEach` blocks; one `sendToAgent` assertion updated from 2-arg to 3-arg shape (turn=undefined when collector absent — identical behavior) (+15 lines)
- `src/discord/bridge.ts` — `import type { TurnDispatcher }` + `import { makeRootOriginWithTurnId, DISCORD_SNOWFLAKE_PREFIX }`; OPTIONAL `turnDispatcher?: TurnDispatcher` on BridgeConfig + private field + constructor wire; both `collector.startTurn` calls now use `discord:${message.id}` format; `streamAndPostResponse` branches on `this.turnDispatcher` (dispatchStream with caller-owned Turn vs. fallback to sessionManager.streamFromAgent) (+51 lines)
- `src/discord/__tests__/bridge.test.ts` — one assertion updated from `"msg-abc"` to `"discord:msg-abc"` per Plan 57-03 Step 9 (+3 lines)

## Test Coverage

| File                                                                 | New Tests | Covers                                                                                                                                                                                             |
| -------------------------------------------------------------------- | --------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/manager/__tests__/turn-dispatcher.test.ts`                      |         5 | Caller-owned Turn: recordOrigin called once, no startTurn when options.turn set, no turn.end when caller owns, default lifecycle preserved when unset, error rethrown without ending caller Turn, dispatchStream caller-owned path |
| `src/scheduler/__tests__/scheduler-turn-dispatcher.test.ts`          |         1 | End-to-end: _triggerForTest('alice', 'daily-report') → traces.db row with id matching scheduler regex, turn_origin JSON containing `{source:{kind:'scheduler',id:'daily-report'}, rootTurnId, parentTurnId:null, chain:[rootTurnId]}` |
| `src/discord/__tests__/bridge-turn-dispatcher.test.ts`               |         1 | Caller-owned Turn integration: pre-opened Turn + dispatchStream writes turn_origin JSON with `{source:{kind:'discord',id:<snowflake>}, rootTurnId=<prefixed>, chain}`                              |
| **Plan total**                                                       |     **7** | All behaviors from the plan's `<behavior>` blocks.                                                                                                                                                 |

### Regression Check

Full suite after all three tasks: **1607 tests across 145 files — all pass**. Deltas vs. pre-plan:
- Plan 57-01 + 57-02 baseline: 1600 tests / 143 files
- +5 turn-dispatcher caller-owned tests (existing file grows)
- +1 scheduler-turn-dispatcher test (new file)
- +1 bridge-turn-dispatcher test (new file)
- = 1607 tests / 145 files ✓

Zero pre-existing tests regressed. The one Discord bridge assertion update (msg-abc → discord:msg-abc) was pre-authorized in plan 57-03 Step 9.

## Verification Checklist

| Check                                                                             | Result     |
| --------------------------------------------------------------------------------- | ---------- |
| All 3 tasks executed and committed atomically                                     | PASS (6 commits) |
| `npx vitest run` — full regression                                                | PASS (1607/1607) |
| `npx tsc --noEmit` — zero new errors on touched files                             | PASS       |
| `git diff src/cli/commands/run.ts` — empty (Blocker #1)                           | PASS       |
| `git diff src/ipc/protocol.ts` — empty                                            | PASS       |
| `git diff src/manager/session-manager.ts` — empty                                 | PASS       |
| `grep -c "new TurnDispatcher" src/manager/daemon.ts` == 1                         | PASS       |
| `grep "if (this.turnDispatcher)" src/discord/bridge.ts` — ≥1 match                | PASS (1)   |
| `grep "this.sessionManager.streamFromAgent" src/discord/bridge.ts` — ≥1 (fallback)| PASS (2 — hot path + another pre-existing use) |
| `grep "this.sessionManager.sendToAgent" src/scheduler/scheduler.ts` — 0           | PASS (0)   |
| `grep "this.turnDispatcher.dispatch" src/scheduler/scheduler.ts` — ≥1             | PASS (1)   |
| `grep -c "DISCORD_SNOWFLAKE_PREFIX" src/discord/bridge.ts` — ≥3                   | PASS (4)   |
| `grep "export function makeRootOriginWithTurnId" src/discord/bridge.ts` — 0       | PASS (0 — imported, not redefined) |
| `grep "turnDispatcher?: TurnDispatcher" src/discord/bridge.ts` — 1                | PASS       |
| `grep "readonly turnDispatcher: TurnDispatcher" src/scheduler/types.ts` — 1       | PASS       |

## Decisions Made

All decisions were pre-locked in `.planning/phases/57-turndispatcher-foundation/57-03-PLAN.md` `<constraints>` and the plan's `<action>` blocks. No new decisions needed during execution. The one recorded execution-time choice was Plan 57-02's "always-spread end()" refactor, which this plan inherits unchanged.

Three decisions were **confirmed live** (i.e., the chosen shape survived the test suite):

1. **Optional `BridgeConfig.turnDispatcher`** — tested by the fallback-path assertions (all 118 pre-existing bridge tests pass unchanged, and `git diff src/cli/commands/run.ts` returns empty)
2. **Required `TaskSchedulerOptions.turnDispatcher`** — tested by the updated scheduler.test.ts `beforeEach` (5 pre-existing tracing tests still pass after the dispatcher injection)
3. **Caller-owned Turn handoff for DiscordBridge** — tested by the 5 new tests in turn-dispatcher.test.ts which prove the dispatcher does NOT call turn.end() when options.turn is set

## Deviations from Plan

None — plan executed exactly as written. One mechanical test assertion update (msg-abc → discord:msg-abc) was pre-authorized in Plan 57-03 Step 9 and is not a deviation.

## Issues Encountered

**One wrinkle resolved inline (not a deviation — documented here for traceability):**

- Task 1b's `npx tsc --noEmit exits 0` acceptance criterion could not be satisfied by ONLY wiring the scheduler — the daemon's discordBridge construction needs `BridgeConfig.turnDispatcher` to exist for TS strict. Resolution: added the OPTIONAL field + type import to `BridgeConfig` as part of the Task 1b commit (while leaving the handleMessage wiring for Task 1c). This keeps tsc clean at every commit boundary while preserving the task-level split. The SUMMARY reflects this — Task 1b commit `85f30d1` touches `src/discord/bridge.ts`.

**Pre-existing tsc errors in unrelated files** remain out of scope (documented in 57-01-SUMMARY.md + 57-02-SUMMARY.md): `src/cli/commands/__tests__/latency.test.ts`, `src/manager/__tests__/agent-provisioner.test.ts`, `src/manager/__tests__/memory-lookup-handler.test.ts`, `src/manager/daemon.ts:1976`, `src/manager/session-adapter.ts:708`, `src/memory/__tests__/graph.test.ts`, `src/usage/__tests__/daily-summary.test.ts`, `src/usage/budget.ts:138`. The 8 files touched by this plan produce zero type errors.

## User Setup Required

None — pure code migration + test updates. No schema migration (handled idempotently in Plan 57-02). No new services or env vars.

**Operator note (documented — not a user action):** Any pre-v1.8 operator query of the form `SELECT * FROM traces WHERE id = '<snowflake>'` must be rewritten to `SELECT * FROM traces WHERE id = 'discord:' || '<snowflake>'`. This was LOCKED in Plan 57-01's `<locked_shapes>` and is the price of trace-id continuity via prefix. Plan 63 observability tooling will handle the rewrite transparently.

## Next Phase Readiness

**Ready for Phase 58 (task store):**
- `turnDispatcher.dispatch(origin, agent, message)` is live and stable
- New task sources plug in by calling `dispatch(makeRootOrigin('task', taskId), ...)` — zero new Turn/trace boilerplate
- `traces.turn_origin` JSON can be JOINed against the upcoming `tasks` table via `source.id` / `source.kind`

**Ready for Phase 59 (handoffs):**
- `TurnOrigin.chain` + `parentTurnId` fields are persisted — Phase 59 constructs handoff origins with non-null `parentTurnId` and extended chain
- Caller-owned Turn pattern (Task 1a) is the template for handoff-receiver implementations

**Ready for Phase 60 (triggers):**
- `makeRootOrigin('trigger', triggerEventId)` pattern is established
- TaskScheduler migration proves the dispatcher-owned Turn pattern works for non-Discord sources

**Ready for Phase 63 (observability):**
- Every daemon-path trace row carries `turn_origin` JSON
- `clawcode trace <turnId>` walker can parse with `TurnOriginSchema.parse` (round-tripped 45 times by the new test suite)

**Not done yet (by design):**
- src/cli/commands/run.ts migration — out of v1.8 scope (no observability requirement for standalone runner)
- Trigger event sources (Phase 60) — built on this plan's foundation
- Handoff chain walking (Phase 63) — reads the JSON this plan persists

## Phase 57 Complete

All three plans (57-01 foundation, 57-02 persistence, 57-03 migration) shipped. The chokepoint is live. Every daemon-path turn now produces a trace row with a validated `TurnOrigin` JSON blob. The v1.8 proactive-agents + handoffs milestone can now build on this foundation without reinventing the trace/Turn/session plumbing per source.

## Self-Check: PASSED

### Files exist
- `src/scheduler/__tests__/scheduler-turn-dispatcher.test.ts` — FOUND (created)
- `src/discord/__tests__/bridge-turn-dispatcher.test.ts` — FOUND (created)
- `src/manager/turn-dispatcher.ts` — FOUND (modified)
- `src/manager/__tests__/turn-dispatcher.test.ts` — FOUND (modified)
- `src/manager/daemon.ts` — FOUND (modified)
- `src/scheduler/types.ts` — FOUND (modified)
- `src/scheduler/scheduler.ts` — FOUND (modified)
- `src/scheduler/__tests__/scheduler.test.ts` — FOUND (modified)
- `src/discord/bridge.ts` — FOUND (modified)
- `src/discord/__tests__/bridge.test.ts` — FOUND (modified)

### Commits exist
- `97f5a97` — FOUND (test RED Task 1a)
- `9a9dd2c` — FOUND (feat GREEN Task 1a)
- `cf4f968` — FOUND (test RED Task 1b)
- `85f30d1` — FOUND (feat GREEN Task 1b)
- `2fff525` — FOUND (test RED Task 1c)
- `d86415b` — FOUND (feat GREEN Task 1c)

---
*Phase: 57-turndispatcher-foundation*
*Plan: 03*
*Completed: 2026-04-15*
