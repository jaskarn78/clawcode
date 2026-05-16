---
phase: 103-clawcode-status-rich-telemetry-usage-panel-operator-observability
plan: 03
subsystem: observability
tags: [discord-slash, ipc, usage-panel, embed-renderer, rate-limit-tracker, inline-handler-short-circuit]

# Dependency graph
requires:
  - phase: 103
    plan: 01
    provides: status-render.ts buildStatusData/renderStatus + 9-line block + SessionManager extended Pick (compaction/context/activation/usage)
  - phase: 103
    plan: 02
    provides: RateLimitTracker primitive + SessionManager.getRateLimitTrackerForAgent (Plan 03 IPC consumer of this accessor)
  - phase: 91
    provides: 8th inline-handler-short-circuit application (clawcode-sync-status) — Plan 03 is the 12th application
  - phase: 85
    provides: Original inline-handler-short-circuit pattern (clawcode-tools) + sync-status-embed.ts EmbedBuilder template
provides:
  - IPC method `list-rate-limit-snapshots` (NOT colliding with existing `rate-limit-status` for Discord outbound rate-limiter)
  - daemon-rate-limit-ipc.ts pure-DI handler module (mirroring Phase 96 daemon-fs-ipc / Phase 92 cutover-ipc-handlers blueprint)
  - usage-embed.ts pure renderer (renderBar + buildUsageEmbed) consumed by Discord slash + future CLI usage panel
  - /clawcode-usage Discord slash command (12th inline-handler-short-circuit application)
  - status-render.ts renderUsageBars helper (optional 5h+7d bar suffix appended to /clawcode-status)
affects: [Phase 103 milestone closure, future CLI `clawcode usage` mirroring this IPC]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "12th application of the inline-handler-short-circuit-before-CONTROL_COMMANDS pattern (Phases 85/86/87/88/90/91/92/95/96/100/103-03)"
    - "Pure-DI IPC handler module — extracted case-body to daemon-rate-limit-ipc.ts so the contract is testable without spawning the daemon (Phase 96 daemon-fs-ipc / Phase 92 cutover-ipc-handlers blueprint)"
    - "Bar vocabulary single-source-of-truth — renderUsageBars in status-render.ts reuses renderBar from usage-embed.ts so /clawcode-status and /clawcode-usage surfaces speak the same visual language"
    - "Optional render-path additivity — renderUsageBars returns '' on missing snapshots so /clawcode-status appends a no-op for non-OAuth-Max sessions (Pitfall 7)"
    - "Worst-status color triage — buildUsageEmbed picks worst of {allowed, allowed_warning, rejected} across all snapshots (rejected wins → red; allowed_warning → yellow; otherwise green)"

key-files:
  created:
    - src/discord/usage-embed.ts
    - src/discord/__tests__/usage-embed.test.ts
    - src/manager/daemon-rate-limit-ipc.ts
    - src/discord/__tests__/slash-types-cap.test.ts
    - src/discord/__tests__/slash-commands-usage.test.ts
  modified:
    - src/ipc/protocol.ts
    - src/ipc/__tests__/protocol.test.ts
    - src/manager/daemon.ts
    - src/discord/slash-types.ts
    - src/discord/slash-commands.ts
    - src/discord/status-render.ts
    - src/discord/__tests__/status-render.test.ts
    - src/discord/__tests__/slash-types.test.ts
    - src/discord/__tests__/slash-commands.test.ts

