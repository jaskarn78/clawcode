---
phase: 116
plan: 05
title: Fleet-scale + cost — F16 comparison table, F17 cost dashboard, path-based nav, opportunistic drawer extras
subsystem: dashboard
tags: [dashboard, spa, react, shadcn, recharts, fleet-table, cost-dashboard, csv-export, escalation-budget, path-routing, drawer-enrichment, lazy-loading]
completed: 2026-05-11
duration_minutes: ~50
tasks_completed: 2
files_modified:
  - src/usage/types.ts (+18 lines — CostByDay type)
  - src/usage/tracker.ts (+24 lines — getCostsByDay method + prepared stmt)
  - src/manager/daemon.ts (+125 lines, contiguous "Phase 116-05" closure-intercept block right after the 116-04 fence)
  - src/dashboard/server.ts (+44 lines, contiguous "=== Phase 116-05 routes ===" block + SPA-fallback heuristic)
  - src/ipc/protocol.ts (+15 lines — 2 new IPC method names + docstring)
  - src/ipc/__tests__/protocol.test.ts (+3 lines — pin extended)
  - src/dashboard/client/src/App.tsx (REWRITTEN, ~200 lines — view enum extended; pushState/popstate path sync; CostDashboard lazy import; nav strip rewired)
  - src/dashboard/client/src/components/AgentDetailDrawer.tsx (+4 lines — DrawerExtras mount in right column)
  - src/dashboard/client/src/hooks/useApi.ts (+87 lines — useCosts/useCostsDaily/useBudgets + 4 exported types)
  - src/dashboard/client/src/components/FleetComparisonTable.tsx (NEW, ~510 lines)
  - src/dashboard/client/src/components/CostDashboard.tsx (NEW, ~445 lines — LAZY)
  - src/dashboard/client/src/components/DrawerExtras.tsx (NEW, ~195 lines)
  - src/dashboard/client/src/components/ui/table.tsx (NEW, ~130 lines — shadcn Table primitive)
autonomous: true
dependency_graph:
  requires:
    - 116-00 (shadcn UI primitives + Tailwind theme tokens + Vite SPA toolchain)
    - 116-01 (AgentTile pattern reused for F16 row data — same useAgentCache/useAgentLatency surface)
    - 116-04 (AgentDetailDrawer right-column slot reused for SloSegmentGauges + CostSummaryCard)
    - Phase 1.5 cost-tracker (UsageTracker.getCostsByAgentModel + new getCostsByDay)
    - Phase 6a EscalationBudget infrastructure (token-typed budget limits per agent per model per period)
    - Phase 50 latency segments (TraceStore.getPercentiles per-segment p95)
    - Phase 116-03 conversation-turn SSE bus (transcript live indicator still flows through the drawer unchanged)
  provides:
    - F16 FleetComparisonTable — sortable shadcn Table at /dashboard/v2/fleet; status/model/SLO breach filters; CSV export client-side
    - F17 CostDashboard — anomaly banner + spend cards + 30d trend chart (toggle agent/model stack) + linear projection + per-model donut + token budget gauges; LAZY-LOADED via React.lazy()
    - 2 new IPC methods (costs-daily, budget-status) in the "Phase 116-05" closure-intercept block
    - 2 new REST routes (/api/costs/daily, /api/budgets) in the "=== Phase 116-05 routes ===" fence
    - 1 new UsageTracker method (getCostsByDay) + CostByDay type
    - Path↔view sync in App.tsx (pushState + popstate; 5-route map; nav strip)
    - SloSegmentGauges + CostSummaryCard drawer extras (F02 per-segment + F17 24h spend, both forward-pointed from 116-04)
    - shadcn Table primitive (reusable for future tabular surfaces — task listings, MCP server tables, etc.)
  affects:
    - 116-06 (Tier 3 polish) — can append routes/IPC inside its own "=== Phase 116-06 routes ===" block immediately after the 116-05 fence; the new path↔view layer makes adding new full-page surfaces a single VIEW_TO_PATH map entry + a new enum value
    - Future plans — the lazy-loading pattern (React.lazy on the route component, Suspense fallback in App.tsx) is now the canonical way to add a heavy view without growing the eager bundle
