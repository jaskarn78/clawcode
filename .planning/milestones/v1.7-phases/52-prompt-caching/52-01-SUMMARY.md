---
phase: 52-prompt-caching
plan: 01
subsystem: performance
tags: [cache-telemetry, sqlite, alter-table, migration, slo, session-adapter, cache-hit-rate]

# Dependency graph
requires:
  - phase: 50-01
    provides: TraceStore, TurnRecord, CANONICAL_SEGMENTS, PERCENTILE_SQL helper infrastructure
  - phase: 50-02
    provides: iterateWithTracing helper + caller-owned Turn lifecycle contract
  - phase: 51-01
    provides: DEFAULT_SLOS catalog + evaluateSloStatus pattern to mirror
provides:
  - ALTER TABLE migration (idempotent via PRAGMA table_info) adding 5 columns to traces table
  - TraceStore.getCacheTelemetry(agent, sinceIso) — returns totalTurns + avgHitRate + p50/p95 + totalCacheReads/Writes/Inputs + trendByDay[]
  - Turn.recordCacheUsage(snapshot) — buffered cache-telemetry capture, flushed with TurnRecord at end()
  - CacheTelemetrySnapshot / CacheTelemetryReport / CacheTrendPoint / CacheHitRateStatus types
  - CACHE_HIT_RATE_SLO constant (healthy ≥ 0.60, breach < 0.30) + evaluateCacheHitRateStatus helper
  - SdkResultSuccess/SdkResultError usage shape extended with cache_creation_input_tokens + cache_read_input_tokens
  - iterateWithTracing cache-capture block: reads msg.usage on result message, calls turn.recordCacheUsage
affects: [52-02, 52-03]

# Tech tracking
tech-stack:
  added: []  # No new runtime dependencies — all libs already present
  patterns:
    - "Idempotent ALTER TABLE via PRAGMA table_info(traces) column check — repeated daemon restarts never fail on duplicate columns"
    - "Per-turn cache snapshot buffered on Turn, spread into frozen TurnRecord at end() — single transaction preserved"
    - "In-JS percentile math over per-turn hit-rate floats (nearest-rank) — avoids SQLite expression-ordering quirks, N-small at agent scale"
    - "Ratio-based SLO evaluator distinct from DEFAULT_SLOS (gray-zone → no_data for warming-up state)"
    - "Cache-capture block mirrors extractUsage's try/catch silent-swallow — observational path MUST NEVER fail parent message"
    - "Missing SDK usage fields defaulted to 0 (not NaN/undefined) so downstream hit-rate denominator stays finite"
    - "WHERE input_tokens IS NOT NULL AND input_tokens > 0 separates Phase 52 cache-aware turns from Phase 50 legacy turns in same table"

key-files:
  created: []
  modified:
    - src/performance/types.ts
    - src/performance/trace-store.ts
    - src/performance/trace-collector.ts
    - src/performance/slos.ts
    - src/performance/__tests__/trace-store.test.ts
    - src/performance/__tests__/trace-collector.test.ts
    - src/performance/__tests__/slos.test.ts
    - src/manager/sdk-types.ts
    - src/manager/session-adapter.ts
    - src/manager/__tests__/session-adapter.test.ts

