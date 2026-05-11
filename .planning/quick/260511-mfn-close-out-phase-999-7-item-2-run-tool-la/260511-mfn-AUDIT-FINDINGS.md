# Tool-call latency audit — Phase 999.7 Item 2 raw findings

**Audit window:** 2026-05-04 16:00 UTC → 2026-05-11 16:00 UTC (rolling 168h)
**Audit method:** Direct SQLite read of `/home/clawcode/.clawcode/agents/<agent>/traces.db` on clawdy via SSH + sudo. Read-only — no deploy, no daemon restart.
**Caveat:** Window straddles Phase 115 deploy (2026-05-11 07:28 PDT = 14:28 UTC). Roughly 161h of data is pre-115, ~8h is post-115. Apples-to-apples pre/post comparison needs another week of post-115 data.
**Bundle on clawdy:** `/opt/clawcode/dist/cli/index.js` md5 / mtime confirms it's the 2026-05-11 14:28 UTC build off commit `3d1fcfa`.

---

## Finding A — Per-tool tail dominators (the 999.7 question)

**Conclusion:** Tail latency is dominated by **local file tools** (`Read`/`Edit`/`Grep`/`Glob`/`Bash`) at p95 200-700s — which is the surprising headline. These should be milliseconds. Secondary contributors are browser automation and database queries, which are expected to be slow but should NOT be local-tool slow.

### Admin Clawdy — top 10 tool_call.* spans by p95 (168h)

Method: ROW_NUMBER() OVER (PARTITION BY name ORDER BY duration_ms) against `trace_spans` where `name LIKE 'tool_call.%' AND started_at > datetime('now','-168 hours')`.

| Rank | Tool                                                  | n    | p50 ms  | p95 ms  | p99 ms  |
|------|-------------------------------------------------------|------|---------|---------|---------|
| 1    | `tool_call.Edit`                                      | 97   | 74,496  | 374,946 | 454,440 |
| 2    | `tool_call.Grep`                                      | 44   | 98,923  | 310,251 | 318,141 |
| 3    | `tool_call.Read`                                      | 174  | 66,825  | 297,087 | 507,761 |
| 4    | `tool_call.mcp__playwright__browser_navigate`         | 19   | 58,143  | 247,371 | 247,371 |
| 5    | `tool_call.Bash`                                      | 1051 | 62,355  | 240,716 | 413,184 |
| 6    | `tool_call.mcp__clawcode__ask_agent`                  | 17   | 12,238  | 234,281 | 234,281 |
| 7    | `tool_call.mcp__playwright__browser_evaluate`         | 11   | 72,074  | 223,168 | 223,168 |
| 8    | `tool_call.mcp__playwright__browser_take_screenshot`  | 14   | 79,205  | 220,192 | 220,192 |
| 9    | `tool_call.mcp__1password__item_lookup`               | 8    | 29,487  | 218,112 | 218,112 |
| 10   | `tool_call.WebSearch`                                 | 10   | 182,590 | 217,225 | 217,225 |

### fin-acquisition — top 10 tool_call.* spans by p95 (168h)

| Rank | Tool                                                  | n    | p50 ms  | p95 ms  | p99 ms  |
|------|-------------------------------------------------------|------|---------|---------|---------|
| 1    | `tool_call.mcp__playwright__browser_navigate`         | 20   | 226,957 | 717,722 | 717,722 |
| 2    | `tool_call.Bash`                                      | 660  | 64,313  | 645,732 | 900,851 |
| 3    | `tool_call.mcp__clawcode__spawn_subagent_thread`      | 16   | 17,379  | 514,604 | 514,604 |
| 4    | `tool_call.Read`                                      | 369  | 48,677  | 324,159 | 502,139 |
| 5    | `tool_call.ToolSearch`                                | 148  | 37,277  | 322,226 | 625,018 |
| 6    | `tool_call.mcp__playwright__browser_take_screenshot`  | 17   | 164,806 | 312,577 | 312,577 |
| 7    | `tool_call.Glob`                                      | 62   | 35,996  | 311,160 | 318,293 |
| 8    | `tool_call.mcp__finmentum-db__mysql_query`            | 306  | 39,216  | 306,559 | 357,209 |
| 9    | `tool_call.mcp__clawcode__clawcode_fetch_discord_messages` | 22 | 122,326 | 287,252 | 326,371 |
| 10   | `tool_call.mcp__finnhub__stock_candles`               | 35   | 273,666 | 284,439 | 285,143 |

### Pattern analysis