tech_stack:
  added: []  # No new top-level deps — recharts (3.8.1), @radix-ui/react-dialog, @tanstack/react-query all already in package.json
  patterns:
    - Contiguous-block routes (continued) — "=== Phase 116-05 routes ===" block in src/dashboard/server.ts appended immediately after the 116-04 fence so 116-06 can extend without touching this diff
    - Contiguous-block daemon IPC (continued) — closure-intercept block in src/manager/daemon.ts labeled "Phase 116-05 — Fleet-scale + cost IPC handlers" houses both new handlers
    - SPA route-level code splitting — CostDashboard is the heaviest of the new content (~70KB raw of recharts AreaChart + PieChart + their dependencies once you trace through the recharts split). Lazy-loaded via React.lazy() from the FIRST commit; lands as a 40.34KB / 11.37KB-gzip separate chunk that only loads when the operator navigates to /dashboard/v2/costs. Vite also extracted a NEW shared `useApi` chunk (44.77KB / 12.12KB gzip) that AgentDetailDrawer + FleetComparisonTable + the cost route all import — this counts toward cold load via modulepreload. Real apples-to-apples cold-load: 924.66KB raw / ~280KB gzip (index + useApi), vs 906.90/275.77 at end of 116-04 = +18KB raw / +5KB gzip for two new full-page surfaces + drawer enrichments. Plan budget (1MB raw / 320KB gzip) honored with headroom.
    - Client-side CSV serialization — F16 CSV export builds the string via Blob + URL.createObjectURL + temporary <a download>. Zero server round-trip, zero per-cell PII transit, no new daemon load
    - Path↔view sync without router — pushState + popstate listener with two maps (PATH_TO_VIEW / VIEW_TO_PATH). Adds a single full-page surface in O(2 lines). Documented as the pattern 116-06 should follow rather than wholesale switching to react-router
    - SPA-fallback heuristic in the catch-all static handler — paths under /dashboard/v2/<x> with NO file extension serve index.html (SPA route); paths WITH extensions keep strict-404 behavior so stale-build issues remain operator-visible
    - Token-typed budget surface — F17 budget gauges report TOKENS, not USD. AgentBudgetConfig is token-typed by schema. Converting to USD would need per-model pricing lookups per row; we keep the dashboard token-native and label the gauge row clearly so the unit mismatch is visible
    - Per-row hook fan-out for F16 — Each FleetRow owns its own useAgentCache/useAgentLatency hooks and reports the normalized RowData up via a JSON-keyed useEffect. Parent owns sort + CSV state; rows own their own loading semantics. Avoids a giant fleet-wide aggregation endpoint
    - Linear regression projection with guard — Cost dashboard's month-end projection requires ≥14 days of buckets; below that, the card renders "insufficient data — gather 14d for projection" rather than a misleading extrapolation from sparse data
    - Anomaly threshold floor — Anomaly banner suppressed when <5 days of buckets exist. Same anti-false-positive logic as the projection guard but at a lower threshold
key_files:
  created:
    - src/dashboard/client/src/components/FleetComparisonTable.tsx
    - src/dashboard/client/src/components/CostDashboard.tsx
    - src/dashboard/client/src/components/DrawerExtras.tsx
    - src/dashboard/client/src/components/ui/table.tsx
  modified:
    - src/usage/types.ts (CostByDay type)
    - src/usage/tracker.ts (getCostsByDay method)
    - src/manager/daemon.ts ("Phase 116-05" closure-intercept block)
    - src/dashboard/server.ts ("=== Phase 116-05 routes ===" block + SPA-fallback)
    - src/ipc/protocol.ts (+2 IPC_METHODS entries)
    - src/ipc/__tests__/protocol.test.ts (pin extended)
    - src/dashboard/client/src/App.tsx (view enum + path sync + lazy CostDashboard)
    - src/dashboard/client/src/components/AgentDetailDrawer.tsx (right-column extras mount)
    - src/dashboard/client/src/hooks/useApi.ts (+3 hooks + 4 types)
decisions:
  - F17 budget gauges report TOKENS, not USD. AgentBudgetConfig (src/usage/budget.ts:9-18) is token-typed: `daily.{sonnet,opus}` and `weekly.{sonnet,opus}` are token counts. The cost dashboard would need to convert to USD via lookupPricing() per row to harmonize with the spend cards. We keep the contract token-native and render the gauges on a row distinct from the USD spend cards, with a "Units: tokens" subtitle on the gauges section. Operators see both signals without conflation. A future plan can add a USD overlay if operator demand surfaces.
  - F17 cost trend window is UTC-aligned (date(timestamp) in SQLite). Operator timezone is NOT applied to the bucket boundaries. Reason: the dashboard surface is for trend reading, not accountancy reconciliation. UTC-aligned 30-day window is exactly 30 buckets regardless of operator timezone, which keeps the linear projection math stable. Documented in the CostByDay type docstring.
  - F17 trend `costs-daily` IPC iterates `manager.getRunningAgents()` only — same scope as the existing `costs` handler. UsageTracker instances close on stopAgent; rebuilding them for historical reads on stopped agents would mean opening usage.db from disk + caching. Out of scope for 116-05; documented as a 116-06 forward-pointer. Operators viewing a 30d trend for a stopped agent will see zero rows — restart the agent to surface its historical data.
  - F16 fleet table renders one row per agent emitted by /api/status (the canonical fleet enumeration). Per-row data is fetched by per-agent useAgentCache + useAgentLatency hooks INSIDE each FleetRow — NOT a giant fleet-wide aggregation endpoint. Reason: the daemon already serves these endpoints with caching, and per-row hooks let TanStack Query handle staleness/invalidation independently. The aggregated RowData reports up to the parent via JSON-keyed useEffect for sort+CSV.
  - F16 IPC delivery success rate is a FOOTER stat, not a per-row column. Reason: DeliveryQueue.getStats() is fleet-wide (Discord-outbound only), not per-agent — same surface adjustment documented in 116-04's F13 SUMMARY. Per-agent IPC delivery rate would need a new schema (cross-agent IPC log table, forward-pointed from 116-04). The footer surface preserves the must-have ("IPC delivery success rate visible on the page") without inventing fake per-agent data.
  - F16 MCP error count + 7d dream count columns OMITTED from the table. Plan listed them but: (a) MCP errors land in per-server state via useMcpServers — fleet-wide rollup would need a new aggregation; (b) 7d dream count requires per-agent useDreamQueue calls which return file-system-scanned data (not in a fleet-wide cache). Both are visible in the drawer (F10 MCP panel + F15 DreamQueue) — a "click agent → see drawer" affordance preserves the surface without a column that returns "—" for most agents. Documented as a deferred-but-reachable detail.
  - F17 cost dashboard lazy-loaded via React.lazy() FROM THE FIRST COMMIT (not as a later bundle-size fix). Same pattern as 116-04's TraceWaterfall. Result: CostDashboard-D9FZuuDQ.js is a 40.34KB / 11.37KB-gzip separate chunk; the eager index chunk actually SHRANK from 906.90KB to 879.89KB because Vite's tree-shaker pushed shared dependencies (recharts internals, chart helpers) into the lazy chunk.
  - F16 CSV export is CLIENT-SIDE via Blob + URL.createObjectURL + temporary <a download>. No server round-trip, no per-cell PII transit. Filename pattern: clawcode-fleet-<YYYY-MM-DD>.csv. UTF-8 encoding, RFC 4180-ish escaping (double-quote any field containing comma/quote/newline; escape internal quotes by doubling).
  - F17 anomaly threshold = 2× locked from CONTEXT — NOT relitigated. Suppressed when <5 days of buckets exist (anti-false-positive on fresh installs).
  - F17 month-end projection requires ≥14 days of buckets. When fewer, the card renders "insufficient data — gather 14d for projection" with a per-day-count subtitle ("4/14 so far") rather than misleading extrapolation. Threshold from plan must-haves.
  - F17 anomaly + projection are CLIENT-SIDE — they compute over the same `costs-daily` payload that drives the trend chart. No new backend surface for anomaly detection. Reason: the threshold (2×) and projection horizon (calendar month) are operator-tunable in spirit; pushing computation to the client lets a future plan add a settings panel that adjusts these without daemon changes.
  - Path↔view sync uses pushState + popstate, NOT react-router. Reason: zero new top-level deps; the existing view-state enum just needs (a) two path mapping consts and (b) a 6-line popstate listener. react-router would be ~50KB of additional bundle for a 5-route surface where every route is mounted-but-hidden via `view === 'x'` conditional rendering. Documented as the pattern 116-06 should follow.
  - Current view enum value 'fleet' (= AgentTile grid) RENAMED to 'dashboard' so the new 'fleet' identifier is free for the F16 comparison table. The Tier 1 grid surface is unchanged; only the enum label moved. Nav strip now reads: Dashboard / Fleet / Costs / Conversations / Tasks.
  - SPA-fallback in the catch-all static handler — paths under /dashboard/v2/<x> with NO file extension serve index.html (SPA route); paths WITH extensions keep strict-404 behavior. Reason: stale-build issues (e.g. font file missing) should remain operator-visible as 404s, but client routes (no extension) should always reach the SPA so deep-linking to /dashboard/v2/fleet works on first load.
  - F02 per-segment SLO gauges + F17 24h cost summary mounted in the AgentDetailDrawer right column (above MemoryPanel/IpcInbox/DreamQueue) via a NEW DrawerExtras.tsx — not by editing AgentDetailDrawer directly. Reason: keeps the 116-04 drawer file's diff minimal (one import + one extras mount) and gives a future plan a single file to extend for additional enrichments without re-reading the transcript/header logic.
  - F04 7-day sparkline INTENTIONALLY DEFERRED to 116-06 per advisor triage. It needs a new per-agent timeline endpoint (turn-count-per-day or first-token-p50-per-day buckets) that 116-04 explicitly flagged as missing. Documented in DrawerExtras.tsx top comment.
