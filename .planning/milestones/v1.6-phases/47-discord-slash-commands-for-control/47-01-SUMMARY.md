---
phase: 47-discord-slash-commands-for-control
plan: 01
subsystem: discord
tags: [slash-commands, ipc, fleet-status, discord-embed, control-commands]

requires:
  - phase: 34-discord-slash-commands
    provides: SlashCommandHandler, SlashCommandDef type, register/handleInteraction
  - phase: 25-ipc-unix-socket
    provides: sendIpcRequest, SOCKET_PATH, IPC protocol
provides:
  - CONTROL_COMMANDS array with 4 daemon-direct slash commands
  - Control command routing via IPC in SlashCommandHandler
  - buildFleetEmbed function for color-coded fleet status
  - formatUptime helper for compact duration display
affects: [discord-bridge, daemon-management, fleet-monitoring]

tech-stack:
  added: []
  patterns: [control-flag-routing, ipc-bypass-for-daemon-commands, testable-embed-objects]

key-files:
  created: []
  modified:
    - src/discord/slash-types.ts
    - src/discord/slash-commands.ts
    - src/discord/__tests__/slash-types.test.ts
    - src/discord/__tests__/slash-commands.test.ts

key-decisions:
  - "Control commands checked before agent lookup -- no channel binding required"
  - "Fleet embed is public, start/stop/restart are ephemeral"
  - "buildFleetEmbed returns plain object (not EmbedBuilder) for testability"

patterns-established:
  - "Control flag pattern: SlashCommandDef.control boolean routes to IPC instead of agent"
  - "ipcMethod field maps slash command names to daemon IPC methods"

requirements-completed: [CTRL-01, CTRL-02, CTRL-03, CTRL-04]

duration: 5min
completed: 2026-04-12
---

# Phase 47 Plan 01: Discord Control Slash Commands Summary

**Four operator control slash commands (start/stop/restart/fleet) routing to daemon via IPC with color-coded fleet status embed**

## Performance

- **Duration:** 4min 44s
- **Started:** 2026-04-12T02:30:29Z
- **Completed:** 2026-04-12T02:35:13Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Extended SlashCommandDef type with `control` and `ipcMethod` optional fields
- Exported CONTROL_COMMANDS array with 4 daemon-direct commands (clawcode-start, clawcode-stop, clawcode-restart, clawcode-fleet)
- Control commands route to daemon IPC, bypassing agent sessions entirely
- Fleet status returns a Discord embed with green/red/yellow/gray color coding based on agent statuses
- Start/stop/restart commands reply ephemerally with success/error feedback

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend SlashCommandDef type and add control command definitions** - `a602556` (feat)
2. **Task 2: Route control commands via IPC and build fleet status embed** - `a1f7815` (feat)

_Both tasks followed TDD: RED (failing tests) then GREEN (implementation)._

## Files Created/Modified
- `src/discord/slash-types.ts` - Added control/ipcMethod fields to SlashCommandDef, exported CONTROL_COMMANDS array
- `src/discord/slash-commands.ts` - Added handleControlCommand, buildFleetEmbed, formatUptime; CONTROL_COMMANDS in register()
- `src/discord/__tests__/slash-types.test.ts` - Tests for CONTROL_COMMANDS structure and content
- `src/discord/__tests__/slash-commands.test.ts` - Tests for buildFleetEmbed (colors, fields, edge cases) and formatUptime

## Decisions Made
- Control commands are checked before agent lookup in handleInteraction -- they don't require channel binding to an agent
- Fleet command (`clawcode-fleet`) defers as public (visible to all), while start/stop/restart defer as ephemeral (visible only to invoker)
- buildFleetEmbed returns a plain object instead of discord.js EmbedBuilder for easy unit testing
- formatUptime uses compact "Xd Xh Xm" format, dropping zero-value leading segments

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing test count mismatch for effort command**
- **Found during:** Task 1 (slash-types tests)
- **Issue:** Uncommitted `clawcode-effort` command in DEFAULT_SLASH_COMMANDS made array length 8, but test expected 7
- **Fix:** Updated test to expect 8 commands and include "clawcode-effort" in the name list; added effort to withOptions set
- **Files modified:** src/discord/__tests__/slash-types.test.ts
- **Verification:** All existing + new tests pass
- **Committed in:** a602556 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minor test fix for pre-existing uncommitted code. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors in daemon.ts, memory tests, and budget.ts are unrelated to this plan's changes. No errors in slash command files.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all functions are fully implemented with real IPC routing.

## Next Phase Readiness
- Control commands ready for Discord registration alongside agent commands
- Fleet status embed ready for production use
- No blockers for downstream phases

---
*Phase: 47-discord-slash-commands-for-control*
*Completed: 2026-04-12*