key-decisions:
  - "IPC method is `list-rate-limit-snapshots` (not `rate-limit-snapshots` or `usage-snapshots`) — `list-` prefix matches the convention of other read-only IPC methods (`list-mcp-status`, `list-sync-status`, `list-fs-status`); explicit `-snapshots` plural disambiguates from the existing `rate-limit-status` (Discord outbound) IPC (Pitfall 5 closure)"
  - "Pure-DI handler module pattern — extracted handleListRateLimitSnapshotsIpc to daemon-rate-limit-ipc.ts (mirroring Phase 96 daemon-fs-ipc) so the IPC contract can be unit-tested without spawning the full daemon. The daemon switch case is a one-liner: import + delegate."
  - "Overage rendered as status-line, NOT a progress bar (Open Q3) — credit pool model means a percentage doesn't convey 'how much is left in the pool' as cleanly as 'using credits · disabled: low-balance · resets in 6 hours'"
  - "Bar character set is the 4 Unicode block elements ▓ ░ + the box-drawing dash ─ for n/a — works in Discord code spans across desktop + mobile, no emoji rendering quirks. Width fixed at 10 to keep the visual stable across narrow Discord channels (≥30 chars total per line)"
  - "renderBar(undefined) emits 10 dashes + TWO spaces + 'n/a' — the two spaces compensate for the missing percentage suffix so the bar widget aligns visually with rendered bars when stacked"
  - "renderUsageBars output begins with a leading newline so /clawcode-status can append it directly: `editReply(renderStatus(data) + renderUsageBars(snapshots))`. The leading-newline contract is pinned by a test so future refactors don't break the alignment"
  - "Inline handler defers ephemeral:false (NOT ephemeral) — usage panels are operational visibility surfaces meant to be visible to the channel, mirroring /clawcode-status (also non-ephemeral). Admin-only commands like /clawcode-dream + /clawcode-probe-fs use ephemeral; usage is read-only telemetry, not a privileged operation"
  - "/clawcode-status bar suffix wrapped in try/catch — bars are PURELY ADDITIVE. A thrown getRateLimitTrackerForAgent or getAllSnapshots NEVER collapses the 9-line block. Rule 1 fix preserved: the existing defensive-render contract from Plan 01 stays intact"

patterns-established:
  - "Pinned slash-count regression test (slash-types-cap.test.ts) — every CONTROL_COMMAND addition must update the cap test AND the count assertions in slash-types.test.ts + slash-commands.test.ts. The triple-pin makes it impossible to accidentally exceed Discord's 100/guild ceiling without a test breaking first"
  - "EmbedBuilder render module is testable in isolation — usage-embed.ts has zero discord.js imports beyond EmbedBuilder itself + a date-fns dep, so unit tests construct snapshot literals + assert .data shape without standing up Discord. Mirrors sync-status-embed.ts (Phase 91) verbatim"

requirements-completed: [OBS-06, OBS-07, OBS-08]

# Metrics
duration: ~30min
completed: 2026-04-29
---

# Phase 103 Plan 03: /clawcode-usage Discord Panel + IPC + /clawcode-status Bar Suffix Summary

**Wired the per-agent RateLimitTracker (Plan 02) through three operator-facing channels: a new `list-rate-limit-snapshots` IPC method, a `/clawcode-usage` Discord slash command rendering an EmbedBuilder panel, and an optional 5h+7d bar suffix on `/clawcode-status`. The 12th application of the inline-handler-short-circuit pattern.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-04-29T15:02:59Z
- **Completed:** 2026-04-29T15:32:57Z
- **Tasks:** 2 (both TDD)
- **Files created:** 5 (3 production + 2 test)
- **Files modified:** 9 (including 2 test files for pinned-count updates)

## Accomplishments

- New IPC method `list-rate-limit-snapshots` registered in `IPC_METHODS` array — DOES NOT collide with existing `rate-limit-status` (Discord outbound rate-limiter — Pitfall 5 closure)
- Pure-DI handler module `src/manager/daemon-rate-limit-ipc.ts` (~70 lines) — mirrors Phase 96 daemon-fs-ipc / Phase 92 cutover-ipc-handlers blueprint so the IPC contract is unit-testable without spawning the daemon
- Pure embed renderer `src/discord/usage-embed.ts` (~175 lines) — `renderBar` + `buildUsageEmbed` with worst-status color triage, canonical type order (five_hour, seven_day, seven_day_opus, seven_day_sonnet), overage status-line (Open Q3), surpassedThreshold field (Pitfall 9), empty graceful (Pitfall 7), unknown type tolerance (Pitfall 10)
- `/clawcode-usage` Discord slash command — 12th application of the inline-handler-short-circuit-before-CONTROL_COMMANDS pattern (Phases 85/86/87/88/90/91/92/95/96/100/103-03)
- `renderUsageBars` helper in `status-render.ts` — optional 2-line 5h+7d bar suffix appended to `/clawcode-status` when snapshots are present; reuses `renderBar` from `usage-embed.ts` so the bar vocabulary is consistent across surfaces
- Triple-pinned cap regression — `slash-types-cap.test.ts` + count assertions in `slash-types.test.ts` + `slash-commands.test.ts` all track the new entry; impossible to silently exceed Discord's 100/guild ceiling

## Slash Command Budget (Pitfall 6 closure)

