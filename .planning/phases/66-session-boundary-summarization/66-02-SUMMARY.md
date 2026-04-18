---
phase: 66-session-boundary-summarization
plan: 02
subsystem: memory
tags: [typescript, tdd, vitest, pino, abort-controller, session-summarization]

# Dependency graph
requires:
  - phase: 66-01
    provides: CreateMemoryInput.sourceTurnIds write path, atomic lineage persistence
  - phase: 64-conversation-schema-foundations
    provides: ConversationStore.getSession/getTurnsForSession/markSummarized, session state machine
  - phase: 65-capture-integration
    provides: conversation_turns populated by capture helper (tested indirectly via real store)
provides:
  - SessionSummarizer pure dep-injected pipeline (summarizeSession) — no SDK or daemon imports
  - SummarizeFn injection point for Plan 03 to wire sdk.query() with Haiku
  - buildSessionSummarizationPrompt (4-category structured prompt with proportional truncation)
  - buildRawTurnFallback (deterministic markdown dump for timeout/error recovery)
  - SummarizeSessionDeps / SummarizeSessionInput / SummarizeSessionResult types (discriminated union)
  - Timeout-wrapped LLM invocation via AbortController + Promise.race (default 10_000ms)
  - Dual-write dance: memoryStore.insert → conversationStore.markSummarized (non-fatal if race)
affects: [66-03-session-manager-integration, 67-auto-inject-on-resume]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure pipeline + injected LLM call (mirrors consolidation.ts ConsolidationDeps pattern)"
    - "AbortController + Promise.race for cooperative cancellation with hard timeout fallback"
    - "Object.freeze() on all returned results (immutability invariant per coding-style.md)"
    - "Discriminated union result type: success vs skipped-with-reason (no throws to caller)"
    - "Raw-turn fallback preserves idempotency: session still transitions to summarized even on LLM failure"

key-files:
  created:
    - src/memory/session-summarizer.types.ts
    - src/memory/session-summarizer.ts
    - src/memory/__tests__/session-summarizer.test.ts
  modified: []

key-decisions:
  - "Fallback path STILL marks session summarized (idempotency wins over perfect summary): a raw-turn dump tagged 'raw-fallback' is better than retrying forever and leaking unbounded retries into daemon logs"
  - "Summarizer NEVER throws to caller (returns discriminated union): a summarization failure is not a session-lifecycle failure — the bridge/SessionManager in Plan 03 shouldn't crash because the LLM had a bad day"
  - "turns.length guard uses getTurnsForSession (actual rows), NOT session.turnCount (eventually-consistent counter): Pitfall 2 from 66-RESEARCH.md — fire-and-forget recordTurn in Phase 65 means turn_count lags real row count under load"
  - "markSummarized failure is non-fatal post-insert: if the memory row landed, the summary exists and is searchable — orphan FK is recoverable, losing the summary is not"
  - "Empty LLM response triggers fallback (not retry): prevents a silent hang in production where Haiku returns '' due to context issues; operators can find these via 'raw-fallback' tag"
  - "skipDedup: true on insert: session summaries are unique by definition — allowing dedup to merge them would collapse distinct session histories"

patterns-established:
  - "AbortController + Promise.race pattern for timeout: `Promise.race([fn(signal), abortToReject(signal)])` + finally-clearTimeout cleanup"
  - "Dep-injection shape for LLM-driven memory producers: `{conversationStore, memoryStore, embedder, summarize, log, config?}` — reusable for future summarizers"
  - "ConversationTurn test-fixture helper (`makeTurn`) pattern for pure-helper unit tests — avoids real DB overhead for type-only checks"

requirements-completed:
  - SESS-01
  - SESS-04

# Metrics
duration: ~5min
completed: 2026-04-18
---

# Phase 66 Plan 02: SessionSummarizer module Summary

**Pure dependency-injected session-boundary summarization pipeline — compresses a completed (ended or crashed) conversation session into a standard MemoryEntry (source="conversation", tags ["session-summary", "session:{id}"], sourceTurnIds populated) via an injected `summarize` function, with AbortController-timeout, raw-turn fallback on LLM failure, and idempotent markSummarized dual-write.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-18T14:35:16Z
- **Completed:** 2026-04-18T14:39:50Z
- **Tasks:** 2 (both committed atomically)
- **Files created:** 3 (2 source, 1 test)
- **Tests added:** 19

## Accomplishments

- Created `src/memory/session-summarizer.types.ts` (79 lines): `SummarizeFn`, `SummarizerConfig`, `SummarizeSessionDeps`, `SummarizeSessionInput`, `SummarizeSessionResult` discriminated union with skip reasons (`already-summarized`, `insufficient-turns`, `session-not-found`, `session-not-terminal`).
- Created `src/memory/session-summarizer.ts` (317 lines): 14-step pipeline implementing SESS-01 + SESS-04, plus pure helpers (`buildSessionSummarizationPrompt` with proportional per-turn truncation, `buildRawTurnFallback` for deterministic raw markdown dump).
- Created `src/memory/__tests__/session-summarizer.test.ts` (514 lines): 19 tests across 4 groups (happy path, skip conditions, timeout/error fallback, pure helpers).
- All 334 memory-module tests pass (315 previous + 19 new) — zero regressions.
- Zero new dependencies (pino already in stack, AbortController native in Node 22).
- Critical invariants verified:
  - `session.status === "summarized"` idempotency guard fires BEFORE any work
  - `turns.length < minTurns` uses actual row count, NOT eventually-consistent `session.turnCount` (Pitfall 2)
  - MemoryEntry roundtrips with `source="conversation"`, tags `["session-summary", "session:{id}"]`, `sourceTurnIds` = ordered turn IDs, importance 0.78 default
  - AbortController wraps injected `summarize` with 10s default timeout; Promise.race ensures hung implementations still abort
  - Fallback path produces deterministic markdown AND still transitions session to summarized (tagged `raw-fallback`)
  - All returned values `Object.freeze()`d per CLAUDE.md immutability rule

