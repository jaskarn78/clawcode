---
phase: 56-warm-path-optimizations
plan: 02
subsystem: manager+cli+discord+dashboard
tags: [warm-path, ready-gate, session-manager, registry, ipc, cli, discord, dashboard, server-emit]

# Dependency graph
requires:
  - phase: 56-warm-path-optimizations
    plan: 01
    provides: "runWarmPathCheck + WARM_PATH_TIMEOUT_MS + AgentMemoryManager.warmSqliteStores + optional RegistryEntry warm_path_* fields"
  - phase: 50-latency-instrumentation
    provides: "caller-owned Turn invariant (no turn.end in session-manager) — preserved"
  - phase: 54-streaming-typing-indicator
    provides: "server-emit pattern discipline — dashboard reads server fields verbatim"
provides:
  - "SessionManager.startAgent awaits runWarmPathCheck before flipping status='running'"
  - "Single atomic registry write on warm-path success (status + warm_path_ready + warm_path_readiness_ms)"
  - "Warm-path failure path: status='failed' with lastError='warm-path: <errors>'; daemon continues"
  - "CLI formatWarmPath() + WARM-PATH column in formatStatusTable (conditional)"
  - "buildFleetEmbed warm-path suffix for Discord /clawcode-fleet"
  - "Dashboard .warm-path-badge rendered from server-emitted fields only"
affects: [57-future-warmup-telemetry]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-emit ready gate — SessionManager blocks on composite readiness BEFORE marking 'running'; registry is the single source of truth for every operator surface"
    - "Registry passthrough IPC — 'case status' returns registry.entries verbatim; optional warm-path fields flow through JSON.stringify with no daemon-side computation"
    - "Conditional column rendering — CLI table adds WARM-PATH only when ≥1 entry has readiness_ms; backward-compat preserved for legacy registries"
    - "Zero-threshold dashboard client — renderWarmPathBadge reads warm_path_ready + warm_path_readiness_ms directly; no timeout/threshold constants in app.js"

key-files:
  created: []
  modified:
    - src/manager/session-manager.ts (warm-path gate in startAgent + warm-path import)
    - src/manager/__tests__/session-manager.test.ts (+7 warm-path tests, vi.mock hoisting + global beforeEach default)
    - src/cli/commands/status.ts (formatWarmPath + WARM-PATH column wiring)
    - src/cli/commands/__tests__/status.test.ts (+7 tests: 4 formatWarmPath + 3 formatStatusTable column)
    - src/discord/slash-commands.ts (buildFleetEmbed warm-path suffix)
    - src/discord/__tests__/slash-commands.test.ts (+4 warm-path tests)
    - src/dashboard/types.ts (AgentStatusData extended with warm-path fields)
    - src/dashboard/sse.ts (passthrough of warm_path_ready + warm_path_readiness_ms)
    - src/dashboard/static/app.js (renderWarmPathBadge + render-hash update + createAgentCard wiring)
    - src/dashboard/static/styles.css (.warm-path-badge + 4 state variants)
    - src/dashboard/__tests__/server.test.ts (+2 /api/status passthrough tests)

key-decisions:
  - "Session handle cleanup on warm-path failure — call handle.close() (wrapped in try/catch) instead of delegating to recovery. Rationale: the session was created by adapter but never declared 'running' — we want a graceful adapter-side shutdown so mocks clean up their map, and production adapters tear down the subprocess."
  - "Session probe verifies handle.sessionId post-createSession — sessionProbe throws with message 'session handle not ready' if the handle is missing or empty. Keeps the three warm-path steps symmetric (sqlite / embedder / session) without adding an out-of-band probe path."
  - "vi.mock of warm-path-check at module top + global beforeEach default — the mock is hoisted and applies to every describe in session-manager.test.ts. A top-level beforeEach sets mockResolvedValue(<ready>) so the 13 pre-Phase-56 tests never see an undefined warmResult. Individual failure tests use mockResolvedValueOnce."
  - "Conditional WARM-PATH column — rendered only when ≥1 entry has readiness_ms. This preserves existing output for the 6 pre-existing status.test.ts assertions and matches the Phase 55 'append-don't-reshape' precedent."
  - "Discord suffix uses the dot separator (\\u00B7) to match the rest of the field value template — keeps the line visually consistent with status/model/uptime/last dividers."
  - "Dashboard render-hash now includes warm_path_ready + warm_path_readiness_ms — without this, the existing flicker-prevention hash would skip re-rendering when the server flips ready state."

