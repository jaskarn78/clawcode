---
phase: 35-resolve-openclaw-coexistence-conflicts
plan: 01
subsystem: discord
tags: [discord, slash-commands, token-resolution, coexistence, 1password]

requires:
  - phase: none
    provides: existing daemon and slash command infrastructure
provides:
  - Hard-fail token resolution from config (no shared plugin fallback)
  - Prefixed slash commands (clawcode-*) avoiding OpenClaw namespace collision
  - Deduplicated skill install during daemon startup
affects: [daemon-startup, discord-bridge, slash-commands]

tech-stack:
  added: []
  patterns:
    - "Config-based Discord token resolution with op:// 1Password support"
    - "Slash command namespace prefixing for multi-bot coexistence"
    - "Shared Discord client between bridge and slash handler"

key-files:
  created: []
  modified:
    - src/manager/daemon.ts
    - src/discord/slash-types.ts
    - src/discord/slash-commands.ts
    - src/config/schema.ts
    - src/discord/__tests__/slash-types.test.ts
    - src/discord/__tests__/slash-commands.test.ts

key-decisions:
  - "Discord token resolved from config.discord.botToken, not shared plugin token (COEX-01)"
  - "All 6 default slash commands prefixed with clawcode- to avoid OpenClaw collisions (COEX-02)"
  - "SlashCommandHandler shares Discord client with bridge instead of creating its own (COEX-02)"
  - "discord config schema added as optional section to clawcode.yaml root (forward-compatible)"

patterns-established:
  - "Namespace prefixing: all ClawCode Discord commands use clawcode- prefix"
  - "Token resolution: config.discord.botToken with op:// 1Password support, hard-fail on error"

requirements-completed: [COEX-01, COEX-02, COEX-05]

duration: 8min
completed: 2026-04-10
---

# Phase 35 Plan 01: Daemon Coexistence Fixes Summary

**Hard-fail Discord token resolution from config, clawcode- prefixed slash commands, and deduplicated skill install for safe OpenClaw coexistence**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-10T16:19:50Z
- **Completed:** 2026-04-10T16:28:08Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Discord bot token now resolved exclusively from `config.discord.botToken` -- throws on 1Password op:// read failure instead of silently falling back to shared plugin token (COEX-01)
- All 6 default slash commands renamed with `clawcode-` prefix to prevent overwriting OpenClaw's commands (COEX-02)
- SlashCommandHandler no longer creates its own Discord gateway connection -- requires bridge client or throws (COEX-02)
- `installWorkspaceSkills` consolidated to a single call with proper `skillsPath` argument (COEX-05)
- Added `discord` config schema section to `clawcode.yaml` for explicit bot token configuration

## Task Commits

Each task was committed atomically:

1. **Task 1: Hard-fail token resolution and deduplicate skill install** - `37604b6` (feat)
2. **Task 2: Prefix slash commands and remove fallback Client** - `df88635` (feat)

## Files Created/Modified
- `src/manager/daemon.ts` - Token resolution rewritten, skill install deduplicated, slash handler gets bridge client
- `src/config/schema.ts` - Added `discordConfigSchema` with optional `botToken` field
- `src/discord/slash-types.ts` - All 6 command names prefixed with `clawcode-`
- `src/discord/slash-commands.ts` - Removed Client creation from start(), shared client pattern, removed GatewayIntentBits import
- `src/discord/__tests__/slash-types.test.ts` - Updated assertions for clawcode- prefixed names
- `src/discord/__tests__/slash-commands.test.ts` - Updated custom command override test to use clawcode- prefix

## Decisions Made
- Added `discord` as optional top-level config section rather than putting botToken at config root -- keeps config organized and forward-compatible for future Discord settings
- SlashCommandHandler stop() no longer destroys the shared client -- bridge owns the client lifecycle
- Removed `loadBotToken` import entirely from daemon.ts since the shared plugin fallback is the coexistence conflict being resolved

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added discord config schema to config/schema.ts**
- **Found during:** Task 1
- **Issue:** Plan described `config.discord?.botToken` but no discord config existed in the schema
- **Fix:** Added `discordConfigSchema` with optional `botToken` field to the root config schema
- **Files modified:** src/config/schema.ts
- **Verification:** TypeScript compilation succeeds, config type includes discord field
- **Committed in:** 37604b6 (Task 1 commit)

**2. [Rule 2 - Missing Critical] Pass bridge client to SlashCommandHandler in daemon.ts**
- **Found during:** Task 2
- **Issue:** SlashCommandHandler no longer creates its own client, but daemon.ts wasn't passing the bridge client
- **Fix:** Added `client: discordBridge?.discordClient` to handler config, added `client` field to config type
- **Files modified:** src/manager/daemon.ts, src/discord/slash-commands.ts
- **Verification:** Handler receives client from bridge, throws if bridge unavailable
- **Committed in:** df88635 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 missing critical)
**Impact on plan:** Both auto-fixes necessary for correctness. Schema addition required for config-based token resolution. Client passing required for shared client pattern. No scope creep.

## Issues Encountered
- Plan referenced line numbers and code patterns from an older version of daemon.ts (e.g., op:// resolution at lines 305-334, two installWorkspaceSkills calls). Actual code had simpler structure with loadBotToken() at lines 301-307 and single installWorkspaceSkills call. Adapted implementation to match actual codebase state while achieving the same coexistence goals.

## User Setup Required
None - no external service configuration required. Users must add `discord.botToken` to their clawcode.yaml when ready.

## Known Stubs
None - all data paths are fully wired.

## Next Phase Readiness
- Daemon coexistence fixes complete, ready for plan 02 (remaining coexistence concerns)
- Config schema supports discord.botToken with op:// references
- Slash commands safely namespaced under clawcode- prefix

---
*Phase: 35-resolve-openclaw-coexistence-conflicts*
*Completed: 2026-04-10*
