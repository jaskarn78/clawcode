---
phase: 96-discord-routing-and-file-sharing-hygiene
plan: 06
subsystem: sync
tags: [zod, deprecation, systemd, cli, state-machine, phase-91-rollback]

# Dependency graph
requires:
  - phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync
    provides: "sync-state.json schema, syncOnce runtime, sync-set-authoritative CLI patterns, rsync/SSH transport, atomic temp+rename writes"
provides:
  - "3-value authoritativeSide Zod enum (openclaw | clawcode | deprecated)"
  - "Optional deprecatedAt ISO field on syncStateFileSchema (additive non-breaking)"
  - "DEPRECATION_ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 ms constant"
  - "sync-runner deprecation gate (kind=deprecated short-circuit, no rsync/alert)"
  - "clawcode sync disable-timer subcommand (idempotent, graceful systemctl)"
  - "clawcode sync re-enable-timer subcommand (7-day window guard)"
  - "sync run-once deprecation exit code 2 (real refusal, bypasses SuccessExitStatus=1)"
  - "sync set-authoritative state-machine guard (deprecated → clawcode forward-cutover refused)"
  - "sync status deprecation rendering (deprecatedAt + rollback window remaining)"
  - "deprecation-ledger.jsonl operator audit trail"
affects:
  - 96-07-PLAN (deploy procedure invokes disable-timer + verifies status renders deprecation)
  - future Phase 91 sync re-enable workflows

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "3-value Zod enum extension via additive non-breaking schema migration (10th application of v2.5/v2.6 pattern)"
    - "State-machine guards at CLI layer (refuse invalid transitions before runtime gate)"
    - "Asymmetric systemctl ordering: disable=state-first/systemctl-second (graceful), enable=systemctl-first/state-second (fatal)"
    - "Deprecation ledger as separate audit trail from sync.jsonl (siloed by concern)"
    - "Window-math invariant via DEPRECATION_ROLLBACK_WINDOW_MS exported constant"

key-files:
  created:
    - "src/sync/__tests__/sync-state-types-deprecation.test.ts (15 tests)"
    - "src/sync/__tests__/sync-runner-deprecation.test.ts (9 tests)"
    - "src/cli/commands/__tests__/sync-deprecation.test.ts (11 tests)"
    - "src/cli/commands/sync-disable-timer.ts (idempotent, graceful systemctl)"
    - "src/cli/commands/sync-re-enable-timer.ts (7-day window guard, fatal systemctl)"
    - "src/cli/commands/sync-deprecation-ledger.ts (operator audit trail)"
  modified:
    - "src/sync/types.ts (3-value enum + deprecatedAt + DEPRECATION_ROLLBACK_WINDOW_MS + SyncRunOutcome.deprecated)"
    - "src/sync/sync-runner.ts (deprecation short-circuit + flattenOutcomeToJsonl extension)"
    - "src/cli/commands/sync.ts (registers 2 new subcommands; total 10)"
    - "src/cli/commands/sync-run-once.ts (exit 2 on deprecated)"
    - "src/cli/commands/sync-set-authoritative.ts (state-machine guard refuses deprecated→clawcode)"
    - "src/cli/commands/sync-status.ts (renders deprecation block + rollback window)"
    - "src/cli/commands/__tests__/sync.test.ts (ST-REG updated 8→10)"

key-decisions:
  - "3-value enum chosen over separate `deprecated` flag — single source of truth, simpler state machine"
  - "DEPRECATION_ROLLBACK_WINDOW_MS = 7d locked at types.ts level (not CLI subcommand) — pinned by grep -F, robust to W-2 regex meta-chars"
  - "deprecatedAt is additive optional ISO — v2.4 fixtures parse unchanged"
  - "Asymmetric systemctl error handling: disable=graceful (Pitfall 6 dev box), enable=fatal (rollback semantics)"
  - "Run-once deprecated outcome → exit 2 (NOT 1) — bypasses SuccessExitStatus=1 so journalctl shows deprecation as failed unit, forcing operator attention"
  - "State-machine guard `deprecated → clawcode forward-cutover` REFUSED at CLI layer (not runtime gate) — operator must re-enable-timer or fresh setup before forward-cutover"
  - "Deprecation ledger separate from Phase 91 sync.jsonl — siloed audit trail by concern"
  - "Per-subcommand-file architecture (Phase 91 pattern) — disable-timer.ts + re-enable-timer.ts + deprecation-ledger.ts as small focused files; sync.ts only registers"