key-decisions:
  - "Phase 52 Plan 01 — 5 nullable columns (cache_read_input_tokens INTEGER, cache_creation_input_tokens INTEGER, input_tokens INTEGER, prefix_hash TEXT, cache_eviction_expected INTEGER 0/1) added via idempotent ALTER TABLE; Phase 50 turns remain queryable with NULL"
  - "Phase 52 Plan 01 — PRAGMA table_info(traces) column-existence check runs BEFORE each ALTER TABLE so repeated TraceStore construction on same db path is safe (verified by dedicated test)"
  - "Phase 52 Plan 01 — insertTrace expanded from 7-arg to 12-arg positional bind (kept positional convention for INSERT like Phase 50); named bind params preserved for percentile SQL + cache-telemetry window queries"
  - "Phase 52 Plan 01 — getCacheTelemetry percentile math is in-JS (nearest-rank sort + index) rather than SQL ROW_NUMBER over derived hit-rate expression; N-small at agent scale makes JS pass cheaper and clearer"
  - "Phase 52 Plan 01 — three prepared statements for cache telemetry (cacheTelemetryRows / cacheTelemetryAggregates / cacheTelemetryTrend) share the same WHERE clause (agent + since + input_tokens > 0) — single source of truth for cache-aware-turn filter"
  - "Phase 52 Plan 01 — WHERE input_tokens IS NOT NULL AND input_tokens > 0 acts as a dual filter: excludes Phase 50 legacy turns (NULL) AND excludes warm-up turns with zero input tokens (no cache signal) without needing a separate boolean column"
  - "Phase 52 Plan 01 — CacheTelemetryReport's 8 fields front-load surface needs for Plan 52-03 (totalCacheReads/Writes/InputTokens aggregates) so 52-03 never needs a second DB pass — mirrors LatencyReport one-call contract"
  - "Phase 52 Plan 01 — Turn.cacheSnapshot field starts undefined; spread into TurnRecord at end() ONLY when populated, so legacy Phase 50 turns land without the 5 new fields (not with undefined-value fields)"
  - "Phase 52 Plan 01 — recordCacheUsage is idempotent overwrite (second call replaces first); commit guard checks this.committed so post-end calls no-op silently"
  - "Phase 52 Plan 01 — CACHE_HIT_RATE_SLO lives as a separate export (not in DEFAULT_SLOS) because DEFAULT_SLOS entries are millisecond thresholds and CACHE_HIT_RATE is a ratio (0..1); different evaluator semantics (healthy≥0.60, breach<0.30, gray→no_data)"
  - "Phase 52 Plan 01 — gray zone (0.30..0.60) deliberately returns no_data = warming-up state; dashboard renders neutral tint so operators are not distracted while cache is establishing its prefix"
  - "Phase 52 Plan 01 — CacheHitRateStatus moved to types.ts (not slos.ts) and re-exported from slos.ts so future circular-import concerns are avoided (mirrors SloStatus pattern from Phase 51 Plan 03)"
  - "Phase 52 Plan 01 — session-adapter cache-capture block wrapped in try/catch mirroring extractUsage's silent-swallow — cache observability MUST NEVER break the message path (invariant from Phase 50)"
  - "Phase 52 Plan 01 — missing SDK usage fields coerced to 0 (not undefined/NaN) so downstream hit-rate denominator stays finite; typeof === 'number' guard avoids NaN propagation on malformed SDK payloads"
  - "Phase 52 Plan 01 — cache-capture block sits BETWEEN extractUsage and closeAllSpans inside iterateWithTracing's result branch; placement verified by grep pattern (extractUsage...recordCacheUsage adjacent)"
  - "Phase 52 Plan 01 — Caller-owned Turn lifecycle invariant from Phase 50 Plan 02 preserved: zero turn.end() calls in session-adapter.ts (grep returns 0 actual invocations; 4 doc-comment mentions remain)"

patterns-established:
  - "Pattern: PRAGMA table_info column-existence check before ALTER TABLE — idempotent SQLite migration for any future schema additions without version tracking"
  - "Pattern: Dual-filter WHERE (IS NOT NULL AND > 0) — separates legacy rows (NULL) from warm-up rows (0) without a separate boolean flag column"
  - "Pattern: Buffered per-turn snapshot spread into frozen TurnRecord — add optional fields to TurnRecord + private buffer field on Turn + spread at end() preserves single-transaction commit"
  - "Pattern: Ratio-based SLO with gray-zone neutral state — evaluateCacheHitRateStatus demonstrates how to express warming-up / indeterminate states distinct from healthy/breach"
  - "Pattern: Observational capture with silent-swallow try/catch — cache-capture mirrors extractUsage, both MUST NEVER fail the parent message path (invariant from Phase 50)"

requirements-completed: []  # CACHE-03 is foundation-only here; full closure ships with 52-03 (CLI/dashboard surfaces)

# Metrics
duration: 8m 22s
completed: 2026-04-13
---

# Phase 52 Plan 01: Cache Telemetry Data Plane Summary

**Per-turn cache-telemetry capture from SDK result message through TraceCollector into TraceStore: idempotent ALTER TABLE migration adding 5 columns (cache_read_input_tokens / cache_creation_input_tokens / input_tokens / prefix_hash / cache_eviction_expected), getCacheTelemetry query method returning 8-field CacheTelemetryReport, CACHE_HIT_RATE_SLO (healthy ≥ 0.60 / breach < 0.30) + evaluateCacheHitRateStatus, session-adapter cache capture wired inside iterateWithTracing's result branch.**

