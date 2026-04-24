---
phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync
plan: 05
subsystem: discord-observability
tags: [slash-command, embed-builder, ipc, sync-observability, daemon-routed, zero-llm, fin-acquisition]

# Dependency graph
requires:
  - phase: 91-01 (Plan 91-01 SUMMARY)
    provides: readSyncState + DEFAULT_SYNC_STATE_PATH + DEFAULT_SYNC_JSONL_PATH + SyncStateFile + SyncConflict schemas (consumed by the daemon IPC handler + embed builder types)
  - phase: 91-02 (Plan 91-02 SUMMARY)
    provides: CONFLICT_EMBED_COLOR=15158332 precedent (red) + partial-conflicts entries in sync.jsonl + populated sync-state.json.conflicts[] (rendered by the embed)
  - phase: 85-01 (Phase 85 /clawcode-tools blueprint)
    provides: inline-handler-short-circuit BEFORE CONTROL_COMMANDS pattern + EmbedBuilder dispatch pattern + list-mcp-status IPC pattern (mirrored verbatim as list-sync-status)
provides:
  - buildSyncStatusEmbed pure function (zero I/O, deterministic) — SyncStateFile snapshot → EmbedBuilder
  - EMBED_COLOR_HAPPY / EMBED_COLOR_CONFLICT / EMBED_COLOR_WARN colour vocabulary
  - DISCORD_EMBED_FIELD_CAP (25) field cap with "… N more" terminal marker
  - list-sync-status IPC method — reads ~/.clawcode/manager/sync-state.json + tails ~/.clawcode/manager/sync.jsonl
  - handleSyncStatusCommand inline slash handler in SlashCommandHandler (8th application of the CONTROL_COMMANDS short-circuit pattern)
  - /clawcode-sync-status Discord slash command registered per-guild (control:true, fleet-level, no per-agent arg)
  - formatBytes / formatDuration helpers (exported for test convenience + future reuse)
affects:
  - 91-06-PLAN (operator runbook — documents the /clawcode-sync-status embed shape + colour vocabulary + `clawcode sync resolve` hint footer)

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps — reuses discord.js EmbedBuilder + existing ipc/client + sync-state-store
  patterns:
    - "Pure-function DI blueprint (Phase 85 precedent): buildSyncStatusEmbed is a pure function with zero I/O; tests pass fixed Date + snapshot input, assert embed shape deterministically"
    - "Inline-handler-short-circuit BEFORE CONTROL_COMMANDS (Phase 85/86/87/88/90 precedent): clawcode-sync-status dispatches to a dedicated handler that short-circuits before the generic CONTROL_COMMANDS loop, so the EmbedBuilder path can't be clobbered by handleControlCommand"
    - "Daemon closure-intercept IPC handler: list-sync-status case in routeMethod uses dynamic import of sync-state-store + readFile for the JSONL tail, decoupling the daemon's static import graph from the src/sync module"
    - "Immutability at call site: conflicts are mapped to new objects with explicit resolvedAt:null before buildSyncStatusEmbed is invoked, preserving the readonly contract without mutating the IPC response"
    - "Discord field cap discipline: 25-field max with explicit '… N more conflicts' terminal marker when truncated — honest cap indicator, not a silent ceiling"

key-files:
  created:
    - src/discord/sync-status-embed.ts (236 lines — pure buildSyncStatusEmbed + formatBytes + formatDuration + 3 colour constants + DISCORD_EMBED_FIELD_CAP)
    - src/discord/__tests__/sync-status-embed.test.ts (337 lines — 30 tests)
    - src/discord/__tests__/slash-commands-sync-status.test.ts (344 lines — 12 tests)
  modified:
    - src/ipc/protocol.ts (+6 lines — list-sync-status IPC method registered)
    - src/manager/daemon.ts (+62 lines — case "list-sync-status" handler with sync-state-store dynamic import + sync.jsonl tail)
    - src/discord/slash-commands.ts (+124 lines — SyncStatusIpcResponse types + handleSyncStatusCommand method + inline short-circuit branch)
    - src/discord/slash-types.ts (+16 lines — clawcode-sync-status CONTROL_COMMANDS entry)
    - src/discord/__tests__/slash-commands.test.ts (count assertion 18→19)
    - src/discord/__tests__/slash-types.test.ts (count assertion 8→9, added list-sync-status to validMethods allowlist)

