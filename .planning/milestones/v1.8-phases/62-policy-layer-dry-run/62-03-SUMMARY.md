---
phase: 62-policy-layer-dry-run
plan: 03
subsystem: cli
tags: [cli, policy, dry-run, sqlite, handlebars, trigger-events]

requires:
  - phase: 62-policy-layer-dry-run-01
    provides: PolicyEvaluator class, loadPolicies(), CompiledRule type, trigger_events schema with source_kind + payload columns
provides:
  - "clawcode policy dry-run CLI command for offline policy validation"
  - "parseDuration utility for human-readable duration strings"
  - "formatDryRunTable with ANSI color-coded allow/deny output"
  - "formatDryRunJson for machine-readable JSON output"
  - "registerPolicyCommand for CLI registration"
affects: [63-observability]

tech-stack:
  added: []
  patterns: ["Read-only SQLite handle pattern for CLI commands that bypass daemon"]

key-files:
  created:
    - src/cli/commands/policy.ts
    - src/cli/commands/__tests__/policy.test.ts
  modified:
    - src/cli/index.ts

key-decisions:
  - "Dry-run uses permissive agent set (all rule targets) so output shows what WOULD happen, not filtered by daemon config"
  - "Read-only SQLite + fileMustExist guards prevent accidental writes and clear missing-file errors"

patterns-established:
  - "CLI commands that bypass daemon use read-only SQLite handles directly"

requirements-completed: [POL-04]

duration: 5min
completed: 2026-04-17
---

# Phase 62 Plan 03: Policy Dry-Run CLI Summary

**Standalone `clawcode policy dry-run --since 1h` command reads trigger_events from read-only SQLite + policies.yaml directly -- no daemon needed -- with color-coded table and JSON output**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-17T18:33:58Z
- **Completed:** 2026-04-17T18:39:22Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Dry-run CLI replays recent trigger events against on-disk policies.yaml for offline policy validation
- Color-coded table output (green allow, red deny/no match) with Timestamp | Source | Event | Rule | Agent | Action columns
- JSON output mode via --json flag for machine-readable consumption
- Read-only SQLite handle with fileMustExist guard -- no daemon dependency per POL-04
- 23 tests covering duration parsing, table/JSON formatting, dry-run logic with temp DB fixtures

## Task Commits

Each task was committed atomically:

1. **Task 1: Dry-run CLI command (TDD RED)** - `c11b549` (test)
2. **Task 1: Dry-run CLI command (TDD GREEN)** - `4b08934` (feat)
3. **Task 2: Register policy command in CLI index** - `42303d0` (feat)

_TDD task had separate RED and GREEN commits._

## Files Created/Modified
- `src/cli/commands/policy.ts` - Policy dry-run CLI command with parseDuration, runDryRun, formatDryRunTable, formatDryRunJson, registerPolicyCommand
- `src/cli/commands/__tests__/policy.test.ts` - 23 tests covering all pure functions and integration with temp SQLite + YAML fixtures
- `src/cli/index.ts` - Added registerPolicyCommand import and registration call

## Decisions Made
- Dry-run evaluator gets a permissive agent set (all rule targets from the policy file) rather than an empty set, so output shows what WOULD happen regardless of daemon configuration
- Read-only SQLite with fileMustExist: true provides clear error messages for missing database, matching the RESEARCH.md pitfall guidance

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing handlebars dependency**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** handlebars package declared in package.json but not installed in worktree node_modules
- **Fix:** Ran npm ci to restore all dependencies
- **Files modified:** None (node_modules only)
- **Verification:** Tests pass after install

**2. [Rule 1 - Bug] Increased test timeout for runDryRun describe block**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** "throws on missing policies.yaml" test timed out at 5s default (Handlebars initial import latency)
- **Fix:** Added { timeout: 15_000 } to runDryRun describe block
- **Files modified:** src/cli/commands/__tests__/policy.test.ts
- **Verification:** All 23 tests pass consistently

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for test execution. No scope creep.

## Issues Encountered
- Pre-existing type errors in task-manager.ts, engine.test.ts, daily-summary.test.ts, budget.ts -- all unrelated to this plan's files. Out of scope per deviation rules.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Policy dry-run CLI complete -- operators can validate policy changes offline
- Phase 62 plans 01 and 03 complete; plan 02 (hot-reload watcher) is independent
- Phase 63 (observability) can proceed once all Phase 62 plans are done

## Self-Check: PASSED

All files verified present. All commit hashes verified in git log.

---
*Phase: 62-policy-layer-dry-run*
*Completed: 2026-04-17*
