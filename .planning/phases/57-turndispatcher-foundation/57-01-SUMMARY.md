---
phase: 57-turndispatcher-foundation
plan: 01
subsystem: infra
tags: [turn-dispatcher, turn-origin, zod, nanoid, tracing, chokepoint]

# Dependency graph
requires:
  - phase: 50-performance-instrumentation
    provides: TraceCollector + Turn lifecycle (src/performance/trace-collector.ts)
  - phase: 01-core-manager
    provides: SessionManager.sendToAgent / streamFromAgent / getTraceCollector
provides:
  - "TurnOrigin type + Zod schema (src/manager/turn-origin.ts)"
  - "TurnDispatcher class with dispatch() and dispatchStream() methods (src/manager/turn-dispatcher.ts)"
  - "makeRootOrigin(kind, sourceId) helper — fresh nanoid(10) turnId per call"
  - "makeRootOriginWithTurnId(kind, sourceId, turnId) — preserves caller-supplied turnId (Discord snowflake continuity)"
  - "DISCORD_SNOWFLAKE_PREFIX constant ('discord:') for Plan 57-03 Discord bridge migration"
  - "TURN_ID_REGEX: /^(discord|scheduler|task|trigger):[a-zA-Z0-9_-]{10,}$/"
  - "SOURCE_KINDS tuple: ['discord', 'scheduler', 'task', 'trigger']"
  - "TurnDispatcherError typed error class"
affects: [57-02, 57-03, 58, 59, 60, 61, 62, 63]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — nanoid, zod, pino already present
  patterns:
    - "Single-chokepoint dispatcher for all turn sources (Discord, scheduler, task, trigger)"
    - "Origin-prefixed turnIds (<sourceKind>:<nanoid|snowflake>)"
    - "Deeply-frozen TurnOrigin (outer + source + chain arrays) matching project immutability convention"
    - "Caller-owned Turn lifecycle (dispatcher opens + ends, tolerates missing collector)"
    - "Caller-supplied turnId preservation helper for trace-id continuity (Discord snowflakes)"

key-files:
  created:
    - src/manager/turn-origin.ts
    - src/manager/turn-dispatcher.ts
    - src/manager/__tests__/turn-origin.test.ts
    - src/manager/__tests__/turn-dispatcher.test.ts
  modified: []

key-decisions:
  - "TurnId format LOCKED as <sourceKind>:<nanoid(10)> — 10-char suffix matches existing src/scheduler/scheduler.ts:98 convention; regex accepts {10,} so Discord snowflakes (17-19 digits) also pass"
  - "TurnOrigin shape LOCKED: source {kind,id} + rootTurnId + parentTurnId + chain — downstream phases 58-63 pattern-match on source.kind, do not add fields without roadmap update"
  - "Discord snowflake preservation via makeRootOriginWithTurnId — prevents operator-query break in traces.db across v1.7→v1.8 boundary"
  - "TurnDispatcher tolerates missing TraceCollector (returns undefined Turn, still dispatches) — non-fatal for tests and pre-ready agents"
  - "Plan 57-01 is net-zero on call sites — DiscordBridge, TaskScheduler, SessionManager, daemon.ts all UNCHANGED; Plan 57-03 owns migration after Plan 57-02 threads origin through trace store"

patterns-established:
  - "All new domain types return Object.freeze'd (deep) values — freezes outer object + nested source + chain array"
  - "Typed error classes extend Error with readonly context fields + explicit this.name (matches src/shared/errors.ts pattern)"
  - "Pino child loggers injected via options with top-level logger fallback (options.log ?? logger).child(...)"
  - "Type-only imports for cross-module types (import type SessionManager) to minimize compile-time coupling"

requirements-completed: []  # Phase 57 is foundation — 0 requirements map here per v1.8 roadmap

# Metrics
duration: 4min
completed: 2026-04-15
---

# Phase 57 Plan 01: TurnDispatcher Foundation Summary

**TurnOrigin contract + TurnDispatcher chokepoint class wrapping SessionManager.sendToAgent/streamFromAgent with origin-prefixed turnIds, caller-owned Turn lifecycle, and Discord snowflake preservation helper**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-15T03:41:37Z
- **Completed:** 2026-04-15T03:46:00Z
- **Tasks:** 2 (both TDD)
- **Files created:** 4 (2 implementation + 2 test)
- **Test count:** 28 (18 turn-origin + 10 turn-dispatcher)