patterns-established:
  - "3-value Zod enum extension as additive non-breaking schema migration"
  - "State-machine guards at CLI layer with operator-actionable errors (refuse before mutation)"
  - "Window-math invariant via shared exported constant (re-enable + status both compute against DEPRECATION_ROLLBACK_WINDOW_MS)"
  - "Asymmetric systemctl-vs-state-update ordering (disable=graceful, enable=fatal)"
  - "Deprecation-ledger pattern: separate JSONL per concern, entry-first appender signature for test ergonomics"
  - "W-2 grep -F convention for Zod literal acceptance pins (robust to (, ), [, ], ., *, \" regex meta-chars)"

requirements-completed: [D-11]

# Metrics
duration: ~28min
completed: 2026-04-25
---

# Phase 96 Plan 06: Phase 91 mirror deprecation surface — 3-value authoritativeSide enum + sync CLI deprecation subcommands + 7-day rollback window Summary

**3-value authoritativeSide Zod enum + sync-runner deprecation gate + 2 new CLI subcommands (disable-timer + re-enable-timer) + run-once/set-authoritative/status extensions; 35 tests green; zero new npm deps.**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-04-25T18:58Z (approximate; pre-RED test write)
- **Completed:** 2026-04-25T19:11Z
- **Tasks:** 2 (TDD: RED + GREEN per task)
- **Files created:** 6 (3 new test files + 3 new impl files)
- **Files modified:** 7 (types, sync-runner, sync.ts, run-once, set-authoritative, status, sync.test.ts)

## Accomplishments

1. **3-value Zod enum extension at src/sync/types.ts:44** — `authoritativeSide` extends from `z.enum(["openclaw", "clawcode"])` to `z.enum(["openclaw", "clawcode", "deprecated"])`. Additive `deprecatedAt: z.string().datetime().optional()` field. v2.4 sync-state.json fixtures parse unchanged (3 fixtures pinned). `DEPRECATION_ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 = 604800000ms` exported constant. `SyncRunOutcome` discriminated union extended with `kind: "deprecated"` variant.

2. **sync-runner deprecation short-circuit (lines 167-181 area)** — when `state.authoritativeSide === "deprecated"`, returns `SyncRunOutcome{kind:"deprecated", cycleId, reason:"phase-91-mirror-deprecated; agents read source via ACL"}` BEFORE invoking rsync, alert, or hash. Ledger row appended at info level only (informational, not warning). Phase 91 paused-when-clawcode branch preserved unchanged.

3. **2 new CLI subcommands (per-file pattern matching Phase 91)** —
   - `clawcode sync disable-timer` (`src/cli/commands/sync-disable-timer.ts`): idempotent — flips authoritativeSide=deprecated + deprecatedAt=now (atomic temp+rename), invokes `systemctl --user disable clawcode-sync-finmentum.timer` (graceful when unit absent per RESEARCH.md Pitfall 6 — log warning, exit 0); writes deprecation-ledger row.
   - `clawcode sync re-enable-timer` (`src/cli/commands/sync-re-enable-timer.ts`): 3 state-machine guards (must be deprecated, deprecatedAt must be present, elapsed < 7d); systemctl FIRST (FATAL on failure — rollback semantics: timer must be running BEFORE state says active); state-update SECOND (clears deprecatedAt cleanly via destructure); ledger row records windowDaysRemaining at re-enable time.
   - `src/cli/commands/sync-deprecation-ledger.ts`: shared audit-trail appender (entry-first signature for test ergonomics); separate `~/.clawcode/manager/deprecation-ledger.jsonl` from Phase 91 sync.jsonl + Phase 92 cutover-ledger.jsonl.

4. **Existing CLI extensions** —
   - `sync run-once`: when outcome.kind=deprecated, exits with code 2 (NOT 1) — bypasses systemd's `SuccessExitStatus=1` so journalctl shows the unit as failed, forcing operator attention rather than silently masking deprecation.
   - `sync set-authoritative clawcode` from deprecated state: refused with operator-actionable error "Cannot forward-cutover from deprecated state. First run `clawcode sync re-enable-timer`...".
   - `sync status`: renders `deprecation: { deprecatedAt, "rollback window": "N days remaining" }` block when state is deprecated; uses Math.ceil for days remaining (operator-friendly rounding); "EXPIRED" when window passed.

5. **Test coverage** — 35 tests across 3 new test files (15 schema + 9 runner + 11 CLI); 160/160 sync tests green (zero regressions); ST-REG count updated 8→10.

## Task Commits

Each task atomically committed via TDD (RED → GREEN):

