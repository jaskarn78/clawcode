---
phase: 999.21-consolidate-gsd-discord-slash-commands
plan: 01
subsystem: discord/slash-commands
tags: [discord, slash-commands, gsd, consolidation, ui]
requires:
  - GSD_SLASH_COMMANDS const (slash-types.ts) carrying 19 entries
  - GSD_LONG_RUNNERS set (slash-commands.ts) for the 3 long-runner short-circuit
  - handleSetGsdProjectCommand inline handler (slash-commands.ts)
provides:
  - SlashCommandDef.subcommandOf optional field for nesting any future
    command group under a single Discord top-level command.
  - /get-shit-done top-level Discord command with 19 nested type=1
    SUB_COMMAND children — the slash menu now shows ONE get-shit-done
    namespace instead of 19 flat gsd-* entries.
  - Rewrite-at-entry dispatch contract: handleInteraction remaps
    commandName === "get-shit-done" + getSubcommand() to the legacy
    gsd-<sub> form so every existing carve-out keeps matching unchanged.
affects:
  - src/discord/slash-types.ts (GSD_SLASH_COMMANDS shape + SlashCommandDef
    type extension)
  - src/discord/slash-commands.ts (register loop body shape + cmdDef
    lookups in handleInteraction agent-routed branch and
    handleGsdLongRunner)
  - src/discord/__tests__/slash-commands-gsd-register.test.ts (updated
    for the nested form)
tech-stack:
  added: []
  patterns:
    - "subcommandOf-driven body grouping in register() — pattern reusable
      for any future Discord command group (mirrors how Phase 87 CMD-04
      established mergeAndDedupe as a reusable register-loop helper)"
    - "single-rewrite-point dispatch: collapse all downstream string
      matches to the legacy flat form at the top of handleInteraction so
      every existing carve-out keeps working without modification"
key-files:
  created:
    - "src/discord/__tests__/slash-commands-gsd-nested.test.ts"
  modified:
    - "src/discord/slash-types.ts"
    - "src/discord/slash-commands.ts"
    - "src/discord/__tests__/slash-types-gsd-commands.test.ts"
    - "src/discord/__tests__/slash-commands-gsd-register.test.ts"
decisions:
  - "Wrap-and-keep over single-composite-def: each GSD_SLASH_COMMANDS
    entry stays in place with subcommandOf added; lookup carve-outs
    remain unchanged via rewrite-at-entry. Rejected the alternative
    (one composite SlashCommandDef with subcommands array) because it
    would have rewritten the dedup loop, the long-runner cmdDef
    resolver, and 4 existing test files."
  - "Single rewrite point in handleInteraction over per-handler
    rewrites: every downstream match (handleSetGsdProjectCommand at
    L1395, GSD_LONG_RUNNERS lookup at L1411, agent-routed cmdDef
    lookup at L1471, handleGsdLongRunner cmdDef lookup at L2133)
    keeps reading the legacy gsd-<sub> form unchanged."
  - "Legacy yaml gsd-* entries gracefully remapped at register time
    (prefix stripped, subcommandOf injected) so operators don't need
    to edit Admin Clawdy's clawcode.yaml to land the consolidation —
    the 5 originals stay yaml-defined and just get re-routed into the
    composite via the same dedup that always supported them."
  - "default_member_permissions intentionally NOT set on the composite
    get-shit-done entry: none of the 19 GSD entries currently use the
    field; Discord scopes the bitmask at top-level commands only —
    even if a subcommand wanted one, Discord would reject it. Future
    work if any GSD subcommand needs admin gating: hoist a single
    bitmask onto the composite that covers the most-restricted child."
metrics:
  duration_minutes: 14
  completed: 2026-05-01
---

# Phase 999.21 Plan 01: Consolidate GSD Discord Slash Commands Summary