## Performance

- **Duration:** ~8 min 22 sec
- **Started:** 2026-04-13T22:33:44Z
- **Completed:** 2026-04-13T22:42:06Z
- **Tasks:** 2 (both `auto` + `tdd`, no checkpoints)
- **Files modified:** 10 (0 created + 10 edited)

## Accomplishments

- **Idempotent ALTER TABLE migration.** `TraceStore.migrateSchema()` (new private method) runs `PRAGMA table_info(traces)` to collect existing column names, then issues `ALTER TABLE traces ADD COLUMN` ONLY for columns not already present. Repeated daemon restarts on an already-upgraded `traces.db` do NOT throw "duplicate column" errors. Five columns added in order: `cache_read_input_tokens INTEGER`, `cache_creation_input_tokens INTEGER`, `input_tokens INTEGER`, `prefix_hash TEXT`, `cache_eviction_expected INTEGER`. Phase 50/51 rows land NULL in the new columns and remain queryable.
- **insertTrace expanded from 7-arg to 12-arg positional.** `writeTurn` now passes `turn.cacheReadInputTokens ?? null`, `turn.cacheCreationInputTokens ?? null`, `turn.inputTokens ?? null`, `turn.prefixHash ?? null`, and `turn.cacheEvictionExpected` as `null | 0 | 1`. Called inside the same single-transaction flow as Phase 50 — no extra writes.
- **TraceStore.getCacheTelemetry delivered with 8 fields.** Query API: `{ agent, since, totalTurns, avgHitRate, p50HitRate, p95HitRate, totalCacheReads, totalCacheWrites, totalInputTokens, trendByDay[] }`. Three prepared statements share the `agent + since + input_tokens > 0` WHERE clause: per-turn rows (for in-JS percentile math), aggregate sums, per-day trend. Mirrors `LatencyReport` symmetry so Plan 52-03 CLI/dashboard formatters stay aligned with `clawcode latency`.
- **Turn.recordCacheUsage delivered.** Buffered private field `cacheSnapshot` on `Turn`; `recordCacheUsage(snapshot)` is idempotent (second call overwrites); spread into the frozen `TurnRecord` at `end()` ONLY when the snapshot was recorded. Turns that never received a snapshot produce TurnRecords without the 5 cache fields (legacy shape preserved).
- **CACHE_HIT_RATE_SLO + evaluateCacheHitRateStatus delivered.** Ratio-based SLO distinct from `DEFAULT_SLOS` (ms thresholds). Gray zone (0.30..0.60) returns `"no_data"` — the warming-up neutral tint. `CacheHitRateStatus` moved to `types.ts` (mirrors Phase 51 Plan 03 pattern where `SloStatus`/`SloMetric` moved to break future circular-import risk) and re-exported from `slos.ts`.
- **SDK result-message usage shape extended.** Both `SdkResultSuccess.usage` and `SdkResultError.usage` now declare `cache_creation_input_tokens?: number` and `cache_read_input_tokens?: number` (snake_case — matches BetaUsage). session-adapter reads these on the `result` branch of `iterateWithTracing` and calls `turn.recordCacheUsage` with the camelCase TurnRecord field names.
- **Cache-capture block placement verified.** Inside `iterateWithTracing`'s `if (msg.type === "result")` branch, the block sits BETWEEN `extractUsage(msg, usageCallback)` and `closeAllSpans()`. Wrapped in `try/catch` mirroring `extractUsage`'s silent-swallow contract — cache observability MUST NEVER fail the parent message path.
- **Caller-owned Turn lifecycle invariant preserved.** `grep -c "turn\?\.end\|turn\.end" src/manager/session-adapter.ts` returns 4 matches — all in doc comments documenting the invariant. Zero actual `turn.end()` or `turn?.end()` call sites. The Phase 50 Plan 02 contract that DiscordBridge/Scheduler own Turn lifecycle remains unbroken.
- **Zero new runtime dependencies.** All types, SQL, and test harness built atop existing `better-sqlite3@12.8.0`, `zod@4.3.6`, `vitest`. 

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema + types + telemetry snapshot plumbing** — `74cb674` (feat)
   - `src/performance/types.ts` — 5 optional fields on `TurnRecord` + 4 new exports (`CacheTelemetrySnapshot`, `CacheTrendPoint`, `CacheTelemetryReport`, `CacheHitRateStatus`)
   - `src/performance/trace-store.ts` — idempotent `migrateSchema` + 12-arg `insertTrace` + `getCacheTelemetry` + 3 new prepared statements
   - `src/performance/trace-collector.ts` — `cacheSnapshot` field + `recordCacheUsage` method + spread-at-end logic
   - `src/performance/__tests__/trace-store.test.ts` — 6 new tests (idempotent migration, writeTurn-with-cache, writeTurn-without-cache, getCacheTelemetry shape, zeros/empty, aggregates, skip-no-signal)
   - `src/performance/__tests__/trace-collector.test.ts` — 3 new tests (recordCacheUsage-stores, idempotent-overwrite, undefined-when-not-recorded)
   - Test count delta: +9 tests (25 total in trace-store + trace-collector scoped suite)