metrics:
  # Vite split the bundle into three eager-ish chunks (index + useApi shared)
  # and two lazy chunks (CostDashboard, TraceWaterfall). For an apples-to-
  # apples cold-load comparison with 116-04's single index chunk, sum the
  # eager surfaces (index + useApi): both are pulled at cold load via
  # <link rel=modulepreload>.
  bundle_js_kb_index_chunk: 879.89          # was 906.90 at end of 116-04
  bundle_js_gzip_kb_index_chunk: 267.88     # was 275.77 at end of 116-04
  bundle_js_kb_use_api_chunk: 44.77         # NEW shared chunk this plan; eager
  bundle_js_gzip_kb_use_api_chunk: 12.12
  bundle_js_kb_eager_cold_load: 924.66      # index + useApi = real cold-load surface
  bundle_js_gzip_kb_eager_cold_load: 280.00 # +18KB raw / +5KB gzip vs 116-04 — within budget
  bundle_js_kb_cost_dashboard_chunk: 40.34  # LAZY — not in cold-load count
  bundle_js_gzip_kb_cost_dashboard_chunk: 11.37
  bundle_js_kb_trace_waterfall_chunk: 3.65  # LAZY — unchanged from 116-04
  bundle_js_gzip_kb_trace_waterfall_chunk: 1.55
  bundle_css_kb: 30.08  # was 29.06 at end of 116-04
  bundle_css_gzip_kb: 6.46  # was 6.26 at end of 116-04
  components_added: 4  # FleetComparisonTable, CostDashboard, DrawerExtras (with 2 sub-components), Table (ui primitive)
  hooks_added: 3  # useCosts, useCostsDaily, useBudgets
  routes_added: 2  # /api/costs/daily, /api/budgets
  ipc_methods_added: 2  # costs-daily, budget-status
  tracker_methods_added: 1  # getCostsByDay
  spa_routes_added: 2  # /dashboard/v2/fleet, /dashboard/v2/costs
  commits: 2
---

# Phase 116 Plan 05 Summary

**One-liner:** Two new top-level SPA surfaces (F16 sortable+filterable+CSV-exportable fleet comparison table at /dashboard/v2/fleet; F17 lazy-loaded cost dashboard at /dashboard/v2/costs with today/week/month spend cards, 30d stacked-area trend chart with linear month-end projection, anomaly banner at the 2× CONTEXT threshold, per-model donut, and TOKEN-units EscalationBudget gauges) wired against 2 new REST routes + 2 new IPC handlers + 1 new UsageTracker method — all inside contiguous `=== Phase 116-05 ===` blocks that 116-06 can append after without touching this plan's diff, PLUS a path↔view sync layer that lets the SPA handle /dashboard/v2/{fleet,costs,...} deep links via pushState+popstate (zero new deps), PLUS opportunistic AgentDetailDrawer right-column enrichments (F02 per-segment SLO gauges + F17 24h cost summary) forward-pointed from the 116-04 SUMMARY — and a Vite build that lands the new surface at 924.66KB raw / 280KB gzip cold-load (index + eager-shared useApi chunk, vs 906.90/275.77 at end of 116-04 = +18KB raw / +5KB gzip) plus a 40.34KB lazy chunk that only loads when the operator navigates to /dashboard/v2/costs.

