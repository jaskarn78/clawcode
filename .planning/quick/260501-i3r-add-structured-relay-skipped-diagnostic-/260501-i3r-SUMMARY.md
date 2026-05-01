---
phase: 260501-i3r-add-structured-relay-skipped-diagnostic-
plan: 01
subsystem: discord/subagent-thread-spawner
tags: [observability, logging, diagnostics, discord, subagent]
type: quick
requirements: [QUICK-260501-i3r]
dependency_graph:
  requires: []
  provides:
    - "Structured `subagent relay skipped` log line at all 5 silent-return sites in `relayCompletionToParent`."
  affects:
    - "Operations runbooks searching for dropped subagent completion summaries can now grep `\"subagent relay skipped\"` and read `reason` to localize the branch in one query."
tech_stack:
  added: []
  patterns:
    - "Pino structured logging with stable kebab-case `reason` enum tags."
key_files:
  created: []
  modified:
    - src/discord/subagent-thread-spawner.ts
decisions:
  - "All five log calls share one message string (`subagent relay skipped`) so a single grep finds every drop; the `reason` field discriminates the branch."
  - "Tags are kebab-case (`no-turn-dispatcher`, `no-binding`, `no-channel-or-not-text`, `no-bot-messages`, `empty-content-after-concat`) — chosen to be stable enough for log queries / dashboards without renaming churn."
  - "Pure observability change — zero modifications to relay logic, conditions, message-fetch, prompt construction, happy-path log, or outer try/catch. Existing 36 tests pass byte-for-byte unchanged."
metrics:
  duration_minutes: 4
  completed_date: 2026-05-01
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
  commits: 1
---

# Quick Task 260501-i3r: Add Structured Relay-Skipped Diagnostic Logs Summary

Pure observability fix — `relayCompletionToParent` in `src/discord/subagent-thread-spawner.ts` now emits a structured `subagent relay skipped` log line with a `reason` discriminator at every one of its five silent-return sites, so the next time a subagent completion summary fails to land in the parent's main channel, ops can identify the branch in one grep instead of reasoning through five candidate code paths.

## What Changed

A single file modified — `src/discord/subagent-thread-spawner.ts` — with five `this.log.info(...)` calls inserted immediately before each existing silent `return;` statement inside `relayCompletionToParent`. Each `if (...) return;` guard was converted from a single-line statement to a brace block whose only addition is the new log call; control flow, return semantics, and surrounding code are unchanged.

### Logs added (post-edit line numbers)

| Line | Site                                      | Reason tag                        |
| ---- | ----------------------------------------- | --------------------------------- |
| 203  | `if (!this.turnDispatcher)`               | `no-turn-dispatcher`              |
| 210  | `if (!binding)`                           | `no-binding`                      |
| 215  | `if (!channel \|\| !("messages" in channel))` | `no-channel-or-not-text`        |
| 252  | `if (subagentChunks.length === 0)`        | `no-bot-messages`                 |
| 258  | `if (!fullSubagentReply)`                 | `empty-content-after-concat`     |

All five share the same message string: `"subagent relay skipped"`. The `threadId` field is the function parameter (always in scope). The happy-path log at the new L300 (`"subagent completion relayed to parent"`) and the outer warn try/catch (`"subagent completion relay failed (non-fatal — cleanup continues)"`) are unchanged.

## Tasks Completed

| Task | Name                                              | Commit  | Files                                       |
| ---- | ------------------------------------------------- | ------- | ------------------------------------------- |
| 1    | Add five structured relay-skipped diagnostic logs | 4a38e36 | `src/discord/subagent-thread-spawner.ts`    |
| 2    | Run existing test suite to confirm no regressions | n/a     | (verification only — no file changes)       |

## Verification

All success criteria from PLAN.md met:

- `grep -n 'subagent relay skipped' src/discord/subagent-thread-spawner.ts` → 5 hits at lines 203/210/215/252/258.
- `grep` for the five reason tags → exactly 5 lines (one per reason).
- `grep -c 'subagent completion relayed to parent'` → 1 (happy-path log unchanged).
- `grep -c 'subagent completion relay failed'` → 1 (outer warn unchanged).
- `npx tsc --noEmit -p tsconfig.json | grep subagent-thread-spawner` → zero errors in the modified file. (Pre-existing tsc errors in unrelated files — `cli/commands/__tests__/*`, `config/__tests__/differ.test.ts`, etc. — are out of scope per the GSD scope_boundary rule and predate this task.)
- `npx vitest run src/discord/subagent-thread-spawner.test.ts` → **36/36 tests pass** (513ms). The new `reason: "no-turn-dispatcher"` log fires as expected throughout the test run, visible in pino output.

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None.

## Known Stubs

None. The change is self-contained observability with no follow-up wiring required.

## Self-Check: PASSED

- FOUND: `src/discord/subagent-thread-spawner.ts` (modified, 5 new log calls confirmed by grep)
- FOUND: commit `4a38e36` (`feat(260501-i3r-01): add structured relay-skipped diagnostic logs`)