2. **Task 2: CACHE_HIT_RATE SLO + session-adapter usage capture** — `b46a09c` (feat)
   - `src/performance/slos.ts` — `CacheHitRateSloEntry` + `CACHE_HIT_RATE_SLO` constant + `evaluateCacheHitRateStatus` function + `CacheHitRateStatus` re-export
   - `src/manager/sdk-types.ts` — `cache_creation_input_tokens` + `cache_read_input_tokens` added to both `SdkResultSuccess.usage` and `SdkResultError.usage`
   - `src/manager/session-adapter.ts` — cache-capture block inside `iterateWithTracing` result branch (between `extractUsage` and `closeAllSpans`)
   - `src/performance/__tests__/slos.test.ts` — 5 new tests in `CACHE_HIT_RATE_SLO (Phase 52)` describe block (shape/frozen, no_data/turns=0, healthy, breach, gray-zone)
   - `src/manager/__tests__/session-adapter.test.ts` — 3 new tests in `cache usage capture (Phase 52)` describe block (recordCacheUsage called with captured values, no-throw with undefined turn, missing fields → 0)
   - Test count delta: +8 tests (271 total in full plan verification suite)

## Files Created/Modified

### Modified

| Path | Change |
|------|--------|
| `src/performance/types.ts` | Added 5 optional cache fields to `TurnRecord` (cacheReadInputTokens, cacheCreationInputTokens, inputTokens, prefixHash, cacheEvictionExpected) + 4 new exports (`CacheTelemetrySnapshot`, `CacheTrendPoint`, `CacheTelemetryReport`, `CacheHitRateStatus`) |
| `src/performance/trace-store.ts` | New private `migrateSchema()` (PRAGMA + ALTER TABLE idempotent); constructor calls it after `initSchema()`; `insertTrace` expanded from 7-arg to 12-arg positional; `writeTurn` passes 5 new fields with `?? null` fallback; 3 new prepared statements (`cacheTelemetryRows`, `cacheTelemetryAggregates`, `cacheTelemetryTrend`); new `getCacheTelemetry(agent, sinceIso)` method returning frozen `CacheTelemetryReport` |
| `src/performance/trace-collector.ts` | Added `CacheTelemetrySnapshot` import; new private `cacheSnapshot` field on `Turn`; new `recordCacheUsage(snapshot)` method (idempotent + post-end guard); `end(status)` spreads snapshot fields into frozen `TurnRecord` when present |
| `src/performance/slos.ts` | Added `CacheHitRateStatus` import from `types.js` + re-export; new `CacheHitRateSloEntry` type; new `CACHE_HIT_RATE_SLO` frozen constant ({ healthyMin: 0.6, breachMax: 0.3 }); new `evaluateCacheHitRateStatus(hitRate, turns)` function with 4-state logic (no_data / healthy / breach / gray-zone → no_data) |
| `src/performance/__tests__/trace-store.test.ts` | Appended `TraceStore cache telemetry (Phase 52)` describe block with 6 tests |
| `src/performance/__tests__/trace-collector.test.ts` | Appended `Turn.recordCacheUsage (Phase 52)` describe block with 3 tests |
| `src/performance/__tests__/slos.test.ts` | Appended `CACHE_HIT_RATE_SLO (Phase 52)` describe block with 5 tests |
| `src/manager/sdk-types.ts` | Added `cache_creation_input_tokens?: number` + `cache_read_input_tokens?: number` to `SdkResultSuccess.usage` AND `SdkResultError.usage` shapes |
| `src/manager/session-adapter.ts` | Inside `iterateWithTracing` `if (msg.type === "result")` branch: cache-capture block (try/catch wrapped) between `extractUsage(msg, usageCallback)` and `closeAllSpans()` — reads `msg.usage.cache_read_input_tokens` / `cache_creation_input_tokens` / `input_tokens` with `typeof === 'number'` guards defaulting to 0, calls `turn.recordCacheUsage({...})` with camelCase fields |
| `src/manager/__tests__/session-adapter.test.ts` | Extended `MockTurn` type + `createMockTurn` factory with `recordCacheUsage` vi.fn; appended `cache usage capture (Phase 52)` describe block with 3 tests |