Collapse the 19 flat `/gsd-*` Discord slash commands into a single
`/get-shit-done` top-level command with 19 nested subcommands — reclaims
18 of the 90-slot per-guild Discord cap and gives operators a self-
organizing namespace in the slash menu, while keeping every internal
dispatch contract (claudeCommand text, long-runner subagent-thread spawn,
gsd-set-project inline handler, agent-routed short-runners) byte-
identical via a single rewrite-at-entry remap.

## Files Changed

| File | Change | Commit |
| ---- | ------ | ------ |
| src/discord/slash-types.ts | Added optional `subcommandOf?: string` to SlashCommandDef; renamed all 19 GSD_SLASH_COMMANDS entries to bare suffixes (e.g. `autonomous`, `set-project`); each gains `subcommandOf: "get-shit-done"`; updated GSD_SLASH_COMMANDS JSDoc to document the consolidation. | 7e3a587 |
| src/discord/__tests__/slash-types-gsd-commands.test.ts | Find-targets switched from `gsd-X` to `X` (GS1c/d/e/h/i/j); added GS1f/k subcommandOf invariant pins; added GS1l claudeCommand byte-identity verbatim table covering all 19 entries. | 7e3a587 |
| src/discord/slash-commands.ts | Register loop now collects `subcommandOf` entries into a separate `gsdSubcommands` array; emits ONE composite `get-shit-done` body item with 19 type=1 SUB_COMMAND children. handleInteraction got a rewrite-at-entry block (commandName: const → let; remap `get-shit-done` + `getSubcommand()` → `gsd-<sub>`). Agent-routed cmdDef lookup tier-3 fallback to GSD_SLASH_COMMANDS by stripped suffix. handleGsdLongRunner cmdDef lookup strips `gsd-` prefix when querying GSD_SLASH_COMMANDS. | 5a838ed |
| src/discord/__tests__/slash-commands-gsd-register.test.ts | GSR-1/2/3 reshaped for the nested form: 1 composite get-shit-done body item with 19 subcommand options (was 19 flat top-level entries). | 5a838ed |
| src/discord/__tests__/slash-commands-gsd-nested.test.ts | New regression file pinning the four consolidation invariants: single top-level entry (GSDN-01), 19 type=1 subcommands (GSDN-02), claudeCommand byte-identity (GSDN-03), set-project routes to inline handler (GSDN-04), autonomous routes to long-runner with byte-identical task string (GSDN-05), debug routes through agent-routed branch with byte-identical formatCommandMessage output (GSDN-06). | 642292a |

## Net Discord Cap Delta

- **-18 slots** in the per-guild 100-command cap.
  - Pre: 19 flat `gsd-*` top-level commands.
  - Post: 1 composite `get-shit-done` top-level command with 19 nested
    type=1 SUB_COMMAND children.
- Discord's MAX_COMMANDS_PER_GUILD = 90 check at slash-commands.ts:1191
  now sees 1 entry for the GSD group instead of 19.

## Before / After Registration Shape (1 example)

**Before — flat top-level entries (one per GSD command):**
```json
[
  { "name": "gsd-autonomous", "description": "Run all remaining phases autonomously", "options": [{ "name": "args", "type": 3, ... }] },
  { "name": "gsd-plan-phase", "description": "Create phase plan with verification loop", "options": [{ "name": "phase", "type": 3, ... }] },
  ...
  { "name": "gsd-set-project", "description": "Switch this agent's gsd.projectDir at runtime", "options": [{ "name": "path", "type": 3, "required": true, ... }] }
]
```

**After — single composite top-level entry with nested SUB_COMMAND children:**
```json
[
  {
    "name": "get-shit-done",
    "description": "GSD framework — phase planning, execution, debugging",
    "options": [
      {
        "name": "autonomous",
        "type": 1,
        "description": "Run all remaining phases autonomously",
        "options": [{ "name": "args", "type": 3, ... }]
      },
      {
        "name": "plan-phase",
        "type": 1,
        "description": "Create phase plan with verification loop",
        "options": [{ "name": "phase", "type": 3, ... }]
      },
      ...
      {
        "name": "set-project",
        "type": 1,
        "description": "Switch this agent's gsd.projectDir at runtime",
        "options": [{ "name": "path", "type": 3, "required": true, ... }]
      }
    ]
  }
]
```

