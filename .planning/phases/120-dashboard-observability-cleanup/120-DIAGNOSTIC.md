# Phase 120 — Diagnostic SQL Results

**Initial run:** 2026-05-14 ~03:56 UTC (post-deploy of v2.9 build `4e96c24`)
**Reconciled:** 2026-05-14 (column-name framing corrected, disambiguation query added)
**Source DBs:** Per-agent `traces.db` files under `/home/clawcode/.clawcode/agents/<agent>/traces.db`

## TL;DR after reconciliation

- **DASH-01:** non-reproducible from the data. Names well-formed; SQL strips
  the `tool_call.` prefix correctly; React renders `{r.tool}`. Ship the
  defensive `(unnamed)` fallback only.
- **DASH-04:** the original framing (`prep_latency_ms` / `tool_latency_ms` /
  `model_latency_ms`) is **wrong** — those columns do not exist anywhere in
  `src/`. Real schema has `tool_execution_ms` / `tool_roundtrip_ms` /
  `parallel_tool_call_count` (Phase 115-08 columns). Disambiguation shows a
  real but **different** producer gap (see below) — deferred as architectural.
- **DASH-02 / DASH-03:** confirmed real, frontend-only fixes.

## Findings

### DASH-01 root-cause hypothesis (LENGTH(name) <= 11 guard) is FALSE

The original 999.49 hypothesis was that the SQL guard `WHERE name LIKE 'tool_call.%' AND LENGTH(name) <= 11` misfires on long-prefixed tool names. The actual data:

```
admin-clawdy traces.db (3761 rows total):
  - tool_call.* rows: 1293
  - Names with LENGTH(name) <= 11: 1500
  - Distinct names <= 11 chars: end_to_end, first_token, receive  (latency spans, NOT tool_call.*)
  - Empty/NULL name rows: 0
  - tool_call.* AND LENGTH <= 11: 0  (the guard returns ZERO rows on real data)
```

```
"Admin Clawdy" (display-name DB, 3101 rows total):
  - LENGTH(name) <= 11: 1038
  - Empty/NULL name rows: 0
  - Distinct names <= 11: end_to_end, first_token, receive  (same pattern)
```

**Followup SQL check (`perToolPercentiles` query path, `trace-store.ts:966`):**
`SUBSTR(s.name, 11)` strips first 10 chars (`tool_call.` is exactly 10 chars
including the dot). For `tool_call.Bash` this yields `Bash`. The query is
correct. The frontend renders `{r.tool}` directly (`BenchmarksView.tsx:305`).

**Verdict — DASH-01 is NON-REPRODUCIBLE.** No SQL bug, no IPC binding loss,
no emitter blank-name. The reported symptom isn't visible in production data
or in the production code path. Ship the defensive `(unnamed)` fallback
(attributable label instead of silent blank if a future regression appears)
and document non-reproduction. Don't fabricate a fix to satisfy the plan.

### DASH-04 column-name framing was WRONG

`grep -rn 'prep_latency\|tool_latency_ms\|model_latency' src/` → 0 matches.
The columns named in the original DASH-04 framing do not exist anywhere in
the codebase.

The actual `traces` table columns (Phase 115-08, `trace-store.ts:846-848`)
are:

- `tool_execution_ms` — sum of per-tool `tool_call.<name>` durations
- `tool_roundtrip_ms` — wall-clock from `tool_use` emit → next assistant msg
- `parallel_tool_call_count` — MAX parallel batch size across the turn

These are written by `Turn.addToolExecutionMs` / `addToolRoundtripMs` /
`recordParallelToolCallCount` — invoked from
`persistent-session-handle.ts:iterateUntilResult` (the canonical producer)
and gated on actual tool calls firing.

`end_to_end` span `metadata_json` is `"{}"` **by design** —
`iterateUntilResult:394` opens it with `{}` and never calls `setMetadata`.
Empty metadata on end_to_end spans is not a regression.

