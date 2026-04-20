---
phase: 80-memory-translation-re-embedding
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, memory-store, idempotency, schema-migration, tdd]

# Dependency graph
requires:
  - phase: 75-shared-workspace-runtime-support
    provides: memoryPath config + per-agent memories.db convention
provides:
  - origin_id TEXT column on memories table with UNIQUE partial index
  - CreateMemoryInput.origin_id optional field (additive, backward-compat)
  - MemoryStore.insert() INSERT OR IGNORE path for idempotent imports
  - getByOriginId prepared statement for collision read-back
  - CHECK-constraint preservation guard for non-origin_id inserts
affects:
  - 80-02-memory-translator (uses insert(..., origin_id) for path-hash idempotency)
  - 80-03-runApplyAction-integration (inherits zero-raw-SQL guarantee)
  - 81-verify-rollback (rollback via DELETE WHERE origin_id LIKE pattern)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Schema migration via PRAGMA table_info + ALTER TABLE ADD COLUMN (idempotent, matches migrateSourceTurnIds)"
    - "UNIQUE partial index with WHERE origin_id IS NOT NULL (explicit NULL-coexistence)"
    - "INSERT OR IGNORE + result.changes === 0 → read-back (idempotency-by-hash pattern)"
    - "CHECK-constraint guard: changes===0 without origin_id re-raises as MemoryError"

key-files:
  created: []
  modified:
    - src/memory/types.ts
    - src/memory/store.ts
    - src/memory/__tests__/store.test.ts

key-decisions:
  - "Partial UNIQUE index (WHERE origin_id IS NOT NULL) chosen over plain UNIQUE — intent-explicit and smaller index"
  - "origin_id path skips dedup entirely — idempotency-by-hash is the contract, not content-similarity merging"
  - "INSERT OR IGNORE re-raises when !hasOriginId to preserve CHECK-constraint validation (invalid source values must still throw)"
  - "insertVec is skipped on origin_id collision — no orphan vec_memories rows for ignored inserts"
  - "getByOriginId reads the full row and returns via rowToEntry — collisions receive the FIRST row's timestamps (CLI upserted-vs-skipped contract)"

patterns-established:
  - "origin_id column migration: PRAGMA-check + ALTER TABLE + CREATE UNIQUE INDEX IF NOT EXISTS — follow for future idempotency columns"
  - "MemoryStore.insert() is the single supported write path — Plans 02/03 and future migrations inherit the zero-raw-vec-SQL guarantee"

requirements-completed:
  - MEM-02
  - MEM-03

# Metrics
duration: 14min
completed: 2026-04-20
---

# Phase 80 Plan 01: origin_id UNIQUE Idempotency at the MemoryStore Layer Summary

**Additive origin_id UNIQUE primitive on the memories table with INSERT OR IGNORE bifurcation in MemoryStore.insert(), closing MEM-02/MEM-03 so Plans 02/03 inherit path-hash idempotency and the zero-raw-vec-SQL guarantee for free.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-04-20T21:01:24Z
- **Completed:** 2026-04-20T21:15:26Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- origin_id TEXT column added to memories via idempotent migration following migrateSourceTurnIds pattern
- Partial UNIQUE index (WHERE origin_id IS NOT NULL) allows pre-existing NULL rows to coexist
- CreateMemoryInput.origin_id optional field — 100% backward-compat with all existing call sites
- MemoryStore.insert() routes origin_id path through INSERT OR IGNORE + getByOriginId read-back
- Dedup (content-similarity merging) correctly SKIPPED when origin_id is present
- vec_memories write correctly SKIPPED on origin_id collision — no orphan vectors
- 10 new tests pin the complete contract (5 schema + 5 insert semantics)
- Full memory suite 381/381 green (net +10 from Plan 80-01)

## Task Commits

Each task used a RED → GREEN TDD cycle:

1. **Task 1 RED: failing tests for origin_id column + UNIQUE index** — `7e0cb34` (test)
2. **Task 1 GREEN: add origin_id column + UNIQUE partial index** — `220a9d4` (feat)
3. **Task 2 RED: failing tests for INSERT OR IGNORE path** — `0417615` (test)
4. **Task 2 GREEN: implement origin_id idempotency path in insert()** — `f066598` (feat, includes one deviation auto-fix)

No refactor cycle was needed for either task — both landed clean.

## Files Created/Modified
- `src/memory/types.ts` — added optional readonly `origin_id?: string` on `CreateMemoryInput` with full JSDoc explaining the idempotency contract
- `src/memory/store.ts` — added `migrateOriginIdColumn()` method, wired into constructor migrate chain, extended `PreparedStatements` with `getByOriginId`, changed `insertMemory` to `INSERT OR IGNORE`, bifurcated `insert()` on `hasOriginId`, added CHECK-constraint guard
- `src/memory/__tests__/store.test.ts` — new `describe("origin_id idempotency (Phase 80 MEM-02)")` block with 10 tests

