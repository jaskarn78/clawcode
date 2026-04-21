---
phase: 77-pre-flight-guards-safety-rails
plan: 01
subsystem: migration
tags: [zod, ledger, schema, migration, jsonl, pre-flight, backward-compat]

# Dependency graph
requires:
  - phase: 76-migration-cli-read-side-dry-run
    provides: "ledgerRowSchema + appendRow/readRows/latestStatusByAgent (Phase 76 JSONL ledger canonical surface)"
provides:
  - "LEDGER_OUTCOMES closed enum ['allow','refuse'] + LedgerOutcome type for pre-flight guard rows"
  - "Optional ledgerRowSchema.step field for guard identification (e.g. 'pre-flight:daemon')"
  - "Optional ledgerRowSchema.outcome field (narrower than status — only allow/refuse)"
  - "Optional ledgerRowSchema.file_hashes Record<string,string> for witness hashes with non-empty key+value constraints"
  - "Backward-compat regression pin: Phase 76 rows round-trip unchanged through extended schema"
affects: [77-02, 77-03, 78-apply-writes, 79-workspace-copy, 80-memory-translation, 81-verify-rollback, 82-pilot-cutover]

# Tech tracking
tech-stack:
  added: []  # Zero new dependencies — additive schema edit only
  patterns:
    - "Additive-only schema extension — Phase 76 fields stay byte-stable, new fields are all .optional()"
    - "Closed-enum tuple pattern (as const) for narrow per-guard outcomes — same shape as LEDGER_ACTIONS/LEDGER_STATUSES"
    - "Non-empty key AND value constraint on z.record via z.string().min(1) on both sides — rules out {'': 'x'} and {'x': ''}"
    - "Isolated describe block with its own beforeEach/afterEach for schema extensions — keeps Phase 76 suite byte-stable as a regression pin"

key-files:
  created:
    - ".planning/phases/77-pre-flight-guards-safety-rails/77-01-SUMMARY.md"
    - ".planning/phases/77-pre-flight-guards-safety-rails/deferred-items.md"
  modified:
    - "src/migration/ledger.ts"
    - "src/migration/__tests__/ledger.test.ts"

key-decisions:
  - "Additive-only schema extension — every Phase 76 field and consumer semantics stays identical; all 3 new fields are optional."
  - "LEDGER_OUTCOMES is a CLOSED enum (allow/refuse) — narrower than status, pairs with step so refuse rows never advance state."
  - "file_hashes uses z.record(z.string().min(1), z.string().min(1)) — both keys and values must be non-empty to carry real witness info."
  - "Task 2 tests ride on Task 1's GREEN commit — no redundant RED-GREEN round for test-only expansion; two minimal RED guards in the Phase 76 suite prove the new exports exist, while a dedicated `ledger schema extensions (Phase 77)` describe block owns round-trip + backward-compat + negative-shape coverage."
  - "Pre-existing unrelated tsc errors + source-memory-reader.test.ts timeouts confirmed identical on clean master via `git stash && tsc/vitest` — logged to deferred-items.md per SCOPE BOUNDARY rule, NOT fixed here."

patterns-established:
  - "Additive-schema pattern: extend existing zod schema with only .optional() fields; keep the old describe block byte-stable; add a new describe for the new surface with isolated fixtures."
  - "Backward-compat regression pin: explicit `it('... NO new fields still validates and round-trips', ...)` test that asserts `row.newField === undefined` — catches any future non-additive drift at the first run."

requirements-completed: [MIGR-06]

# Metrics
duration: ~5min
completed: 2026-04-20
---

# Phase 77 Plan 01: Ledger Schema Extension Summary

**Additive extension of Phase 76's JSONL ledger schema with optional `step`, `outcome`, `file_hashes` fields plus a closed `LEDGER_OUTCOMES` enum — zero Phase 76 regressions, zero new dependencies.**

## Performance

