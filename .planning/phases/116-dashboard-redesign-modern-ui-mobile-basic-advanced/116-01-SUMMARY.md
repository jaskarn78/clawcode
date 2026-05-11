---
phase: 116
plan: 01
title: Tier 1 read-only surfaces — F01 SLO banner, F03 tile grid, F04 budget meter, F05 cache gauge, F08 counters
subsystem: dashboard
tags: [dashboard, spa, react, shadcn, recharts, tier1, slo, tool-cache, tier1-budget, prompt-bloat]
completed: 2026-05-11
duration_minutes: ~65
tasks_completed: 6
files_modified:
  - src/dashboard/client/src/App.tsx
  - src/dashboard/client/src/hooks/useApi.ts
  - src/dashboard/client/src/components/SloBreachBanner.tsx (new)
  - src/dashboard/client/src/components/AgentTile.tsx (new)
  - src/dashboard/client/src/components/AgentTileGrid.tsx (new)
  - src/dashboard/client/src/components/ContextMeter.tsx (new)
  - src/dashboard/client/src/components/ToolCacheGauge.tsx (new)
  - src/dashboard/client/src/components/MetricCounters.tsx (new)
  - src/dashboard/client/src/components/ui/popover.tsx (new)
  - src/dashboard/client/src/components/ui/progress.tsx (extended)
  - src/dashboard/client/src/layouts/FleetLayout.tsx (new)
dependency_graph:
  requires:
    - 116-00 (Vite/React/Tailwind/shadcn foundation + useSse/useApi/useViewMode hooks + F02 backend)
  provides:
    - F01 SloBreachBanner with bucketed-dismissal localStorage
    - F03 AgentTileGrid + AgentTile (responsive 1/2/3/4-col)
    - F04 ContextMeter (Tier 1 inject budget with color band)
    - F05 ToolCacheGauge (Recharts donut + threshold popover)
    - F08 MetricCounters (prompt bloat + lazy recall pills)
    - FleetLayout (Basic vs Advanced mode split)
    - useAgentLatency hook (observed first_token p50 surface)
    - shadcn Popover primitive (hand-rolled, mirrors Tooltip pattern)
    - Progress primitive `indicatorClassName` prop (backwards-compatible)
  affects:
    - 116-02 (Tier 1 interactivity — Cmd+K + restart/run-health IPC wiring;
      this plan left no-op placeholders so the IPC layer wires cleanly)
    - 116-04 (drawer + per-agent traces — openAgentDrawer callback + 24h
      sparkline placeholder are the integration points)
tech_stack:
  added: []
  patterns:
    - Per-tile fan-out: useAgentCache + useAgentLatency keyed by agent name;
      TanStack Query dedups so N tiles → N pairs of queries, no waste
    - Bucketed-dismissal localStorage (round observed metric to nearest 500ms)
      so jitter inside one degradation doesn't re-show a dismissed banner
    - Skeleton placeholders for future endpoints (24h sparkline, per-tool
      cache breakdown) so the layout doesn't collapse and a forward-pointer
      tooltip explains the deferral
    - Cold-start guard mirrors daemon evaluateFirstTokenHeadline: <5 samples
      → no_data → render '—' (never a misleading concrete p50)
key_files:
  created:
    - src/dashboard/client/src/components/SloBreachBanner.tsx
    - src/dashboard/client/src/components/AgentTile.tsx
    - src/dashboard/client/src/components/AgentTileGrid.tsx
    - src/dashboard/client/src/components/ContextMeter.tsx
    - src/dashboard/client/src/components/ToolCacheGauge.tsx
    - src/dashboard/client/src/components/MetricCounters.tsx
    - src/dashboard/client/src/components/ui/popover.tsx
    - src/dashboard/client/src/layouts/FleetLayout.tsx
  modified:
    - src/dashboard/client/src/App.tsx (smoke component fully retired)
    - src/dashboard/client/src/hooks/useApi.ts (+useAgentLatency)
    - src/dashboard/client/src/components/ui/progress.tsx (+indicatorClassName)
