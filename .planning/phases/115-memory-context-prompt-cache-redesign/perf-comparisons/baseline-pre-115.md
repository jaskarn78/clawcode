# Phase 115 — Pre-Implementation Baseline (2026-05-08)

**Locked:** 2026-05-08
**Source:** `~/.clawcode/bench/115/pre-115-baseline-2026-05-08/` (pending operator quiet-window run — see Notes)
**Method:** `scripts/bench/115-perf.ts` (Plan 115-00 artifact)
**Sample size (intended):** 10 runs per agent × scenario, except cold-start (3 runs) and fin-acquisition cold-start (skipped — Ramy active gate).

## Headline anchor (2026-05-07 fin-acquisition incident)

These numbers are the **ground truth** Phase 115 must beat. They are NOT
re-measured by this bench — they are locked from the 2026-05-07
fin-acquisition incident response (3-hour outage, Ramy mid-thread
blocked, 32,989-char `systemPrompt.append` triggered Anthropic 400
`invalid_request_error` masquerading as a billing-cap message).

- first_token p50: **5,200 ms**
- end_to_end p95: **288,713 ms**
- mysql_query p50: **120,659 ms**
- stable_prefix size: **32,989 chars** (the wedge — became the immediate
  trigger of the 400; even after the wedge was cleared, the underlying
  unbounded-injection model means it WILL happen again without Phase 115)
- prompt_cache_hit_rate (Ramy-paced fin-acq, <5 min cadence active session): **92.8%**
- prompt_cache_hit_rate (idle agents, >30 min cadence): **<30%** (bimodal —
  CLI's 5m TTL drops cache between idle-mode turns; this is the inverse
  failure mode, the cache is invisible to most of the fleet most of the time)

## Phase 115 perf targets

| Metric                          | Pre-115 baseline                | 115 target                                                                |
| ------------------------------- | ------------------------------: | ------------------------------------------------------------------------: |
| first_token_p50_ms              | 5,200                           | ≤ 2,000                                                                   |
| end_to_end_p95_ms               | 288,713                         | ≤ 30,000                                                                  |
| mysql_query_p50_ms              | 120,659                         | ≤ 5,000                                                                   |
| stable_prefix_tokens_p95        | (see per-agent table)           | ≤ 8,000 (hard cap), ≤ 10,000 fleet p95 (target), ≤ 12,000 fin-acq session start |
| prompt_cache_hit_rate           | 92.8% Ramy / <30% idle (bimodal)| ≥ 70% across <5 min cadence agents                                        |
| tool_cache_hit_rate             | n/a (no cache exists)           | ≥ 40% on repetitive-read agents                                           |

The hard cap (8K tokens) is the **enforced** number — assembly truncates
at this value (D-02). The 10K fleet p95 / 12K fin-acq session start are
**delivery** targets — what the cap should produce in normal load. Cap
is stricter than targets so we have safety margin.

## Per-agent baseline (measured)

This table is the live-fleet measurement output. **Status: PENDING.**

The bench harness (`scripts/bench/115-perf.ts`, Plan 115-00 T01) is
shipped and operational. The actual fleet run (T03 of Plan 115-00) is
gated on:

1. **Ramy gate (CLAUDE.md):** fin-acquisition cold-start is hardcoded to
   skip without `--allow-fin-acq-cold-start`. This is enforced at the
   bench CLI level — `scripts/bench/115-perf.ts:155-179`.
2. **Operator quiet-window confirmation:** `discord-ack` /
   `tool-heavy` / `memory-recall` / `extended-thinking` scenarios send
   real Discord-shaped messages into the agents' channels via the
   daemon's `send-message` IPC. Even though the bench numbers are
   read-only from `traces.db`, the *invocation path* lights up live
   Discord channels — so it can't run while operators are mid-thread
   with any of the 11 agents.

When the operator opens a quiet window, run:

```bash
LABEL=pre-115-baseline-2026-05-08
for agent in admin-clawdy fin-acquisition fin-research finmentum-content-creator personal projects research test-agent fin-playground fin-tax general; do
  for scenario in discord-ack tool-heavy memory-recall extended-thinking; do
    npx tsx scripts/bench/115-perf.ts --agent "$agent" --scenario "$scenario" --runs 10 --label "$LABEL"
  done
done
# cold-start: 3 runs each, skipping fin-acquisition
for agent in admin-clawdy fin-research finmentum-content-creator personal projects research test-agent fin-playground fin-tax general; do
  npx tsx scripts/bench/115-perf.ts --agent "$agent" --scenario cold-start --runs 3 --label "$LABEL"
done
# fin-acquisition cold-start: SKIPPED (Ramy active gate)
```

After all runs land, fill the table below from
`~/.clawcode/bench/115/pre-115-baseline-2026-05-08/summary.jsonl` (one
JSON line per agent×scenario×span aggregate row).

