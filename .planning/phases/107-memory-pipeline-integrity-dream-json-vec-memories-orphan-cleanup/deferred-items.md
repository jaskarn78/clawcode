# Phase 107 — Deferred Items

Issues discovered during execution that are OUT OF SCOPE for the current plan.

## src/manager/__tests__/dream-prompt-builder.test.ts — pre-existing failures

Discovered during 107-01 Task 2 (dream-prompt-builder.ts edit).

1. **P1 test references stale "Output JSON ONLY" string** (line 67). The
   current `buildSystemPrompt` (dream-prompt-builder.ts:97-118) uses
   "CRITICAL OUTPUT RULES:\n1. Your response MUST be valid JSON…" instead.
   The test was authored against an older prompt text. NOT introduced by
   Phase 107 — fails on master before my edit.

2. **P3 test times out (~50s)** with 1000 chunks of 400 chars each.
   Truncation loop in `buildDreamPrompt` is O(n²) (re-renders prompt on
   every chunk drop). Test was probably authored when truncation hit a
   different code path. NOT in scope for Phase 107.

Both should be addressed in a future Phase 95 follow-up (test refresh +
truncation algorithm O(n) rewrite via cumulative-length precompute).