## Key Public API

```typescript
// src/performance/types.ts (EXTENDED)
export type TurnRecord = {
  // ... existing Phase 50 fields ...
  readonly cacheReadInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly inputTokens?: number;
  readonly prefixHash?: string;              // Set by Plan 52-02
  readonly cacheEvictionExpected?: boolean;  // Set by Plan 52-02
};

// src/performance/types.ts (NEW exports)
export type CacheTelemetrySnapshot = {
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly inputTokens: number;
  readonly prefixHash?: string;
  readonly cacheEvictionExpected?: boolean;
};

export type CacheTrendPoint = {
  readonly date: string;  // YYYY-MM-DD
  readonly turns: number;
  readonly hitRate: number;
};

export type CacheTelemetryReport = {
  readonly agent: string;
  readonly since: string;
  readonly totalTurns: number;
  readonly avgHitRate: number;
  readonly p50HitRate: number;
  readonly p95HitRate: number;
  readonly totalCacheReads: number;
  readonly totalCacheWrites: number;
  readonly totalInputTokens: number;
  readonly trendByDay: readonly CacheTrendPoint[];
};

export type CacheHitRateStatus = "healthy" | "breach" | "no_data";

// src/performance/trace-store.ts (EXTENDED)
class TraceStore {
  // ... existing Phase 50 methods ...
  getCacheTelemetry(agent: string, sinceIso: string): CacheTelemetryReport;
}

// src/performance/trace-collector.ts (EXTENDED)
class Turn {
  // ... existing Phase 50 methods ...
  recordCacheUsage(snapshot: CacheTelemetrySnapshot): void;  // idempotent overwrite + post-end no-op
}

// src/performance/slos.ts (NEW exports)
export type CacheHitRateSloEntry = {
  readonly healthyMin: number;  // 0.60
  readonly breachMax: number;   // 0.30
};
export const CACHE_HIT_RATE_SLO: CacheHitRateSloEntry;  // frozen
export function evaluateCacheHitRateStatus(
  hitRate: number,
  turns: number,
): CacheHitRateStatus;
```

## Migration Strategy Evidence

The `migrateSchema()` method in `src/performance/trace-store.ts` is idempotent by construction:

```typescript
private migrateSchema(): void {
  const existing = new Set<string>(
    (this.db.prepare("PRAGMA table_info(traces)").all() as ReadonlyArray<{
      readonly name: string;
    }>).map((r) => r.name),
  );
  const additions: ReadonlyArray<readonly [string, string]> = [
    ["cache_read_input_tokens", "INTEGER"],
    ["cache_creation_input_tokens", "INTEGER"],
    ["input_tokens", "INTEGER"],
    ["prefix_hash", "TEXT"],
    ["cache_eviction_expected", "INTEGER"],
  ];
  for (const [col, type] of additions) {
    if (!existing.has(col)) {
      this.db.exec(`ALTER TABLE traces ADD COLUMN ${col} ${type}`);
    }
  }
}
```

This is dedicated-tested by `it("ALTER TABLE migration is idempotent across repeated constructions")` in `trace-store.test.ts` — the test constructs `TraceStore` 3 times on the same `dbPath` and asserts none of the constructions throw. Verified green on first pass.

## SDK Result-Message Usage Shape

Both `SdkResultSuccess.usage` and `SdkResultError.usage` now declare:

```typescript
readonly usage?: {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;  // NEW in Phase 52
  readonly cache_read_input_tokens?: number;      // NEW in Phase 52
};
```

session-adapter reads these using the snake_case SDK field names (matches BetaUsage) and calls `turn.recordCacheUsage` with camelCase TurnRecord field names:

```typescript
turn.recordCacheUsage({
  cacheReadInputTokens: cacheRead,
  cacheCreationInputTokens: cacheCreation,
  inputTokens: input,
});
```

The snake_case → camelCase translation lives in the adapter boundary (correct place) so domain types stay camelCase throughout.

## Test Counts

| Test File | Pre-existing | New in Plan 52-01 | Total | Status |
|-----------|--------------|-------------------|-------|--------|
| `src/performance/__tests__/trace-store.test.ts` | 8 | 6 | 14 | GREEN |
| `src/performance/__tests__/trace-collector.test.ts` | 7 | 3 | 10 | GREEN |
| `src/performance/__tests__/slos.test.ts` | 7 | 5 | 12 | GREEN |
| `src/manager/__tests__/session-adapter.test.ts` | 5 | 3 | 8 | GREEN |
| **Plan 52-01 new tests** | — | **17** | — | **17 / 17 GREEN** |
| `src/performance + session-adapter + session-manager + daemon-latency-slo` (full verification) | — | — | **271** | **271 / 271 GREEN** |

## Example TurnRecord Shape (Post-Plan-52-01)

Cache-aware turn (session-adapter captured usage):

```typescript
const record: TurnRecord = {
  id: "msg-abc123",
  agent: "clawdy",
  channelId: "1234567890",
  startedAt: "2026-04-13T22:40:00.000Z",
  endedAt:   "2026-04-13T22:40:01.500Z",
  totalMs: 1500,
  status: "success",
  spans: [ /* ... canonical spans ... */ ],
  // Phase 52 Plan 01 (populated by Turn.recordCacheUsage):
  cacheReadInputTokens: 500,
  cacheCreationInputTokens: 100,
  inputTokens: 50,
  // Phase 52 Plan 02 (NOT YET POPULATED — remain undefined):
  // prefixHash: undefined,
  // cacheEvictionExpected: undefined,
};
```

Legacy Phase 50 turn (no usage captured — recordCacheUsage never called):

```typescript
const record: TurnRecord = {
  id: "msg-xyz789",
  agent: "clawdy",
  channelId: "1234567890",
  startedAt: "2026-04-13T22:40:00.000Z",
  endedAt:   "2026-04-13T22:40:01.500Z",
  totalMs: 1500,
  status: "success",
  spans: [ /* ... canonical spans ... */ ],
  // All 5 cache fields undefined — TurnRecord omits them entirely on the
  // SQLite row (columns land NULL).
};
```

## Decisions Made

