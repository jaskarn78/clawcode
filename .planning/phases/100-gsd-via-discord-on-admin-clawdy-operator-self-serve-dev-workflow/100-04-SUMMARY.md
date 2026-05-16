---
phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow
plan: 04
subsystem: discord-slash-dispatcher
tags: [discord, slash-commands, subagent-thread, inline-handler-short-circuit, 12th-application, gsd, deferReply, race-safe, admin-clawdy-guard, verbatim-error]

# Dependency graph
requires:
  - phase: 100
    plan: 01
    provides: "ResolvedAgentConfig.settingSources (always populated, default ['project']); admin-clawdy receives ['project','user'] via Plan 07 fixture"
  - phase: 100
    plan: 02
    provides: "session-adapter.ts reads settingSources + cwd from config; subagent inherits via existing ...parentConfig spread at subagent-thread-spawner.ts:211"
  - phase: 99
    sub_scope: M
    provides: "SubagentThreadSpawner.spawnInThread shipped (line 145); spawnInThread accepts {parentAgentName, threadName, task} and returns {threadId, sessionName, parentAgent, channelId}. Plan 04 adds spawnInThread as the 2nd invocation site (1st = MCP tool spawn_subagent_thread; 2nd = the new /gsd-* long-runner short-circuit)"
  - phase: 96
    plan: 05
    provides: "11th inline-handler short-circuit precedent (handleProbeFsCommand) — Plan 04 adds the 12th. Insertion point: AFTER /clawcode-probe-fs handler at line ~1300, BEFORE the controlCmd = CONTROL_COMMANDS.find branch at line ~1322"
  - phase: 85
    plan: 03
    provides: "TOOL-04 verbatim-error precedent — when async ops fail, surface err.message verbatim via editReply (no rewording)"
  - phase: 87
    plan: 05
    provides: "CMD-05 optional-DI pattern (aclDeniedByAgent?: ...) — Plan 04 mirrors this for subagentThreadSpawner?: SubagentThreadSpawner"
provides:
  - "GSD_LONG_RUNNERS: ReadonlySet<string> module-level const at slash-commands.ts:156"
  - "12th application of the inline-handler-short-circuit-before-control-command pattern at slash-commands.ts:1305-1318"
  - "SlashCommandHandler.handleGsdLongRunner private async method at slash-commands.ts:1925-2008 (115 lines including JSDoc)"
  - "SlashCommandHandlerConfig.subagentThreadSpawner?: SubagentThreadSpawner optional DI field"
  - "SlashCommandHandler.subagentThreadSpawner: SubagentThreadSpawner | null private field with constructor wiring"
  - "14-test slash-commands-gsd.test.ts dispatcher contract pin"
affects:
  - "Plan 100-05 (subagent-thread-spawner relayCompletionToParent extension): can extend the relay prompt to surface artifact paths from the GSD .planning/phases/<N>/ directory; the dispatcher already passes the canonical /gsd:* slash as task verbatim — relay-side parsing can detect 'phase:<N>' from the subagent's last reply or from the threadName 'gsd:plan:100' / 'gsd:execute:100' format"
  - "Plan 100-07 (clawcode.yaml admin-clawdy fixture): MUST include 5 slashCommand entries with EXACT names from GSD_LONG_RUNNERS + the 2 short-runner names (gsd-debug, gsd-quick). claudeCommand templates: '/gsd:autonomous {args}', '/gsd:plan-phase {phase}', '/gsd:execute-phase {phase}', '/gsd:debug {issue}', '/gsd:quick {task}'. settingSources: ['project','user']. gsd.projectDir: '/opt/clawcode-projects/sandbox' (or operator's chosen target)"
  - "Plan 100-08 smoke-test runbook: production deploy registers 5 slash commands on the admin-clawdy guild; operator types /gsd-autonomous in #admin-clawdy and verifies subagent thread spawn + the canonical /gsd:autonomous slash dispatches inside the subagent session"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "12th application of inline-handler-short-circuit-before-control-command pattern (Phases 85/86/87/88/90/91/92/95/96)"
    - "Optional-DI for new dependencies (subagentThreadSpawner?: ...) — mirrors Phase 87 aclDeniedByAgent + Phase 83 skillsCatalog optional-DI"
    - "deferReply-first race-safety against the 3s Discord interaction-token deadline (RESEARCH.md Pitfall 4) — pinned by GSD-6 invocationCallOrder assertion"
    - "Channel guard at the TOP of the handler (after deferReply, before any other I/O) — non-admin channels get a polite refusal, NO downstream side-effects"
    - "Verbatim-error surfacing on spawn failure (Phase 85 TOOL-04 precedent) — operator sees real root-cause, not a sanitised blob"

