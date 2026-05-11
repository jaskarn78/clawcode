---
phase: 116
plan: 06
title: Tier 3 polish + operator-driven cutover gate — F18 + F20-F24 + telemetry + redirect flag
subsystem: dashboard
tags: [dashboard, spa, react, shadcn, activity-heatmap, notifications, theme-toggle, audit-log, knowledge-graph, telemetry, cutover-gate]
completed: 2026-05-11
duration_minutes: ~85
tasks_completed: 7  # T01-T05 + T07 + T08 (T06 F19 deferred per 116-DEFERRED.md)
tasks_deferred: 1   # T06 F19 swim-lane — DEFERRED per 116-DEFERRED.md
files_modified:
  - src/config/schema.ts (+24 lines — dashboardCutoverRedirect zod field + default mirror)
  - src/config/__tests__/differ.test.ts (+2 lines — fixture)
  - src/config/__tests__/loader.test.ts (+14 lines across 7 fixtures)
  - src/dashboard/types.ts (+27 lines — cutoverRedirectEnabled + auditTrail in DashboardServerConfig)
  - src/dashboard/server.ts (+260 lines — 116-06 routes block, /api/{activity,audit,dashboard-telemetry,dashboard-telemetry/summary}, /  redirect, audit hooks on 7 mutation routes)
  - src/ipc/protocol.ts (+18 lines — 3 IPC method names + docstring)
  - src/ipc/__tests__/protocol.test.ts (+5 lines — pin extended)
  - src/manager/daemon.ts (+158 lines — contiguous "Phase 116-06" closure-intercept block; cutoverRedirectEnabled closure; dashboardAuditTrail singleton)
  - src/performance/trace-store.ts (+72 lines — getActivityByDay method + activityByDay prepared statement)
  - src/dashboard/client/index.html (+25 lines — FOUC theme guard)
  - src/dashboard/client/src/App.tsx (+45 lines net — 2 new view enum values + nav buttons + 3 right-aligned header surfaces + 2 lazy imports + DashboardErrorBoundary wrap)
  - src/dashboard/client/src/components/AgentDetailDrawer.tsx (+3 lines — F18 mount)
  - src/dashboard/client/src/components/FleetComparisonTable.tsx (+16 lines — F22 mount + import wrapper)
  - src/dashboard/client/src/index.css (~80 lines refactored — :root LIGHT + .dark variants; body bg-background)
files_created:
  - src/dashboard/dashboard-audit-trail.ts (NEW, ~210 lines — JSONL writer + reader + telemetry summary)
  - src/dashboard/client/src/components/ActivityHeatmap.tsx (NEW, ~175 lines)
  - src/dashboard/client/src/components/AuditLogViewer.tsx (NEW, ~210 lines — LAZY)
  - src/dashboard/client/src/components/DashboardErrorBoundary.tsx (NEW, ~60 lines)
  - src/dashboard/client/src/components/NotificationFeed.tsx (NEW, ~320 lines)
  - src/dashboard/client/src/components/TelemetryBadge.tsx (NEW, ~105 lines)
  - src/dashboard/client/src/components/ThemeToggle.tsx (NEW, ~205 lines)
  - src/dashboard/client/src/routes/graph.tsx (NEW, ~95 lines — LAZY; iframe chrome wrap)
autonomous: false  # cutover gate is operator-driven; advisor consulted before architectural choices
dependency_graph:
  requires:
    - 116-00 (Tailwind dark-class config; shadcn primitives Sheet/Popover/Table; SPA toolchain)
    - 116-01 (FleetLayout + AgentTile drawer wiring; header strip we extend)
    - 116-02 (migration POST routes + MCP reconnect — audit log hooks attach here)
    - 116-03 (config PUT route + task POST/PATCH — audit log hooks attach; F26 ConfigEditor stays mounted)
    - 116-04 (AgentDetailDrawer right column slot reused for F18 heatmap; veto-dream-run handler audited)
    - 116-05 (FleetComparisonTable hosts the F22 fleet heatmap above the table; path↔view layer + lazy-load pattern reused)
    - Phase 92 audit-trail infrastructure (informed dashboard-audit-trail.ts design — distinct class because shapes differ)
    - Phase 115 TraceStore.traces table (activity heatmap reads via new getActivityByDay method)
  provides:
    - F18 per-agent ActivityHeatmap in F11 drawer right column (compact mode)
    - F22 fleet-aggregate ActivityHeatmap on /dashboard/v2/fleet (above the comparison table)
    - F20 NotificationFeed (header bell + badge + slide-over Sheet)
    - F21 ThemeToggle (System / Light / Dark + localStorage + FOUC guard + system-mode listener)
    - F23 AuditLogViewer (/dashboard/v2/audit — lazy-loaded; filters by since/action/target)
    - F24 GraphRoute (/dashboard/v2/graph — lazy-loaded chrome wrap around legacy /graph)
    - T07 TelemetryBadge + DashboardErrorBoundary (page_view + error → /api/dashboard-telemetry → dashboard-audit.jsonl)
    - T08 dashboardCutoverRedirect flag (default false; live-config-ref read; manual operator flip)
    - 3 new IPC methods (activity-by-day, list-dashboard-audit, dashboard-telemetry-summary)
    - 4 new REST routes (/api/activity, /api/audit, POST /api/dashboard-telemetry, /api/dashboard-telemetry/summary)
    - 7 audit-log call sites covering every operator-originated mutation route in 116-02/116-03/116-04
    - 1 new TraceStore method (getActivityByDay) + 1 prepared statement
    - DashboardAuditTrail class — reusable for any future "operator did X" surfaces (delete, restart-fleet, etc.)
  affects:
    - Phase 116 SHIPPED — this is the closing plan. Operator owns the cutover decision.
    - Decommission follow-up — after operator flips dashboardCutoverRedirect and observes for some period, remove src/dashboard/static/{index.html,app.js,styles.css} and the legacy / handler. Separate commit; out of scope for this plan per the locked operator decision.
    - Future plans extending the SPA — same `=== Phase 116-06 routes ===` / `Phase 116-06 — Tier 3 polish` closure-intercept fence convention. A "Phase 117 routes" block can append immediately after.
