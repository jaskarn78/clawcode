---
quick_id: 260511-mfn
slug: close-out-phase-999-7-item-2-run-tool-la
date: 2026-05-11
description: Close out Phase 999.7 Item 2 — run tool-latency audit, identify tail-dominators, write closeout note
status: complete
must_haves:
  - Read-only audit run against clawdy production traces (no deploy)
  - Per-tool p50/p95 captured for Admin Clawdy + fin-acquisition (168h window)
  - Findings classified by phase boundary (999.7 vs 115-08 follow-up vs separate bug)
  - ROADMAP.md Phase 999.7 status updated to SHIPPED
  - STATE.md Quick Tasks Completed row added
---

# Quick 260511-mfn — Phase 999.7 Item 2 closeout

## Task

Phase 999.7 Item 2 was the only open work in 999.7: *"Tool-call p95 latency is 216-238s. Worth profiling per-tool to see whether specific tools dominate the tail."* Phase 115 Plan 08 (shipped 2026-05-08) added the telemetry substrate — split-latency producers, `tool-latency-audit` CLI, dashboard panel. This quick task performs the analytical work that 999.7 Item 2 was waiting on: run the audit, identify the dominant tail tools, decide phase status.

## Plan

Single task — analytical, no code changes:

1. SSH to clawdy (read-only, not a deploy) and query the `traces.db` files directly under `/home/clawcode/.clawcode/agents/<agent>/traces.db` for the past 168 hours
2. Compute per-tool p50/p95/p99 from `trace_spans` rows where `name LIKE 'tool_call.%'`
3. Check whether Phase 115-08 split-latency columns (`tool_execution_ms`, `tool_roundtrip_ms`, `parallel_tool_call_count`) on the `traces` table are being populated by the live daemon
4. Write `260511-mfn-AUDIT-FINDINGS.md` with the raw numbers
5. Write closeout note + update ROADMAP.md Phase 999.7 status from `PARTIAL` → `SHIPPED`
6. Update STATE.md Quick Tasks Completed table
7. Commit atomically — **NO DEPLOY**

## Verification

- `cat .planning/quick/260511-mfn-*/260511-mfn-AUDIT-FINDINGS.md` — exists, contains p50/p95/p99 tables for both agents
- `grep "999.7" .planning/ROADMAP.md` — status line reads SHIPPED 2026-05-11
- `grep 260511-mfn .planning/STATE.md` — row added under Quick Tasks Completed
- `git log --oneline -1` — single commit `docs(260511-mfn): ...`

## Done

- Findings split into 3 distinct categories (999.7 closes clean; 115-08 producer regression; CLI Invalid Request bug)
- Two follow-ups captured for Phase 116's plan-phase to absorb or route to a follow-up quick task
