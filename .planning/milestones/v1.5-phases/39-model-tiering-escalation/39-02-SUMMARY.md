---
phase: 39-model-tiering-escalation
plan: 02
subsystem: manager
tags: [advisor, opus, budget, model-override, mcp-tool, slash-command]

requires:
  - phase: 39-model-tiering-escalation-01
    provides: EscalationMonitor, haiku default, fork-based escalation
provides:
  - ask_advisor MCP tool for one-shot opus consultations
  - AdvisorBudget class with SQLite-backed daily tracking
  - ask-advisor IPC handler with memory context and response truncation
  - /model slash command for runtime model override
  - set-model IPC handler with immutable config updates
affects: [daemon, mcp-server, discord-slash]

tech-stack:
  added: []
  patterns: [advisor-fork-pattern, budget-enforcement, immutable-config-update]

key-files:
  created:
    - src/usage/advisor-budget.ts
    - src/usage/advisor-budget.test.ts
  modified:
    - src/mcp/server.ts
    - src/mcp/server.test.ts
    - src/manager/daemon.ts
    - src/discord/slash-types.ts
    - src/discord/__tests__/slash-types.test.ts

key-decisions:
  - "Advisor uses fork-based one-shot opus query with cleanup (same pattern as escalation)"
  - "Budget DB is shared daemon-level SQLite, not per-agent (single point of tracking)"
  - "set-model creates new frozen config and updates SessionManager reference via setAllAgentConfigs"
  - "Memory context is non-fatal -- advisor works even if memory search fails"

patterns-established:
  - "Fork-for-advisor: fork session with model override, single query, stop fork"
  - "Budget enforcement: check-before-action, record-after-success pattern"
  - "Immutable config update: Object.freeze new config, replace in array, update manager reference"

requirements-completed: [TIER-03, TIER-05]

duration: 5min
completed: 2026-04-10
---

# Phase 39 Plan 02: Advisor & Model Override Summary

**ask_advisor MCP tool for one-shot opus consultations with daily budget enforcement, plus /model slash command for runtime model override**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-10T22:30:12Z
- **Completed:** 2026-04-10T22:35:50Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- AdvisorBudget class: SQLite-backed per-agent daily budget (10 calls/day), auto-resets via (agent, date) composite PK
- ask_advisor MCP tool wired to daemon via IPC, retrieves top 5 memories for context, forks opus session, truncates to 2000 chars
- clawcode-model slash command registered in DEFAULT_SLASH_COMMANDS with required model option
- set-model IPC handler validates via modelSchema, creates frozen config, updates SessionManager

## Task Commits

Each task was committed atomically:

1. **Task 1: AdvisorBudget class + ask_advisor MCP tool + IPC handler** - `738792b` (feat, TDD)
2. **Task 2: /model slash command + set-model IPC handler** - `f9ec824` (feat, TDD)

## Files Created/Modified
- `src/usage/advisor-budget.ts` - AdvisorBudget class with canCall/recordCall/getRemaining + ADVISOR_RESPONSE_MAX_LENGTH constant
- `src/usage/advisor-budget.test.ts` - 9 unit tests covering budget enforcement, daily reset, per-agent isolation
- `src/mcp/server.ts` - ask_advisor tool definition and registration with IPC delegation
- `src/mcp/server.test.ts` - Updated tool count to 8, added ask_advisor definition test
- `src/manager/daemon.ts` - ask-advisor and set-model IPC handlers, AdvisorBudget instantiation, modelSchema import
- `src/discord/slash-types.ts` - clawcode-model slash command with model option
- `src/discord/__tests__/slash-types.test.ts` - Updated to expect 7 commands, added model command tests

## Decisions Made
- Advisor budget uses shared daemon-level DB rather than per-agent DB (simpler, single source of truth)
- Fork-based advisor pattern reuses existing forkSession + sendToAgent + stopAgent lifecycle
- Memory search failure is non-fatal for advisor -- provides advice even without memory context
- set-model updates the configs array in-place with new frozen objects and calls setAllAgentConfigs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both TIER-03 (advisor) and TIER-05 (model override) requirements complete
- Phase 39 fully shipped -- all model tiering and escalation capabilities delivered
- 25 tests passing across plan 02 test files, no regressions

---
*Phase: 39-model-tiering-escalation*
*Completed: 2026-04-10*