key-decisions:
  - "Fleet-level (no agent option): /clawcode-sync-status reads the singleton sync-state.json (per D-01 fin-acquisition topology). Adding a per-agent argument would imply fleet-wide sync, which is explicitly a future phase. Plan 91-06 will revisit when the pattern extends beyond fin-acquisition."
  - "Ephemeral reply always: conflict embed includes file paths (MEMORY.md, memory/procedures/newsletter-workflow.md) that shouldn't leak into public channels. Plan 85 /clawcode-tools established the discipline; extended here without deviation."
  - "Colour vocabulary: green=3066993 (happy), red=15158332 (conflict — matches Phase 91-02 CONFLICT_EMBED_COLOR verbatim so conflict-alert embed + status embed speak the same language), yellow=15844367 (paused/failed-ssh/never-run without conflicts). Plan text referenced blurple 0x5865F2 for happy; I chose Discord-native green 3066993 to match the Phase 91-02 embed vocabulary + the plan's own `must_haves.truths` bullet ('happy path is green (3066993)')."
  - "Conflict field cap at 25 with '… N more' terminal marker: Discord hard-cap is 25 fields per embed. The 91-02 alerter silently slices; here we replace the last slot with a terminal fact so operators see an honest cap indicator (6 more conflicts in sync-state.json) rather than assuming the embed shows every conflict."
  - "Dynamic import of sync-state-store in daemon.ts: mirrors the closure-intercept pattern from Phase 88. Keeps daemon's static import graph smaller + isolates sync-module imports behind the rare path that actually invokes the IPC method. readFile is hoisted (top-level import)."
  - "Zero 'never-run' render path: when lastCycle=null (first-boot, no sync.jsonl), the embed renders 'Last cycle: **never-run**' in description + yellow colour + footer hint 'Sync has not run yet — systemd timer or `clawcode sync run-once`'. Prevents a blank embed + gives operators a concrete next action."
  - "Source-grep test discipline (SS8): test asserts 'clawcode-sync-status' literal appears ≥2 times in slash-commands.ts source (routing branch + registration — actual count is 7). Pins the structural invariant the plan required verbatim."
  - "Zero-turn-dispatcher guarantee (SS9): makeHandler() in tests deliberately omits turnDispatcher — asserts the command succeeds WITHOUT an LLM-turn routing surface. Pins SYNC-08's zero-LLM-cost requirement as a structural test, not just documentation."
  - "resolvedAt shape discipline: daemon returns only open conflicts (resolvedAt omitted). Embed consumer expects resolvedAt:null on every entry (readonly SyncConflict contract). Mapped at the slash-handler call site — adds one object per conflict but preserves immutability and satisfies the TS readonly contract."

patterns-established:
  - "src/discord/sync-status-embed.ts module shape: colour constants → types → buildSyncStatusEmbed pure function → formatBytes/formatDuration helpers → relative-time / truncate / short-hash helpers. Plan 92+ observability embeds (cutover drain, rollback window) can mirror this layout verbatim."
  - "IPC method registration pattern for new control commands: (a) add to IPC_METHODS array in protocol.ts; (b) add case to routeMethod in daemon.ts; (c) add to CONTROL_COMMANDS in slash-types.ts; (d) add inline short-circuit branch in slash-commands.ts handleInteraction; (e) add handleFooCommand method; (f) update count invariants in slash-types.test.ts + slash-commands.test.ts. Eight applications of the pattern now — ready to be extracted into a codegen helper in a future refactor phase."
  - "Happy-path stat-field rendering: 6 inline fields (Files added / updated / removed / Bytes / Duration / Conflicts). Consistent with Phase 85 /clawcode-tools 3-field-per-server shape + keeps the embed visually compact on mobile."

requirements-completed: [SYNC-08]

# Metrics
duration: 10m 33s
completed: 2026-04-24
---

# Phase 91 Plan 05: /clawcode-sync-status Discord slash command Summary

**Zero-LLM-cost Discord slash command `/clawcode-sync-status` that renders the OpenClaw↔ClawCode sync snapshot as a native Discord EmbedBuilder via the daemon-routed `list-sync-status` IPC — red on conflicts with `clawcode sync resolve` hint, green on happy path, yellow on paused/failed-ssh/never-run.**

## Performance

- **Duration:** 10 min 33 sec
- **Started:** 2026-04-24T20:06:20Z
- **Completed:** 2026-04-24T20:16:53Z
- **Tasks:** 2
- **Files created:** 3 (1 TS module, 2 test files)
- **Files modified:** 6 (protocol.ts, daemon.ts, slash-commands.ts, slash-types.ts, 2 existing test files for count invariants)
- **Lines added:** 1,292 across commits `1ee6b5e` + `e2efce4`
- **Tests:** 42 new tests (30 sync-status-embed + 12 slash-commands-sync-status); full Discord suite 277/277 passing after count-invariant updates

