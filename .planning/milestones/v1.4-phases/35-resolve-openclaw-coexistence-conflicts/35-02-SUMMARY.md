---
phase: 35-resolve-openclaw-coexistence-conflicts
plan: 02
subsystem: infra
tags: [dashboard, config, env-vars, localhost, mcp]

requires:
  - phase: 32-mcp-client-consumption
    provides: MCP server config schema and resolution in loader.ts
provides:
  - Localhost-only dashboard binding (127.0.0.1)
  - Non-fatal dashboard startup in daemon
  - Env var interpolation for ${VAR_NAME} patterns in MCP server env blocks
affects: [daemon, dashboard, config-loader, mcp-servers]

tech-stack:
  added: []
  patterns: [non-fatal optional service startup, env var interpolation via regex replace]

key-files:
  created: []
  modified:
    - src/dashboard/server.ts
    - src/manager/daemon.ts
    - src/config/loader.ts
    - src/config/__tests__/loader.test.ts

key-decisions:
  - "Dashboard binds to 127.0.0.1 only — no remote access"
  - "Missing env vars resolve to empty string (no crash) — safe default for optional vars"
  - "Dashboard null-stub pattern for return type when startup fails"

patterns-established:
  - "Non-fatal optional service: try/catch with warn log + null stub for return type"
  - "resolveEnvVars pattern: regex replace ${VAR_NAME} against process.env"

requirements-completed: [COEX-03, COEX-04]

duration: 3min
completed: 2026-04-10
---

# Phase 35 Plan 02: Dashboard Localhost + Env Var Interpolation Summary

**Dashboard bound to 127.0.0.1 with non-fatal startup, plus ${VAR_NAME} env var interpolation in MCP server config**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-10T16:19:36Z
- **Completed:** 2026-04-10T16:22:13Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Dashboard server binds to localhost only (127.0.0.1), preventing remote access
- Daemon continues running if dashboard port is taken, logging a warning instead of crashing
- Config loader resolves ${VAR_NAME} patterns in MCP server env blocks against process.env
- All 32 loader tests pass including 6 new env var interpolation tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Dashboard localhost binding + non-fatal startup** - `58804af` (feat)
2. **Task 2 RED: Failing tests for env var interpolation** - `21f6b7a` (test)
3. **Task 2 GREEN: Implement resolveEnvVars + wire into MCP env** - `b564af9` (feat)

## Files Created/Modified
- `src/dashboard/server.ts` - Added 127.0.0.1 binding to server.listen
- `src/manager/daemon.ts` - Wrapped dashboard startup in try/catch, null-guarded shutdown
- `src/config/loader.ts` - Added resolveEnvVars function, wired into MCP env mapping
- `src/config/__tests__/loader.test.ts` - 6 new tests for resolveEnvVars + MCP integration

## Decisions Made
- Dashboard binds to 127.0.0.1 only -- prevents any remote access to the dashboard
- Missing env vars resolve to empty string rather than throwing -- safe default for optional variables
- Null dashboard stub uses type assertion to satisfy return type without changing function signature

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Dashboard and config loader coexistence fixes complete
- Ready for remaining phase 35 plans if any

---
*Phase: 35-resolve-openclaw-coexistence-conflicts*
*Completed: 2026-04-10*
