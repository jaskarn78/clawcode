---
phase: 125
plan: 03
subsystem: compact-extractors
title: Tier 2 Haiku structured extraction + dual persistence (YAML + memory.db)
sentinel: "[125-03-tier2-haiku]"
status: complete
tags:
  - tier2
  - haiku
  - structured-extraction
  - yaml-persistence
  - silent-path-bifurcation-prevented
requires:
  - 125-01  # active-state writer (consumed via onTier2Facts callback)
  - 125-02  # extractor seam (this plan plugs tier2Summarize + onTier2Facts into BuildExtractorDeps)
provides:
  - tier2 LLM-grounded structured-extraction pipeline behind the D-01 seam
  - flattened tier2 facts persisted to memory.db (one chunk per fact)
  - operator-inspectable ~/.clawcode/agents/<agent>/state/active-state.yaml refreshed with tier2 merge
affects:
  - src/manager/compact-extractors/index.ts (tier2 plugged into output ordering)
  - src/manager/active-state/builder.ts (optional tier2Facts merge — LLM > heuristic)
  - src/manager/daemon.ts (both compact-dispatch sites — silent-path gate honored)
tech-stack:
  added:
    - none (zod + yaml already in tree)
  patterns:
    - DI'd Tier2SummarizeFn matching FlushSummarizeFn shape (reuses session-summarizer pattern, D-03)
    - module-level sentinel Set (mirrors TIER4_SENTINEL_FIRED)
    - parser hardening: code-fence strip + prose-preamble strip + JSON fallback (Phase 95 dreaming lessons)
key-files:
  created:
    - src/manager/compact-extractors/tier2-prompt.ts
    - src/manager/compact-extractors/tier2-parser.ts
    - src/manager/compact-extractors/tier2-haiku.ts
    - src/manager/compact-extractors/__tests__/tier2-prompt.test.ts
    - src/manager/compact-extractors/__tests__/tier2-parser.test.ts
    - src/manager/compact-extractors/__tests__/tier2-haiku.test.ts
    - src/manager/active-state/__tests__/builder-tier2-merge.test.ts
  modified:
    - src/manager/compact-extractors/types.ts (Tier2Facts + Tier2SummarizeFn + extra BuildExtractorDeps fields)
    - src/manager/compact-extractors/index.ts (tier2 plugged ahead of tier4 chunks)
    - src/manager/active-state/types.ts (BuildActiveStateInput.tier2Facts)
    - src/manager/active-state/builder.ts (mergeWithTier2)
    - src/manager/compact-extractors/__tests__/seam-integration.test.ts (3 new cases)
    - src/manager/daemon.ts (both dispatch sites wired identically)
decisions:
  - reused summarizeWithHaiku verbatim (D-03 — OAuth-Bearer path, no new worker)
  - parser returns null on every failure mode; seam falls through to Plan 02 output
  - tier2 chunks ride AHEAD of tier4 in output so they survive maxChunks cap
  - onTier2Facts callback owns YAML merge — seam stays FS-free (advisor recommendation)
  - text under 40 chars early-returns null without invoking Haiku (cost discipline)
metrics:
  duration: ~22min
  completed: 2026-05-14
  tasks: 3
  tests_added: 22 (5 prompt + 9 parser + 7 haiku-harness + 5 builder-merge + 3 seam-integration tier2 cases — counting the flattener spec as part of haiku-harness)
  tests_passing: 61/61 plan + 30 Phase 124 regression
---

# Phase 125 Plan 03: Tier 2 Haiku Structured Extraction — Summary

LLM-grounded structured extraction (active clients, decisions, standing rules, in-flight tasks, drive paths, recover-or-lose-it numbers) wired behind the Plan 02 seam, output dual-persisted to memory.db chunks and operator-inspectable active-state.yaml.

## Commits

- `a5faf64` — feat(125-03-T01): tier2 prompt + parser + Tier2Facts type
- `3f6fad2` — feat(125-03-T02): tier2 haiku harness + seam wiring
- `09fcd09` — feat(125-03-T03): wire tier2 into builder + daemon (both sites) + YAML persistence

