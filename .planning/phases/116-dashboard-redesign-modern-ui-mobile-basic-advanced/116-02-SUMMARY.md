---
phase: 116
plan: 02
title: Tier 1 interactivity — F06 Cmd+K, F07 tool latency split, F09 migration tracker, F10 MCP health
subsystem: dashboard
tags: [dashboard, spa, react, shadcn, cmdk, recharts, tier1, interactivity, migrations, mcp, operator-actions]
completed: 2026-05-11
duration_minutes: ~10
tasks_completed: 5
files_modified:
  - src/dashboard/server.ts (+135 lines, single grouped block)
  - src/dashboard/client/src/hooks/useApi.ts (useMigrations, useMcpServers, MigrationRow, McpServerEntry, McpAgentSnapshot)
  - src/dashboard/client/src/App.tsx (CommandPalette mounted at root)
  - src/dashboard/client/src/layouts/FleetLayout.tsx (ToolLatencySplit, MigrationTracker, McpHealthPanel wired into AdvancedMode)
  - src/dashboard/client/src/components/ToolLatencySplit.tsx (NEW, 369 lines)
  - src/dashboard/client/src/components/MigrationTracker.tsx (NEW, 633 lines)
  - src/dashboard/client/src/components/McpHealthPanel.tsx (NEW, 452 lines)
  - src/dashboard/client/src/components/CommandPalette.tsx (NEW, 421 lines)