- **Idempotent ALTER TABLE via PRAGMA check.** Runs `PRAGMA table_info(traces)` once at construction, builds `Set<string>` of existing column names, issues `ALTER TABLE ADD COLUMN` ONLY for columns not present. This means ANY number of daemon restarts on an already-upgraded traces.db complete cleanly. No version tracking table needed.
- **insertTrace expanded to 12-arg positional.** Kept positional bind convention for INSERT (Phase 50 Plan 01 decision: positional for INSERT, named for DELETE/SELECT percentile). The 5 new columns append to the existing 7 positional args in the same order the `VALUES (...)` clause expects them.
- **In-JS percentile math for cache hit rate.** Used nearest-rank sort + index rather than SQLite ROW_NUMBER over a derived expression. Rationale: (1) SQLite window expressions over computed floats are trickier to assert; (2) N-small at agent scale (tens of thousands of cache-aware turns across retention window); (3) one-pass JS sort is cheaper than ROW_NUMBER subquery at these sizes.
- **Three prepared statements share the same WHERE clause.** All three (`cacheTelemetryRows`, `cacheTelemetryAggregates`, `cacheTelemetryTrend`) filter on `agent = @agent AND started_at >= @since AND input_tokens IS NOT NULL AND input_tokens > 0`. Keeping them as separate prepared statements (not one union) makes each query's purpose obvious and lets SQLite optimize each independently.
- **`input_tokens IS NOT NULL AND > 0` is the dual filter.** Excludes Phase 50 legacy turns (NULL) AND warm-up turns with zero input tokens (no cache signal) without needing a separate boolean column. The single WHERE clause expresses both semantics cleanly.
- **8 fields on CacheTelemetryReport front-load Plan 52-03 needs.** Adding `totalCacheReads` / `totalCacheWrites` / `totalInputTokens` now means Plan 52-03 CLI (`clawcode cache`) and dashboard (`/api/agents/:name/cache`) never need a second pass over the DB. Mirrors `LatencyReport` one-call contract.
- **Turn.cacheSnapshot starts undefined; spread ONLY when populated.** A Turn whose session-adapter never called `recordCacheUsage` produces a TurnRecord WITHOUT the 5 cache fields (not with undefined values on them). This preserves Phase 50 shape exactly for legacy code paths.
- **CACHE_HIT_RATE_SLO is a separate export.** Not in `DEFAULT_SLOS` because DEFAULT_SLOS entries are millisecond thresholds (`SloEntry.thresholdMs`) and cache hit rate is a ratio. Different evaluator semantics (ratio + gray zone) mean distinct type + distinct evaluator function.
- **Gray zone (0.30..0.60) → `no_data`.** Deliberately neutral — the dashboard shows a gray tint for "warming up" state. Operators should not be distracted by a yellow/amber badge while the cache is establishing its prefix. Once the cache catches up, hit rate jumps past 0.60 and goes green.
- **CacheHitRateStatus moved to types.ts.** Mirrors the Phase 51 Plan 03 pattern where SloStatus and SloMetric were moved to types.ts (and re-exported from slos.ts) so PercentileRow can reference them without a circular import. Pre-emptively avoids the same cycle risk for any future type that references CacheHitRateStatus.
- **Cache-capture try/catch mirrors extractUsage.** The session-adapter's existing `extractUsage` is wrapped in try/catch with silent swallow (comment: "Never break the send flow due to usage extraction failure"). The new cache-capture block uses the same contract — observational capture MUST NEVER break the message path. Invariant from Phase 50.
- **Missing SDK usage fields default to 0.** `typeof u.X === 'number' ? u.X : 0` — coerces malformed SDK payloads to 0 rather than undefined/NaN. Downstream hit-rate denominator stays finite. Tested by `it("treats missing usage fields as 0")` with empty `usage: {}`.
- **Cache-capture block placement: BETWEEN extractUsage and closeAllSpans.** Inside `iterateWithTracing`'s result branch, the block fires AFTER `extractUsage` so usage callback gets tokens first, and BEFORE `closeAllSpans` so the Turn is still the active trace context. Verified by grep pattern — the two adjacent blocks appear within 25 lines of each other.
- **Caller-owned Turn lifecycle preserved.** Zero actual `turn.end()` invocations in session-adapter.ts. The 4 grep matches are all doc-comment mentions documenting the invariant. Phase 50 Plan 02 contract (DiscordBridge/Scheduler own lifecycle) remains unbroken.

## Deviations from Plan

None — plan executed exactly as written. All 17 new tests passed on first GREEN run; no auto-fix cycles needed.

### Auto-fixed Issues

None.

## Authentication Gates

None — Plan 52-01 is library-level code with no network calls, no daemon interaction, no Discord, no external services. The mocked-SDK test harness carries synthetic usage fields; no real Anthropic OAuth required.

## Issues Encountered

- **Pre-existing tsc error at `src/manager/session-adapter.ts:450`.** `error TS2367: This comparison appears to be unintentional because the types '"assistant" | "result"' and '"user"' have no overlap.` Verified pre-existing via `git stash && npx tsc --noEmit` on the unmodified working tree (identical error). Introduced in Phase 50 Plan 02 commit `5904bd4` when tool_call span-closing was added via the "user" message check. The local `SdkStreamMessage` union is narrower than the SDK's actual runtime shape (the SDK emits "user" messages with `parent_tool_use_id` carrying tool_use_results). This is a local-types vs runtime-shape mismatch that would require extending `SdkStreamMessage` to include `SdkUserMessage` (or a dedicated `SdkToolResultUserMessage`). **Out of scope for Plan 52-01.** Logged to deferred-items for a future sdk-types cleanup phase.
- **No other issues during execution.**

## Deferred Issues

- **Pre-existing session-adapter `SdkStreamMessage` union narrowness.** See Issues Encountered above. Requires sdk-types.ts cleanup — extending `SdkStreamMessage` to include user messages with `parent_tool_use_id`. Out of scope for cache-telemetry plan.

## User Setup Required

