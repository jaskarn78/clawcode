---
phase: 115-memory-context-prompt-cache-redesign
plan: 08
subsystem: performance
tags: [tool-latency, parallel-tool-call, tool-use-rate, sub-scope-6A-gate, sub-scope-17, premise-inversion]

# Dependency graph
requires:
  - phase: 115-memory-context-prompt-cache-redesign
    provides: Plan 115-00 opened the six 115-* column slots in traces.db migrateSchema. Plan 115-04 / 115-05 / 115-07 each filled their own slots without re-shipping migration code. Plan 115-08 adds three new column slots (tool_execution_ms / tool_roundtrip_ms / parallel_tool_call_count) using the same idempotent ALTER pattern.
  - phase: 50-perf-spans
    provides: TraceCollector + Turn span lifecycle with caller-owned end() and per-Turn buffered spans + writeTurn transaction. Plan 08 producers (addToolExecutionMs / addToolRoundtripMs / recordParallelToolCallCount) layer on top.
  - phase: 55-tool-cache
    provides: tool_call.<name> span lifecycle in session-adapter.ts iterateWithTracing — opens on assistant tool_use, closes on user message with parent_tool_use_id. Plan 08 T01's audit established that this timing is execution-side (NOT round-trip as the plan body asserted).
provides:
  - tool_execution_ms / tool_roundtrip_ms / parallel_tool_call_count traces.db column slots (sub-scope 17a/b producers)
  - Turn.addToolExecutionMs + Turn.addToolRoundtripMs + Turn.recordParallelToolCallCount producers (idempotent post-end no-op)
  - per-batch roundtrip timer in session-adapter.ts iterateWithTracing (opens on first tool_use of parent assistant; closes on next parent assistant arrival or run termination)
  - tool_use_rate_snapshots table + ToolUseRateSnapshot type + computeToolUseRatePerTurn / writeToolUseRateSnapshot / getLatestToolUseRateSnapshot TraceStore methods
  - getSplitLatencyAggregate TraceStore method (per-agent p50 over the per-turn split-latency columns + parallel rate)
  - PARALLEL-TOOL-01 directive (parallel-tool-calls key) — fleet-wide additive in DEFAULT_SYSTEM_PROMPT_DIRECTIVES, default-enabled, operator override wins via per-agent override schema
  - tool-latency-audit IPC handler in daemon.ts (loops resolvedAgents, computes per-agent + fleet non-fin-acq average + SHIP/DEFER decision)
  - clawcode tool-latency-audit CLI subcommand with --window-hours / --agent / --json options
  - GET /api/tool-latency-audit dashboard route + 4-line dashboard panel extension (split latency, tool_use_rate, parallel rate)
  - wave-2-checkpoint perf-comparison report skeleton with locked SHIP/DEFER decision logic + 30% threshold
affects: [115-09]

# Tech tracking
tech-stack:
  added:
    - traces.db tool_use_rate_snapshots table (per-agent rolling rate snapshots)
  patterns:
    - "Premise-inversion audit before producer wiring. T01's first action was to verify the plan body's assertion that the existing tool_call.<name> span measures full LLM round-trip. Code reading + advisor reconcile concluded the inverse: existing span IS execution-side. Architecture flipped from `rename existing to roundtrip + add execution alongside` to `keep existing as-is + add roundtrip alongside`. Locked in T01 commit as a Rule 3 deviation."
    - "Per-batch roundtrip timer (not per-tool). batchOpenedAtMs is single-slot — opens on first tool_use of a parent assistant message, closes on the NEXT parent assistant message. Multi-batch turns sum sequentially via Turn.addToolRoundtripMs. Parallel batches collapse to one wall-clock interval (correct semantic — `next parent assistant` arrives once after the LAST tool_result)."
    - "MAX (not SUM) for parallelToolCallCount across the turn. recordParallelToolCallCount(N) updates only when N > current. Sequential-only turns land 1; turns with at least one N-block parallel batch land N. Subsumes the > 0 'had any tool' check used by T02's tool_use_rate computation while preserving the parallel-vs-serial signal."
    - "Conditional spread on the 3 split-latency fields in Turn.end(). Gate is parallelToolCallCount > 0 — turns without tool_use blocks land NULL on all three columns so percentile rollups distinguish 'no tool calls this turn' from '0 ms execution / 0 batch size'."
    - "Snapshot table (separate from turns) for tool_use_rate. Plan body offered the option to back-write to a turn row; chose the separate tool_use_rate_snapshots table per advisor reconcile so the metric is independent of turn cadence. PRIMARY KEY (agent, computed_at) — INSERT OR REPLACE makes same-millisecond writes idempotent."
    - "Closure-intercept IPC handler pattern (mirrors 115-07 case cache). tool-latency-audit handler is routed BEFORE routeMethod so the 24-arg signature stays stable."
    - "Phase 999.1 / 999.22 locked-additive directive pattern for PARALLEL-TOOL-01. Default-enabled fleet-wide; operator override wins via per-agent systemPromptDirectiveOverrideSchema. Text scoped to 'mutually-orthogonal' lookups so dependent calls cannot regress."