## Accomplishments

- **TurnOrigin as the shared provenance contract** — locked 4-field shape (`source`, `rootTurnId`, `parentTurnId`, `chain`) validated via Zod schema with readonly semantics. Every persisted trace row in Phases 57-02+ will carry this blob.
- **TurnDispatcher chokepoint class** — Single entry point (`dispatch` / `dispatchStream`) that downstream phases 58-63 target instead of reinventing Turn/session/trace plumbing per source.
- **Discord snowflake preservation** — `makeRootOriginWithTurnId` helper + `DISCORD_SNOWFLAKE_PREFIX` constant so Plan 57-03 Discord bridge migration keeps operator `SELECT * FROM traces WHERE id = <snowflake>` queries working across the v1.7→v1.8 boundary.
- **Net-zero call-site impact** — Zero changes to `src/discord/bridge.ts`, `src/scheduler/scheduler.ts`, `src/manager/session-manager.ts`, `src/manager/daemon.ts`, `src/ipc/protocol.ts`. Migration defers to Plan 57-03 after trace enrichment (Plan 57-02) threads origin through the store.

## Locked Shapes (for downstream consumers)

```typescript
// turnId format
const TURN_ID_REGEX = /^(discord|scheduler|task|trigger):[a-zA-Z0-9_-]{10,}$/;

// TurnOrigin — LOCKED, see .planning/phases/57-turndispatcher-foundation/57-CONTEXT.md
interface TurnOrigin {
  readonly source: { readonly kind: 'discord' | 'scheduler' | 'task' | 'trigger'; readonly id: string };
  readonly rootTurnId: string;        // matches TURN_ID_REGEX
  readonly parentTurnId: string | null;
  readonly chain: readonly string[];  // inclusive root→current walk, always ≥ 1 element
}
```

**Discord snowflake preservation decision (LOCKED):** `traces.id` pre-v1.8 used raw Discord snowflakes. Plan 57-03 migration reuses the snowflake as `rootTurnId` via `discord:<snowflake>` format (passes `TURN_ID_REGEX` because snowflakes are 17-19 digits, within `[a-zA-Z0-9_-]{10,}`). Operator query path: rewrite `WHERE id = <snowflake>` to `WHERE id = 'discord:' || <snowflake>`.

## Exports by File (for Plans 57-02 and 57-03)

### `src/manager/turn-origin.ts`
- `TurnOrigin` (type)
- `TurnOriginSchema` (Zod schema — consumers: trace store in Plan 57-02)
- `TurnOriginSourceSchema` (Zod schema)
- `SourceKind` (type)
- `SOURCE_KINDS` (const tuple — `['discord', 'scheduler', 'task', 'trigger']`)
- `TURN_ID_REGEX` (const)
- `DISCORD_SNOWFLAKE_PREFIX` (const — `'discord:'`)
- `makeTurnId(kind: SourceKind): string`
- `makeRootOrigin(kind: SourceKind, sourceId: string): TurnOrigin`
- `makeRootOriginWithTurnId(kind: SourceKind, sourceId: string, turnId: string): TurnOrigin`

### `src/manager/turn-dispatcher.ts`
- `TurnDispatcher` (class)
- `TurnDispatcherError` (class extending Error)
- `TurnDispatcherOptions` (type — `{ sessionManager: SessionManager; log?: Logger }`)
- `DispatchOptions` (type — `{ channelId?: string | null }`)

## Task Commits

Each task followed TDD (RED → GREEN):

1. **Task 1 RED: add failing tests for TurnOrigin** — `c9a89e3` (test)
2. **Task 1 GREEN: implement TurnOrigin schema + helpers** — `ea5cf39` (feat)
3. **Task 2 RED: add failing tests for TurnDispatcher** — `769945b` (test)
4. **Task 2 GREEN: implement TurnDispatcher class** — `a2b6d14` (feat)

## Files Created/Modified

- `src/manager/turn-origin.ts` — TurnOrigin type + Zod schema + helpers + TURN_ID_REGEX + DISCORD_SNOWFLAKE_PREFIX (117 lines)
- `src/manager/turn-dispatcher.ts` — TurnDispatcher class + TurnDispatcherError + option types (141 lines)
- `src/manager/__tests__/turn-origin.test.ts` — 18 tests covering schema round-trip + rejection cases + all helpers + frozen invariants (154 lines)
- `src/manager/__tests__/turn-dispatcher.test.ts` — 10 tests covering dispatch/dispatchStream behavior + Turn lifecycle + error paths + immutability (165 lines)

