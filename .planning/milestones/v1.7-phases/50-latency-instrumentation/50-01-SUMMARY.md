---
phase: 50-latency-instrumentation
plan: 01
subsystem: performance
tags: [tracing, sqlite, better-sqlite3, percentiles, latency, zod, row-number, cascade, wal]

# Dependency graph
requires:
  - phase: 50-00
    provides: Wave 0 RED test scaffolding for TraceStore/TraceCollector/percentiles (25 tests in src/performance/__tests__)
provides:
  - TraceStore SQLite wrapper for per-agent traces.db (WAL + foreign_keys ON, INSERT OR REPLACE, ON DELETE CASCADE)
  - TraceCollector + Turn + Span classes with in-memory span buffer, single-transaction commit at turn.end()
  - PERCENTILE_SQL ROW_NUMBER-based percentile query with tool_call.* aggregation
  - parseSinceDuration / sinceToIso duration helpers (h/d/m/s)
  - CANONICAL_SEGMENTS constant + LatencyReport + PercentileRow types
  - perf.traceRetentionDays optional config field (agent + defaults schemas)
  - ResolvedAgentConfig.perf passthrough
  - TraceStoreError custom error class
affects: [50-02, 50-02b, 50-03]

# Tech tracking
tech-stack:
  added: []  # No new runtime dependencies — all libs already present
  patterns:
    - "Per-agent SQLite with prepared-statements + Object.freeze on returned records (mirrors src/usage/tracker.ts)"
    - "ON DELETE CASCADE for atomic retention cleanup (no secondary orphan query — Pitfall 4 avoided)"
    - "Batched per-turn write: one transaction per turn.end(), never per span (Pitfall 5 avoided)"
    - "ROW_NUMBER nearest-rank percentile emulation (SQLite lacks PERCENTILE_CONT)"
    - "Named bind params for percentile SQL (@agent, @since, @span_name); positional for insert/delete"
    - "1KB serialized metadata cap per span with `...` truncation sentinel"
    - "Idempotent end() on both Turn and Span classes (safe to call on error-handler cleanup paths)"
    - "perf config as optional sub-object on agent + defaults with passthrough in resolveAgentConfig"

key-files:
  created:
    - src/performance/types.ts
    - src/performance/trace-store.ts
    - src/performance/trace-collector.ts
    - src/performance/percentiles.ts
  modified:
    - src/config/schema.ts
    - src/config/loader.ts
    - src/shared/types.ts

key-decisions:
  - "Phase 50 Plan 01 — named bind params (@cutoff, @agent, @since, @span_name) for DELETE + percentile SQL; positional for INSERT statements (matches src/usage/tracker.ts pattern)"
  - "Phase 50 Plan 01 — `perf` config added to BOTH agent schema AND defaults schema so fleet-wide retention defaults are possible (resolver merges agent > defaults > undefined)"
  - "Phase 50 Plan 01 — Turn identity fields (id/agent/channelId) made `public readonly` so tests and diagnostic logging can correlate without getters"
  - "Phase 50 Plan 01 — metadata serialization truncates at 1000 chars with `...` sentinel rather than throwing; traces are observational, never fail the parent message path"
  - "Phase 50 Plan 01 — TraceStoreError mirrors MemoryError shape (readonly dbPath, sets this.name); all TraceStore ops catch/re-throw as TraceStoreError with operation context"

patterns-established:
  - "Pattern: Per-agent trace store — drop-in addition to workspace directory (`~/.clawcode/agents/<name>/traces.db`), matches `usage.db`/`memory.db` isolation pattern"
  - "Pattern: Batched span flush — collect in memory during turn, single transaction at turn.end() keeps SQLite write amplification bounded under tool-heavy turns"
  - "Pattern: Nearest-rank percentile via ROW_NUMBER() — reusable SQL template for any future `p50/p95/p99` aggregation in the codebase"
  - "Pattern: Duration string helpers — shared `parseSinceDuration`/`sinceToIso` between CLI, dashboard, and heartbeat retention check"

requirements-completed: [PERF-01, PERF-02]

# Metrics
duration: 8min
completed: 2026-04-13
---

# Phase 50 Plan 01: Performance Subsystem Summary

