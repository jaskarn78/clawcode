---
phase: 117
plan: 03
subsystem: advisor
tags: [advisor, refactor, extraction, legacy-fork, parity]
requires: ["117-02"]
provides: ["forkAdvisorConsult", "LegacyForkAdvisor"]
affects: ["src/manager/daemon.ts (ask-advisor IPC handler)"]
tech-stack:
  added: []
  patterns: ["AdvisorBackend adapter wrapping extracted primitive"]
key-files:
  created:
    - src/advisor/backends/legacy-fork.ts
    - src/advisor/backends/__tests__/legacy-fork.test.ts
  modified:
    - src/manager/daemon.ts
decisions:
  - "forkAdvisorConsult is signature-pure: caller builds systemPrompt + owns budget/truncation. Matches advisor-service.ts dispatch model."
  - "Did not move buildAdvisorSystemPrompt or memory-context retrieval into the function — both stay in the IPC handler until Plan 117-07 hands them to AdvisorService via resolveSystemPrompt."
  - "Used literal 'opus' as advisorModel in the IPC call site — Plan 117-06 lands the real resolver; this plan does not invent a placeholder resolveAdvisorModel()."
  - "Circular-dependency escape hatch (move to src/manager/fork-advisor.ts) NOT needed — daemon.ts already imports from src/advisor/prompts.ts and the dep graph remains a tree."
metrics:
  duration: ~45min
  tasks_completed: 4
  files_changed: 3
  tests_added: 9
  tests_passing: 39
  commits: 3
  completed: 2026-05-13T03:46Z
---

# Phase 117 Plan 03: Extract daemon.ts fork logic → LegacyForkAdvisor Summary

Extracted the inline fork-based `ask-advisor` handler body from
`daemon.ts:9810–9866` into a top-level exported `forkAdvisorConsult(manager, args)`
primitive, and wrapped it as a provider-neutral `LegacyForkAdvisor` backend.
The IPC handler still does memory-context retrieval, budget enforcement, and
2000-char truncation (Plan 117-07 moves those into `AdvisorService`);
this plan only does the extraction, preserving today's on-the-wire behavior
of `ask-advisor` exactly.

## Goal vs Outcome

- **Goal:** Replace the inline fork-and-dispatch body with a reusable function;
  wrap it as `AdvisorBackend` so the rollback path (operators flipping
  `agent.advisor.backend: "fork"`) routes through the same registry as the
  native + portable backends.
- **Outcome:** Achieved. `forkAdvisorConsult` is exported from `daemon.ts`;
  `LegacyForkAdvisor` wraps it; 9 parity tests pass; typecheck clean;
  advisor suite (5 files, 39 tests) green.

## Tasks Completed

| Task | Subject                                                                             | Commit  |
| ---- | ----------------------------------------------------------------------------------- | ------- |
| T01  | Baseline capture (no code change; folded into T02 via EXTRACTION_BASELINE comment)  | da4e649 |
| T02  | Extract fork body into `forkAdvisorConsult` + thin IPC handler                      | da4e649 |
| T03  | `LegacyForkAdvisor` class implementing `AdvisorBackend`                             | 445cc6e |
| T04  | `legacy-fork.test.ts` — parity + try/finally invariant coverage (9 tests)           | edfecf9 |

## Files

### Created
- `src/advisor/backends/legacy-fork.ts` (78 lines) — `LegacyForkAdvisor`
  class with `id: "fork"`, `consult()` delegating to `forkAdvisorConsult`.
  Doc-comment cites the dep graph and the documented escape hatch
  (move to `src/manager/fork-advisor.ts`) — not exercised.
- `src/advisor/backends/__tests__/legacy-fork.test.ts` (173 lines, 9 tests)
  covering id surface, happy-path arg propagation, the try/finally
  `stopAgent` invariant (the parity-critical regression), `stopAgent.catch`
  swallow parity, and direct-function parity for `forkAdvisorConsult`.