### DASH-04 disambiguation — real but DIFFERENT regression

Production query against `Admin Clawdy/traces.db` (post-2026-05-01):

```sql
SELECT COUNT(*) FROM traces t
WHERE t.tool_execution_ms IS NULL
  AND t.started_at > '2026-05-01'
  AND EXISTS (SELECT 1 FROM trace_spans s
              WHERE s.turn_id = t.id AND s.name LIKE 'tool_call.%');
-- 139

SELECT COUNT(*) FROM traces WHERE tool_execution_ms IS NOT NULL
  AND started_at > '2026-05-01';
-- 93

SELECT started_at, tool_execution_ms, tool_roundtrip_ms, parallel_tool_call_count
FROM traces WHERE tool_execution_ms IS NOT NULL ORDER BY started_at DESC LIMIT 3;
-- 2026-05-14T03:56:24.420Z | 189295 | 47226 | 1
-- 2026-05-14T03:54:37.659Z | 310702 |  47327 | 1
-- 2026-05-14T00:04:48.155Z | 201499 |  38079 | 1

SELECT started_at FROM traces ORDER BY started_at DESC LIMIT 1;
-- 2026-05-14T12:48:32.863Z (NULL on all three split-latency cols)
```

139 traces had `tool_call.*` spans but `tool_execution_ms` IS NULL. 93 traces
populated the column correctly. The latest NULL trace is post-deploy
(2026-05-14T12:48); latest non-NULL is pre-deploy (2026-05-14T03:56).

**This is a real producer gap — but not the silent-path-bifurcation pattern**
the original DASH-04 framing predicted. The canonical writer
(`iterateUntilResult`) is on the production path (Plan 03 T-01 confirmed),
the static-grep sentinel (Plan 03 T-02, commit `ba33aa9`) pins it. Yet some
post-deploy turns with tool spans skip the `addToolExecutionMs` call.

**Disposition — DEFERRED.** Plan 120 closes with the sentinel + frontend
fixes; the addToolExecutionMs gating regression is architectural (Rule 4 —
new producer-side fix-up requires investigation of every callsite,
potentially new code paths, and is not "dashboard observability cleanup").
Tracked under `deferred-items.md` for a follow-up phase.

**RECONCILIATION (2026-05-14 afternoon, Plan 120-05):** DEFERRED-120-A
closed as NON-REPRODUCIBLE. The "regression" framing above is wrong —
the producer-port commit `a0f30a6` (deployed mid-day 2026-05-11) already
populates 100% of post-deploy traces fleet-wide. The 139 NULL traces are
legacy pre-deploy data. The "latest NULL post-deploy at 2026-05-14T12:48"
trace is a bootstrap turn with zero `tool_call.*` spans — a legitimate
NULL per the conditional-spread gate. See `120-05-SUMMARY.md` for the
fleet-wide daily-breakdown evidence + discriminator query.

## Green-light verdicts for Phase 120 plans (reconciled)

- **Plan 120-02 (DASH-01/02/03 frontend bundle):**
  - DASH-01: ship the defensive `(unnamed)` fallback only — no SQL/IPC fix
    needed (non-repro).
  - DASH-02: ship `percentileCell` utility + static-grep sentinel.
  - DASH-03: change empty-state string to the literal
    `"No tool spans recorded in window"` per CONTEXT D-06.
- **Plan 120-03 (DASH-04 producer pin):** COMPLETE (commit `ba33aa9`,
  `83837cf`). T-03 smoke result is the disambiguation query above.
- **Plan 120-04 (DASH-05 CLI verification):** GREEN — independent.

## Verification artifact

Captured by main session 2026-05-14 03:56 UTC + reconciliation pass
2026-05-14. Probe SQL ran read-only over SSH against
`/home/clawcode/.clawcode/agents/{admin-clawdy,Admin Clawdy}/traces.db`.
No writes, no daemon restart, no side effects.