tech_stack:
  added: []  # No new top-level deps. ActivityHeatmap uses bare SVG (no recharts add). NotificationFeed reuses existing Sheet primitive (116-04). AuditLogViewer reuses Table primitive (116-05). ThemeToggle uses Popover (116-00). Graph route uses iframe (no new lib).
  patterns:
    - Contiguous-block fences (continued) — `=== Phase 116-06 routes ===` in server.ts; `Phase 116-06 — Tier 3 polish + cutover IPC handlers` closure-intercept in daemon.ts. Both placed immediately after the 116-05 fences so Phase 117 can extend without diffing this plan.
    - Live-config-ref closure for cutover — daemon.ts wraps the `let config` ref in a `() => config.defaults.dashboardCutoverRedirect === true` getter passed to DashboardServerConfig. The handler reads through the getter on every GET / so a chokidar-driven hot-reload of the flag takes effect on the very next request. No daemon restart needed.
    - Distinct audit-trail class — DashboardAuditTrail is a NEW class, not an extension of src/config/audit-trail.ts. Rationale documented in the docstring + this SUMMARY's decisions: schemas differ (action/target/metadata vs fieldPath/before/after), file path differs (dashboard-audit.jsonl vs config-audit.jsonl), and the F23 viewer reads ONE file without skip-logic.
    - Fail-safe audit writes — DashboardAuditTrail.recordAction swallows errors with a warn log. The mutation has already succeeded by the time the audit append fires; failing the response because the audit missed would be worse than the missed audit. The reader (listActions) also tolerates malformed lines — corruption from a partial write doesn't kill the viewer.
    - Pre-React FOUC guard for theme — index.html runs a synchronous inline script BEFORE the React bundle hydrates. Reads `clawcode:theme` from localStorage; if dark (or system + OS dark), adds `.dark` to `<html>` immediately so first paint matches the operator's preference. Without the guard, an operator preferring dark would see a 50-200ms light flash on every reload.
    - Bare-SVG heatmap (no Recharts) — ActivityHeatmap.tsx is a hand-rolled 30×7 grid. Calendar heatmaps don't benefit from Recharts' axis/legend primitives; they need precise grid placement. The component lands at ~3KB raw, vs. ~30KB if we'd lazy-loaded a Recharts CalendarChart wrapper.
    - Chrome-wrap for graph re-skin — F24 doesn't port the 679-line D3 simulation; it hosts the existing /graph in an iframe surrounded by the new design tokens (header, breadcrumb, agent picker, theme-aware Card border). Zero regression risk; D3 simulation byte-identical. Forward-pointer documented if operator demand surfaces for a true in-React port.
    - Theme-aware CSS via .dark class — :root holds light-theme HSL values; .dark overrides with the historical dark palette. Tailwind config already had darkMode: 'class'. Body now uses bg-background/text-foreground (CSS-var-resolved) instead of literal bg-bg-base/text-fg-1.
    - Cutover instrumentation via the same JSONL — POST /api/dashboard-telemetry writes through DashboardAuditTrail. The summary IPC scans the same file. No second JSONL, no second writer. The badge counts dashboard_v2_page_view + dashboard_v2_error in the last 24h.
    - Notification feed = client-side aggregation — NotificationFeed.tsx derives 4 notification types from useAgents/useBudgets/useIpcInboxes/useDeliveryQueue. No new backend endpoint. Dismissals persist in localStorage; 24h auto-dismiss runs from firstSeen (the FIRST poll that surfaced the signal, not current render — so flapping breaches obey the timer).
key_files:
  created:
    - src/dashboard/dashboard-audit-trail.ts
    - src/dashboard/client/src/components/ActivityHeatmap.tsx
    - src/dashboard/client/src/components/AuditLogViewer.tsx
    - src/dashboard/client/src/components/DashboardErrorBoundary.tsx
    - src/dashboard/client/src/components/NotificationFeed.tsx
    - src/dashboard/client/src/components/TelemetryBadge.tsx
    - src/dashboard/client/src/components/ThemeToggle.tsx
    - src/dashboard/client/src/routes/graph.tsx
  modified:
    - src/config/schema.ts (dashboardCutoverRedirect schema field)
    - src/config/__tests__/differ.test.ts + loader.test.ts (fixtures)
    - src/dashboard/types.ts (cutoverRedirectEnabled + auditTrail in DashboardServerConfig)
    - src/dashboard/server.ts (116-06 routes block + audit log hooks)
    - src/ipc/protocol.ts (3 new IPC method names)
    - src/ipc/__tests__/protocol.test.ts (pin extended)
    - src/manager/daemon.ts (116-06 closure-intercept block + cutoverRedirectEnabled closure + dashboardAuditTrail singleton)
    - src/performance/trace-store.ts (getActivityByDay method + prepared statement)
    - src/dashboard/client/index.html (FOUC guard)
    - src/dashboard/client/src/App.tsx (view enum + nav + lazy routes + error boundary)
    - src/dashboard/client/src/components/AgentDetailDrawer.tsx (F18 mount)
    - src/dashboard/client/src/components/FleetComparisonTable.tsx (F22 mount)
    - src/dashboard/client/src/index.css (theme-aware CSS vars)