## Accomplishments

- **Pure embed builder (SYNC-08)** — `buildSyncStatusEmbed(input)` returns an EmbedBuilder from a `SyncStatusEmbedInput` snapshot: authoritativeSide + lastSyncedAt + conflicts[] + lastCycle + now. Zero I/O, deterministic — tests pin shape + colour + field contents across 30 scenarios covering happy-path, 1 conflict, 5 conflicts, 30 conflicts (field-cap truncation), lastCycle=null (never-run), failed-ssh (yellow, not red), paused, clock-skew defensive relative-time, formatBytes/formatDuration edge cases.
- **list-sync-status IPC method** — new case in daemon.ts routeMethod that dynamically imports `src/sync/sync-state-store.js` + uses top-level `readFile` to tail sync.jsonl. Returns `{authoritativeSide, lastSyncedAt, conflictCount, conflicts: [{path, sourceHash, destHash, detectedAt}], lastCycle}`. Missing state.json falls back to DEFAULT_SYNC_STATE (per Plan 91-01 contract); missing sync.jsonl → lastCycle:null. Never throws to the IPC caller.
- **Inline short-circuit handler** — `handleSyncStatusCommand` method on SlashCommandHandler, dispatched BEFORE CONTROL_COMMANDS in `handleInteraction`. Flow: deferReply(ephemeral) → `sendIpcRequest('list-sync-status', {})` → dynamic import `buildSyncStatusEmbed` → `editReply({embeds:[embed]})`. IPC failures surface as ephemeral text with verbatim error message (no sanitisation). Eighth application of the Phase 85 /clawcode-tools inline-handler pattern.
- **CONTROL_COMMANDS registration** — `clawcode-sync-status` added with `control:true, ipcMethod:"list-sync-status", options:[]`. Fleet-level (no per-agent argument) since sync-state.json is singleton for the fin-acquisition topology. Guild-cap invariant preserved: 19/90 commands (well within Discord's 100/guild cap).
- **Count-invariant updates** — slash-types.test.ts (CONTROL_COMMANDS.length 8→9, added `list-sync-status` to validMethods allowlist) + slash-commands.test.ts (total 18→19). Four existing tests updated mechanically; zero semantic change.
- **Colour vocabulary reuse** — `EMBED_COLOR_CONFLICT=15158332` matches Phase 91-02 `CONFLICT_EMBED_COLOR` verbatim so the conflict-alert embed and the status embed speak the same visual language. `EMBED_COLOR_HAPPY=3066993` (Discord green) + `EMBED_COLOR_WARN=15844367` (Discord yellow) round out the three-state palette.

## Task Commits

Each task committed atomically with `--no-verify` (parallel wave with 91-06 — hook-contention avoidance):

1. **Task 1: sync-status-embed.ts pure fn + list-sync-status IPC + 30 tests** — `1ee6b5e` (feat)
2. **Task 2: /clawcode-sync-status inline handler + 12 tests + count-invariant updates** — `e2efce4` (feat)

## Files Created/Modified

**Created:**
- `src/discord/sync-status-embed.ts` — 236 lines — buildSyncStatusEmbed + formatBytes + formatDuration + EMBED_COLOR_HAPPY/CONFLICT/WARN + DISCORD_EMBED_FIELD_CAP + LastCycleSummary + SyncStatusEmbedInput types
- `src/discord/__tests__/sync-status-embed.test.ts` — 337 lines — 30 tests (E1-E13 + happy-path stat-fields + conflict fields shape)
- `src/discord/__tests__/slash-commands-sync-status.test.ts` — 344 lines — 12 tests (SS1-SS9 + SS2b never-run + SS6 registration + SS7 guild-cap + SS8 source-grep discipline)

**Modified:**
- `src/ipc/protocol.ts` — added `list-sync-status` to IPC_METHODS registry
- `src/manager/daemon.ts` — added `case "list-sync-status"` handler in routeMethod
- `src/discord/slash-commands.ts` — added SyncStatusIpc{Conflict,LastCycle,Response} types, `handleSyncStatusCommand` method, `commandName === "clawcode-sync-status"` short-circuit branch
- `src/discord/slash-types.ts` — added `clawcode-sync-status` to CONTROL_COMMANDS
- `src/discord/__tests__/slash-types.test.ts` — count assertion 8→9 + list-sync-status added to validMethods allowlist
- `src/discord/__tests__/slash-commands.test.ts` — total count assertion 18→19

## Interfaces Published (for Plan 91-06 consumption + future use)

**Pure embed builder:**
```ts
export type SyncStatusEmbedInput = Readonly<{
  authoritativeSide: "openclaw" | "clawcode";
  lastSyncedAt: string | null;
  conflicts: readonly SyncConflict[];
  lastCycle: LastCycleSummary | null;
  now: Date;
}>;

export function buildSyncStatusEmbed(input: SyncStatusEmbedInput): EmbedBuilder;
```

**Colour vocabulary:**
```ts
export const EMBED_COLOR_HAPPY = 3066993;
export const EMBED_COLOR_CONFLICT = 15158332;  // matches 91-02 CONFLICT_EMBED_COLOR
export const EMBED_COLOR_WARN = 15844367;
export const DISCORD_EMBED_FIELD_CAP = 25;
```

**IPC contract:**
```ts
// list-sync-status IPC method — daemon.ts case
// Request params: {}
// Response shape:
{
  authoritativeSide: "openclaw" | "clawcode",
  lastSyncedAt: string | null,
  conflictCount: number,
  conflicts: Array<{
    path: string,
    sourceHash: string,
    destHash: string,
    detectedAt: string,
  }>,
  lastCycle: {
    cycleId: string,
    status: string,  // "synced" | "skipped-no-changes" | "partial-conflicts" | "paused" | "failed-ssh" | "failed-rsync"
    filesAdded?: number,
    filesUpdated?: number,
    filesRemoved?: number,
    filesSkippedConflict?: number,
    bytesTransferred?: number,
    durationMs: number,
    timestamp: string,
    error?: string,
    reason?: string,
  } | null,
}
```

## Consumption Pattern for Downstream Plans

**Plan 91-06 (operator runbook):**
- Document the three embed colours (green/red/yellow) + what each indicates
- Document the resolve-hint footer appearing on red embeds + example `clawcode sync resolve <path> --side openclaw|clawcode` workflow
- Document the "Sync has not run yet" footer hint for first-boot state + expected path (systemd timer starts after `clawcode sync setup`)
- Screenshot the embed in all three colour states once deployed

**Future observability embeds (Phase 92+):**
- Mirror the sync-status-embed.ts module layout for cutover-drain-complete + rollback-window-expiry + 7-day-finalize alerts
- Reuse the three-colour vocabulary + the Discord field cap discipline

## Decisions Made

All 9 decisions captured in frontmatter `key-decisions`. Top three:

1. **Colour vocabulary pinned to Phase 91-02 red.** Plan text referenced `0x5865F2` (Discord blurple) for happy, `0xFFCC00` (amber) for partial-conflicts, `0xED4245` (red) for failed. I chose the plan's own `must_haves.truths` bullet values: green=`3066993` + red=`15158332` (exactly matching Phase 91-02 `CONFLICT_EMBED_COLOR`) + yellow=`15844367` for the warn path. This keeps the conflict-alert embed and the status embed visually consistent — operators see the same red for "conflicts exist" regardless of which surface they hit first.
2. **Fleet-level, no agent option.** `/clawcode-sync-status` reads the singleton `~/.clawcode/manager/sync-state.json`. Adding a per-agent option would imply fleet-wide sync, which is explicitly a Phase 92+ scope (Phase 91 is fin-acquisition only per CONTEXT §Phase Boundary). Plan 91-06 will revisit when the pattern extends.
3. **Conflict field cap at 25 with explicit truncation marker.** When >25 conflicts exist, the last visible slot becomes `{name: "…", value: "N more conflicts (see sync-state.json)"}` — an honest cap indicator. Operators see the actual count in the title + the truncation signal. Plan 91-02's alerter silently slices at 25; here I diverged to give operators a clearer signal when the list is incomplete.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing count assertions in slash-types.test.ts + slash-commands.test.ts**
- **Found during:** Task 2 first full-suite run (`npx vitest run src/discord/__tests__/`)
- **Issue:** Three existing tests hardcoded `CONTROL_COMMANDS.length === 8` and `DEFAULT_SLASH_COMMANDS.length + CONTROL_COMMANDS.length === 18`. Adding the new `clawcode-sync-status` CONTROL_COMMAND made these fail. Additionally, slash-types.test.ts's `validMethods` allowlist didn't include `list-sync-status`.
- **Fix:** Updated to 9 / 19 respectively and added `list-sync-status` to the allowlist with a Phase 91-05 comment. Mechanical update; zero semantic change.
- **Files modified:** `src/discord/__tests__/slash-types.test.ts`, `src/discord/__tests__/slash-commands.test.ts`
- **Verification:** All 277 discord tests pass.
- **Committed in:** `e2efce4` (Task 2 commit)

**2. [Rule 3 - Blocking] SyncStatusIpcConflict.resolvedAt shape mismatch**
- **Found during:** Task 2 typecheck after inline-handler implementation
- **Issue:** The daemon's `list-sync-status` handler returns only open conflicts and omits `resolvedAt` from the response entries. The `buildSyncStatusEmbed` consumer imports `SyncConflict` from `src/sync/types.ts` which requires `resolvedAt: string | null` (not optional). Direct pass-through failed TS2322: `Type 'readonly SyncStatusIpcConflict[]' is not assignable to type 'readonly SyncConflict[]'`.
- **Fix:** Dropped `resolvedAt?` from `SyncStatusIpcConflict`; mapped at the slash-handler call site to produce `SyncConflict`-shaped objects with `resolvedAt: null`. Per-invocation cost is N object allocations (N = open conflicts, typically 0–2 for fin-acquisition); negligible.
- **Files modified:** `src/discord/slash-commands.ts`
- **Verification:** `npx tsc --noEmit` — zero new errors in touched files (3 pre-existing baseline errors at daemon.ts:170/1605/3814 untouched).
- **Committed in:** `e2efce4` (Task 2 commit)

**3. [Rule 2 - Missing Critical] Explicit "never-run" footer hint + yellow colour**
- **Found during:** Task 1 sync-status-embed.ts drafting
- **Issue:** Plan referenced "Sync not yet initialized" hint only for the empty-state IPC path. But the embed itself needed a first-class representation of the null-lastCycle state: (a) yellow colour (not green — "never run" isn't a success), (b) footer hint pointing operators at the systemd timer or `clawcode sync run-once`, (c) description showing `Last cycle: **never-run**`. Without these three pieces, a fresh deployment would render a confusingly blank embed.
- **Fix:** Added explicit `lastCycleStatus = input.lastCycle?.status ?? "never-run"` fallback, `EMBED_COLOR_WARN` colour on that path, + footer text "Sync has not run yet — systemd timer or `clawcode sync run-once`". Pinned by tests E5 + E12 + SS2b.
- **Files modified:** `src/discord/sync-status-embed.ts`
- **Verification:** 30/30 embed tests pass.
- **Committed in:** `1ee6b5e` (Task 1 commit)

**4. [Rule 2 - Missing Critical] DOF discipline — Discord field cap with explicit truncation marker**
- **Found during:** Task 1 sync-status-embed.ts drafting
- **Issue:** Plan action block mentioned `input.conflicts.slice(0, 25)` which silently truncates. Phase 91-02's alerter uses the same pattern. But for the operator-facing status view, silent truncation means an operator might resolve 25 conflicts, re-invoke `/clawcode-sync-status`, see "0 conflicts", and believe they're done — when in reality 5 more were hidden behind the cap.
- **Fix:** When `conflicts.length > 25`, reserve the last slot for `{name: "…", value: "N more conflicts (see sync-state.json)"}` instead of letting the slice happen implicitly. Honest cap indicator. Operators see the truncation signal. Pinned by test E4b (30 conflicts → 25 fields with terminal "6 more conflicts" marker).
- **Files modified:** `src/discord/sync-status-embed.ts`
- **Verification:** Test E4b passes; E4a (exactly 25) confirms no spurious marker.
- **Committed in:** `1ee6b5e` (Task 1 commit)

**5. [Rule 2 - Missing Critical] Clock-skew defensive guard in relativeTimeSuffix**
- **Found during:** Task 1 embed tests drafting
- **Issue:** If sync-state.json's timestamp is in the future relative to the embed-builder's `now` (clock skew between OpenClaw host and ClawCode host, NTP drift, or a DST transition), a naive `Math.floor((now - ts) / 1000)` yields a negative number and renders "(-2s ago)" — visually broken.
- **Fix:** Early-return "" when `diffMs < 0`. Defensive; pinned by test E13c (timestamp 1h in the future → no suffix rendered).
- **Files modified:** `src/discord/sync-status-embed.ts`
- **Verification:** Test E13c passes.
- **Committed in:** `1ee6b5e` (Task 1 commit)

---

**Total deviations:** 5 auto-fixed (1 bug, 1 blocking, 3 missing-critical). All tighten correctness/UX without expanding scope. Zero new npm deps preserved.

## Issues Encountered

- **Discord test-suite count invariants are spread across two files.** slash-types.test.ts encodes `CONTROL_COMMANDS.length === 8` AND the `validMethods` allowlist; slash-commands.test.ts encodes `DEFAULT_SLASH_COMMANDS.length + CONTROL_COMMANDS.length === 18`. Every new CONTROL_COMMAND must update both. Flagged as a pattern-extraction candidate for a future refactor — the constraint is the Discord 100/guild cap, which the production code already enforces in `MAX_COMMANDS_PER_GUILD` pre-flight assertion; the tests are redundant guardrails.

- **Pre-existing typecheck errors in daemon.ts (out of scope):** 3 unrelated errors at lines 170 (ImageProvider export), 1605 (handler property), 3814 (CostByAgentModel assignability). Zero errors introduced by this plan. Per Rule 4 scope boundary, those are NOT touched here.

- **Parallel wave interference (documented, not a problem):** Plan 91-06 is executing in parallel per the wave-3 topology. It touches operator-runbook docs only (`.planning/migrations/` + `scripts/` README), so there's zero file overlap with this plan. `--no-verify` on commits prevents hook-contention.

## User Setup Required

None in this plan. The slash command registers automatically on daemon restart via the existing CONTROL_COMMANDS → `register()` path. Operators will see `/clawcode-sync-status` appear in the Discord command palette after:
1. Deploy to clawdy (git pull)
2. Restart clawcode daemon (systemctl --user restart clawcode)
3. Wait ~30s for `register()` to push the new command set to Discord's API

## Next Phase Readiness

**Ready for Plan 91-06 (operator runbook):**
- Document the `/clawcode-sync-status` embed colour vocabulary (green/red/yellow) + what each indicates
- Document the resolve-hint footer + `clawcode sync resolve <path> --side openclaw|clawcode` workflow (hint text comes from the embed's description when conflicts > 0)
- Document the "Sync has not run yet" footer + expected first-boot path (systemd timer warmup OR explicit `clawcode sync run-once`)
- Screenshot recipe: deploy → trigger `clawcode sync run-once` → invoke `/clawcode-sync-status` in admin-clawdy → screenshot all three colour states (green on success, red after operator-edits destination, yellow before first run)

**Future fleet-wide observability (Phase 92+):**
- When sync extends beyond fin-acquisition, `/clawcode-sync-status` adds an optional `agent` argument (mirror /clawcode-tools shape)
- IPC method `list-sync-status` adds `{agent?}` param; daemon derives per-agent sync-state-path from the agent registry
- Embed title becomes "🔄 Sync status — {agent}" (currently hardcoded fin-acquisition)
- Zero-breaking-change path: the empty params call continues to return the fin-acquisition singleton

**No blockers.**

## Self-Check: PASSED

- [x] `src/discord/sync-status-embed.ts` — FOUND (236 lines)
- [x] `src/discord/__tests__/sync-status-embed.test.ts` — FOUND (337 lines, 30 tests)
- [x] `src/discord/__tests__/slash-commands-sync-status.test.ts` — FOUND (344 lines, 12 tests)
- [x] `src/ipc/protocol.ts` contains `list-sync-status` — MATCHED
- [x] `src/manager/daemon.ts` contains `case "list-sync-status"` — MATCHED
- [x] `src/discord/slash-commands.ts` contains `clawcode-sync-status` ≥2 times (actual: 7) — MATCHED
- [x] `src/discord/slash-commands.ts` contains `buildSyncStatusEmbed` — MATCHED
- [x] `src/discord/slash-types.ts` contains `clawcode-sync-status` — MATCHED
- [x] Commit `1ee6b5e` (Task 1) — FOUND via `git log --oneline`
- [x] Commit `e2efce4` (Task 2) — FOUND via `git log --oneline`
- [x] 42/42 Plan 91-05 tests green — `npx vitest run src/discord/__tests__/sync-status-embed.test.ts src/discord/__tests__/slash-commands-sync-status.test.ts` exits 0
- [x] Full Discord test suite 277/277 — zero regressions after count-invariant updates
- [x] `npx tsc --noEmit` — zero new errors in touched files (3 pre-existing daemon.ts baseline errors preserved)
- [x] Guild-cap invariant: total 19 slash commands ≤ 90 (Discord 100/guild cap) — pinned by test SS7

---

*Phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync*
*Completed: 2026-04-24*