key-files:
  created:
    - src/cli/commands/tool-latency-audit.ts
    - src/performance/__tests__/trace-collector-split-latency.test.ts
    - src/performance/__tests__/parallel-tool-call-counter.test.ts
    - src/performance/__tests__/tool-use-rate-per-turn.test.ts
    - .planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/wave-2-checkpoint.md
  modified:
    - src/performance/types.ts (added 3 OPTIONAL fields to TurnRecord — toolExecutionMs / toolRoundtripMs / parallelToolCallCount)
    - src/performance/trace-store.ts (extended additions array with 3 new INTEGER columns; added tool_use_rate_snapshots table to initSchema; added 4 prepared statements + 3 public methods + 1 ToolUseRateSnapshot type + getSplitLatencyAggregate; insertTrace 16-arg → 19-arg)
    - src/performance/trace-collector.ts (3 new producers on Turn — addToolExecutionMs / addToolRoundtripMs / recordParallelToolCallCount; conditional spread in Turn.end attaches the 3 fields when parallelToolCallCount > 0)
    - src/manager/session-adapter.ts (per-batch roundtrip timer batchOpenedAtMs in iterateWithTracing; pre-message scan calls recordParallelToolCallCount + opens timer; next parent assistant closes prior batch via addToolRoundtripMs; tool span end folds duration via addToolExecutionMs; closeAllSpans final-batch fallback)
    - src/manager/daemon.ts (tool-latency-audit IPC handler — resolvedAgents loop + per-agent computeToolUseRatePerTurn + getSplitLatencyAggregate + fleet non-fin-acq aggregation + SHIP/DEFER decision)
    - src/cli/index.ts (registerToolLatencyAuditCommand wiring)
    - src/dashboard/server.ts (GET /api/tool-latency-audit?windowHours=24[&agent] route)
    - src/dashboard/static/app.js (4 new subtitle lines on cache panel — split latency exec/roundtrip p50, tool_use_rate, parallel rate)
    - src/config/schema.ts (PARALLEL-TOOL-01 directive in DEFAULT_SYSTEM_PROMPT_DIRECTIVES — parallel-tool-calls key)
    - src/performance/__tests__/trace-store-115-columns.test.ts (extended PHASE_115_COLUMNS array + INTEGER type assertion + Phase115TurnColumns type test for the 3 new columns)
    - src/config/__tests__/schema-system-prompt-directives.test.ts (REG-DEFAULTS-PRESENT + REG-V25-BACKCOMPAT updated to 13-key list)
    - src/config/__tests__/loader.test.ts (LR-RESOLVE-DEFAULT-CONST-MATCHES exhaustive 13-key list — repaired pre-existing failure deferred from Plan 115-04 in passing)
    - .planning/phases/115-memory-context-prompt-cache-redesign/deferred-items.md (logged Plan 08 inline-fixed test updates + remaining clawcode.yaml-missing pre-existing failures)