## Test Coverage

| File | Tests | Covers |
|------|------:|--------|
| `src/manager/__tests__/turn-origin.test.ts` | 18 | Schema round-trip (1), rejection paths (3), `makeRootOrigin` for all 4 kinds + uniqueness + frozen (6), `makeTurnId` regex match + nanoid(10) suffix (2), `DISCORD_SNOWFLAKE_PREFIX` (1), `makeRootOriginWithTurnId` snowflake preservation + regex validation + frozen (5) |
| `src/manager/__tests__/turn-dispatcher.test.ts` | 10 | Dispatch: sendToAgent passthrough + Turn.id=rootTurnId (1), collector startTurn args (1), default channelId (1), success end (1), error end + rethrow (1), response passthrough (1), missing collector tolerance (1), empty-agent TurnDispatcherError (1). Stream: streamFromAgent call shape + onChunk routing (1), origin not mutated (1) |
| **Plan total** | **28** | All behaviors in `<behavior>` block from both tasks |

Full suite: 1590 tests across 141 files — all pass, no regressions.

## Decisions Made

All decisions were pre-locked in `.planning/phases/57-turndispatcher-foundation/57-CONTEXT.md` (`<decisions>` block) and the plan's `<locked_shapes>` section. No new decisions needed during execution — this is pure infrastructure per the "Claude's Discretion" direction in CONTEXT.md.

## Deviations from Plan

None — plan executed exactly as written. All 28 tests from the plan's `<behavior>` blocks passed on the GREEN step without iteration. Zero files modified outside the 4 declared paths.

## Issues Encountered

None. Dependencies (`nanoid`, `zod`, `pino`) already in `package.json`. Pre-existing `npx tsc --noEmit` errors in unrelated files (`src/cli/commands/__tests__/latency.test.ts`, `src/manager/__tests__/agent-provisioner.test.ts`, `src/manager/__tests__/memory-lookup-handler.test.ts`, `src/manager/daemon.ts:1961`, `src/manager/session-adapter.ts:708`, `src/memory/__tests__/graph.test.ts`, `src/usage/__tests__/daily-summary.test.ts`, `src/usage/budget.ts:138`) are out of scope per SCOPE BOUNDARY rule — logged here for tracking but not repaired. New files (`turn-origin.ts`, `turn-dispatcher.ts`, both test files) produce zero type errors.

## User Setup Required

None — pure code addition, no external services.

## Next Phase Readiness

**Ready for Plan 57-02 (trace enrichment):**
- `TurnOriginSchema` available for Zod-validating the blob before persisting
- `TURN_ID_REGEX` available for validating existing trace row IDs during migration
- `DISCORD_SNOWFLAKE_PREFIX` + `makeRootOriginWithTurnId` ready for the trace-id continuity path

**Ready for Plan 57-03 (call-site migration) after 57-02 lands:**
- `TurnDispatcher` wired at daemon boot alongside `SessionManager`
- `DiscordBridge.handleMessage` swaps `streamFromAgent` for `dispatcher.dispatchStream` using `makeRootOriginWithTurnId('discord', messageId, 'discord:' + messageId)`
- `TaskScheduler` swaps its direct `sendToAgent` call for `dispatcher.dispatch` using `makeRootOrigin('scheduler', schedule.name)`

**Not done yet (by design):**
- Trace row `TurnOrigin` metadata persistence → Plan 57-02
- Call-site migration → Plan 57-03

## Self-Check: PASSED

### Files exist
- `src/manager/turn-origin.ts` — FOUND
- `src/manager/turn-dispatcher.ts` — FOUND
- `src/manager/__tests__/turn-origin.test.ts` — FOUND
- `src/manager/__tests__/turn-dispatcher.test.ts` — FOUND

### Commits exist
- `c9a89e3` — FOUND (test RED Task 1)
- `ea5cf39` — FOUND (feat GREEN Task 1)
- `769945b` — FOUND (test RED Task 2)
- `a2b6d14` — FOUND (feat GREEN Task 2)

---
*Phase: 57-turndispatcher-foundation*
*Plan: 01*
*Completed: 2026-04-15*
