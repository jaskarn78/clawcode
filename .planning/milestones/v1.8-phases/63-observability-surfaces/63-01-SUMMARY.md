---
phase: 63-observability-surfaces
plan: 01
subsystem: cli
tags: [sqlite, better-sqlite3, cli, observability, triggers, tasks]

# Dependency graph
requires:
  - phase: 58-task-store-state-machine
    provides: tasks + trigger_events SQLite schema in tasks.db
  - phase: 59-cross-agent-rpc-handoffs
    provides: tasks CLI command group (retry, status subcommands)
  - phase: 62-policy-dsl-hotreload-dryrun
    provides: policy.ts with parseDuration utility, policy dry-run CLI pattern
provides:
  - "clawcode triggers CLI command — lists recent trigger fire events with task correlation"
  - "clawcode tasks list CLI subcommand — lists recent inter-agent tasks with state, duration, depth, cost"
  - "formatTokenCount utility — human-readable token counts (1.2K, 45.3K)"
  - "formatDuration utility — human-readable elapsed time (500ms, 1.2s, 3.4m)"
  - "registerTriggersCommand registered in cli/index.ts"
affects: [63-02-dashboard-task-graph, 63-03-trace-chain-walking]

# Tech tracking
tech-stack:
  added: []
  patterns: [temporal-proximity-join, read-only-sqlite-cli, color-coded-table]

key-files:
  created:
    - src/cli/commands/triggers.ts
    - src/cli/commands/__tests__/triggers.test.ts
    - src/cli/commands/__tests__/tasks-list.test.ts
  modified:
    - src/cli/commands/tasks.ts
    - src/cli/index.ts

key-decisions:
  - "Temporal proximity LEFT JOIN for trigger-to-task correlation (trigger_events has no causation_id column)"
  - "formatTokenCount and formatDuration exported from triggers.ts for reuse by tasks list"
  - "INNER JOIN for --agent filter (excludes non-matching events), LEFT JOIN otherwise"

patterns-established:
  - "Temporal proximity JOIN: match trigger_events to tasks via started_at window [created_at-1s, created_at+10s]"
  - "Shared formatTokenCount/formatDuration utilities in triggers.ts for cross-CLI reuse"

requirements-completed: [OBS-01, OBS-02, OBS-05]

# Metrics
duration: 9min
completed: 2026-04-17
---

# Phase 63 Plan 01: Observability Surfaces - CLI Commands Summary

**Read-only CLI commands for trigger fire visibility (clawcode triggers) and inter-agent task listing (clawcode tasks list) with color-coded tables, human-readable token costs, and temporal proximity task correlation**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-17T19:24:40Z
- **Completed:** 2026-04-17T19:33:56Z
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- `clawcode triggers` reads trigger_events from tasks.db via read-only SQLite with temporal proximity LEFT JOIN to tasks, shows timestamp/source/kind/target/result/duration per row with color-coded results
- `clawcode tasks list` reads tasks table in read-only mode showing task_id (truncated)/caller/target/state/duration/depth/cost with color-coded state
- Both commands support --since (default 1h), --json, and specific filter flags (--source/--agent for triggers, --agent/--state for tasks list)
- chain_token_cost displayed as human-readable (0, 500, 1.2K, 45.3K, 1.2M)
- 38 tests passing across both test suites

## Task Commits

Each task was committed atomically (TDD: RED then GREEN):

1. **Task 1: Create clawcode triggers CLI command**
   - `3dc7e47` (test): failing tests for triggers CLI (22 test cases)
   - `f354709` (feat): triggers.ts implementation — queryTriggerFires, formatTriggersTable, formatTokenCount, formatDuration, registerTriggersCommand
2. **Task 2: Add list subcommand to clawcode tasks + CLI registration**
   - `5b3a2fa` (test): failing tests for tasks list subcommand (16 test cases)
   - `10a5baa` (feat): tasks.ts list subcommand + triggers registration in index.ts
3. **Prerequisite files:** `87fbbeb` (chore): policy.ts, triggers/ directory from Phases 59-62

## Files Created/Modified
- `src/cli/commands/triggers.ts` — New clawcode triggers command (queryTriggerFires, formatTriggersTable, formatTokenCount, formatDuration, registerTriggersCommand)
- `src/cli/commands/__tests__/triggers.test.ts` — 22 tests for triggers CLI pure functions
- `src/cli/commands/__tests__/tasks-list.test.ts` — 16 tests for tasks list CLI pure functions
- `src/cli/commands/tasks.ts` — Extended with list subcommand, queryTaskList, formatTasksTable alongside existing retry/status
- `src/cli/index.ts` — Added registerTriggersCommand, registerPolicyCommand, registerTasksCommand

## Decisions Made
- Used temporal proximity LEFT JOIN instead of causation_id JOIN (trigger_events table lacks causation_id — the link is indirect through TurnOrigin). Window of [created_at - 1s, created_at + 10s] is acceptable for v1 CLI display.
- Exported formatTokenCount and formatDuration from triggers.ts for reuse by tasks list (avoiding duplication)
- Used INNER JOIN when --agent filter is active to exclude events without matching tasks, LEFT JOIN otherwise to show all events including those without task correlation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Copied prerequisite files from Phases 59-62**
- **Found during:** Task 1 (triggers CLI command)
- **Issue:** Worktree based on older commit missing policy.ts (Phase 62), tasks.ts (Phase 59), and entire triggers/ directory (Phase 60-62). These are required imports for triggers.ts (parseDuration from policy.js) and tasks.ts (IPC client, daemon socket path).
- **Fix:** Copied policy.ts, tasks.ts, triggers/ directory, and their test files from the main repo working directory into the worktree.
- **Files modified:** src/cli/commands/policy.ts, src/triggers/*
- **Verification:** All 38 tests pass, imports resolve correctly
- **Committed in:** 87fbbeb

---

**Total deviations:** 1 auto-fixed (1 blocking — prerequisite files)
**Impact on plan:** Necessary to make the worktree functional. No scope creep.

## Issues Encountered
- Worktree based on older git commit did not have files from Phases 59-62 (uncommitted in main repo). Resolved by copying prerequisite files directly.

## Known Stubs

None. Both commands are fully functional with real SQLite queries and complete output formatting.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- triggers.ts and tasks.ts list subcommand ready for Phase 63-02 (dashboard task graph) and Phase 63-03 (trace chain walking)
- formatTokenCount and formatDuration utilities available for reuse in Phase 63-03 trace command

## Self-Check: PASSED

All files verified present. All commit hashes verified in git log. SUMMARY.md created.

---
*Phase: 63-observability-surfaces*
*Completed: 2026-04-17*
