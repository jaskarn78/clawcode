# Phase 120 — Deferred Items

## DEFERRED-120-A: `addToolExecutionMs` callsite-gating regression

**Discovered:** 2026-05-14 during DASH-04 column-name reconciliation.

**Symptom:** On production (`Admin Clawdy/traces.db`), 139 of 232
post-2026-05-01 traces with `tool_call.*` spans have NULL
`tool_execution_ms` / `tool_roundtrip_ms` / `parallel_tool_call_count`.
93 traces populate the columns correctly. Latest NULL trace is
post-deploy (2026-05-14T12:48); latest non-NULL is pre-deploy
(2026-05-14T03:56) of v2.9 build `4e96c24`.

**Why deferred:** This is NOT the silent-path-bifurcation pattern that
Plan 120-03's static-grep sentinel (`ba33aa9`) pins. The canonical producer
(`persistent-session-handle.ts:iterateUntilResult`) IS on the production
path. Yet some turns with tool spans skip the `Turn.addToolExecutionMs` /
`addToolRoundtripMs` / `recordParallelToolCallCount` calls. Investigation
needs: every callsite of `addToolExecutionMs` checked; turn-record vs
span-record gating logic in `iterateUntilResult` audited; per-batch
roundtrip-timer (`batchOpenedAtMs`) opening/closing audited; possible
v2.9-deploy regression (`4e96c24`).

This is Rule 4 architectural (new producer-side fix-up), out of Phase 120
"dashboard observability cleanup" scope.

**Acceptance criteria for follow-up phase:**
1. Diagnostic SQL identifies the gating condition that splits the 139 NULL
   traces from the 93 populated ones.
2. Fix targets the root-cause gate, not a fallback writer (would create a
   new silent-path-bifurcation).
3. Re-run diagnostic post-deploy: ≥95% of post-fix traces with tool spans
   populate all three columns.

**Reference data captured in `120-DIAGNOSTIC.md` §"DASH-04 disambiguation"
— real but DIFFERENT regression".**
