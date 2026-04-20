---
phase: 75-shared-workspace-runtime-support
plan: 04
subsystem: runtime
tags: [memoryPath, shared-workspace, finmentum, session-resume, context-summary, gap-closure]

# Dependency graph
requires:
  - phase: 75-02
    provides: "saveContextSummary writes context-summary.md under memoryPath/memory/ — READ path must match"
provides:
  - "session-config.ts:318 loadLatestSummary resolves against config.memoryPath (not config.workspace) — shared-workspace agents now find their persisted context summaries at session resume"
  - "Regression test in session-config.test.ts pinning the memoryPath-derived read dir — future refactors that silently re-introduce the workspace-keyed read break CI"
affects:
  - "75-VERIFICATION.md Truth #7 — transitions from FAILED to VERIFIED on phase re-verify"
  - "Phase 79+ finmentum workspace migration — session-resume context continuity now works for all 5 fin-* agents on shared basePath"

# Tech tracking
tech-stack:
  added: []  # no new dependencies; one-line fix + one regression test
  patterns:
    - "Inline Phase 75 SHARED-02 rationale comment at the swap site (matches Plan 02's 'comment at every swap site' pattern so future developers see the contract next to the code)"
    - "Path-aware loader mock via mockImplementation returning sentinel only for the correct memoryPath-derived dir — tests catch the exact asymmetry between write and read paths"

key-files:
  created: []
  modified:
    - src/manager/session-config.ts (line 318 → 323: config.workspace → config.memoryPath + 5-line inline rationale comment)
    - src/manager/__tests__/session-config.test.ts (new describe block at end of file: 1 regression it-block + file-top loadLatestSummary named import for vi.mocked access)

key-decisions:
  - "Assertion target is (systemPrompt + mutableSuffix), not systemPrompt alone — Phase 52 two-block wiring routes context summary into the MUTABLE suffix (never stable prefix). Plan spec asked for systemPrompt but the resume-summary path specifically flows through the mutable block per Phase 52 D-05. Primary regression guard (toHaveBeenCalledWith the memoryPath-derived dir) is unchanged and catches the bug unambiguously."

patterns-established:
  - "Two-block assertion pattern for context-summary tests: `const assembled = result.systemPrompt + (result.mutableSuffix ?? ''); expect(assembled).toContain(...)` — future tests exercising resume-summary content should use this idiom so they're robust to whether the summary lands in the stable or mutable block."

requirements-completed:
  - SHARED-02

# Metrics
duration: 8min
completed: 2026-04-20
---

# Phase 75 Plan 04: Gap Closure — Session-Resume Context-Summary Load Path Summary

**Closes 75-VERIFICATION.md Truth #7 (FAILED → VERIFIED): one-line swap in `src/manager/session-config.ts:318` from `join(config.workspace, "memory")` to `join(config.memoryPath, "memory")` so the READ path matches the WRITE path in `AgentMemoryManager.saveContextSummary`. Adds a dedicated regression test that would have caught the asymmetry in Plan 03 if it had existed.**

## Performance

- **Duration:** ~8 minutes
- **Started:** 2026-04-20T14:43:19Z
- **Completed:** 2026-04-20T14:51:00Z (approximate)
- **Tasks:** 2/2 completed
- **Files modified:** 2 (1 source, 1 test)
- **LoC changed:** 10 insertions / 2 deletions across both files (7 effective diff lines in session-config.ts, 3 in the test file adjustment)

## The Fix

### Before (master — bug)

```typescript
// src/manager/session-config.ts:315-318
let contextSummaryStr = "";
const loadedSummary =
  contextSummary ??
  (await loadLatestSummary(join(config.workspace, "memory")));   // ← BUG
```

### After (fix)

```typescript
// src/manager/session-config.ts:315-323
let contextSummaryStr = "";
const loadedSummary =
  contextSummary ??
  // Phase 75 SHARED-02 — loadLatestSummary must resolve against
  // memoryPath (not workspace) so shared-workspace agents find the
  // context-summary.md that saveContextSummary wrote under
  // memoryPath/memory/. For dedicated-workspace agents the loader
  // fallback makes workspace === memoryPath, so this is a no-op.
  (await loadLatestSummary(join(config.memoryPath, "memory")));
```

## Why This Matters

Before the fix, the 5 finmentum agents (fin-acquisition, fin-research, fin-playground, fin-tax, finmentum-content-creator) would write their compaction context summaries to per-agent paths under `/shared/finmentum/<agent>/memory/context-summary.md` (WRITE side, correct since Plan 02) but the session-resume path at `buildSessionConfig` would look under `/shared/finmentum/memory/context-summary.md` (READ side, incorrect). The directories are different — every resume silently dropped the context summary, breaking session continuity that the whole Phase 52 resume-summary machinery was built for.

For the 10 dedicated-workspace agents the loader fallback makes `workspace === memoryPath`, so `/shared/dedicated-agent/memory/context-summary.md` is both the write target AND the read source — the bug was invisible.

## The Regression Test

New describe block in `src/manager/__tests__/session-config.test.ts`:

