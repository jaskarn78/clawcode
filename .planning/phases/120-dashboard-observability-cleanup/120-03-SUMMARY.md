---
phase: 120-dashboard-observability-cleanup
plan: 03
subsystem: telemetry
tags: [observability, regression-sentinel, silent-path-bifurcation, dash-04]
requirements: [DASH-04]
completed: 2026-05-14
status: complete-with-rule4-deferral
key-files:
  created:
    - src/manager/__tests__/static-grep-iterateWithTracing.test.ts
  modified: []
---

# Phase 120 Plan 03: DASH-04 producer pin + static-grep regression — Summary

Silent-path-bifurcation sentinel pinned for the test-only `iterateWithTracing`
producer; T-03 live-data smoke deferred to parent agent reconciliation (column-name
mismatch between diagnostic and schema).

## T-01 — NO DRIFT

Production call chain confirmed intact:
`daemon.ts:2489 → new SdkSessionAdapter() → .createSession()/.resumeSession()
(session-adapter.ts:1114/1209) → createPersistentSessionHandle →
iterateUntilResult (persistent-session-handle.ts:389)`.

`iterateWithTracing` is invoked from exactly three call sites — all inside
`wrapSdkQuery` (session-adapter.ts:2038/2053/2081), itself `@deprecated` and
reachable only via `createTracedSessionHandle` (line 2288), whose only callers
live in `src/manager/__tests__/` and `src/performance/__tests__/`. No code
change required.

## T-02 — Sentinel test shipped — commit `ba33aa9`

`src/manager/__tests__/static-grep-iterateWithTracing.test.ts` (85 lines, 2 tests):
- **Test 1** greps `src/` with `--exclude-dir='__tests__' --exclude='session-adapter.ts'`
  for the literal `iterateWithTracing(` (call paren; no whitespace) — asserts zero
  offenders. Strict literal avoids matching doc-comment punctuation like
  `(the test-only path)`.
- **Test 2** positive control — asserts the fixture file `session-adapter.ts`
  still contains the pattern; catches grep / path-resolution silently breaking.

Self-test documented in commit: added `// PROBE: iterateWithTracing(probe)`
to `persistent-session-handle.ts` → Test 1 RED with offender listed → removed →
GREEN. Complementary to existing `producer-call-sites-sentinel.test.ts`
(positive: asserts `iterateUntilResult` CONTAINS the producer methods).

Test run output (last 5 lines):
```
 Test Files  2 passed (2)
      Tests  10 passed (10)
   Start at  12:40:30
   Duration  245ms
```

## T-03 — DEFERRED (Rule 4: architectural reconciliation needed)

The plan asks for a smoke test querying `prep_latency_ms` / `tool_latency_ms` /
`model_latency_ms`. **These column names do not exist anywhere in `src/`** —
`grep -rn 'prep_latency\|tool_latency_ms\|model_latency' src/` returns zero.
The actual schema (`src/performance/trace-store.ts:846`) defines
`tool_execution_ms`, `tool_roundtrip_ms`, `parallel_tool_call_count` on the
`traces` table — populated by the `Turn.addToolExecutionMs` /
`addToolRoundtripMs` / `recordParallelToolCallCount` calls that the existing
`producer-call-sites-sentinel.test.ts` already pins.

Two possible interpretations the parent agent must reconcile:
1. **Diagnostic column names are wrong** — DASH-04 is actually about whether
   `tool_execution_ms` etc. are populating. In which case T-03 should query
   `SELECT tool_execution_ms FROM traces ORDER BY rowid DESC LIMIT 1`.
2. **Plan wants new split-latency columns added** — this is architectural
   (Rule 4), not a regression pin. Out of scope.

The 120-DIAGNOSTIC.md observation ("every `end_to_end` metadata_json is `{}`")
is consistent with `iterateUntilResult:394` opening the `end_to_end` span with
empty `{}` and never calling `setMetadata` on it — but no production code
writes the three named latency keys into that span either.

## Deviations

- **T-01:** no code change (no DRIFT). Plan anticipated this as the more
  likely outcome — documented production call chain at the top of T-02's
  test file instead, per plan instructions.
- **T-02 grep pattern:** plan's `-E 'iterateWithTracing[[:space:]]*\\('`
  matched comment punctuation `(the test-only path)`. Switched to `-F`
  fixed-literal `iterateWithTracing(` to match invocations only. Doc-comment
  refs to the token name pose no bifurcation risk.
- **T-03:** Rule 4 deferral per advisor consultation — column-name mismatch
  between diagnostic framing and actual schema. Smoke test deferred until
  parent agent confirms which interpretation applies.

## Open items

- Production verification of split-latency telemetry on clawdy — deferred to
  Plan 04 (and post-deploy window per D-09 deploy hold; Ramy active).
- Parent agent to reconcile DASH-04 column-name interpretation (interpretation
  1 vs 2 above). If interpretation 1, a follow-up plan should query
  `tool_execution_ms` / `tool_roundtrip_ms` / `parallel_tool_call_count`.

## Self-Check: PASSED

- File `src/manager/__tests__/static-grep-iterateWithTracing.test.ts` exists.
- Commit `ba33aa9` present in `git log`.
- `npx vitest run` on both sentinel files: 10/10 passed.
- No `tsc --noEmit` regressions introduced (pre-existing
  `compact-session-integration.test.ts(121,9)` error confirmed via
  `git stash` baseline).
