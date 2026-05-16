# Phase 115 — Pre/Post Comparison

**Locked:** 2026-05-08 (post-Wave-4 ship — code-only; production deploy is operator-confirmed and follows this report)
**Compared against:** [`baseline-pre-115.md`](./baseline-pre-115.md)
**Method:** [`scripts/bench/115-perf.ts`](../../../../scripts/bench/115-perf.ts) (Plan 115-00 artifact)
**Sample (intended):** 10 runs per agent × scenario; cold-start 3 runs; **fin-acquisition cold-start SKIPPED (Ramy gate from CLAUDE.md `feedback_ramy_active_no_deploy`)**.

> **Status:** This report's structure + acceptance-criteria checklist + sub-scope 6-B decision + backups list + fold-in status are FINAL. Numeric cells marked `(operator-run)` populate when the operator opens a quiet window and runs the post-115 benchmark + tool-latency audit. The closeout plan ships code; the operator owns the measurement.

---

## Headline targets

| Metric                        | Pre-115                        | Post-115        | Δ              | Target                                                                          | Status |
| ----------------------------- | -----------------------------: | --------------: | -------------: | ------------------------------------------------------------------------------: | :----: |
| `first_token_p50_ms`          | 5,200                          | (operator-run)  | (Δ)            | ≤ 2,000                                                                         | TBD    |
| `end_to_end_p95_ms`           | 288,713                        | (operator-run)  | (Δ)            | ≤ 30,000                                                                        | TBD    |
| `mysql_query_p50_ms`          | 120,659                        | (operator-run)  | (Δ)            | ≤ 5,000                                                                         | TBD    |
| `stable_prefix_tokens_p95`    | 32,989 chars (incident anchor) | (operator-run)  | (Δ)            | ≤ 8,000 hard cap / ≤ 10,000 fleet p95 / ≤ 12,000 fin-acq session start          | TBD    |
| `prompt_cache_hit_rate`       | 92.8% Ramy / <30% idle (bimodal) | (operator-run) | (Δ)            | ≥ 70% across <5min cadence agents                                               | TBD    |
| `tool_cache_hit_rate`         | n/a (no cache existed)         | (operator-run)  | (Δ)            | ≥ 40% on repetitive-read agents (fin-acq, fin-research, finmentum-content-creator) | TBD    |

The **8K hard cap** is the assembly-time enforcement (D-02). The
**10K fleet p95** and **12K fin-acq session start** are delivery
targets — what the cap should produce in normal load. Cap stricter than
targets → safety margin.

---

## Per-agent post-115 (measured)

This table populates after the operator opens a quiet window and runs:

```bash
LABEL=post-115-final-2026-05-08
for agent in admin-clawdy fin-research finmentum-content-creator personal projects research test-agent fin-playground fin-tax general; do
  for scenario in discord-ack tool-heavy memory-recall extended-thinking; do
    npx tsx scripts/bench/115-perf.ts --agent "$agent" --scenario "$scenario" --runs 10 --label "$LABEL"
  done
done
# Cold-start: 3 runs each, skipping fin-acquisition
for agent in admin-clawdy fin-research finmentum-content-creator personal projects research test-agent fin-playground fin-tax general; do
  npx tsx scripts/bench/115-perf.ts --agent "$agent" --scenario cold-start --runs 3 --label "$LABEL"
done
# fin-acquisition: discord-ack / tool-heavy / memory-recall / extended-thinking only — NO cold-start (Ramy gate)
for scenario in discord-ack tool-heavy memory-recall extended-thinking; do
  npx tsx scripts/bench/115-perf.ts --agent fin-acquisition --scenario "$scenario" --runs 10 --label "$LABEL"
done
```

After all runs land, fill the table from
`~/.clawcode/bench/115/post-115-final-2026-05-08/summary.jsonl`.

