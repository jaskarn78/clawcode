---
phase: 60-trigger-engine-foundation
plan: 01
subsystem: triggers
tags: [zod, sqlite, lru, dedup, debounce, policy-evaluator, trigger-engine]

# Dependency graph
requires:
  - phase: 58-task-store-state-machine
    provides: TaskStore with trigger_state CRUD and tasks.db DDL
  - phase: 57-turndispatcher-foundation
    provides: TurnDispatcher, TurnOrigin, SOURCE_KINDS with "trigger" kind
provides:
  - TriggerEventSchema Zod validator for all trigger source emissions
  - TriggerSource interface (plugin contract for Phase 61 source adapters)
  - TriggerEngineOptions type for engine constructor
  - LruMap generic LRU cache implementation
  - DedupLayer three-layer dedup pipeline (LRU + debounce + SQLite UNIQUE)
  - evaluatePolicy pure function with PolicyResult discriminated union
  - Default constants (LRU size, debounce ms, replay max age)
affects: [60-02-PLAN, 60-03-PLAN, 61-additional-trigger-sources, 62-policy-dsl]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LruMap: Map-based LRU with delete-then-set promotion and oldest-first eviction"
    - "DedupLayer: three-layer pipeline (LRU + debounce + SQLite UNIQUE) with unref'd timers"
    - "PolicyResult discriminated union with frozen returns"
    - "TriggerSource interface with optional poll() for watermark replay"

key-files:
  created:
    - src/triggers/types.ts
    - src/triggers/dedup.ts
    - src/triggers/policy-evaluator.ts
    - src/triggers/__tests__/types.test.ts
    - src/triggers/__tests__/dedup.test.ts
    - src/triggers/__tests__/policy-evaluator.test.ts
  modified: []

key-decisions:
  - "LruMap hand-rolled (~40 LOC) instead of npm dep — 10K entries is trivial"
  - "DedupLayer owns its own trigger_events DDL (CREATE TABLE IF NOT EXISTS) rather than extending TaskStore.ensureSchema — keeps the module self-contained for testing with in-memory DBs"
  - "Debounce promises resolve to null on replacement or stopAllTimers — clean cancellation semantics"
  - "PolicyEvaluator is a pure function (not a class) — matches Phase 62 replacement contract"

patterns-established:
  - "TriggerEvent schema: Zod validator at ingress, z.infer<> for type"
  - "DedupLayer: constructor takes raw Database handle, runs own DDL"
  - "Timer.unref() on all debounce timers — prevents process hangs"
  - "PolicyResult frozen discriminated union — stable contract for Phase 62 DSL"

requirements-completed: [TRIG-07]

# Metrics
duration: 4min
completed: 2026-04-17
---

# Phase 60 Plan 01: Trigger Engine Foundation Summary

**TriggerEvent Zod schema, three-layer dedup pipeline (LRU + debounce + SQLite UNIQUE), and PolicyEvaluator pure function with 48 tests**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-17T14:25:36Z
- **Completed:** 2026-04-17T14:30:11Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- TriggerEventSchema Zod validator with TriggerSource interface and TriggerEngineOptions type — the complete type foundation for Plans 60-02 and 60-03
- Three-layer DedupLayer: LruMap (in-memory fast path), per-source debounce (setTimeout + unref), SQLite UNIQUE (INSERT OR IGNORE safety net) with purge capability
- evaluatePolicy pure function with PolicyResult discriminated union — Phase 62 stable contract

## Task Commits

Each task was committed atomically:

1. **Task 1: TriggerSource interface + TriggerEvent schema + TriggerEngineOptions type** - `4719874` (feat)
2. **Task 2: Three-layer dedup pipeline (LruMap + DedupLayer)** - `b173ef7` (feat)
3. **Task 3: PolicyEvaluator pure function (default pass-through)** - `0077fdd` (feat)

## Files Created/Modified
- `src/triggers/types.ts` - TriggerEventSchema, TriggerSource, TriggerEngineOptions, default constants
- `src/triggers/dedup.ts` - LruMap<K,V> generic LRU, DedupLayer with 3-layer pipeline
- `src/triggers/policy-evaluator.ts` - evaluatePolicy pure function, PolicyResult type
- `src/triggers/__tests__/types.test.ts` - 17 tests: schema validation, type shapes, constants
- `src/triggers/__tests__/dedup.test.ts` - 22 tests: LRU eviction/promotion, dedup layers, purge, DDL
- `src/triggers/__tests__/policy-evaluator.test.ts` - 9 tests: allow/deny, frozen returns, case sensitivity

## Decisions Made
- LruMap hand-rolled (~40 LOC) instead of importing an npm LRU library — 10K entries is trivial, no dependency warranted
- DedupLayer owns its own trigger_events DDL (CREATE TABLE IF NOT EXISTS) rather than extending TaskStore.ensureSchema, keeping the module self-contained for in-memory DB testing
- Debounce promises resolve to null on replacement or stopAllTimers call — clean cancellation semantics for burst collapse and shutdown
- PolicyEvaluator implemented as a pure function (not a class) — the TriggerEvent-in, PolicyResult-out interface is the stable contract Phase 62 will replace

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All types, dedup pipeline, and policy evaluator are ready for Plan 60-02 (TriggerEngine + TriggerSourceRegistry + watermark replay)
- Plan 60-03 (SchedulerSource adapter + daemon wiring) depends on 60-02
- Zero new npm dependencies added — everything uses existing project libraries

---
*Phase: 60-trigger-engine-foundation*
*Completed: 2026-04-17*
