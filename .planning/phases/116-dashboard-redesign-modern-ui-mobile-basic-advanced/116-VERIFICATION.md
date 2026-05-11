# Phase 116 — Verification

**Phase 116 SHIPPED 2026-05-11** with Plan 116-06.

Status: code complete on master; awaiting operator deploy clearance before production. Cutover flag (`defaults.dashboardCutoverRedirect`) defaults to `false` so post-deploy the dashboard runs in dual-mode (both `/` legacy and `/dashboard/v2/` SPA coexist) until the operator manually flips it.

Deferred items (NOT shipped):
- **F19** swim-lane timeline (canvas-rendered fleet concurrent activity) — see `116-DEFERRED.md`
- **F14** in-UI memory/SOUL/IDENTITY editor (read-only previews ship in 116-04; in-UI editing deferred) — see `116-DEFERRED.md`

---

## End-to-end test checklist

The 12 items from `116-PLAN-OVERVIEW.md "Verification at phase completion"`:

### 1. `npm run build` succeeds producing both `dist/cli/index.js` (daemon) AND `dist/dashboard/spa/` (SPA)

**Verification:**
```bash
npm run build
ls -la dist/cli/index.js dist/dashboard/spa/index.html dist/dashboard/spa/assets/
```

**Expected:** both exist; SPA assets directory contains the eager `index-*.js`, eager `button-*.js`, lazy `CostDashboard-*.js`, lazy `AuditLogViewer-*.js`, lazy `GraphRoute-*.js`, lazy `TraceWaterfall-*.js`, plus the CSS bundle and the WOFF2 fonts under `fonts/`.

### 2. `/` returns old dashboard byte-identical to pre-Phase-116

**Pre-cutover (default state):**
```bash
curl -i http://localhost:3100/
```

**Expected:** `200 OK`, `Content-Type: text/html; charset=utf-8`, body is the legacy static `index.html`. Same bytes as pre-Phase-116 because the file under `src/dashboard/static/index.html` is unchanged.

### 3. `/dashboard/v2/` returns new React shell rendering live fleet state

```bash
curl -i http://localhost:3100/dashboard/v2/
```

**Expected:** `200 OK`, `Content-Type: text/html; charset=utf-8`, body is the Vite-built SPA index.html (`<div id="root">` + bundle script tags + the FOUC theme guard).

In a browser: the SPA hydrates, the SSE bridge connects, the nav strip shows seven buttons (Dashboard / Fleet / Costs / Conversations / Tasks / Audit / Graph) with the right-aligned telemetry badge + notification bell + theme toggle.

### 4. Mobile viewport at 375px: page loads, no horizontal scroll, Basic mode active

Open `/dashboard/v2/` in a browser with DevTools responsive mode at 375×667 (iPhone SE). FleetLayout's `useViewMode()` hook detects width < 1024px and renders Basic mode (stacked agent rows + quick-action buttons). Confirm horizontal scroll is absent.

### 5. Desktop at 1920px: 4-column grid with all Tier 1 metrics

At 1920×1080, the AgentTileGrid renders 4 columns with each tile showing the SLO color, context meter, first-token p50, 24h sparkline, and last-turn timestamp.

### 6. F02 SLO recalibration: Opus agents render based on Opus thresholds, Sonnet on Sonnet thresholds, per-agent overrides work

In the SPA dashboard view, an Opus agent with first-token p50 ~3000ms renders green (under the 8,000ms Opus threshold). A Sonnet agent with the same observed p50 renders amber/red (over the 6,000ms Sonnet threshold or its 2× breach point). Per-agent override in `clawcode.yaml`'s `agents[*].perf.slos.first_token_p50_ms` overrides the per-model default for that agent.

### 7. F07 tool latency split panel shows both `tool_execution_ms` and `tool_roundtrip_ms` per tool (Finding B fixed)

