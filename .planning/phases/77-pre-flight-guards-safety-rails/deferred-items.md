# Phase 77 — Deferred Items

Out-of-scope discoveries logged during plan execution. NOT fixed in this phase.

## Pre-existing `tsc --noEmit` errors (unrelated to Phase 77)

Confirmed pre-existing via `git stash && npx tsc --noEmit` — these errors exist on a clean `master` checkout and are **not introduced by Plan 77-01's additive ledger schema extension**.

| File | Line | Error | Source |
|------|------|-------|--------|
| `src/memory/__tests__/graph.test.ts` | 338 | TS2353 — `recencyWeight` not in `ScoringConfig` | Pre-existing |
| `src/tasks/task-manager.ts` | 239, 328, 367, 485 | TS2741 — `causationId` missing in TurnLineage | Pre-existing (v1.8 TurnDispatcher) |
| `src/triggers/__tests__/engine.test.ts` | 66-67 | TS2322 — Mock procedure assignability | Pre-existing |
| `src/usage/__tests__/daily-summary.test.ts` | 209, 288, 313 | TS2493 — tuple indexing on `[]` | Pre-existing |
| `src/usage/budget.ts` | 138 | TS2367 — unintentional comparison | Pre-existing |

**Verification** (2026-04-20, during Plan 77-01 execution):
```bash
git stash && npx tsc --noEmit  # produces identical errors
git stash pop
```

Plan 77-01 does NOT change this error count. See `77-01-SUMMARY.md` Self-Check.

## Pre-existing vitest timeout in `src/migration/__tests__/source-memory-reader.test.ts`

Confirmed pre-existing via `git stash && npx vitest run …` on a clean master:

```
FAIL  src/migration/__tests__/source-memory-reader.test.ts
  × returns the row count for a sqlite with a populated chunks table (6174ms)
  × does NOT modify the source sqlite file's mtime (read-only open) (5113ms)
  Error: Test timed out in 5000ms.
```

Root cause: default vitest `testTimeout` (5000ms) is too short for sqlite-vec
cold-start on this test suite. Same class of issue as the Phase 75 P03
per-test timeout extensions (15s/20s for MemoryStore-heavy tests). Fix is
a one-line `{ timeout: 15000 }` on the affected `it(...)` blocks —
deferred here because it's out of scope for Plan 77-01 (schema-only change
to a different module).

Plan 77-01's own tests (`src/migration/__tests__/ledger.test.ts`) all pass
in ~1s — the timeout regression is isolated to `source-memory-reader.test.ts`.