patterns-established:
  - "Server-emit ready surfaces — once the registry carries the truth, CLI + Discord + dashboard each render that truth verbatim with ZERO cross-surface coordination. Tested by grep: `grep -cE 'WARM_PATH_TIMEOUT|10000|10_000' src/dashboard/static/app.js` returns 0."
  - "Atomic registry write on gate success — readRegistry → updateEntry(..., status:'running' + warm_path_ready:true + warm_path_readiness_ms:<n>) → writeRegistry. No intermediate 'running without warm-path' state ever visible."
  - "Session cleanup on gate failure — sessions.delete(name) + recovery.clearStabilityTimer(name) + handle.close() (try/catch). No leaked stability timer, no leaked subprocess."

requirements-completed: [WARM-01, WARM-02, WARM-04]

# Metrics
duration: 7min
completed: 2026-04-14
---

# Phase 56 Plan 02: Warm-Path Ready Gate + Fleet Surfaces Summary

**SessionManager.startAgent now blocks on `runWarmPathCheck` before flipping the registry to `status: 'running'`. The warm-path readiness state surfaces through CLI `clawcode status` (WARM-PATH column), Discord `/clawcode-fleet` embed (appended suffix), and the web dashboard per-agent card (badge) — all driven by the server-emit pattern, zero client-side threshold logic, and without adding a new IPC method.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-14T09:22:00Z
- **Completed:** 2026-04-14T09:30:00Z
- **Tasks:** 2
- **Files modified:** 11
- **Commits:** 2

## Accomplishments

- `SessionManager.startAgent` awaits `runWarmPathCheck` (10s timeout) BEFORE writing `status: 'running'` — registry remains `'starting'` until the check resolves.
- On warm-path success: a single atomic `updateEntry(..., status:'running', sessionId, startedAt, warm_path_ready:true, warm_path_readiness_ms)` write — no intermediate visible state.
- On warm-path failure (ready === false or timeout): `status:'failed'`, `lastError:'warm-path: <errors joined>'`, session map cleared, stability timer cleared, handle closed. Daemon continues starting other agents.
- Structured log line `warm-path ready — agent started` emits `agent + sessionId + total_ms + durations_ms` breakdown on success; `warm-path check failed — agent marked failed` on failure.
- IPC `case "status"` handler UNCHANGED — `registry.entries` already carries the new optional fields, so `JSON.stringify` passes them through automatically. IPC_METHODS array UNCHANGED (Phase 50 regression lesson preserved).
- CLI `formatWarmPath()` exported helper + conditional WARM-PATH column in `formatStatusTable`. Cyan `ready Xms` / yellow `starting` / red `error: <msg>` / gray em-dash legacy.
- Discord `buildFleetEmbed` field value appends ` · warm 127ms` / ` · warming` / ` · warm-path error`; legacy entries get no suffix.
- Dashboard `AgentStatusData` + `sse.ts` passthrough extended. New `renderWarmPathBadge()` in `app.js` reads server fields verbatim. CSS badge with 4 state variants (warm / warming / cold / unknown). Render-hash updated so the badge refreshes when server flips state.

## Task Commits

1. **Task 1: Wire runWarmPathCheck into startAgent as blocking ready gate** — `221a425` (feat — TDD RED→GREEN, +7 tests)
2. **Task 2: Extend status IPC result + CLI + Discord + dashboard** — `134edb0` (feat — TDD RED→GREEN, +13 tests)

## Test Counts

| File | Phase-56 Tests | Total Tests | Status |
|------|----------------|-------------|--------|
| `src/manager/__tests__/session-manager.test.ts` | +7 | 20 | all GREEN |
| `src/cli/commands/__tests__/status.test.ts` | +7 | 17 | all GREEN |
| `src/discord/__tests__/slash-commands.test.ts` | +4 | 19 | all GREEN |
| `src/dashboard/__tests__/server.test.ts` | +2 | 19 (relevant subset) | all GREEN |

**Wider regression scope:** `npx vitest run src/manager/ src/cli/ src/discord/ src/dashboard/ src/ipc/` → **65 files, 723 tests, all passing.**