### Modified
- `src/manager/daemon.ts`:
  - Added import: `buildAdvisorSystemPrompt` from `../advisor/prompts.js`.
  - Added near top: exported `ForkAdvisorArgs` interface +
    `forkAdvisorConsult(manager, args)` function (~55 lines including
    doc-comment). Body is verbatim-equivalent to the previous inline
    fork/dispatch/stopAgent block.
  - Replaced the body at the `case "ask-advisor"` handler (was
    `:9836–9865`): system-prompt construction now delegated to
    `buildAdvisorSystemPrompt`; fork/dispatch/stopAgent now delegated
    to `forkAdvisorConsult`. Memory-context retrieval (top-5 semantic
    search), `advisorBudget.canCall` / `recordCall` / `getRemaining`,
    and the 2000-char truncation REMAIN INLINE — they move to
    `AdvisorService` in Plan 117-07.

## Behavior Parity Guarantees Preserved

1. **Memory-context retrieval** — unchanged. The top-5 semantic search
   over the agent's memory store still happens in the IPC handler before
   the fork.
2. **Fork model + system prompt** — unchanged. Still forks with
   `modelOverride: "opus"` and `systemPromptOverride: systemPrompt`.
3. **try/finally `stopAgent`** — unchanged. The most important invariant:
   `stopAgent` ALWAYS fires after `dispatchTurn`, including when
   `dispatchTurn` throws. Verified by test
   `consult() — try/finally stopAgent invariant > still calls stopAgent
   when dispatchTurn rejects, then re-throws`.
4. **`stopAgent.catch(() => {})`** — unchanged. Cleanup failures are
   swallowed. Verified by test `swallows stopAgent errors after a
   successful dispatch`.
5. **Truncation at `ADVISOR_RESPONSE_MAX_LENGTH`** — unchanged. Still
   applied in the IPC handler after `forkAdvisorConsult` returns.
6. **Budget ordering** — unchanged. `recordCall` still fires AFTER a
   successful return (failed turns do not charge the daily budget).
7. **IPC response shape** — unchanged. `{ answer, budget_remaining }`.
8. **`ADVISOR_RESPONSE_MAX_LENGTH` constant** — used from
   `src/usage/advisor-budget.ts` (no redefinition).

## Decisions Made

1. **`forkAdvisorConsult` is signature-pure.** Caller builds the system
   prompt and owns budget/truncation. This matches the dispatch model
   of `DefaultAdvisorService` (Plan 117-02 `service.ts`), so Plan 117-07
   can drop in the service replacement without changing the function
   signature. Locks the contract: function does fork + dispatch + finally
   stopAgent, nothing else.
2. **Did NOT move memory-context retrieval into `forkAdvisorConsult`.**
   The user prompt called for "same memory-context retrieval" as a
   parity gate; the plan T02 example signature takes `systemPrompt` as
   an input, contradicting that. Resolved per advisor: caller (IPC
   handler now, `AdvisorService.resolveSystemPrompt` in 117-07) builds
   the prompt; function stays signature-pure. Parity preserved end-to-end
   because the caller's retrieval logic is byte-identical to the
   pre-117-03 inline block.
3. **`advisorModel: "opus"` literal at the call site.** Plan T02
   mentioned `resolveAdvisorModel()` but that resolver lands in Plan
   117-06; using a literal here matches today's
   `modelOverride: "opus" as const` exactly and avoids inventing a
   placeholder API.
4. **Circular-dependency escape hatch NOT used.** Verified the dep
   graph remains a tree: `legacy-fork.ts → daemon.ts → advisor/prompts.ts`.
   No file in `src/advisor/` is imported by `daemon.ts` other than
   `prompts.ts`. The escape hatch (move `forkAdvisorConsult` to
   `src/manager/fork-advisor.ts`) is documented in `legacy-fork.ts`'s
   header for future maintainers.

## Deviations from Plan

