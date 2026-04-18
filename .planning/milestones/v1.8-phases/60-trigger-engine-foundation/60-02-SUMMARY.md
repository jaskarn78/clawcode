---
phase: 60-trigger-engine-foundation
plan: 02
subsystem: triggers
tags: [trigger-engine, dedup, causation-id, nanoid, zod, sqlite, watermark, policy]

# Dependency graph
requires:
  - phase: 60-trigger-engine-foundation-01
    provides: TriggerEvent, TriggerSource, DedupLayer, evaluatePolicy, LruMap
  - phase: 58-task-store-state-machine
    provides: TaskStore with trigger_state CRUD
  - phase: 57-turndispatcher-foundation
    provides: TurnDispatcher, TurnOrigin, makeRootOrigin
provides:
  - TriggerEngine class (ingest pipeline, replayMissed, startAll/stopAll)
  - TriggerSourceRegistry (register/get/all/size)
  - makeRootOriginWithCausation factory (TRIG-08 causationId on TurnOrigin)
  - TaskStore.purgeCompleted and purgeTriggerEvents (LIFE-03 retention support)
  - triggersConfigSchema (replayMaxAgeMs, defaultDebounceMs)
  - taskRetentionDays in perf config section
affects: [60-trigger-engine-foundation-03, 61-additional-trigger-sources, 62-policy-dsl, 63-observability]

# Tech tracking
tech-stack:
  added: []
  patterns: [3-layer-dedup-pipeline, causation-id-at-ingress, watermark-based-replay, source-registry-pattern]

key-files:
  created:
    - src/triggers/engine.ts
    - src/triggers/source-registry.ts
    - src/triggers/__tests__/engine.test.ts
  modified:
    - src/manager/turn-origin.ts
    - src/tasks/store.ts
    - src/config/schema.ts
    - src/manager/__tests__/turn-origin.test.ts

key-decisions:
  - "causationId uses z.string().nullable().default(null) for backward-compatible TurnOrigin extension"
  - "TriggerEngine owns DedupLayer instance (created from TaskStore.rawDb), not passed in"
  - "trigger_events DDL in both DedupLayer (self-contained for tests) and TaskStore.ensureSchema (daemon lifecycle)"

patterns-established:
  - "causation-id-at-ingress: nanoid() generated at TriggerEngine.ingest entry point, flows through TurnOrigin to trace"
  - "source-registry: Map-backed registry with duplicate-sourceId rejection, exposed via readonly getter"
  - "watermark-replay: replayMissed reads stored watermarks, respects maxAge cutoff, polls then re-ingests through standard pipeline"

requirements-completed: [TRIG-06, TRIG-08]

# Metrics
duration: 8min
completed: 2026-04-17
---

# Phase 60 Plan 02: TriggerEngine Core Summary

**TriggerEngine with 3-layer dedup -> policy -> causationId dispatch pipeline, watermark-based replay, TriggerSourceRegistry, and extended TurnOrigin/TaskStore/config schemas**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-17T14:32:32Z
- **Completed:** 2026-04-17T14:40:54Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- TriggerEngine.ingest: 3-layer dedup (LRU -> debounce -> SQLite UNIQUE) -> evaluatePolicy -> nanoid causationId -> TurnDispatcher dispatch -> watermark update
- TriggerEngine.replayMissed: reads watermarks from TaskStore, respects maxAge cutoff, polls each pollable source, re-ingests through standard pipeline (TRIG-06)
- TurnOriginSchema backward-compatible extension with causationId: z.string().nullable().default(null) (TRIG-08)
- TaskStore extended with trigger_events DDL, purgeCompleted, and purgeTriggerEvents methods (LIFE-03 support)
- Config schema extended with triggersConfigSchema and perf.taskRetentionDays
- 16 new tests covering engine ingest, dedup layers, policy, replay, lifecycle, and hot-reload

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend TurnOriginSchema + TaskStore + Config Schema** - `627ed63` (feat)
2. **Task 2: TriggerSourceRegistry + TriggerEngine [TDD RED]** - `d6bd34d` (test)
3. **Task 2: TriggerSourceRegistry + TriggerEngine [TDD GREEN]** - `2822dd7` (feat)

## Files Created/Modified
- `src/triggers/engine.ts` - TriggerEngine class with ingest pipeline, replayMissed, startAll/stopAll, updateConfiguredAgents
- `src/triggers/source-registry.ts` - TriggerSourceRegistry with register/get/all/size and duplicate rejection
- `src/triggers/__tests__/engine.test.ts` - 16 tests covering all engine behaviors
- `src/manager/turn-origin.ts` - causationId field on TurnOriginSchema + makeRootOriginWithCausation factory
- `src/tasks/store.ts` - trigger_events DDL + purgeCompleted + purgeTriggerEvents methods
- `src/config/schema.ts` - triggersConfigSchema + taskRetentionDays in perf section
- `src/manager/__tests__/turn-origin.test.ts` - Updated for causationId backward compat + 3 new tests

## Decisions Made
- causationId uses `z.string().nullable().default(null)` so existing TurnOrigin objects without the field parse without error (backward compatibility)
- TriggerEngine creates its own DedupLayer from TaskStore.rawDb rather than receiving one externally -- keeps the dedup lifecycle engine-internal
- trigger_events DDL exists in both DedupLayer constructor (for isolated :memory: DB testing) and TaskStore.ensureSchema (for daemon production lifecycle) -- CREATE IF NOT EXISTS makes this idempotent and safe

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed turn-origin.test.ts round-trip assertion for causationId default**
- **Found during:** Task 1 (TurnOriginSchema extension)
- **Issue:** Existing test at line 21 used `expect(parsed).toEqual(origin)` but the parsed output now includes `causationId: null` from the default
- **Fix:** Updated assertion to `expect(parsed).toEqual({ ...origin, causationId: null })`
- **Files modified:** src/manager/__tests__/turn-origin.test.ts
- **Verification:** All 567 existing tests pass
- **Committed in:** 627ed63 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Expected consequence of backward-compatible schema extension. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TriggerEngine ready for Plan 60-03 daemon wiring (startAll/stopAll in boot/shutdown, replayMissed on startup)
- Source registry accepts Phase 61 source adapters via registerSource()
- causationId flows through TurnOrigin to trace rows for Phase 63 causation chain walker
- 64 trigger tests pass (48 Plan 60-01 + 16 Plan 60-02)

## Self-Check: PASSED

- All 7 created/modified files exist on disk
- All 3 task commits (627ed63, d6bd34d, 2822dd7) found in git log
- 64 trigger tests pass, 567 manager+tasks tests pass (zero regressions)

---
*Phase: 60-trigger-engine-foundation*
*Completed: 2026-04-17*
