---
phase: 62-policy-layer-dry-run
plan: 02
subsystem: triggers
tags: [chokidar, hot-reload, jsonl-audit, policy-watcher, daemon-boot, policy-evaluator]

# Dependency graph
requires:
  - phase: 62-policy-layer-dry-run
    plan: 01
    provides: PolicyEvaluator class, loadPolicies pipeline, diffPolicies differ, CompiledRule type, PolicyValidationError
  - phase: 60-trigger-engine-foundation
    provides: TriggerEngine, evaluatePolicy wrapper, DedupLayer with insertTriggerEvent
  - phase: 23
    provides: ConfigWatcher pattern, AuditTrail pattern (followed by PolicyWatcher)
provides:
  - PolicyWatcher class with chokidar-based hot-reload and JSONL audit trail
  - TriggerEngine.reloadEvaluator() method for atomic evaluator swap
  - TriggerEngine uses PolicyEvaluator.evaluate() instead of legacy evaluatePolicy()
  - Daemon boot-time policy validation (invalid = refuse to start, POL-01)
  - PolicyWatcher wired into daemon boot + shutdown lifecycle (POL-03)
  - trigger_events extended fields (sourceKind + payload) passed from ingest pipeline
affects: [62-03-PLAN, trigger-engine, daemon-boot]

# Tech tracking
tech-stack:
  added: []
  patterns: [policy-hot-reload-with-atomic-swap, jsonl-policy-audit-trail, evaluator-class-injection]

key-files:
  created:
    - src/triggers/policy-watcher.ts
    - src/triggers/__tests__/policy-watcher.test.ts
  modified:
    - src/triggers/engine.ts
    - src/manager/daemon.ts

key-decisions:
  - "PolicyEvaluator injected as optional 3rd constructor arg to TriggerEngine — backward-compatible with fallback to legacy evaluatePolicy wrapper"
  - "Policy audit trail writes directly (no AuditTrail reuse) since entry shape differs (PolicyDiff vs ConfigChange)"
  - "Boot-time policy load runs BEFORE TriggerEngine construction — invalid policy blocks daemon via ManagerError wrapping PolicyValidationError"
  - "Missing policies.yaml at boot starts with empty rules (deny-all for non-default events) — not an error"
  - "PolicyWatcher.start() called AFTER triggerEngine construction to avoid double-read (boot already validated)"

patterns-established:
  - "Policy hot-reload: chokidar watch -> debounce -> readFile -> loadPolicies -> diffPolicies -> writeAuditEntry -> onReload callback"
  - "Atomic evaluator swap: PolicyWatcher.onReload calls triggerEngine.reloadEvaluator(newEvaluator)"
  - "Boot rejection pattern: PolicyValidationError caught and re-thrown as ManagerError with FATAL prefix"

requirements-completed: [POL-01, POL-03]

# Metrics
duration: 9min
completed: 2026-04-17
---

# Phase 62 Plan 02: Hot-Reload Watcher + Daemon Integration Summary

**PolicyWatcher with chokidar hot-reload, JSONL audit trail, TriggerEngine evaluator injection, and daemon boot-time policy validation**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-17T18:33:33Z
- **Completed:** 2026-04-17T18:42:48Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- PolicyWatcher watches policies.yaml via chokidar with debounced reload, atomic evaluator swap, and JSONL audit trail
- TriggerEngine upgraded from legacy evaluatePolicy() pure function to PolicyEvaluator class with hot-reload support
- Daemon boot validates policies.yaml before starting (invalid = FATAL rejection per POL-01)
- PolicyWatcher lifecycle wired into daemon boot + shutdown cleanup
- 151 trigger tests passing across 10 test files (13 new for PolicyWatcher)

## Task Commits

Each task was committed atomically:

1. **Task 1: PolicyWatcher with chokidar + JSONL audit trail (TDD)**
   - `a6f0488` (test) — RED: failing tests for PolicyWatcher
   - `54491e7` (feat) — GREEN: PolicyWatcher implementation + test fixes
2. **Task 2: Wire PolicyEvaluator into TriggerEngine + daemon boot** - `6e176ff` (feat)

## Files Created/Modified
- `src/triggers/policy-watcher.ts` — PolicyWatcher class: chokidar watch, debounced reload, JSONL audit, boot validation
- `src/triggers/__tests__/policy-watcher.test.ts` — 13 integration tests using real temp files
- `src/triggers/engine.ts` — Added evaluator field, reloadEvaluator(), evaluator.evaluate() in ingest, extended insertTriggerEvent args
- `src/manager/daemon.ts` — Boot-time policy load, PolicyWatcher creation + lifecycle, PolicyEvaluator injection into TriggerEngine

## Decisions Made
- PolicyEvaluator is an optional 3rd constructor arg to TriggerEngine — existing callers (tests, Phase 60 code) continue working without it via fallback to legacy evaluatePolicy wrapper
- Policy audit trail is written directly (appendFile JSONL) rather than reusing AuditTrail class, since the entry shape is different (PolicyDiff vs ConfigChange)
- Missing policies.yaml at boot is not an error — starts with empty rules (deny-all behavior for non-default events)
- Boot validation runs before TriggerEngine construction to fail fast; PolicyWatcher.start() runs after to avoid re-reading an already-validated file

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test YAML fixtures missing version:1 field**
- **Found during:** Task 1 (PolicyWatcher TDD GREEN phase)
- **Issue:** Test YAML fixtures lacked `version: 1` required by PolicyFileSchema from Plan 62-01
- **Fix:** Added `version: 1` to VALID_POLICY_YAML and VALID_POLICY_YAML_V2 test constants
- **Files modified:** src/triggers/__tests__/policy-watcher.test.ts
- **Committed in:** 54491e7 (part of Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial fix — test data aligned with schema. No scope change.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all data paths are fully wired.

## Next Phase Readiness
- PolicyWatcher and TriggerEngine wiring complete — Plan 62-03 (dry-run CLI) can read trigger_events from tasks.db and evaluate against on-disk policies
- trigger_events now stores sourceKind + payload columns for dry-run replay
- All 151 trigger tests green, type-check clean (no new errors introduced)

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 62-policy-layer-dry-run*
*Completed: 2026-04-17*