**None.** Plan executed as written. The plan T02 sketch had a stray
reference to `resolveAdvisorModel()` (a function that lands in 117-06
and doesn't exist yet); the executor used the literal `"opus"` as
documented in the "Decisions Made" section above. This is consistent
with the plan's intent (`# read from defaults until 117-06 wires
per-agent`).

## Testing

- `npm run typecheck` — clean (after every task).
- `npm test -- src/advisor/backends/__tests__/legacy-fork.test.ts` — 9/9
  pass.
- `npm test -- src/advisor/` — 5 files, 39 tests, all green.
- `npm test -- src/manager/` — pre-existing 17 unrelated failures
  documented below; no new regressions introduced.

### Test Coverage Detail

| # | Test                                                                                            | Asserts                                  |
| - | ----------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1 | identifies as the legacy fork backend (id === 'fork')                                           | `id` surface                              |
| 2 | returns the raw answer from dispatchTurn (no truncation)                                        | Happy path return shape                  |
| 3 | forks the parent agent with the supplied advisorModel + systemPrompt                            | `forkSession` arg propagation            |
| 4 | dispatches one turn carrying the question to the fork                                           | `dispatchTurn` arg propagation           |
| 5 | calls stopAgent(forkName) in finally on the happy path                                          | `stopAgent` happy-path invocation        |
| 6 | still calls stopAgent when dispatchTurn rejects, then re-throws                                 | **try/finally invariant** (parity-crit)  |
| 7 | swallows stopAgent errors after a successful dispatch (parity with daemon `.catch(() => {})`)   | Cleanup-failure swallow                  |
| 8 | forkAdvisorConsult() direct call — produces the same result the class wrapper would             | Adapter has no logic                     |
| 9 | forkAdvisorConsult() direct call — preserves the try/finally invariant at the function level    | Invariant on the primitive               |

## Pre-existing Test Failures (NOT caused by this change)

Confirmed by stashing the diff and re-running `src/manager/` — 17
failures exist on master before this plan. They live in:

- `src/manager/__tests__/bootstrap-integration.test.ts` (2)
- `src/manager/__tests__/daemon-openai.test.ts` (7)
- `src/manager/__tests__/daemon-warmup-probe.test.ts` (1)
- `src/manager/__tests__/dream-prompt-builder.test.ts` (2)
- `src/manager/__tests__/session-config.test.ts` (5)

None touch the advisor IPC path. Documented here per the executor
guidance to flag pre-existing failures and proceed.

## Out of Scope (Confirmed Untouched)

- `src/mcp/server.ts` (Plan 117-07).
- `src/config/*` (Plan 117-06 — separate parallel execution).
- Wiring `LegacyForkAdvisor` into `AdvisorService` registry
  (Plan 117-06 + 117-07).
- `AnthropicSdkAdvisor` (Plan 117-04).
- `PortableForkAdvisor` implementation (Phase 118; scaffold lives
  in 117-05).
- On-the-wire behavior of `ask-advisor` IPC — verified identical.

## Self-Check: PASSED

- [x] `src/advisor/backends/legacy-fork.ts` exists
- [x] `src/advisor/backends/__tests__/legacy-fork.test.ts` exists
- [x] `src/manager/daemon.ts` modified (forkAdvisorConsult exported,
      IPC handler thin)
- [x] Commit da4e649 (T02) found in git log
- [x] Commit 445cc6e (T03) found in git log
- [x] Commit edfecf9 (T04) found in git log
- [x] `npm run typecheck` exit 0
- [x] `npm test -- src/advisor/` — 39/39 green
- [x] `npm test -- src/advisor/backends/__tests__/legacy-fork.test.ts` — 9/9 green
- [x] Try/finally `stopAgent` invariant preserved (test #6 enforces it)
- [x] No circular-dep escape hatch used (graph remains a tree)
- [x] `ADVISOR_RESPONSE_MAX_LENGTH` reused from
      `src/usage/advisor-budget.ts` (no redefinition)
- [x] `ask-advisor` IPC handler still calls into the new function
      inline (handler re-point to AdvisorService deferred to 117-07
      per plan T03 note)