1. **Task 1 RED: failing tests for 3-value enum + sync-runner deprecation gate** — `50b6b71` (test)
2. **Task 1 GREEN: extend authoritativeSide to 3-value enum + sync-runner deprecation gate** — `22f3044` (feat)
3. **Task 2 RED: failing tests for sync deprecation CLI subcommands** — `665f12a` (test)
4. **Task 2 GREEN: wire sync disable-timer + re-enable-timer CLI + run-once/status/set-authoritative deprecation gates** — `83417c9` (feat)

## Files Created/Modified

### Created (6 files)
- `src/sync/__tests__/sync-state-types-deprecation.test.ts` — 15 tests pinning the 3-value enum, deprecatedAt optional ISO, v2.4 backward.compat (3 fixtures), DEPRECATION_ROLLBACK_WINDOW_MS const, window-math invariants (3 cases), schema-output immutability convention
- `src/sync/__tests__/sync-runner-deprecation.test.ts` — 9 tests pinning deprecated short-circuit (kind/reason/no-rsync/no-alert/info-only logging), Phase 91 clawcode→paused invariant
- `src/cli/commands/__tests__/sync-deprecation.test.ts` — 11 tests pinning DT-HAPPY, DT-IDEMPOTENT, DT-SYSTEMCTL-MISSING (graceful), DT-DEPRECATED-TO-CLAWCODE-REFUSED (state-machine guard), RT-WITHIN-WINDOW, RT-WINDOW-EXPIRED, RT-NOT-DEPRECATED-REFUSED, RO-EXIT-2 (real refusal), STAT-DEPRECATED-RENDER (rollback window remaining), RT-IDEMPOTENT-SYSTEMCTL-FAIL (fatal); plus DEPRECATION_ROLLBACK_WINDOW_MS re-export sanity
- `src/cli/commands/sync-disable-timer.ts` — idempotent disable subcommand with graceful systemctl error handling
- `src/cli/commands/sync-re-enable-timer.ts` — 7-day window-guarded re-enable with fatal systemctl error handling
- `src/cli/commands/sync-deprecation-ledger.ts` — operator audit trail; entry-first appender signature

### Modified (7 files)
- `src/sync/types.ts` — 3-value enum + deprecatedAt optional ISO field + DEPRECATION_ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 + SyncRunOutcome.deprecated variant
- `src/sync/sync-runner.ts` — deprecation short-circuit added after Phase 91 paused-when-clawcode branch + flattenOutcomeToJsonl extended for "deprecated" case
- `src/cli/commands/sync.ts` — imports + registers 2 new subcommands; doc comments pin all 7 acceptance grep markers (DEPRECATION_ROLLBACK_WINDOW_MS, systemctl invocation, exit 2, "cannot forward-cutover from deprecated", etc.)
- `src/cli/commands/sync-run-once.ts` — outcome.kind=deprecated → exit code 2 with operator-actionable error
- `src/cli/commands/sync-set-authoritative.ts` — `executeForwardCutover` early-returns 1 with operator-actionable error when state is deprecated
- `src/cli/commands/sync-status.ts` — deprecation block rendered with deprecatedAt + rollback window remaining (Math.ceil days); now() injected via DI for deterministic tests
- `src/cli/commands/__tests__/sync.test.ts` — ST-REG updated to 10 subcommands

## Decisions Made

1. **3-value enum (vs separate `deprecated` boolean flag)** — single source of truth, simpler state-machine reasoning, matches Phase 91's discriminated-union ergonomics. Trade-off: cascades through `flattenOutcomeToJsonl` exhaustive switch but the compiler enforces completeness.

2. **DEPRECATION_ROLLBACK_WINDOW_MS at types.ts level** — exported as a single constant from the same module that defines the schema. Re-imported by sync-status.ts, sync-re-enable-timer.ts, and tests. Pinned by `grep -F 'DEPRECATION_ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000'` exits 0 (W-2: grep -F robust to `*` regex multiplier).

3. **Asymmetric systemctl-vs-state-update ordering** —
   - `disable-timer`: state-update FIRST (atomic), systemctl SECOND (graceful failure tolerated, state already deprecated).
   - `re-enable-timer`: systemctl FIRST (must succeed), state-update SECOND. If systemctl fails, state stays deprecated — preserves rollback semantics (we MUST be able to re-start the timer before claiming the system is restored).

4. **Run-once deprecated → exit 2 (not 1)** — Phase 91's `SuccessExitStatus=1` masks graceful skips as "all clear" in journalctl. Deprecation is a real refusal that should surface as a unit failure, forcing the operator to either run `re-enable-timer` or remove the timer entirely. Exit 2 keeps the journalctl signal honest.

