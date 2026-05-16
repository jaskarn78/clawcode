---
phase: 121
plan: 02
title: Sub-bug B chunk-boundary off-by-3 seam — fixed
subsystem: discord
tags: [subagent, chunk-boundary, overflow, regression-test]
completed: 2026-05-14
---

# Phase 121 Plan 02: Chunk-Boundary Off-by-3 Seam Summary

Editor truncated visible message at `slice(0, 1997) + "..."` while overflow loop started at `cursor = 2000`; bytes 1997..1999 of the wrapped reply were silently dropped at every Discord chunk seam. Fix: module-level `EDITOR_TRUNCATE_INDEX = 1997` aligns both `postInitialMessage` and `relayCompletionToParent` overflow cursors with the editor's actual visible cutoff, recovering those bytes as overflow chunk 1's leading bytes.

## Commits

| Task | SHA | Message |
| ---- | --- | ------- |
| T01 | `27c4883` | test(121-02-T01): failing fixture for chunk-boundary off-by-3 seam |
| T02 | `1e7a484` | feat(121-02-T02): close postInitialMessage off-by-3 seam (D-07) |
| T03 | `d134492` | feat(121-02-T03): close relayCompletionToParent off-by-3 seam (D-07) |

## Tests

- `src/discord/__tests__/subagent-chunk-boundary-fixture.test.ts` — 4 tests (4500-char load-bearing reconstruction, 2003-char off-by-3 detector, 1500-char baseline, SC-4 sibling audit).
- `src/discord/subagent-thread-spawner.test.ts:564` — existing 999.36-A1 diag re-pinned to post-fix values (overflowStartCursor: 1997, seamGapBytes: 0).

### Test run (final 5 lines, scoped suite)

```
 Test Files  4 passed (4)
      Tests  63 passed (63)
   Start at  02:14:01
   Duration  1.93s (transform 510ms, setup 0ms, import 1.29s, tests 2.03s, environment 0ms)
```

Full-repo `npx vitest run`: 6928 passed / 54 failed across 23 files, ALL pre-existing and outside Phase 121-02 scope (cli triggers, slash-commands, heartbeat discovery, bootstrap, openai endpoint, migration verifier). Verified by `grep -iE "subagent|spawner|chunk-boundary|webhook|relay|completion-gate"` over the FAIL list returning zero matches. Pre-existing on master per stash-verify (`triggers.test.ts` fails on `master` without my changes).

### Sanity greps (post-fix)

- `grep -c "let cursor = 2000;" src/discord/subagent-thread-spawner.ts` → **0**
- `grep -c "let cursor = EDITOR_TRUNCATE_INDEX;" src/discord/subagent-thread-spawner.ts` → **2**
- `grep -c "seamGapBytes: 0" src/discord/subagent-thread-spawner.ts` → **2**
- `grep "EDITOR_TRUNCATE_INDEX" src/discord/subagent-thread-spawner.ts` → 1 module-level decl + 2 cursor inits + 4 diag-field references.
- `npx tsc --noEmit` clean.

## Sibling Audit (SC-4)

`src/discord/webhook-manager.ts` `splitMessage` — **NO SEAM, no fix applied.**

Algorithm: linear `remaining = remaining.slice(splitIndex).trimStart()` with smart-break (lastIndexOf `\n` then ` `) and hard-split fallback at `maxLength`. No separate editor + overflow pipeline, no `"..."` truncation marker. For the 2003-char fixture: hits the hard-split branch at `splitIndex = 2000`, produces `["x".repeat(2000), "x".repeat(3)]`, joined length 2003, zero loss. Pinned by `SC-4 sibling audit` test in `subagent-chunk-boundary-fixture.test.ts`.

Note: `splitMessage` does trim whitespace at smart-break boundaries via `trimStart()` — documented intent, separate from the off-by-3 class; not in scope for this plan.

## Sample log output (post-fix)

From `subagent-chunk-boundary-fixture.test.ts` Test 1 run:

```json
{"level":30,"totalLength":4500,"editorCutoffIndex":1997,"overflowStartCursor":1997,"seamGapBytes":0,"chunksSent":2,"lastError":null,"fullySent":true,"endReason":"drained","msg":"subagent overflow chunks summary"}
```

Pre-fix (T01 RED run, same fixture): `overflowStartCursor:2000, seamGapBytes:3` — seam reproduced as expected. Post-fix: aligned.

## Deviations

- **Plan `<output>` spec stale.** Plan instructed `999.36-03-SUMMARY.md` in the 999.36 phase dir; operator task said `121-02-SUMMARY.md` in the 121 dir. Followed operator (advisor-confirmed).
- **T02 commit bundled the `999.36-A1` test re-pin** (lines 564-570 in `subagent-thread-spawner.test.ts`). Without bundling, `npm test` would have failed between T02 and T03 — operator constraint required tests green per commit.
- **Module-level `EDITOR_TRUNCATE_INDEX`** declared once at top of `subagent-thread-spawner.ts` (not inline in `postInitialMessage`) so T03 reuses it without redeclaration. Plan suggested this exact structure in T03 step 1.

## Evidence threads (for post-deploy operator verification)

- reelforge-build-v2 thread `1501361804012687504` — turn 1 mid-narrative cut, turn 2 mid-word "o-end" start. Pattern should not reproduce post-deploy.
- Admin Clawdy thread `1501302129782952126` — "lls the whole file" should read "reads the whole file".

## Open questions

None. Deploy hold continues per D-06 (Ramy active). Operator must run `scripts/deploy-clawdy.sh` when clear; post-deploy log grep `seamGapBytes` should show `0` across all `subagent overflow chunks summary` lines.

## Self-Check: PASSED

- `src/discord/__tests__/subagent-chunk-boundary-fixture.test.ts` — FOUND
- Commits `27c4883`, `1e7a484`, `d134492` — FOUND in `git log --oneline -5`
- `EDITOR_TRUNCATE_INDEX` module-level decl — FOUND (line 42)
- `let cursor = 2000;` — 0 matches confirmed
- `seamGapBytes: 0` — 2 matches confirmed
