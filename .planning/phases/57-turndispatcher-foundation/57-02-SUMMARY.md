---
phase: 57-turndispatcher-foundation
plan: 02
subsystem: performance
tags: [trace-store, trace-collector, turn-origin, schema-migration, chokepoint-integration]

# Dependency graph
requires:
  - phase: 50-performance-instrumentation
    provides: TraceCollector + TraceStore + TurnRecord / writeTurn + idempotent PRAGMA migration pattern
  - phase: 57-turndispatcher-foundation
    plan: 01
    provides: TurnOrigin type + Zod schema + helpers (src/manager/turn-origin.ts)
provides:
  - "TurnRecord.turnOrigin?: TurnOrigin — optional readonly field on the persistence contract (src/performance/types.ts)"
  - "traces.turn_origin TEXT column — nullable JSON blob on the traces table, added via idempotent PRAGMA-checked migration (src/performance/trace-store.ts)"
  - "Turn.recordOrigin(origin: TurnOrigin) — buffers the origin; end() spreads it into the frozen TurnRecord (src/performance/trace-collector.ts)"
  - "Round-trip serialization: JSON.stringify(origin) on write, TurnOriginSchema.parse on read (validated end-to-end by new tests)"
affects: [57-03, 58, 59, 60, 61, 62, 63]

# Tech tracking
tech-stack:
  added: []  # No new dependencies
  patterns:
    - "Idempotent ALTER TABLE ADD COLUMN via PRAGMA table_info membership set (6th entry appended to existing Phase 52 additions array)"
    - "Optional readonly field on TurnRecord gated by conditional spread at end() — mirrors Phase 52 cacheSnapshot precedent"
    - "Buffered-then-spread origin pattern (recordOrigin → end()) — mirrors recordCacheUsage shape"
    - "Always-spread frozen record assembly in end() (was conditional ternary) — no reference-identity assertions in tests so change is safe"

key-files:
  created:
    - src/performance/__tests__/trace-store-origin.test.ts
    - src/performance/__tests__/trace-collector-origin.test.ts
  modified:
    - src/performance/types.ts
    - src/performance/trace-store.ts
    - src/performance/trace-collector.ts

key-decisions:
  - "turn_origin column is nullable TEXT (not JSON1 data type) — matches existing TraceStore convention of storing small JSON blobs as TEXT; preserves backward compatibility with Phase 50/51/52 rows that land NULL"
  - "Serialization format LOCKED as JSON.stringify(turnOrigin) — no versioning prefix needed because TurnOriginSchema in Plan 57-01 owns shape versioning; Phase 63 walker parses with TurnOriginSchema.parse"
  - "Turn.recordOrigin uses overwrite semantics (second call wins) — matches Phase 52 recordCacheUsage precedent 1:1; avoids an extra decision surface for Plan 57-03 call-site authors"
  - "end() refactored from ternary to always-spread — verified safe because no existing test asserts reference identity on the frozen record (grep for .toBe(base)/Object.is returns empty in src/performance/__tests__)"
  - "No index added on turn_origin in this plan — Phase 63 observability queries determine indexing strategy based on query patterns; premature index would be dead weight for Plan 57-03 call-site migration"

requirements-completed: []  # Phase 57 is foundation — 0 requirements map here per v1.8 roadmap

# Metrics
duration: 7min
completed: 2026-04-15
---

# Phase 57 Plan 02: Trace Schema + Turn Lifecycle Origin Persistence Summary

**Extends the v1.7 trace store so every persisted trace row can carry a TurnOrigin JSON blob — schema migration, TurnRecord field, and Turn.recordOrigin API stitched together and proven round-trippable.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-15T03:48:51Z
- **Completed:** 2026-04-15T03:55:22Z
- **Tasks:** 2 (both TDD RED → GREEN)
- **Files created:** 2 (test files)
- **Files modified:** 3 (types, trace-store, trace-collector)
- **Test count:** 10 (5 trace-store + 5 trace-collector)

## Accomplishments