- **Duration:** ~5 min (287s)
- **Started:** 2026-04-20T17:06:22Z
- **Completed:** 2026-04-20T17:11:09Z
- **Tasks:** 2
- **Files modified:** 2 source + 1 deferred log + 1 summary

## Accomplishments

- Exported `LEDGER_OUTCOMES = ['allow','refuse'] as const` tuple + `LedgerOutcome` type on `src/migration/ledger.ts`.
- Extended `ledgerRowSchema` with three optional fields — `step` (guard identifier), `outcome` (closed enum), `file_hashes` (Record<string,string> with non-empty key+value constraints).
- Added a dedicated `describe("ledger schema extensions (Phase 77)", ...)` block covering round-trip, backward-compat, negative-shape, and a `latestStatusByAgent` Phase 76 regression pin.
- Preserved Phase 76 byte-stability: every pre-existing `it(...)` block and goodRow helper is unchanged; the pre-existing suite still passes with identical assertions.
- Downstream consumers (`appendRow`, `readRows`, `latestStatusByAgent`) pick up the new optionals for free via `z.infer<typeof ledgerRowSchema>` — zero code-path changes needed.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED — failing test for LEDGER_OUTCOMES + schema extension** — `55bda0d` (test)
2. **Task 1 GREEN — extend ledgerRowSchema with optional step/outcome/file_hashes** — `da8c940` (feat)
3. **Task 2 — forward-compat + backward-compat regression suite** — `bfe47fa` (test)

**REFACTOR:** Skipped — Task 1 GREEN is clean (comments preserved, zero dup, one cohesive additive block). Task 2 is test-only, no implementation churn needed.

_Note: Task 2 did not repeat a RED commit — its tests were designed against the Task 1 GREEN schema and passed immediately. The two minimal schema guards committed in Task 1's RED (`55bda0d`) proved the new exports + shape before implementation; Task 2's 6-test extension block expanded coverage without duplicating RED discipline._

## Files Created/Modified

- `src/migration/ledger.ts` — Added `LEDGER_OUTCOMES` + `LedgerOutcome` export; extended `ledgerRowSchema` with 3 optional fields.
- `src/migration/__tests__/ledger.test.ts` — Imported `LEDGER_OUTCOMES`; added 2 minimal schema guards in the Phase 76 suite; added 6-test extension suite in its own `describe` block with isolated fixtures.
- `.planning/phases/77-pre-flight-guards-safety-rails/deferred-items.md` — Logged pre-existing unrelated tsc + vitest-timeout issues per SCOPE BOUNDARY rule.

## Decisions Made

- **Additive-only schema edit** — every Phase 76 field keeps identical semantics; all 3 new fields are `.optional()`. Preserves every existing row's ability to round-trip unchanged.
- **Closed outcome enum over free string** — `z.enum(LEDGER_OUTCOMES)` ensures guard code can only emit `allow` or `refuse`, never a typo like `"ok"` or `"maybe"`.
- **Non-empty key AND value for file_hashes** — `z.record(z.string().min(1), z.string().min(1))` rules out `{"": "abc"}` (empty path key) and `{"path": ""}` (empty hash value) — both carry zero witness information.
- **Task 2 ships on Task 1's GREEN** — test-only expansion with no corresponding implementation change; a second RED-GREEN round would be ceremonial. Minimal RED guards in Task 1 already proved the new surface existed before implementation.
- **Isolated `describe` for Phase 77 tests** — fresh `tmpDir`/`ledgerPath` fixtures per test, no shared state with the Phase 76 `describe`. Preserves the Phase 76 suite as a byte-stable regression pin.

## Deviations from Plan

### Auto-fixed / deferred items

**1. [SCOPE BOUNDARY] Pre-existing `tsc --noEmit` errors unrelated to this plan**
- **Found during:** Task 1 GREEN verification (`npx tsc --noEmit`)
- **Issue:** tsc reports errors in `src/memory/__tests__/graph.test.ts`, `src/tasks/task-manager.ts`, `src/triggers/__tests__/engine.test.ts`, `src/usage/__tests__/daily-summary.test.ts`, `src/usage/budget.ts`.
- **Verification of pre-existing:** `git stash && npx tsc --noEmit` on clean master produces identical errors.
- **Action:** Logged to `deferred-items.md`. NOT fixed — out of scope for a schema-only extension.