key-files:
  created:
    - src/discord/__tests__/slash-commands-gsd.test.ts (542 lines, 14 tests covering GSD-1..GSD-14)
  modified:
    - src/discord/slash-commands.ts (+209 lines: import +5, GSD_LONG_RUNNERS +20, config field +13, class field +6, constructor +2, inline short-circuit +14, handleGsdLongRunner method +149)

key-decisions:
  - "Optional-DI for subagentThreadSpawner (not required) — mirrors Phase 87 aclDeniedByAgent + Phase 83 skillsCatalog. Existing tests + non-Discord wiring continue to work; missing spawner emits a graceful 'Subagent thread spawning unavailable' editReply rather than throwing. GSD-14 pins this contract."
  - "Channel-bound-to-admin-clawdy guard at the TOP of handleGsdLongRunner (after deferReply, before any other I/O). Per CONTEXT.md lock-in: ONLY Admin Clawdy responds to /gsd-* slashes. The guard is structural, not configuration-driven — no per-agent allow/deny list. GSD-7 pins this."
  - "deferReply is the FIRST async call in the method (RESEARCH.md Pitfall 4). Spawning a subagent thread takes 500ms-2s+ (Discord thread create + SDK session start) and would race the 3s Discord interaction-token deadline without an explicit defer. GSD-6 pins this with vi.fn() invocationCallOrder."
  - "Comment-only rephrasing to avoid the literal token 'CONTROL_COMMANDS.find' in JSDoc — the Phase 87 S4 source-grep regression test (slash-commands-permission.test.ts) does indexOf on that string and expects the FIRST occurrence to be the dispatch line, not a JSDoc comment. Rewording avoids tightening or breaking that test while keeping the comment human-readable."

patterns-established:
  - "12th application of the inline-handler-short-circuit-before-control-command pattern: AFTER the prior carve-outs, BEFORE the generic control-command dispatch. Phase 100 = Set-based detection (`GSD_LONG_RUNNERS.has(commandName)`) instead of a single string compare; this scales linearly when more long-runners join the set in future phases without re-introducing the if-ladder."
  - "deferReply-first + admin-clawdy guard + cmdDef-resolve + canonical-slash-build + thread-name-compute + spawn-with-verbatim-error: 6-step flow that future long-runner inline handlers can mirror byte-for-byte when they need to pre-spawn a subagent thread before responding."

requirements-completed: [REQ-100-01, REQ-100-03, REQ-100-09]

# Metrics
duration: 9min
completed: 2026-04-26
---

# Phase 100 Plan 04: Slash Dispatcher — /gsd-* Inline Handler with Auto-Thread Pre-Spawn (12th application) Summary

**12th application of the inline-handler-short-circuit-before-control-command pattern: long-runners (`/gsd-autonomous`, `/gsd-plan-phase`, `/gsd-execute-phase`) auto-spawn a subagent thread; short-runners (`/gsd-debug`, `/gsd-quick`) fall through to the legacy claudeCommand-template agent-routed branch. Race-safe (deferReply-first), admin-clawdy guarded, verbatim-error on spawn failure.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-26T18:40:11Z
- **Completed:** 2026-04-26T18:48:45Z
- **Tasks:** 2 (RED + GREEN per TDD)
- **Files modified:** 2 (1 source + 1 new test)

## Accomplishments

