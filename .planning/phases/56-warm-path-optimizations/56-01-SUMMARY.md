---
phase: 56-warm-path-optimizations
plan: 01
subsystem: infra
tags: [sqlite, sqlite-vec, embeddings, onnx, warmup, registry, daemon, readonly]

# Dependency graph
requires:
  - phase: 50-latency-instrumentation
    provides: TraceStore/trace_spans schema with ON DELETE CASCADE (warmup primes this join)
  - phase: 52-prompt-caching
    provides: SessionManager construction pattern (AgentMemoryManager singleton chain)
  - phase: 55-tool-call-overhead
    provides: Config extension pattern — append-don't-reshape for backward-compatible registry fields
provides:
  - runWarmPathCheck composite readiness helper with 10s timeout and scoped error aggregation
  - AgentMemoryManager.warmSqliteStores — READ-ONLY warmup queries across memories/usage/traces DBs
  - UsageTracker.getDatabase and TraceStore.getDatabase accessors (READ-ONLY use)
  - RegistryEntry optional warm_path_ready + warm_path_readiness_ms fields (backward-compat)
  - Daemon startup hard-fail embedder probe after warmupEmbeddings()
  - Verified singleton invariant: one production new EmbeddingService() in src/
affects: [56-02-ready-gate, 56-03-fleet-status, 57-future-warmup-telemetry]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-only per-agent SQLite warmup — query suite primes page cache + prepared statement plans without mutating on-disk state"
    - "Composite readiness helper with typed Deps injection + scoped error strings + 10s Promise.race timeout"
    - "Backward-compat registry schema extension via optional fields (undefined === pre-feature)"
    - "Hard-fail daemon startup for correctness-critical dependencies (embedder)"

key-files:
  created:
    - src/manager/warm-path-check.ts
    - src/manager/__tests__/warm-path-check.test.ts
    - src/manager/__tests__/session-memory-warmup.test.ts
    - src/manager/__tests__/daemon-warmup-probe.test.ts
  modified:
    - src/manager/session-memory.ts (added warmSqliteStores)
    - src/manager/types.ts (extended RegistryEntry with optional warm-path fields)
    - src/manager/registry.ts (createEntry defaults warm_path_ready=false, warm_path_readiness_ms=null)
    - src/manager/daemon.ts (embedder probe + ManagerError hard-fail path after warmupEmbeddings)
    - src/manager/__tests__/registry.test.ts (added defaults + updateEntry + legacy-JSON backward-compat tests)
    - src/usage/tracker.ts (added getDatabase accessor)
    - src/performance/trace-store.ts (added getDatabase accessor)

key-decisions:
  - "Use vec_memories (not memory_vec) in warmup MATCH query — the plan text referenced an incorrect table name; the real vec0 virtual table is vec_memories (src/memory/store.ts:475)"
  - "Use timestamp column (ISO text) for usage.db warmup filter — plan referenced created_at but actual UsageTracker schema uses timestamp (src/usage/tracker.ts:138)"
  - "Daemon probe uses manager.getEmbedder() rather than manager.memory.embedder — accessor already existed (src/manager/session-manager.ts:494)"
  - "Source-level grep tests for daemon wiring and singleton invariant — avoids booting the full startDaemon integration surface (sockets, Discord, SQLite files)"
  - "Per-step error scoping — each warm-path step pushes 'sqlite:' / 'embedder:' / 'session:' prefixed messages so operators can attribute partial failures"

patterns-established:
  - "READ-ONLY warmup invariant — enforced by a file-level grep test that re-reads session-memory.ts and scans warmSqliteStores body for INSERT/UPDATE/DELETE tokens"
  - "Frozen composite result objects — Object.freeze on result, durations_ms, and errors arrays (matches project readonly contract)"
  - "Optional registry schema extension — append optional fields, default to pre-feature state in createEntry, treat undefined === not-ready in consumers"
  - "Source-scan regression tests — pin the order of setup steps in large daemon bootstraps without booting the full daemon"