**2. [SCOPE BOUNDARY] Pre-existing vitest timeouts in `src/migration/__tests__/source-memory-reader.test.ts`**
- **Found during:** Post-Task-2 broader migration test run (`npx vitest run src/migration/`).
- **Issue:** 2 tests in `source-memory-reader.test.ts` exceed the 5000ms default vitest timeout.
- **Verification of pre-existing:** `git stash && npx vitest run src/migration/__tests__/source-memory-reader.test.ts` fails identically on clean master.
- **Action:** Logged to `deferred-items.md`. NOT fixed — same pattern as Phase 75 P03's per-test timeout extensions; deferred to whoever next edits that module.

---

**Total deviations:** 0 auto-fixes to code; 2 scope-boundary logs to `deferred-items.md`.
**Impact on plan:** Zero — plan executed exactly as written. Deferred items are unrelated to the schema extension and identical on a pre-plan master.

## Issues Encountered

- Task 2's `it("accepts a row with step + outcome + file_hashes populated")` guard passed even pre-Task-1 implementation because zod strips unknown keys by default (no `.strict()`). Documented but benign — Task 2's full extension suite includes round-trip tests (`readRows` after `appendRow`) that DO exercise the schema's round-trip of optional fields, so the actual "accept and persist" contract is verified.
- Note the tradeoff: if Phase 78 wants stricter rejection of unknown keys, add `.strict()` on `ledgerRowSchema` — this is deferred as a future concern since it would be a breaking change, not additive.

## Known Stubs

None. This plan is a schema-only extension with zero UI/rendering surface. No hardcoded empty values, no placeholder text, no mock data.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `LedgerRow` type is ready to carry `step`/`outcome`/`file_hashes` for the four pre-flight guards in Plan 77-02 (daemon / secret-shape / channel-collision / read-only).
- `LEDGER_OUTCOMES` is ready to be imported by `src/migration/guards.ts` (new module in Plan 77-02) to type guard-result rows.
- Phase 76 invariants intact: append-only, validate-pre-mkdir, `appendFile`-not-`writeFile`, insert-order last-write-wins — every future ledger consumer inherits them.
- No blockers for Plan 77-02 (guard implementation) or Plan 77-03 (apply stub wiring).

## Self-Check: PASSED

Created files verified on disk:

```
FOUND: src/migration/ledger.ts (modified: LEDGER_OUTCOMES + step/outcome/file_hashes present — grep -n confirms lines 55, 56, 86, 88, 92)
FOUND: src/migration/__tests__/ledger.test.ts (modified: 17 it() blocks, 2 describe blocks — grep -c confirms)
FOUND: .planning/phases/77-pre-flight-guards-safety-rails/deferred-items.md
FOUND: .planning/phases/77-pre-flight-guards-safety-rails/77-01-SUMMARY.md
```

Commits verified in `git log --oneline`:

```
FOUND: 55bda0d test(77-01): add failing test for LEDGER_OUTCOMES + schema extension
FOUND: da8c940 feat(77-01): extend ledgerRowSchema with optional step/outcome/file_hashes
FOUND: bfe47fa test(77-01): add forward-compat + backward-compat regression suite for schema extension
```

Test suite: `npx vitest run src/migration/__tests__/ledger.test.ts` → **17 passed / 17** (9 Phase 76 unmodified + 2 minimal schema guards + 6 extension suite).

Pre-existing errors (`tsc --noEmit`, `source-memory-reader.test.ts` timeouts) logged to `deferred-items.md`, verified unchanged on clean master via `git stash`.

---
*Phase: 77-pre-flight-guards-safety-rails*
*Completed: 2026-04-20*
