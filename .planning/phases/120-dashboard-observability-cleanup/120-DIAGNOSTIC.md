# Phase 120 — Diagnostic SQL Results

**Run:** 2026-05-14 ~03:56 UTC (immediately post-deploy of v2.9 build `4e96c24`)
**Source DBs:** Per-agent `traces.db` files under `/home/clawcode/.clawcode/agents/<agent>/traces.db`
**Probes run:** admin-clawdy (slug-form DB) + Admin Clawdy (display-name-form DB)

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

**Conclusion:** Tool-name rendering issues in the BenchmarksView rollup table are NOT caused by the SQL guard. Every `tool_call.*` name in trace_spans is well-formed (no empty, no NULL, no truncated). The shortest tool_call name (`tool_call.Bash`) is 14 chars — already above the 11-char guard.

**Root cause must be downstream of the database:**
- Frontend rendering issue in `BenchmarksView.tsx` (most likely)
- IPC string-binding marshaling
- SQL JOIN dropping rows (group-by aggregation)
- Display layer truncation

Plan 120-02 (frontend bundle) should focus on the JOIN/aggregation path and the React render path. NOT on the SQL guard.

### DASH-04 split-latency producer regression — CONFIRMED catastrophically broken

```
admin-clawdy:
  - 507 end_to_end spans total
  - 0 of them have any latency metadata in metadata_json
  - Most recent: 2026-04-21T03:47:10Z (over 3 weeks old)

Admin Clawdy:
  - 348 end_to_end spans total
  - 0 of them have any latency metadata in metadata_json
  - Most recent: 2026-05-14T03:56:24Z (literally just now, post-deploy)
  - Every metadata_json: "{}"
```

**Conclusion:** The producer that should write `prep_latency_ms`, `tool_latency_ms`, `model_latency_ms` into `end_to_end` span metadata is NOT executing on production. Every end_to_end span has empty metadata. This is silent-path-bifurcation (Phase 115-08-class regression) — the canonical writer drifted; the test fixture writer is being used silently.

Plan 120-03 (DASH-04 producer pin + static-grep regression) is HIGH-PRIORITY and the root cause is exactly as CONTEXT D-03 predicted.

## Green-light verdicts for Phase 120 plans

- **Plan 120-02 (DASH-01/02/03 frontend bundle):** GREEN — but T-01 (DASH-01) should target the frontend rendering / IPC marshaling path, NOT the SQL guard. The guard is not the bug.
- **Plan 120-03 (DASH-04 producer pin):** GREEN — high priority. Producer is silently dead. The pin will restore split-latency telemetry across all agents.
- **Plan 120-04 (DASH-05 CLI verification):** GREEN — independent of the above.

## Verification artifact

Captured by main session 2026-05-14 03:56 UTC. Probe SQL ran read-only over SSH against `/home/clawcode/.clawcode/agents/{admin-clawdy,Admin Clawdy}/traces.db`. No writes, no daemon restart, no side effects.
