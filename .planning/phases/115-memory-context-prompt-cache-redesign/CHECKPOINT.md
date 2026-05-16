# Phase 115 — Pending Operator Action (Plan 115-00 T03)

**Status:** Plan 115-00 partially complete — 2 of 3 tasks fully shipped, 1 task partial.
**Created:** 2026-05-08
**Owner:** operator (`@jjagpal`)
**Phase blocker?** **No** — Plans 115-01 through 115-08 can proceed without this.
**Closeout blocker?** **Yes** — Plan 115-09's pre/post comparison report
needs the fleet table filled in for the per-agent diff.

## What is pending

The live-fleet bench run (Plan 115-00 task T03) that fills in the
per-agent rows of:

- `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/baseline-pre-115.md` —
  per-agent table + cache hit rate analysis table

The headline anchor numbers (5,200 ms / 288,713 ms / 120,659 ms /
32,989 chars / 92.8% / <30%) are **already locked** in the file — they
come from the 2026-05-07 fin-acquisition incident, not from a fresh
bench run. The fleet table is the *additional* per-agent breakdown the
closeout report needs for a multi-agent pre/post diff.

## Why it didn't run autonomously

The bench harness (`scripts/bench/115-perf.ts`, T01) is shipped and
exit-0 on `--help`. The harness invocation against the live fleet was
deferred for two operator-policy reasons:

### 1. Ramy active gate (CLAUDE.md `feedback_ramy_active_no_deploy`)

> Ramy in #fin-acquisition; restarts disrupt his live client thread.
> Hold deploys until operator confirms quiet OR genuine emergency.

The `cold-start` scenario calls `clawcode stop <agent>` followed by
`clawcode start <agent>` — for fin-acquisition, this restarts the agent
mid-thread. The bench CLI hardcodes a refusal at
`scripts/bench/115-perf.ts:155-179`: fin-acquisition cold-start exits
with a logged skip-sentinel unless `--allow-fin-acq-cold-start` is
passed. Claude does NOT pass this flag autonomously.

### 2. Fleet bench sends real Discord messages

The non-cold-start scenarios (`discord-ack`, `tool-heavy`,
`memory-recall`, `extended-thinking`) use the daemon's `send-message`
IPC — this lands real prompts into the agents' channels through the
production turn loop. Even though the bench numbers themselves are
read from `traces.db` (read-only), the *invocation path* lights up
live Discord channels. Bench-prompt traffic is the same class of
disruption as a deploy from an operator's standpoint, so
`feedback_no_auto_deploy` applies — no autonomous fleet-wide bench
run without in-turn operator confirmation.

## What the operator needs to do

Open a quiet window across the 11 production agents (no live operator
threads, especially fin-acquisition). Then run:

```bash
LABEL=pre-115-baseline-2026-05-08

# Non-cold-start scenarios — 10 runs each across all 11 agents
for agent in admin-clawdy fin-acquisition fin-research finmentum-content-creator personal projects research test-agent fin-playground fin-tax general; do
  for scenario in discord-ack tool-heavy memory-recall extended-thinking; do
    npx tsx scripts/bench/115-perf.ts --agent "$agent" --scenario "$scenario" --runs 10 --label "$LABEL"
  done
done

# Cold-start: 3 runs per agent, fin-acquisition skipped (Ramy gate)
for agent in admin-clawdy fin-research finmentum-content-creator personal projects research test-agent fin-playground fin-tax general; do
  npx tsx scripts/bench/115-perf.ts --agent "$agent" --scenario cold-start --runs 3 --label "$LABEL"
done

# Optional, ONLY if Ramy is offline / unblocking confirmed:
# npx tsx scripts/bench/115-perf.ts --agent fin-acquisition --scenario cold-start --runs 3 --label "$LABEL" --allow-fin-acq-cold-start
```

After the run lands, fill in the per-agent table + cache-hit-rate table
in `baseline-pre-115.md`. The aggregate JSON rows live at
`~/.clawcode/bench/115/pre-115-baseline-2026-05-08/summary.jsonl` —
one line per agent×scenario×span aggregate.

For the cache-hit-rate table, run the SQL block in the
"Cache hit rate analysis" section of `baseline-pre-115.md` against each
agent's `~/.clawcode/agents/<agent>/traces.db`.

## Acceptance criteria still unmet

Two of the eight T03 acceptance criteria from `115-00-PLAN.md` remain
unmet pending the operator-quiet-window run:

- [ ] `ls ~/.clawcode/bench/115/pre-115-baseline-2026-05-08/summary.jsonl` returns the file path (the benchmark actually ran).
- [ ] The per-agent table has ≥10 data rows (the production fleet).

The other six criteria are satisfied:

- [x] File `baseline-pre-115.md` exists.
- [x] File `README.md` exists.
- [x] grep `5,200|5200` returns ≥1 match.
- [x] grep `288,713|288713` returns ≥1 match.
- [x] grep `92.8` returns ≥1 match.
- [x] grep `32,989|32989` returns ≥1 match.
- [x] grep `Ramy active gate` returns ≥1 match.

## After the operator runs the bench

This `CHECKPOINT.md` should be removed (or archived under
`.planning/debug/resolved/115-00-fleet-bench-pending.md`) once the
fleet bench has run and the per-agent rows are filled in.