## Decisions Made
- **Partial UNIQUE index** (`WHERE origin_id IS NOT NULL`) over plain UNIQUE: SQLite already treats NULLs as non-equal for UNIQUE, but the partial index makes the intent explicit and reduces index size. Matches modern SQLite best practice.
- **origin_id skips dedup**: content-similarity merging is a different semantic than path-hash idempotency. Migrated imports should be stable across re-runs regardless of content evolution upstream — the `skipDedup` flag is implicitly true when origin_id is present.
- **CHECK-constraint guard**: `INSERT OR IGNORE` suppresses ALL constraint failures, not just UNIQUE. Without a hasOriginId check, invalid `source` values would silently drop rows. The guard re-raises as `MemoryError` when `changes===0 && !hasOriginId`, preserving the 461-test baseline.
- **getByOriginId returns full row**: the CLI contract for Plan 02 ("upserted N, skipped M") depends on callers comparing `entry.createdAt` against a "this run" marker. Returning the first row's frozen entry, not a freshly-constructed one, makes the classification deterministic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] CHECK-constraint validation broken by INSERT OR IGNORE**
- **Found during:** Task 2 GREEN — existing test `source validation > rejects invalid source values` regressed
- **Issue:** `INSERT OR IGNORE` suppresses *all* constraint failures in SQLite, not just UNIQUE collisions. An invalid `source` value (e.g., `"invalid"`) would be silently dropped with `result.changes === 0`, and the original test expecting `.toThrow()` failed because `insert()` was now returning a frozen entry for a ghost row.
- **Fix:** Added an explicit check inside the `result.changes === 0` branch: when `hasOriginId` is false, this path cannot be a legitimate idempotent skip, so re-raise as `MemoryError` with the offending source value in the message. The origin_id path is untouched and continues to return the existing row.
- **Files modified:** `src/memory/store.ts` (5-line guard inside transaction)
- **Verification:** Re-ran store.test.ts → 45/45 green; full memory suite → 381/381 green.
- **Committed in:** `f066598` (part of Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** The fix was essential for backward compatibility. Without it, all invalid-source inserts would silently ghost-succeed — a correctness regression. Zero scope creep; fix is 5 lines inside the existing transaction block.

## Issues Encountered

**Pre-existing failures (out-of-scope, logged to deferred-items.md):**
- 10 test failures across 6 files in `src/manager/`, `src/config/`, `src/cli/commands/` domains — confirmed pre-existing by running the same tests on a stashed (pre-Plan-80-01) tree. Not touched.
- ~10 pre-existing TypeScript errors in `src/tasks/`, `src/triggers/`, `src/usage/` — not in Phase 80 scope. `src/memory/*` compiles clean.

Memory suite after Plan 80-01: **381 / 381 green** (was 371 before; +10 = 5 schema tests + 5 semantics tests).

## User Setup Required
None — pure schema + code change. Migration runs automatically on next MemoryStore construction against any existing DB.

## Next Phase Readiness

**Ready for Plan 80-02 (memory-translator):**
- `MemoryStore.insert(input, embedding)` accepts `input.origin_id` and guarantees idempotent upsert
- On collision, returned entry's `.id` and `.createdAt` equal the first-insert values — Plan 02's "upserted N, skipped M" CLI counter can compare against a this-run marker
- Dedup is automatically skipped on the origin_id path — translator does NOT need to set `skipDedup: true`
- No raw `INSERT INTO vec_memories` in `src/migration/` (verified by grep) — Plan 02 only ever calls `MemoryStore.insert()`

**Ready for Phase 81 (verify/rollback):**
- Rollback via `DELETE FROM memories WHERE origin_id LIKE 'openclaw:<agent>:%'` is well-defined (CASCADE removes vec_memories and memory_links rows)

## Self-Check: PASSED

Verified (all checks pass):
- `src/memory/types.ts` — exists, contains `origin_id?` field (grep match)
- `src/memory/store.ts` — exists, contains `migrateOriginIdColumn` (2 matches), `idx_memories_origin_id` (1 match), `INSERT OR IGNORE INTO memories` (1 match), `getByOriginId` (3 matches), `hasOriginId` (5 matches)
- `src/memory/__tests__/store.test.ts` — exists, contains `origin_id idempotency (Phase 80 MEM-02)` describe block (10 tests, all green)
- Commits in git log: `7e0cb34`, `220a9d4`, `0417615`, `f066598` — all present on master
- `grep -rn "INSERT INTO vec_memories" src/migration/` → 0 matches (MEM-03 guard satisfied)
- `npx tsc --noEmit src/memory/*` → clean (scoped)
- Full memory suite: 381 / 381 passing

---
*Phase: 80-memory-translation-re-embedding*
*Completed: 2026-04-20*