- **Persistence contract threaded end-to-end** — `TurnRecord.turnOrigin?: TurnOrigin` → `traces.turn_origin TEXT` column → `JSON.stringify` on write → `TurnOriginSchema.parse` on read. Proven by 5 round-trip tests across all 4 SourceKinds.
- **Idempotent migration** — The sixth `["turn_origin", "TEXT"]` tuple appended to the existing Phase 52 `additions` array; the pre-existing PRAGMA-check loop handles idempotency with zero new code. Re-opening an upgraded `traces.db` does not throw duplicate-column errors.
- **Backward compatibility preserved** — Legacy Phase 50/51/52 callers (bench harness, heartbeat checks, any non-TurnDispatcher path) write `turn_origin IS NULL` and remain fully queryable. Every existing performance test (94 tests across 9 files) still passes — this is a pure extension.
- **Turn.recordOrigin API locked** — Single method, single private buffered field, single conditional spread into the frozen record at `end()`. Idempotent overwrite + no-op-after-end semantics mirror `recordCacheUsage` precedent 1:1, so Plan 57-03 call-site authors have zero decision surface to evaluate.
- **Zero-scope-creep** — DiscordBridge, TaskScheduler, SessionManager, daemon, Plan 57-01's `turn-origin.ts` / `turn-dispatcher.ts`, and every percentile / cache-telemetry SQL statement — ALL untouched. Verified by diff checks in the plan's `<verification>` block.

## Locked Shapes (for Plan 57-03 and beyond)

```typescript
// TurnRecord gains an optional readonly field (src/performance/types.ts)
export type TurnRecord = {
  // ... existing Phase 50/52 fields ...
  readonly turnOrigin?: TurnOrigin;
};

// TraceStore schema — 6th idempotent migration addition
const additions = [
  // ... 5 existing Phase 52 tuples ...
  ["turn_origin", "TEXT"],
];

// writeTurn — 13th positional arg binds origin JSON or NULL
t.turnOrigin ? JSON.stringify(t.turnOrigin) : null

// Turn lifecycle — new API
class Turn {
  recordOrigin(origin: TurnOrigin): void;  // buffered, idempotent overwrite, no-op after end()
}
```

**Serialization format (LOCKED):** `JSON.stringify(turnOrigin)` — Phase 63 trace walker reads the column with `JSON.parse` + `TurnOriginSchema.parse` to revalidate. No version prefix needed; schema ownership stays in `src/manager/turn-origin.ts`.

## Task Commits

Each task followed TDD (RED → GREEN):

1. **Task 1 RED: add failing tests for turn_origin column** — `ae8ace2` (test)
2. **Task 1 GREEN: add column + idempotent migration + JSON serialization** — `135b736` (feat)
3. **Task 2 RED: add failing tests for Turn.recordOrigin** — `95ae1fe` (test)
4. **Task 2 GREEN: Turn.recordOrigin buffers + attaches at end()** — `44da310` (feat)

## Files Created/Modified

- `src/performance/types.ts` — MODIFIED — added `import type { TurnOrigin }` + `readonly turnOrigin?: TurnOrigin` field on TurnRecord (+13 lines)
- `src/performance/trace-store.ts` — MODIFIED — added TurnOrigin type import, 6th migration entry, extended insertTrace to 13 positional args, 13th arg bound to `JSON.stringify(origin) ?? null` in writeTurn transaction (+18 lines net, -2 updated)
- `src/performance/trace-collector.ts` — MODIFIED — added TurnOrigin import, `private turnOrigin` buffered field, `recordOrigin(origin)` method, origin spread into frozen record at `end()` (+30 lines net, -5 updated)
- `src/performance/__tests__/trace-store-origin.test.ts` — CREATED — 132 lines — 5 tests (column exists, migration idempotency, round-trip JSON, legacy NULL, explicit-undefined NULL)
- `src/performance/__tests__/trace-collector-origin.test.ts` — CREATED — 121 lines — 5 tests (recordOrigin persists, legacy NULL, no-op after end, overwrite wins, all 4 SourceKinds round-trip)

## Test Coverage

| File | Tests | Covers |
|------|------:|--------|
| `src/performance/__tests__/trace-store-origin.test.ts` | 5 | Column creation (1), migration idempotency on reopen (1), writeTurn+origin JSON round-trip via TurnOriginSchema (1), writeTurn without origin → NULL (1), writeTurn with explicit undefined → NULL (1) |
| `src/performance/__tests__/trace-collector-origin.test.ts` | 5 | recordOrigin before end() → JSON persisted + schema round-trip (1), no recordOrigin → NULL (1), recordOrigin after end() no-op (1), second recordOrigin wins (1), all 4 SourceKinds round-trip (1) |
| **Plan total** | **10** | All behaviors in `<behavior>` blocks from both tasks |