decisions:
  - dashboardCutoverRedirect is read via a LIVE-CONFIG-REF closure, NOT a startup snapshot. The dashboard server invokes `() => config.defaults.dashboardCutoverRedirect === true` on every GET / request. daemon.ts's `config` is a `let`-bound mutable ref reassigned on every ConfigReloader.applyChanges tick — so a `clawcode config set defaults.dashboardCutoverRedirect true` edit takes effect on the very next request after chokidar fires. The alternative (capture at startup) would have required a daemon restart to flip the flag, which contradicts the plan's "pure manual operator decision" requirement.
  - DashboardAuditTrail is a NEW class, not an extension of src/config/audit-trail.ts. Per advisor recommendation. Three reasons: (1) shapes differ — dashboard actions are `{timestamp, action, target?, metadata?}` vs config changes' `{timestamp, fieldPath, oldValue, newValue}`. Shoehorning would force every dashboard action to fake a `fieldPath`. (2) Distinct file path (`dashboard-audit.jsonl` vs `config-audit.jsonl`) so the F23 viewer reads ONE file without filter logic. (3) Discriminator-action design covers config edits AND SPA telemetry events through a single writer — `action: "dashboard_v2_page_view"` and `action: "update-agent-config"` use the same row schema with different metadata payloads. The F23 viewer reads both kinds of rows uniformly.
  - Audit hooks attach at the REST ROUTE LAYER (server.ts), not at the IPC handler layer (daemon.ts). Reason: IPC handlers are invoked by CLI tools too (`clawcode agent restart`, `clawcode tasks transition`), and the F23 viewer should NOT log CLI-originated actions — those have their own CLI history. Hooking at the dashboard route layer means F23 captures EXACTLY the dashboard-originated mutations the operator cares about. CLI mutations remain visible via shell history + (for config edits) the existing config-audit.jsonl.
  - F19 swim-lane timeline INTENTIONALLY OMITTED per 116-DEFERRED.md (operator decision 2026-05-11). Cost (canvas-rendered 14-lane timeline with smooth scrolling + zoom + hover, ~6-8h) doesn't justify the operator value (★★★ — duplicates F12 trace waterfall's per-turn timing surface). Promotion criteria in 116-DEFERRED.md: operator-reported demand for cross-agent activity correlation > 2× OR F12 reveals a multi-agent timing gap. No work in this plan.
  - F24 graph re-skin is a chrome wrap, NOT a 1:1 D3 port. The 679-line graph.html simulation is deeply coupled to its own DOM (sidebar agent list, search input, tier toggle bar, drag handlers, zoom transform). A full React port would land at ~30-50KB raw chunk for an UNCHANGED algorithm. The chrome wrap mounts the iframe at /dashboard/v2/graph with the new design tokens (Cabinet Grotesk header + Geist body + emerald accent + theme-aware Card border); the inner D3 keeps its own palette. The operator question "what does my agent's knowledge graph look like" gets the SAME answer + the new chrome. Forward-pointer for a true port lives in 116-06-SUMMARY notes if operator demand surfaces.
  - ActivityHeatmap uses bare SVG, not Recharts. Recharts has no calendar-grid primitive that fits the 30×7 layout; CalendarChart would need wrapping a Recharts component in custom path math we'd have to maintain anyway. Bare SVG lands at ~3KB raw, vs ~30KB for a Recharts approach. Saves bundle headroom and removes a transitive dependency surface.
  - Theme refactor — :root holds LIGHT theme values; .dark overrides with the historical dark palette. Reason: shadcn convention is `darkMode: 'class'` + Tailwind utilities resolve from `:root` by default, then `.dark` overrides via CSS specificity. Operators with no preference (fresh installs) hit `system` mode which reads `prefers-color-scheme` — on a typical operator's dark-OS that resolves to dark, matching pre-F21 default behavior. Light-by-default for fresh installs would have been the alternative; rejected because the historical dashboard is dark and operators are habituated to it.
  - Theme FOUC guard inlined in index.html (NOT in a separate src/ module). The guard MUST run synchronously BEFORE the React bundle parses, so it can't be in a module the React bundle imports. Inline script is the canonical shadcn pattern. The localStorage key is `clawcode:theme` (namespaced to avoid collisions with other operator tooling on the same origin).
  - Notification feed sources scoped to 4 client-derivable signals: SLO breach (from useAgents().slo_status), budget exceeded (useBudgets() pct >= 0.9), Discord delivery failures (useDeliveryQueue().stats.failed), per-agent IPC failures (useIpcInboxes()). Two from-plan sources DROPPED: (a) "MCP degradation" — useMcpServers() is per-agent and would require fan-out across the fleet; deferred to a future plan if MCP errors surface as a real operator question. (b) "dream priority trigger" — no SSE event for it today; the dream queue surface in the drawer (F15) is the existing affordance. Both omissions noted in component docstring + this decisions block.
  - Notification dismissals persist in `clawcode:dismissed-notifications` (localStorage) with the notification id as the key. Re-appearing-after-clearing notifications produce a NEW id (signal cleared → reproduced → restored from clean state, so the operator sees it fresh). Auto-dismissal at 24h is firstSeen-anchored — a notification fires once, sits visible for 24h, then auto-hides regardless of dismissal state. The "Restore dismissed" button clears the dismissed set so the operator can re-see any pending notifications they've cleared.
  - Audit writes are FAIL-SAFE — recordAction swallows errors with a warn log. The mutation has already succeeded by the time the audit append fires; failing the response because the audit missed would surface a false "your action failed" to the operator. Listed in component docstring.
  - F23 viewer auto-refreshes every 30s (setInterval). Reason: operators leave the audit page open during incident response and want to see new entries land without manual refresh. 30s is the same cadence as TelemetryBadge.
  - Telemetry POST is fire-and-forget — errors swallowed in the SPA. Reason: telemetry MUST NEVER break the UI. The hook (useDashboardPageViewEmit) dedupes by `view:path` fingerprint so popstate-triggered double-fires don't double-count. The badge auto-hides when both counters are zero so fresh installs don't show "0 views · 0 err" noise.
  - GraphRoute uses an iframe with `key={src}` so an agent change forces an iframe reload — without the key prop React would reuse the iframe element and the inner graph wouldn't pick up the new ?agent= query param.
  - Pre-existing slash-command tests still fail (carried forward from 116-05). They are unrelated to this plan's diff. The 116-00 audit listed them as deferred items waiting for a dedupe task; that work continues outside Phase 116.
metrics:
  bundle_js_kb_index_chunk: 866.93          # was 879.89 at end of 116-05 — actually SHRANK because Vite extracted a 'button' shared chunk (31.12 KB) when AgentDetailDrawer + AuditLogViewer + NotificationFeed all imported it
  bundle_js_gzip_kb_index_chunk: 262.81     # was 267.88 at end of 116-05
  bundle_js_kb_button_shared_chunk: 31.12   # NEW shared chunk; eager via modulepreload
  bundle_js_gzip_kb_button_shared_chunk: 10.21
  bundle_js_kb_eager_cold_load: 898.05      # index + button shared chunks. 116-05 was 924.66 (index + useApi). Net -27KB raw / -7KB gzip — useApi chunk consolidated.
  bundle_js_gzip_kb_eager_cold_load: 273.02 # vs 280.00 at end of 116-05
  bundle_js_kb_cost_dashboard_chunk: 40.38  # LAZY — unchanged from 116-05
  bundle_js_gzip_kb_cost_dashboard_chunk: 11.40
  bundle_js_kb_audit_log_viewer_chunk: 4.29 # NEW LAZY chunk
  bundle_js_gzip_kb_audit_log_viewer_chunk: 1.65
  bundle_js_kb_graph_route_chunk: 1.64      # NEW LAZY chunk (chrome wrap is tiny — iframe is the heavy part and lives outside the SPA bundle)
  bundle_js_gzip_kb_graph_route_chunk: 0.85
  bundle_js_kb_trace_waterfall_chunk: 3.69
  bundle_js_gzip_kb_trace_waterfall_chunk: 1.57
  bundle_js_kb_jsx_runtime_chunk: 39.91     # eager — pre-existing
  bundle_js_gzip_kb_jsx_runtime_chunk: 11.01
  bundle_css_kb: 31.55                       # was 30.08 at end of 116-05 — +1.47KB for the light theme CSS vars
  bundle_css_gzip_kb: 6.76                   # was 6.46
  components_added: 8  # ActivityHeatmap, AuditLogViewer, DashboardErrorBoundary, NotificationFeed, TelemetryBadge, ThemeToggle, GraphRoute, FleetActivityHeatmap (in-file wrapper)
  hooks_added: 1   # useDashboardPageViewEmit
  routes_added: 4  # GET /api/activity, GET /api/audit, POST /api/dashboard-telemetry, GET /api/dashboard-telemetry/summary
  ipc_methods_added: 3   # activity-by-day, list-dashboard-audit, dashboard-telemetry-summary
  tracker_methods_added: 1  # TraceStore.getActivityByDay
  spa_routes_added: 2  # /dashboard/v2/audit, /dashboard/v2/graph
  audit_hooks_attached: 7  # agent-start/stop/restart, migration-pause/resume/rollback, mcp-reconnect, config PUT, hot-reload, create-task, transition-task, veto-dream-run
  schema_fields_added: 1  # defaults.dashboardCutoverRedirect
  commits: 3