1. **Local file tools** (Read/Edit/Grep/Glob/Bash) are tail-dominators on BOTH agents at p95 200-700s. They should be milliseconds. This was the original Phase 115 sub-scope 17 hypothesis. The `tool_call.<name>` span is documented in Phase 115-08 SUMMARY as "execution-side" (opens on tool_use emit, closes on tool_result arrival), so this duration includes:
   - SDK → Claude Code harness dispatch
   - Actual tool execution
   - Result back to SDK
   
   For local tools on a non-busy box this should be ≤1s. The observed 50-300s suggests either (a) heavy queueing inside Claude Code's tool-dispatch path under concurrent agent load (14+ agents running), or (b) the timer captures more than pure execution (e.g., LLM-side reorganization between tool_use emission and result delivery on the user message).

2. **mysql_query on fin-acq** has 306 calls with avg 70s, p95 307s. Phase 115 sub-scope 15 (MCP tool-response cache, folded into 115-07) targeted this exact bottleneck. Worth re-measuring post-115 deploy in a week.

3. **Browser navigate on fin-acq** has p95 718s — likely brokerage portals (Schwab AIP, Fidelity) with heavy JS + slow auth. Less actionable; mostly inherent to the target sites.

4. **finnhub stock_candles** avg 273s p50 over only 35 calls — slow external API, low volume. Not a top operator concern.

5. **spawn_subagent_thread on fin-acq** has p95 515s — relates to Phase 999.36 sub-bug A (typing indicator on subagent dispatch). 999.36 Plan 00 shipped the typing fix; check the typing indicator is actually firing in the next deploy cycle.

### Original 999.7 trigger comparison

- **2026-04-29 reported:** Tool-call p95 latency 216-238s on Admin Clawdy + fin-acquisition
- **2026-05-11 measured:** Per-tool p95 200-700s range; both agents still slow. **The slowness did NOT improve.** Some tools got worse (fin-acq Bash 645s p95, browser_navigate 718s p95). Local file tools (Read/Edit/Grep) now identified as surprising tail-dominators that weren't in the original 999.7 scope.

---

## Finding B — Phase 115 Plan 08 split-latency producers SILENT in production

**Severity:** Medium — telemetry infrastructure shipped to production schema but no rows are populated.
**Disposition:** Phase 115 follow-up. Does NOT block 999.7 closure.

### Evidence

Query against `traces` table in the 8h window since Phase 115 deploy:

| Agent           | turns | turns_with_split | turns_with_parallel | tool_call.* spans (same window) |
|-----------------|-------|------------------|---------------------|--------------------------------|
| Admin Clawdy    | 27    | **0**            | **0**               | 77                             |
| fin-acquisition | 36    | **0**            | **0**               | 55                             |

The schema columns `tool_execution_ms`, `tool_roundtrip_ms`, `parallel_tool_call_count` ARE present on the `traces` table (verified via `.schema traces`). The conditional-spread NULL semantics from 115-08 SUMMARY (`...(parallelToolCallCount > 0 ? { fields } : {})`) should produce non-null values for any turn with tool calls. 132 tool_call.* spans across the two agents in 8h, zero turns with split data populated.

### Probable root cause (60-second probe completed)

Bundle inspection (`grep` on `/opt/clawcode/dist/cli/index.js`):

- Turn class **method definitions** are present at bundle lines 10700-10737:
  - `addToolExecutionMs(durationMs)` ✓
  - `addToolRoundtripMs(durationMs)` ✓
  - `recordParallelToolCallCount(batchSize)` ✓
- Turn class **method call sites in `iterateWithTracing`** are MISSING:
  - 0 occurrences of `.addToolExecutionMs?.(`
  - 0 occurrences of `.addToolRoundtripMs?.(`
  - 0 occurrences of `.recordParallelToolCallCount?.(`
- Function `iterateWithTracing` itself does NOT exist in the bundle (`grep "function iterateWithTracing\|async function iterateWithTracing"` → 0 hits). All 4 hits of the literal `iterateWithTracing` in the bundle are in **comments / docstrings only**. The actual function in the bundle is the older `iterateUntilResult` (7 hits, includes `async function` definition at line 3335).

### Conclusion on Finding B

The bundle was built off an intermediate state where:
- `src/performance/trace-collector.ts` includes the 115-08 producer method definitions ✓
- `src/manager/session-adapter.ts` does NOT include the 115-08 producer call sites or the `iterateUntilResult` → `iterateWithTracing` rename ✗

Local source at `src/manager/session-adapter.ts:1336` has `async function iterateWithTracing` since commit `cebc06c` (2026-05-08 07:02 UTC = 2026-05-08 00:02 PDT, 3 days before the 2026-05-11 14:28 UTC build). Git history confirms the producer call sites are in that commit. So either:

1. `npm run build` ran with stale incremental cache on session-adapter.ts (tsup uses esbuild which has aggressive caching) — re-run with `rm -rf dist node_modules/.cache && npm run build` to repro
2. The build script silently skipped session-adapter.ts (would be a `tsup` config or .gitignore bug)
3. The bundle was rebuilt manually via `--no-build` against a stale `dist/` (would be deploy-script user error)