## Grep Gates (all pass)

- `grep -cn "tier2Summarize" src/manager/daemon.ts` → **2** (silent-path-bifurcation prevention, both sites wired in one commit)
- `grep -c "\[125-03-tier2-haiku\]" src/manager/compact-extractors/tier2-haiku.ts` → **5** (sentinel + 4 fallback log lines)
- `npx tsc --noEmit` → clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `activeStateBaseDir` not in scope at IPC site**
- **Found during:** T-03 typecheck (`TS2304: Cannot find name 'activeStateBaseDir'`).
- **Issue:** `activeStateBaseDir` is declared inside `startDaemon` at line 3512, but the `case "compact-session"` IPC handler at line 10655 is inside a separate IPC-dispatch closure that doesn't capture the outer const.
- **Fix:** Inlined `join(homedir(), ".clawcode", "agents")` at the IPC `onTier2Facts` callsite. Same path, same imports already present at file top.
- **Files modified:** `src/manager/daemon.ts`.
- **Commit:** `09fcd09`.

**2. [Rule 1 — Bug] Seam-integration ordering assertion misread preserved chunks**
- **Found during:** First run of the new "tier2 wired" seam test.
- **Issue:** Both preserved facts and tier4 turns share the `[user]:` / `[assistant]:` prefix; my naive findIndex picked up preserved facts (which sit BEFORE tier2) as "first tier4".
- **Fix:** Build a Set of preserved-fact strings and skip those when locating the first tier4 chunk.
- **Commit:** `3f6fad2`.

Otherwise plan executed exactly as written.

## Authentication Gates

None — `summarizeWithHaiku` uses the OAuth Bearer path that's already wired daemon-wide.

## Open Items / Hand-off to Plan 04

- **Plan 04 (Tier 3 prose)** is the final plan in the v2.9 milestone. Tier 3 takes the same `toCompact` text and produces the prose summary that rides at the head of the fork-summary turn (Phase 124's summary-prepend mechanism). Tier 2 facts are upstream input to Tier 3 (e.g., the prose can reference verbatim client names + decisions Tier 2 extracted).
- **Production proof deferred.** Operator deploy hold (Ramy-active per `feedback_ramy_active_no_deploy.md`) still applies — `journalctl -u clawcode -g '\[125-03-tier2-haiku\]'` end-to-end proof against a live agent is held until deploy clearance.
- **memory.db chunk-count growth.** Already proven in the seam-integration end-to-end test (`facts.length > 0` with `[tier2]` chunks present). Phase 124's `CompactionResult.memoriesCreated > 0` integration test continues to pass — and now counts grow further when tier2 fires.

## Test Run

`npx vitest run src/manager/compact-extractors/__tests__/ src/manager/active-state/__tests__/`

```
 Test Files  9 passed (9)
      Tests  61 passed (61)
   Start at  15:38:22
   Duration  1.03s
```

Phase 124 regression (`compaction.test.ts`, `compact-session-integration.test.ts`, `compaction-event-log.test.ts`, `compaction-counter.test.ts`): 30/30 passing.

## Self-Check: PASSED

- Created files:
  - `src/manager/compact-extractors/tier2-prompt.ts` — FOUND
  - `src/manager/compact-extractors/tier2-parser.ts` — FOUND
  - `src/manager/compact-extractors/tier2-haiku.ts` — FOUND
  - `src/manager/compact-extractors/__tests__/tier2-prompt.test.ts` — FOUND
  - `src/manager/compact-extractors/__tests__/tier2-parser.test.ts` — FOUND
  - `src/manager/compact-extractors/__tests__/tier2-haiku.test.ts` — FOUND
  - `src/manager/active-state/__tests__/builder-tier2-merge.test.ts` — FOUND
- Commits: a5faf64, 3f6fad2, 09fcd09 — all FOUND in `git log --oneline`.