requirements-completed: [WARM-01, WARM-02, WARM-04]

# Metrics
duration: 18min
completed: 2026-04-14
---

# Phase 56 Plan 01: Warm-Path Foundations Summary

**Composite warm-path readiness helper (`runWarmPathCheck` + 10s timeout) plus READ-ONLY SQLite warmup across memories/usage/traces DBs, forward-compat registry schema, and a daemon-startup embedder probe that hard-fails on ONNX load failure.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-04-14T09:12:00Z
- **Completed:** 2026-04-14T09:18:00Z
- **Tasks:** 2
- **Files created:** 4
- **Files modified:** 7

## Accomplishments

- `src/manager/warm-path-check.ts` — `runWarmPathCheck(deps)` composite helper with Promise.race 10s timeout, per-step scoped error messages, and frozen result object.
- `AgentMemoryManager.warmSqliteStores(name)` — READ-ONLY warmup across 3 per-agent SQLite DBs (memories/usage/traces), returns frozen `{ memories_ms, usage_ms, traces_ms }`.
- `RegistryEntry` extended with optional `warm_path_ready?: boolean` + `warm_path_readiness_ms?: number | null` — legacy registries parse cleanly without these fields.
- `createEntry` defaults new fields to `false / null` (pre-check state until Plan 02 wires the gate).
- Daemon now runs `embedder.embed("warmup probe")` after `warmupEmbeddings()` and BEFORE `createIpcServer()`; on failure throws `ManagerError` — no graceful degradation.
- Verified singleton invariant via source-level scan: exactly one production `new EmbeddingService()` in `src/` (inside `AgentMemoryManager`, line 40).

## Task Commits

1. **Task 1: warmSqliteStores + warm-path-check composite helper** — `253a0a1` (feat — TDD RED→GREEN, 15 tests)
2. **Task 2: Extend RegistryEntry + daemon embedder probe hard-fail** — `35b685b` (feat — TDD RED→GREEN, 8 tests)

## Test Counts

| File | Tests | Status |
|------|-------|--------|
| `src/manager/__tests__/warm-path-check.test.ts` | 11 | all GREEN |
| `src/manager/__tests__/session-memory-warmup.test.ts` | 4 | all GREEN |
| `src/manager/__tests__/registry.test.ts` | +3 (total 17) | all GREEN |
| `src/manager/__tests__/daemon-warmup-probe.test.ts` | 5 | all GREEN |

**Wider regression scope:** `npx vitest run src/manager/ src/memory/ src/performance/` → **51 files, 635 tests, all passing.**

## Files Created/Modified

- `src/manager/warm-path-check.ts` — `runWarmPathCheck`, `WarmPathResult`, `WarmPathDurations`, `WarmPathDeps`, `WARM_PATH_TIMEOUT_MS=10_000`
- `src/manager/session-memory.ts` — `warmSqliteStores(name)` method; per-DB try/catch with DB-named error propagation
- `src/manager/types.ts` — `RegistryEntry` gains optional `warm_path_ready?`, `warm_path_readiness_ms?`
- `src/manager/registry.ts` — `createEntry` defaults new fields; `updateEntry` already accepts them via `Partial<>`
- `src/manager/daemon.ts` — Step "9b" probe after `warmupEmbeddings()`, before `createIpcServer()`, with `ManagerError` hard-fail
- `src/usage/tracker.ts` — `getDatabase(): DatabaseType` accessor
- `src/performance/trace-store.ts` — `getDatabase(): DatabaseType` accessor
- `src/manager/__tests__/warm-path-check.test.ts` — 11 tests
- `src/manager/__tests__/session-memory-warmup.test.ts` — 4 tests incl. source-level READ-ONLY grep
- `src/manager/__tests__/registry.test.ts` — 3 additional tests (defaults, updateEntry, legacy backward-compat)
- `src/manager/__tests__/daemon-warmup-probe.test.ts` — 5 tests (probe unit tests + source-scan wiring tests + singleton invariant scan)