**Recommended next step (separate quick task, not in 999.7 scope):** Force-rebuild locally with cache wipe, diff the produced `dist/cli/index.js` against the deployed bundle, identify the build invocation that produced the stale output, and re-deploy under operator confirmation. Until then, the split-latency dashboard panel on Phase 116 F07 cannot use these columns.

---

## Finding C — `clawcode tool-latency-audit` CLI returns `Error: Invalid Request`

**Severity:** Low — operator can fall back to direct SQLite read (this audit demonstrates the fallback works).
**Disposition:** Likely related to Finding B (or shares root cause with the build issue). Capture as informational; do NOT open a separate phase until Finding B is resolved — fixing the build may resolve this too.

### Evidence

- `clawcode tool-latency-audit --window-hours 168` from clawcode user via sudo → `Error: Invalid Request`
- The IPC method name `"tool-latency-audit"` IS present in the deployed bundle (10 occurrences, including the handler registration string at line 5xxx)
- The handler is described in 115-08 SUMMARY as using the "closure-intercept IPC pattern" routed BEFORE `routeMethod`. If the closure-intercept code wasn't in the build for the same reason session-adapter.ts wasn't, the request falls through to `routeMethod` which doesn't recognize the method → "Invalid Request"

This is consistent with the Finding B build issue. Verify after the build fix lands.

---

## Implications for Phase 116 F07 (tool latency split panel)

F07 in `116-CONTEXT.md` is "tool latency split panel (`tool_execution_ms` vs `tool_roundtrip_ms`)". Without Finding B fixed, F07 has two paths:

1. **F07 ships against `trace_spans`** (the per-tool execution data this audit used) — works today, no dependency on Finding B fix, but only shows `tool_call.<name>` durations, not the per-batch round-trip / split decomposition that 115-08 intended.
2. **F07 ships against the new `traces` columns** — needs Finding B fixed first, but delivers the full exec-vs-roundtrip side-by-side view that Phase 115 sub-scope 17 was designed for.

**Recommended for Phase 116's plan-phase:** Absorb a small "verify + fix Finding B" task as a F07 prerequisite, then ship F07 against the new columns. The dashboard panel design should surface BOTH the per-tool p95 (top tools by tail latency) AND the per-turn split (exec vs roundtrip). This audit's per-tool ranking tables can serve as design input for which tools F07 surfaces by default.

The audit identified ~10 tools per agent that account for the bulk of tail latency. F07's default view should probably show those by default with an "expand" affordance for the long-tail tools.

---

## What this audit does NOT close

- Whether the surprising local-file-tool slowness (Read/Edit/Grep at 200-400s p95) is real "tool execution overhead" or a quirk of the `tool_call.<name>` span semantics. Resolving this requires Finding B fixed so the split-latency columns can disambiguate exec from roundtrip.
- Whether Phase 115's actual perf interventions (excludeDynamicSections, tier-1 budget, lazy-recall, cache-breakpoint reorder) moved the needle on these numbers. The 168h window is 95% pre-115 + 5% post-115; need another 1-2 weeks of post-115 data for apples-to-apples.

Both questions are answered by Phase 115's wave-2-checkpoint / wave-4 perf-comparison reports, not by 999.7.

---

## Raw query archive

Queries used (reproducible against `/home/clawcode/.clawcode/agents/<agent>/traces.db`):

```sql
-- Per-tool p50/p95/p99 (168h)
WITH ranked AS (
  SELECT name, duration_ms,
    ROW_NUMBER() OVER (PARTITION BY name ORDER BY duration_ms) AS rn,
    COUNT(*) OVER (PARTITION BY name) AS n
  FROM trace_spans
  WHERE name LIKE 'tool_call.%' AND started_at > datetime('now','-168 hours')
)
SELECT name, MAX(n) AS n,
  CAST(MAX(CASE WHEN rn = CAST(n*0.5  AS INTEGER) THEN duration_ms END) AS INTEGER) AS p50_ms,
  CAST(MAX(CASE WHEN rn = CAST(n*0.95 AS INTEGER) THEN duration_ms END) AS INTEGER) AS p95_ms,
  CAST(MAX(CASE WHEN rn = CAST(n*0.99 AS INTEGER) THEN duration_ms END) AS INTEGER) AS p99_ms
FROM ranked GROUP BY name ORDER BY p95_ms DESC NULLS LAST LIMIT 20;

-- Split-latency populated turns since deploy (8h)
SELECT COUNT(*) AS turns,
  COUNT(tool_execution_ms) AS turns_with_split,
  COUNT(parallel_tool_call_count) AS turns_with_parallel,
  CAST(AVG(NULLIF(tool_execution_ms,0)) AS INTEGER) AS avg_exec_ms,
  CAST(AVG(NULLIF(tool_roundtrip_ms,0)) AS INTEGER) AS avg_roundtrip_ms
FROM traces WHERE started_at > datetime('now','-8 hours');
```