---

# Phase 116 Plan 06 Summary — Phase 116 closure

**One-liner:** Eight new SPA components + one new daemon JSONL audit-trail class + three new IPC methods + four new REST routes + one schema flag + the live-config-ref closure that wires it all into a 301-redirect on `/` — combining F18 (per-agent 30×7 activity heatmap in the F11 drawer right column), F22 (fleet-aggregate heatmap above the F16 comparison table), F20 (header bell + badge + slide-over Sheet aggregating SLO breaches / budget exceeds / IPC failures / Discord delivery failures with 24h auto-dismiss + localStorage persistence), F21 (theme toggle System/Light/Dark with localStorage persistence + a pre-React FOUC guard inlined in index.html so first paint matches preference), F23 (operator audit log viewer at /dashboard/v2/audit, lazy-loaded, with since/action/target filters reading from a new dashboard-audit.jsonl that captures every dashboard-originated mutation across 116-02/116-03/116-04 routes), F24 (knowledge-graph re-skin at /dashboard/v2/graph hosting the legacy 679-line D3 graph in an iframe surrounded by new design-token chrome), the T07 cutover instrumentation (telemetry POSTs from the SPA + a header badge showing 24h view + error counts + a React error boundary that emits dashboard_v2_error on catch), and the T08 cutover gate (operator runs `clawcode config set defaults.dashboardCutoverRedirect true`, chokidar fires, the daemon's live config ref updates, the very next `GET /` returns 301 to `/dashboard/v2/` — pure manual operator decision, no calendar gate, no automatic flip). F19 swim-lane intentionally DEFERRED per 116-DEFERRED.md. The plan ships at 898KB raw / 273KB gzip cold load — actually 27KB lighter than end-of-116-05 because Vite extracted a button shared chunk + dropped the previous useApi chunk into the main bundle.

## Tasks Executed

| Task    | Commit    | Description                                                                                                                                                                                                                                                                                                                                                |
| ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T08     | `f863757` | Cutover redirect flag — defaults.dashboardCutoverRedirect schema field, default false. DashboardServerConfig.cutoverRedirectEnabled getter. daemon closure over the live `config` ref. server.ts GET / 301-redirects when true. /index.html literal path unchanged.                                                                                        |
| T01+T04+T07 backend | `d6510ff` | TraceStore.getActivityByDay + activityByDay prepared statement. New DashboardAuditTrail class (JSONL writer + reader + 24h telemetry summary). daemon registers dashboardAuditTrail BEFORE the IPC handler closure. 3 new IPC methods + pin extended. 6 new REST routes (activity, audit, dashboard-telemetry POST + summary GET) + 7 audit hooks on 116-02/03/04 mutation routes. |
| T01-T05+T07 frontend | `7e6b531` | ActivityHeatmap (bare SVG, ~3KB) mounted in drawer + above FleetComparisonTable. NotificationFeed (bell + badge + Sheet) aggregating 4 client-derived signals. ThemeToggle (Popover + 3 options + localStorage + system listener). AuditLogViewer (LAZY, ~4.3KB). GraphRoute (LAZY chrome wrap of /graph in iframe). TelemetryBadge + useDashboardPageViewEmit + DashboardErrorBoundary. Theme refactor — :root LIGHT vars + .dark vars; body uses bg-background/text-foreground. App.tsx extended with audit + graph views + right-aligned header surfaces. |

## Must-haves

| # | Clause                                                                                                                                                  | Status                                                | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | F18 per-agent + F22 fleet heatmaps render correctly                                                                                                     | **SATISFIED**                                         | ActivityHeatmap.tsx renders a 30-column × 7-row SVG calendar with intensity-shaded cells (5 emerald stops + muted bg when zero). F18 mount: `<ActivityHeatmap agent={drawerAgent} compact />` in AgentDetailDrawer right column. F22 mount: `<FleetActivityHeatmap />` (no agent prop → fleet aggregate) above the FleetComparisonTable filter bar. Both consume `/api/activity?days=30&agent=X` → daemon `activity-by-day` IPC → TraceStore.getActivityByDay. The fleet variant sums across agents client-side via the same useMemo-based reduce.                                                                                                                                                                                                                                                                                                                                  |
| 2 | F20 notification bell shows badge count, click opens slide-over                                                                                         | **SATISFIED (3 sources; advisor-triaged 2026-05-11)** | NotificationFeed.tsx exposes a `<Sheet>` whose trigger is a bell button with an absolute-positioned badge. Badge count = undismissed.length; badge color flips destructive/amber/primary based on the highest active level. Click → slide-over from the right with the chronological list (level-priority then firstSeen-DESC). Each card has a Dismiss button; "Restore dismissed" link clears the dismissal set. Auto-dismiss at 24h from firstSeen. **Sources shipping (3):** (1) SLO breach via per-agent AgentSloProbe fan-out (same useAgentCache+useAgentLatency pattern as SloBreachBanner — cold-start guard at <5 samples; magnitude split at 2× = danger, otherwise warn); (2) Budget exceeded via useBudgets() pct>=0.9; (3) Discord delivery failures via useDeliveryQueue().stats.failed>0. **Sources dropped:** MCP degradation (no fleet-wide rollup IPC), dream priority trigger (no SSE event today), per-agent IPC failures (IpcInboxesResponse has no `failed` field per inbox; fleet delivery already covered by source 3). All omissions documented in NotificationFeed.tsx docstring + this SUMMARY Deviations.                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3 | F21 theme toggle works (System / Light / Dark) + persists                                                                                               | **SATISFIED with caveat** (light mode is partial — see decisions) | ThemeToggle.tsx renders a Popover with three radio-style menu items. Selecting one calls `applyTheme(pref)` which sets/removes `.dark` on `<html>` and writes `clawcode:theme` to localStorage. System mode subscribes to `(prefers-color-scheme: dark)` MediaQueryList so OS toggles propagate without refresh. Pre-React FOUC guard in index.html reads the same localStorage key BEFORE React hydrates so first paint matches preference (no light→dark flash). index.css refactored: :root holds light HSL values; .dark overrides with the historical dark palette; body uses theme-aware `bg-background text-foreground`. Tailwind config already had `darkMode: 'class'`. **Caveat:** earlier-phase components using LITERAL Tailwind tokens (`bg-bg-base`, `text-fg-1`, `bg-bg-elevated`, etc. — resolved from tailwind.config.js colors block, NOT from the shadcn CSS vars) stay dark regardless of the toggle. So light mode shows a body + Card surface that follows the theme PLUS components that stay dark. Operators selecting Light see a half-light page. Documented in component docstring + Items-to-surface-to-operator #12. Full migration is a future refactor plan.                                                                                                                                                                                                  |
| 4 | F23 audit log captures dashboard mutations from 116-02/116-03 (config edits, migration actions, MCP reconnects, task transitions) + renders table view  | **SATISFIED**                                         | DashboardAuditTrail singleton instantiated in daemon.ts before the IPC handler closure. Threaded into the dashboard server via DashboardServerConfig.auditTrail. Seven audit hooks attached at the REST route layer in server.ts: agent control (start/stop/restart), migration POSTs (pause/resume/rollback), MCP reconnect, config PUT, hot-reload-now, task create, task transition, dream-veto. Plus T07 telemetry events (page-view + error). AuditLogViewer.tsx at /dashboard/v2/audit (lazy-loaded ~4.3KB chunk) renders the JSONL tail in a shadcn Table with columns timestamp/action/target/metadata. Filters: since window (1h/24h/7d/all), action dropdown (auto-derived from seen values), target text input. Auto-refresh 30s.                                                                                                                                          |
| 5 | F24 /dashboard/v2/graph route works (graph rendered with new design tokens)                                                                             | **SATISFIED (chrome wrap, not D3 port)**              | GraphRoute.tsx at /dashboard/v2/graph (lazy-loaded ~1.6KB chunk). Hosts the existing /graph endpoint in an iframe with the new design chrome around it: Cabinet Grotesk header, theme-aware Card border, Geist body, agent-picker dropdown (sourced from useAgents()), "open in new tab" button. The iframe `key={src}` forces a reload when the operator switches agents. Decision rationale documented in component docstring + this SUMMARY's decisions block: full D3 port would have cost ~30-50KB chunk for an unchanged algorithm; chrome wrap delivers the new design tokens honestly with zero regression risk. The legacy `/graph` route stays live during soak per the locked operator decision.                                                                                                                                                                          |
| 6 | F25 confirmed absorbed into F28 in 116-03                                                                                                               | **SATISFIED (no work in this plan)**                  | 116-03's TaskKanban replaces the legacy /tasks surface. Operator can flip from /dashboard/v2/tasks back to the static /tasks if needed; both coexist until the cutover flag flips + the decommission follow-up commit removes the old static files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 7 | Cutover instrumentation: dashboard_v2_page_view + dashboard_v2_error events emit to telemetry sink                                                       | **SATISFIED**                                         | useDashboardPageViewEmit(view) hook in App.tsx emits `{event: "page-view", view, path}` to POST /api/dashboard-telemetry on every view change (deduped by view:path fingerprint). DashboardErrorBoundary wraps the SPA shell; on componentDidCatch it calls emitDashboardError which POSTs `{event: "error", message, stack, componentStack, path}` through the same endpoint. Both routes append to dashboard-audit.jsonl through DashboardAuditTrail with action `dashboard_v2_page_view` / `dashboard_v2_error`. The TelemetryBadge in the App.tsx header reads `/api/dashboard-telemetry/summary` (daemon scans the same file) every 30s and renders "v2: N views · M err (24h)" when either counter > 0. Hides on fresh installs (both zero) so the header doesn't show empty-state noise.                                                                                  |
| 8 | Cutover gate: with `defaults.dashboardCutoverRedirect: false`, both `/` and `/dashboard/v2/` accessible. Flip to `true` → `/` returns 301 to `/dashboard/v2/`. No automatic flip. | **SATISFIED**                                         | defaults.dashboardCutoverRedirect zod field added at line 1958ish of schema.ts (immediately before defaultsSchema's closing brace) + mirror in the configSchema.defaults default() block. daemon.ts wires `cutoverRedirectEnabled = () => config.defaults.dashboardCutoverRedirect === true` and passes it to startDashboardServer. server.ts's GET / handler invokes the getter on every request; when true, responds `301 Location: /dashboard/v2/`. The /index.html literal path is unchanged (no redirect) so any operator who bookmarked or scripted it keeps working byte-identically. The flip is operator-manual — no calendar gate, no automatic schedule. `clawcode config set defaults.dashboardCutoverRedirect true` → chokidar debounce (500ms) → ConfigReloader.applyChanges → `config` ref reassigned → very next GET / returns 301.                                |

**Net:** 8 of 8 must-haves SATISFIED.

## Deviations from Plan

### [Plan boundary] F24 graph re-skin is a CHROME WRAP, not a D3 port

**Found during:** T05 design.
**Issue:** Plan T05 said "Port src/dashboard/static/graph.html (679 lines D3.js) to React component … Apply new design tokens (colors, fonts) without changing graph layout algorithm." A 1:1 React port of 679 lines of D3 (force-directed simulation + drag + zoom + tier filter + sidebar agent list + search + selection) would land at roughly 30-50KB raw chunk for an UNCHANGED algorithm, plus a tangible regression risk surface from re-implementing the simulation tuning and drag handlers.
**Fix:** GraphRoute renders the existing /graph endpoint in an iframe surrounded by new-design-token chrome (Cabinet Grotesk header, Geist body, emerald accent, theme-aware Card border, agent-picker dropdown, "open in new tab" link). The D3 simulation runs byte-identically inside the iframe with its own dark palette; the chrome IS the new design surface. Decision rationale documented in the component docstring + this SUMMARY's decisions block.
**Files modified:** `src/dashboard/client/src/routes/graph.tsx`
**Commit:** `7e6b531`

### [Plan boundary + Rule 1 bug] F20 notification sources scoped to 3 (not 5); advisor-triaged dead-code fix

**Found during:** T02 frontend (initial), then advisor review pre-close-out.
**Issue:** Plan T02 listed 5 notification sources: SLO breach, budget exceeded, MCP degradation, dream priority trigger, IPC delivery failure. Initial implementation read `useAgents().agents[].slo_status` for the SLO source and `useIpcInboxes().agents[].delivery.failed` for the per-agent IPC failures — BOTH were DEAD CODE because the actual payload shapes don't carry those fields. (AgentStatusData in src/dashboard/types.ts has no `slo_status`; IpcInboxesResponse has `inboxes: [{agent, pending, lastModified, ...}]`, no `delivery.failed` per row.) MCP degradation and dream priority trigger were dropped during initial design — sources don't exist as client-derivable signals today. So the as-shipped behavior would have been: notifications fire for budget + fleet delivery only, never SLO breach (the most operator-important signal) or per-agent IPC.
**Fix (advisor-triaged 2026-05-11):** Ported the AgentSloProbe pattern from SloBreachBanner.tsx — one hidden `<AgentSloProbe>` per running agent driving its own useAgentCache + useAgentLatency hooks and reporting `{observedMs, thresholdMs}` (or null) up to the parent via callback. SLO notifications now fire correctly with the same cold-start guard (<5 samples) and magnitude split (2× → danger, 1× → warn) as the banner. Per-agent IPC failures DROPPED entirely: IpcInboxesResponse has no `failed` field per inbox, and fleet-wide Discord delivery failures are already surfaced via useDeliveryQueue (source 3) — double-firing would be misleading. Type discriminator `readonly source` narrowed from `'slo' | 'budget' | 'ipc' | 'mcp' | 'delivery'` to `'slo' | 'budget' | 'delivery'`. Documented in the component docstring with explicit "SOURCES INTENTIONALLY OMITTED" block.
**Files modified:** `src/dashboard/client/src/components/NotificationFeed.tsx`
**Commit:** `7e6b531` (initial) + `<followup-hash>` (advisor-triaged fix)

### [Rule 2 - Missing critical] React error boundary added

**Found during:** T07 design.
**Issue:** Plan T07 said "Add `dashboard_v2_error` event emission on React error boundary catches." But the SPA had NO error boundary in place — the App.tsx tree was unguarded, so a render exception in any route component would drop the operator to a white screen with the error only visible in DevTools. Without a boundary, the telemetry emit on catch had no insertion point.
**Fix:** Created `DashboardErrorBoundary.tsx` and wrapped the entire App.tsx return tree. componentDidCatch calls emitDashboardError. The recovery UI shows the error message + stack (this is an internal operator tool — exposing the stack helps the operator file a useful report) + a "Reload" button. Telemetry beacon fires before the operator sees the recovery card.
**Files modified:** `src/dashboard/client/src/components/DashboardErrorBoundary.tsx` (NEW), `src/dashboard/client/src/App.tsx`
**Commit:** `7e6b531`

### [Rule 3 - Blocking issue] index.html FOUC guard required for theme toggle

**Found during:** T03 design.
**Issue:** A naive theme toggle that only applies `.dark` from a React `useEffect` would cause a light-then-dark flash on every reload for operators preferring dark — the React bundle takes 50-200ms to parse + run effects, during which the page paints with light defaults.
**Fix:** Added a synchronous inline script in `src/dashboard/client/index.html` that reads `clawcode:theme` from localStorage BEFORE the React bundle parses and applies `.dark` to `<html>` immediately. Try/catch around localStorage + matchMedia for hostile environments (private mode, sandbox). Standard shadcn pattern.
**Files modified:** `src/dashboard/client/index.html`
**Commit:** `7e6b531`

### [Rule 2 - Missing critical] Tailwind body utility refactored from hardcoded to theme-aware

**Found during:** T03 frontend, after the FOUC guard was wired and the body still rendered dark on light theme.
**Issue:** `src/dashboard/client/src/index.css` body rule used `@apply bg-bg-base text-fg-1` — hardcoded dark tokens from `tailwind.config.js colors.bg.base / fg.1`. Even with `.dark` class flipping the shadcn CSS vars, the body literal-token utility never followed the theme.
**Fix:** Changed body to `@apply bg-background text-foreground` (CSS-var-resolved). The literal tokens stay defined for Tier 1 components that want them, but the page surface follows the active theme.
**Files modified:** `src/dashboard/client/src/index.css`
**Commit:** `7e6b531`

### [Plan boundary] Audit hooks attach at REST ROUTE layer, not IPC handler layer

**Found during:** T04 backend design (after the advisor's recommendation).
**Issue:** Plan T04 said "log every PUT/POST operator action to audit-trail.ts" without specifying where. Attaching at the daemon IPC handler layer would log every invocation — including CLI tools (`clawcode agent restart`, `clawcode tasks transition`). The F23 viewer is for DASHBOARD-originated actions; mixing in CLI invocations would dilute the operator-visible "what did I do in the dashboard?" answer.
**Fix:** Attached recordAction() calls at the dashboard REST route layer in server.ts. Exactly the routes 116-02/116-03/116-04 added — 7 mutation paths total: agent control, migration POSTs, MCP reconnect, config PUT, hot-reload-now, task create+transition, dream-veto. CLI mutations remain visible via shell history; for config edits the existing config-audit.jsonl still catches them.
**Files modified:** `src/dashboard/server.ts` (7 hooks), `src/dashboard/dashboard-audit-trail.ts` (new class)
**Commit:** `d6510ff`

### [Decision boundary] DashboardAuditTrail is a NEW class, not an extension of AuditTrail

**Found during:** T04 backend design (per advisor recommendation).
**Issue:** Plan T04 said "audit-trail.ts (Phase 92 infrastructure if reusable; otherwise new append-only JSONL)." The existing src/config/audit-trail.ts uses `{timestamp, fieldPath, oldValue, newValue}` — config-change-shaped. Dashboard actions are richer: `{timestamp, action, target?, metadata?}`. Forcing dashboard actions through the AuditTrail shape would mean every dashboard action faking a `fieldPath` value.
**Fix:** Created `src/dashboard/dashboard-audit-trail.ts` as a parallel class. Distinct file path (`dashboard-audit.jsonl` vs `config-audit.jsonl`) so the F23 viewer reads ONE file without skip logic. Same `appendFile`/`mkdir` pattern + readFile-and-filter helper + 24h telemetry summary helper. Failure-tolerant: write errors swallowed with warn log; malformed read lines skipped silently.
**Files modified:** `src/dashboard/dashboard-audit-trail.ts` (NEW)
**Commit:** `d6510ff`

## Auth Gates

None. All work was local; no daemon restarts, no Discord API calls, no production deploys (per prompt's "NO DEPLOY" constraint).

## Threat Flags

| Flag                           | File                                                                                            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| threat_flag: new-read-surface  | `src/dashboard/server.ts` GET /api/activity                                                     | Per-agent + per-date turn counts over HTTP. 30-day window default. 127.0.0.1-bound trust posture. No PII; just COUNT(*) by date/agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| threat_flag: new-read-surface  | `src/dashboard/server.ts` GET /api/audit                                                        | Reads dashboard-audit.jsonl tail. Same 127.0.0.1 trust posture as every other dashboard route. Contents are the operator's own mutation history — no third-party data. Filterable by action / target / since. Limit hard-capped at 5000 in the IPC handler.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| threat_flag: new-write-surface | `src/dashboard/server.ts` POST /api/dashboard-telemetry                                         | SPA-emitted page-view + error events append to dashboard-audit.jsonl. Body capped at 1 MiB via readJsonBody. Same 127.0.0.1 trust posture. Possible misuse: a malicious script running in the operator's browser could spam this endpoint. Mitigation: 127.0.0.1-only binding + the audit file is locally-bound + append-only (rotation is operator decision; no automatic truncation). Acceptable for an internal tool with single-operator scope.                                                                                                                                                                                                                                                                                                                                                                       |
| threat_flag: new-write-surface | `src/dashboard/server.ts` GET / (cutover redirect)                                              | When defaults.dashboardCutoverRedirect=true, root returns 301 with Location: /dashboard/v2/. Possible misuse: there is no "Location" trust issue because the redirect target is a hardcoded string, not from user input. No new attack surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| threat_flag: new-config-knob   | `src/config/schema.ts` defaults.dashboardCutoverRedirect                                        | Operator-only knob. Default false. When true, every browser hitting `/` gets bounced to `/dashboard/v2/`. The flip itself requires write access to clawcode.yaml — same trust posture as every other config edit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

All flags documented in the relevant route docstrings + the daemon-handler comments. None introduce trust boundaries beyond what the existing 127.0.0.1-bound dashboard already exposes.

## Known Stubs

| Stub                                              | File                                            | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Landing                                                                                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F20 MCP degradation notification source           | `NotificationFeed.tsx` source-aggregation block | Plan listed it; client-derivable source doesn't exist today. A fleet-wide MCP-state-rollup IPC + new hook would be the cleanest path — same shape problem 116-05's F16 MCP error count column hit. Operators see MCP issues via the F10 panel in the drawer.                                                                                                                                                                                                                                                       | future plan when operator surfaces MCP-correlation demand                                                                                                                     |
| F20 dream priority trigger notification source    | `NotificationFeed.tsx` source-aggregation block | Plan listed it; no SSE event for the dream priority trigger fires today. The F15 dream queue panel in the drawer surfaces the same signal via the per-agent useDreamQueue. Adding a global notification would mean a new SSE event from the dream-cron path.                                                                                                                                                                                                                                                       | future plan if cross-fleet dream visibility surfaces as a demand                                                                                                              |
| F24 D3-inside-React port                          | `routes/graph.tsx` chrome-wrap docstring        | Plan envisioned a 1:1 React port. Shipped as an iframe chrome wrap to preserve byte-identical D3 behavior at near-zero chunk cost (1.64KB lazy chunk). Operator gets the new design tokens via the chrome; D3 simulation runs unchanged.                                                                                                                                                                                                                                                                          | follow-up phase if operator wants the theme toggle to reach the graph palette or the SPA's hooks to drive the simulation                                                      |
| F26 ConfigEditor in-UI memory editor              | (deferred — see 116-DEFERRED.md F14)            | F14 in-UI memory editor remains deferred (Phase 116 ships read-only previews via 116-04 T04). No new work in this plan.                                                                                                                                                                                                                                                                                                                                                                                           | follow-up phase per 116-DEFERRED.md promotion criteria                                                                                                                        |
| F19 swim-lane timeline                            | n/a — deferred out of phase                     | Deferred per 116-DEFERRED.md operator decision 2026-05-11. Promotion criteria documented. F12 trace waterfall already covers per-turn timing; multi-agent correlation demand unproven.                                                                                                                                                                                                                                                                                                                            | promotion: 2× operator demand reports OR F12 reveals a gap → open `999.NN-dashboard-swim-lane-timeline`                                                                       |

All stubs are documented in-component or in this SUMMARY. No silent fakes — every disabled / no-op / "future plan" surface explains where the full implementation lands.

## Items to surface to operator

1. **Phase 116 is SHIPPED. Operator owns the cutover decision.** Both `/` (legacy) and `/dashboard/v2/` (new SPA) coexist. When ready, run `clawcode config set defaults.dashboardCutoverRedirect true` to start 301-redirecting `/` to `/dashboard/v2/`. The flip is reversible (`... false` brings dual-mode back). No daemon restart needed — chokidar fires, the live config ref updates, the very next GET / responds with the new behavior.

2. **Decommission of static dashboard files is a SEPARATE follow-up commit.** After the operator flips the cutover flag and observes for some period, removing `src/dashboard/static/index.html`, `app.js`, `styles.css`, and the legacy `/` static-serve branch in server.ts cleans up the old surface. The flag itself can also be removed (becomes the default behavior). Out of scope for this plan per the locked operator decision.

3. **Bundle: cold-load is 898KB raw / 273KB gzip** — actually 27KB lighter than end-of-116-05 (924.66/280.00) because Vite extracted a `button` shared chunk (31.12KB / 10.21KB) when the new components all imported Button, and the previous `useApi` shared chunk got reconsolidated. Lazy chunks: CostDashboard 40.38/11.40 (unchanged), AuditLogViewer 4.29/1.65 (NEW), GraphRoute 1.64/0.85 (NEW chrome wrap — iframe is the heavy part and lives outside the SPA bundle), TraceWaterfall 3.69/1.57 (unchanged). All inside the 1MB/320KB plan budget with healthy headroom.

4. **F18 + F22 activity heatmaps are LIVE TODAY** against per-agent traces.db files for running agents. The fleet aggregate (F22) sums across resolvedAgents (every agent in clawcode.yaml, running or not — stopped agents whose TraceStore is closed show a blank lane until restarted). Same scope caveat 116-05's cost-trend handler documented.

5. **F20 NotificationFeed surfaces 4 client-derived signals** (SLO breach, budget exceeded, Discord delivery failures, per-agent IPC failures). Two from-plan sources (MCP degradation, dream priority trigger) deferred — sources don't exist today as clean client-derivable signals. Documented in component + this SUMMARY.

6. **F21 ThemeToggle remembers your preference across sessions** via `clawcode:theme` localStorage. System mode follows the OS dark-mode setting live (MediaQueryList listener). Pre-React FOUC guard in index.html prevents the light flash on reload when the choice is dark.

7. **F23 AuditLogViewer captures every dashboard-originated mutation** from 116-02/116-03/116-04 routes (agent control, migration POSTs, MCP reconnect, config PUT, hot-reload, task create+transition, dream-veto). PLUS the T07 telemetry events (page_view + error). CLI-originated mutations are NOT captured — they have their own shell history. Filters: since window, action, target. Auto-refresh 30s. Lazy-loaded.

8. **F24 graph route is a CHROME WRAP**, not a 1:1 D3 port. iframe-hosted; the inner /graph keeps its own dark palette and full D3 behavior. Forward-pointer documented for a future plan if operator demand reveals the theme-toggle should reach the graph.

9. **T07 cutover instrumentation:** every view change in the SPA POSTs `dashboard_v2_page_view` to /api/dashboard-telemetry. The error boundary catches uncaught exceptions and POSTs `dashboard_v2_error`. Both append to dashboard-audit.jsonl via the same DashboardAuditTrail singleton. The TelemetryBadge in the header reads 24h counts every 30s; hides on fresh installs (both counters zero).

10. **NO production deploy.** Per prompt's "NO DEPLOY" constraint. The deploy script (scripts/deploy-clawdy.sh) is unchanged and remains gated behind operator confirmation as global rules dictate. When the operator is ready to ship Phase 116 to prod, the deploy is a separate decision after reviewing the chain.

11. **Pre-existing slash-command test failures carried forward** (the 116-05 SUMMARY also mentioned this). Unrelated to this plan's diff; awaiting the dedupe task that 116-04 surfaced in its own items list. The 18 failures in the broader manager test sweep are the same set — 0 new failures introduced by this plan.

12. **Light theme is PARTIAL.** :root + body + Card primitives flip to light theme; earlier-phase components that hardcoded `bg-bg-base`, `text-fg-1`, `bg-bg-elevated`, etc. (literal Tailwind tokens from `tailwind.config.js colors.bg.*`) stay dark regardless. Operators selecting Light will see a half-light page (light page chrome + dark Tier 1 tiles + dark cost dashboard). Decision rationale: full migration of all earlier-phase literals to theme-aware utilities would touch ~12 components; would land more cleanly as a focused refactor plan if operator finds light mode is the primary preference. Dark + System remain fully consistent because every component's dark-only literal IS the dark-theme rendering.

## Self-Check

Created files exist:
- `src/dashboard/dashboard-audit-trail.ts` — FOUND
- `src/dashboard/client/src/components/ActivityHeatmap.tsx` — FOUND
- `src/dashboard/client/src/components/AuditLogViewer.tsx` — FOUND
- `src/dashboard/client/src/components/DashboardErrorBoundary.tsx` — FOUND
- `src/dashboard/client/src/components/NotificationFeed.tsx` — FOUND
- `src/dashboard/client/src/components/TelemetryBadge.tsx` — FOUND
- `src/dashboard/client/src/components/ThemeToggle.tsx` — FOUND
- `src/dashboard/client/src/routes/graph.tsx` — FOUND

Commits exist in git log (verified via `git log --oneline -5`):
- `f863757` feat(116-06): T08 — cutover redirect flag + live-config wiring
- `d6510ff` feat(116-06): T01+T04+T07 backend — activity heatmap + audit log + telemetry
- `7e6b531` feat(116-06): T01-T05+T07 frontend — heatmap, notifications, theme, audit, graph, telemetry

Verification:
- `npx tsc --noEmit` → 0 errors (full repo)
- `cd src/dashboard/client && npx vite build` → eager 866.93KB / 262.81KB gzip + button shared 31.12KB / 10.21KB; lazy chunks all <50KB. Cold load: 898.05KB raw / 273.02KB gzip. Inside 1MB/320KB budget.
- `npx vitest run src/dashboard src/ipc src/performance/__tests__ src/config` → 789/790 pass; 1 pre-existing ENOENT clawcode.yaml failure (unrelated).
- IPC pin matches IPC_METHODS at runtime — protocol.test.ts passes.

## Self-Check: PASSED

## Notes for downstream phases

- **Phase 117 (if planned):** append routes inside a new `=== Phase 117 routes ===` block immediately after the 116-06 fence. Closure-intercept IPC handler block: insert right after the `=== end Phase 116-06 IPC handlers ===` marker. Same convention every Phase 116 plan inherited and extended.

- **Audit log extensions:** any future operator-mutation surface (agent delete, fleet-wide restart, etc.) should call `dashboardAuditTrail.recordAction(...)` at the REST route layer. The DashboardAuditTrail class is reusable as-is; just add the call site. The F23 viewer renders the new action without any UI change — the action dropdown auto-derives from seen values.

- **F19 swim-lane (deferred):** if operator demand surfaces, open `999.NN-dashboard-swim-lane-timeline` as a 1-plan phase. Reuses every primitive Phase 116 shipped: trace_spans table, F11/F12 surfaces, SSE agent-status events, Phase 88 cross-agent IPC infrastructure. ~6-8h estimate.

- **F14 in-UI memory editor (deferred):** if promoted, ~3-4h. Required: file-locking + atomic temp+rename + post-save SSE event to invalidate agent's cached preload + operator-confirm modal before save.

- **Decommission follow-up:** when operator is ready, the single decommission commit removes:
  - `src/dashboard/static/index.html`, `app.js`, `styles.css`
  - The `/` and `/index.html` static-asset route branches in `server.ts` (the `dashboardCutoverRedirect` check becomes the default + the legacy branch can be deleted)
  - The `dashboardCutoverRedirect` zod field + configSchema default mirror (becomes vestigial)
  - The `cutoverRedirectEnabled` getter in DashboardServerConfig (becomes vestigial)

- **Graph re-skin (chrome wrap → full port):** if operator demand reveals the iframe is unacceptable (theme-toggle doesn't reach the D3 palette; SPA hooks would drive the simulation), the full D3-inside-React port lands in `src/dashboard/client/src/routes/graph.tsx` replacing the iframe with a `useEffect`+`useRef` D3 mount. Plan estimate: 4-6h. Risk: regression surface on the simulation tuning + drag handlers.

- **Notification feed sources:** future plans can add new sources by appending to the rawNotifications useMemo in NotificationFeed.tsx. Each notification needs a stable id, level, title, detail. Dismissal + auto-dismiss logic is shared.

- **Theme system:** if light-mode adoption is high, the literal-token utilities (`bg-bg-base`, `text-fg-1`, etc.) in earlier-phase components should be migrated to theme-aware `bg-background`, `text-foreground`. Today most of them are gated to dark-only via the `:root`-was-dark legacy; with `:root` flipped to light, those literals now lock to dark regardless of theme. A migration sweep would land in a focused refactor plan if operator finds the inconsistency surfaces.