- **GSD_LONG_RUNNERS module-level const** at `slash-commands.ts:156` — `ReadonlySet<string>` containing `gsd-autonomous`, `gsd-plan-phase`, `gsd-execute-phase`. Set-based detection scales linearly when more long-runners join (vs. an if-ladder of string compares).
- **12th inline-handler short-circuit** at `slash-commands.ts:1305-1318` — `if (GSD_LONG_RUNNERS.has(commandName)) { await this.handleGsdLongRunner(interaction, commandName); return; }`. Insertion point: AFTER /clawcode-probe-fs (line 1300), BEFORE the generic control-command dispatch (line 1322). Short-runners (`gsd-debug`, `gsd-quick`) are NOT in the set; they fall through to the legacy agent-routed branch where `formatCommandMessage` rewrites their `claudeCommand` template to the canonical `/gsd:debug` / `/gsd:quick` form.
- **handleGsdLongRunner private async method** at `slash-commands.ts:1925-2008` (~115 lines) — 6-step flow:
  1. **deferReply FIRST** within the 3s Discord interaction-token window (RESEARCH.md Pitfall 4 mitigation).
  2. **admin-clawdy channel guard** via `getAgentForChannel(this.routingTable, channelId)` — non-admin channels get `"/gsd-* commands are restricted to #admin-clawdy."` and the method returns without further side-effects.
  3. **cmdDef resolve** from `this.resolvedAgents.find(a => a.name === 'admin-clawdy').slashCommands.find(c => c.name === commandName)`. Plan 07 lands the 5 GSD entries; Plan 04 trusts that contract.
  4. **canonical /gsd:* build** via `formatCommandMessage(cmdDef, options)` — for `claudeCommand: "/gsd:autonomous {args}"` with args="--from 100", produces `"/gsd:autonomous --from 100"`.
  5. **thread name compute** — `gsd:<short>:<phaseArg>` where shortName maps `gsd-autonomous → autonomous`, `gsd-plan-phase → plan`, `gsd-execute-phase → execute`. Empty phaseArg falls back to `gsd:<short>` (no trailing colon).
  6. **spawn-with-verbatim-error** — `this.subagentThreadSpawner.spawnInThread({parentAgentName, threadName, task: canonicalSlash})`. On failure, surface `err.message` verbatim via `editReply` (Phase 85 TOOL-04 precedent). On missing spawner DI, emit graceful `"Subagent thread spawning unavailable"` reply (GSD-14).
- **SlashCommandHandlerConfig.subagentThreadSpawner?: SubagentThreadSpawner** optional DI field — mirrors Phase 87 `aclDeniedByAgent` + Phase 83 `skillsCatalog` optional-DI pattern. Existing tests + non-Discord wiring continue to work without updates.
- **`SlashCommandHandler.subagentThreadSpawner: SubagentThreadSpawner | null`** private class field with constructor wiring (`this.subagentThreadSpawner = config.subagentThreadSpawner ?? null;`).
- **14 new GSD dispatcher tests** in `src/discord/__tests__/slash-commands-gsd.test.ts` (NEW file, 542 lines):
  - **GSD-1..3** (long-runners): `gsd-autonomous`, `gsd-plan-phase`, `gsd-execute-phase` each route to `handleGsdLongRunner` → `spawnInThread` called once + `editReply` invoked.
  - **GSD-4..5** (short-runners): `gsd-debug`, `gsd-quick` do NOT call `spawnInThread` (verified via `toHaveBeenCalledTimes(0)`).
  - **GSD-6** (race-safety): `deferReply.mock.invocationCallOrder[0] < spawnInThread.mock.invocationCallOrder[0]` — pins deferReply-first.
  - **GSD-7** (channel guard): non-admin channel → editReply rejection containing "restricted" or "admin-clawdy"; spawnInThread NOT called.
  - **GSD-8** (parentAgentName): `spawnInThread.mock.calls[0][0].parentAgentName === 'admin-clawdy'`.
  - **GSD-9** (canonical task): `spawnInThread.mock.calls[0][0].task === '/gsd:autonomous --from 100'` for input `args='--from 100'`.
  - **GSD-10..11** (thread name format): `gsd:autonomous:100`, `gsd:plan:100`.
  - **GSD-12** (thread name fallback): `gsd:autonomous` when no phaseArg given.
  - **GSD-13** (verbatim error): mocked rejection with `Error("quota exceeded")` → editReply call contains the exact substring `"quota exceeded"`.
  - **GSD-14** (missing spawner): `subagentThreadSpawner: undefined` → editReply call contains substring `"unavailable"`.
- **Zero regressions** across the full `src/discord/` test suite (420 tests across 39 files, all green).

## Task Commits

1. **Task 1: TDD RED — 14-test scaffold for /gsd-* dispatcher** — `51cdc84` (test): scaffolds the failing test suite. 12 RED + 2 vacuously GREEN (GSD-4 + GSD-5 negative assertions for short-runners — they pass before Task 2 lands because nothing routes them to `spawnInThread` yet, so the spy is naturally never called).
2. **Task 2: GREEN — 12th inline short-circuit + handleGsdLongRunner + comment-fix deviation** — `23934c3` (feat): all 14 GSD tests pass; 27 existing slash-commands tests pass; 4 existing permission carve-out tests pass; 420 src/discord/ tests green.