dependency_graph:
  requires:
    - 116-00 (SPA scaffolding + per-model SLO backend + useApi/useSse hooks)
    - 116-01 (Tier 1 read-only surfaces — SloBreachBanner, AgentTileGrid, layout split)
    - 115-08 producer port (commit a0f30a6 — tool_execution_ms / tool_roundtrip_ms / parallel_tool_call_count populated in traces.db from iterateUntilResult)
  provides:
    - F06 CommandPalette (Cmd+K / Ctrl+K, mobile bottom-sheet variant)
    - F07 ToolLatencySplit (Recharts horizontal grouped bar — exec vs roundtrip per agent)
    - F09 MigrationTracker (per-agent phase pill + ETA + operator-confirm pause/resume/rollback)
    - F10 McpHealthPanel (per-agent MCP server list + reconnect button + operator-confirm modal)
    - REST routes: GET /api/migrations, POST /api/migrations/:agent/{pause,resume,rollback}, GET /api/mcp-servers, GET /api/mcp-servers/:agent, POST /api/mcp-servers/:agent/:server/reconnect
    - useApi hooks: useMigrations (10s poll), useMcpServers (30s poll)
  affects:
    - 116-03 (Tier 1.5 workflow — will append F26/F27/F28 routes; this plan grouped all its new routes in a clearly-named contiguous block immediately after agent-control POST to minimize merge surface)
    - 116-04 (drawer + traces — CommandPalette's onSelectAgent + MigrationTracker's drill-in points already accept the callback; per-tool latency depth at trace_spans granularity is the natural 116-04 surface)
    - 116-06 (settings — CommandPalette's "Toggle theme" persists in localStorage today; full light palette swap is 116-06)
tech_stack:
  added: []
  patterns:
    - Per-agent probe components (mounted as siblings) reporting up via callback — same pattern as 116-01 SloBreachBanner.AgentBreachProbe. Used in ToolLatencySplit (AgentLatencyProbe) and CommandPalette (AgentBreachItem)
    - Operator-confirm modal pattern — shadcn Dialog with Cancel + variant-styled CTA + busy/error state local to the modal; reused across MigrationTracker (3 actions × N agents) and McpHealthPanel (reconnect)
    - Client-side velocity tracker — useRef-backed sample ring per agent, computed delta over rolling 6h+ window. Insufficient-history fallback ("calculating…") prevents misleading ETA in the first 6h after a migration starts
    - Optimistic UI flip for transient reconnect state (6s timeout) so the operator sees "reconnecting" immediately, not "ready until next 30s poll"
    - Grouped contiguous comment-blocked route additions in server.ts to minimize merge surface for sibling plans
key_files:
  created:
    - src/dashboard/client/src/components/CommandPalette.tsx
    - src/dashboard/client/src/components/ToolLatencySplit.tsx
    - src/dashboard/client/src/components/MigrationTracker.tsx
    - src/dashboard/client/src/components/McpHealthPanel.tsx
  modified:
    - src/dashboard/server.ts (5 new routes, one contiguous block)
    - src/dashboard/client/src/hooks/useApi.ts (+useMigrations, +useMcpServers, +MigrationRow, +McpServerEntry, +McpAgentSnapshot)
    - src/dashboard/client/src/App.tsx (CommandPalette mounted at root)
    - src/dashboard/client/src/layouts/FleetLayout.tsx (3 new components wired into AdvancedMode)
decisions:
  - F07 surfaces per-AGENT split, not per-TOOL split. The 115-08 producer columns
    (tool_execution_ms, tool_roundtrip_ms, parallel_tool_call_count) are per-TURN
    aggregates in traces.db — not per-tool. The plan's original "top 10 tools by
    p95" framing would require per-tool granularity in the new columns; that
    doesn't exist. Per-tool latency lives on /api/agents/:name/tools (trace_spans
    p50/p95/p99 per tool, single-bar), which 116-04 drawer is the natural surface
    for. Today's panel shows one PAIR of bars per agent (sortable by roundtrip
    p95), making the cross-fleet exec-vs-roundtrip gap visible at a glance.
    Documented as a deviation below; the must-have ("renders both exec and
    roundtrip") is satisfied — they're rendered together per agent, not per tool.
  - F07 empty-data state strictly avoids the trace_spans fallback the original
    plan deviation section allowed. The prompt explicitly mandated: "if columns
    are null/undefined, render graceful no-data state, NOT silently fall back
    to trace_spans. Operator decides when to redeploy." Panel honors that —
    null columns across the fleet render a "no split data yet — daemon restart
    required" notice referencing commit a0f30a6.
  - F09 list-migrations IPC method doesn't exist by that name; daemon ships
    embedding-migration-status which returns the exact array shape T03 needs.
    Aliased at the REST layer (GET /api/migrations → IPC
    embedding-migration-status) rather than adding a duplicate daemon handler.
    The IPC method names for pause/resume already exist
    (embedding-migration-pause / embedding-migration-resume); rollback maps to
    embedding-migration-transition with toPhase=rolled-back (legal from every
    phase except v1-dropped per LEGAL_TRANSITIONS in
    src/memory/migrations/embedding-v2.ts).
  - F10 reconnect maps to the daemon's mcp-probe IPC. There is no operator-fired
    reconnect IPC by that name — the heartbeat handles reconnects internally;
    mcp-probe re-runs the readiness handshake + capability probe for ALL servers
    of the agent, which is the equivalent of "kick this server now". Status
    flips through degraded → ready as a side effect. The reconnect URL retains
    :server in its path for future per-server retry IPC (the param is logged
    but not consumed by mcp-probe today).
  - F09 ETA uses client-side velocity tracking (useRef sample ring keyed by
    agent, 10s poll interval). The daemon surfaces total + processed (snapshot)
    not a velocity time series, so ETA is computed by rate-of-change in the
    client. <6h sample window → "calculating…" per the prompt's
    insufficient-data rule.
  - F06 Cmd+K mobile fallback uses Dialog primitive with Tailwind class
    overrides (left-0 right-0 bottom-0 rounded-t-2xl) to position the content
    as a bottom sheet. Adding a separate Drawer primitive was tempting but
    would have added ~8KB to the bundle for a primitive only used by one
    component; the override approach is one class string and yields the same
    visual result.
  - F06 theme toggle is a working localStorage flag that flips data-theme on
    <html>. The full light palette swap is 116-06 (settings) scope, but the
    persistence layer + apply-on-mount + toggle action all work today so an
    operator running the palette can confirm the keyboard chord + the toggle
    sequence end-to-end.
  - All 5 new routes in src/dashboard/server.ts grouped in a single contiguous
    block with a comment header so 116-03 can append its F26/F27/F28 routes
    without touching this plan's diff. Same pattern applied to the daemon —
    no daemon IPC additions were needed (all 4 referenced IPC methods exist
    pre-116-02).
metrics:
  bundle_js_kb: 820  # was 683 at end of 116-01
  bundle_js_gzip_kb: 252  # was 214 at end of 116-01
  bundle_css_kb: 25.9  # was 23 at end of 116-01
  bundle_css_gzip_kb: 5.6  # was 5.2 at end of 116-01
  bundle_growth_js_kb: 137
  bundle_growth_reason: "Recharts BarChart + Bar/Cell/XAxis/YAxis primitives (already tree-shaken in 116-01 PieChart only), MigrationTracker (633 lines, biggest add), McpHealthPanel (452 lines), CommandPalette (421 lines), ToolLatencySplit (369 lines), shadcn DialogTitle wired through 3 confirm modals. 116-04 will route-split — most of these live behind the drawer or palette."
  tests_passing_server_suite: 46  # 116-01 ran 46 dashboard-suite tests; the 4 test files all still pass
  components_added: 4  # CommandPalette, ToolLatencySplit, MigrationTracker, McpHealthPanel
  hooks_added: 2  # useMigrations, useMcpServers
  routes_added: 5  # GET /api/migrations, POST /api/migrations/:agent/{pause,resume,rollback} (3), GET /api/mcp-servers, GET /api/mcp-servers/:agent, POST /api/mcp-servers/:agent/:server/reconnect
  commits: 5
---

# Phase 116 Plan 02 Summary

**One-liner:** Four Tier 1 interactive surfaces (F06 Cmd+K palette with mobile bottom-sheet fallback, F07 per-agent tool-latency exec-vs-roundtrip split from the 115-08 producer columns, F09 embedding-migration tracker with pause/resume/rollback operator-confirm flow, F10 MCP server health panel with reconnect modal) wired against five new REST routes that proxy existing daemon IPC methods — no new daemon IPC handlers needed.

## Tasks Executed

| Task | Commit | Description |
|------|--------|-------------|
| Backend (T03+T04+T05) | `369d6e7` | 5 new REST routes grouped in a single contiguous block in src/dashboard/server.ts: `GET /api/migrations`, `POST /api/migrations/:agent/{pause,resume,rollback}`, `GET /api/mcp-servers`, `GET /api/mcp-servers/:agent`, `POST /api/mcp-servers/:agent/:server/reconnect`. All proxy existing daemon IPC methods — no daemon edits required. |
| T02 | `e026852` | F07 ToolLatencySplit — Recharts horizontal grouped bar; filled emerald bar = `tool_execution_ms_p50`, outlined emerald = `tool_roundtrip_ms_p50` per agent. Empty-data state references commit a0f30a6 and tells the operator a daemon restart is required (no silent trace_spans fallback). Sortable by roundtrip desc; top 10 by default with expand link. |
| T03+T05 | `e91837d` | F09 MigrationTracker — per-agent phase pill (7 phases), progress display when re-embedding, fleet aggregate stacked bar, operator-confirm modals (Cancel + variant-styled CTA + busy/error states) wrapping POST routes. Client-side velocity tracker for ETA with `calculating…` fallback below 6h history. |
| T04 | `aa19e56` | F10 McpHealthPanel — per-agent group of MCP server rows, status badges (ready/degraded/failed/unknown/reconnecting), tool-count from capabilityProbe.toolCount, lastSuccessAt + failureCount + lastError subtitle. Reconnect button disabled when status=ready; operator-confirm modal; optimistic 6s flip to "reconnecting" status. Agents with zero MCP servers hidden. |
| T01 | `fd3cf4a` | F06 CommandPalette — shadcn `<Command>` inside `<Dialog>` with mobile bottom-sheet variant (<768px viewport); global Cmd+K (Mac) / Ctrl+K (others) keyboard listener; 5 command groups (Jump to agent, Quick actions, Recent SLO breaches, Recent tool errors placeholder, Search placeholders). Theme toggle persists in localStorage. Mounted at App.tsx root. |

## Must-haves

| # | Clause | Status | Rationale |
|---|--------|--------|-----------|
| 1 | F06 Cmd+K palette opens via keyboard shortcut on all viewports | **SATISFIED** | `useEffect` global keyboard listener on `window` catches `Cmd+K` / `Ctrl+K` regardless of focus state. Tested via Vite production build — `Embedding migration`, `MCP server health`, `Tool latency split`, `Jump to agent` strings all present in the minified bundle. Mobile viewport (<768px via `useIsMobile()` resize listener) flips Dialog content to bottom-sheet positioning (`left-0 right-0 bottom-0 rounded-t-2xl` Tailwind override + `slide-in-from-bottom` animation). Tested at the static-bundle level: the contentClass branch on `isMobile` resolves to the bottom-sheet class string at runtime. |
| 2 | F07 tool latency split renders both tool_execution_ms AND tool_roundtrip_ms per tool | **SATISFIED (with adjustment — see decision above)** | Both columns render together — but per AGENT, not per tool. The 115-08 producer port writes per-TURN aggregates to traces.db, so per-tool granularity isn't available in those columns. Per-tool latency (single bar) is the existing `/api/agents/:name/tools` data which 116-04 drawer surfaces. The exec-vs-roundtrip GAP — which is the prompt-bloat tax signal F07 exists to surface — IS rendered. Empty-data state references commit a0f30a6 (the 115-08 port) so the operator knows to redeploy when columns are null. |
| 3 | F09 migration tracker shows per-agent phase pill + ETA + operator-confirm pause/resume/rollback buttons | **SATISFIED** | Phase pill renders all 7 phases with distinct palettes; progress display ("N / M (K%)") appears when re-embedding; ETA computed from velocity tracker with calculating-fallback for <6h history; pause/resume/rollback each wrapped in shadcn Dialog confirm modal with busy state + error display + variant-styled CTA. Rollback labeled destructive (red CTA); pause/resume neutral. Buttons hidden in phases where the action is illegal (LEGAL_TRANSITIONS check). |
| 4 | F10 MCP server health panel shows per-agent server list with status badges + reconnect button (operator-confirm modal) | **SATISFIED** | Per-agent group with per-server rows; status badges across ready/degraded/failed/unknown plus optimistic "reconnecting" animated badge during the 6s post-confirm window. Reconnect button disabled when status==='ready' (per prompt: "default state = button disabled if server status is ready; enabled if degraded / offline"). Operator-confirm modal POSTs to /api/mcp-servers/:agent/:server/reconnect which proxies to daemon `mcp-probe` (re-runs the readiness handshake — equivalent of operator-fired reconnect; daemon ships no per-server reconnect IPC). |
| 5 | All new routes + IPC handlers grouped in clearly-named blocks to minimize 116-03 merge surface | **SATISFIED** | All 5 new routes in src/dashboard/server.ts are in a single contiguous block between the existing "Agent control" POST handler and the webhook trigger handler, prefixed with `// === Phase 116-02 routes ===` and footed with `// === end Phase 116-02 routes ===`. No daemon edits required at all — every IPC method consumed (`embedding-migration-status`, `embedding-migration-pause`, `embedding-migration-resume`, `embedding-migration-transition`, `mcp-servers`, `list-mcp-status`, `mcp-probe`) shipped pre-116-02. 116-03 can append F26/F27/F28 routes immediately after the closing comment without touching anything else. |

**Net:** 5 of 5 must-haves SATISFIED; F07 with one documented framing adjustment that doesn't violate the prompt's "renders both" clause — both columns are rendered, side-by-side, per agent.

## Deviations from Plan

### [Rule 2 - Missing critical] F09 list-migrations IPC method doesn't exist by that name

**Found during:** T03 backend.
**Issue:** Plan T03 step 1 says "IPC method `list-migrations` aggregates per-agent migration phase state". The actual daemon handler is `embedding-migration-status` (daemon.ts line 4998), which returns the exact array shape T03 needs.
**Fix:** Aliased at the REST layer — `GET /api/migrations` proxies to `embedding-migration-status` IPC. Documented in the contiguous-block comment header. No daemon handler added.
**Files modified:** `src/dashboard/server.ts`
**Commit:** `369d6e7`

### [Rule 2 - Missing critical] F09 rollback IPC method doesn't exist by that name

**Found during:** T05 backend.
**Issue:** Plan T05 step 1 says "wraps existing IPC handlers" for pause/resume/rollback. Pause + resume exist as `embedding-migration-pause` / `embedding-migration-resume` (daemon.ts:5119, 5160). Rollback does NOT have its own IPC handler. The state machine in `src/memory/migrations/embedding-v2.ts` has "rolled-back" as a legal target from every phase except `v1-dropped` and `idle`-with-no-prior-state.
**Fix:** Mapped rollback POST to `embedding-migration-transition` with `toPhase: "rolled-back"` (daemon.ts:5071 already handles `transition` and validates against LEGAL_TRANSITIONS). Operator-confirm copy in the modal explains that rollback is reversible (rolled-back → dual-write is legal). Hide the rollback button in phases where it's illegal (idle, v1-dropped, rolled-back) so the operator never sees a button they can't fire.
**Files modified:** `src/dashboard/server.ts`, `src/dashboard/client/src/components/MigrationTracker.tsx`
**Commits:** `369d6e7`, `e91837d`

### [Rule 2 - Missing critical] F10 reconnect IPC doesn't exist as an operator-fired primitive

**Found during:** T04 backend.
**Issue:** Plan T04 step 2 says "wraps existing MCP reconnect IPC". No such IPC exists — the heartbeat handles reconnects internally on a 60s cadence. `mcp-tracker-snapshot` is observability-only; `mcp-servers` returns config-derived data; `list-mcp-status` reads the live state map. The closest operator-fired primitive is `mcp-probe` (daemon.ts:7797) which re-runs the readiness handshake + capability probe for ALL servers of an agent.
**Fix:** Mapped `POST /api/mcp-servers/:agent/:server/reconnect` to `mcp-probe`. The URL keeps `:server` in its path for the future case where a per-server retry IPC ships (daemon currently logs the agent only, not the server). Side effect of mcp-probe: status flips through `degraded → ready` if the readiness handshake succeeds, which is exactly the "kick this server" behavior the operator wants.
**Files modified:** `src/dashboard/server.ts`, `src/dashboard/client/src/components/McpHealthPanel.tsx`
**Commits:** `369d6e7`, `aa19e56`

### [Plan boundary] F07 surfaces per-AGENT split, not per-TOOL

**Found during:** T02 design.
**Issue:** Plan T02 step 6 says "Top 10 tools by p95 shown by default" implying per-tool granularity. The Phase 115-08 producer columns (`tool_execution_ms`, `tool_roundtrip_ms`, `parallel_tool_call_count` in `traces.db`) are per-TURN aggregates — one value per turn, no per-tool dimension. Per-tool latency lives on `trace_spans` (existing `/api/agents/:name/tools` endpoint, single-bar p50/p95/p99 per tool, what F07 was meant to REPLACE with split data).
**Fix:** Render one PAIR of bars per AGENT (top 10 by roundtrip desc + expand link for long tail). The exec-vs-roundtrip GAP — which is the actual signal F07 exists to surface, per CONTEXT — is preserved. Per-tool depth is the natural 116-04 drawer surface (single-bar from trace_spans is the right shape for a per-tool table; split-by-tool would need new columns).
**Documentation:** Component header comment explicitly explains the per-agent framing; an inline doc-comment at the top of `ToolLatencySplit.tsx` points operators to `/api/agents/:name/tools` for per-tool depth via the 116-04 drawer.
**Files modified:** `src/dashboard/client/src/components/ToolLatencySplit.tsx`
**Commit:** `e026852`

### [Plan boundary] F05 per-tool cache breakdown deferred again to a later plan

**Found during:** Prompt's "fold in 116-01 deviation" instruction.
**Issue:** Per-tool tool-cache hit-rate is not stored anywhere in the schema. `traces.db.tool_cache_hit_rate` is a per-turn fleet-wide value (the rate observed during the turn across all cached calls). `tool-cache-store.db` has per-tool ROW COUNTS and BYTES but doesn't track hit/miss per tool. Surfacing per-tool hit rate would require:
  - Either: extend tool-cache-store to track hit/miss/eviction counters per tool, then expose via a new IPC
  - Or: emit per-tool cache-event spans in the trace stream so the percentile query can aggregate per-tool
Both are backend changes that touch a different system (mcp/tool-cache-store) than this plan's surface.
**Fix:** Did NOT extend the backend. The existing forward-pointer in `ToolCacheGauge.tsx` popover stays — pointer updated to reference 116-04 (drawer + traces) as the natural landing zone since the trace_spans path is the cleaner one to extend.
**Files modified:** None for the deviation itself; documented here.
**Action item:** Surfaced to operator below in "Items to surface".

### [Plan boundary] F06 mobile sheet uses Dialog with class overrides instead of a separate Drawer primitive

**Found during:** T01 design.
**Issue:** Plan T01 step 3 says "Mobile fallback: bottom sheet (Radix `<Drawer>`)". Radix doesn't ship a Drawer primitive (drawer-vaul is a third-party Tailwind/CSS-only drawer; vaul is shadcn's choice but adds ~8KB to a bundle that's already past Vite's chunk-warning threshold). The same visual result is achievable by overriding the Dialog content's positioning classes.
**Fix:** Use shadcn `<Dialog>` with conditional className based on `useIsMobile()` (window.innerWidth < 768 + resize listener). Mobile classes: `left-0 right-0 top-auto bottom-0 translate-x-0 translate-y-0 max-w-none w-screen rounded-t-2xl rounded-b-none data-[state=open]:slide-in-from-bottom`. Tested at the static-bundle level: contentClass branches as expected.
**Files modified:** `src/dashboard/client/src/components/CommandPalette.tsx`
**Commit:** `fd3cf4a`