## Tasks Executed

| Task | Commits | Description |
|------|---------|-------------|
| T01 backend  | `64824d4` | UsageTracker.getCostsByDay + CostByDay type. New "Phase 116-05" closure-intercept block in daemon.ts with costs-daily (per-day cost trend, UTC date-aligned, 1..90 day window) + budget-status (EscalationBudget tokens vs limit per agent per model per period). New "=== Phase 116-05 routes ===" fence in server.ts with GET /api/costs/daily + GET /api/budgets. Two IPC_METHODS entries in protocol.ts with documenting comment. Pinning test extended. Backend typecheck clean; 158/158 ipc+usage tests pass. |
| T02 frontend | `6ae6e74` | FleetComparisonTable.tsx (eager — sortable shadcn Table, status/model/SLO filters, client-side CSV export). CostDashboard.tsx (LAZY — anomaly banner, three spend cards, stacked AreaChart with agent/model toggle, linear projection card with ≥14d guard, PieChart per-model donut, token budget gauges row). DrawerExtras.tsx (SloSegmentGauges + CostSummaryCard mounted in the AgentDetailDrawer right column). ui/table.tsx (vendored shadcn Table primitive). App.tsx rewritten with extended view enum + path↔view sync (pushState/popstate, 5-route map) + nav strip. server.ts SPA-fallback heuristic for extensionless paths under /dashboard/v2/. 3 new useApi hooks + 4 types. Vite build clean. 301/301 dashboard+performance+ipc tests pass. |

## Must-haves