**Plan metadata:** TBD (final commit on this SUMMARY + STATE.md + ROADMAP.md update).

## Files Created/Modified

### Source

- `src/discord/slash-commands.ts:82-89` — added `import type { SubagentThreadSpawner } from "./subagent-thread-spawner.js";` after `SkillsCatalog` import.
- `src/discord/slash-commands.ts:140-160` — added `GSD_LONG_RUNNERS` const at module scope (after `MAX_COMMANDS_PER_GUILD`).
- `src/discord/slash-commands.ts:339-352` — added `subagentThreadSpawner?: SubagentThreadSpawner` to `SlashCommandHandlerConfig` (after `adminUserIds?:` field).
- `src/discord/slash-commands.ts:932-937` — added `private readonly subagentThreadSpawner: SubagentThreadSpawner | null` class field (after `adminUserIds`).
- `src/discord/slash-commands.ts:937-940` — added constructor wiring `this.subagentThreadSpawner = config.subagentThreadSpawner ?? null;`.
- `src/discord/slash-commands.ts:1305-1318` — 12th inline-handler short-circuit at `handleInteraction`. AFTER `/clawcode-probe-fs` handler (line 1300), BEFORE the generic control-command dispatch (line 1322).
- `src/discord/slash-commands.ts:1893-2008` — `handleGsdLongRunner` private async method (~115 lines including JSDoc + 6-step flow body).

### Tests

- `src/discord/__tests__/slash-commands-gsd.test.ts` — NEW (542 lines). `describe("Phase 100 — /gsd-* slash dispatcher", ...)` containing the 14 GSD-1..GSD-14 tests + a `makeGsdSlashCommands()` fixture builder + `makeAdminClawdy()` + `makeFinAcquisition()` agent fixtures + `makeMockSpawner()` SubagentThreadSpawner stub builder + `makeRoutingTable()` + `makeHandler()` + `makeInteraction()`.

## Decisions Made

- **Optional-DI for `subagentThreadSpawner`.** Mirrors Phase 87 `aclDeniedByAgent` + Phase 83 `skillsCatalog` optional-DI. Existing tests + non-Discord wiring continue to work without updates; missing spawner emits a graceful `"Subagent thread spawning unavailable"` reply rather than throwing. GSD-14 pins this contract.
- **Channel guard at the TOP of `handleGsdLongRunner` (after deferReply, before any other I/O).** Per CONTEXT.md lock-in: ONLY Admin Clawdy responds to /gsd-* slashes. The guard is structural — no per-agent allow/deny list. Non-admin channels get a polite refusal. GSD-7 pins this.
- **`deferReply` is the FIRST async call** (RESEARCH.md Pitfall 4). Spawning a subagent thread takes 500ms-2s+ (Discord thread create + SDK session start) and would race the 3s Discord interaction-token deadline without an explicit defer. GSD-6 pins this with `vi.fn().mock.invocationCallOrder` assertion.
- **Set-based detection (`GSD_LONG_RUNNERS.has(commandName)`)** instead of an if-ladder of string compares. Scales linearly when more long-runners join the set in future phases without re-introducing the if-ladder smell.
- **`shortName` mapping**: `gsd-autonomous → autonomous`, `gsd-plan-phase → plan`, `gsd-execute-phase → execute`. Two-step regex: `replace(/^gsd-/, "")` strips the Discord-compatible prefix, then `replace(/-phase$/, "")` strips the trailing `-phase` suffix on plan-phase + execute-phase. Result is sortable in Discord's thread sidebar (`gsd:autonomous:100`, `gsd:execute:100`, `gsd:plan:100`).
- **Comment-only rephrasing to avoid the literal token `"CONTROL_COMMANDS.find"`** in the new JSDoc. The Phase 87 S4 source-grep regression test (`slash-commands-permission.test.ts:247-268`) does `indexOf("CONTROL_COMMANDS.find")` and expects the FIRST occurrence to be the dispatch line at the bottom of `handleInteraction`, not a JSDoc comment higher up. Rewording the JSDoc to "generic control-command dispatch" preserves human readability without breaking that test. Documented as a [Rule 3 - Blocking] deviation below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] JSDoc comment contained literal `CONTROL_COMMANDS.find` token, broke Phase 87 S4 source-grep regression test**