## claudeCommand Byte-Identity — Confirmed

Every wrapped command's `claudeCommand` text value is byte-identical
pre/post. Confirmed by TWO independent regression pins:

- **GS1l** (slash-types-gsd-commands.test.ts) — table-driven loop over
  the 19-entry naming map; every `GSD_SLASH_COMMANDS[i].claudeCommand`
  asserted against its pre-999.21 value verbatim.
- **GSDN-03** (slash-commands-gsd-nested.test.ts) — duplicate scoped to
  the consolidation contract; surfaces any future register-loop bug
  that mutates claudeCommand on the way to Discord.

Spot-check (verification grep, plan step 3):
```
$ grep -E '^    claudeCommand:' src/discord/slash-types.ts | grep -c '"/gsd:'
18
```
(19 entries minus `set-project`'s empty string = 18; matches expected.)

## Test Pass Output

```
$ npx vitest run src/discord/__tests__/slash-types-gsd-commands.test.ts
Test Files  1 passed (1)
Tests  12 passed (12)

$ npx vitest run src/discord/__tests__/slash-commands-gsd.test.ts \
                 src/discord/__tests__/slash-commands-gsd-register.test.ts \
                 src/discord/__tests__/slash-commands-gsd-capability.test.ts
Test Files  3 passed (3)
Tests  27 passed (27)

$ npx vitest run src/discord/__tests__/slash-commands-gsd-nested.test.ts
Test Files  1 passed (1)
Tests  6 passed (6)

$ npx vitest run src/discord
Test Files  54 passed (54)
Tests  594 passed (594)
```

`npx tsc --noEmit` produces no new errors in slash-types.ts /
slash-commands.ts / the GSD test files. Pre-existing project-wide tsc
errors in unrelated files (cli/commands/__tests__, config/loader,
cutover/__tests__) are not caused by this plan and out of scope.

## Operator Deploy Note

The next daemon restart will re-register the slash command set with
Discord. Effects observable in the Discord client:

1. The 19 old `/gsd-*` entries DISAPPEAR from the slash menu — Discord
   replaces the per-guild registration body wholesale on each REST PUT.
2. A new `/get-shit-done` entry APPEARS with 19 nested choices
   (autonomous, plan-phase, execute-phase, debug, quick, new-project,
   new-milestone, add-phase, add-tests, audit-milestone,
   complete-milestone, cleanup, progress, verify-work, discuss-phase,
   do, fast, help, set-project).
3. **Discord client cache flush:** the slash menu autocomplete may
   cache the old set for up to ~1 hour client-side. Operators who
   want the new menu immediately should refresh the Discord client
   (Ctrl+R on desktop, kill-and-relaunch on mobile). Server-side the
   registration is atomic — no half-state, no broken commands during
   the swap.

The 57 `~/.claude/commands/gsd/*.md` source files were NOT touched.
The /gsd:* canonical SDK form (typed in chat as `/gsd:autonomous`,
`/gsd:plan-phase`, etc.) continues to work unchanged for any operator
who prefers the typed form over the slash menu.

## Rollback Procedure

To revert the consolidation:

1. `git revert 642292a 5a838ed 7e3a587` (in that order — newest first)
   reverses Task 3 → Task 2 → Task 1 atomically.
2. `npm run build` (or `bun run build`) to rebuild the daemon.
3. Restart the daemon (`systemctl restart clawcode` on the prod host
   per .planning/memory references; or whatever the deploy environment
   uses). The next register loop emits the original 19 flat top-level
   entries; Discord's REST PUT replaces the composite back to the flat
   set atomically.
4. Discord client cache flush (Ctrl+R) recommended for operators who
   want the old menu immediately.

No data migrations to undo. No persistent state was written. The
consolidation is purely a registration-time + dispatch-time reshape;
revert is symmetric to deploy.

## Deviations from Plan

### Rule 2 / Rule 3 — Auto-added defensive remap for legacy yaml entries

**Found during:** Task 2 implementation, register loop.

**Issue:** The plan's registration_strategy described routing entries with
`subcommandOf` set into `gsdSubcommands`, but Admin Clawdy's
`clawcode.yaml` legacy GSD entries (5 originals shipped in Phase 100 Plan
07) carry the flat `gsd-autonomous` etc. names with NO `subcommandOf`
field. Without intervention, those entries would still register as flat
top-level commands AND the GSD_SLASH_COMMANDS-driven composite would
register a duplicate-shaped subcommand for the same name — operators
would see both `/gsd-autonomous` (legacy yaml) and
`/get-shit-done autonomous` (new composite) in their slash menu, defeating
the consolidation.

**Fix:** Per-agent merge loop now detects legacy `gsd-*` flat names that
lack `subcommandOf`, strips the prefix, injects
`subcommandOf: "get-shit-done"`, and routes the rewritten entry into
`gsdSubcommands`. Operators can leave their `clawcode.yaml` unchanged
through the migration; the consolidation is enforced at the registration
boundary regardless of yaml shape.

**Files modified:** src/discord/slash-commands.ts (register loop dedup
branch).

**Commit:** 5a838ed.

### Rule 1 — Auto-fixed cmdDef lookup mismatch in agent-routed branch

**Found during:** Task 2, plan verification step 6 surfaced this in
advance (the planner flagged it as an action item). For fin-acquisition
or any GSD-enabled agent without a yaml block, the agent-routed cmdDef
lookup at slash-commands.ts:1471 (`agentCommands.find((c) => c.name ===
commandName)`) would FAIL post-rewrite-at-entry: the rewrite produces
`commandName === "gsd-debug"` but the live GSD_SLASH_COMMANDS entry now
has `name === "debug"`, and `resolveAgentCommands` does NOT walk
GSD_SLASH_COMMANDS at all (only DEFAULT_SLASH_COMMANDS + agent customs).

**Fix:** Three-tier cmdDef lookup gated on the rewrite-at-entry having
fired:
  1. agent's own slashCommands by full name (legacy yaml on Admin Clawdy
     still wins),
  2. agent's own slashCommands by stripped suffix (future yaml entries
     using the bare suffix form),
  3. GSD_SLASH_COMMANDS by stripped suffix (auto-inheritance for any
     GSD-enabled agent without a yaml block).

