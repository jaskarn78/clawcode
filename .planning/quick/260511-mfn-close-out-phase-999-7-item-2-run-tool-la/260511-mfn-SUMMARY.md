---
quick_id: 260511-mfn
slug: close-out-phase-999-7-item-2-run-tool-la
date: 2026-05-11
status: complete
commit: pending
files_changed:
  - .planning/quick/260511-mfn-*/260511-mfn-PLAN.md (created)
  - .planning/quick/260511-mfn-*/260511-mfn-AUDIT-FINDINGS.md (created)
  - .planning/quick/260511-mfn-*/260511-mfn-SUMMARY.md (created)
  - .planning/ROADMAP.md (Phase 999.7 PARTIAL → SHIPPED 2026-05-11)
  - .planning/STATE.md (Quick Tasks Completed table — new row)
---

# Quick 260511-mfn — Summary

## What we did

Performed Phase 999.7 Item 2's open analytical work: ran a read-only tool-call latency audit against clawdy production (SSH + direct `sqlite3` against `/home/clawcode/.clawcode/agents/<agent>/traces.db`, 168h rolling window, no deploy), identified per-tool tail dominators for Admin Clawdy and fin-acquisition, classified findings into three buckets, and closed Phase 999.7 at status SHIPPED with the two non-blocking follow-ups captured separately.

## Findings (3 distinct, intentionally not bundled)

**A — Phase 999.7 Item 2 question (CLOSED):** Per-tool tail dominators identified. Headline: local file tools (Read/Edit/Grep/Glob/Bash) are the surprise tail-dominators at p95 200-700s on BOTH agents — they should be milliseconds. Browser navigate (718s p95 on fin-acq), spawn_subagent_thread (515s p95 on fin-acq), and mysql_query (307s p95 on fin-acq, 306 calls) round out the top tail tools. The original 999.7 2026-04-29 trigger of "216-238s p95" understated the actual tail.

**B — Phase 115 Plan 08 producer regression (follow-up):** The new split-latency columns (`tool_execution_ms`, `tool_roundtrip_ms`, `parallel_tool_call_count`) on the `traces` table are NULL for every turn in production over the 8h post-deploy window (0/63 turns populated despite 132 tool_call.* spans). Root cause traced to a bundle inconsistency: `trace-collector.ts` 115-08 method definitions ARE in the deployed bundle but `session-adapter.ts` 115-08 producer call sites + `iterateUntilResult` → `iterateWithTracing` rename are NOT. The bundle was built off an intermediate state. Likely a stale tsup/esbuild incremental cache. Captured as input to Phase 116's plan-phase (F07 dependency) or a separate quick task.

**C — `clawcode tool-latency-audit` CLI returns `Error: Invalid Request` (informational):** Likely shares root cause with B (same build issue would strip the closure-intercept IPC handler too). Don't open separately until B is fixed.

## Decisions made

- **999.7 closes clean** — the question Item 2 was waiting on is answered. Producer regression and CLI bug are separate items; bundling them would muddy phase status semantics (advisor reconcile, 2026-05-11).
- **Skipped the planner subagent spawn** in /gsd-quick — task was a doc-write with all data already in hand; workflow ceremony wasn't load-bearing here.
- **Used direct SQLite read** over `clawcode tool-latency-audit` CLI because the CLI returns `Invalid Request` in production (Finding C). The SQLite read is reproducible and zero-risk.

## Reproducibility

The audit queries are archived in `260511-mfn-AUDIT-FINDINGS.md` "Raw query archive" section. Anyone can re-run them on clawdy via `ssh clawdy "sudo sqlite3 /home/clawcode/.clawcode/agents/<agent>/traces.db < query.sql"` to verify or refresh the numbers.

## What's NOT in this quick task (named for clarity)

- A fix for Finding B (Phase 115 producer regression) — captured as input to Phase 116 plan-phase, or open a follow-up quick task when ready
- A fix for Finding C (CLI Invalid Request) — gated on Finding B
- A fix for the local-file-tool overhead (Read/Edit/Grep at 200-400s p95) — Phase 115 sub-scope 17 hypothesized this is LLM round-trip leakage into the tool span; verifying requires Finding B fixed so the split-latency columns can disambiguate
- Apples-to-apples Phase 115 perf comparison — needs 1-2 more weeks of post-115 data (current 168h window is 95% pre-115)

## No deploy

Per operator instruction: code-only doc commits. No `scripts/deploy-clawdy.sh` invocation. The audit was read-only against production state.
