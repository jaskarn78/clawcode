---
phase: 23-config-hot-reload-audit-trail
plan: 01
subsystem: config
tags: [chokidar, file-watching, jsonl, audit-trail, diffing, hot-reload]

requires:
  - phase: 03-config-system
    provides: Config schema, loader, and validation
provides:
  - ConfigWatcher class for debounced file watching
  - diffConfigs function for field-level config diffing with reloadable classification
  - AuditTrail class for JSONL change logging
  - ConfigChange, ConfigDiff, AuditEntry types
  - RELOADABLE_FIELDS and NON_RELOADABLE_FIELDS constants
affects: [23-02-daemon-wiring, agent-manager, daemon]

tech-stack:
  added: [chokidar@5.0.0]
  patterns: [JSONL append-only audit, field-level diffing by agent name, debounced file watching]

key-files:
  created:
    - src/config/types.ts
    - src/config/differ.ts
    - src/config/audit-trail.ts
    - src/config/watcher.ts
    - src/config/__tests__/differ.test.ts
    - src/config/__tests__/audit-trail.test.ts
    - src/config/__tests__/watcher.test.ts
  modified: []

key-decisions:
  - "Agents matched by name (not array index) in diff to handle reordering without spurious changes"
  - "Wildcard pattern matching for field classification (agents.*.channels matches agents.researcher.channels)"
  - "AuditTrail uses appendFile for append-only semantics, creates directory on first write"

patterns-established:
  - "Config diffing: match agents by name, classify fields via RELOADABLE_FIELDS/NON_RELOADABLE_FIELDS sets"
  - "Audit trail: JSONL format with { timestamp, fieldPath, oldValue, newValue } per line"
  - "File watcher: chokidar + debounce timer pattern for config reload"

requirements-completed: [HOTR-01, HOTR-03, HOTR-04]

duration: 4min
completed: 2026-04-09
---

# Phase 23 Plan 01: Config Hot-Reload Infrastructure Summary

**Chokidar-based config watcher with field-level diffing, reloadable/non-reloadable classification, and JSONL audit trail**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-09T19:25:43Z
- **Completed:** 2026-04-09T19:29:24Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- ConfigWatcher watches clawcode.yaml with 500ms debounce, validates before applying, preserves old config on validation failure
- diffConfigs produces field-level diffs keyed by agent name with reloadable/non-reloadable classification
- AuditTrail appends one JSONL line per changed field with ISO8601 timestamp
- Non-reloadable changes (model, workspace, basePath) produce explicit restart-required warnings
- 19 tests total: 9 differ tests, 5 audit trail tests, 5 watcher integration tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Config types, differ, and audit trail** - `822d426` (feat)
2. **Task 2: Config file watcher with debounce** - `7ba2989` (feat)

## Files Created/Modified
- `src/config/types.ts` - ConfigChange, ConfigDiff, AuditEntry types; RELOADABLE_FIELDS, NON_RELOADABLE_FIELDS constants
- `src/config/differ.ts` - diffConfigs function with recursive deep diff and reloadable classification
- `src/config/audit-trail.ts` - AuditTrail class for JSONL append-only logging
- `src/config/watcher.ts` - ConfigWatcher class with chokidar file watching, debounce, validation, and onChange callback
- `src/config/__tests__/differ.test.ts` - 9 tests: identical configs, channel/model/schedule changes, agent add/remove, defaults changes
- `src/config/__tests__/audit-trail.test.ts` - 5 tests: JSONL format, append, directory creation, field validation, empty changes
- `src/config/__tests__/watcher.test.ts` - 5 integration tests: happy path, debounce, invalid YAML recovery, getCurrentConfig, non-reloadable warnings

## Decisions Made
- Agents matched by name (not array index) in diff to handle YAML reordering gracefully
- Wildcard pattern matching for field classification (agents.*.channels matches any agent)
- AuditTrail creates parent directory on first write via mkdir recursive, only checks once per instance
- ConfigWatcher accepts configurable debounceMs for testability (default 500ms)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all functionality is fully wired.

## Next Phase Readiness
- ConfigWatcher, diffConfigs, and AuditTrail are ready for Plan 02 to wire into the running daemon
- Plan 02 will integrate ConfigWatcher into the agent manager lifecycle

---
*Phase: 23-config-hot-reload-audit-trail*
*Completed: 2026-04-09*