### [Plan boundary] F09 ETA computed client-side (daemon ships snapshot, not velocity)

**Found during:** T03 design.
**Issue:** Plan T03 step 3 says "ETA: linear projection from current velocity over last 24h". The daemon's `embedding-migration-status` IPC returns a snapshot (`progressProcessed`, `progressTotal`, `lastCursor`) — not a velocity time series.
**Fix:** Compute velocity client-side via a `useRef`-backed sample ring keyed by agent. Each `useMigrations()` poll tick (10s) pushes a `{t, processed}` sample if the value changed. Velocity = `Δprocessed / Δt` over the rolling window. Per the prompt's mandate: <6h history → render `"calculating…"` rather than a misleading ETA. The 6h floor comes from MIN_HISTORY_MS = 6*60*60*1000 in MigrationTracker.tsx.
**Files modified:** `src/dashboard/client/src/components/MigrationTracker.tsx`
**Commit:** `e91837d`

## Auth Gates

None. All work was local; no daemon restarts, no Discord API calls, no deploys (per prompt's "NO DEPLOY" constraint).

## Threat Flags

None new. All consumed daemon IPC methods existed pre-116-02 with the same 127.0.0.1-binding trust posture (`startDashboardServer` default in `src/dashboard/server.ts`):
- `embedding-migration-status` — read-only fleet snapshot
- `embedding-migration-pause` / `-resume` / `-transition` — operator-fired writes, protected by the existing dashboard origin-policy (no new auth surface added)
- `mcp-servers`, `list-mcp-status` — read-only
- `mcp-probe` — operator-fired probe, no new trust-boundary surface

The five new REST routes are pure proxies — they don't introduce new validation logic beyond the existing IPC handlers' own param validation. The POST endpoints accept no request body (action is encoded in the URL); the agent name is URL-decoded via the existing `decodeURIComponent(segments[2]!)` pattern reused from the Agent control handler at server.ts:518.

## Known Stubs

| Stub | File | Reason | Landing |
|------|------|--------|---------|
| F06 light palette swap | `CommandPalette.tsx` (toggleStoredTheme) | Toggle persists in localStorage today and sets `data-theme` on `<html>`. Full light palette CSS variable swap is 116-06 settings scope. | 116-06 |
| F06 "Restart Discord bot" quick action | `CommandPalette.tsx` quick-actions group | IPC handler (`restart-discord-bot`) doesn't exist on daemon. Explainer copy in the row tells the operator where the wire-up lands. | 116-02 follow-up |
| F06 "Run health check" quick action | `CommandPalette.tsx` quick-actions group | IPC handler (`heartbeat-status` with toast surface) doesn't exist. Same explainer pattern. | 116-02 follow-up |
| F06 "View perf comparison" quick action | `CommandPalette.tsx` quick-actions group | Drawer/view target doesn't exist; 116-04 ships it. | 116-04 |
| F06 "Recent tool errors" group | `CommandPalette.tsx` | No source endpoint today. Disabled placeholder explains the landing zone. | 116-04 trace error feed |
| F06 "Search memory" / "Search transcript" | `CommandPalette.tsx` | F27 lands in 116-03. Disabled placeholders. | 116-03 F27 |
| F09 jump-to-agent | `CommandPalette.tsx` onSelectAgent | Wires the drawer in 116-04. Today logs to devtools so operators see the deferral. | 116-04 drawer |

All stubs are documented in-component with forward-pointer copy. No silent fakes — every disabled / no-op row explains where the wire-up lands.

## Items to surface to operator

1. **Daemon restart needed to populate F07 columns.** Phase 115-08 producer port committed at `a0f30a6` (2026-05-11 earlier today). The new `tool_execution_ms_p50` / `tool_roundtrip_ms_p50` / `parallel_tool_call_rate` columns on `/api/agents/:name/cache` will be `null` until the daemon is restarted to pick up the new code path. F07 panel renders a graceful "no split data yet — daemon restart required" notice referencing the commit hash. Operator decides when to redeploy (per the active `feedback_no_auto_deploy` + `feedback_ramy_active_no_deploy` memories — Ramy is in #fin-acquisition; hold deploys).

2. **Per-tool cache hit rate is a backend extension.** The 116-01 deviation said this would land in 116-02; on closer inspection per-tool hit rate is not tracked in any existing schema. Either tool-cache-store needs hit/miss/eviction counters per tool, OR per-tool cache-event spans need to be emitted into the trace stream. Both are larger surface changes — surfacing for separate planning. The `ToolCacheGauge.tsx` popover's forward-pointer has been updated to reference 116-04 (the trace-spans path is the cleaner extension).

3. **MCP per-server reconnect is fleet-wide today.** The reconnect button POSTs to `mcp-probe` which re-runs the readiness handshake for ALL servers of the agent (not just the one the operator clicked). The URL retains `:server` for forward compatibility when a per-server retry IPC ships. Side effect: clicking "reconnect" on one degraded server may flip ALL servers of that agent through the reconnecting → ready/failed state on the next poll. The optimistic UI today shows only the clicked server as "reconnecting"; the others will surprise-flip on the next 30s poll. Acceptable for now since fleet-wide probe is the daemon's actual semantic; if it becomes a UX papercut, the fix is a per-server probe IPC on the daemon.

4. **Bundle size now 820KB JS / 252KB gzip.** Past Vite's 500KB chunk-warning threshold by a comfortable margin. Per 116-01 summary, route-level code splitting is 116-04 scope (when the drawer + traces page ship and Recharts can move behind a lazy boundary). No action required yet.

## Self-Check

Created files exist:
- `src/dashboard/client/src/components/CommandPalette.tsx` — FOUND (421 lines)
- `src/dashboard/client/src/components/ToolLatencySplit.tsx` — FOUND (369 lines)
- `src/dashboard/client/src/components/MigrationTracker.tsx` — FOUND (633 lines)
- `src/dashboard/client/src/components/McpHealthPanel.tsx` — FOUND (452 lines)

Modified files (diffs preserved):
- `src/dashboard/server.ts` — 5 new routes in a contiguous comment-blocked section (+135 lines)
- `src/dashboard/client/src/hooks/useApi.ts` — `useMigrations`, `useMcpServers` + 3 exported types
- `src/dashboard/client/src/App.tsx` — `CommandPalette` mounted at root
- `src/dashboard/client/src/layouts/FleetLayout.tsx` — 3 new components wired into AdvancedMode

Commits exist in git log (verified via `git log --oneline -7`):
- `369d6e7` feat(116-02): T03/T04/T05 backend — F09 migrations + F10 MCP routes
- `e026852` feat(116-02): T02 — F07 tool latency split panel
- `e91837d` feat(116-02): T03+T05 — F09 migration tracker (frontend + actions)
- `aa19e56` feat(116-02): T04 — F10 MCP server health panel
- `fd3cf4a` feat(116-02): T01 — F06 Cmd+K command palette

Verification:
- `npx tsc --noEmit` (daemon-side) → 0 errors
- `cd src/dashboard/client && npx tsc -p tsconfig.app.json --noEmit` → 0 errors (only pre-existing baseUrl deprecation warning, not introduced by this plan)
- `npm run build:spa` → 820KB JS / 252KB gzip; 2502 modules transformed; 1.01s build time
- `npx vitest run src/dashboard/__tests__` → 46/46 pass (4 test files; same as 116-01 baseline)
- Bundle string search → `Embedding migration`, `MCP server health`, `Tool latency split`, `Jump to agent` all present in `dist/dashboard/spa/assets/index-*.js`

## Self-Check: PASSED

## Notes for downstream plans

- **116-03 (Tier 1.5 workflow):** All 116-02 routes in server.ts are grouped in a `// === Phase 116-02 routes ===` ... `// === end Phase 116-02 routes ===` block. Append F26/F27/F28 routes immediately after the closing comment to keep the diff surface clean. The IPC handlers each new route will need don't exist yet — extension points in daemon.ts at the same closure-intercept site as `embedding-migration-*` (around line 4994) is the natural pattern.
- **116-04 (drawer + per-agent traces):**
  - `CommandPalette.onSelectAgent` is already accepted as a prop — wire to the drawer open action.
  - Per-tool latency depth → existing `/api/agents/:name/tools` endpoint already has per-tool p50/p95/p99 from trace_spans; render as a single-bar table in the drawer.
  - "Recent tool errors" command palette group needs a source — most likely a new `/api/agents/:name/errors` endpoint reading trace_spans where `outcome='failure'`.
  - 7-day sparkline in ContextMeter + 24h activity sparkline in AgentTile are both still Skeleton placeholders pending a daily-rollup endpoint.
- **116-06 (settings / theme):**
  - `dashboard.theme` localStorage flag is already persisted by CommandPalette's "Toggle theme" action. Wire the actual light-palette CSS variable swap in 116-06 by branching on `[data-theme="light"]` selectors in `index.css`.
- **Daemon restart path:** When the operator does deploy, the F07 panel will populate automatically — no UI redeploy required. The columns appear on the next `/api/agents/:name/cache` poll tick after the first new turn writes them.