| Agent                         | discord-ack p50 (ms) | tool-heavy p95 (ms) | memory-recall p50 (ms) | extended-thinking p95 (ms) | stable_prefix_tokens |
| ----------------------------- | -------------------: | ------------------: | ---------------------: | -------------------------: | -------------------: |
| admin-clawdy                  | (operator-run)       | (operator-run)      | (operator-run)         | (operator-run)             | (operator-run)       |
| fin-acquisition               | (operator-run)       | (operator-run)      | (operator-run)         | (operator-run)             | (operator-run)       |
| fin-research                  | (operator-run)       | (operator-run)      | (operator-run)         | (operator-run)             | (operator-run)       |
| finmentum-content-creator     | (operator-run)       | (operator-run)      | (operator-run)         | (operator-run)             | (operator-run)       |
| personal                      | (operator-run)       | (operator-run)      | (operator-run)         | (operator-run)             | (operator-run)       |
| projects                      | (operator-run)       | (operator-run)      | (operator-run)         | (operator-run)             | (operator-run)       |
| research                      | (operator-run)       | (operator-run)      | (operator-run)         | (operator-run)             | (operator-run)       |
| test-agent                    | (operator-run)       | (operator-run)      | (operator-run)         | (operator-run)             | (operator-run)       |
| fin-playground                | (operator-run)       | (operator-run)      | (operator-run)         | (operator-run)             | (operator-run)       |
| fin-tax                       | (operator-run)       | (operator-run)      | (operator-run)         | (operator-run)             | (operator-run)       |
| general                       | (operator-run)       | (operator-run)      | (operator-run)         | (operator-run)             | (operator-run)       |

**fin-acquisition cold-start SKIPPED — Ramy gate.** Ramy in
#fin-acquisition; restarting the agent disrupts his live client
thread. Cold-start scenario for that agent reads `_PENDING_` until
operator explicitly confirms Ramy is offline AND passes
`--allow-fin-acq-cold-start` to the bench CLI.

---

## Acceptance criteria (ROADMAP lines 901-907)

These seven criteria gate the phase. Each is measurable from the
post-115 fleet bench + targeted verification turns.

- [ ] **AC-01:** fin-acquisition's stable-prefix size at session start ≤ 12K tokens (measured: `(operator-run)`).
- [ ] **AC-02:** Fleet p95 stable-prefix size ≤ 10K tokens (measured: `(operator-run)`).
- [ ] **AC-03:** Cache-hit rate ≥ 70% on agents with sub-5min turn cadence (measured: `(operator-run)`).
- [ ] **AC-04:** fin-acq lazy-recall verification — *"what did we discuss with Ana Bencker on May 6"* succeeds via `clawcode_memory_search` tool call without operator priming. **Verified:** `(operator-run, scenario memory-recall on fin-acquisition)`. Plan 115-05 sub-scope 7 lands the tools; this is the live-fleet acceptance check on the running daemon.
- [ ] **AC-05:** No agent's `<memory-context>` injection contains rows tagged `session-summary` / `mid-session` / `raw-fallback`. **Verified:** `(operator-run, query)`:
  ```sql
  -- Run per agent's memories.db (~/.clawcode/agents/<agent>/memory/memories.db).
  SELECT COUNT(*) FROM memories
   WHERE EXISTS (SELECT 1 FROM json_each(tags) AS t
                  WHERE t.value IN ('session-summary','mid-session','raw-fallback'));
  -- Should return 0 for every agent.
  ```
- [ ] **AC-06:** Diagnostic dump path operator-readable on demand without redeploy (verified via `clawcode-status` showing the new config flag wired by Plan 115-03 / sub-scope 14 — `(operator-run)`).
- [ ] **AC-07:** Anthropic 400 `invalid_request_error` returns `[diag] likely-prompt-bloat` log within same turn. **Verified:** `(operator-run, synthetic test from 115-02 prompt-bloat-classifier.test.ts pattern)`. Reproduces the 2026-05-07 fin-acquisition incident's signature; classifier should fire in real time on the daemon log.

---

## Sub-scope 6-B status

See [`sub-scope-6b-decision.md`](./sub-scope-6b-decision.md). Branch: **`PENDING-OPERATOR` → de-facto `DEFER`**.