| Agent                         | discord-ack p50 (ms) | tool-heavy p95 (ms) | memory-recall p50 (ms) | extended-thinking p95 (ms) | stable_prefix_tokens |
| ----------------------------- | -------------------: | ------------------: | ---------------------: | -------------------------: | -------------------: |
| admin-clawdy                  | _PENDING_            | _PENDING_           | _PENDING_              | _PENDING_                  | _PENDING_            |
| fin-acquisition               | _PENDING_            | _PENDING_           | _PENDING_              | _PENDING_                  | 32,989 (anchor)      |
| fin-research                  | _PENDING_            | _PENDING_           | _PENDING_              | _PENDING_                  | _PENDING_            |
| finmentum-content-creator     | _PENDING_            | _PENDING_           | _PENDING_              | _PENDING_                  | _PENDING_            |
| personal                      | _PENDING_            | _PENDING_           | _PENDING_              | _PENDING_                  | _PENDING_            |
| projects                      | _PENDING_            | _PENDING_           | _PENDING_              | _PENDING_                  | _PENDING_            |
| research                      | _PENDING_            | _PENDING_           | _PENDING_              | _PENDING_                  | _PENDING_            |
| test-agent                    | _PENDING_            | _PENDING_           | _PENDING_              | _PENDING_                  | _PENDING_            |
| fin-playground                | _PENDING_            | _PENDING_           | _PENDING_              | _PENDING_                  | _PENDING_            |
| fin-tax                       | _PENDING_            | _PENDING_           | _PENDING_              | _PENDING_                  | _PENDING_            |
| general                       | _PENDING_            | _PENDING_           | _PENDING_              | _PENDING_                  | _PENDING_            |

Eleven production agents listed — matches the agent list in
`clawcode.example.yaml` (Plan 115-CONTEXT D-12 fleet topology).

## Cache hit rate analysis

SQL run against each agent's `traces.db` over the 24h window ending
2026-05-08T00:00:00Z. Schema is the Phase 52 cache-telemetry shape
documented at `src/performance/trace-store.ts:630-668` (the
`cacheTelemetryRows` + `cacheTelemetryAggregates` prepared statements):

```sql
-- Run per-agent against ~/.clawcode/agents/<agent>/traces.db
SELECT
  agent                                                                AS agent_name,
  AVG(cache_read_input_tokens)                                         AS avg_read,
  AVG(cache_creation_input_tokens)                                     AS avg_create,
  AVG(input_tokens)                                                    AS avg_fresh,
  COUNT(*)                                                             AS turns,
  SUM(CASE WHEN cache_read_input_tokens > 0 THEN 1 ELSE 0 END) * 1.0
    / COUNT(*)                                                         AS hit_rate
FROM traces
WHERE started_at > datetime('now', '-1 day')
  AND input_tokens IS NOT NULL
  AND input_tokens > 0
GROUP BY agent;
```

Phase 52 D-01 hit-rate formula (per-turn ratio):

```
hit_rate = cache_read / (cache_read + cache_creation + input)
```

| agent                         | hit_rate (24h)   |
| ----------------------------- | ---------------: |
| admin-clawdy                  | _PENDING_        |
| fin-acquisition               | 0.928 (Ramy active windows) / <0.30 (idle) |
| fin-research                  | _PENDING_        |
| finmentum-content-creator     | _PENDING_        |
| personal                      | _PENDING_        |
| projects                      | _PENDING_        |
| research                      | _PENDING_        |
| test-agent                    | _PENDING_        |
| fin-playground                | _PENDING_        |
| fin-tax                       | _PENDING_        |
| general                       | _PENDING_        |

The fin-acquisition entry is bimodal — 92.8% during Ramy-paced active
sessions (<5 min cadence between turns, before the CLI's 5m TTL evicts),
and below 30% in idle windows. This bimodality is the structural
problem Phase 115 sub-scope 5 (cache-breakpoint placement) +
sub-scope 6 (1h-TTL fast-path, gated) target.

## Notes

- **Headline anchor numbers are NOT re-measured by this bench.** They
  are locked from the 2026-05-07 incident response and serve as the
  fixed reference Plan 115-09's closeout report compares against. Even
  if the operator never runs the per-agent fleet bench, the headline
  anchor is sufficient for "did 115 ship a measurable improvement?"
  evaluation, because every Phase 115 target is expressed as a
  multiple-of-improvement against these anchor numbers.
- **fin-acquisition cold-start: SKIPPED (Ramy active gate).** Ramy in
  #fin-acquisition; restarting the agent disrupts his live client
  thread (per `feedback_ramy_active_no_deploy` operator memory). Bench
  CLI refuses without `--allow-fin-acq-cold-start`. To override, the
  operator must explicitly confirm Ramy is offline (or unblocking is
  acceptable) and pass the flag — Claude will not pass it autonomously.
- **Numbers above lock the "broken state" Phase 115 must beat.**
  Comparison report at `perf-comparisons/post-115-comparison.md` (Plan
  115-09 artifact) compares against this file.
- **PENDING per-agent rows are not blockers for the rest of Phase 115.**
  Plans 115-01 through 115-08 can ship without these rows being filled
  — the headline anchor is enough to gate "should we ship this?".
  The fleet table is for Plan 115-09 closeout's pre/post diff.