```
describe("buildSessionConfig — shared-workspace context summary resume (Phase 75 gap)", () => {
  it("reads context-summary.md from memoryPath/memory (not workspace/memory) for a shared-workspace agent", async () => { ... });
});
```

**Harness approach:**
1. Builds a `ResolvedAgentConfig` with `workspace: "/shared/fin"` and `memoryPath: "/shared/fin/fin-A"` (the exact shape finmentum agents take).
2. Path-aware `vi.mocked(loadLatestSummary).mockImplementation(...)` returns `"SHARED_WORKSPACE_RESUME_MARKER"` ONLY when called with `/shared/fin/fin-A/memory` (the memoryPath-derived dir); returns `undefined` for any other path (including the workspace-derived `/shared/fin/memory`).
3. Calls `buildSessionConfig(config, makeDeps())`.
4. Asserts two things:
   - **Primary regression guard:** `expect(vi.mocked(loadLatestSummary)).toHaveBeenCalledWith("/shared/fin/fin-A/memory")` — this is the bug-diagnostic assertion. If `session-config.ts` ever passes `config.workspace` again (the bug), this fails with a clear diff showing the wrong dir.
   - **End-to-end flow:** `expect(result.systemPrompt + (result.mutableSuffix ?? "")).toContain("SHARED_WORKSPACE_RESUME_MARKER")` — proves the summary content actually flows through `enforceSummaryBudget` + `assembleContext` into the assembled prompt. Phase 52 two-block wiring routes context summary into the MUTABLE suffix, so the combined assertion is the right check.

**Why the test was RED on master and is GREEN after the fix:**
- Master-pre-fix: loader called with `/shared/fin/memory` → mock returns undefined → `toHaveBeenCalledWith(/shared/fin/fin-A/memory)` FAILS with diff showing `/shared/fin/memory` was passed.
- Post-fix: loader called with `/shared/fin/fin-A/memory` → mock returns sentinel → both assertions pass.

Verified by `git stash` + re-run cycle (committed as Task 1 RED commit, proving the test diagnoses the exact bug before the fix ships).

## Atomic RED → GREEN Commits

| Commit | Type | Message | Files |
|--------|------|---------|-------|
| `597a1d4` | test | add failing regression test for shared-workspace session-resume context-summary load | session-config.test.ts (+46 lines) |
| `14311fc` | fix | resolve context-summary load against memoryPath for shared-workspace agents | session-config.ts (+7/-1), session-config.test.ts (+3/-1 two-block assertion adjustment) |

## Decisions Made