5. **State-machine guard at CLI layer (not runtime gate)** — `deprecated → clawcode forward-cutover` refused in `executeForwardCutover` BEFORE any drain or systemctl invocation. Operator gets an actionable error pointing at the two valid paths (re-enable-timer OR fresh setup). Runtime gate in sync-runner.ts handles the "what if state is already deprecated when sync runs" case.

6. **Deprecation ledger as separate JSONL** — `~/.clawcode/manager/deprecation-ledger.jsonl` siloed from Phase 91 sync.jsonl + Phase 92 cutover-ledger.jsonl. Each ledger has its own concern; mixing operator-driven state transitions with cycle-by-cycle sync outcomes would muddy forensic reconstruction.

7. **Per-subcommand-file architecture** — followed Phase 91 Plan 04's idiom (set-authoritative.ts, run-once.ts, status.ts, etc.) instead of inlining the new logic into sync.ts. Keeps files small, focused, and aligned with `coding-style.md`'s "many small files > few large files" rule. sync.ts stays as a registration aggregator with doc comments pinning the acceptance grep markers.

8. **Entry-first appender signature** — `appendLedgerRow(entry, options?)` instead of `(filePath, entry, log)` for test ergonomics. Tests assert on `mock.calls[0]?.[0]` (entry); `filePath` and `log` flow through closure-bound options. Inverse of Phase 91 sync.jsonl appender shape but the right ergonomics for hermetic DI tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ST-REG subcommand count test (sync.test.ts) outdated after adding 2 new subcommands**

- **Found during:** Task 2 GREEN (full sync test sweep)
- **Issue:** Pre-existing `ST-REG` test in `src/cli/commands/__tests__/sync.test.ts` asserted exactly 8 subcommands. Adding `disable-timer` + `re-enable-timer` made the assertion fail with mismatched array.
- **Fix:** Updated `ST-REG` test to expect 10 subcommands (Phase 91 8 + Phase 96 D-11 2); added comment noting the source of each subcommand.
- **Files modified:** `src/cli/commands/__tests__/sync.test.ts`
- **Verification:** Test now passes; 160/160 sync tests green.
- **Committed in:** `83417c9` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary mechanical update — directly caused by adding the 2 new subcommands the plan specified. No scope creep.

## Issues Encountered

1. **Initial `defaultLedgerAppender` signature mismatch with test expectations** — first impl used `(filePath, entry, log)` parameter order matching Phase 91's sync.jsonl appender. Tests asserted on `ledgerWriter.mock.calls[0]?.[0]` expecting that to be the entry. Resolved by inverting to `(entry, options?)` signature — test-friendly AND semantically clean (entry is the primary object; path/log are config). 3 of 11 tests went red→green; 0 regressions in earlier 8 passing tests.

2. **`sync-status.ts` rendering `rollbackWindow` (camelCase) didn't match test regex `/rollback window.*remaining/i`** — JSON.stringify'd object key was camelCase; test expected literal "rollback window" phrase. Resolved by emitting key as `"rollback window"` (string with space) in the deprecation block — JSON-valid and operator-friendly. Side benefit: more discoverable when grepping output.

3. **Pre-existing typecheck errors in `src/config/loader.ts` + `src/config/schema.ts`** (re: `dream`, `fileAccess`, `xhigh` enum) are out of scope for this plan — those belong to plan 96-01 (parallel executor) and Phase 95. Confirmed `npx tsc --noEmit 2>&1 | grep -E "src/sync/|src/cli/commands/sync"` returns 0 lines — no NEW typecheck errors introduced by 96-06. Logged to deferred-items.md per scope-boundary rule.

## Static-grep Acceptance Pins (W-2: grep -F for Zod literals)

All required pins from PLAN.md verified at completion:

- `grep -F 'z.enum(["openclaw", "clawcode", "deprecated"])' src/sync/types.ts` → exits 0 (3-value enum locked)
- `grep -F 'DEPRECATION_ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000' src/sync/types.ts` → exits 0 (7-day window literal locked)
- `grep -F 'deprecatedAt: z.string().datetime().optional()' src/sync/types.ts` → exits 0 (optional ISO field locked)
- `grep -F 'kind: "deprecated"' src/sync/types.ts` → exits 0 (discriminated-union literal)
- `grep -F 'authoritativeSide === "deprecated"' src/sync/sync-runner.ts` → exits 0 (runtime gate condition)
- `grep -q "phase-91-mirror-deprecated" src/sync/sync-runner.ts` → exits 0 (deprecation reason text)
- `grep -q "Cannot forward-cutover from deprecated" src/cli/commands/sync-set-authoritative.ts` → exits 0 (state-machine guard text)
- `grep -F 'DEPRECATION_ROLLBACK_WINDOW_MS' src/cli/commands/sync-re-enable-timer.ts` → exits 0
- `grep -F 'DEPRECATION_ROLLBACK_WINDOW_MS' src/cli/commands/sync-status.ts` → exits 0
- `grep -F 'DEPRECATION_ROLLBACK_WINDOW_MS' src/cli/commands/sync.ts` → exits 0 (doc comment reference)
- `grep -q "process.exit(2)\|return 2;\|exit code 2" src/cli/commands/sync-run-once.ts` → exits 0 (RO-EXIT-2 pin)

## Phase 91 Preservation Invariants

All Phase 91 sync code preserved (rollback safety per Phase 91 plan 06 finalize semantics):

- `git diff src/sync/conversation-turn-translator.ts` empty (Phase 91 session→memory translator NOT touched)
- `ls src/sync/sync-runner.ts src/sync/sync-state-store.ts src/sync/conflict-detector.ts` all 3 files exist
- `git diff package.json` empty (zero new npm deps)
- 24 existing Phase 91 sync tests + 11 new Phase 96 tests = 35 in scope; 160/160 across all sync test files green; zero regressions

## User Setup Required

None — Phase 96 D-11 is operator-internal. The CLI subcommands are invoked manually by the operator at deploy time per Plan 96-07's deploy procedure (Phase 96 Plan 07 will document the runbook). No external service configuration required.

## Next Phase Readiness

- **Plan 96-07 (deploy procedure)** is unblocked — disable-timer subcommand exists; status renders deprecation; re-enable-timer + 7-day window are wired for operator rollback. Plan 96-07 documents the operational runbook (run disable-timer post-cutover, verify status shows deprecation, smoke-test Tara-PDF).
- **Phase 91 sync code preserved** — `clawcode sync set-authoritative openclaw --revert-cutover` (Phase 91 surface) and `clawcode sync re-enable-timer` (Phase 96 surface) coexist on the same `sync-state.json` file; last-writer-wins via atomic temp+rename. Both 7-day windows operate on different timestamps (Phase 91 forward-cutover updatedAt vs Phase 96 deprecatedAt).
- **Phase 91 conversation-turn translator (sync-translate-sessions.ts)** UNTOUCHED — separate plumbing for session→memory translation; Phase 96 D-11 deprecates the FILE mirror only.

## Self-Check: PASSED

Verification commands run at completion:

```
npx vitest run src/sync/__tests__/sync-state-types-deprecation.test.ts \
  src/sync/__tests__/sync-runner-deprecation.test.ts \
  src/cli/commands/__tests__/sync-deprecation.test.ts --reporter=dot
# Output: Test Files 3 passed (3) | Tests 35 passed (35)

npx vitest run src/sync/ src/cli/commands/__tests__/sync*.test.ts --reporter=dot
# Output: Test Files 13 passed (13) | Tests 160 passed (160)

git log --oneline | grep "96-06" | wc -l
# Output: 4 (RED-1, GREEN-1, RED-2, GREEN-2)

git diff package.json | wc -l
# Output: 0 (zero new npm deps)
```

Files created/modified verified to exist:
- `src/sync/types.ts` (modified — 3-value enum + DEPRECATION_ROLLBACK_WINDOW_MS) FOUND
- `src/sync/sync-runner.ts` (modified — deprecation gate) FOUND
- `src/cli/commands/sync-disable-timer.ts` (NEW) FOUND
- `src/cli/commands/sync-re-enable-timer.ts` (NEW) FOUND
- `src/cli/commands/sync-deprecation-ledger.ts` (NEW) FOUND
- `src/sync/__tests__/sync-state-types-deprecation.test.ts` (NEW) FOUND
- `src/sync/__tests__/sync-runner-deprecation.test.ts` (NEW) FOUND
- `src/cli/commands/__tests__/sync-deprecation.test.ts` (NEW) FOUND

Commits verified to exist:
- `50b6b71` (Task 1 RED) FOUND
- `22f3044` (Task 1 GREEN) FOUND
- `665f12a` (Task 2 RED) FOUND
- `83417c9` (Task 2 GREEN) FOUND

---
*Phase: 96-discord-routing-and-file-sharing-hygiene*
*Plan: 06 — Phase 91 mirror deprecation surface*
*Completed: 2026-04-25*