key-decisions:
  - "Premise-inversion architecture: existing tool_call.<name> span at session-adapter.ts:1419-1514 is the EXECUTION timer (open on assistant tool_use emit, close on user message with parent_tool_use_id). T01's plan body asserted the inverse and proposed renaming to roundtrip; advisor + code-read confirmed the existing span IS execution. Decision: keep existing span as-is, ADD a separate per-batch roundtrip timer that opens at first tool_use of an assistant message and closes on the NEXT parent assistant message. The persisted column shape (tool_execution_ms / tool_roundtrip_ms) preserves the plan's INTENT — operators see exec vs roundtrip side-by-side; only the prose about which one is 'existing' was inverted."
  - "MAX semantics for parallel_tool_call_count (not SUM). recordParallelToolCallCount(N) updates only when N exceeds the current accumulator. Sequential-only turns land 1; turns with at least one N-block parallel batch land N. Subsumes the > 0 'had any tool' check used by T02's tool_use_rate_per_turn computation while preserving the sub-scope 17b parallel-vs-serial signal. Documented as a load-bearing decision in the parallel-tool-call-counter.test.ts comments."
  - "Per-batch (not per-tool) roundtrip timer. The single-slot batchOpenedAtMs in iterateWithTracing tracks ONE open batch at a time. Opens on the first tool_use block of a parent assistant message; closes when the next parent assistant message arrives. Parallel batches (3 tool_use blocks in one message dispatched in parallel) collapse to one wall-clock interval — the correct semantic because `next parent assistant` arrives once after the LAST tool_result. Multi-batch turns where the model emits sequential tool_use → tool_result → tool_use cycles accumulate via Turn.addToolRoundtripMs sums."
  - "Snapshot table over back-writing to turn rows (advisor reconcile). Plan body offered two paths for tool_use_rate persistence: (a) back-write to the latest turn's row in traces, or (b) separate tool_use_rate_snapshots table. Picked (b) so the metric is independent of turn cadence — back-writing would tie the rate to a turn that has nothing to do with it. Trade-off: gate query in daemon.ts loops resolvedAgents and calls computeToolUseRatePerTurn on the fly rather than reading a precomputed snapshot. This is fine because the per-agent rate computation is two simple COUNT queries; the snapshot table is for historical trend rendering on the dashboard (future panel extension)."
  - "Final-batch roundtrip fallback in closeAllSpans (defensive). If the SDK terminates mid-batch (error / abort / final result-only path), the next parent assistant never arrives and the open batch timer would otherwise be lost. closeAllSpans drains it via the same addToolRoundtripMs producer. Same pattern for execution-side: half-open tool spans (no tool_result arrived) get a best-effort duration computed from openedAtMs at termination so pathological turns don't undercount."
  - "Closure-intercept IPC pattern reused from Plan 115-07 case cache. The tool-latency-audit handler is routed BEFORE routeMethod so the 24-arg signature stays stable. The handler closes over `manager` and `resolvedAgents`, calls each agent's traceStore methods directly, and assembles the response without going through routeMethod. Mirrors the case cache / case search-tool-call / case browser-tool-call closure intercepts elsewhere in daemon.ts."
  - "30% threshold provenance + fin-acq exclusion locked in CLI + IPC + report. The threshold appears as a literal `0.3` in tool-latency-audit.ts (SUB_SCOPE_6B_THRESHOLD) and as `0.30` in the daemon IPC handler — both with comment block referencing CONTEXT D-12. fin-acquisition is excluded by name (string equality) at the IPC layer; the per-agent gate value renders 'fin-acq-excluded-from-gate (D-12)' in the CLI table. Both the literal `30%` text in the wave-2-checkpoint.md and the constant in code carry the D-12 provenance comment so any future operator who changes the threshold must touch all three sites."
  - "PARALLEL-TOOL-01 directive scoping to mutually-orthogonal lookups (threat model line 373). Directive text explicitly forbids batching DEPENDENT calls (Read B's path computed from Read A's content). Test fixtures pin the 'mutually-orthogonal' phrase as a static-grep regression marker. This is the THREAT-3 LOW mitigation — without the scoping, the directive could trigger regression where agents batch dependent calls in parallel and fail."
  - "Test-list completeness repair (passive-positive deviation). The pre-existing LR-RESOLVE-DEFAULT-CONST-MATCHES test in loader.test.ts had drifted off all post-Phase-99 directive additions (file expected 7, fleet shipped 12). Plan 08 added the 13th — completed the expected list to all 13 currently-shipped directives rather than restoring it to the broken-7-key state. Net positive: pre-existing-deferred failure converts into a passing test going forward. Logged in deferred-items.md."

patterns-established:
  - "Premise-inversion audit step BEFORE producer wiring. When a plan body asserts a property of existing code (e.g., 'this span measures full round-trip'), audit the assertion via code reading + isolated advisor reconcile BEFORE writing migration / producer code. T01's audit took ~10 minutes and prevented architecture lock-in to an inverted column shape that would have shipped buggy data to dashboards."
  - "Single-slot per-batch wall-clock timer with closeAllSpans fallback. The batchOpenedAtMs / addToolRoundtripMs producer pair is the canonical 'measure wall-clock between LLM emits → LLM resumes' shape; future plans can mirror it for any 'time spent waiting for the model to come back' metric."
  - "Conditional-spread NULL semantics on optional Turn columns (T01 + 115-05 + 115-07 mirror). When the producer's 0 value is meaningful but rare, the conditional spread `...(parallelToolCallCount > 0 ? { fields } : {})` makes the persisted SQL row land NULL on no-signal turns and a real number on real-signal turns. Percentile / rate aggregations distinguish 'no signal' from '0% / 0ms' which is critical for the gate semantics."

requirements-completed: []

# Metrics
duration: 41 min
completed: 2026-05-08
---

# Phase 115 Plan 08: Tool-latency methodology audit + parallel-tool-call instrumentation + tool_use_rate measurement

**Three deliverables in service of plan 115-09's sub-scope 6-B (1h-TTL direct-SDK fast-path) gate decision: split tool_call latency into execution-side and roundtrip-side per-turn columns (sub-scope 17a), parallel-tool-call counter + PARALLEL-TOOL-01 directive (sub-scope 17b/c), and per-agent rolling tool_use_rate snapshot table (sub-scope 6-A measurement). Wired through traces.db, the trace collector, the SDK iteration loop in session-adapter.ts, daemon IPC, the operator CLI, and the dashboard. Plan 115-09 reads the wave-2-checkpoint.md report this plan ships to decide SHIP vs DEFER on 6-B.**

## Performance

- **Duration:** 41 min
- **Started:** 2026-05-08T06:46:31Z
- **Completed:** 2026-05-08T07:27:00Z (approx)
- **Tasks:** 3 (T01–T03) atomic per-task commits + 0 deviation commits (deviations folded into the relevant task commits)
- **Files created:** 5
- **Files modified:** 12
- **New tests:** 26 (8 split-latency + 11 tool-use-rate + 8 parallel-tool-counter, plus the trace-store column test extended with 3 new column assertions)
- **Total commits:** 3 (cebc06c T01, ee1eefd T02, af5997b T03)

## Accomplishments

