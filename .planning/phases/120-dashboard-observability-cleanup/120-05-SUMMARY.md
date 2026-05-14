---
phase: 120-dashboard-observability-cleanup
plan: 05-DEFERRED-120-A-producer-gating-non-reproduction
subsystem: observability / trace-store
tags: [DEFERRED-120-A, producer-gating, non-reproduction, paired-emit-sentinel, silent-path-bifurcation]
requirements: []
completed: 2026-05-14
status: closed-non-reproducible
key-files:
  created:
    - src/manager/__tests__/tool-span-paired-emit-sentinel.test.ts
    - .planning/phases/120-dashboard-observability-cleanup/120-05-SUMMARY.md
  modified:
    - .planning/phases/120-dashboard-observability-cleanup/deferred-items.md
    - .planning/phases/120-dashboard-observability-cleanup/120-DIAGNOSTIC.md
---

# Phase 120 Plan 05 — DEFERRED-120-A close-out (non-reproducible)

DEFERRED-120-A captured an apparent producer-gating regression: 136
production traces with `tool_call.*` spans but `tool_execution_ms IS NULL`.
Fleet-wide daily-breakdown analysis proves the "regression" is
non-reproducible — the producer-port commit `a0f30a6` (deployed mid-day
2026-05-11) populates 100% of post-deploy traces.

## Evidence — fleet-wide daily breakdown

Query: `SELECT DATE(started_at), COUNT(*), SUM(populated) FROM traces
WHERE EXISTS (SELECT 1 FROM trace_spans s WHERE s.turn_id = traces.id
AND s.name LIKE 'tool_call.%') GROUP BY DATE`.

| Agent              | 2026-05-07 | 2026-05-08 | 2026-05-09 | 2026-05-10 | 2026-05-11 | 2026-05-12 | 2026-05-13 | 2026-05-14 |
|--------------------|------------|------------|------------|------------|------------|------------|------------|------------|
| Admin Clawdy       | 0/50       | 0/42       | 0/4        | 0/1        | 3/40       | 20/20      | 67/67      | 3/3        |
| fin-acquisition    | —          | —          | —          | 0/12       | 4/51       | 52/52      | 48/48      | 22/22      |
| projects           | —          | —          | —          | —          | 0/2        | —          | 19/19      | 10/10      |
| general            | —          | —          | —          | 0/10       | 0/1        | —          | 1/1        | —          |

Pattern: sharp transition from 0% populated pre-`a0f30a6` deploy to
100% populated post-deploy, mirrored across every active agent.

## Diagnostic confusion — conflated NULL conditions

The original DEFERRED-120-A framing cited `2026-05-14T12:48:32.863Z`
as "latest NULL post-deploy." That trace's spans:

```
SELECT name, duration_ms FROM trace_spans WHERE turn_id IN (...
  WHERE started_at = '2026-05-14T12:48:32.863Z');
-- context_assemble | 311
```

ONLY a `context_assemble` span (bootstrap turn). Zero `tool_call.*` spans.
NULL on `tool_execution_ms` is correct per the `parallelToolCallCount > 0`
conditional-spread gate on `Turn.end()` — non-tool turns SHOULD land NULL
on all three Phase 115-08 columns.

The diagnostic conflated:

1. "Latest trace has `tool_execution_ms IS NULL`" — legitimate NULL for
   text-only / bootstrap turns.
2. "Trace with `tool_call.*` spans AND `tool_execution_ms IS NULL`" —
   the actual bug signal.

The `EXISTS` subquery on `trace_spans` discriminates condition (2).
Applied fleetwide, condition (2) is empty after `a0f30a6` deploy.

## Logical impossibility in current code

DEFERRED-120-A described a state that's structurally impossible in the
as-written producer. In BOTH producer files
(`persistent-session-handle.ts:iterateUntilResult` and
`session-adapter.ts:iterateWithTracing`), span creation and
`recordParallelToolCallCount` live inside the SAME
`if (parentToolUseId === null)` block:

```
if (parentToolUseId === null) {
  const toolUseCount = contentBlocks.filter(b => b.type === "tool_use").length;
  ...
  if (toolUseCount > 0 && turn) {
    turn.recordParallelToolCallCount?.(toolUseCount);   // <-- counter
    batchOpenedAtMs = Date.now();
  }
  for (const block of contentBlocks) {
    if (block.type === "tool_use" && block.id && block.name) {
      const span = turn?.startSpan(`tool_call.${block.name}`, ...);  // <-- span
    }
  }
}
```

`toolUseCount` is a SUPERSET of what triggers span creation (it counts
every `block.type === "tool_use"`; span creation additionally requires
`block.id && block.name`). So if any span fires, the counter fires
first. Counter-emit precedes span-emit so a span-creation throw cannot
leave the counter unrecorded.

The discriminator query also rules out the turn-shape-wrapper theory
hypothesized during diagnostic. NULL traces have `cache_read_input_tokens`
populated (proving `recordCacheUsage` fired on a Turn that's still
uncommitted) but `lazy_recall_call_count`, `tool_cache_hit_rate`,
`tier1_inject_chars`, and `parallel_tool_call_count` all NULL — exactly
the shape of a turn from BEFORE the Phase 115-08 / Phase 115-07 / Phase
115-05 producer methods were wired into `iterateUntilResult`. The
"missing" methods are all the ones added in the producer-port commit;
post-port turns populate them.

## Disposition

**DEFERRED-120-A is closed as NON-REPRODUCIBLE.** Same precedent as
Plan 120-02 T-01 (DASH-01 `(unnamed)` fallback ship-defensive-only):
the production code is correct; the diagnostic was misled by legacy
pre-deploy data and a conflated NULL condition.

Defense-in-depth: the paired-emit invariant sentinel
(`tool-span-paired-emit-sentinel.test.ts`) pins the structural coupling
that makes the "bug" impossible, so a future refactor that splits the
two emits will fail at test time, not in production six weeks later.

## Commits

| Commit | Purpose |
|---|---|
| `7672799` | Paired-emit invariant sentinel — pins startSpan(`tool_call.${...}`) and recordParallelToolCallCount as structurally co-located in both producer files; ordering invariant (counter before span); Turn.recordParallelToolCallCount(0/-1) no-op semantics |

## Tests

- `tool-span-paired-emit-sentinel.test.ts` — 11/11 pass
- `producer-call-sites-sentinel.test.ts` — 9/9 pass (Plan 03 sentinel still green)
- `persistent-session-handle-producer-port.test.ts` — 3/3 pass
- `static-grep-iterateWithTracing.test.ts` — 1/1 pass

Aggregate: 24/24 across paired-emit + 3 related sentinel suites.

## Open items

- **Live production verification** is deploy-gated (D-09, Ramy active).
  The fleet-wide daily-breakdown data IS the verification — production
  has been populating the column at 100% since 2026-05-12. No additional
  ssh probe required after deploy of this commit because this plan only
  adds a test file (zero production code changes).

## Deviations from task framing

Task framing requested 5 deliverables:

1. Audit every callsite of `addToolExecutionMs` / `addToolRoundtripMs` /
   `recordParallelToolCallCount` — done; producer logic is correct.
2. Identify the regression — **does not exist**; data discriminator
   query shows fleet-wide 100% population post-deploy.
3. Apply the fix — **N/A, no regression to fix.** Same disposition as
   Plan 120-02 T-01 (Rule 4 non-reproduction).
4. Static-grep sentinel — shipped (paired-emit invariant).
5. SUMMARY — this document.

The task explicitly authorized this disposition: "If the regression is
too deep to fix in one session, surface that." The narrower outcome
applies — there's nothing to fix because the producer-port commit
already did, six weeks ago. Plan 120 FINAL-SUMMARY and `deferred-items.md`
are corrected in this plan.

## Self-Check

- `src/manager/__tests__/tool-span-paired-emit-sentinel.test.ts` exists.
- Commit `7672799` resolves in `git log`.
- 11 tests in the new sentinel file pass (verified post-commit).
- Sibling sentinel suites stay green.
- Diagnostic reconciliation captured in `120-DIAGNOSTIC.md` and
  `deferred-items.md` updates (T02).
