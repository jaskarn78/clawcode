---
phase: quick
plan: 260409-laz
subsystem: usage-tracking
tags: [sqlite, better-sqlite3, usage, tokens, cost, cli, discord, ipc]

requires:
  - phase: 01-foundation
    provides: SessionManager, SessionAdapter, daemon IPC, CLI framework
provides:
  - UsageTracker class with SQLite storage and aggregation
  - Per-agent usage lifecycle in SessionManager
  - IPC 'usage' method with period support
  - CLI 'clawcode usage' command
  - /usage Discord slash command
affects: [monitoring, cost-management, admin-dashboard]

tech-stack:
  added: []
  patterns: [usage-callback-in-session-adapter, mutable-ref-for-deferred-session-id]

key-files:
  created:
    - src/usage/types.ts
    - src/usage/tracker.ts
    - src/usage/tracker.test.ts
    - src/cli/commands/usage.ts
    - src/cli/commands/usage.test.ts
  modified:
    - src/manager/session-adapter.ts
    - src/manager/session-manager.ts
    - src/manager/daemon.ts
    - src/discord/slash-types.ts
    - src/cli/index.ts

key-decisions:
  - "Mutable sessionIdRef pattern for deferred session ID capture in usage callback"
  - "UsageCallback as optional parameter on SessionAdapter (not breaking change)"
  - "Usage extraction wrapped in try/catch to never break send flow"

patterns-established:
  - "UsageCallback: optional callback on adapter methods for per-interaction instrumentation"

requirements-completed: []

duration: 9min
completed: 2026-04-09
---

# Quick Task 260409-laz: Add Persistent Usage Tracking Summary

**Per-agent SQLite usage tracking with session/daily/weekly/total aggregation, wired into SDK adapter, IPC, CLI, and Discord slash commands**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-09T15:22:59Z
- **Completed:** 2026-04-09T15:32:10Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- UsageTracker class persists token/cost/turns/model/duration per SDK interaction to per-agent SQLite
- Session adapter extracts usage from SDK result messages via UsageCallback without breaking send flow
- IPC 'usage' method supports session, daily, weekly, and total period queries
- CLI `clawcode usage <agent>` command with --period, --date, --session-id options
- /usage Discord slash command and usage line added to /status

## Task Commits

Each task was committed atomically:

1. **Task 1: Create UsageTracker with SQLite storage and aggregation** - `5608909` (feat)
2. **Task 2: Wire usage tracking into session adapter, session manager, daemon IPC, CLI, and Discord** - `977acfd` (feat)

## Files Created/Modified
- `src/usage/types.ts` - UsageEvent and UsageAggregate types
- `src/usage/tracker.ts` - UsageTracker class with SQLite storage, WAL mode, prepared statements
- `src/usage/tracker.test.ts` - 6 tests covering all aggregation methods and empty database
- `src/cli/commands/usage.ts` - CLI usage command with formatUsageTable
- `src/cli/commands/usage.test.ts` - 3 tests for CLI formatting
- `src/manager/session-adapter.ts` - UsageCallback type, extractUsage helper, wired into SDK adapter
- `src/manager/session-manager.ts` - UsageTracker lifecycle (init/cleanup), mutable sessionIdRef pattern
- `src/manager/daemon.ts` - IPC 'usage' route with period switch
- `src/discord/slash-types.ts` - /usage command and usage line in /status
- `src/cli/index.ts` - registerUsageCommand registration

## Decisions Made
- Used mutable `sessionIdRef` object so the usage callback can capture the session ID after handle creation (the callback is passed to createSession before the handle exists)
- UsageCallback is optional on SessionAdapter to maintain backward compatibility
- Usage extraction is wrapped in try/catch so failures never break the send flow
- Escaped `${cost}` in template literal to avoid JS interpolation in slash command format string

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Escaped template literal interpolation in slash-types.ts**
- **Found during:** Task 2
- **Issue:** `${cost}` in the /status claudeCommand template string was being interpreted as JS template interpolation, causing ReferenceError
- **Fix:** Escaped as `\${cost}` to produce literal text
- **Files modified:** src/discord/slash-types.ts
- **Verification:** Tests pass, no ReferenceError
- **Committed in:** 977acfd (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for correctness. No scope creep.

## Issues Encountered
None beyond the template literal bug noted above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Usage tracking is fully wired and ready for production use
- Future enhancement: usage-based alerts, cost budget limits

---
*Quick task: 260409-laz*
*Completed: 2026-04-09*