| # | Clause | Status | Rationale |
|---|--------|--------|-----------|
| 1 | F16 fleet table sortable across all columns; CSV export downloads valid CSV with all visible rows; filters by status/model/SLO breach work correctly | **SATISFIED** | SortHead components on every column header flip sortKey/sortDir on click (and on Enter/Space for keyboard accessibility). null values sort to bottom regardless of direction so SLO-breach hunting isn't polluted by no-data rows. CSV export builds RFC 4180-ish UTF-8 string via Blob + URL.createObjectURL + temporary <a download>; filename = `clawcode-fleet-<YYYY-MM-DD>.csv`. CSV header columns: agent, status, model, first_token_p50_ms, first_token_slo_threshold_ms, end_to_end_p95_ms, tool_cache_hit_rate, tier1_budget_pct, daily_cost_usd. FilterBar above the table drives client-side filtering: status (all/running/stopped/errored maps to status+active vs errored+crashed vs stopped+idle), model (substring match on agent.model.toLowerCase()), SLO breach (warn+danger vs primary). Filter changes reflect immediately in both the rendered table AND the CSV (CSV exports the VISIBLE rows only — operators get exactly what they see). |
| 2 | F17 cost dashboard shows today/7d/30d totals + per-agent + per-model + trend chart + anomaly alert (>2× 30d avg) | **SATISFIED** | Three SpendCard components driven by independent useCosts('today'), useCosts('week'), useCosts('month') queries — each renders the daemon's canonical aggregate. Trend chart is a Recharts stacked AreaChart over /api/costs/daily; toggle stacks by agent or by model (state-driven, no re-fetch). Per-model donut is a Recharts PieChart over the same payload reduced via modelBucket(). AnomalyBanner fires when today's total > 2× the 30-day daily average (locked from CONTEXT; suppressed when <5 days of buckets exist). The today/7d/30d cards use the daemon's existing /api/costs?period= which already covers exactly that switch. |
| 3 | F17 budget gauges read from EscalationBudget infrastructure | **SATISFIED (TOKEN UNITS — see decision above)** | budget-status IPC reads escalationBudget (daemon-scope singleton, src/manager/daemon.ts:2469) + budgetConfigs (per-agent AgentBudgetConfig map, daemon.ts:2472). Iterates over budgetConfigs.entries() and for each (period, model) where a token limit is configured, calls escalationBudget.getUsageForPeriod(agent, model, period) (the same method EscalationBudget uses for canEscalate). Status mapping: ≥1.0 → exceeded (danger), ≥0.8 → warning (warn), else ok (primary) — same thresholds as EscalationBudget.checkAlerts. UNITS ARE TOKENS by schema; documented in the gauge subtitle and the SUMMARY decisions. The dashboard renders the gauges on a row distinct from the USD spend cards so operators see both signals without conflation. |
| 4 | Routing: navigating to /dashboard/v2/fleet and /dashboard/v2/costs works; nav highlights current route | **SATISFIED** | Path↔view sync in App.tsx via pushState + popstate. PATH_TO_VIEW maps /dashboard/v2/fleet → 'fleet' and /dashboard/v2/costs → 'costs' (plus 3 other entries). VIEW_TO_PATH is the inverse for nav clicks. SPA-fallback in src/dashboard/server.ts now serves index.html for any extensionless path under /dashboard/v2/ (so /dashboard/v2/fleet is a valid deep link from a cold load — the catch-all heuristic skips the 404 path when there's no file extension). Nav strip rendered above the view-conditional content; ViewButton variant flips between 'default' (active) and 'ghost' (inactive) based on the current view value. Browser back/forward syncs via the popstate listener. |
| 5 | Bundle size: SPA stays under 1MB raw / 320KB gzip. Lazy-load F17 cost dashboard if it would push past | **SATISFIED** | Vite split the bundle into eager (index + useApi shared) + lazy (CostDashboard, TraceWaterfall). Apples-to-apples cold-load (index + useApi via modulepreload): **924.66KB raw / ~280KB gzip**, vs 906.90KB / 275.77KB at end of 116-04. Net +18KB raw / +5KB gzip for two new full-page surfaces (FleetComparisonTable eager, CostDashboard lazy) + opportunistic drawer enrichments — well inside the 1MB / 320KB plan budget. Per-chunk breakdown: `index-C1DeFvtr.js` 879.89/267.88, `useApi-DV1yh9Qm.js` 44.77/12.12 (eager shared), `CostDashboard-D9FZuuDQ.js` 40.34/11.37 (LAZY — loads on /dashboard/v2/costs navigation), `TraceWaterfall-veBQGpaB.js` 3.65/1.55 (LAZY — unchanged from 116-04). |

**Net:** 5 of 5 must-haves SATISFIED. One unit-convention decision (budget gauges in tokens, not USD) is documented in the SUMMARY decisions section and surfaces inline as a gauge subtitle so operators see it on every page load.

## Deviations from Plan

### [Plan boundary] F16 IPC delivery success rate is a fleet-wide FOOTER stat, not a per-row column

**Found during:** T02 frontend (designing the row schema).
**Issue:** Plan T01 step 4 lists "IPC delivery success rate" as a per-row column. DeliveryQueue.getStats() (the source of delivery stats) is fleet-wide — it tracks Discord-outbound deliveries with no per-agent breakdown in the schema. A per-agent column would either render the SAME fleet-wide number on every row (misleading) or "—" for most rows (useless). Same surface-adjustment 116-04 documented for F13.
**Fix:** Footer stat below the table: "Discord delivery (fleet): N delivered · N failed (X% success)". Sits in a bordered footer band so it's visibly distinct from per-row data. Operators get the signal without the false per-row attribution.
**Files modified:** `src/dashboard/client/src/components/FleetComparisonTable.tsx`
**Commit:** `6ae6e74`

### [Plan boundary] F16 MCP error count + 7d dream count columns omitted

**Found during:** T02 frontend (designing the row schema).
**Issue:** Plan T01 step 4 includes "MCP error count" and "dream count 7d" as per-row columns. Neither is fleet-wide-cached: (a) MCP error counts live in per-server state behind useMcpServers(agent) — a fleet-wide rollup would need a new aggregation IPC; (b) 7d dream count comes from per-agent useDreamQueue file-system scans (one filesystem read per agent). Adding these as columns would mean 14×2=28 extra hooks firing on table mount.
**Fix:** Columns omitted from the table; both surfaces remain visible in the per-agent drawer (F10 MCP panel + F15 DreamQueue). The "click row → see drawer" affordance (carried forward from 116-04's drawer-entry-point unification) preserves operator access without the per-row hook fan-out.
**Files modified:** `src/dashboard/client/src/components/FleetComparisonTable.tsx`
**Commit:** `6ae6e74`

### [Decision boundary] F17 budget gauges report TOKENS, not USD

**Found during:** T01 backend (designing the budget-status IPC payload).
**Issue:** Plan T02 step 6 says "Budget gauges: daily/weekly/monthly limit vs actuals (read EscalationBudget infrastructure)". The AgentBudgetConfig schema (src/usage/budget.ts:9-18) is token-typed: `daily.{sonnet,opus}` and `weekly.{sonnet,opus}` are token counts. The cost dashboard above renders USD spend totals. A unified USD gauge would need per-row pricing conversion via lookupPricing(model) — defensible alternative but introduces another conversion surface that could drift from the live pricing table.
**Fix:** Budget gauges report tokens-used vs tokens-limit; the section subtitle explicitly states "Units: tokens (matches AgentBudgetConfig schema). USD spend cards above are separate." Gauges sit on a card row distinct from the USD spend cards so the unit difference is visible in the layout, not just the copy.
**Files modified:** `src/manager/daemon.ts`, `src/dashboard/client/src/components/CostDashboard.tsx`
**Commit:** `64824d4` + `6ae6e74`

### [Plan boundary] F17 budget gauges DON'T include a "monthly" period

**Found during:** T01 backend (writing budget-status handler).
**Issue:** Plan T02 step 6 says "daily/weekly/monthly limit vs actuals". EscalationBudget natively tracks `daily` and `weekly` periods only — `monthly` doesn't exist in the schema (AgentBudgetConfig type, src/usage/budget.ts:9-18). Synthesizing a "monthly" period would mean summing 4 weekly periods, which doesn't align with the EscalationBudget's period_start fencing.
**Fix:** Budget gauges show `daily` + `weekly` only. The cost dashboard's "This month" spend card covers the calendar-month operator question above; the gauges are about ENFORCEMENT (where canEscalate trips), not historical spend.
**Files modified:** `src/manager/daemon.ts`, `src/dashboard/client/src/components/CostDashboard.tsx`
**Commit:** `64824d4` + `6ae6e74`

### [Plan boundary] F17 anomaly + projection are CLIENT-SIDE (no new backend)

**Found during:** T02 frontend (designing the dashboard data flow).
**Issue:** Plan T02 doesn't say where anomaly detection runs. Pushing it to the server would mean a new "anomaly check" IPC + cache invalidation strategy + threshold-tuning surface that operators can't easily adjust.
**Fix:** Anomaly + linear-regression projection compute client-side over the same `costs-daily` payload that drives the trend chart. The 2× threshold and 14-day projection floor are constants in CostDashboard.tsx (ANOMALY_MULTIPLIER, MIN_DAYS_FOR_PROJECTION). A future plan can add a settings panel that adjusts these without daemon changes. Documented in CostDashboard.tsx top comment.
**Files modified:** `src/dashboard/client/src/components/CostDashboard.tsx`
**Commit:** `6ae6e74`

### [Plan boundary] F17 cost-trend scope is RUNNING AGENTS ONLY

**Found during:** T01 backend (writing costs-daily handler).
**Issue:** Plan T02 mentions 30-day trends but UsageTracker instances close on stopAgent (src/manager/session-memory.ts:165). Reads via manager.getUsageTracker(agentName) only return live trackers — stopped agents' historical usage.db files remain on disk but aren't lazy-opened today.
**Fix:** `costs-daily` IPC iterates manager.getRunningAgents() only, same scope as the existing `costs` handler at daemon.ts:9220. Operators viewing a 30d trend for a recently-stopped agent will see zero rows for that agent until they restart it. Documented as a 116-06 forward-pointer in this SUMMARY's "Notes for downstream plans".
**Files modified:** `src/manager/daemon.ts`
**Commit:** `64824d4`

### [Rule 2 - Missing critical] SPA-fallback for path-based routing

**Found during:** T02 frontend (testing deep-link to /dashboard/v2/fleet).
**Issue:** The plan added path-based routes but the existing dashboard server catch-all at line 258 strictly maps /dashboard/v2/<x> → STATIC_SPA_DIR/<x>; missing files 404. /dashboard/v2/fleet has no corresponding file → cold-load 404, even though the SPA route exists. Without a SPA-fallback the must-have ("navigating to /dashboard/v2/fleet works") FAILS on first load (only works after the SPA is already loaded via /dashboard/v2 and the user clicks the nav button, which triggers pushState client-side).
**Fix:** Heuristic SPA-fallback — paths with NO file extension serve index.html (SPA route); paths WITH extensions keep strict-404 behavior. /dashboard/v2/fleet → SPA. /dashboard/v2/fonts/x.woff2 (or /dashboard/v2/favicon.svg) → still 404s on miss so stale-build issues remain operator-visible. Same heuristic used by most SPA-fallback proxies. Implementation: single 4-line check before the strict serveSpaAsset call.
**Files modified:** `src/dashboard/server.ts`
**Commit:** `6ae6e74`

### [Plan boundary] F17 stacked area chart uses model-bucket palette, not the agent palette

**Found during:** T02 frontend (designing the trend-chart series colors).
**Issue:** Plan T02 step 4 says "stacked area chart for trend (one stack per agent or per model — toggle)". When toggled to per-model, the operator question is "is opus or sonnet driving the spend?" which is best answered by a consistent canonical color per model. When toggled to per-agent, the operator question is "which agent is the spend leader?" which is best answered by a stable color per agent — but agents come and go, so a fixed enumerated palette (6-color cycle) is more durable than a deterministic hash.
**Fix:** pickColor() switches on groupBy: for 'model' it uses a canonical MODEL_COLORS map (opus→violet, sonnet→emerald, haiku→amber, other→muted); for 'agent' it uses a 6-color AGENT_COLORS array indexed by series position. Documented in the pickColor() comment.
**Files modified:** `src/dashboard/client/src/components/CostDashboard.tsx`
**Commit:** `6ae6e74`

## Auth Gates

None. All work was local; no daemon restarts, no Discord API calls, no production deploys (per prompt's "NO DEPLOY" constraint). The deploy script remains gated behind operator confirmation as global rules dictate.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-read-surface | `src/dashboard/server.ts` GET /api/costs/daily | Per-day cost rows (date, agent, model, tokens_in/out, cost_usd) for the last 30 days returned over HTTP. Operator-bound trust posture (dashboard binds to 127.0.0.1). No new exposure beyond what /api/costs (period=today/week/month) already provides — same shape, different bucketing. |
| threat_flag: new-read-surface | `src/dashboard/server.ts` GET /api/budgets | Tokens-used and tokens-limit per (agent, model, period) over HTTP. Same 127.0.0.1 trust posture. EscalationBudget enforcement is a daemon-internal concern; surfacing the gauge data does not weaken enforcement (limits are still checked on the daemon side at canEscalate). |
| threat_flag: new-client-route | `src/dashboard/server.ts` SPA-fallback for /dashboard/v2/<extensionless> | New SPA-fallback heuristic serves index.html for ANY /dashboard/v2/<path-without-extension>. This expands the set of URLs that respond 200 from the dashboard server, but the response is always the same static SPA shell — no user-controlled data lands in the body and no daemon state is reached without going through one of the existing /api/* routes. Same 127.0.0.1 trust posture. |

All three flags are documented in the relevant route docstrings + the daemon-handler comments. None introduce new trust boundaries beyond what the existing 127.0.0.1-bound dashboard already exposes.

## Known Stubs

| Stub | File | Reason | Landing |
|------|------|--------|---------|
| F04 7-day sparkline in the drawer right column | `DrawerExtras.tsx` top comment + `AgentDetailDrawer.tsx` | Needs a new per-agent timeline endpoint (turn-count-per-day or first-token-p50-per-day buckets). 116-04 explicitly flagged this as missing — there's no per-agent time-series query in the current daemon. Adding it would mean a new TraceStore method + a new IPC + a new REST route + the new component. Estimated 2-3h; defensible to bundle with 116-06's polish work. | 116-06 (Tier 3 polish) |
| F16 per-row MCP error count | `FleetComparisonTable.tsx` | Fleet-wide rollup of per-server MCP error counts doesn't exist today; useMcpServers is per-agent and returns the full server list per call. A fleet-wide aggregation IPC + a new column would land cleanly together. | 116-06 (Tier 3 polish) |
| F16 per-row 7-day dream count | `FleetComparisonTable.tsx` | Same shape problem as MCP errors — useDreamQueue is per-agent and reads files from disk per call. A fleet-wide aggregation that scans 14 dream directories at once would belong in the daemon's heartbeat path or a dedicated cron, not in a request handler. | future plan when operator demand surfaces |
| F17 cost-trend stopped-agent history | `daemon.ts` costs-daily handler | UsageTracker closes on stopAgent; historical reads on stopped agents require lazy-opening their usage.db files from disk. Not a schema change — just plumbing — but adds caching + lifetime semantics that haven't been pinned. | 116-06 or a separate small phase |
| F17 USD budget gauges | `daemon.ts` budget-status handler | Plan said "budget gauges: daily/weekly/monthly limit vs actuals". The native EscalationBudget surface is token-typed; we render tokens. A USD overlay would convert via lookupPricing(model) per row. Operator hasn't asked; documented decision rather than a stub-in-disguise. | future plan if operator demand surfaces |
| F17 budget "monthly" period | `daemon.ts` budget-status handler | EscalationBudget has daily + weekly periods only; "monthly" doesn't exist in the schema. The "This month" spend card above covers the calendar-month spend question; the budgets table is about enforcement, not history. | n/a — covered by spend card |
| F17 anomaly/projection settings UI | `CostDashboard.tsx` | The 2× multiplier and 14-day projection floor are file constants. A future plan can add a settings panel that adjusts these without daemon changes (computation is client-side). | future plan when operator surfaces threshold-tuning |

All stubs are documented in-component or in this SUMMARY. No silent fakes — every disabled / no-op / hardcoded-constant surface explains where the full implementation lands.

## Items to surface to operator

1. **Bundle size: cold-load (index + useApi shared, both preloaded) is 924.66KB raw / ~280KB gzip — up +18KB raw / +5KB gzip from end of 116-04** (906.90/275.77). Vite split the dashboard surface into 4 chunks: eager `index` 879.89/267.88, eager-shared `useApi` 44.77/12.12, lazy `CostDashboard` 40.34/11.37 (loads on cost-dashboard navigation), lazy `TraceWaterfall` 3.65/1.55 (loads on trace-row click). Plan budget (1MB raw / 320KB gzip) honored with healthy headroom for 116-06.

2. **F16 fleet table is now the canonical "compare every agent in one view" surface.** Every column sortable, every visible row CSV-exportable. Filters compose (status × model × SLO breach). The footer Discord delivery stat is fleet-wide (the per-agent IPC delivery question requires a schema addition that 116-04 also forward-pointed).

3. **F17 cost dashboard is operational TODAY against the live usage.db files for running agents.** Stopped-agent historical data is invisible until the agent is restarted — UsageTracker instances close on stopAgent. Documented as a 116-06 forward-pointer; not a regression because no prior dashboard surface read stopped-agent data either.

4. **F17 budget gauges are TOKENS, not USD.** The dashboard subtitle states this explicitly. A future plan can add a USD overlay if operators ask, but the underlying enforcement semantics (canEscalate, alertCallback) are token-typed and we keep the dashboard symmetric with the enforcement contract.

5. **F17 anomaly threshold = 2× (locked from CONTEXT).** Suppressed when <5 days of buckets exist so fresh installs don't fire phantom alerts. The threshold is a file constant; relitigate via 116-CONTEXT if operator wants to tune.

6. **F17 month-end projection requires ≥14 days of data.** Below that, the card renders "insufficient data — gather 14d for projection" with a per-day-count subtitle. Avoids the worst class of misleading-extrapolation chart-junk.

7. **Path-based routing now lands deep links to /dashboard/v2/{fleet,costs,conversations,tasks}.** The SPA-fallback heuristic in src/dashboard/server.ts treats extensionless paths under /dashboard/v2/ as client routes (serves index.html). Paths with extensions (fonts, images) keep strict-404 behavior so build-staleness issues remain operator-visible.

8. **AgentDetailDrawer right column now stacks SloSegmentGauges + CostSummaryCard above MemoryPanel + IpcInbox + DreamQueue.** F02 + F17 forward-pointers from 116-04 landed via DrawerExtras.tsx (not by editing AgentDetailDrawer directly — kept the 116-04 diff minimal). F04 sparkline still deferred — needs the new per-agent timeline endpoint.

9. **NO production deploy.** Per prompt's "NO DEPLOY" constraint. The deploy script (scripts/deploy-clawdy.sh) is unchanged and remains gated behind operator confirmation as global rules dictate.

10. **Pre-existing slash-command test failures (19) carried forward.** The IPC pinning test is now in sync (3 plans of pins backfilled: 116-03 + 116-04 + 116-05); slash-command count failures are still pending the dedupe task 116-04 surfaced in its own items list.

## Self-Check

Created files exist:
- `src/dashboard/client/src/components/FleetComparisonTable.tsx` — FOUND
- `src/dashboard/client/src/components/CostDashboard.tsx` — FOUND
- `src/dashboard/client/src/components/DrawerExtras.tsx` — FOUND
- `src/dashboard/client/src/components/ui/table.tsx` — FOUND

Modified files (diffs preserved):
- `src/usage/types.ts` — CostByDay type added
- `src/usage/tracker.ts` — getCostsByDay method + prepared statement added
- `src/manager/daemon.ts` — "Phase 116-05" closure-intercept block (+125 lines)
- `src/dashboard/server.ts` — "=== Phase 116-05 routes ===" block + SPA-fallback heuristic
- `src/ipc/protocol.ts` — +2 IPC_METHODS entries (costs-daily, budget-status)
- `src/ipc/__tests__/protocol.test.ts` — pin extended
- `src/dashboard/client/src/App.tsx` — view enum extended + path↔view sync + CostDashboard lazy import
- `src/dashboard/client/src/components/AgentDetailDrawer.tsx` — DrawerExtras imports + mount in right column
- `src/dashboard/client/src/hooks/useApi.ts` — useCosts, useCostsDaily, useBudgets + 4 types

Commits exist in git log (verified via `git log --oneline -3`):
- `64824d4` feat(116-05): T01-T02 backend — F17 costs-daily + budget-status IPC + REST
- `6ae6e74` feat(116-05): T01-T02 frontend — F16 fleet table + F17 cost dashboard + nav + drawer extras

Verification:
- `npx tsc --noEmit` (daemon-side) → 0 errors
- `cd src/dashboard/client && npx vite build` → eager 879.89KB / 267.88KB gzip + CostDashboard lazy 40.34KB / 11.37KB gzip + TraceWaterfall lazy 3.65KB / 1.55KB gzip; 2519 modules transformed; 1.08s build time
- `npx vitest run src/dashboard/ src/performance/__tests__/ src/ipc/` → 301/301 pass
- `npx vitest run src/ipc src/usage` → 158/158 pass
- Bundle string search: `Fleet comparison`, `cost-anomaly-banner`, `cost-budget-gauges`, `drawer-slo-gauges`, `drawer-cost-card`, `costs-daily`, `budget-status` all present in `dist/dashboard/spa/assets/*.js`

## Self-Check: PASSED

## Notes for downstream plans

- **116-06 (Tier 3 polish):**
  - Append routes inside a new `=== Phase 116-06 routes ===` block immediately after the 116-05 fence — same convention 116-05 inherited.
  - The IPC closure-intercept block in daemon.ts has the same "Phase 116-06" header pattern available (insertion point: right after the "=== end Phase 116-05 IPC handlers ===" marker at the end of the 116-05 block).
  - **F04 7-day sparkline:** the natural shape is a new per-agent timeline IPC (e.g. `get-agent-timeline?metric={turn_count,first_token_p50}&days=7`) backed by a new TraceStore.getDailyBuckets method. The DrawerExtras.tsx file is the natural mount point — add a `SparklineCard` component alongside SloSegmentGauges + CostSummaryCard.
  - **F16 per-row enrichments:** if operators want MCP error counts + 7d dream counts as columns, the cheapest path is a new `fleet-snapshot` IPC that returns a flat array of `{agent, mcp_errors, dream_count_7d, ...}` rows. Reads from already-open per-agent stores so no schema change. Then add the columns to FleetComparisonTable (each row would consume this snapshot from a fleet-wide hook rather than per-agent hooks).
  - **F17 stopped-agent historical cost:** lazy-open usage.db files for agents not currently in manager.getUsageTracker. Either (a) cache the opened trackers in a separate map with a TTL, or (b) open + close per request. Option (a) is more efficient but introduces a lifetime question (when to close?); option (b) is simpler if performance is acceptable at fleet size.
  - **F17 USD budget overlay:** if operators ask for USD budgets, lookupPricing(model) is already in src/usage/pricing.ts. The overlay would multiply tokens × USD-per-1M-tokens and overlay it as a secondary axis on each BudgetBar.
- **116-05 contiguous-routes-block convention** is preserved:
  - Daemon IPC: closure-intercept block in `src/manager/daemon.ts` opens with `// =====================================================================\n// Phase 116-05 — Fleet-scale + cost IPC handlers (F16/F17).` immediately after the 116-04 fence (search for "Phase 116-05" in daemon.ts).
  - REST routes: `// === Phase 116-05 routes ===` ... `// === end Phase 116-05 routes ===` in `src/dashboard/server.ts`, immediately after the 116-04 fence and before the Phase 61 webhook route.
- **Future client-routing scale-up:**
  - The path↔view sync in App.tsx is a 2-map lookup. If 116-06 adds many more routes (5+), consider extracting to a `useViewRouter()` hook in `src/dashboard/client/src/hooks/useViewRouter.ts` that wraps the popstate listener + the navigate() function. Same surface, less in-component noise. If the route count grows past ~10 OR routes start needing params, that's the inflection point to consider react-router properly.
- **Future Recharts code splitting:**
  - CostDashboard is the only Recharts consumer in the SPA today (ToolCacheGauge + ToolLatencySplit also use Recharts but are mounted in the eager AgentTile + cache pages). If 116-06 adds more chart-heavy views (e.g. an SLO history chart, a memory growth chart), lazy-load each route. The chunk-extraction pattern Vite uses for CostDashboard is the model — single React.lazy() call in App.tsx, single Suspense wrapper, separate chunk per route.
- **Future MCP server fleet table (F10 fleet expansion):**
  - The Table primitive in `ui/table.tsx` is the right surface for a per-(agent, server) status table. Same sort + filter pattern as FleetComparisonTable. Forward-pointer for any plan that wants to surface "every MCP server across every agent" in one view.
- **Future cross-agent IPC log surface (forward from 116-04):**
  - Adding a fleet-wide cross-agent IPC log column to FleetComparisonTable would naturally land in tandem with the schema-extension plan 116-04 forward-pointed. The footer Discord delivery stat is the current stand-in.