Full suite at plan close: **1600 tests across 143 files — all pass**. Performance subsystem: **99/99 (was 94/94 pre-plan + 10 new — clean extension, zero regressions)**.

## Decisions Made

All decisions were inherited from Plan 57-01 locked shapes + 57-CONTEXT.md pre-decisions. Only one novel execution decision:

- **end() ternary → always-spread refactor** — The pre-plan `end()` body used a ternary `cacheSnapshot ? { ...base, ...cacheFields } : base` that could return the `base` reference directly when no cache snapshot was present. Adding a second optional field (turnOrigin) by nesting another ternary would have produced four branches. Refactored to a single always-spread `{ ...base, ...(cacheSnapshot ? {...} : {}), ...(turnOrigin ? {...} : {}) }` — cleaner for any future optional field, and verified safe by grep check confirming zero tests assert reference identity on the frozen record (no `.toBe(base)`, no `Object.is(...record...)` in `src/performance/__tests__`). Documented in Task 2 action's Warning #5 addressed block.

## Deviations from Plan

None — plan executed exactly as written. All 10 tests from the plan's `<behavior>` blocks passed on the GREEN step without iteration. Zero files modified outside the 5 declared paths (2 created, 3 modified).

## Issues Encountered

None. Pre-existing `npx tsc --noEmit` errors remain in unrelated files (documented as out-of-scope in 57-01 SUMMARY): `src/cli/commands/__tests__/latency.test.ts`, `src/manager/__tests__/agent-provisioner.test.ts`, `src/manager/__tests__/memory-lookup-handler.test.ts`, `src/manager/daemon.ts:1961`, `src/manager/session-adapter.ts:708`, `src/memory/__tests__/graph.test.ts`, `src/usage/__tests__/daily-summary.test.ts`, `src/usage/budget.ts:138`. The 5 files touched by this plan produce zero type errors.

## User Setup Required

None — pure code addition. No schema migration on existing `traces.db` files is required up front — the idempotent `migrateSchema()` path auto-adds the new column on first daemon start against an older DB, and `ALTER TABLE ADD COLUMN` preserves existing rows (they land NULL in the new column).

## Next Phase Readiness

**Ready for Plan 57-03 (call-site migration):**
- `dispatcher.dispatchStream(...)` in DiscordBridge can call `turn.recordOrigin(origin)` before `turn.end()` — the origin JSON lands in `traces.turn_origin` with zero additional wiring
- `dispatcher.dispatch(...)` in TaskScheduler has the same contract
- `makeRootOriginWithTurnId('discord', messageId, 'discord:' + messageId)` from Plan 57-01 now has a persistence target

**Ready for Phase 58 (task store):**
- Phase 58 task rows can JOIN `tasks.causation_id` against `traces.turn_origin` JSON path for cross-agent chain walking

**Ready for Phase 63 (observability):**
- `clawcode trace <causation_id>` can execute `SELECT turn_origin FROM traces WHERE json_extract(turn_origin, '$.source.id') = ?` (sqlite JSON1 extension) or client-side `JSON.parse` + `TurnOriginSchema.parse` + filter — both paths are open

**Not done yet (by design):**
- Call-site migration (DiscordBridge, TaskScheduler) → Plan 57-03
- Index on `turn_origin` JSON paths → Phase 63 decides based on query patterns

## Self-Check: PASSED

### Files exist
- `src/performance/types.ts` — FOUND (modified)
- `src/performance/trace-store.ts` — FOUND (modified)
- `src/performance/trace-collector.ts` — FOUND (modified)
- `src/performance/__tests__/trace-store-origin.test.ts` — FOUND
- `src/performance/__tests__/trace-collector-origin.test.ts` — FOUND

### Commits exist
- `ae8ace2` — FOUND (test RED Task 1)
- `135b736` — FOUND (feat GREEN Task 1)
- `95ae1fe` — FOUND (test RED Task 2)
- `44da310` — FOUND (feat GREEN Task 2)

---
*Phase: 57-turndispatcher-foundation*
*Plan: 02*
*Completed: 2026-04-15*