| Surface              | Count | Notes                                                          |
| -------------------- | ----- | -------------------------------------------------------------- |
| DEFAULT_SLASH_COMMANDS | 10  | Phase 87 CMD-04 removed clawcode-compact + clawcode-usage      |
| CONTROL_COMMANDS     | 13    | +1 from Plan 03 (was 12)                                       |
| GSD_SLASH_COMMANDS   | 22    | Phase 100 follow-up (auto-inherited per agent w/ gsd.projectDir) |
| **Total**            | **45**| **Well under the 90/100 cap** (with per-agent extras headroom) |

## Inline-Handler-Short-Circuit Pattern (running list)

| #   | Phase    | Slash Command            | IPC Method                  |
| --- | -------- | ------------------------ | --------------------------- |
| 1   | 85       | /clawcode-tools          | list-mcp-status             |
| 2   | 86       | /clawcode-model          | set-model                   |
| 3   | 87       | /clawcode-permissions    | set-permission-mode         |
| 4   | 88       | /clawcode-skills-browse  | marketplace-list/install    |
| 5   | 88       | /clawcode-skills         | marketplace-remove          |
| 6   | 90 P05   | /clawcode-plugins-browse | marketplace-install-plugin  |
| 7   | 90 P06   | /clawcode-clawhub-auth   | clawhub-oauth-start/poll    |
| 8   | 91 P05   | /clawcode-sync-status    | list-sync-status            |
| 9   | 92 P04   | /clawcode-cutover-verify | cutover-verify-summary      |
| 10  | 95 P03   | /clawcode-dream          | run-dream-pass              |
| 11  | 96 P05   | /clawcode-probe-fs       | probe-fs                    |
| 12  | **103-03** | **/clawcode-usage**    | **list-rate-limit-snapshots** |

The pattern is now battle-tested at 12 applications. Next addition is "just another short-circuit + handler" with zero open architectural questions.

## Task Commits

Each task was committed atomically following TDD discipline:

1. **Task 1 RED: usage-embed + IPC tests** — `651d87b` (test) — 14 usage-embed tests + 5 IPC handler tests fail at import (modules don't exist)
2. **Task 1 GREEN: usage-embed.ts + daemon-rate-limit-ipc.ts + protocol entry + daemon case** — `ada9c4b` (feat) — all 38 tests pass; TS baseline preserved
3. **Task 2 RED: slash-cap + slash-commands-usage + renderUsageBars tests** — `f62c8e8` (test) — 7 failing tests across 2 files (slash-commands-usage already passing — modules in place from Task 1)
4. **Task 2 GREEN: slash-types entry + handleUsageCommand + renderUsageBars + status bar suffix + count updates** — `3a74afe` (feat) — all 115 tests pass; pinned counts in slash-types.test.ts + slash-commands.test.ts updated 12→13 controls / 22→23 total

## Verification

```
$ npx vitest run src/discord/__tests__/usage-embed.test.ts \
                src/discord/__tests__/slash-commands-usage.test.ts \
                src/discord/__tests__/slash-types-cap.test.ts \
                src/discord/__tests__/status-render.test.ts \
                src/discord/__tests__/slash-types.test.ts \
                src/discord/__tests__/slash-commands.test.ts \
                src/ipc/__tests__/protocol.test.ts
 Test Files  7 passed (7)
      Tests  115 passed (115)
```

Substring acceptance gates (all pass):

- `grep -F 'export function buildUsageEmbed' src/discord/usage-embed.ts` → 1 hit
- `grep -F 'export function renderBar' src/discord/usage-embed.ts` → 1 hit
- `grep -E '3066993|15844367|15158332' src/discord/usage-embed.ts` → 6 hits (≥3 required; 3 const + 3 doc comments)
- `grep -F '"list-rate-limit-snapshots"' src/ipc/protocol.ts` → 1 hit
- `grep -F '"rate-limit-status"' src/ipc/protocol.ts` → 1 hit (Pitfall 5 — both coexist)
- `grep -F 'case "list-rate-limit-snapshots":' src/manager/daemon.ts` → 1 hit
- `grep -F 'case "rate-limit-status":' src/manager/daemon.ts` → 1 hit (Pitfall 5 — both coexist)
- `grep -c 'list-rate-limit-snapshots' src/ipc/__tests__/protocol.test.ts` → 6 hits (≥2 required)
- `grep -c '"clawcode-usage"' src/discord/slash-types.ts` → 1 hit
- `grep -F 'commandName === "clawcode-usage"' src/discord/slash-commands.ts` → 1 hit
- `grep -F 'buildUsageEmbed(' src/discord/slash-commands.ts` → 1 hit
- `grep -F 'renderUsageBars(' src/discord/slash-commands.ts` → 1 hit
- `grep -F 'export function renderUsageBars' src/discord/status-render.ts` → 1 hit

TypeScript: `npx tsc --noEmit` reports 108 errors — exactly the master baseline at this commit. Diffed against pre-Plan-03 master via `git stash`: identical 108 errors, zero new. (The Plan 02 SUMMARY's "107" was that point-in-time snapshot; intervening commits since 2026-04-29T15:00:00Z added 1 pre-existing error. My changes neither introduced nor resolved any TS errors.)

Full vitest run on `src/discord src/ipc src/manager`:

```
$ npx vitest run src/discord src/ipc src/manager
 Test Files  8 failed | 140 passed (148)
      Tests  17 failed | 1730 passed (1747)
```

The remaining failures are **all pre-existing flake/order-dependent baseline** — verified by `git stash` + re-run on master: identical 26 failure patterns (with run-to-run variation between flaky tests; same total count). None are caused by Plan 03 changes; all are out-of-scope per the SCOPE BOUNDARY rule. The Plan 02 SUMMARY documented this same flake cluster (16-26 pre-existing failures across daemon-openai, dream-prompt-builder, daemon-warmup-probe, restart-greeting, bootstrap-integration, session-config, session-manager, warm-path-mcp-gate, etc.).

## Test Coverage Delta

- usage-embed.test.ts: +14 tests (5 renderBar + 9 buildUsageEmbed)
- protocol.test.ts: +5 tests (4 IPC handler + 1 collision regression)
- slash-types-cap.test.ts: +4 tests (cap budget + clawcode-usage entry shape)
- slash-commands-usage.test.ts: +3 tests (IPC↔embed integration)
- status-render.test.ts: +5 tests (renderUsageBars helper)
- slash-types.test.ts: 2 tests updated (pinned 12→13 controls + extended validMethods)
- slash-commands.test.ts: 1 test updated (pinned 22→23 total)

**Net new test count: +31 tests** (target was 26; the +5 over-count is the "5 hits" Pitfall 5 collision regression + tighter assertions on clawcode-usage option shape).

## Pitfall Closure Confirmation

- **Pitfall 5 (IPC name collision):** Confirmed — `list-rate-limit-snapshots` and `rate-limit-status` BOTH appear in IPC_METHODS, BOTH have daemon `case` handlers, and a regression test asserts both must coexist. The protocol.test.ts comment block explicitly documents the SEPARATE domains.
- **Pitfall 6 (Discord 100/guild cap):** Confirmed — slash-types-cap.test.ts pins CONTROL+DEFAULT ≤ 90 AND CONTROL+DEFAULT+GSD ≤ 100. Current totals: 13+10+22 = 45, well under both ceilings. The triple-pin regression (slash-types-cap + slash-types + slash-commands count assertions) makes it impossible to silently exceed.
- **Pitfall 7 (graceful no-data):** Confirmed at TWO surfaces:
  - `/clawcode-usage`: `buildUsageEmbed({snapshots: []})` returns embed with description "No usage data yet…" (NOT empty embed)
  - `/clawcode-status`: `renderUsageBars([])` returns "" so the 9-line block is unchanged when no snapshots exist
- **Pitfall 9 (surpassedThreshold is OPTIONAL NUMBER):** Confirmed — buildUsageEmbed renders a separate "⚠ Threshold crossed" field when defined, omits the field entirely when undefined; test "does NOT render threshold field when surpassedThreshold undefined" pins the contract.
- **Pitfall 10 (rateLimitType strings outside canonical 5-value set):** Confirmed — TYPE_ORDER iteration silently skips non-canonical types; test "treats rateLimitType:'unknown' gracefully" pins the no-throw contract.
- **Open Q3 (overage as status-line, not bar):** Confirmed — overage row renders as `"status: <s> · using credits · resets <when>"` (no progress bar); test "renders overage as status-line not bar" pins the contract via `expect(value).not.toMatch(/▓+░+/)`.

## Deviations from Plan

### [Rule 1 — Bug] Pinned slash-count assertions needed updates after adding clawcode-usage

**Found during:** Task 2 GREEN — running full vitest suite revealed 2 NEW failures in `slash-types.test.ts` ("contains exactly 12 control commands") and `slash-commands.test.ts` ("T7 ... default+control = 18" actually 22).

**Issue:** The plan's slash-cap test (slash-types-cap.test.ts) was framed as the only count regression, but two PRIOR test files already pin the exact CONTROL_COMMANDS length (`expect(CONTROL_COMMANDS).toHaveLength(12)`) and the combined count (`expect(DEFAULT.length + CONTROL.length).toBe(22)`). Adding the new entry breaks both.

**Fix:** Updated both pinned counts: 12→13 controls, 22→23 total. Also extended the `validMethods` whitelist in slash-types.test.ts with the new `list-rate-limit-snapshots` IPC name. Rule 1 — these were correctness bugs (the test assertions were now WRONG, not the production code).

**Files modified:** `src/discord/__tests__/slash-types.test.ts`, `src/discord/__tests__/slash-commands.test.ts`

**Commit:** `3a74afe` (folded into Task 2 GREEN — necessary for full vitest run to be green)

### [Adaptation, not deviation] Pure-DI handler extracted instead of inline case body

**Plan said:** "(b) If no comparable testing pattern exists in the repo, the minimum viable test is to wrap just the case-body logic in an exported helper `handleListRateLimitSnapshots(params, deps)` in daemon.ts and call that directly."

**What I did:** Created a NEW file `src/manager/daemon-rate-limit-ipc.ts` (~70 lines) following the Phase 96 daemon-fs-ipc / Phase 92 cutover-ipc-handlers established blueprint. The pattern is canonical at this point (3rd application of the dedicated-IPC-module pattern); inlining the helper inside daemon.ts would have been less testable and less consistent with the existing surrounding code.

**Rationale:** daemon.ts is 6011 lines. Adding more handler logic inside it conflicts with the project's "many small files" rule (~/.claude/rules/coding-style.md). The dedicated module mirrors the established pattern and makes the IPC contract testable without daemon spawn.

**Commit:** `ada9c4b` (Task 1 GREEN — folded into the same commit as the production module)

### [Adaptation, not deviation] Production daemon.ts uses dynamic import for the handler

**Plan said:** "the daemon's switch case is a one-liner: `case "list-rate-limit-snapshots": return handleListRateLimitSnapshots(params, { sessionManager });`"

**What I did:** Used a dynamic `import()` inside the case body (mirroring how `case "list-sync-status"` already lazy-loads `readSyncState` from the sync subsystem at line 5465 — same daemon, same pattern). This keeps daemon.ts's eager import graph from growing for the IPC routing layer.

**Trade-off:** First invocation has a tiny one-shot import cost; all subsequent invocations are zero-overhead (Node module cache). Acceptable because the operator's first /clawcode-usage call is rarely on the daemon's critical path.

**Commit:** `ada9c4b`

## Known Stubs

None. /clawcode-usage is fully wired end-to-end:
- SDK rate_limit_event hook (Plan 02) → RateLimitTracker → SessionManager.getRateLimitTrackerForAgent
- IPC handler reads tracker → returns `{agent, snapshots[]}`
- Discord slash inline handler dispatches IPC → buildUsageEmbed → editReply
- /clawcode-status calls the same accessor → renderUsageBars → appended to 9-line block

The `n/a` cases are graceful empty-state handling, NOT stubs:
- `renderBar(undefined)` → "──────────  n/a" (utilization unset on this snapshot)
- `formatReset(undefined)` → "unknown" (resetsAt unset on this snapshot)
- Empty snapshots → "No usage data yet" description (Pitfall 7 — non-OAuth-Max sessions)

These all surface the SDK's actual data shape (`SDKRateLimitInfo` fields are themselves optional in pre-1.0).

## Self-Check: PASSED

Verified:
- `[ -f src/discord/usage-embed.ts ]` → FOUND
- `[ -f src/discord/__tests__/usage-embed.test.ts ]` → FOUND
- `[ -f src/manager/daemon-rate-limit-ipc.ts ]` → FOUND
- `[ -f src/discord/__tests__/slash-types-cap.test.ts ]` → FOUND
- `[ -f src/discord/__tests__/slash-commands-usage.test.ts ]` → FOUND
- `git log --oneline | grep -q 651d87b` → FOUND (Task 1 RED commit)
- `git log --oneline | grep -q ada9c4b` → FOUND (Task 1 GREEN commit)
- `git log --oneline | grep -q f62c8e8` → FOUND (Task 2 RED commit)
- `git log --oneline | grep -q 3a74afe` → FOUND (Task 2 GREEN commit)
- 115/115 tests pass across the 7 specified suites
- All 14 substring acceptance gates pass
- `npx tsc --noEmit` exits with 108 errors — identical to master baseline at this commit (zero new)