## Verification Evidence

### READ-ONLY invariant (warmSqliteStores body)

```bash
$ awk '/async warmSqliteStores/,/^  \}$/' src/manager/session-memory.ts | grep -cE "INSERT|UPDATE|DELETE FROM"
0
```

### Singleton invariant (EmbeddingService construction sites)

```bash
$ grep -rn "new EmbeddingService" src/ --include="*.ts" | grep -v __tests__ | grep -v ".test.ts"
src/manager/session-memory.ts:40:  readonly embedder: EmbeddingService = new EmbeddingService();
```

**Exactly 1 production construction site.** Test-only constructions (`src/memory/__tests__/embedder.test.ts`) are excluded by design — each test needs a fresh instance for isolation.

### Composite helper exports

```bash
$ grep -cE "export (async )?function runWarmPathCheck|export const WARM_PATH_TIMEOUT_MS|export type WarmPathResult" src/manager/warm-path-check.ts
3
```

### Registry backward-compat

```bash
$ grep -cE "warm_path_ready\?:|warm_path_readiness_ms\?:" src/manager/types.ts
2
```

Source snippet:
```typescript
readonly warm_path_ready?: boolean;
readonly warm_path_readiness_ms?: number | null;
```

Plus a dedicated test (`registry.test.ts` — "readRegistry parses an entry missing warm_path_* fields") that writes a legacy JSON without either field, reads it back, and asserts the consumer default `entry.warm_path_ready ?? false === false`.

### Daemon probe wiring

```bash
$ grep -cE "embedder probe failed|embed\(\"warmup probe\"\)" src/manager/daemon.ts
3
```

Three hits: the `embed("warmup probe")` call + the `log.error(...)` + the `ManagerError` message. Source-level test pins the order: `warmupEmbeddings → probe → createIpcServer`.

### Frozen invariant in warm-path-check

```bash
$ grep -c "Object.freeze" src/manager/warm-path-check.ts
3
```

Three freezes: result object, nested `durations_ms`, and `errors` array.

## Decisions Made

1. **Use the correct SQLite table name `vec_memories`** — the plan text referenced `memory_vec`, but the real vec0 virtual table is `vec_memories` (see `src/memory/store.ts:475`). Using the plan's wrong name would have thrown at runtime.
2. **Use `timestamp` (not `created_at`) for usage.db warmup filter** — the plan text referenced `created_at`, but the actual `UsageTracker` schema (src/usage/tracker.ts:138) uses `timestamp`. I kept the intent (recent-cutoff read-only probe) with the correct column.
3. **Use `manager.getEmbedder()` in the daemon probe** — rather than `manager.memory.embedder` as the plan suggested. The accessor already exists (`src/manager/session-manager.ts:494`), so no new accessor needed.
4. **Source-level grep tests for daemon wiring** — rather than booting the full `startDaemon` integration surface. This gives us strong invariants (probe position, probe count, singleton count) without pulling in Discord/socket/DB fixtures.
5. **Per-step error scoping in `runWarmPathCheck`** — each step pushes its own `sqlite:` / `embedder:` / `session:` prefixed error so operators can attribute partial failures without log correlation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect SQL table name `memory_vec` → `vec_memories`**
- **Found during:** Task 1 implementation (running the warmup test)
- **Issue:** Plan specified `SELECT rowid FROM memory_vec WHERE embedding MATCH ? AND k = 1`. The actual sqlite-vec table in `src/memory/store.ts:475` is `vec_memories` with primary key `memory_id` (not `rowid`).
- **Fix:** Changed query to `SELECT memory_id FROM vec_memories WHERE embedding MATCH ? AND k = 1`. Also switched the parameter from `new Uint8Array(new Float32Array(384).buffer)` to `new Float32Array(384)` directly — matches how `SemanticSearch` (src/memory/search.ts:75) passes vectors to sqlite-vec.
- **Files modified:** src/manager/session-memory.ts
- **Verification:** "completes under 200ms with empty tables" test passes (no SQL error)
- **Committed in:** 253a0a1