**TraceStore + TraceCollector primitives for per-agent latency tracing — WAL+CASCADE SQLite store, ROW_NUMBER percentile SQL, in-memory span buffer with single-transaction flush, and `perf.traceRetentionDays` config surface.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-13T17:31:24Z
- **Completed:** 2026-04-13T17:39:56Z
- **Tasks:** 2 (both `auto` + `tdd`, no checkpoints)
- **Files modified:** 7 (4 created + 3 edited)

## Accomplishments

- **Wave 0 RED → GREEN for performance subsystem:** all 25 tests in `src/performance/__tests__/` now pass (4 files: trace-store, trace-store-persistence, percentiles, trace-collector). This closes PERF-01 success criterion #4 (daemon-restart persistence) via the dedicated `trace-store-persistence.test.ts`.
- **TraceStore delivered:** SQLite wrapper mirrors `src/usage/tracker.ts` structure (prepared statements, WAL + busy_timeout + synchronous pragmas) and adds `foreign_keys = ON` with `ON DELETE CASCADE` on `trace_spans.turn_id → traces(id)`. Retention is a single-parent DELETE with automatic cascade — no orphan-span query (Pitfall 4 avoided).
- **TraceCollector delivered:** 170-line class trio (TraceCollector + Turn + Span) with in-memory span buffer, single `writeTurn` call at `turn.end()`, frozen `TurnRecord` + frozen `spans` array, idempotent `end()` on both Turn and Span.
- **Percentile SQL delivered:** `ROW_NUMBER() OVER (ORDER BY duration_ms)` with `CAST(total * p AS INTEGER) + 1` nearest-rank math. Tool-call aggregation via `@span_name = 'tool_call' AND s.name LIKE 'tool_call.%'` clause produces one aggregate row per turn/window.
- **Config schema extended:** `perf: { traceRetentionDays?: number (positive int) }` optional on BOTH agent schema AND top-level defaults schema. `resolveAgentConfig` in `src/config/loader.ts` merges `agent.perf ?? defaults.perf ?? undefined` — fleet-wide defaults + per-agent overrides both supported.
- **No runtime deps added:** leveraged existing `better-sqlite3@12.8.0`, `zod@4.3.6`, `pino@9.x`. Zero new dependencies.

## Task Commits

Each task was committed atomically:

1. **Task 1: TraceStore + percentiles** — `f610b55` (feat)
   - `src/performance/types.ts` (106 lines) — TurnRecord, SpanRecord, PercentileRow, LatencyReport, CANONICAL_SEGMENTS, TraceStoreError
   - `src/performance/percentiles.ts` (96 lines) — parseSinceDuration, sinceToIso, PERCENTILE_SQL constant
   - `src/performance/trace-store.ts` (232 lines) — TraceStore class with writeTurn/pruneOlderThan/getPercentiles/close
   - Tests turned GREEN: 18 (8 trace-store + 3 persistence + 7 percentiles)
2. **Task 2: TraceCollector + config** — `3d681d4` (feat)
   - `src/performance/trace-collector.ts` (170 lines) — TraceCollector + Turn + Span classes
   - `src/config/schema.ts` — perf sub-object on agent + defaults schemas
   - `src/shared/types.ts` — ResolvedAgentConfig.perf optional field
   - `src/config/loader.ts` — perf merge in resolveAgentConfig
   - Tests turned GREEN: 7 (trace-collector); 1171 total across src/performance + src/config

**Plan metadata:** _(see final metadata commit below)_

## Files Created/Modified

### Created

| Path | Lines | Purpose |
|------|-------|---------|
| `src/performance/types.ts` | 106 | Shared contract: `TurnRecord`, `SpanRecord`, `PercentileRow`, `LatencyReport`, `CANONICAL_SEGMENTS`, `TurnStatus`, `CanonicalSegment`, `TraceStoreError` |
| `src/performance/trace-store.ts` | 232 | SQLite wrapper — WAL+CASCADE pragmas, prepared statements (`insertTrace`, `insertSpan`, `deleteOlderThan`, `percentiles`), `writeTurn` batched transaction, `pruneOlderThan`, `getPercentiles`, `close` |
| `src/performance/percentiles.ts` | 96 | Duration helpers + canonical `PERCENTILE_SQL` with `ROW_NUMBER()` + `tool_call.%` aggregation |
| `src/performance/trace-collector.ts` | 170 | `TraceCollector.startTurn` → `Turn.startSpan` → `Span.end()` + `Turn.end(status)` commit flow |