- **Found during:** Task 2 (after running `npx vitest run src/discord/`)
- **Issue:** The new `GSD_LONG_RUNNERS` JSDoc comment at line ~152 included the literal text `"CONTROL_COMMANDS.find"`. Phase 87's `slash-commands-permission.test.ts:S4` does `src.indexOf("CONTROL_COMMANDS.find")` and asserts that the `clawcode-permissions` carve-out (line 1204) appears BEFORE the FIRST occurrence of that string. My JSDoc comment at line 152 became the new "first occurrence", flipping the assertion.
- **Fix:** Rewrote the JSDoc comment to use "generic control-command dispatch" (human-readable English) instead of the literal source-token. Preserves the comment's intent without affecting the Phase 87 source-grep regression assertion.
- **Files modified:** `src/discord/slash-commands.ts` (comment-only rewording in 2 places: the GSD_LONG_RUNNERS const docblock + the inline-handler short-circuit comment block)
- **Verification:** `npx vitest run src/discord/__tests__/slash-commands-permission.test.ts` → all 4 S1..S4 tests green. `npx vitest run src/discord/` → 420 tests green.
- **Committed in:** `23934c3` (Task 2 GREEN commit — landed alongside the GREEN edits, NOT a separate commit since the test failure surfaced AFTER the GREEN code was first staged but BEFORE the commit landed).

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Comment-only rewording — zero functional change. The 12th inline-handler short-circuit pattern is preserved verbatim per RESEARCH.md Code Examples §3; only the docblock English changed.

## Issues Encountered

