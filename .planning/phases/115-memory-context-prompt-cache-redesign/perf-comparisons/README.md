# Phase 115 perf-comparisons

This directory holds the perf-comparison artifacts that bookend Phase 115.

| File                              | Owner                       | Status as of 2026-05-08 |
| --------------------------------- | --------------------------- | ----------------------- |
| `baseline-pre-115.md`             | Plan 115-00 (this plan)     | LOCKED (anchor numbers); per-agent rows PENDING fleet bench run |
| `wave-2-checkpoint.md`            | Plan 115-08 (planned)       | not yet written         |
| `post-115-comparison.md`          | Plan 115-09 closeout        | not yet written         |

## Read order

For anyone joining mid-phase or auditing closeout:

1. Read `baseline-pre-115.md` first — it locks the headline anchor
   numbers (5,200 ms first_token p50, 288,713 ms end_to_end p95, 92.8%
   Ramy / <30% idle bimodal cache hit rate, 32,989-char fin-acq stable
   prefix) from the 2026-05-07 fin-acquisition incident.
2. After Wave 2 ships (Plans 115-04 through 115-07), Plan 115-08 writes
   `wave-2-checkpoint.md` measuring against the same scenarios with the
   structural changes in place. This is a mid-phase sanity check, not
   the final delivery report.
3. Plan 115-09 closeout writes `post-115-comparison.md` — the full
   pre/post diff with one row per Phase 115 perf target (six rows:
   first_token_p50, end_to_end_p95, mysql_query_p50,
   stable_prefix_tokens_p95, prompt_cache_hit_rate, tool_cache_hit_rate)
   showing baseline vs measured vs target.

## Methodology

All three reports use the same harness: `scripts/bench/115-perf.ts`
(Plan 115-00 T01 artifact). The harness reads `trace_spans.duration_ms`
from each agent's `traces.db` — never wall-clock — so the numbers are
byte-identical to what the dashboard / `clawcode latency` CLI reports.

Five canonical scenarios per agent (locked names — renaming breaks
pre/post comparison):

- `cold-start` — first-turn `first_token` after `clawcode start`
- `discord-ack` — short-message ("ok thx") Discord ack
- `tool-heavy` — multi-tool turn (mysql + web search)
- `memory-recall` — recall-flavored prompt against agent memory
- `extended-thinking` — long-form reasoning + 30K token thinking budget

Conventional run counts: 10 per agent×scenario, except `cold-start`
which is 3 (restarting agents is expensive). fin-acquisition
`cold-start` is hardcoded to skip without `--allow-fin-acq-cold-start`
(Ramy active gate).

## Operator gates

Live-fleet bench runs land real Discord messages in the agents'
channels (the bench does NOT mock dispatchTurn — sub-scope 16(a)
constraint). Operator must confirm a quiet window before kicking off
runs across the fleet. CLAUDE.md `feedback_ramy_active_no_deploy` and
`feedback_no_auto_deploy` apply: don't run benches across
fin-acquisition or other operator-active channels without explicit
in-turn confirmation.

The bench artifacts (per-run JSONL + summary.jsonl) live at
`~/.clawcode/bench/115/<label>/` — outside the repo, per-machine. Only
the `.md` reports here are committed.
