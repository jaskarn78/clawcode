---
phase: 60-trigger-engine-foundation
plan: 03
subsystem: triggers
tags: [croner, cron, heartbeat, sqlite, retention, trigger-engine, scheduler-source]

# Dependency graph
requires:
  - phase: 60-trigger-engine-foundation (plans 01+02)
    provides: TriggerEvent schema, TriggerSource interface, TriggerEngine class, DedupLayer, PolicyEvaluator, TriggerSourceRegistry, TaskStore.purgeCompleted/purgeTriggerEvents
  - phase: 58-task-store-state-machine
    provides: TaskStore with tasks.db schema, trigger_state + trigger_events tables
  - phase: 57-turndispatcher-foundation
    provides: TurnDispatcher, TurnOrigin, makeRootOriginWithCausation
provides:
  - SchedulerSource adapter wrapping prompt-based cron schedules as TriggerSource
  - task-retention heartbeat check (LIFE-03) purging terminal tasks + stale trigger_events
  - CheckContext.taskStore optional field + HeartbeatRunner.setTaskStore method
  - TriggerEngine wired in daemon boot/shutdown with SchedulerSource as first source
affects: [61-additional-trigger-sources, 62-policy-dsl, 63-observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - SchedulerSource splits prompt-based vs handler-based schedules at daemon boot
    - HeartbeatRunner.setTaskStore mirrors setThreadManager injection pattern
    - task-retention check uses first-agent-only optimization for daemon-scoped resources

key-files:
  created:
    - src/triggers/scheduler-source.ts
    - src/heartbeat/checks/task-retention.ts
    - src/triggers/__tests__/scheduler-source.test.ts
    - src/heartbeat/checks/__tests__/task-retention.test.ts
  modified:
    - src/manager/daemon.ts
    - src/heartbeat/types.ts
    - src/heartbeat/runner.ts

key-decisions:
  - "SchedulerSource creates its own Cron jobs for prompt-based schedules instead of wrapping TaskScheduler as a black box -- cleaner separation, handler schedules stay on TaskScheduler directly"
  - "TaskScheduler moved from step 8b to step 6-quinquies-a in daemon boot -- earlier creation allows SchedulerSource to wrap before HeartbeatRunner starts"
  - "task-retention check runs only on first running agent per heartbeat cycle -- tasks.db is daemon-scoped, not per-agent, so redundant purges are wasteful"
  - "trigger_events purge window is 2x replayMaxAgeMs (48h default) -- ensures replay watermark never references already-purged events"

patterns-established:
  - "HeartbeatRunner.setTaskStore(store) for daemon-scoped resource injection into heartbeat checks"
  - "Prompt vs handler schedule bifurcation at daemon boot -- prompt schedules go through TriggerEngine pipeline, handler schedules bypass it"

requirements-completed: [TRIG-01, LIFE-03]

# Metrics
duration: 12min
completed: 2026-04-17
---

# Phase 60 Plan 03: TriggerEngine Daemon Integration Summary

**SchedulerSource adapter routing prompt-based cron fires through TriggerEngine dedup+causation pipeline, with hourly task-retention heartbeat purging terminal rows**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-17T14:43:59Z
- **Completed:** 2026-04-17T14:56:08Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- SchedulerSource wraps prompt-based cron schedules as a TriggerSource, routing through the 3-layer dedup + causation_id pipeline instead of direct TurnDispatcher
- task-retention heartbeat check (LIFE-03) purges terminal task rows older than perf.taskRetentionDays and trigger_events older than 2x replayMaxAgeMs hourly
- TriggerEngine wired in daemon boot at step 6-quinquies with SchedulerSource registered as first source, replay runs synchronously before agent startAll

## Task Commits

Each task was committed atomically:

1. **Task 1: SchedulerSource adapter (TDD)** - `2459bda` (test), `963fd4a` (feat)
2. **Task 2: Task-retention heartbeat check (TDD)** - `abac5af` (test), `b5a8747` (feat)
3. **Task 3: Daemon boot/shutdown wiring** - `60eecae` (feat)

_TDD tasks have two commits each (RED test then GREEN implementation)_

## Files Created/Modified
- `src/triggers/scheduler-source.ts` - SchedulerSource implementing TriggerSource for prompt-based cron schedules
- `src/triggers/__tests__/scheduler-source.test.ts` - 9 tests covering ingest, poll, handler bypass, locking, stop
- `src/heartbeat/checks/task-retention.ts` - Hourly heartbeat check purging terminal tasks + stale trigger_events
- `src/heartbeat/checks/__tests__/task-retention.test.ts` - 11 tests covering purge logic, guards, first-agent skip
- `src/heartbeat/types.ts` - Extended CheckContext with optional taskStore field
- `src/heartbeat/runner.ts` - Added setTaskStore method + taskStore in tick context
- `src/manager/daemon.ts` - TriggerEngine + SchedulerSource wiring in boot/shutdown

## Decisions Made
- SchedulerSource creates its own Cron jobs rather than wrapping TaskScheduler: cleaner separation where handler-based schedules (consolidation) stay on TaskScheduler and prompt-based schedules route through the TriggerEngine pipeline
- TaskScheduler moved earlier in daemon boot (step 6-quinquies-a): only needs sessionManager + turnDispatcher + log, all available by step 6-bis, and must be ready before SchedulerSource creates its cron jobs
- task-retention check uses first-agent-only optimization: since tasks.db is daemon-scoped (not per-agent), running purges once per heartbeat cycle on the first agent is sufficient
- trigger_events purge window set to 2x replayMaxAgeMs: provides safety margin so replay watermarks never reference already-purged dedup records

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 60 (trigger-engine-foundation) is now complete with all 3 plans shipped
- TriggerEngine is live in the daemon with SchedulerSource as its first registered source
- Phase 61 (additional-trigger-sources) can add webhook, MySQL, inbox, calendar sources via `triggerEngine.registerSource()`
- Phase 62 (policy-dsl) can extend the policy evaluator with declarative rules
- Phase 63 (observability) can walk causation_id chains across trigger -> task -> agent turn

## Self-Check: PASSED

All 7 files verified present. All 5 task commits verified in git log.

---
*Phase: 60-trigger-engine-foundation*
*Completed: 2026-04-17*
