---
phase: 66-session-boundary-summarization
plan: 01
subsystem: memory
tags: [sqlite, better-sqlite3, typescript, tdd, vitest, conversation-lineage]

# Dependency graph
requires:
  - phase: 64-conversation-schema-foundations
    provides: source_turn_ids column, migrateSourceTurnIds, MemoryEntry.sourceTurnIds read path
provides:
  - CreateMemoryInput.sourceTurnIds optional readonly string array field
  - MemoryStore.insert() atomic write of source_turn_ids in single transaction
  - Propagation of sourceTurnIds (frozen array or null) in insert return value
  - Roundtrip regression coverage for the full write path (input → DB → getById read)
affects: [66-02-session-summarizer, 66-03-session-manager-integration, plan-02-auto-inject]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Immutability invariant preserved: input arrays spread-copied before Object.freeze on return"
    - "Empty array normalization: CreateMemoryInput.sourceTurnIds=[] treated as null in DB"
    - "JSON-serialized lineage computed outside transaction (avoid recomputation on retry)"

key-files:
  created:
    - .planning/phases/66-session-boundary-summarization/deferred-items.md
  modified:
    - src/memory/types.ts
    - src/memory/store.ts
    - src/memory/__tests__/store.test.ts

key-decisions:
  - "Empty sourceTurnIds array persists as NULL (not '[]') to keep 'null = no lineage' invariant"
  - "sourceTurnIdsJson computed before db.transaction block — values are deterministic, no side-effect concerns"
  - "Returned sourceTurnIds array uses [...input.sourceTurnIds] spread + Object.freeze (mirrors tags pattern)"

patterns-established:
  - "10-column insertMemory statement: tier stays hard-coded 'warm', source_turn_ids is the new 10th bind"
  - "Lineage roundtrip test pattern: insert → assert return → getById → assert fetched (frozen)"

requirements-completed:
  - SESS-01
  - SESS-04

# Metrics
duration: 5min
completed: 2026-04-18
---

# Phase 66 Plan 01: CreateMemoryInput.sourceTurnIds write path Summary

**CreateMemoryInput now accepts optional sourceTurnIds; MemoryStore.insert persists source_turn_ids in a single atomic transaction and propagates the frozen array (or null) into the returned MemoryEntry — closing the CONV-03 write-path gap Phase 64 left open.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-18T14:27:37Z
- **Completed:** 2026-04-18T14:33:32Z
- **Tasks:** 2
- **Files modified:** 3 (2 source, 1 test)

## Accomplishments
- Extended `CreateMemoryInput` type with optional readonly `sourceTurnIds: readonly string[]` field, JSDoc mirrors MemoryEntry's existing field
- Updated `insertMemory` prepared statement from 9 → 10 columns (added `source_turn_ids` as 10th bind)
- Computed `sourceTurnIdsJson` before the transaction (empty array normalized to `null`); passed as 9th bind parameter
- Replaced hard-coded `sourceTurnIds: null` in `insert()` return with propagation of frozen input array or null
- Added 5 roundtrip regression tests covering: input propagation, getById roundtrip, omitted-field null, empty-array null, raw DB column JSON shape
- Zero regressions across full memory module suite (315 tests passing, 35 in store.test.ts alone)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend CreateMemoryInput and update MemoryStore.insert write path** — `511b538` (feat)
2. **Task 2: Add roundtrip regression tests for sourceTurnIds write path** — `a3745df` (test)

_Note: Tasks were marked `tdd="true"` in the plan, but the testing work is isolated in Task 2 per the plan's task split. Task 1 is the GREEN implementation guarded by existing 30 tests (no regressions); Task 2 is the REGRESSION layer that locks in the new behaviour._

## Files Created/Modified
- `src/memory/types.ts` — Added `sourceTurnIds?: readonly string[]` to `CreateMemoryInput`
- `src/memory/store.ts` — Updated `insertMemory` SQL (+1 column), added `sourceTurnIdsJson` computation, extended `insertMemory.run(...)` bind params to 9, propagated `sourceTurnIds` on return
- `src/memory/__tests__/store.test.ts` — Added `describe("sourceTurnIds (CONV-03 write path)", ...)` block with 5 tests
- `.planning/phases/66-session-boundary-summarization/deferred-items.md` — Logged pre-existing TypeScript errors in unrelated files (out-of-scope)

## Decisions Made
- **Empty-array normalization:** `sourceTurnIds: []` → `null` in DB. Rationale: preserves the "NULL = no lineage" invariant already used by MemoryEntry.sourceTurnIds. A caller passing `[]` gets identical semantics to omitting the field.
- **Compute JSON outside transaction:** `sourceTurnIdsJson` is deterministic from pure input; computing before the transaction avoids repeat work if better-sqlite3 retries on BUSY (harmless but cleaner).
- **Spread-copy on return:** `Object.freeze([...input.sourceTurnIds])` mirrors the existing `tags` pattern — caller cannot mutate the returned array even if they hold a reference to the original input.

## Deviations from Plan

None — plan executed exactly as written. Task 1 ordering (implementation before dedicated tests) was explicitly what the plan specified, and all acceptance-criteria grep patterns passed verbatim.

## Issues Encountered

**Pre-existing TypeScript errors in unrelated files** (not caused by this plan). Full `npx tsc --noEmit` surfaces ~25 errors across `src/cli/commands/`, `src/manager/`, `src/tasks/`, `src/triggers/`, `src/usage/` — all pre-dated Phase 66. Scoped `npx tsc --noEmit` filtered to the modified files (`src/memory/types.ts`, `src/memory/store.ts`) returns zero errors. Logged to `deferred-items.md` per scope-boundary rule; deferred to a dedicated tech-debt phase.

## Verification Evidence

- `npx vitest run src/memory/__tests__/store.test.ts --reporter=verbose` → 35/35 passed (30 existing + 5 new)
- `npx vitest run src/memory/` → 315/315 passed (full memory module, zero regressions)
- TypeScript in modified files: 0 errors
- All 13 acceptance-criteria grep checks from the plan: PASS

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Ready for Plan 02 (SessionSummarizer):** The write path is now complete. The summarizer can call `memoryStore.insert({ content, source: "conversation", sourceTurnIds: [...turnIds] }, embedding)` and trust that `entry.sourceTurnIds` roundtrips exactly through `getById`. No follow-up UPDATE needed.
- **Ready for Plan 03 (SessionManager hook):** The contract is stable — any caller that has turn IDs in hand can attach them at creation time.
- **No blockers** for downstream plans.

## Self-Check: PASSED

- FOUND: src/memory/types.ts (modified)
- FOUND: src/memory/store.ts (modified)
- FOUND: src/memory/__tests__/store.test.ts (modified)
- FOUND: .planning/phases/66-session-boundary-summarization/deferred-items.md
- FOUND: commit 511b538 (Task 1)
- FOUND: commit a3745df (Task 2)

---
*Phase: 66-session-boundary-summarization*
*Plan: 01*
*Completed: 2026-04-18*