**2. [Rule 1 - Bug] Fixed incorrect column name `created_at` → `timestamp` for usage.db warmup**
- **Found during:** Task 1 planning
- **Issue:** Plan specified `WHERE created_at > ?` on `usage_events`. Actual schema uses `timestamp` (src/usage/tracker.ts:138,149 idx).
- **Fix:** Used `WHERE timestamp > ?` with a 24-hour-ago ISO string (matching the existing `weeklyUsage` pattern at line 94-98 where `endDate.toISOString().replace("Z", "").slice(0, 19)` is used).
- **Files modified:** src/manager/session-memory.ts
- **Verification:** Warmup test passes; usage_ms duration > 0 when tracker exists
- **Committed in:** 253a0a1

**3. [Rule 3 - Blocking] Switched `glob` import to `node:fs` recursive walk in daemon-warmup-probe.test.ts**
- **Found during:** Task 2 RED phase
- **Issue:** I initially imported `globSync` from `glob`, but glob v11 does not export `globSync` in the expected shape for ESM (throws `globSync is not a function`). Project already uses glob, so installing wasn't needed — but the named export doesn't match.
- **Fix:** Wrote a small recursive `walkTs(dir)` helper using `node:fs` `readdirSync` + `statSync` that skips `__tests__` directories and `*.test.ts` files. Keeps the test zero-dependency on glob's API shape.
- **Files modified:** src/manager/__tests__/daemon-warmup-probe.test.ts
- **Verification:** singleton invariant test passes; correctly returns the single `session-memory.ts` hit
- **Committed in:** 35b685b

---

**Total deviations:** 3 auto-fixed (2 bugs in plan SQL, 1 blocking import)
**Impact on plan:** All three were critical correctness/blocking fixes discovered during execution. None expanded scope — each was a narrow fix to keep the planned behavior working. No architectural changes.

## Issues Encountered

- Pre-existing tsc errors across ~10 files (cli/latency, memory-lookup-handler, daemon cost-by-agent-model, etc.) — all in files I did NOT touch. Logged to `.planning/phases/56-warm-path-optimizations/deferred-items.md` for a future `/gsd:quick` pass. No file I modified added any new tsc error.

## Known Stubs

None. `runWarmPathCheck` takes real dependencies and does real work. The only deliberate no-op is the optional `sessionProbe` — which is documented as "Plan 02 wires a real check" in the JSDoc and in `56-01-PLAN.md <behavior>`. That is a wiring seam, not a stub.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plan 02 (ready-gate + fleet status) can now:**
- `await runWarmPathCheck({ agent, sqliteWarm: name => manager.memory.warmSqliteStores(name), embedder: manager.getEmbedder(), sessionProbe: ... })` inside `SessionManager.startAgent`
- Gate the `registry.status = "running"` write on `result.ready`
- Persist `result.total_ms` into `warm_path_readiness_ms` via `updateEntry(...)` — the schema already accepts it (backward-compat optional field)
- Surface `warm_path_ready` in `clawcode status` / `/clawcode-fleet` using the optional field (undefined → yellow/starting)

The composite helper is the single door Plan 02 opens. No new IPC method needed — the existing `status` method can surface the new fields once Plan 02 wires them.

---
*Phase: 56-warm-path-optimizations*
*Completed: 2026-04-14*

## Self-Check: PASSED

- All 4 source files + 2 planning files present on disk
- Both task commits (253a0a1, 35b685b) present in git log
- 23 new tests + 635 total tests across manager/memory/performance all GREEN
- Zero tsc errors in touched files (session-memory.ts, warm-path-check.ts, types.ts, registry.ts, daemon.ts, usage/tracker.ts, performance/trace-store.ts)
