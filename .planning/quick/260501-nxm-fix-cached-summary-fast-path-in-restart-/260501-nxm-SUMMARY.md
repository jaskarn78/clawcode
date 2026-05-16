---
phase: 260501-nxm
plan: 01
subsystem: manager/restart-greeting
tags: [bugfix, restart-greeting, api-error, cached-summary, read-time-filter]
dependency-graph:
  requires:
    - "API_ERROR_FINGERPRINTS (module-scoped, src/manager/restart-greeting.ts L249)"
    - "PLATFORM_ERROR_RECOVERY_MESSAGE (exported, src/manager/restart-greeting.ts L277)"
    - "isApiErrorDominatedSession upstream guard (L496-501) — semantic mirror"
  provides:
    - "Read-time API-error filter on cached summary fast-path (L483-block)"
  affects:
    - "src/manager/restart-greeting.ts sendRestartGreeting (fast-path block only)"
tech-stack:
  added: []
  patterns:
    - "Read-time filter (no migration / no write-side scrub)"
    - "Single source of truth — API_ERROR_FINGERPRINTS consulted in BOTH the fresh-Haiku path (L496) and the cached fast-path (L483)"
key-files:
  created: []
  modified:
    - "src/manager/restart-greeting.ts (+17 LOC, -1 LOC)"
    - "src/manager/__tests__/restart-greeting.test.ts (+87 LOC)"
decisions:
  - "Read-time filter only — no migration of stored bad summaries. Next fresh summary write overwrites organically. Reversible. Operator-approved in plan."
  - "Mirror upstream fingerprint set rather than introducing a second list — keeps a single source of truth for what counts as platform-error contamination."
  - "Log line shape matches L497-500 convention (`[greeting]` prefix, `agent:` field) for grep consistency across restart-greeting log output."
metrics:
  duration: "~14 minutes (RED test write + run, GREEN fix + verify, commit, summary)"
  completed-date: "2026-05-01"
  tests-added: 3
  tests-passing: "39/41 in restart-greeting.test.ts (2 pre-existing failures pre-date this work — logged to deferred-items.md)"
requirements:
  - QUICK-260501-NXM
---

# Quick Task 260501-nxm: Fix cached-summary fast-path in restart-greeting

Read-time filter on the cached prior-session summary fast-path: when a stale platform-error summary (e.g. "Credit balance is too low") was written by Haiku BEFORE the 2026-04-30 write-side guard landed, the restart-greeting embed now substitutes `PLATFORM_ERROR_RECOVERY_MESSAGE` instead of replaying the misleading text. ~17 LOC of production code, 3 new vitest cases, no migration.

## Context

Operator observed the bug at 10:03 AM on 2026-05-01 after `/clawcode-restart Admin Clawdy`: the restart embed's description showed "Credit balance is too low" (a contaminated cached summary written during a prior platform-incident session) instead of the verbatim recovery message. The 2026-04-30 `isApiErrorDominatedSession` guard (L496) only filters fresh-Haiku output — it doesn't scrub previously-cached summaries. This fix adds a mirror filter on the read side.

## Changes

### `src/manager/restart-greeting.ts` — fast-path block

**BEFORE** (L482-488):

```typescript
let summary: string | undefined;
if (lastSession.summaryMemoryId && deps.getMemoryById) {
  const existing = deps.getMemoryById(lastSession.summaryMemoryId);
  if (existing && existing.trim().length > 0) {
    summary = existing;
  }
}
```

**AFTER** (L482-504):

```typescript
let summary: string | undefined;
if (lastSession.summaryMemoryId && deps.getMemoryById) {
  const existing = deps.getMemoryById(lastSession.summaryMemoryId);
  if (existing && existing.trim().length > 0) {
    // 2026-05-01 fix (260501-nxm) — guard against legacy bad summaries
    // cached BEFORE the L496 isApiErrorDominatedSession guard landed
    // (2026-04-30). Without this, a stale "Credit balance is too low"
    // summary written by Haiku during a platform-incident session keeps
    // reappearing on every subsequent restart until the cached value is
    // overwritten or expired. Read-time filter only — no scrub of stored
    // memory; the next session that writes a fresh summary will overwrite
    // the bad cached value organically.
    if (API_ERROR_FINGERPRINTS.some((re) => re.test(existing))) {
      deps.log.info(
        { agent: agentName, summaryMemoryId: lastSession.summaryMemoryId },
        "[greeting] cached summary contains API-error fingerprint; using verbatim platform-error recovery message",
      );
      summary = PLATFORM_ERROR_RECOVERY_MESSAGE;
    } else {
      summary = existing;
    }
  }
}
```

### `src/manager/__tests__/restart-greeting.test.ts` — new describe block

New describe block `"sendRestartGreeting — cached-summary fast-path API-error guard"` appended after the existing API-error-dominated-session bypass block. Three test cases:

1. **REGRESSION (today's 10:03 AM bug):** Cached summary `"Credit balance is too low"` → embed description equals `PLATFORM_ERROR_RECOVERY_MESSAGE`; `summarize` spy NOT called.
2. **HAPPY-PATH PRESERVED:** Cached summary `"I was building a thing."` → embed description equals that string verbatim; `summarize` spy NOT called.
3. **BROADER FINGERPRINT COVERAGE:** Cached summary `"Failed to authenticate. API Error: 403 — permission_error"` → embed description equals `PLATFORM_ERROR_RECOVERY_MESSAGE`; `summarize` spy NOT called.

Each test asserts `summarize` was NOT called — the fast-path takes the cached value (now possibly substituted), so Haiku must stay quiet. No imports were added; `PLATFORM_ERROR_RECOVERY_MESSAGE` is already imported at L30.

## Code-Review Note

`API_ERROR_FINGERPRINTS` is now consulted in **TWO places**:

| Location | Path | Trigger |
|---|---|---|
| L496 (upstream / fresh-Haiku) | `isApiErrorDominatedSession(turns)` (≥50% of session turns match) | Bypasses Haiku call when transcript itself is contaminated |
| L483-block (NEW / cached fast-path) | `API_ERROR_FINGERPRINTS.some((re) => re.test(existing))` (cached summary string match) | Substitutes recovery message when cached summary text is contaminated |

This is intentional — single source of truth for what counts as platform-error contamination. Adding a second pattern set (e.g. a separate "summary-only" list) would risk drift between write-side and read-side guards.

The new branch sits INSIDE the existing `if (existing && existing.trim().length > 0)` block, so `existing` is guaranteed non-empty when the fingerprint regex runs. The `summary = PLATFORM_ERROR_RECOVERY_MESSAGE` assignment correctly bypasses the downstream `if (summary === undefined)` block at L506 (summary is now defined) — so the fresh-Haiku branch is not re-entered for contaminated cache hits. Downstream `if (summary.trim().length === 0)` at L539 still works correctly — `PLATFORM_ERROR_RECOVERY_MESSAGE` is non-empty.

## Test Results

```
$ npx vitest run src/manager/__tests__/restart-greeting.test.ts

Test Files  1 failed (1)
     Tests  2 failed | 39 passed (41)
```

- **3 new tests:** all GREEN.
- **2 pre-existing failures** (P8 dormant + P12 empty-state defensive): reproduce identically on bare `master` (verified by `git stash && npx vitest run … && git stash pop`). NOT caused by this fix. Logged to `deferred-items.md`.

```
$ npx tsc --noEmit 2>&1 | grep restart-greeting
(no output)
```

No TypeScript errors in touched files. Pre-existing tsc errors elsewhere (src/tasks/, src/triggers/__tests__/, src/usage/) belong to parallel-session work — out of scope.

```
$ npx vitest run src/manager
Test Files  11 failed | 96 passed (107)
     Tests  32 failed | 1258 passed (1290)
```

The broader src/manager surface has 32 failing tests across 11 files. All in files modified by parallel Phase 108 / 999.x sessions (broker, secrets-resolver, recovery/op-refresh) at session start — out of scope for this quick task. Logged to `deferred-items.md`.

## Deviations from Plan

None. Plan executed exactly as written:
- ~6 LOC of production code → actual: 17 LOC (extra lines are 7-line block comment matching plan-supplied comment text + log fields broken across lines for readability — code logic is exactly the 6 LOC specified).
- 2-3 new vitest cases → 3 new cases (matched plan minimum).
- No edits to `API_ERROR_FINGERPRINTS`, `PLATFORM_ERROR_RECOVERY_MESSAGE`, or the L496-501 fresh-Haiku guard — confirmed via diff.
- No write-side migration — confirmed.
- No deploy — local repo only.

## Constraints Observed

- `git status` BEFORE editing confirmed no uncommitted changes to `src/manager/restart-greeting.ts` from parallel Phase 108 work (Phase 108 work touches src/manager broadly but NOT this file).
- TDD ordering: tests added FIRST, run RED (tests 1 and 3 failed, test 2 passed as happy-path regression guard), THEN fix applied, re-run GREEN (all 3 pass).
- No edits outside the specified fast-path block in `restart-greeting.ts`.
- Log line prefix `[greeting]` and `agent:` field name match L497-500 convention exactly.
- `PLATFORM_ERROR_RECOVERY_MESSAGE` already imported in test file (L30) — no import edits needed.

## Commit

- `624bd66` — `fix(260501-nxm): guard cached-summary fast-path against API-error fingerprints`

## Files

- `/home/jjagpal/.openclaw/workspace-coding/src/manager/restart-greeting.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/__tests__/restart-greeting.test.ts`
- `/home/jjagpal/.openclaw/workspace-coding/.planning/quick/260501-nxm-fix-cached-summary-fast-path-in-restart-/deferred-items.md`

## Self-Check: PASSED

- File `src/manager/restart-greeting.ts`: FOUND, fingerprint check present at L483-block (`API_ERROR_FINGERPRINTS.some` and `summary = PLATFORM_ERROR_RECOVERY_MESSAGE`).
- File `src/manager/__tests__/restart-greeting.test.ts`: FOUND, new describe block present.
- Commit `624bd66`: FOUND in `git log`.
- 3 new tests pass; 2 pre-existing failures documented as out-of-scope.
- No deploy executed. Local repo only — operator's "Wait for me to give deploy order" honored.