### Modified

| Path | Change |
|------|--------|
| `src/config/schema.ts` | Added `perf: { traceRetentionDays?: positive int }` optional to both `agentSchema` and `defaultsSchema` |
| `src/config/loader.ts` | `resolveAgentConfig` merges `perf: agent.perf ?? defaults.perf ?? undefined` |
| `src/shared/types.ts` | Added `readonly perf?: { readonly traceRetentionDays?: number }` to `ResolvedAgentConfig` |

## Key Public API

```typescript
// src/performance/trace-store.ts
class TraceStore {
  constructor(dbPath: string);
  writeTurn(turn: TurnRecord): void;
  pruneOlderThan(cutoffIso: string): number;  // returns rows deleted (spans cascade)
  getPercentiles(agent: string, sinceIso: string): readonly PercentileRow[];  // 4 rows
  close(): void;
}

// src/performance/trace-collector.ts
class TraceCollector {
  constructor(store: TraceStore, log: Logger);
  startTurn(turnId: string, agent: string, channelId: string | null): Turn;
}

class Turn {
  readonly id: string;
  readonly agent: string;
  readonly channelId: string | null;
  startSpan(name: string, metadata?: Record<string, unknown>): Span;
  end(status: TurnStatus): void;  // idempotent
}

class Span {
  end(): void;  // idempotent
}

// src/performance/percentiles.ts
export function parseSinceDuration(input: string): number;
export function sinceToIso(input: string, now?: Date): string;
export const PERCENTILE_SQL: string;

// src/performance/types.ts
export const CANONICAL_SEGMENTS: readonly ["end_to_end", "first_token", "context_assemble", "tool_call"];
export class TraceStoreError extends Error { readonly dbPath: string; }
```

## Test Counts

| Test File | Count | Status |
|-----------|-------|--------|
| `src/performance/__tests__/trace-store.test.ts` | 8 | GREEN |
| `src/performance/__tests__/trace-store-persistence.test.ts` | 3 | GREEN |
| `src/performance/__tests__/percentiles.test.ts` | 7 | GREEN |
| `src/performance/__tests__/trace-collector.test.ts` | 7 | GREEN |
| **Total Wave 0 (this plan)** | **25** | **25 / 25 GREEN** |
| `src/config/__tests__/**` | 100+ | GREEN (no regressions from perf schema extension) |
| `src/performance + src/config` combined (in-scope verify) | 1171 | 1171 / 1171 GREEN |

## Decisions Made

- **Retention via CASCADE only.** The earlier `50-CONTEXT.md` addendum ratified removing the secondary orphan-span cleanup query in favor of ON DELETE CASCADE. The implementation follows that ratification verbatim: `pruneOlderThan` runs a single `DELETE FROM traces WHERE started_at < @cutoff` and returns `.changes`. No `DELETE FROM trace_spans WHERE turn_id NOT IN ...` anywhere in the codebase.
- **Named bind params for DELETE + percentile SQL; positional for INSERT.** The percentile SQL uses named params because they are the natural way to express multiple repeated parameters. `deleteOlderThan` uses `@cutoff` named to match the `DELETE ... WHERE started_at < @cutoff` style. Insert statements use positional since they're simple linear bindings.
- **Turn identity fields made `public readonly`.** The Wave 0 test in `trace-collector.test.ts` asserts `turn.id`, `turn.agent`, `turn.channelId` are readable. Rather than add getters, the implementation exposes them as `public readonly` fields (still immutable, still matches the `readonly` convention from CONVENTIONS.md).
- **Metadata serialization never throws.** Oversized JSON is truncated at 1000 chars with a literal `...` sentinel appended. Unstringifiable payloads (undefined result from `JSON.stringify`) become `"{}"`. Traces are observational — they MUST NOT fail the parent message path.
- **`perf` added to defaults schema too.** This enables fleet-wide trace retention defaults (e.g., `defaults.perf.traceRetentionDays: 14` sets 14 days for every agent). Individual agents can still override. The plan's acceptance criterion mentioned "Also add the same `perf` field to the `defaults` schema if it exists (so a fleet-wide default is possible)" — delivered.