### T01 — Split tool latency methodology audit (sub-scope 17a/b producers)

The headline action of T01 was the **premise-inversion audit**. The plan body asserted that the existing `tool_call.<name>` span at `session-adapter.ts:1419-1514` measures full LLM round-trip (LLM emit-tool_use → LLM resumes). Code-reading concluded the inverse: the span opens on assistant `tool_use` emission and closes on user message with `parent_tool_use_id` (the SDK's tool_result delivery), so the timing IS the execution path (SDK dispatch + tool runtime + result delivery), NOT the LLM resume after.

That changed the architecture from "rename existing to roundtrip + add execution alongside" to "**keep existing as-is + add roundtrip as a NEW measurement**":

- **Three new traces.db columns** (idempotent additive migration, 3rd in the chain after 115-00 / 115-04 / 115-05 / 115-07):
  - `tool_execution_ms INTEGER NULL` — sum of `tool_call.<name>` span durations across the turn (execution side)
  - `tool_roundtrip_ms INTEGER NULL` — sum of per-batch wall-clock intervals (LLM emit-tool_use → next parent assistant message)
  - `parallel_tool_call_count INTEGER NULL` — MAX parallel batch size across the turn

- **Three Turn producers** (`addToolExecutionMs` / `addToolRoundtripMs` / `recordParallelToolCallCount`) with idempotent post-end no-op + 0/-ve guard. Conditional spread in `Turn.end()` (`parallelToolCallCount > 0` gate) attaches all three fields atomically — turns without tool_use blocks persist NULL on all three.

- **iterateWithTracing wiring** (`src/manager/session-adapter.ts` ~line 1383-1518): per-message `toolUseCount` scan calls `recordParallelToolCallCount`; opens batch timer on first tool_use of a parent assistant message; closes prior batch on next parent assistant arrival via `addToolRoundtripMs`. Tool span end folds duration via `addToolExecutionMs`. `closeAllSpans` provides final-batch fallback for SDK-terminated paths.

- **Tests:** `trace-collector-split-latency.test.ts` (8 cases — accumulation, MAX semantics, NULL on no-tool turns, post-end idempotency, 0/-ve guard, exec-roundtrip independence, type-alias check) + extended `trace-store-115-columns.test.ts` (3 new column assertions).

### T02 — tool_use_rate measurement gate (sub-scope 6-A) + PARALLEL-TOOL-01 directive (sub-scope 17c)

- **`tool_use_rate_snapshots` table** in traces.db with `(agent, computed_at, window_hours, turns_total, turns_with_tools, rate)` columns + PRIMARY KEY `(agent, computed_at)` so same-millisecond writes are idempotent. Index on `(agent, computed_at)` for fast latest-snapshot queries.

- **Three TraceStore public methods:**
  - `computeToolUseRatePerTurn(agent, sinceIso, windowHours)` — rolling-window math against `parallel_tool_call_count > 0` (T01's "had any tool" signal). Empty window returns rate=0 (not NaN); per-agent isolation via SQL WHERE.
  - `writeToolUseRateSnapshot(snap)` — INSERT OR REPLACE upsert. Idempotent.
  - `getLatestToolUseRateSnapshot(agent)` — ORDER BY computed_at DESC LIMIT 1; returns undefined for unknown agent.

- **PARALLEL-TOOL-01 directive** in `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` under the `parallel-tool-calls` key. Default-enabled fleet-wide. Text:
  > PARALLEL-TOOL-01: When you need to read multiple files, run multiple independent searches, or perform several mutually-orthogonal lookups, emit MULTIPLE parallel tool_use blocks IN A SINGLE assistant message rather than calling them sequentially [...]
  > DO NOT use this pattern when calls are dependent — if Read B's path is computed from Read A's content, those must stay sequential. Only batch mutually-orthogonal lookups.

  Static-grep regression markers pinned: `PARALLEL-TOOL-01` (id), `parallel tool_use blocks` (canonical phrase), `mutually-orthogonal` (scope guard for THREAT-3 mitigation).

- **Tests:** `tool-use-rate-per-turn.test.ts` (11 cases — empty window, rate=0.3 in 10 turns, window-bound exclusion, per-agent isolation, NULL vs 0 semantics, snapshot round-trip, ORDER BY computed_at, undefined for unknown agent, agent isolation in snapshot table, directive presence + override schema).

- **Test-list updates** (config schema/loader): `REG-DEFAULTS-PRESENT` + `REG-V25-BACKCOMPAT` extended to 13 directives. `LR-RESOLVE-DEFAULT-CONST-MATCHES` had drifted off all post-Phase-99 directive additions (expected 7, fleet shipped 12) — repaired in passing to the full 13-key list. Logged in `deferred-items.md` as a passive-positive deviation.

### T03 — CLI + IPC + dashboard + wave-2-checkpoint report

- **`clawcode tool-latency-audit` CLI** — operator-facing surface with `--window-hours <n>` (default 24), `--agent <name>` (filter), `--json` (machine-readable). Renders per-agent table with `tool_use_rate`, `tool_execution_ms p50`, `tool_roundtrip_ms p50`, `parallel_tool_call_rate`, and the per-agent gate column (one of `below-30%-threshold` / `above-30%-threshold` / `fin-acq-excluded-from-gate (D-12)` / `no-data`). Footer renders fleet non-fin-acq average + threshold + SHIP/DEFER decision.

- **`tool-latency-audit` IPC handler** (`src/manager/daemon.ts`) — closure-intercept pattern routed BEFORE `routeMethod`. Loops `resolvedAgents`, calls `traceStore.computeToolUseRatePerTurn` + `traceStore.getSplitLatencyAggregate` for each, computes fleet non-fin-acq average, returns `ToolLatencyAuditResponse` shape consumed by both CLI and dashboard.

- **`getSplitLatencyAggregate` TraceStore method** — nearest-rank p50 over the per-turn `tool_execution_ms` / `tool_roundtrip_ms` columns (T01 wrote them). `parallel_tool_call_rate` = fraction of in-window tool-bearing turns with parallel batch ≥ 2. Both p50s NULL when window has no signal; `parallelToolCallRate` NULL when `turnsWithToolsInWindow === 0`.

- **Dashboard** — `GET /api/tool-latency-audit?windowHours=24[&agent=name]` route in `src/dashboard/server.ts` (powers the CLI plus a future fleet-wide panel); 4 new subtitle lines on the per-agent cache panel body in `src/dashboard/static/app.js`:
  1. `split latency: exec p50 X ms · roundtrip p50 Y s` (or "no signal")
  2. `tool_use_rate: X% (sub-scope 6-A gate · 30% threshold)` (or "no signal")
  3. `parallel_tool_call_rate: X% (turns with batch ≥ 2)` (or "no signal")

  The four data fields (`tool_execution_ms_p50`, `tool_roundtrip_ms_p50`, `parallel_tool_call_rate`, `tool_use_rate`) flow to the panel via the existing `case "cache"` IPC handler (src/manager/daemon.ts:3411-3514) — augmented inside the same closure intercept already used to fold `tool_cache_size_mb_live`. The handler's `computeSplitLatencyFields(agentName, sinceIso)` helper calls `getSplitLatencyAggregate` + `computeToolUseRatePerTurn` per-agent and spreads the result onto the existing cache report. This means the dashboard's existing 30s `/api/agents/:name/cache` poll surfaces the new metrics without a second fetch round-trip.

- **`parallel-tool-call-counter.test.ts`** — 8 cases pinning the MAX semantics + post-end no-op + 0 batchSize handling + a wiring sentinel that asserts `recordParallelToolCallCount` / `addToolExecutionMs` / `addToolRoundtripMs` exist on Turn (catches a silent-no-op in `session-adapter.ts:1402` if these methods regress).

- **`wave-2-checkpoint.md`** — perf-comparison report skeleton at `.planning/phases/115-*/perf-comparisons/wave-2-checkpoint.md`. Contains:
  - Headline metrics table (pre-115 baseline / Wave-2 / Δ / target / status)
  - Per-agent tool_use_rate table (gate value for sub-scope 6-B)
  - Fleet non-fin-acq average row + threshold (30%) + decision token (`SHIP` if rate < 30% else `DEFER`)
  - Tool-latency methodology table (exec p50 / roundtrip p50 / difference / parallel_tool_call_rate)
  - Notes on PARALLEL-TOOL-01 directive expected effect on parallel rate

  Per CLAUDE.md + `feedback_no_auto_deploy` + `feedback_ramy_active_no_deploy`, this plan does NOT trigger a deploy. Numbers populate post-deploy via `clawcode tool-latency-audit --json`. Plan 115-09 reads this artifact + the underlying snapshot table to decide its sub-scope 6-B branch.

## Task Commits

Each task was committed atomically:

1. **T01: Split tool latency methodology audit** — `cebc06c` (feat) — premise inversion + 3 new columns + Turn producers + iterateWithTracing wiring + 8 split-latency tests + 3 column assertions in 115-columns test.
2. **T02: tool_use_rate measurement gate + PARALLEL-TOOL-01** — `ee1eefd` (feat) — snapshot table + 3 TraceStore methods + directive in DEFAULT_SYSTEM_PROMPT_DIRECTIVES + 11 rate tests + 3 directive-list updates in config tests.
3. **T03: tool-latency-audit CLI + IPC + dashboard + wave-2 checkpoint** — `af5997b` (feat) — CLI command + IPC handler + getSplitLatencyAggregate + dashboard route + 4 dashboard subtitle lines + 8 parallel-counter tests + wave-2-checkpoint.md skeleton.

## Files Created/Modified

### Created

- `src/cli/commands/tool-latency-audit.ts` — operator CLI subcommand with table + JSON output (175 lines).
- `src/performance/__tests__/trace-collector-split-latency.test.ts` — 8 cases pinning T01 producer semantics (190 lines).
- `src/performance/__tests__/parallel-tool-call-counter.test.ts` — 8 cases pinning sub-scope 17b MAX semantics + wiring sentinel (140 lines).
- `src/performance/__tests__/tool-use-rate-per-turn.test.ts` — 11 cases covering empty window, rate=0.3 in 10 turns, window-bound exclusion, per-agent isolation, snapshot round-trip, ORDER BY computed_at DESC, NULL vs 0 semantics, directive presence (300 lines).
- `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/wave-2-checkpoint.md` — perf-comparison report skeleton with locked SHIP/DEFER decision logic + 30% threshold + fin-acq exclusion (95 lines).

### Modified

- `src/performance/types.ts` — 3 new OPTIONAL fields on TurnRecord (toolExecutionMs / toolRoundtripMs / parallelToolCallCount), each with the conventional Phase-115-Plan-XX comment block.
- `src/performance/trace-store.ts` — 3 new INTEGER columns added to additions array (idempotent migration); tool_use_rate_snapshots CREATE TABLE in initSchema; 4 new prepared statements (countTotalTurnsInWindow / countTurnsWithToolsInWindow / insertToolUseRateSnapshot / latestToolUseRateSnapshot); 3 public methods (computeToolUseRatePerTurn / writeToolUseRateSnapshot / getLatestToolUseRateSnapshot); ToolUseRateSnapshot type export; getSplitLatencyAggregate method; 4 new entries in Phase115TurnColumns; insertTrace prepared statement extended 16 → 19 args.
- `src/performance/trace-collector.ts` — 3 new producers on Turn (addToolExecutionMs / addToolRoundtripMs / recordParallelToolCallCount); conditional spread in Turn.end attaches the 3 fields atomically when parallelToolCallCount > 0.
- `src/manager/session-adapter.ts` — per-batch roundtrip timer batchOpenedAtMs in iterateWithTracing; pre-message scan calls recordParallelToolCallCount + opens timer; next parent assistant arrival closes prior batch via addToolRoundtripMs; tool span end folds duration via addToolExecutionMs; closeAllSpans final-batch fallback for SDK-terminated paths.
- `src/manager/daemon.ts` — tool-latency-audit IPC handler — resolvedAgents loop + per-agent computeToolUseRatePerTurn + getSplitLatencyAggregate + fleet non-fin-acq aggregation + SHIP/DEFER decision + literal 0.3 threshold + fin-acquisition string-equality exclusion.
- `src/cli/index.ts` — registerToolLatencyAuditCommand wiring at the same level as registerToolCacheCommand.
- `src/dashboard/server.ts` — GET /api/tool-latency-audit?windowHours=24[&agent] route proxying to daemon IPC.
- `src/dashboard/static/app.js` — 4 new subtitle lines on cache panel; reads from report.tool_execution_ms_p50 / report.tool_roundtrip_ms_p50 / report.parallel_tool_call_rate / report.tool_use_rate; renders "no signal" / "—" when empty.
- `src/config/schema.ts` — PARALLEL-TOOL-01 directive in DEFAULT_SYSTEM_PROMPT_DIRECTIVES under parallel-tool-calls key with full text + threat model scoping comment.
- `src/performance/__tests__/trace-store-115-columns.test.ts` — extended PHASE_115_COLUMNS array, INTEGER type assertion, Phase115TurnColumns type test for the 3 new columns.
- `src/config/__tests__/schema-system-prompt-directives.test.ts` — REG-DEFAULTS-PRESENT + REG-V25-BACKCOMPAT updated to 13-key list.
- `src/config/__tests__/loader.test.ts` — LR-RESOLVE-DEFAULT-CONST-MATCHES extended to all 13 currently-shipped directives (fixes pre-existing failure deferred from Plan 115-04).
- `.planning/phases/115-memory-context-prompt-cache-redesign/deferred-items.md` — logged Plan 08 inline-fixed test updates + remaining clawcode.yaml-missing pre-existing failures.

## Decisions Made

1. **Premise-inversion architecture flip (Rule 3 deviation, locked in T01).** Existing `tool_call.<name>` span IS execution-side, not roundtrip — verified via code reading + advisor reconcile before any column was added. Architecture: keep existing span as-is, ADD a separate per-batch roundtrip timer as a new measurement. Persisted column shape preserves the plan's intent (operators see exec vs roundtrip side-by-side); only the prose about which metric is "existing" was inverted.

2. **MAX semantics for parallel_tool_call_count.** `recordParallelToolCallCount(N)` updates only when N exceeds the current accumulator. Sequential-only turns land 1; turns with any N-block parallel batch land N. Subsumes the > 0 "had any tool" check used by T02's tool_use_rate computation while preserving the sub-scope 17b parallel-vs-serial signal.

3. **Per-batch (not per-tool) roundtrip timer.** Single-slot `batchOpenedAtMs` tracks ONE open batch at a time. Parallel batches collapse to one wall-clock interval — correct because `next parent assistant` arrives once after the LAST tool_result. Multi-batch turns accumulate via `Turn.addToolRoundtripMs` sums.

4. **Snapshot table over back-writing to turn rows (advisor reconcile).** Plan body offered both paths; chose `tool_use_rate_snapshots` table so the metric is independent of turn cadence. Trade-off: gate query loops resolvedAgents and computes on the fly rather than reading a precomputed snapshot — fine because the per-agent rate computation is two simple COUNT queries; the snapshot table is for historical trend rendering (future panel extension).

5. **Final-batch roundtrip fallback in closeAllSpans (defensive).** If the SDK terminates mid-batch, the next parent assistant never arrives. closeAllSpans drains the open batch timer via the same `addToolRoundtripMs` producer. Same pattern for execution-side: half-open tool spans get a best-effort duration computed from openedAtMs at termination.

6. **Closure-intercept IPC pattern (mirrors 115-07 case cache).** tool-latency-audit handler routed BEFORE routeMethod so the 24-arg signature stays stable. Closes over manager + resolvedAgents.

7. **30% threshold + fin-acq exclusion locked in three places (CLI + IPC + report).** Any future operator changing the threshold must touch all three sites, each carrying the D-12 provenance comment.

8. **PARALLEL-TOOL-01 scoped to mutually-orthogonal lookups (THREAT-3 mitigation).** Directive text explicitly forbids batching DEPENDENT calls; "mutually-orthogonal" pinned as a static-grep regression marker.

9. **Test-list completeness repair (passive-positive deviation).** Pre-existing LR-RESOLVE-DEFAULT-CONST-MATCHES had drifted off post-Phase-99 directives (file expected 7, fleet shipped 12). Plan 08 added the 13th — completed expected list to 13 rather than restoring the broken-7-key state. Net positive.

## Deviations from Plan

### Rule 3 — Plan reference correction (T01 premise inversion)

**Found during:** T01 audit, before any column was added.
**Issue:** Plan body T01 step 1 asserted that the existing `tool_call.<name>` span at `session-adapter.ts:1419-1514` measures full LLM round-trip. Code reading + advisor reconcile confirmed the inverse: existing span IS execution-side (open on assistant tool_use emit, close on user message with parent_tool_use_id which is the tool_result delivery).
**Fix:** Architecture flipped from "rename existing to roundtrip + add execution alongside" to "keep existing as-is + add roundtrip as a NEW measurement." Persisted column shape (tool_execution_ms / tool_roundtrip_ms) preserves the plan's INTENT — operators see exec vs roundtrip side-by-side; only the prose about which one is "existing" was inverted. Documented inline in T01 commit message + this SUMMARY's "Premise-inversion architecture" key decision.
**Files modified:** Same as T01 plan (src/performance/trace-store.ts, types.ts, trace-collector.ts, src/manager/session-adapter.ts).
**Commit:** `cebc06c`.

### Rule 1 — Pre-existing test repair in passing (T02 directive landing)

**Found during:** T02 directive addition triggered the directive-count tests.
**Issue:** `LR-RESOLVE-DEFAULT-CONST-MATCHES` in `loader.test.ts` was failing on master HEAD before Plan 08 began (file expected 7 directives, fleet shipped 12). Documented as a deferred item from Plan 115-04. Adding `parallel-tool-calls` would have made it 13.
**Fix:** Repaired the test to the full 13-key list of currently-shipped directives rather than restoring it to the broken-7-key state. Net positive: pre-existing-deferred failure converts to a passing test.
**Files modified:** `src/config/__tests__/loader.test.ts`, `.planning/phases/115-*/deferred-items.md`.
**Commit:** `ee1eefd`.

## Genuinely Pre-existing Failures NOT Touched

Per the scope-boundary rule, the following pre-existing failures were left alone (out of scope for Plan 08):

| Test file | Test | Notes |
|---|---|---|
| `src/config/__tests__/schema.test.ts` | `PR11: parse-regression` | Needs in-tree `clawcode.yaml` not present in workspace tree. Same as Plan 115-04. |
| `src/config/__tests__/clawcode-yaml-phase100*.test.ts` | suite-level | Same missing `clawcode.yaml`. |

Logged in `.planning/phases/115-memory-context-prompt-cache-redesign/deferred-items.md` for future cleanup.

## Verification

- [x] `npx tsc --noEmit` — clean
- [x] `npm run build` — clean (ESM dist/cli/index.js 2.37 MB)
- [x] All 137 perf tests pass
- [x] All 172 config schema/loader tests pass
- [x] T01 acceptance: `grep -n "tool_execution_ms\|tool_roundtrip_ms" src/performance/trace-store.ts` returns ≥4 (returns 22)
- [x] T01 acceptance: `grep -n "parallel_tool_call_count" src/performance/trace-store.ts` returns ≥2 (returns 15)
- [x] T01 acceptance: `grep -n "addToolExecutionMs\|recordParallelToolCallCount" src/performance/trace-collector.ts` returns ≥2 (returns 4)
- [x] T01 acceptance: `grep -n "PRAGMA table_info" src/performance/trace-store.ts` returns ≥3 (returns 4)
- [x] T01 acceptance: trace-collector-split-latency.test.ts exists + passes
- [x] T02 acceptance: `grep -n "computeToolUseRatePerTurn\|tool_use_rate_snapshots" src/performance/trace-store.ts` returns ≥1 (returns 8)
- [x] T02 acceptance: `grep -n "tool_use_rate" src/performance/trace-store.ts` returns ≥2 (returns 7)
- [x] T02 acceptance: tool-use-rate-per-turn.test.ts exists + passes
- [x] T02 acceptance: `grep -n "PARALLEL-TOOL-01\|parallel.*tool" src/config/schema.ts` returns ≥1 (returns 7)
- [x] T03 acceptance: src/cli/commands/tool-latency-audit.ts exists
- [x] T03 acceptance: `grep -n "tool-latency-audit" src/manager/daemon.ts` returns ≥1 (returns 3)
- [x] T03 acceptance: `grep -n "tool_execution_ms\|tool_roundtrip_ms\|parallel_tool_call_rate\|tool_use_rate" src/dashboard/static/app.js` returns ≥3 (returns 15)
- [x] T03 acceptance: parallel-tool-call-counter.test.ts exists + passes
- [x] T03 acceptance: `clawcode tool-latency-audit --help` exits 0
- [x] T03 acceptance: wave-2-checkpoint.md exists
- [x] T03 acceptance: `grep -n "fleet non-fin-acq avg\|6-B gate\|SHIP\|DEFER" .planning/phases/115-*/perf-comparisons/wave-2-checkpoint.md` returns ≥2 (returns 4+)
- [x] Verification: 30% gate threshold documented — `grep -n "30%\|0.30\|0.3" src/cli/commands/tool-latency-audit.ts` returns ≥1 (multiple)
- [x] Verification: PARALLEL-TOOL-01 system-prompt directive landed — `grep -n "PARALLEL-TOOL-01\|parallel.*tool_use blocks" src/config/schema.ts` returns ≥1

## Live Coverage

**Producer wiring landed in this plan (sub-scope 17a/b):**

| Producer | Caller | When Fires |
|---|---|---|
| `Turn.recordParallelToolCallCount(toolUseCount)` | `session-adapter.ts:1428` (was 1402 pre-edit) | Per parent assistant message with ≥1 tool_use block |
| `Turn.addToolExecutionMs(durationMs)` | `session-adapter.ts:1531` (in user message branch, on tool_result delivery) | Per tool span close |
| `Turn.addToolRoundtripMs(durationMs)` | `session-adapter.ts:1418, 1393` (in assistant branch, on next parent message) + `closeAllSpans` (final-batch fallback) | Per parent-assistant boundary |
| `TraceStore.computeToolUseRatePerTurn(agent, sinceIso, windowHours)` | `daemon.ts:tool-latency-audit handler`, called per-agent | On every CLI / dashboard fetch |
| `TraceStore.getSplitLatencyAggregate(agent, sinceIso)` | `daemon.ts:tool-latency-audit handler`, called per-agent | On every CLI / dashboard fetch |

**Consumer surfaces:**

| Surface | Reads From | Renders |
|---|---|---|
| `clawcode tool-latency-audit` | IPC `tool-latency-audit` | per-agent table + fleet gate decision |
| Dashboard cache panel | `GET /api/tool-latency-audit` | 4 subtitle lines |
| Plan 115-09 sub-scope 6-B gate | `wave-2-checkpoint.md` table OR `traces.db.tool_use_rate_snapshots` | SHIP/DEFER decision |

## Threats Mitigated

| Threat | Severity | Mitigation Landing |
|---|---|---|
| Trace-collector audit misclassifies metrics, biasing 6-B gate | HIGH | T01 audit verified existing span semantics by code reading + advisor reconcile; tests pin both metrics; plan 115-09 reads BOTH the audit CLI output AND the underlying table |
| 30% threshold is wrong (Claude pick) | MEDIUM | Threshold appears as `0.3` constant in CLI + `0.30` in IPC handler with D-12 provenance comments; plan 115-09 may refine; 6-B path is reversible (config flag toggle); wave-2-checkpoint.md notes the threshold is a knob |
| Parallel-tool-call directive triggers regression on dependent sequences | LOW | Directive text scoped to "mutually-orthogonal" lookups; "mutually-orthogonal" pinned as static-grep regression marker; tests cover the canonical phrase |
| Wave-2-checkpoint report leaks operator-private fleet topology | LOW | Report contains aggregate per-agent metrics only (no message content, no API keys); .planning/ is in repo per existing convention |

## Self-Check: PASSED

- [x] Created files exist:
  - `src/cli/commands/tool-latency-audit.ts` ✓
  - `src/performance/__tests__/trace-collector-split-latency.test.ts` ✓
  - `src/performance/__tests__/parallel-tool-call-counter.test.ts` ✓
  - `src/performance/__tests__/tool-use-rate-per-turn.test.ts` ✓
  - `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/wave-2-checkpoint.md` ✓
- [x] Commits exist on `master`:
  - `cebc06c` (T01) ✓
  - `ee1eefd` (T02) ✓
  - `af5997b` (T03) ✓
- [x] All acceptance criteria from plan body verified (see Verification section above)
- [x] All 317 perf + config-related tests pass
- [x] `npx tsc --noEmit` clean
- [x] `npm run build` clean
- [x] CLI registered: `clawcode tool-latency-audit --help` exits 0