Open the F11 detail drawer for any running agent. The Tool Latency Split panel renders a two-bar-per-tool layout: blue for `tool_execution_ms`, amber for `tool_roundtrip_ms`. The Phase 115-08 producer port (commit `a0f30a6`) populates both columns; F07 in Plan 116-02 reads them directly.

### 8. F26 config editor changes `fin-acquisition.model = sonnet` via UI, `clawcode.yaml` updates, ConfigWatcher fires hot-reload

In the SPA, open the F26 config editor (settings icon next to any agent), change `model` from `sonnet` to `opus`, click Save. The PUT request lands at `/api/config/agents/fin-acquisition`. The daemon's `update-agent-config` IPC runs `patchAgentInYaml()` (atomic temp+rename). ConfigWatcher (chokidar) fires within 500ms. The agent's resolved config updates without restart for hot-reloadable fields (channels, skills, schedules); for non-reloadable fields (workspace, mcpServers), `agentsNeedingRestart` surfaces in the success toast.

**Audit log:** after the save, `/dashboard/v2/audit` shows a new row with action=`update-agent-config`, target=`fin-acquisition`, metadata containing the partial payload.

### 9. F27 FTS search for "Ramy" returns hits across multiple agents

In the SPA, navigate to `/dashboard/v2/conversations`. In the search box, enter "Ramy". The query lands at `/api/conversations/search?q=Ramy`. The daemon's `search-conversations` IPC runs `ConversationStore.searchTurns` across every resolved agent (FTS5 over the bm25 index). Results render a sortable table with timestamp/agent/channel/snippet columns. Click any row to drill into the drawer.

### 10. F28 Kanban drag-drop from Backlog → Scheduled transitions task state in `tasks.db`

In the SPA, navigate to `/dashboard/v2/tasks`. The Kanban renders four columns (Backlog / Scheduled / In-flight / Done). Drag a card from Backlog to Scheduled. The transition POST lands at `/api/tasks/:id/transition` with `{status: "scheduled"}`. The daemon's `transition-task` IPC validates the legal-transition graph and writes to `tasks.db`. The card stays in the new column on next render.

**Audit log:** new row with action=`transition-task`, target=`<task_id>`, metadata={status: "scheduled", patch: {}}.

### 11. Cutover gate `defaults.dashboardCutoverRedirect: false` → `true` flips `/` to redirect to `/dashboard/v2/`

**Operator action:**
```bash
# Verify the flag is currently false (default).
clawcode config get defaults.dashboardCutoverRedirect
# → false

# Confirm dual-mode is live.
curl -i http://localhost:3100/ | head -3
# → HTTP/1.1 200 OK ; Content-Type: text/html (legacy index.html)

curl -i http://localhost:3100/dashboard/v2/ | head -3
# → HTTP/1.1 200 OK ; Content-Type: text/html (SPA index.html)

# Flip the flag.
clawcode config set defaults.dashboardCutoverRedirect true

# Wait for ConfigWatcher debounce (default ~500ms).
sleep 1

# Verify the redirect.
curl -i http://localhost:3100/ | head -3
# → HTTP/1.1 301 ; Location: /dashboard/v2/

# /index.html literal path is INTENTIONALLY untouched.
curl -i http://localhost:3100/index.html | head -3
# → HTTP/1.1 200 OK (still serves legacy)
```

**Rollback procedure:**
```bash
clawcode config set defaults.dashboardCutoverRedirect false
sleep 1
curl -i http://localhost:3100/ | head -3
# → HTTP/1.1 200 OK ; Content-Type: text/html (legacy index.html restored)
```

The flip / rollback is a pure config edit — no daemon restart, no rebuild, no service interruption. ConfigWatcher's chokidar listener fires on the YAML mtime change; the daemon's `config` ref is reassigned; the next GET / request reads the new value through the closure getter.

### 12. SPA loads in <2s cold cache; SSE updates appear <100ms

**Cold-load measurement:**
- Open Chrome DevTools Network tab, "Disable cache" enabled
- Navigate to `/dashboard/v2/`
- Read the "Finish" time at the bottom