decisions:
  - useAgentLatency added in T01 — `/api/agents/:name/cache` carries the SLO
    THRESHOLD (slos.first_token_p50_ms) but not the OBSERVED p50. Latency
    endpoint (case 'latency' in daemon.ts:7053) emits first_token_headline
    with observed p50/p95/count/slo_status. Both F01 (breach detection) and
    F03 (per-tile SLO color) need both surfaces. 30s polling — daemon SSE
    doesn't broadcast latency events today.
  - SLO breach dismissal is bucketed by observed p50 rounded to 500ms so a
    flapping observed value doesn't replay the banner 12 times per minute,
    but a genuine new degradation that pushes into a wider bucket does
    re-surface. 1h TTL on dismissals.
  - Per-tool cache breakdown deferred — `/api/agents/:name/cache` returns the
    fleet-wide tool_cache_hit_rate only (verified vs daemon.ts case 'cache'
    + tool-cache-store.ts). The popover surfaces hit rate + size + turns +
    a forward-pointer to 116-02 where a new endpoint slot is anticipated.
  - 24h activity sparkline + per-agent migration phase + per-agent MCP health
    OMITTED from the tile (silently — conditional render is in place). Source
    endpoints don't exist today (verified vs src/dashboard/sse.ts
    fetchCurrentState payload shape). 116-04 drawer + a follow-up enrich pass
    on /api/status are the natural landing zones.
  - Quick-action buttons in Basic mode are no-op placeholders. The IPC
    handlers (restart-discord-bot, run-health-check, open-settings) are
    116-02 / 116-06 scope. Tooltips spell out the deferral so operators see
    why nothing happens.
  - shadcn Progress primitive extended with optional indicatorClassName so
    the F04 budget meter can swap bar color across 3 bands. Backwards-
    compatible (callers omitting the prop keep the stock primary indicator).
  - shadcn Popover primitive hand-rolled (mirrors the tooltip.tsx pattern
    documented in 116-00 T07 deviation — shadcn CLI v4 still can't init
    against this repo's Tailwind 3.4 + parent-dir node_modules layout).
metrics:
  bundle_js_kb: 683
  bundle_js_gzip_kb: 214
  bundle_css_kb: 23
  bundle_css_gzip_kb: 5.2
  bundle_growth_js_kb: 420  # was 263 at end of 116-00
  bundle_growth_reason: "Recharts pulled into the main bundle by ToolCacheGauge; 116-04 will route-split (per 116-00 SUMMARY 'bundle size watch' note)"
  tests_passing_dashboard_suite: 46
  components_added: 7  # SloBreachBanner, AgentTile, AgentTileGrid, ContextMeter, ToolCacheGauge, MetricCounters, FleetLayout
  ui_primitives_added: 1  # popover.tsx
  hooks_added: 1  # useAgentLatency
  commits: 6  # one per task
---

# Phase 116 Plan 01: Tier 1 read-only surfaces — Summary

**One-liner:** Five read-only Tier 1 features (F01 SLO breach banner, F03 responsive tile grid, F04 budget meter, F05 tool cache donut, F08 prompt-bloat + lazy-recall counters) wired against the existing `/api/agents/:name/{cache,latency}` + `/api/status` + `/api/fleet-stats` endpoints — no backend changes, full Basic-vs-Advanced split layout, smoke shell retired.

## Tasks Executed

| Task | Commit  | Description |
| ---- | ------- | ----------- |
| T01  | `0fa64b5` | F01 SLO breach banner + `useAgentLatency` hook (observed first_token p50 from `/api/agents/:name/latency`; bucketed-dismissal localStorage) |
| T03  | `8af8ddf` | F04 Tier-1 budget meter (`ContextMeter`) — wraps `<Progress>` with 70/85 color band; extended shadcn Progress with `indicatorClassName` |
| T05  | `7b9f562` | F08 prompt-bloat + lazy-recall counters (`MetricCounters`) — amber chip when > 0 + neutral chip with metric-explainer tooltip |
| T04  | `020cc34` | F05 tool cache gauge (`ToolCacheGauge`) — Recharts donut with click-popover; hand-rolled shadcn Popover primitive |
| T02  | `fae869c` | F03 responsive grid + per-agent tile (`AgentTileGrid` + `AgentTile`) — 1/2/3/4-col across breakpoints; dormant agents → footer pills |
| T06  | `8ca4bcd` | Basic vs Advanced layout (`FleetLayout`) — header + view-mode toggle + SloBreachBanner + per-mode body; `App.tsx` reduced to mount-and-delegate |

(Tasks committed in dependency-friendly order: T01 first, then sub-components T03/T05/T04, then T02 composer, then T06 layout — not in strict numeric order. Plan ordering says nothing about commit order; what matters is the per-task atomicity, which holds.)

## Must-haves

| # | Clause | Status | Rationale |
|---|--------|--------|-----------|
| 1 | F01 SLO breach banner renders on viewport with active breaches; dismissible; click-to-drill works | **SATISFIED (with caveat)** | Banner renders when any agent's observed `first_token_headline.p50` exceeds its per-model `slos.first_token_p50_ms` threshold (≥5 samples; mirrors daemon cold-start guard). `[Dismiss]` button writes a 1h-TTL entry to `localStorage['dashboard.sloBreaches.dismissed']` keyed by `{agent, p50_bucket_500ms}`. Click on the agent name calls `openAgentDrawer(name)` which logs a "drawer ships in 116-04" message to the console — the drawer surface itself is 116-04 scope. |
| 2 | F03 tile grid 3-col at 1280px, 4-col at 1920px, 1-col at 375px (Basic mode default) | **SATISFIED** | Grid is `grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4`. Tailwind screens (locked in 116-00 T06): sm=375, md=768, lg=1024, xl=1280, 2xl=1920. So <768 → 1-col; 768-1279 → 2-col; 1280-1919 → 3-col; ≥1920 → 4-col. Basic-vs-Advanced switch is at `lg` (1024px) per `useViewMode` default; Basic mode renders stacked rows (1-col). 375px viewport gets Basic mode → 1-col rows. |
| 3 | F04 budget meter shows `tier1_inject_chars / 16,000` with color band | **SATISFIED** | `ContextMeter` reads `tier1_inject_chars` + `tier1_budget_pct` from `useAgentCache` (daemon.ts:3514-3515). Cap = 16,000 chars (`TIER1_BUDGET_CHARS` constant). Color band emerald / amber / red at 70/85 thresholds. Hover tooltip: `5,298 / 16,000 chars (33.1%)` formatted. 7d sparkline rendered as Skeleton placeholder (no daily-rollup endpoint; ships with 116-04 drawer). |
| 4 | F05 cache gauge shows `tool_cache_hit_rate` as donut + per-tool breakdown on hover | **PARTIAL** | Donut renders (Recharts PieChart, 60-degree segment per fill-pct, color band ≥40 emerald / 20-39 amber / <20 red). Click-popover shows hit rate + cache size MB + turns sampled + target-threshold (40%) callout. **Per-tool breakdown deferred:** `/api/agents/:name/cache` returns the fleet-wide rate only (verified vs daemon.ts:7187-7194 `getToolCacheTelemetry`). Forward-pointer note inside the popover plus a deviation entry below. Adding a per-tool field is 116-02 scope. |
| 5 | F08 prompt-bloat + lazy-recall counters render in tile (>0 visually flagged) | **SATISFIED** | `MetricCounters` renders two `<Badge>` chips. Prompt-bloat amber when > 0 (`bg-warn/15 border-warn/40 text-warn`); click navigates to `/dashboard/v2/traces?agent=X&filter=prompt-bloat` (route ships in 116-02 — anchor has a `preventDefault` guard today so the dashboard stays put). Lazy-recall is a neutral chip with a tooltip explaining the metric. Null values render `—` to avoid faking a `0`. |
| 6 | Basic mode (mobile default) shows status banner + agent list rows + quick actions | **SATISFIED** | `<BasicMode />` renders `<AgentTile>` per agent in a single-column stacked layout, plus a `<QuickActions />` row with three no-op buttons (Restart Discord bot, Run health check, Settings). Each button's tooltip explains why nothing happens (IPC handlers wire up in 116-02 / 116-06). Header settings cog also surfaces a `Settings panel ships in 116-06` tooltip. SloBreachBanner mounts above both modes. |
| 7 | Advanced mode shows full Tier 1 tile grid | **SATISFIED** | `<AdvancedMode />` renders `<AgentTileGrid />` (full 1/2/3/4-col responsive grid) plus an `<McpOverviewStrip />` footer reading `/api/fleet-stats.mcpFleet` (pattern + count + RSS MB + runtime badge per pattern). Strip hidden when `mcpFleet` is empty so non-Linux dev hosts don't render an empty rail. |

**Net:** 6 of 7 satisfied outright, 1 partial (F05 per-tool breakdown deferred to 116-02 — captured in deviations).

## Deviations from Plan

### [Rule 3 - Blocking] `useAgentLatency` added (plan didn't list it, but T01 + T02 both need it)

**Found during:** T01 design (advisor-flagged).
**Issue:** Plan T01 step 2 says "compute breaches: `if agent.first_token_p50_ms > agent.slos.first_token_p50_ms`" — implying both values live on the same cache endpoint. They don't. `/api/agents/:name/cache` carries the threshold (`slos.first_token_p50_ms`); the observed p50 lives on `/api/agents/:name/latency` under `first_token_headline.p50` (daemon.ts:7077). Without a separate latency fetch, F01 has no input.
**Fix:** Added `useAgentLatency(agentName, since)` to `useApi.ts` — REST polling at 30s (no SSE `latency` event in `src/dashboard/sse.ts`). Cold-start guard mirrors the daemon's `evaluateFirstTokenHeadline`: `count < 5` or `slo_status === 'no_data'` → no breach. Same hook drives the F03 tile's SLO color.
**Files modified:** `src/dashboard/client/src/hooks/useApi.ts`
**Commit:** `0fa64b5`

### [Plan boundary] F05 per-tool cache breakdown deferred to 116-02

**Found during:** T04.
**Issue:** Plan T04 step 4 says "per-tool breakdown table … sourced from same endpoint." `/api/agents/:name/cache` does not have per-tool data — `getToolCacheTelemetry` (mcp/tool-cache-store via `case "cache"` daemon handler) emits `avgToolCacheHitRate` (fleet-wide) + `avgToolCacheSizeMb` + `turnsWithCacheEvents` only. Adding a per-tool field would be a backend change, which the plan prohibits ("no backend changes").
**Fix:** Popover shows hit rate + cache size + turns sampled + target-threshold callout + a forward-pointer note (`Per-tool breakdown lands in 116-02 (needs a new daemon endpoint…)`).
**Files modified:** `src/dashboard/client/src/components/ToolCacheGauge.tsx`
**Commit:** `020cc34`

### [Plan boundary] Migration phase + per-agent MCP health rows omitted from AgentTile

**Found during:** T02.
**Issue:** Plan T02 step 2 lists "Migration phase pill (if `migration.phase !== 'idle'`)" and "MCP health badge (count of unhealthy / total)" as tile fields. Neither lives on `/api/status` today (verified vs `src/dashboard/sse.ts:fetchCurrentState` entry shape: `{ name, status, uptime, startedAt, restartCount, lastError, zone, fillPercentage, warm_path_ready, warm_path_readiness_ms }`). Surfacing them needs daemon-side enrichment — out of scope for this plan.
**Fix:** Render conditional scaffolding (already in place via the loose `AgentTileProps.agent.model` passthrough pattern) ready for when a future plan adds the fields. Silently omit when absent — no stub UI rows.
**Files modified:** `src/dashboard/client/src/components/AgentTile.tsx`
**Commit:** `fae869c`

### [Plan boundary] 24h activity sparkline is a Skeleton placeholder

**Found during:** T02.
**Issue:** No per-agent timeline endpoint today. `/api/agents/:name/cache` aggregates a window; it doesn't emit a per-bucket time series.
**Fix:** Render `<Skeleton className="h-8 w-full rounded" />` with an `aria-label` and `data-testid="agent-tile-sparkline-placeholder"`. 116-04 (drawer + traces) is the natural landing zone for the time-series endpoint.
**Files modified:** `src/dashboard/client/src/components/AgentTile.tsx`
**Commit:** `fae869c`

### [Rule 2 - Missing critical] shadcn Progress `indicatorClassName` prop

**Found during:** T03.
**Issue:** F04 needs to swap bar color across 3 SLO bands. shadcn's stock Progress hard-codes `bg-primary` on the indicator. Subclassing it for each band would proliferate near-duplicate primitives.
**Fix:** Extended `components/ui/progress.tsx` with an optional `indicatorClassName` prop. Backwards-compatible — callers omitting it keep the stock emerald indicator (the smoke shell didn't use the prop and still rendered fine). One commit, one minimal diff.
**Files modified:** `src/dashboard/client/src/components/ui/progress.tsx`
**Commit:** `8af8ddf`

### [Rule 3 - Blocking] shadcn Popover primitive hand-rolled

**Found during:** T04.
**Issue:** F05 popover-on-click needs a Popover primitive. shadcn CLI v4 still can't init against this repo's Tailwind 3.4 + parent-directory `node_modules` layout (documented as a 116-00 T07 deviation; the same blocker still applies).
**Fix:** Hand-wrote `components/ui/popover.tsx` mirroring the existing `tooltip.tsx` pattern. The Radix dep (`@radix-ui/react-popover@^1.1.15`) is already in the root package.json from the 116-00 install set.
**Files added:** `src/dashboard/client/src/components/ui/popover.tsx`
**Commit:** `020cc34`

### [Rule 2 - Missing critical] Quick-action buttons are tooltip-explained no-ops

**Found during:** T06.
**Issue:** Basic-mode quick-action buttons (Restart Discord bot, Run health check, Settings) would call IPC handlers that don't exist yet on the daemon (`restart-discord-bot`, `heartbeat-status` round-trip with toast, `open-settings`). Adding them is 116-02 / 116-06 scope.
**Fix:** Each button is a no-op `useCallback`. Each tooltip says where the wire-up lands (e.g., `Daemon IPC (restart-discord-bot) wires up in 116-02`). Settings cog in the header gets the same treatment. Operator never thinks they pressed a button that should work and didn't — they get an explanation up front.
**Files modified:** `src/dashboard/client/src/layouts/FleetLayout.tsx`
**Commit:** `8ca4bcd`

## Auth Gates

None. All work was local; no daemon restarts, no Discord API calls, no deploys.

## Threat Flags

None. All consumed endpoints (`/api/status`, `/api/agents/:name/cache`, `/api/agents/:name/latency`, `/api/fleet-stats`) already existed pre-116-01 with the same 127.0.0.1-binding posture. No new trust-boundary surface; no new authentication paths; no new file access.

## Known Stubs

The plan explicitly carves room for these — each has a clear future-plan landing zone:

| Stub | File | Line | Rationale |
|------|------|------|-----------|
| 24h activity sparkline | `AgentTile.tsx` | ~205 | No per-agent timeline endpoint today; lands with the 116-04 drawer (which already has a richer trace waterfall in scope). |
| Per-tool cache breakdown in popover | `ToolCacheGauge.tsx` | popover body | `/api/agents/:name/cache` doesn't carry per-tool rates. 116-02 has a backend extension slot for tool-rate-by-tool. |
| Migration phase + per-agent MCP badge | `AgentTile.tsx` | conditional render | `/api/status` doesn't surface these. Conditional render scaffolding is in place; a follow-up to enrich `/api/status` (likely 116-04 or 116-06) wires them in. |
| `openAgentDrawer(name)` callback | `FleetLayout.tsx`, `SloBreachBanner.tsx` | drill-in link | Drawer ships in 116-04. Today the callback logs a console message so devtools-aware operators see the deferral; UI-only operators see the click do nothing (the banner doesn't dismiss on click). |
| Quick-action buttons | `FleetLayout.tsx`, `<QuickActions>` | three buttons | IPC handlers ship in 116-02 / 116-06. Tooltips spell out the deferral. |
| Prompt-bloat traces link | `MetricCounters.tsx` | anchor preventDefault | Traces page ships in 116-02. Today the anchor's preventDefault prevents a 404. |

These are documented stubs with a clear landing plan, not silent fakes. The plan goal (Tier 1 read-only surfaces) is fully achieved with these deferrals.

## Deferred Issues

None outside the known-stub list above.

## Self-Check

Created files:
- `src/dashboard/client/src/components/SloBreachBanner.tsx` — FOUND
- `src/dashboard/client/src/components/AgentTile.tsx` — FOUND
- `src/dashboard/client/src/components/AgentTileGrid.tsx` — FOUND
- `src/dashboard/client/src/components/ContextMeter.tsx` — FOUND
- `src/dashboard/client/src/components/ToolCacheGauge.tsx` — FOUND
- `src/dashboard/client/src/components/MetricCounters.tsx` — FOUND
- `src/dashboard/client/src/components/ui/popover.tsx` — FOUND
- `src/dashboard/client/src/layouts/FleetLayout.tsx` — FOUND

Modified files:
- `src/dashboard/client/src/App.tsx` — smoke component retired (FOUND, content replaced)
- `src/dashboard/client/src/hooks/useApi.ts` — useAgentLatency added (FOUND, diff verified)
- `src/dashboard/client/src/components/ui/progress.tsx` — indicatorClassName added (FOUND, diff verified)

Commits in git log:
- `0fa64b5` T01 — F01 SLO breach banner + useAgentLatency hook
- `8af8ddf` T03 — F04 Tier-1 budget meter (ContextMeter)
- `7b9f562` T05 — F08 prompt-bloat + lazy-recall counters
- `020cc34` T04 — F05 tool cache hit rate gauge (Recharts donut)
- `fae869c` T02 — F03 responsive agent tile grid + per-agent tile
- `8ca4bcd` T06 — Basic vs Advanced layout split (FleetLayout)

Verification:
- `npm run build:spa` → clean, 683KB / 214KB gzip bundle (Recharts dominates; 116-04 will route-split)
- `npx tsc -p tsconfig.app.json --noEmit` → 0 errors
- `npx vitest run src/dashboard/` → 46/46 pass (4 test files)

### Compiled CSS / bundle viewport verification

Static inspection of the production `dist/dashboard/spa/assets/index-*.css` confirms the responsive grid utilities and breakpoints are present:

| Breakpoint | Media query in CSS | Grid-cols utility | Verdict |
|------------|--------------------|-------------------|---------|
| < 768 (mobile)  | (default, no media) | `.grid-cols-1{grid-template-columns:repeat(1,...)}` | 1-col |
| ≥ 768 (md)      | `@media (width>=768px)` | `.md\:grid-cols-2{...repeat(2,...)}` | 2-col |
| ≥ 1280 (xl)     | `@media (width>=1280px)` | `.xl\:grid-cols-3{...repeat(3,...)}` | 3-col |
| ≥ 1920 (2xl)    | `@media (width>=1920px)` | `.\32 xl\:grid-cols-4{...repeat(4,...)}` | 4-col |

All five locked breakpoints (375 / 768 / 1024 / 1280 / 1920) compiled into the production CSS as `@media (width>=Npx)` blocks (verified with `grep -oE "@media \(width>=[0-9]+px\)"` against `dist/dashboard/spa/assets/index-*.css`).

The `useViewMode` default is Basic when `window.innerWidth < 1024` (116-00 T09 `ADVANCED_VIEWPORT_BREAKPOINT_PX`), so:
- 375px (iPhone 14, iPhone SE) → Basic mode → stacked rows → no horizontal scroll (rows are full-width with no fixed widths anywhere; container is `px-4 py-4` flow layout)
- 1280px (laptop) → Advanced mode → 3-col grid (md:grid-cols-2 at 768-1279, xl:grid-cols-3 ≥1280)
- 1920px (desktop) → Advanced mode → 4-col grid (2xl:grid-cols-4 ≥1920)

**Runtime browser-pixel verification deferred to the phase verifier agent** (no headless-browser tool wired into this executor's sandbox; the daemon isn't running locally for this session so `/api/status` would return 503 anyway). The CSS + JS bundle static inspection above is the strongest verification possible without an interactive browser; combined with the unit tests (46/46) and the type-check (0 errors), the must-have #2 + #7 SATISFIED claims rest on solid evidence.

## Self-Check: PASSED

## Notes for downstream plans

- **116-02 (Tier 1 interactivity):**
  - Wire the no-op quick-action buttons to daemon IPC (restart-discord-bot, heartbeat-status with toast). Tooltips already advertise the wire-up; the components are unchanged.
  - F07 tool latency split panel: per the 116-00 SUMMARY's 'Notes for downstream plans', use `trace_spans` until Finding B's deeper fix lands.
  - **Per-tool cache breakdown:** add a backend handler (e.g., `case "cache"` extension with `per_tool_hit_rates: Record<string, number>` or a new `/api/agents/:name/tool-cache-breakdown`) and remove the forward-pointer note in ToolCacheGauge popover.
  - **Traces page:** ships the `/dashboard/v2/traces` route; remove the `e.preventDefault()` guard in MetricCounters.
- **116-04 (drawer + per-agent traces):**
  - Wire `openAgentDrawer(name)` in SloBreachBanner + AgentTile. Both already accept the callback prop.
  - Replace the 24h activity Skeleton in AgentTile with a real time-series chart.
  - Replace the 7d sparkline Skeleton in ContextMeter (gated by `showSparkline` prop) once the daily-rollup endpoint lands.
- **116-06 (settings / theme):**
  - Header settings cog tooltip says "Settings panel ships in 116-06". Wire it.
  - Basic-mode "Settings" quick-action button — same landing zone.
- **Bundle size:** 683KB JS / 214KB gzip — past the 500KB threshold Vite's chunk-warning surfaces. Recommend route-level code splitting (`React.lazy` + `Suspense`) when the drawer + traces page land in 116-04, especially around Recharts which dominates the bundle.
- **`/api/status` enrichment:** when migration phase + per-agent MCP health get added to the fleet entry shape, the AgentTile already has the loose passthrough plumbing — just extend the `AgentTile.agent` prop type and the data flows through.