None — Plan 52-01 is library-level. The new `cache_control` columns are added automatically on next TraceStore construction (idempotent migration). Plan 52-02 will introduce the context-assembler changes that populate `prefix_hash` / `cache_eviction_expected`; Plan 52-03 will expose the CLI + dashboard surfaces.

## Next Phase Readiness

- **Plan 52-02 can begin.** `Turn.recordCacheUsage` accepts an optional `prefixHash` + `cacheEvictionExpected` in the snapshot shape already, so Plan 52-02's context-assembler changes have a place to land them. The `traces` table already carries the two columns (populated NULL by this plan's writeTurn path). Plan 52-02's job is to split `ContextAssembler.assemble` into `{ stablePrefix, mutableSuffix }` and compute `sha256(stablePrefix)` per turn; the store wiring is ready.
- **Plan 52-03 can begin.** `TraceStore.getCacheTelemetry(agent, sinceIso)` is importable and returns all 8 fields Plan 52-03 needs for the CLI (`clawcode cache`) and dashboard (`/api/agents/:name/cache`) surfaces. `CACHE_HIT_RATE_SLO` + `evaluateCacheHitRateStatus` are importable from `src/performance/slos.ts`.
- **Phase 50/51 regression check passed.** All 25 trace-store/trace-collector tests still GREEN; all 12 slos tests (including Phase 50 DEFAULT_SLOS + Phase 51 mergeSloOverrides) still GREEN; 5 session-adapter tracing tests (Phase 50 Plan 02 invariants) still GREEN. Caller-owned Turn lifecycle invariant preserved (zero `turn.end()` invocations in session-adapter.ts).

## Known Stubs

**None.** All code paths are wired end-to-end — `prefix_hash` and `cache_eviction_expected` remain NULL in the database because Plan 52-02 has not yet wired the context-assembler changes. This is intentional and planned. The five new columns accept NULL via the schema definition, and `writeTurn` passes `null` for all unpopulated fields so Phase 50/51 turns and Phase 52 cache-only turns all commit cleanly.

**Explicit statement:** `prefix_hash` and `cache_eviction_expected` remain NULL until Plan 52-02 wires the context-assembler changes.

## Self-Check: PASSED

All 10 modified files carry the expected changes:
- `src/performance/types.ts` — `CacheTelemetrySnapshot` (1), `CacheTelemetryReport` (1), `cacheReadInputTokens` (2), `prefixHash` (4), `totalCacheReads|Writes|InputTokens` (3) — VERIFIED via grep
- `src/performance/trace-store.ts` — `PRAGMA table_info(traces)` (2, 1 doc + 1 code), `ALTER TABLE traces ADD COLUMN` (1), `getCacheTelemetry` (2, declaration + body) — VERIFIED via grep
- `src/performance/trace-collector.ts` — `recordCacheUsage` present in method declaration + spread at end() — VERIFIED
- `src/performance/slos.ts` — `healthyMin: 0.6` (1), `breachMax: 0.3` (1), `CACHE_HIT_RATE_SLO` exported, `evaluateCacheHitRateStatus` exported — VERIFIED
- `src/manager/sdk-types.ts` — `cache_read_input_tokens` (3: SdkResultSuccess.usage + SdkResultError.usage + comment) — VERIFIED
- `src/manager/session-adapter.ts` — `recordCacheUsage` (2: 1 doc + 1 call site), zero `turn.end()` call sites — VERIFIED

Both task commits exist in `git log --oneline`:
- `74cb674` FOUND (Task 1: schema + types + telemetry snapshot plumbing)
- `b46a09c` FOUND (Task 2: CACHE_HIT_RATE SLO + session-adapter cache usage capture)

All 17 new Plan 52-01 tests GREEN. `npx vitest run src/performance src/manager/__tests__/session-adapter.test.ts src/manager/__tests__/session-manager.test.ts src/manager/__tests__/daemon-latency-slo.test.ts` exits 0 with 271 / 271 tests passing.

`npx tsc --noEmit` shows ZERO errors in any Plan 52-01-modified file (trace-store, trace-collector, types, slos, sdk-types) — confirmed via grep filter. The single pre-existing tsc error at session-adapter.ts:450 (SdkStreamMessage union narrowness for "user" check) is documented in Issues Encountered as out-of-scope / pre-existing.

---
*Phase: 52-prompt-caching*
*Plan: 01*
*Completed: 2026-04-13*