The `wave-2-checkpoint.md` skeleton landed by Plan 115-08 documents
the gate-decision logic + headers + threshold but has no real
production numbers — the per-agent table is blank, fleet non-fin-acq
average reads `(post-deploy)`. Per CONTEXT D-12 the gate is
`tool_use_rate < 30%` across non-fin-acq agents → SHIP; ≥30% → DEFER.
Threshold is Claude pick (D-12), not research-backed; refinable.
Today the gate's input data does not exist, so the executor cannot
honestly stamp SHIP. Sub-scope 6-B (direct-SDK 1h-TTL fast-path) is
DEFERRED to **Phase 116** (TBD) once a real audit run exists. Phase
116 trigger: post-115 deploy + 24h soak + `clawcode tool-latency-audit
--json --window-hours 24`. fin-acquisition is excluded from the gate
because Ramy-paced sessions are tool-heavy by design — including them
would systematically push the average up and DEFER 6-B
inappropriately for the median agent.

---

## Migration status (Plan 115-06)

Plan 115-06 sub-scope 10 ships the bge-small-en-v1.5 + int8
quantization migration runner. Migration timeline (per CONTEXT D-08):

- **T+0 → T+7d:** dual-write transition (new writes embed with both v1 MiniLM + v2 bge-small-int8).
- **T+7d → T+14d:** background batch re-embed of historical memories at 5% CPU budget.
- **T+14d:** cutover (reads switch to v2; v1 column dropped after 24h soak).

**Phase:** `(operator-run via clawcode memory migrate-embeddings status)`
**Per-agent:** `(operator-run; mapping agent → phase populates after deploy)`
**Cutover ETA:** `T+14d` from operator-confirmed deploy date.

---

## Backups

Per ROADMAP line 913 — backups left from the 2026-05-07 incident
response **MUST NOT be garbage-collected** until phase 115 fully ships
+ is in production for ≥7 days:

- `.bak-pre-cwd-fix-20260507-150422` (yaml — Phase 100 cwd fix)
- `.bak-pre-resumegap-20260507-144315` (yaml — resume-gap fix)
- `.bak-pre-billing-cleanup-20260507-154551` (fin-acq DB)
- `.bak-pre-poison-fix-20260507-144315` (fin-acq DB — poison purge)
- `.bak-pre-summary-purge-20260507-153416` (fin-acq DB — summary purge)
- `.bak-postcleanup-20260507-143641` (fin-acq DB — post-cleanup snapshot)
- `.credentials.json.bak-relogin-1778192734` (OAuth re-login backup)

Operator inspection: `find ~/.clawcode -name '.bak-*' -mtime -30`
shows the surviving set; do NOT `find ... -delete` until the
post-115 production soak completes.

---

## Phases folded in (per ROADMAP)

- **Phase 999.40 — SUPERSEDED-BY-115** (sub-scope 15 — MCP tool-response
  cache; landed in Plan 115-07).
- **Phase 999.41** — rolling-summary fail-loud guard (carve-out
  absorbed in Plan 115-02 T02; rest of 999.41 remains separate).
- **Phase 999.42** — FTS5 + tier model parts absorbed in Plans 115-05
  (sub-scope 7 lazy recall) + 115-03 (sub-scope 11 Tier1/Tier2 split).
  Auto-skill creation explicitly NOT in 115 scope; remains in 999.42.

These three are the only phase fold-ins. Carrying them as separate
phases would have created downstream churn — phase 115's surface
already touches the same files (`embedder.ts`, `search.ts`,
`session-config.ts`, `summarize-with-haiku.ts`) so combining was
strictly cheaper than serializing.

---

## What plan 115-09 actually shipped

For the closeout record, here is the wave-4 ship list — code committed
in this plan only:

- **T01 — Sub-scope 6-B gate decision artifact + perf-comparison CLI.**
  - `.planning/phases/115-*/perf-comparisons/sub-scope-6b-decision.md`
  - `src/cli/commands/perf-comparison.ts` registered in `src/cli/index.ts`
  - Decision: `PENDING-OPERATOR → DEFER`. Phase 116 carries 6-B forward.