**Expected:** <2s on a typical operator machine (LAN-local + 127.0.0.1 means HTTPRTT is negligible; the budget is dominated by JS parse). Bundle is 898KB raw / 273KB gzip eager — parse on a Pixel 6-class CPU is ~400-600ms.

**SSE latency measurement:**
- Open `/dashboard/v2/` in a browser
- In a terminal, run an agent that triggers a status change (e.g., `clawcode agent restart fin-acquisition`)
- Watch the AgentTile's status dot in the browser

**Expected:** <100ms from the restart command to the dot color changing. SSE events flow through `/api/events` → SseManager → connected client → useSseBridge → TanStack Query cache invalidation → re-render.

---

## Phase 116 cutover handoff for the operator

### Pre-flip checklist

Before flipping `defaults.dashboardCutoverRedirect` from `false` to `true`:

1. **Spend at least one work-session on `/dashboard/v2/` actively.** Use it for real operator tasks (checking SLOs, reviewing conversations, editing configs). The cutover instrumentation (telemetry badge in the header) should show `v2: N views · 0 err (24h)` with N > 5.

2. **Verify the audit log captures your actions.** Edit an agent config via F26, transition a task in F28, etc. Open `/dashboard/v2/audit` and confirm the row appeared. If actions don't surface in the audit log, the dashboardAuditTrail singleton wiring needs investigation BEFORE flipping the cutover.

3. **Try both light + dark themes.** Test the theme toggle on the first page load (FOUC guard) and after a soft reload. Theme should persist; first paint should never flash.