- **Pre-existing TS error in `src/discord/__tests__/slash-commands-probe-fs.test.ts:349`** — `error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'FsProbeOutcomeWire'`. Verified via `git stash` baseline that this exists on master; out of scope per CLAUDE.md SCOPE BOUNDARY rule.
- **Plan 05 work-in-progress in `src/discord/subagent-thread-spawner.ts` + `subagent-thread-spawner.test.ts`** (parallel Wave 3 executor) shows in `git status` but is NOT staged by Plan 04. The two plans run independently; once both commit, the imports will compose because Plan 04 only consumes the `SubagentThreadSpawner` class type (a public surface that's stable across both plans).

## User Setup Required

None — Plan 04 is type-plumbing + 1 new test file + 1 new private method on `SlashCommandHandler`. Production rollout requires:
- **Plan 100-07** lands the 5 slashCommand entries on `admin-clawdy` in `clawcode.yaml`. Without these, `cmdDef = agentConfig?.slashCommands.find(...)` returns undefined and the handler emits `"Unknown command: /gsd-autonomous"` (graceful fallback).
- **Plan 100-06** symlinks `~/.claude/commands/gsd/` to the `clawcode` system user. Without these, the subagent receives the canonical `/gsd:autonomous --from 100` task string but the SDK reports "Unknown skill" because `settingSources: ['user']` finds no `commands/gsd/*.md` files.
- **Plan 100-08 SMOKE-TEST runbook** documents the operator-driven manual deploy step on the clawdy host (per the deployment_constraint that this conversation's executor never touches clawdy).

## Next Phase Readiness

**Plan 05 hand-off** — `subagent-thread-spawner.ts:relayCompletionToParent` extension to surface artifact paths in the parent-side completion summary:
- The dispatcher (Plan 04) passes the canonical `/gsd:*` slash as the subagent's `task` verbatim.
- Plan 05's relay-side prompt extension can detect a `/gsd:*` task by checking if `task.startsWith('/gsd:')` AND parse the phase arg from the task (`/gsd:plan-phase 100` → phase 100) OR from the threadName (`gsd:plan:100` → phase 100).
- The threadName format `gsd:<short>:<phaseArg>` is the more reliable parse target since it's structurally regular.
- Plan 05 can use `discoverArtifactPaths('.planning/phases/<NN>-*/')` (already shipped per the `subagent-thread-spawner.test.ts` import surface visible during Plan 04 — though not yet committed) to enumerate artifact files.

**Plan 07 hand-off — exact 5 slashCommand entries to land in admin-clawdy's clawcode.yaml block:**

```yaml
agents:
  - name: admin-clawdy
    # ... existing fields ...
    settingSources: [project, user]   # Phase 100 GSD-02
    gsd:
      projectDir: /opt/clawcode-projects/sandbox  # Phase 100 GSD-04
    slashCommands:
      - name: gsd-autonomous          # MUST match GSD_LONG_RUNNERS
        description: Run all remaining phases autonomously
        claudeCommand: "/gsd:autonomous {args}"
        options:
          - { name: args, type: 3, description: "Optional flags (e.g. --from 100)", required: false }
      - name: gsd-plan-phase           # MUST match GSD_LONG_RUNNERS
        description: Create phase plan with verification loop
        claudeCommand: "/gsd:plan-phase {phase}"
        options:
          - { name: phase, type: 3, description: "Phase number + optional flags", required: false }
      - name: gsd-execute-phase        # MUST match GSD_LONG_RUNNERS
        description: Execute all plans in a phase
        claudeCommand: "/gsd:execute-phase {phase}"
        options:
          - { name: phase, type: 3, description: "Phase number + optional flags", required: false }
      - name: gsd-debug                # NOT in GSD_LONG_RUNNERS — fall-through
        description: Systematic debugging with persistent state
        claudeCommand: "/gsd:debug {issue}"
        options:
          - { name: issue, type: 3, description: "Issue description", required: true }
      - name: gsd-quick                # NOT in GSD_LONG_RUNNERS — fall-through
        description: Quick task with GSD guarantees
        claudeCommand: "/gsd:quick {task}"
        options:
          - { name: task, type: 3, description: "Task description", required: true }
```

The 3 long-runner names MUST match `GSD_LONG_RUNNERS` exactly — the dispatcher uses Set membership, so any drift (typo, reordering, casing) silently routes a long-runner through the short-runner fall-through path with no spawn occurring.

The 2 short-runner names are NOT validated against any allowlist — they're simply discoverable via the legacy `formatCommandMessage` substitution path. Future operators can add more `/gsd-<command>` entries beyond the 5 in this phase without touching Plan 04 source code (as long as the new ones are short-runners).

**Plan 08 hand-off — smoke-test verification points:**
- Operator types `/gsd-autonomous` in `#admin-clawdy` → expect a thread named `gsd:autonomous` (no phase arg) appears within 3s + ack message in main channel.
- Operator types `/gsd-plan-phase 100` in `#admin-clawdy` → expect thread `gsd:plan:100` + ack.
- Operator types `/gsd-debug "memory leak"` in `#admin-clawdy` → expect inline reply (no thread spawn).
- Operator types `/gsd-autonomous` in a non-admin-clawdy channel → expect `"/gsd-* commands are restricted to #admin-clawdy."` reply, no thread.

## SlashCommandHandler Private Field Names Confirmed

For Plan 05 hand-off — the actual SlashCommandHandler private-field names verified during this plan:

- `this.subagentThreadSpawner: SubagentThreadSpawner | null` — NEW in Plan 04
- `this.routingTable: RoutingTable` — existing (Phase 75)
- `this.resolvedAgents: readonly ResolvedAgentConfig[]` — existing
- `this.log: Logger` — existing (pino)
- `this.sessionManager: SessionManager` — existing
- `this.adminUserIds: readonly string[]` — existing (Phase 95)
- `this.aclDeniedByAgent: ReadonlyMap<string, ReadonlySet<string>> | null` — existing (Phase 87)

Imports already present at the top of slash-commands.ts (no new imports needed by Plan 05 if it consumes the same file): `getAgentForChannel` from `./router.js`, `formatCommandMessage` (defined inline at line ~3923), `SubagentThreadSpawner` (added in Plan 04). Plan 05 modifies `subagent-thread-spawner.ts` separately — no slash-commands.ts edits needed.

---
*Phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow*
*Plan: 04*
*Completed: 2026-04-26*

## Self-Check: PASSED

- ✓ src/discord/__tests__/slash-commands-gsd.test.ts FOUND
- ✓ src/discord/slash-commands.ts FOUND
- ✓ .planning/phases/100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow/100-04-SUMMARY.md FOUND
- ✓ commit 51cdc84 (Task 1 RED) FOUND
- ✓ commit 23934c3 (Task 2 GREEN) FOUND
- ✓ All 14 GSD-1..GSD-14 dispatcher tests pass GREEN
- ✓ All 4 Phase 87 S1..S4 permission carve-out tests pass (regression check after comment-fix deviation)
- ✓ All 27 existing slash-commands.test.ts tests pass (no regressions)
- ✓ Full src/discord/ test suite: 420 tests passing across 39 files
- ✓ Zero new tsc errors caused by Plan 04 (the 1 pre-existing error in slash-commands-probe-fs.test.ts:349 verified out-of-scope via git stash baseline)