- **T02 — Sub-scope 12 cross-agent consolidation transactionality.**
  - `src/manager/cross-agent-coordinator.ts` + `.types.ts`
  - 8 vitest cases including 3-agent batch success, partial-failed,
    rollback (delete by `consolidation:<runId>` tag), idempotent
    rollback, missing-store fallback.
  - Re-exported from `src/memory/consolidation.ts` so callers wanting
    cross-agent semantics import from one place. Per-agent
    `runConsolidation` preserved verbatim.
- **T03 — DEFERRED.** No `haiku-direct-fastpath.ts`, no
  `turn-dispatcher.ts` routing edit, no `directSdkFastPath` config
  flag. Per T01 decision (PENDING-OPERATOR → DEFER).
- **T04 — Sub-scope 16(c) dashboard surface.** Three new subtitle lines
  in `src/dashboard/static/app.js` rendering tier1_inject_chars +
  tier1_budget_pct + lazy_recall_call_count + prompt_bloat_warnings_24h
  with NULL-graceful fallback. New `getPhase115DashboardMetrics`
  aggregator on `TraceStore`. Wired into daemon's `case "cache"`
  augmenter so the existing dashboard 30s cache poll picks up the
  new fields.
- **T05 — This file.** Closeout receipt structure + sub-scope 6-B
  status + acceptance-criteria checklist + backups list + fold-in
  status. Numbers populate post-deploy.

---

## Outstanding (route to follow-on phases)

| Item                                                      | Why outstanding                                                                  | Routing                |
| :-------------------------------------------------------- | :-------------------------------------------------------------------------------- | :--------------------- |
| Sub-scope 6-B (direct-SDK 1h-TTL fast-path)               | Gate input data not yet measured (CLAUDE.md no-auto-deploy + Ramy gate)            | Phase 116 (TBD)        |
| AC-01 through AC-07 numeric verification                  | Operator must run post-115 bench + targeted verification turns post-deploy        | Operator log this file |
| Phase 999.42 auto-skill creation                          | Out-of-scope per CONTEXT line 27                                                   | Phase 999.42 retains   |
| Three-phase Hermes-style compression Phase 2 + 3 (LLM)    | Out-of-scope per CONTEXT line 33                                                   | Future phase           |
| Cross-host memory sync                                    | Out-of-scope per CONTEXT line 30                                                   | Future phase           |
| Cross-agent KG (knowledge graph) sharing across agents    | Out-of-scope per CONTEXT line 31                                                   | Future phase           |
| Operator-readable memory format                           | Out-of-scope per CONTEXT line 32 (operator confirmed not required)                | Future phase if asked  |

---

## Notes

- **This plan ships code only.** Production deploy of phase 115 is a
  separate operator-confirmed action via `scripts/deploy-clawdy.sh` —
  do NOT include deploy steps. Per CLAUDE.md `feedback_no_auto_deploy`
  + `feedback_ramy_active_no_deploy`, the deploy waits for an
  explicit operator "deploy" / "ship it" in a Ramy-quiet window.
- **Ramy gate honored throughout.** fin-acquisition cold-start is
  skipped in the post-115 bench; production deploy is operator-gated.
  No fin-acquisition session was restarted during this plan's
  execution.
- **Migration kicks off post-deploy.** Plan 115-06's
  `clawcode memory migrate-embeddings start <agent>` runs after the
  operator confirms the deploy. The 14d migration window starts then.
- **The four perf-comparisons files together form the complete
  phase-115 evidentiary record:**
  - [`baseline-pre-115.md`](./baseline-pre-115.md) — broken state
  - [`wave-2-checkpoint.md`](./wave-2-checkpoint.md) — mid-phase progress + gate skeleton
  - [`sub-scope-6b-decision.md`](./sub-scope-6b-decision.md) — gate read + DEFER decision
  - **`post-115-comparison.md`** — this file; final results
- Operator quick view: `clawcode perf-comparison` (Plan 115-09 T01)
  prints all four artifact statuses + the 6-B gate decision in one
  command. Use `--json` for scripting.

---

*Authored by closeout plan 115-09 executor on 2026-05-08. Numeric
cells filled by the operator after the post-115 deploy + 24h soak +
fleet bench. The structure (acceptance criteria, fold-ins, backups,
6-B status) is the durable record.*