## Verification Evidence

### 1. Ready-gate wired in startAgent

```bash
$ grep -c "runWarmPathCheck" src/manager/session-manager.ts
2
```
(import + call — exactly 2)

### 2. Atomic registry write — single status:"running" write

```bash
$ awk '/async startAgent/,/^  \}$/' src/manager/session-manager.ts | grep -c 'status: "running"'
1
```

### 3. IPC protocol diff vs HEAD~2 (pre-plan) — NO new method

```bash
$ diff <(grep '^  "' src/ipc/protocol.ts | sort) <(git show HEAD~2:src/ipc/protocol.ts | grep '^  "' | sort)
(empty output)
$ echo $?
0
```

### 4. Server-emit invariant on dashboard app.js

```bash
$ grep -cE "WARM_PATH_TIMEOUT|10000|10_000" src/dashboard/static/app.js
0
```
(zero threshold constants — dashboard is dumb)

### 5. warm_path_ready + warm_path_readiness_ms cross-surface refs

```bash
$ grep -c "warm_path_ready\|warm_path_readiness_ms" src/cli/commands/status.ts src/discord/slash-commands.ts src/dashboard/static/app.js
src/cli/commands/status.ts:6
src/discord/slash-commands.ts:4
src/dashboard/static/app.js:7
```

### 6. Caller-owned Turn invariant preserved (Phase 50)

```bash
$ grep -cE "^[^/*]*turn\.end\(|^[^/*]*turn\?\.end\(" src/manager/session-manager.ts
0
```
(only pre-existing docstring comments mention `turn.end()` — zero actual calls)

### 7. AssembledContext contract preserved (Phase 52)

```bash
$ git diff HEAD -- src/manager/context-assembler.ts | wc -l
0
```

### 8. Warm-path gate block location in session-manager.ts

```text
Line 272: // Phase 56 Plan 02 — warm-path ready gate. Registry stays in 'starting'
Line 340:       "warm-path ready — agent started",
```
(gate block spans lines 272–340)

### 9. Sample CLI column output (4-variant mixed render)

Rendered via a throw-away tsx script against `formatStatusTable`:

```
NAME      STATUS    UPTIME      RESTARTS  WARM-PATH
--------------------------------------------------------------
warm      running   1m 0s       0         [cyan]ready 127ms[/]
starting  [yellow]starting[/]  -    0     [yellow]starting[/]
broken    failed    -           0         [red]error: timeout after 10000m[/]
legacy    running   2m 0s       0         [gray]—[/]
```
(ANSI codes shown as `[color]...[/]` for readability)

### 10. Discord embed warm-path suffix template

```text
src/discord/slash-commands.ts:538     let warmPathSuffix = "";
src/discord/slash-commands.ts:544         warmPathSuffix = " \u00B7 warm-path error";
src/discord/slash-commands.ts:547         warmPathSuffix = ` \u00B7 warm ${ms}ms`;
src/discord/slash-commands.ts:549         warmPathSuffix = " \u00B7 warming";
src/discord/slash-commands.ts:554       value: `${statusEmoji} ${entry.status} \u00B7 ${model} \u00B7 up ${uptime} \u00B7 last ${lastActivity}${warmPathSuffix}`,
```

### 11. Dashboard badge helper + CSS

```bash
$ grep -c "warm-path-badge" src/dashboard/static/app.js
4
$ grep -c "warm-path-badge" src/dashboard/static/styles.css
5
```

```text
src/dashboard/static/app.js:245 function renderWarmPathBadge(agent) {
```

## Decisions Made