## Task Commits

Each task was committed atomically:

1. **Task 1: SessionSummarizer types and pure helpers** — `448ad00` (feat)
2. **Task 2: summarizeSession pipeline implementation + full unit tests** — `51a8569` (feat)

Task 1 landed the type surface + pure helpers + a throw-stub so downstream code could import the symbols without executing the unimplemented body. Task 2 replaced the stub with the full 14-step pipeline and the 19-test suite that locks in every branch.

## Files Created/Modified

- `src/memory/session-summarizer.types.ts` — 5 exported types including discriminated result union (79 lines)
- `src/memory/session-summarizer.ts` — 3 exported helpers + constants + full pipeline (317 lines)
- `src/memory/__tests__/session-summarizer.test.ts` — 19 tests across 4 describe groups (514 lines)

## Decisions Made

- **Fallback path STILL marks session summarized** (idempotency wins over perfect summary). A raw-turn dump tagged `raw-fallback` is better than retrying forever. Operators can find these via `memoryStore.findByTag("raw-fallback")` and re-summarize later if desired.
- **Summarizer NEVER throws to caller** (returns discriminated `SummarizeSessionResult` union). SessionManager in Plan 03 must not crash because the LLM had a bad day. Failures are logged via `deps.log.warn` with structured context (`{agent, session, error}`).
- **`turns.length` guard** uses `getTurnsForSession` row count — Pitfall 2 from `66-RESEARCH.md`: Phase 65's fire-and-forget `recordTurn` writes mean `session.turnCount` is eventually-consistent. The pipeline pulls the authoritative row count.
- **`markSummarized` failure is non-fatal post-insert**: if the memory landed, the summary exists and is searchable. An orphaned FK is recoverable; losing the summary content is not.
- **Empty LLM response triggers fallback** (not retry). Prevents a silent hang in production where Haiku returns `""` due to context issues. Operators see the `raw-fallback` tag and know to investigate.
- **`skipDedup: true` on insert**: session summaries are unique by definition — allowing dedup to merge them would collapse distinct session histories into one entry.
- **Empty-turns prompt still emits instruction block**: `buildSessionSummarizationPrompt([])` returns a valid prompt — the instruction block is always present so callers cannot produce a malformed request.

## Deviations from Plan

None — plan executed exactly as written. The plan's acceptance-criteria grep patterns all passed verbatim. One minor detail: the plan's test fixture example used an older `ConversationTurn` shape without `instructionFlags` (added after the plan was written in Phase 65). I used a `makeTurn` helper in tests to construct fixtures with the full current shape, which is a test-only accommodation (not a contract change).

## Issues Encountered

**Pre-existing TypeScript errors in unrelated files** (same as 66-01): full `npx tsc --noEmit` surfaces ~25 pre-existing errors across `src/cli/`, `src/manager/`, `src/tasks/`, `src/triggers/`, `src/usage/`. None are in `src/memory/` — the new session-summarizer files compile cleanly. Already logged in `.planning/phases/66-session-boundary-summarization/deferred-items.md` by Plan 01; no new additions.

## Verification Evidence

- `npx vitest run src/memory/__tests__/session-summarizer.test.ts --reporter=verbose` → **19/19 passed** (4 happy-path, 6 skip-condition, 4 timeout/error-fallback, 5 pure-helper)
- `npx vitest run src/memory/` → **334/334 passed** (zero regressions across the full memory module — 315 pre-existing + 19 new)
- TypeScript scoped to new files (`session-summarizer.ts`, `session-summarizer.types.ts`, `__tests__/session-summarizer.test.ts`): **0 errors**
- All 21 plan acceptance-criteria grep checks: **PASS**
- File size checks: `session-summarizer.ts` 317 lines (< 350 limit), `session-summarizer.types.ts` 79 lines, `session-summarizer.test.ts` 514 lines (above the plan's suggested 500, but the `min_lines: 200` floor is exceeded — 19 tests warrant the extra coverage)

## User Setup Required

None — no external service configuration required. The module is pure and dep-injected; production wiring happens in Plan 03.

## Next Phase Readiness

- **Ready for Plan 03 (SessionManager integration):** The contract is stable. Plan 03 provides:
  1. A production `summarize: SummarizeFn` wired to `sdk.query()` with Haiku (the pipeline does not care about the implementation — it only needs the signature `(prompt, {signal}) => Promise<string>`).
  2. A call-site in `SessionManager` that invokes `summarizeSession({agentName, sessionId}, deps)` on session end/crash with the production deps bundle.
- **Ready for Plan 04 / Phase 67 (auto-inject on resume):** Session summaries land as standard MemoryEntries with predictable tags, so downstream retrieval can filter via `memoryStore.findByTag("session-summary")` or search by tag pattern `session:{id}`.
- **No blockers** for downstream plans. The deferred `deferred-items.md` carry-over (pre-existing TS errors in unrelated modules) remains out-of-scope for Phase 66.

## Self-Check: PASSED

- FOUND: src/memory/session-summarizer.types.ts
- FOUND: src/memory/session-summarizer.ts
- FOUND: src/memory/__tests__/session-summarizer.test.ts
- FOUND: commit 448ad00 (Task 1)
- FOUND: commit 51a8569 (Task 2)

---
*Phase: 66-session-boundary-summarization*
*Plan: 02*
*Completed: 2026-04-18*
