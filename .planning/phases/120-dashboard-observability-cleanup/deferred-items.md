# Phase 120 — Deferred Items

## DEFERRED-120-A: `addToolExecutionMs` callsite-gating regression — CLOSED NON-REPRODUCIBLE (2026-05-14)

**Original framing (2026-05-14 morning):** On production
(`Admin Clawdy/traces.db`), 139 of 232 post-2026-05-01 traces with
`tool_call.*` spans had NULL `tool_execution_ms` / `tool_roundtrip_ms` /
`parallel_tool_call_count`. 93 populated correctly. Hypothesized as a
producer-side gating regression — Rule 4 architectural, deferred.

**Disposition (2026-05-14 afternoon — Plan 120-05):** **NON-REPRODUCIBLE.**
The producer-port commit `a0f30a6` (deployed mid-day 2026-05-11) already
fixes the producer wiring. Fleet-wide daily-breakdown analysis shows a
sharp 0% → 100% transition across every active agent between
2026-05-11 (partial deploy day) and 2026-05-12 (first full post-deploy
day). The 136 NULL traces in the original diagnostic are legacy
pre-deploy data, not a live regression.

The "latest NULL trace post-deploy" cited as `2026-05-14T12:48` is a
bootstrap turn with ONLY a `context_assemble` span — zero `tool_call.*`
spans — which legitimately NULLs `tool_execution_ms` per the
`parallelToolCallCount > 0` conditional-spread gate on `Turn.end()`.

**Why the original diagnostic was misled:**

1. Conflated "any NULL trace" with "NULL trace that has tool spans."
   Without the `EXISTS` subquery on `trace_spans`, bootstrap turns and
   text-only turns appear identical to the bug signal.
2. Captured a sample at a moment when the agent's most-recent trace was
   incidentally a bootstrap turn, which produced a misleading
   "latest = post-deploy" framing.
3. Did not segment by day; the daily-breakdown view makes the deploy
   transition unmistakable.

**Defense-in-depth shipped:**
`src/manager/__tests__/tool-span-paired-emit-sentinel.test.ts` (commit
`7672799`) pins the structural coupling: span creation and
`recordParallelToolCallCount` must remain inside the same
`parentToolUseId === null` block, with counter-emit before span-emit, in
both producer files. A future refactor that splits the two emits fails
at test time.

**Reference:**
`.planning/phases/120-dashboard-observability-cleanup/120-05-SUMMARY.md`
— full fleet daily-breakdown table + discriminator query.