The same prefix-strip pattern was applied to handleGsdLongRunner's
cmdDef lookup at slash-commands.ts:2133 (unconditional, since long-
runners are always under `/get-shit-done`).

**Files modified:** src/discord/slash-commands.ts (handleInteraction
agent-routed branch + handleGsdLongRunner Step 3).

**Commit:** 5a838ed.

## Authentication Gates

None.

## Self-Check: PASSED

- src/discord/slash-types.ts: FOUND (modified — adds subcommandOf field;
  19 GSD entries renamed to bare suffixes; commit 7e3a587).
- src/discord/slash-commands.ts: FOUND (modified — register loop emits
  composite get-shit-done body item; handleInteraction has rewrite-at-
  entry; cmdDef lookups updated; commit 5a838ed).
- src/discord/__tests__/slash-types-gsd-commands.test.ts: FOUND
  (modified — find-targets updated, GS1f/k/l added; commit 7e3a587).
- src/discord/__tests__/slash-commands-gsd-register.test.ts: FOUND
  (modified — GSR-1/2/3 reshaped for nested form; commit 5a838ed).
- src/discord/__tests__/slash-commands-gsd-nested.test.ts: FOUND
  (created — 6 regression tests; commit 642292a).
- Commit 7e3a587 (Task 1): FOUND in `git log --oneline`.
- Commit 5a838ed (Task 2): FOUND in `git log --oneline`.
- Commit 642292a (Task 3): FOUND in `git log --oneline`.

## Completed
