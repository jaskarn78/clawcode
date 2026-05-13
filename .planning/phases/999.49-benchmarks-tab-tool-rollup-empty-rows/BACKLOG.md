# Backlog: Benchmarks Tab — Tool Rollup Returns Empty Rows

## 999.49 — `/api/agents/:name/tools` returns rows with valid `count` but empty `tool` name and null percentiles; cross-agent comparison chart renders no bars

The Benchmarks tab's per-agent tool latency table renders 19 rows for `Admin Clawdy` but every row has:

- Blank Tool column (the `r.tool` field appears to be `""` or null)
- `n` (count) column populated with real numbers (13, 10, 146, 22, 21, 14, 3, 2, 2, 3, 1, 3, 2, 5, 2, 1, 1, 2, 1)
- p50 / p95 / p99 columns showing a red `—` (em dash) — meaning the percentile fields are null **AND** `slo_status === 'breach'` (the only path to `text-danger` styling in `BenchmarksView.tsx:297`)

Cross-agent comparison (Section 3) shows agent labels on the y-axis (`Admin Clawdy`, `fin-acquisition`) but no bars render — consistent with "metric not observed in window" empty-state.

### Symptoms

- 2026-05-13 ~21:30 PT — Operator opened the Benchmarks tab after the dash-redesign deploy, saw the broken state, surfaced as "none of the benchmarks seem to work."
- Reproduces for `Admin Clawdy` at minimum; needs verification across other agents to scope.
- The dashboard frontend is rendering the data it receives — this is a backend data shape problem, not a UI regression. Verified by:
  - `git diff --stat origin/master..HEAD` shows zero non-`dashboard/client/` source changes
  - `BenchmarksView.tsx` retone diff (commit `90eaeee`) only swapped the page `<h1>` for `.section-head`; the `<ToolRollupSection>` body and `<td>{r.tool}</td>` rendering at line 304 are untouched
  - The most-recent deploy used `--no-restart`, so the daemon is still running the bundle deployed at 17:47 — which itself was a rebuild of source byte-identical to `origin/master` for everything outside `dashboard/client/`

### Root cause (hypotheses, ranked)

1. **Space in agent display name** — `Admin Clawdy` (with space) flows through to the IPC handler / SQL query as a parameter. Some path may be URL-decoding or splitting on the space, returning rows that match a wildcard or empty agent and aggregating them with broken `tool` names. Test by selecting a different agent (e.g. `fin-acquisition`) and seeing if the rollup populates correctly.
2. **trace_spans table schema/migration drift** — tool_call spans for this agent may be recording without a `name` field. The rollup query's `GROUP BY tool` then produces 19 distinct null-tool buckets with valid counts and null percentile aggregations.
3. **slo_status defaults to 'breach' when percentiles are null** — separate small bug. Even if the data layer is producing null percentiles legitimately, the SLO classification path shouldn't default to `breach` for null inputs; should default to `unknown` or fall back to `text-fg-3`. See `BenchmarksView.tsx:295-301`.
4. **trace_spans data genuinely missing for this agent** — the agent may not have run any tool_call spans in the 24h window. But that should produce zero rows, not 19 null-tool rows.

### Acceptance criteria

- For any agent with tool_call activity in the selected window, the Tool column renders the actual tool name (e.g. `WebFetch`, `Bash`, `Read`)
- p50 / p95 / p99 cells either show real values OR a neutral `—` (not red)
- `slo_status === 'breach'` only triggers when there's a real percentile to compare against an SLO threshold
- Cross-agent comparison chart renders bars when at least one selected agent has the chosen metric in the window
- Repro path documented: which agent name + window produced the broken state

### Implementation notes

- Diagnostic order:
  1. SSH to clawdy, run `sqlite3 /opt/clawcode/data/traces.db "SELECT tool, COUNT(*) FROM trace_spans WHERE agent = 'Admin Clawdy' AND ts > strftime('%s','now','-24 hours') * 1000 GROUP BY tool;"` — confirm whether the table actually has empty `tool` fields or whether the daemon's IPC layer is dropping them
  2. Check IPC handler for the tools endpoint: `src/dashboard/server.ts:422` and follow the IPC method that backs it
  3. Look for SQL parameter binding that handles `agentName` with spaces — likely safe (better-sqlite3 prepared statements) but worth verifying
- The `colorClass` fallback in `BenchmarksView.tsx:295-301` should treat null percentiles as `text-fg-3` (neutral mono) rather than running the breach/warn classification. Independent of the data fix.
- If the data is genuinely missing for some agents in the 24h window, the empty-state message in `ToolRollupSection` should say "no tool spans recorded for this agent in window" rather than rendering 19 null rows.

### Related

- `dash-redesign` sweep (commits `9cd36b4`..`90eaeee`) — exonerated; SPA-only, daemon not restarted with new code since the issue was reported
- 999.38 — Dashboard SLO recalibration (parallel concern: slo_status classification)
- `src/performance/trace-store.ts` — owns the trace_spans schema
- `src/performance/__tests__/trace-store-*` — existing tests don't cover empty-tool-name groupings

### Reporter

Jas, 2026-05-13 21:30 PT (surfaced post dash-redesign sweep deploy)
