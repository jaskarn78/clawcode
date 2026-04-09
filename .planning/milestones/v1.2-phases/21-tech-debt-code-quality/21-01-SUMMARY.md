---
phase: 21-tech-debt-code-quality
plan: 01
subsystem: logging
tags: [pino, structured-logging, heartbeat, attachment-cleanup, cli, error-handling]

requires:
  - phase: 12-discord-attachments
    provides: attachment download/cleanup functions
  - phase: 07-heartbeat-framework
    provides: heartbeat check auto-discovery pattern
provides:
  - Attachment cleanup heartbeat check (auto-discovered)
  - CLI output helpers (cliLog/cliError) for all CLI commands
  - Zero console.log/error/warn calls in production src/
  - All catch blocks have explicit error handling or documented rationale
affects: [22-tech-debt-testing, cli-commands, heartbeat-checks]

tech-stack:
  added: []
  patterns: [cliLog/cliError for CLI output, pino structured logger for daemon/library code, documented catch blocks]

key-files:
  created:
    - src/heartbeat/checks/attachment-cleanup.ts
    - src/cli/output.ts
  modified:
    - src/memory/consolidation.ts
    - src/collaboration/inbox.ts
    - src/manager/daemon-entry.ts
    - src/cli/index.ts
    - src/cli/commands/*.ts (17 files)
    - src/discord/bridge.ts
    - src/heartbeat/checks/inbox.ts
    - src/heartbeat/checks/thread-idle.ts
    - src/manager/daemon.ts

key-decisions:
  - "CLI commands use cliLog/cliError (process.stdout/stderr.write) not pino -- CLI output is user-facing, not structured logs"
  - "Daemon/library code uses pino structured logger with context objects for machine-parseable logs"
  - "Debug-level logging for best-effort operations (typing indicator delete, socket cleanup), warn-level for real problems"

patterns-established:
  - "CLI output pattern: import { cliLog, cliError } from '../output.js' for all console output in CLI commands"
  - "Catch block documentation: every catch must either log with context or have an explicit comment explaining why error is swallowed"

requirements-completed: [DEBT-01, DEBT-02, DEBT-03]

duration: 6min
completed: 2026-04-09
---

# Phase 21 Plan 01: Tech Debt - Code Quality Summary

**Attachment cleanup heartbeat check, zero console.* calls in production code, all silent catch blocks resolved with explicit logging or documented rationale**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-09T18:27:08Z
- **Completed:** 2026-04-09T18:32:39Z
- **Tasks:** 2
- **Files modified:** 26

## Accomplishments
- Created attachment cleanup heartbeat check that auto-discovers and removes stale temp files older than 24h
- Eliminated all console.log/error/warn calls from production source code (0 remaining, verified via grep)
- Created cliLog/cliError helpers for CLI commands (stdout/stderr writes instead of console)
- Replaced console calls with pino structured logging in daemon-entry, consolidation, and inbox modules
- Fixed all silent catch blocks with debug/warn logging or explicit documentation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create attachment cleanup heartbeat check, replace console calls with pino, create CLI output helpers** - `4d331a9` (feat)
2. **Task 2: Fix silent catch blocks with proper error logging** - `3c4d607` (fix)

## Files Created/Modified
- `src/heartbeat/checks/attachment-cleanup.ts` - Heartbeat check that calls cleanupAttachments on agent attachment dirs
- `src/cli/output.ts` - cliLog/cliError helpers wrapping process.stdout/stderr.write
- `src/memory/consolidation.ts` - Replaced console.error with logger.error for archive failures
- `src/collaboration/inbox.ts` - Replaced console.warn with logger.warn for malformed messages
- `src/manager/daemon-entry.ts` - Replaced console.error with logger.fatal for startup failures
- `src/cli/index.ts` - Replaced console.log/error with cliLog/cliError
- `src/cli/commands/*.ts` (17 files) - Replaced all console.log/error with cliLog/cliError
- `src/discord/bridge.ts` - Added debug logging to previously silent catch blocks
- `src/heartbeat/checks/inbox.ts` - Improved catch block documentation
- `src/heartbeat/checks/thread-idle.ts` - Documented best-effort catch block
- `src/manager/daemon.ts` - Added debug logging for socket/pid cleanup on shutdown

## Decisions Made
- CLI commands use cliLog/cliError (process.stdout/stderr.write) rather than pino, since CLI output is user-facing plain text, not structured JSON logs
- Used debug level for truly non-critical best-effort operations (typing indicator delete, socket cleanup)
- Used warn level for operations where failure indicates a real problem (malformed inbox messages)
- Used fatal level for daemon startup failures

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all functionality is fully wired.

## Next Phase Readiness
- Logging is now consistent across the entire codebase
- Attachment cleanup will run automatically via heartbeat auto-discovery
- Ready for Phase 21 Plan 02 (session-manager splitting, test fixes, SDK types)

## Self-Check: PASSED

---
*Phase: 21-tech-debt-code-quality*
*Completed: 2026-04-09*