1. **Session handle cleanup on warm-path failure** — call `handle.close()` wrapped in try/catch rather than relying on recovery to tear down. The session was created but never flipped to `running`; closing it here avoids leaking the subprocess in production and cleanly removes the handle from the mock adapter's session map.
2. **Session probe verifies `handle.sessionId` post-createSession** — the warm-path `sessionProbe` throws `"session handle not ready"` if the handle is missing or empty. This keeps the three warm-path steps symmetric (sqlite / embedder / session) without adding an out-of-band probe.
3. **vi.mock at module top + global beforeEach default** — `vi.mock("../warm-path-check.js")` is hoisted and applies to every describe. A top-level `beforeEach` sets `mockResolvedValue(readyResult)` so the 13 pre-Phase-56 tests continue to see `status === "running"`. Failure-path tests use `mockResolvedValueOnce(...)`.
4. **Conditional WARM-PATH column** — `formatStatusTable` renders the column only when ≥1 entry has `warm_path_readiness_ms !== undefined && !== null`. Preserves all existing test assertions and follows Phase 55's append-don't-reshape pattern.
5. **Render-hash includes warm-path fields** — the flicker-prevention hash in `renderAgentCards` needed the new fields, otherwise the badge would never update between server state transitions (existing hash was name/status/restarts/zone/fill/error only).
6. **Dashboard server test lives with existing `server.test.ts`** — plan suggested a new `slash-commands-fleet.test.ts` file, but the existing `slash-commands.test.ts` already has the full `buildFleetEmbed` describe block and tests. Appending 4 new tests there keeps the test suite single-file per module (matches the CLI/manager convention).

## Deviations from Plan

### Stylistic / Organizational

**1. [Rule 3 - Blocking] Suffix constant `" \u00B7 warming"` uses `\u00B7` (middle dot) instead of plain space** — plan snippet said `" · warming"` (literal `·`); the rest of the `buildFleetEmbed` template uses `\u00B7` escapes for consistency. Kept escape-style for uniform source reading.

**2. [Rule 3 - Organizational] Discord fleet tests appended to existing `slash-commands.test.ts`** — plan suggested a new `slash-commands-fleet.test.ts` file. Rationale: the existing file already owns the `buildFleetEmbed` describe block with 7 tests; adding 4 more keeps the warm-path tests co-located with the thing they test. No lint/CI friction either way; the path in the plan frontmatter (`src/discord/__tests__/slash-commands-fleet.test.ts`) remains aspirational — if future plans need a dedicated fleet test file, it can be created without touching the 11 tests in this PR.

**3. [Rule 1 - Bug] Render-hash missing warm-path fields (Part D inline discovery)** — plan did not explicitly call out updating the `lastAgentHash` in `renderAgentCards`. Without it, the existing flicker-prevention short-circuits re-renders when ONLY warm-path fields change. Fixed by appending `wr: a.warm_path_ready, wm: a.warm_path_readiness_ms` to the hash.

**Impact on plan:** None. All three are narrow execution choices that preserve the plan's intent (shared test file location, source-style consistency, working badge refresh). No scope creep, no architectural changes.

## Issues Encountered

- Pre-existing tsc errors across ~16 lines (unchanged by this plan) — `usage/__tests__/daily-summary.test.ts`, `usage/budget.ts`. Verified via `git stash && npx tsc --noEmit | wc -l` → 16 before and after, same files. Logged previously in Plan 01's `deferred-items.md`; no new tsc errors added by touching the 9 files in this plan.

## Known Stubs

None. Every surface (CLI column, Discord suffix, dashboard badge) reads real server-emitted data. The ready gate performs real work via the Plan 01 `runWarmPathCheck` composite helper. No placeholder text, no mock data paths in production code.

## User Setup Required

None — no external service configuration required. Dashboard CSS picks up on first page reload after daemon restart.

## Next Plan Readiness

**Plan 03 (if any — 56-03 is present in the phase directory) can now:**
- Assume `SessionManager.startAgent` is warm-path-gated and the registry carries `warm_path_ready` + `warm_path_readiness_ms` on every running agent.
- Trust CLI `clawcode status`, Discord `/clawcode-fleet`, and the dashboard to render warm-path state automatically when the registry carries the fields.
- Build on the server-emit invariant: any new fleet surface should read `registry.entries` verbatim; no coordinated cross-surface changes needed.

---
*Phase: 56-warm-path-optimizations*
*Completed: 2026-04-14*

## Self-Check: PASSED

- All 11 source files + 1 SUMMARY file present on disk
- Both task commits (221a425, 134edb0) present in git log
- 20 new tests + 723 total tests across manager/cli/discord/dashboard/ipc all GREEN
- IPC_METHODS diff vs pre-plan HEAD empty (no new method)
- Server-emit invariant grep returns 0 threshold constants in app.js
- Caller-owned Turn invariant: 0 actual `turn.end()` calls in session-manager.ts
- Zero tsc errors in touched files (tsc error count unchanged: 16 before = 16 after)