4. **Test the notification feed under load.** Trigger an SLO breach (e.g., set an agent's `slos.first_token_p50_ms` artificially low). Confirm the notification bell badge increments and the slide-over shows the entry.

5. **Walk through the F11 detail drawer** for a representative agent. F12 trace waterfall, F14 memory previews, F15 dream queue, plus the F18 activity heatmap card on the right column should all render data, not empty states.

### Flip procedure

```bash
# 1. Confirm dashboard server is running and responding.
curl -fs http://localhost:3100/api/status >/dev/null && echo "dashboard up"

# 2. Snapshot current behavior (so rollback verification has a known-good baseline).
curl -i http://localhost:3100/ 2>&1 | head -1
# Expect: HTTP/1.1 200 OK

# 3. Flip the flag.
clawcode config set defaults.dashboardCutoverRedirect true

# 4. Wait one second for chokidar debounce + ConfigReloader apply.
sleep 1

# 5. Verify the redirect lives.
curl -i http://localhost:3100/ 2>&1 | head -2
# Expect: HTTP/1.1 301
#         Location: /dashboard/v2/
```

### Telemetry signals to watch post-flip

Refresh `/dashboard/v2/` periodically over the first 48 hours. The header telemetry badge should show:

- **Page views climbing** — every browser hitting the root URL bounces into the SPA, so `pageViews24h` grows with operator + agent web traffic.
- **Errors near zero** — `errors24h` should stay at 0 on a healthy cutover. Any uptick > 5 in a single hour is worth investigating via `/dashboard/v2/audit` filtered to `action=dashboard_v2_error`.

If the audit log shows uncaught render errors:
1. Read the metadata payload — it contains `{message, stack, componentStack, path}`.
2. The route that errored is in `path` (e.g., `/dashboard/v2/audit`).
3. The component stack pinpoints the failing render.

### Rollback procedure

If the operator wants to revert to dual-mode:

```bash
clawcode config set defaults.dashboardCutoverRedirect false
sleep 1
curl -i http://localhost:3100/ | head -1
# Expect: HTTP/1.1 200 OK
```

Same chokidar flow in reverse — no daemon restart needed.

**Hard rollback** (if the SPA itself is broken):

```bash
# Stop the daemon.
sudo systemctl stop clawcode

# The legacy /dashboard/static/* files are still on disk and unchanged.
# Restart the daemon at the pre-Phase-116 commit (or any commit before
# the Phase 116 chain — git log --oneline lets the operator pick).
cd /opt/clawcode
git checkout <commit-before-phase-116>
sudo systemctl start clawcode
```

In this state, only `/` serves the legacy dashboard; `/dashboard/v2/*` returns 404 because the dist/dashboard/spa/ assets are gone from the build artifact.

### Decommission follow-up (NOT this plan)

After the operator flips the cutover flag AND observes for some period (operator-driven, no fixed window), a SEPARATE follow-up commit removes:

- `src/dashboard/static/index.html`
- `src/dashboard/static/app.js`
- `src/dashboard/static/styles.css`
- The `/` and `/index.html` static-asset route branches in `server.ts`
- The `dashboardCutoverRedirect` zod field + configSchema default mirror (becomes vestigial)
- The `cutoverRedirectEnabled` getter in DashboardServerConfig (becomes vestigial)

This is INTENTIONALLY a separate commit so the rollback story stays clean during the soak. Don't do it as part of the Phase 116 commit chain.

---

## Verification command summary

Quick-fire commands for a smoke test (run from the repo root with the daemon listening on the default port 3100):

```bash
# 1. SPA shell loads.
curl -fs http://localhost:3100/dashboard/v2/ | head -1
# Expect: <!doctype html>

# 2. Legacy dashboard still works.
curl -fs http://localhost:3100/ | grep -q 'ClawCode' && echo OK

# 3. New activity heatmap endpoint.
curl -fs "http://localhost:3100/api/activity?days=30" | jq '.rows | length'
# Expect: number of (date, agent) buckets

# 4. New audit endpoint.
curl -fs "http://localhost:3100/api/audit?limit=10" | jq '.rows | length'
# Expect: number ≥ 0

# 5. Telemetry summary endpoint.
curl -fs http://localhost:3100/api/dashboard-telemetry/summary | jq .
# Expect: {pageViews24h, errors24h, since}

# 6. Cutover flag defaults to false.
clawcode config get defaults.dashboardCutoverRedirect
# Expect: false

# 7. The legacy /graph route still serves.
curl -fs http://localhost:3100/graph | grep -q 'd3.v7.min.js' && echo OK
```

If all seven pass, Phase 116 is healthy and ready for the operator-driven cutover decision.

---

## Phase 116 plan chain (closure)

| Plan      | Title                                                                          | Status | Commit chain (head)                          |
| --------- | ------------------------------------------------------------------------------ | ------ | -------------------------------------------- |
| 116-00    | Foundation — toolchain, design tokens, SLO recalibration, mobile breakpoints   | ✓      | see 116-00-SUMMARY.md                         |
| 116-01    | Tier 1 — agent tile grid + SLO breach banner + context meter + cache gauge     | ✓      | see 116-01-SUMMARY.md                         |
| 116-02    | F09 + F10 — migration tracker + MCP health panel                                | ✓      | see 116-02-SUMMARY.md                         |
| 116-03    | F26 + F27 + F28 — config editor + conversations + Kanban                        | ✓      | see 116-03-SUMMARY.md                         |
| 116-04    | F11-F15 — Tier 2 deep-dive drawer (transcript, waterfall, IPC, memory, dream)   | ✓      | see 116-04-SUMMARY.md                         |
| 116-05    | F16 + F17 — fleet comparison table + cost dashboard                             | ✓      | see 116-05-SUMMARY.md                         |
| **116-06** | **F18, F20-F24 + telemetry + cutover gate** — closes Phase 116                  | **✓**  | **`f863757`, `d6510ff`, `7e6b531`**          |

Deferred:
- **F19** swim-lane timeline → `116-DEFERRED.md`
- **F14** in-UI memory editor (read-only previews ship) → `116-DEFERRED.md`

Phase 116 is **SHIPPED** at the source-tree level. Operator deploys + cutover flip remain manual.
