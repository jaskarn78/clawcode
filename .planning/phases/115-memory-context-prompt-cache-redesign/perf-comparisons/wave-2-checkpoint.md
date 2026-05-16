# Phase 115 — Wave-2 Checkpoint (2026-05-08)

**Authored:** 2026-05-08
**Plans landed (in scope of this checkpoint):** 115-00 through 115-08 (T01 + T02 ship in this same plan).
**Compared against:** [`baseline-pre-115.md`](./baseline-pre-115.md)
**Source for per-agent numbers:** `clawcode tool-latency-audit --json` (post-deploy) and the per-agent traces.db rows wired by Plans 115-00 / 115-04 / 115-05 / 115-07 / 115-08.

> **Status: skeleton with gate-decision logic locked. Numbers populate post-deploy.**
> The acceptance criterion for Plan 115-08 T03 is the existence + structure of this report — including the SHIP/DEFER token presence — not real production numbers. Per `feedback_no_auto_deploy` and `feedback_ramy_active_no_deploy` in CLAUDE.md, this checkpoint does NOT trigger a deploy. Plan 115-09 reads this file to decide sub-scope 6-B's branch; it will fill in the real fleet numbers after the next legitimate operator-confirmed deploy + Ramy-quiet window.

---

## Headline metrics

| Metric                          | Pre-115 baseline                  | Wave-2 (post-08) | Δ        | Target              | Status     |
| ------------------------------- | ----------------------------------: | ---------------: | -------: | ------------------: | :--------- |
| first_token_p50_ms              | 5,200                              | (post-deploy)    | (Δ)      | ≤ 2,000             | pending    |
| end_to_end_p95_ms               | 288,713                            | (post-deploy)    | (Δ)      | ≤ 30,000            | pending    |
| mysql_query_p50_ms              | 120,659                            | (post-deploy)    | (Δ)      | ≤ 5,000             | pending    |
| stable_prefix_tokens_p95        | 32,989 chars (the incident wedge)  | (post-deploy)    | (Δ)      | ≤ 8,000 hard cap    | pending    |
| prompt_cache_hit_rate (idle)    | <30% (bimodal w/ Ramy 92.8%)       | (post-deploy)    | (Δ)      | ≥ 70%               | pending    |
| tool_cache_hit_rate             | n/a (no cache existed)             | (post-deploy)    | (Δ)      | ≥ 40%               | pending    |

Plans 115-00 (baseline) through 115-07 (tool cache) each ship with their own
acceptance test for the column they wire. The headline movement on
`first_token_p50` / `end_to_end_p95` / `stable_prefix_tokens_p95` is what the
Wave-2 close measures. Plans 115-04 / 115-05 / 115-07 each contributed a piece;
this is the first checkpoint where they're measured together.

---

## Tool-use rate — the sub-scope 6-B gate

This is the gate value plan 115-09 reads to decide whether sub-scope 6-B
(1h-TTL direct-SDK fast-path) ships or defers. Threshold per CONTEXT D-12:
**fleet non-fin-acq avg < 30% → SHIP; ≥ 30% → DEFER**.

| agent                      | turns | turnsWithTools | tool_use_rate | sub-scope 6-B gate                  |
| :------------------------- | ----: | -------------: | ------------: | :---------------------------------- |
| (per-agent table from CLI) |       |                |               |                                     |
| admin-clawdy               |       |                |               | (computed)                          |
| fin-acquisition            |       |                |               | fin-acq-excluded-from-gate (D-12)   |
| ...                        |       |                |               |                                     |

**Fleet non-fin-acq average tool_use_rate:** `(post-deploy)`
**Threshold:** 30% (D-12 starting threshold; knob, not constant)
**Decision for plan 115-09 sub-scope 6-B:** `SHIP` if rate < 30%, else `DEFER`.

How this populates: after Plan 115-08 deploys + a 24h soak window, run

```bash
clawcode tool-latency-audit --window-hours 24 --json > /tmp/wave-2-gate.json
```

then update this table with the per-agent rows + fleet non-fin-acq average +
final `decision` value. Plan 115-09's T01 reads this file's table to decide
its own sub-scope 6-B branch; if fleet avg lands at ≤25%, definitely SHIP; if
≥35%, definitely DEFER; in between (25-35%), plan 115-09 may refine the
threshold based on the observed distribution.

---

## Tool-latency methodology (sub-scope 17a/b)

Plan 115-08 T01's audit established that the existing `tool_call.<name>`
span at `session-adapter.ts:1419-1514` measures **execution-side** time
(`tool_use_emitted → tool_result_arrived`), NOT the full LLM-resume
roundtrip. The 77s p50 `Read` / 86s p50 `Bash` numbers on the dashboard
are dominated by SDK dispatch + tool runtime + result delivery; the
roundtrip-style 60-700s wall-clock that operators perceive is the LLM
resume after the tool result, which T01 now records as
`tool_roundtrip_ms` (per-batch wall-clock from `tool_use` emit to next
parent assistant message).

Difference (`tool_roundtrip_ms - tool_execution_ms`) = prompt-bloat tax /
LLM resume cost. After Wave 2 (cap enforcement + lazy recall + cache
breakpoint repositioning), the gap should narrow on agents whose stable
prefix shrinks toward the 8K hard cap.

| agent                      | tool_execution_ms p50 | tool_roundtrip_ms p50 | difference (ms) | parallel_tool_call_rate |
| :------------------------- | --------------------: | --------------------: | --------------: | ----------------------: |
| (post-deploy populated)    |                       |                       |                 |                         |

The directive landed in Plan 115-08 T02 (`PARALLEL-TOOL-01`) is intended
to shift `parallel_tool_call_rate` upward over the next two weeks of
fleet operation. The directive only fires on mutually-orthogonal lookups
so it cannot regress dependent-call sequences.

---

## Notes

- **Plan 115-09 sub-scope 6-B implementation gates on this report.** The
  closeout plan reads the Tool-use rate table (or the underlying snapshot
  table via `clawcode tool-latency-audit --json`) to decide 6-B's branch.
- **Migration (115-06) is mid-flight at this checkpoint** — vector
  retrieval still uses v1 (MiniLM). Cutover is Wave 4 (plan 115-09 area).
- **No deploy was triggered to populate this report.** Per CLAUDE.md
  + `feedback_no_auto_deploy` + `feedback_ramy_active_no_deploy` memories,
  deploys require explicit operator confirmation. The report exists with
  a complete decision skeleton + SHIP/DEFER token + threshold so plan
  115-09 has a concrete artifact to read; the operator runs the
  `tool-latency-audit` CLI post-deploy and updates the tables before the
  closeout plan reads them.
- **Threshold revisitability:** The 30% number is from CONTEXT D-12 and
  is described there as a knob, not a constant. If the per-agent
  distribution shows most non-fin-acq agents in the 25-35% range with no
  clear bimodality, plan 115-09 may refine the threshold. If most
  agents cluster well below 25% (idle Discord agents) with one outlier
  approaching 50% (e.g., fin-research running heavy SQL probes), SHIP
  6-B regardless — the median-agent benefit dominates the outlier cost.