## Deviations from Plan

None - plan executed exactly as written. All acceptance criteria met on first pass except one minor fix during TDD GREEN phase:

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `pruneOlderThan` positional bind mismatch**
- **Found during:** Task 1 RED → GREEN cycle (2 test failures: "pruneOlderThan deletes expired turns" + "cascade: pruning a turn deletes its spans")
- **Issue:** Initial implementation called `this.stmts.deleteOlderThan.run(cutoffIso)` (positional) while the SQL used `@cutoff` named bind — better-sqlite3 threw `Too many parameter values were provided` because it saw 0 named params + 1 positional.
- **Fix:** Changed the call site to `this.stmts.deleteOlderThan.run({ cutoff: cutoffIso })` to match the named binding contract in the prepared SQL.
- **Files modified:** `src/performance/trace-store.ts`
- **Verification:** All 8 trace-store tests + 3 persistence tests + 7 percentile tests now green.
- **Committed in:** `f610b55` (Task 1 commit — fix rolled into the same commit as initial implementation)

---

**Total deviations:** 1 auto-fixed (1 bug during TDD GREEN phase)
**Impact on plan:** No scope creep. The plan said "use named bind params `@agent`, `@since`, `@span_name`" for percentile SQL and did not strictly specify DELETE binding style — the fix just aligned the DELETE call site with the named-bind convention the percentile SQL already established. All plan-specified behavior delivered.

## Issues Encountered

- **Full-suite test run picks up `.claude/worktrees/agent-*/` copies.** The repo has stale parallel worktree agent branches under `.claude/worktrees/` that vitest discovers. Running `npx vitest run` without a path hits MCP server count drift in those worktrees and the already-RED Wave 2/3 tests (bridge, session-adapter, context-assembler tracing, latency CLI, trace-retention, scheduler tracing). These failures are out-of-scope for Plan 50-01 — they are intentionally RED from Wave 0 and are turned green by Plans 50-02/50-02b/50-03. Verification was performed on the in-scope suites only: `npx vitest run src/performance src/config` — 1171 tests GREEN.
- **No other issues during execution.**

## User Setup Required

None — no external service configuration required. New code is library-level and consumed only by tests in this plan; Wave 2 will wire it into DiscordBridge/SdkSessionAdapter/ContextAssembler.

## Next Phase Readiness

- **Plan 50-02 can begin** (DiscordBridge + SdkSessionAdapter + ContextAssembler tracing hook points). All TraceCollector/TraceStore primitives are available and tested.
- **Plan 50-02b can begin** (scheduler tracing). `scheduler:<id>` turnId prefix contract is ready to consume.
- **Plan 50-03 can begin** for CLI + dashboard + heartbeat retention surfaces. `PERCENTILE_SQL`, `parseSinceDuration`, `sinceToIso`, `CANONICAL_SEGMENTS`, `LatencyReport` are all exported and ready.
- **No blockers identified.** The Wave 0 Summary correctly flagged that Wave 2 session-adapter work will need to switch to `BetaContentBlock` iteration — the types are already ready (`PERF-02` flows through `SpanRecord.metadata` as `Readonly<Record<string, unknown>>`).

## Self-Check: PASSED

All four created files exist at expected paths:
- `src/performance/types.ts` FOUND
- `src/performance/trace-store.ts` FOUND
- `src/performance/percentiles.ts` FOUND
- `src/performance/trace-collector.ts` FOUND

All three modified files carry the expected changes:
- `src/config/schema.ts` — `traceRetentionDays` present
- `src/config/loader.ts` — `perf` passthrough present
- `src/shared/types.ts` — `perf?:` + `traceRetentionDays` present

Both task commits exist in `git log --oneline`:
- `f610b55` FOUND
- `3d681d4` FOUND

All 25 Wave 0 performance tests GREEN. `npx vitest run src/performance src/config` exits 0 with 1171 tests passing.

---
*Phase: 50-latency-instrumentation*
*Plan: 01*
*Completed: 2026-04-13*