- **Inline Phase 75 SHARED-02 rationale comment at the swap site** — matches Plan 02's documented pattern (every memoryPath swap site got an inline comment citing Phase 75 SHARED-01). Future developers auditing the load path see the contract next to the code, not buried in this plan doc.
- **Assert against `systemPrompt + mutableSuffix`, not `systemPrompt` alone** — Phase 52 two-block wiring (D-05 in Phase 52) routes context summary into the MUTABLE suffix specifically so it stays OUT of the cached stable prefix (prompt-cache stability pitfall). The plan spec asked for `systemPrompt` but that was a plan-authoring oversight — the existing Test 9 in the same file (resume summary budget) asserts against `mutableSuffix` for the same reason. Combined-output assertion is robust to future block routing changes.
- **Named import of `loadLatestSummary` at file top** — lets the test use `vi.mocked(loadLatestSummary)` to get a typed mock handle. The file-scoped `vi.mock("../../memory/context-summary.js", ...)` block still intercepts the actual module — the named import is purely for TypeScript/Vitest to resolve the mock reference in the test body.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan spec] Adjusted Task 1's content assertion from `result.systemPrompt` to the combined stable+mutable output**
- **Found during:** Task 2 verification — after the fix, `toHaveBeenCalledWith(/shared/fin/fin-A/memory)` passed (primary regression guard green) but `expect(result.systemPrompt).toContain("SHARED_WORKSPACE_RESUME_MARKER")` failed because Phase 52 two-block wiring routes context summary into the MUTABLE suffix (per D-05), never into the stable prefix.
- **Why this is a plan-spec bug not a test bug:** The plan's `<behavior>` and `<action>` blocks specified `result.systemPrompt` but the Test 9 (`resumeSummaryBudget`) immediately above in the same test file already documents the correct routing: `expect(result.mutableSuffix).toContain("## Context Summary (from previous session)")`. The plan author didn't cross-reference it. The primary regression guard — `toHaveBeenCalledWith(...)` with the memoryPath-derived dir — is unchanged and unambiguously catches the bug.
- **Fix:** Changed assertion target to `const assembled = result.systemPrompt + (result.mutableSuffix ?? ""); expect(assembled).toContain(...)`. Documented with an inline comment citing Phase 52 two-block wiring.
- **Re-verification against master-pre-fix:** `git stash` + run confirmed the amended test STILL fails on master (at `toHaveBeenCalledWith` — the primary guard), proving the RED signal is preserved.
- **Committed in:** `14311fc` alongside the session-config.ts fix (both test adjustment and source fix land in the same commit since they're interdependent — the test alone is still a correct regression guard on master, it just needs the content-assertion fix to pass on the post-fix code).

### Deferred Issues (pre-existing, not caused by this plan)

Confirmed via `git stash` + vitest run on pristine master (excluding my changes):

1. **`src/manager/__tests__/daemon-openai.test.ts` — 7 failing tests** (documented pre-existing baseline per Plan 02 SUMMARY "Deferred Issues")
2. **`session-manager.test.ts > configDeps wiring > configDeps passes conversationStores and memoryStores`** — 1 failing test (documented pre-existing test-isolation flake per Plan 02 SUMMARY)
3. **`session-manager-memory-failure.test.ts > Test 6 — existing happy path still passes (no stub)`** — timeout under parallel test load (pre-existing; confirmed to fail on master without my changes)
4. **`daemon-task-store.test.ts > planting a stale running row...`** — flaky under parallel load (8s timeout; pre-existing)
5. **`bootstrap-integration.test.ts > buildSessionConfig with bootstrapStatus complete/undefined`** — flaky under parallel load (pre-existing; passed when run in isolation during verification)
6. **`session-manager.test.ts > stopAll > stops all running agents`, `> detects crash and restarts with backoff`, `> enters failed state after max retries`** — timeout-based flakes under parallel test load (pre-existing; all use 5-8s timeouts that blow under full-suite concurrency)
7. **29 pre-existing tsc errors** — unchanged baseline from Plan 01's deferred-items.md. No new errors introduced by this plan.

Per scope boundary rule: only auto-fix issues DIRECTLY caused by this plan's changes. All 11 parallel-suite failures are pre-existing flakes/timeouts unrelated to the one-line memoryPath swap. Zero new breakage. The one file touched (`session-config.test.ts`) runs 37/37 green in isolation.

## Verification

### Phase-level gap-closure greps (from plan's `<verification>` block)

| # | Check | Expected | Actual | Status |
|---|-------|----------|--------|--------|
| 1 | `grep -n 'join(.*memoryPath.*"memory")' src/manager/session-config.ts src/manager/session-memory.ts` | ≥1 in config.ts + ≥2 in memory.ts | 1 + 2 | PASS |
| 2 | `grep -rn 'loadLatestSummary.*workspace' src/manager/` | 0 matches | 0 matches | PASS |
| 3 | `grep -n 'shared-workspace context summary resume' src/manager/__tests__/session-config.test.ts` | 1 match | 1 match | PASS |
| 4 | `npx vitest run src/manager/__tests__/session-config.test.ts` | all pass | 37/37 pass | PASS |
| 5 | tsc baseline | 29 errors (unchanged) | 29 errors | PASS |

### Acceptance criteria greps

**Task 1:**
- `grep 'shared-workspace context summary resume'`: 1 match ✓
- `grep 'SHARED_WORKSPACE_RESUME_MARKER'`: 2 matches (mock + assertion) ✓
- `toHaveBeenCalledWith("/shared/fin/fin-A/memory")`: present (verified via multiline grep) ✓
- `import loadLatestSummary from context-summary`: 1 match ✓
- Pre-fix test failed with the exact expected diff ✓

**Task 2:**
- `grep 'loadLatestSummary(join(config\.memoryPath'`: 1 match ✓
- `grep 'loadLatestSummary(join(config\.workspace'`: 0 matches (bug pattern fully gone) ✓
- `grep 'Phase 75 SHARED-02'`: 1 match (inline rationale comment) ✓
- `session-config.test.ts` all 37 tests pass ✓
- `git diff src/manager/session-config.ts | grep ^[+-]` diff line count: 7 (well under 15) ✓
- tsc error count: 29 (matches master baseline) ✓

## Known Stubs

None. The fix replaces a wrong-path read with a correct-path read; no new stubs, placeholders, or TODO markers were introduced. The inline Phase 75 SHARED-02 comment is a rationale pointer, not a deferral.

## Next Step — Re-verify Phase 75

With Task 1 + Task 2 landed, all 7 must-have truths in `75-VERIFICATION.md` now hold:

- Truth #7 transitions FAILED → VERIFIED (the write/read asymmetry is closed).
- The regression test guarantees future refactors can't silently reintroduce the bug.

Recommended: run `/gsd:verify-phase 75` to mark Phase 75 fully verified (7/7) and unblock `/gsd:transition` to Phase 76.

## Self-Check: PASSED

- `src/manager/session-config.ts` exists; the one-line swap + 5-line inline comment are present at line 318-323.
- `src/manager/__tests__/session-config.test.ts` exists; the new describe block is at file-end with the regression `it`.
- Both task commit hashes (`597a1d4`, `14311fc`) are present in `git log --oneline -5`.
- Phase-level grep verification: 0 `loadLatestSummary.*workspace` matches anywhere in `src/manager/`; write (session-memory.ts:205) and read (session-config.ts:323) both resolve against `memoryPath/memory`.
- All 5 plan-level acceptance gates met exactly.
- 29 tsc errors pre-plan, 29 tsc errors post-plan → zero new errors introduced.
- session-config.test.ts 37/37 pass in isolation.
- No missing items.
