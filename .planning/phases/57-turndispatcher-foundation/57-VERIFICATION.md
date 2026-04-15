---
phase: 57-turndispatcher-foundation
verified: 2026-04-15T04:18:31Z
status: passed
score: 4/4 success criteria verified
re_verification:
  previous_status: none
  note: initial verification
---

# Phase 57: TurnDispatcher Foundation Verification Report

**Phase Goal:** Every agent turn — Discord message, scheduler tick, future trigger, future handoff — flows through a single `TurnDispatcher` chokepoint that assigns origin-prefixed turnIds, opens caller-owned Turns, and records provenance, without changing any user-visible behavior.

**Verified:** 2026-04-15T04:18:31Z
**Status:** passed
**Re-verification:** No — initial verification
**Scope note:** Net-zero refactor. REQUIREMENTS.md maps zero REQ-IDs to this phase (verified — `frontmatter requirements: []` in all three plans). Verification targets the four ROADMAP success criteria.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | A Discord message still produces a reply through the same agent/channel/streaming pipeline — DiscordBridge.handleMessage dispatches via TurnDispatcher instead of calling SessionManager.streamFromAgent directly on the daemon path. | VERIFIED | `src/discord/bridge.ts:584-602` — `if (this.turnDispatcher)` branch calls `turnDispatcher.dispatchStream(origin, sessionName, formattedMessage, (acc) => editor.update(acc), { turn, channelId })` on daemon path; `else` branch preserves v1.7 `sessionManager.streamFromAgent(...)` fallback for standalone runner. Integration test `bridge-turn-dispatcher.test.ts` passes. |
| 2   | A cron-scheduled turn from TaskScheduler fires at its cron expression and produces a persisted trace, flowing through TurnDispatcher with a `scheduler:<nanoid>`-prefixed turnId. | VERIFIED | `src/scheduler/scheduler.ts:106-107` — `const origin = makeRootOrigin("scheduler", schedule.name); await this.turnDispatcher.dispatch(origin, agentName, schedule.prompt!)`. Direct `sessionManager.sendToAgent` call removed. Runtime spot-check confirmed `rootTurnId` = `scheduler:iraSh5D7sp` matches `TURN_ID_REGEX`. Integration test `scheduler-turn-dispatcher.test.ts` passes. |
| 3   | Every persisted trace row in traces.db carries a TurnOrigin metadata blob (source.kind, rootTurnId, parentTurnId, chain[]) that downstream phases can pattern-match on. | VERIFIED | `traces.turn_origin TEXT` column created via idempotent migration (confirmed by live DB probe: `cid:12, name:"turn_origin", type:"TEXT", notnull:0`). `writeTurn` binds `t.turnOrigin ? JSON.stringify(t.turnOrigin) : null` as 13th positional arg. `Turn.recordOrigin(origin)` buffers + spreads into the frozen record at `end()`. Both call sites (DiscordBridge + TaskScheduler) now route through TurnDispatcher, which calls `recordOrigin` on caller-owned or dispatcher-owned Turn. Daemon-path rows carry origin; legacy rows land NULL (backward compatibility preserved). |
| 4   | Developers can introduce a new turn source in a follow-on phase by calling `turnDispatcher.dispatch(...)` without duplicating trace-setup, Turn-lifecycle, or session-lookup code per source. | VERIFIED | `TurnDispatcher.dispatch(origin, agentName, message, options?)` and `dispatchStream(...)` are the single-method entry points. Internally handles: `openTurn()` via `sessionManager.getTraceCollector(agentName)` + `collector.startTurn(origin.rootTurnId, agentName, channelId)`, `recordOrigin` attach, success/error `end()` lifecycle. Caller-owned Turn branch (`options.turn`) skips `openTurn`+`end`, just attaches origin. Tolerates missing collector. Net-zero boilerplate per new source: TaskScheduler migration removed 25 lines of inline Turn/trace setup (per 57-03 SUMMARY). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/manager/turn-origin.ts` | TurnOrigin type + Zod schema + helpers + `DISCORD_SNOWFLAKE_PREFIX` | VERIFIED | Exports: `TurnOrigin`, `TurnOriginSchema`, `TurnOriginSourceSchema`, `SourceKind`, `SOURCE_KINDS`, `TURN_ID_REGEX`, `DISCORD_SNOWFLAKE_PREFIX`, `makeTurnId`, `makeRootOrigin`, `makeRootOriginWithTurnId`. All deeply-frozen. 117 lines. |
| `src/manager/turn-dispatcher.ts` | TurnDispatcher class with `dispatch()` + `dispatchStream()` | VERIFIED | Exports: `TurnDispatcher`, `TurnDispatcherError`, `TurnDispatcherOptions`, `DispatchOptions`. Handles caller-owned (via `options.turn`) + dispatcher-owned Turn lifecycles. 178 lines. |
| `src/performance/types.ts` | `TurnRecord.turnOrigin?: TurnOrigin` | VERIFIED | Line 99: `readonly turnOrigin?: TurnOrigin;`. Line 13: `import type { TurnOrigin } from "../manager/turn-origin.js"`. |
| `src/performance/trace-store.ts` | `turn_origin TEXT` column + idempotent migration + JSON write | VERIFIED | Line 534: `["turn_origin", "TEXT"]` in `migrateSchema` additions array. Line 580: `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` (13 positional placeholders). Line 194: `t.turnOrigin ? JSON.stringify(t.turnOrigin) : null`. Live DB probe confirms `turn_origin` column present with `type:"TEXT", notnull:0`. |
| `src/performance/trace-collector.ts` | `Turn.recordOrigin(origin)` + `end()` spread | VERIFIED | Line 87: `private turnOrigin: TurnOrigin | undefined = undefined`. Line 173: `recordOrigin(origin: TurnOrigin): void { if (this.committed) return; this.turnOrigin = origin; }`. Line 219: `...(this.turnOrigin ? { turnOrigin: this.turnOrigin } : {})` spread into frozen record. |
| `src/manager/daemon.ts` | TurnDispatcher singleton instantiated at daemon boot + wired | VERIFIED | Line 20: `import { TurnDispatcher }`. Line 441: `const turnDispatcher = new TurnDispatcher({ sessionManager: manager, log })`. Line 550: passed to `TaskScheduler({ ...turnDispatcher })`. Line 749: passed to `DiscordBridge({ ...turnDispatcher })`. |
| `src/discord/bridge.ts` | Optional `turnDispatcher` field + dispatchStream call + fallback | VERIFIED | Line 60: `readonly turnDispatcher?: TurnDispatcher` OPTIONAL (preserves `src/cli/commands/run.ts`). Lines 584-602: branching `if (this.turnDispatcher) { dispatchStream(...) } else { sessionManager.streamFromAgent(...) }`. Lines 377, 459: `startTurn` calls now use `discord:${message.id}` format for turnId continuity. |
| `src/scheduler/types.ts` | `TaskSchedulerOptions.turnDispatcher: TurnDispatcher` REQUIRED | VERIFIED | Line 44: `readonly turnDispatcher: TurnDispatcher` (required — only daemon constructs scheduler). |
| `src/scheduler/scheduler.ts` | `turnDispatcher.dispatch` call replacing `sessionManager.sendToAgent` | VERIFIED | Lines 106-107: `const origin = makeRootOrigin("scheduler", schedule.name); await this.turnDispatcher.dispatch(origin, agentName, schedule.prompt!)`. No `sessionManager.sendToAgent` / `streamFromAgent` calls anywhere in file. |
| Test files | 4 new test files (turn-origin, turn-dispatcher, trace-store-origin, trace-collector-origin) + 2 integration (scheduler-turn-dispatcher, bridge-turn-dispatcher) | VERIFIED | All 6 files exist and pass: 45 tests (18 + 15 + 5 + 5 + 1 + 1 = 45). |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| `src/manager/daemon.ts` | `src/manager/turn-dispatcher.ts` | `import { TurnDispatcher }` + `new TurnDispatcher({...})` singleton | WIRED (line 20 import, line 441 instantiation) |
| `src/discord/bridge.ts` | `src/manager/turn-dispatcher.ts` | `BridgeConfig.turnDispatcher?: TurnDispatcher` + `this.turnDispatcher.dispatchStream(...)` | WIRED (line 18 type import, line 60 optional field, line 587 call) |
| `src/scheduler/scheduler.ts` | `src/manager/turn-dispatcher.ts` | `TaskSchedulerOptions.turnDispatcher` + `this.turnDispatcher.dispatch(...)` | WIRED (line 4 type import, line 36 field, line 107 call) |
| `src/manager/turn-dispatcher.ts` | `src/manager/session-manager.ts` | `this.sessionManager.streamFromAgent(name, msg, onChunk, turn)` + `sendToAgent(name, msg, turn)` | WIRED (lines 102, 110, 137, 145) |
| `src/manager/turn-dispatcher.ts` | `src/performance/trace-collector.ts` | `collector.startTurn(origin.rootTurnId, agentName, channelId)` + `turn.recordOrigin(origin)` + `turn.end(...)` | WIRED (lines 101, 107, 111, 114, 136, 142, 151, 154, 169) |
| `src/performance/trace-collector.ts` | `src/manager/turn-origin.ts` | `import type { TurnOrigin }` | WIRED (line 25) |
| `src/performance/trace-store.ts` | `traces.turn_origin` column | `INSERT` 13th positional arg | WIRED (line 194 bind, line 580 placeholders, line 534 migration) |
| `src/discord/bridge.ts` | `src/manager/turn-origin.ts` | `makeRootOriginWithTurnId` + `DISCORD_SNOWFLAKE_PREFIX` | WIRED (lines 36-37 imports, line 586 call) |
| `src/scheduler/scheduler.ts` | `src/manager/turn-origin.ts` | `makeRootOrigin` | WIRED (line 5 import, line 106 call) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `traces.turn_origin` column | `t.turnOrigin` on TurnRecord | Turn.recordOrigin called by TurnDispatcher → spread into frozen TurnRecord at Turn.end() → writeTurn serializes via `JSON.stringify(t.turnOrigin)` | Yes — daemon path produces real origin JSON; legacy path produces NULL (intentional backward compat) | FLOWING |
| DiscordBridge dispatchStream response | `response` in streamAndPostResponse | `turnDispatcher.dispatchStream` → `sessionManager.streamFromAgent` → same streaming pipeline as v1.7 (onChunk forwards accumulated chunks to editor) | Yes — passthrough preserved byte-identical to v1.7 (verified by 118 pre-existing bridge tests still passing unchanged, per 57-03 SUMMARY) | FLOWING |
| TaskScheduler cron fire | response from `turnDispatcher.dispatch` | `TurnDispatcher.dispatch` → `sessionManager.sendToAgent` → real agent turn execution | Yes — existing scheduler regression test confirms turn executes and trace row is written with real timestamps + origin | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command / Action | Result | Status |
| -------- | ---------------- | ------ | ------ |
| TurnOrigin runtime construction | `makeRootOrigin("scheduler", "daily-report")` via tsx | Returns `{source:{kind:"scheduler",id:"daily-report"},rootTurnId:"scheduler:iraSh5D7sp",parentTurnId:null,chain:["scheduler:iraSh5D7sp"]}`, deeply frozen, regex matches | PASS |
| Discord turnId preservation | `makeRootOriginWithTurnId("discord", snowflake, "discord:" + snowflake)` | Returns discord-prefixed turnId that matches `TURN_ID_REGEX` | PASS |
| TurnOriginSchema round-trip | `TurnOriginSchema.parse(makeRootOrigin(...))` via tsx | Returns parsed origin without schema errors | PASS |
| turn_origin column exists + correct type | `PRAGMA table_info(traces)` on fresh TraceStore | `{cid:12, name:"turn_origin", type:"TEXT", notnull:0, dflt_value:null, pk:0}` | PASS |
| Migration idempotency | Open `TraceStore(path).close()` → reopen `TraceStore(path)` → count turn_origin columns | Count = 1 (no duplicate column, no throw) | PASS |
| Plan 57 targeted tests | `npx vitest run` on all 6 Phase 57 test files | 45/45 passing | PASS |
| Full regression suite | `npx vitest run` | **1607/1607 tests across 145 files — all pass** | PASS |
| Blocker #1 — run.ts unchanged | `git diff src/cli/commands/run.ts \| wc -l` | 0 (untouched) | PASS |
| Net-zero on SessionManager | `git log src/manager/session-manager.ts` vs 57 work | Not in any 57-* commit (only pre-57 commits modify it) | PASS |
| Scheduler no longer calls SessionManager directly | grep `sendToAgent\|streamFromAgent` in `src/scheduler/scheduler.ts` | Zero matches (only the retained `sessionManager` field for handler plumbing) | PASS |
| Daemon wires TurnDispatcher once | grep `new TurnDispatcher` in `src/manager/daemon.ts` | 1 match (singleton — line 441) | PASS |
| tsc exit — phase-touched files | `npx tsc --noEmit` filtered to Phase 57 files | Zero errors introduced by Phase 57 (errors documented and confirmed pre-existing in unrelated files per 57-02/57-03 SUMMARIES) | PASS (see note below) |

### Requirements Coverage

Phase 57 is a **net-zero refactor with zero REQ-IDs** per ROADMAP.md and `requirements: []` frontmatter on all three plans. ROADMAP maps the Phase 57 goal to foundation-enabling subsequent HAND-*, TRIG-08, OBS-04 requirements but assigns no REQ to Phase 57 itself. This is intentional and correct. No cross-reference against REQUIREMENTS.md is applicable for this phase.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| ---- | ------- | -------- | ------ |
| (none) | No TODO/FIXME/stub/placeholder patterns found in Phase 57 artifacts | — | None |

Scanned: `src/manager/turn-origin.ts`, `src/manager/turn-dispatcher.ts`, `src/performance/types.ts`, `src/performance/trace-store.ts` (turn_origin areas), `src/performance/trace-collector.ts` (turnOrigin areas), `src/discord/bridge.ts` (turnDispatcher areas), `src/scheduler/scheduler.ts`, `src/scheduler/types.ts`, `src/manager/daemon.ts` (TurnDispatcher wiring block). No stub returns, no empty handlers, no `TODO`/`FIXME`, no placeholder logic. Error-swallowing patterns in the dispatcher (`try { ... } catch { /* non-fatal */ }`) are intentional per the Phase 50 "tracing is best-effort side-effect" contract and are documented inline.

### Human Verification Required

None required. All four success criteria are verified programmatically via automated tests, runtime spot-checks, and static grep wiring checks. Net-zero refactor has no user-visible surface to eyeball.

### Important Note — tsc Exit Code

`npx tsc --noEmit` exits with code 2, but all reported errors are in **pre-existing unrelated files** explicitly documented as out-of-scope in 57-01-SUMMARY.md, 57-02-SUMMARY.md, and 57-03-SUMMARY.md:
- `src/cli/commands/__tests__/latency.test.ts` (3 implicit-any errors — existed before Phase 57)
- `src/manager/__tests__/agent-provisioner.test.ts`
- `src/manager/__tests__/memory-lookup-handler.test.ts`
- `src/manager/daemon.ts:1976` (pre-existing `getCostsByAgentModel` type mismatch — line shifted from 1961 to 1976 because Phase 57 inserted the TurnDispatcher singleton block ~11 lines above; the error itself is unrelated and pre-dates this phase)
- `src/manager/session-adapter.ts:708`
- `src/memory/__tests__/graph.test.ts`
- `src/usage/__tests__/daily-summary.test.ts`
- `src/usage/budget.ts:138`

**None of these errors are introduced by Phase 57.** Files authored or touched by Phase 57 (`turn-origin.ts`, `turn-dispatcher.ts`, `trace-store.ts`, `trace-collector.ts`, `types.ts`, `bridge.ts`, `scheduler.ts`, `scheduler/types.ts`, daemon.ts's turn-dispatcher wiring block) produce zero type errors. This matches the explicit Plan 57-03 Blocker #1 gate definition, which is scoped to "zero new errors on touched files" rather than global exit 0.

## Gaps Summary

No gaps found. The phase delivered exactly what the goal required:

- **Chokepoint live:** TurnDispatcher is the singular entry point, singleton at daemon boot, invoked by DiscordBridge (with optional fallback preserving run.ts) and TaskScheduler (required field).
- **Origin-prefixed turnIds:** `discord:<snowflake>` (trace-id continuity preserved) and `scheduler:<nanoid(10)>` formats both confirmed matching `TURN_ID_REGEX`.
- **Caller-owned Turn contract:** DiscordBridge pre-opens Turn + receive-span, passes via `options.turn`; TurnDispatcher attaches origin without ending the Turn. TaskScheduler uses dispatcher-owned lifecycle (no pre-existing spans).
- **Provenance persisted:** `traces.turn_origin TEXT` column writes `JSON.stringify(origin)` on daemon path, NULL on legacy path. Schema migration is idempotent and backward-compatible.
- **Net-zero user behavior:** Full regression suite (1607/1607) passes. `src/cli/commands/run.ts` untouched. No changes to SessionManager. One pre-authorized bridge test assertion update (`msg-abc` → `discord:msg-abc`) reflects the intentional turnId format switch and is documented in Plan 57-03 Step 9.

Phase 57 achieves its goal. All four ROADMAP success criteria are satisfied. The chokepoint is ready to be consumed by Phases 58-63 (task store, handoffs, triggers, lifecycle, policies, observability).

---

_Verified: 2026-04-15T04:18:31Z_
_Verifier: Claude (gsd-verifier)_
