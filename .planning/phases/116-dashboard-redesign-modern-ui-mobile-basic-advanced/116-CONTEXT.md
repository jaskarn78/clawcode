# Phase 116: Dashboard redesign — Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Source:** Promoted from `.planning/sketches/dashboard-redesign-2026-05-08/FEATURES.md` after operator review of v1 + v2 mockups. All 28 features ranked, tech stack locked, aesthetic direction confirmed via v2 mockup acceptance.
**Folds:** Phase 999.38 (SLO recalibration per model) — absorbed entirely as feature F02
**Mode:** Operator delegated planning per "decide what's best to achieve optimal results" pattern (same as Phase 115). Decisions are locked from operator's review feedback on v1 mockup (mobile-friendly + Basic/Advanced toggle + modern aesthetic + F26/F27/F28 added) and v2 mockup acceptance.

**Canonical artifacts:**
- Research synthesis: `.planning/phases/_research/dashboard-redesign-2026-05-08/RESEARCH.md` (4,810 words, 14 projects)
- Visual mockup (v2 — locked direction): `.planning/sketches/dashboard-redesign-2026-05-08/v2-*.html` (7 files, 3,203 lines)
- Visual mockup (v1 — superseded, kept for visual diff record): `.planning/sketches/dashboard-redesign-2026-05-08/mockup-*.html`

---

## Above-the-fold operator question

> *"Which agents are active/idle/errored, and is anything breaching SLO right now?"*

The redesigned dashboard answers this in <2 seconds of glance time. Everything else is progressive disclosure.

---

## Convergent design pillars

Locked from research findings (§4 of RESEARCH.md):

1. **Three-panel entity inspector** for per-agent deep-dive (Letta ADE pattern): left = config/model/tier, center = transcript/timeline, right = state (memory, context meter, SLO gauges)
2. **Sidebar nav + main content** for fleet overview (Mission Control / Langfuse / Helicone)
3. **Hook-driven SSE updates** — already in place, no change needed; superior to all polling-based dashboards surveyed
4. **Compact agent tile grid** for 10-14 agents (research-validated density preference)
5. **Progressive disclosure** — overview → agent → detail, NOT kitchen-sink single page
6. **Cmd+K command palette** — single highest-impact UX feature missing from every surveyed project
7. **Dark default + theme toggle** — research-validated operator preference

---

## Tier 1 — Ship in v1 (high value, low–medium cost, all data already exists)

### F01 — Fleet overview header with SLO breach banner
**Value:** ★★★★★ | **Cost:** L | **Phase 115 dep:** none

Top of page, always visible:
- **Connection status dot** (existing — keep)
- **SLO breach banner** — dismissible, shows: `⚠ 3 SLO breaches active: fin-acquisition first_token p50 5,200ms (target ≤ 2,000ms), Admin Clawdy tool_call p95 65,289ms (target ≤ 1,500ms), research end_to_end p95 38,379ms (target ≤ 6,000ms)` with click-to-drill-down per breach
- **Fleet summary stats** — `7 active / 3 dormant • 2 SLO breaching • 0 prompt-bloat warnings • avg cache hit 73%`
- **Cmd+K hint** — keyboard shortcut bubble in header

Data: `TraceStore.getLatencyPercentiles()` + `slos.ts` thresholds. Already wired.

### F02 — Per-model SLO recalibration (folds Phase 999.38)
**Value:** ★★★★★ | **Cost:** M | **Phase 115 dep:** sub-scope 17a/b split metric

The 999.38 fix bundled into the redesign:
- **SLO thresholds become per-model**, not fleet-wide. Sonnet baseline stays at current (first_token p50 ≤ 2,000ms). Opus gets relaxed thresholds based on observed split-latency data (e.g., first_token p50 ≤ 4,500ms — derived from actual fleet data, not guessed).
- **`tool_execution_ms` vs `tool_roundtrip_ms` split** surfaces in the SLO so operators see "tool itself slow" vs "prompt-bloat-tax slow" (fixes the "every tile shows red" problem)
- **Configurable per-agent override** in `clawcode.yaml` (`agents[*].perf.slos`) — already supported by infrastructure; just needs surfacing in the UI
- **Model-specific budgets** displayed alongside the gauge (e.g., "opus tile shows red" → "opus operating within model-tier expectations" when threshold is opus-aware)

Data: `tool_execution_ms` + `tool_roundtrip_ms` columns from Phase 115 Plan 08; `slos.ts` extended for per-model thresholds.

### F03 — Agent tile grid (replaces current agent-grid panel)
**Value:** ★★★★★ | **Cost:** L | **Phase 115 dep:** lazy_recall + tier1_inject_chars

One compact card per agent showing:
- **Status dot** with tooltip (active 2m44s / idle 30min / starting / errored / stopped)
- **Display name** + model badge (`opus` / `sonnet` / `haiku`) + tier escalation indicator
- **Context meter** — Tier 1 inject chars / 16K cap as a horizontal progress bar (color-coded: green <70%, amber 70-85%, red >85%)
- **First-token p50** with SLO color (green/amber/red, model-aware per F02)
- **24h activity** — micro sparkline of turn count
- **Last turn timestamp** — relative ("2m ago")
- **Migration phase pill** — `dual-write` / `re-embed 45%` / `cutover` / `idle` (only when migration in progress)
- **Click → opens right-side detail drawer** (F11)

Layout: 3 columns × 4 rows = 12 cards visible without scroll on a 1440p display. Stopped/dormant agents collapse into a slim "3 dormant" footer.

### F04 — Tier-1 budget meter (per agent)
**Value:** ★★★★★ | **Cost:** L | **Phase 115 dep:** tier1_inject_chars + tier1_budget_pct

Already-collected data finally surfaced:
- Horizontal progress bar in each agent tile
- 16,000 chars max (the `INJECTED_MEMORY_MAX_CHARS` constant)
- Color band: green <70% / amber 70-85% / red >85%
- Hover: shows `5,298 / 16,000 chars (33.1%)` and breakdown tooltip
- 7d trend sparkline in detail drawer

Currently fin-acquisition runs at 78% — this would be visible in production immediately.

### F05 — Tool cache hit rate gauge
**Value:** ★★★★★ | **Cost:** L | **Phase 115 dep:** tool_cache_hit_rate

Per agent:
- Single donut/gauge showing hit rate (target ≥40%)
- Cache size MB / 100MB cap as secondary metric
- Per-tool breakdown table on click: `mysql_query 67% • web_search 89% • search_documents 23%`
- 24h trend sparkline

Source: `TraceStore.getToolCacheStats()` — already exists per Phase 115-07.

### F06 — Cmd+K command palette
**Value:** ★★★★★ | **Cost:** M | **Phase 115 dep:** none

shadcn `<Command>` dialog, indexed:
- Agent names (jump to detail)
- Quick actions: "Restart fin-acquisition", "View Admin Clawdy memory", "Show SLO breaches", "Open graph view", "Run perf-comparison", "Toggle theme"
- Recent tool errors (last 24h)
- Recent SLO breaches
- Search transcript text across all agents
- Search memory entries across all agents

The single highest-impact UX feature missing from every surveyed project. Implementation: ~150 lines of React with shadcn primitives.

### F07 — Tool latency split panel (Phase 115 sub-scope 17 surface)
**Value:** ★★★★★ | **Cost:** L | **Phase 115 dep:** tool_execution_ms + tool_roundtrip_ms + parallel_tool_call_count

Per-agent panel:
- Two-bar chart: `tool_execution_ms` (filled) vs `tool_roundtrip_ms` (outline) per tool
- Visualizes the gap = "prompt-bloat tax" — directly answers "why does Read take 77 seconds when it executes in 5 ms"
- Parallel tool call rate as a secondary metric — shows whether agents are batching tool calls efficiently
- Color-coded per SLO threshold

Source: Phase 115 Plan 08 columns. Solves the headline 999.38 frustration directly.

### F08 — Prompt bloat + lazy recall counters
**Value:** ★★★★ | **Cost:** L | **Phase 115 dep:** prompt_bloat_warnings_24h + lazy_recall_call_count

Two labeled counters per agent in the detail drawer:
- **Prompt bloat warnings (24h):** should be 0 — amber if >0 (canary that the post-115 enforcement is holding)
- **Lazy recall calls (24h):** counts agent invocations of `clawcode_memory_*` tools — proxy for whether agents are actually using lazy recall vs the old always-inject pattern
- Both link to traces/logs filtered to that event class

Already computed by `getPhase115DashboardMetrics()` aggregator — just needs UI wiring.

### F09 — Embedding migration tracker (ClawCode-unique — no precedent in any surveyed project)
**Value:** ★★★★ | **Cost:** M | **Phase 115 dep:** Plan 06 migration state machine

Per agent:
- **Phase indicator pill** — `idle` / `dual-write` / `re-embed N% (1,234 / 5,678 vectors)` / `cutover` / `v1-dropped`
- **Started timestamp** + ETA based on current re-embed velocity
- **Pause/resume/rollback action buttons** (operator-confirmed via modal)
- **Aggregate fleet view** — 7 active agents bar chart showing each one's progress

Source: per-agent `migrations` table from `EmbeddingV2Migrator`.

### F10 — MCP server health panel (per agent)
**Value:** ★★★★ | **Cost:** M | **Phase 115 dep:** none

List of MCP servers wired to each agent with:
- Server name (`finmentum-db`, `brave-search`, `playwright`, `1password`, etc.)
- Status badge — `ready` (green) / `degraded` (amber) / `offline` (red)
- Tool count (e.g., "12 tools")
- Last ping time
- Reconnect button (operator-confirmed)

Source: `McpServerState` from `src/mcp/readiness.ts`. Pattern from Mastra Studio's MCPs sidebar.

---

## Tier 2 — Ship in v1.5 (high value, requires deeper UI work)

### F11 — Per-agent detail drawer (Letta-ADE-inspired three-panel)
**Value:** ★★★★★ | **Cost:** M-H | **Phase 115 dep:** none

Click an agent tile → right-side drawer (60% width) opens:
- **Left column** (agent config) — model, tier, escalation budget, allowed tools, current Discord channel binding(s), workspace path, MCP server count
- **Center column** (live state) — Discord channel transcript (last 50 turns), expandable per-turn drill-down with tool call sequence, real-time turn-in-progress indicator
- **Right column** (memory + perf) — Tier-1 budget meter, recent reflections snippet, MEMORY.md preview (read-only), SLO gauges (first_token / end_to_end / tool_call / context_assemble), 24h cost spend, dream-pass schedule + last fire

Extends the existing `/api/agents/:name/*` endpoints; minimal new backend.

### F12 — Per-agent trace waterfall (turn drill-down)
**Value:** ★★★★ | **Cost:** M | **Phase 115 dep:** none

Within F11's center column, click any turn → waterfall panel opens:
- Spans visualized as nested timeline rows: `context_assemble`, `first_token`, `first_visible_token`, `tool_call.<name>` (one per tool), `typing_indicator`, `end_to_end`
- Each span colored against its SLO threshold
- Hover: shows raw ms + percentile rank for that span across the agent's last 24h
- Cache eviction expected/observed flag inline

Source: `traces.db` + `trace_spans` table — already populated.

### F13 — Cross-agent IPC inbox viewer (ClawCode-unique)
**Value:** ★★★★ | **Cost:** M | **Phase 115 dep:** none

Show inter-agent message activity:
- **Per-agent inbox** — pending messages with sender, timestamp, delivery status (`pending` / `delivered` / `failed`)
- **Cross-agent message log** — last 24h flow of `send_to_agent` / `delegate_task` / `ask_agent` calls between agents
- **Heartbeat status** per inbox (the chokidar-watch state)

Pattern adapted from mukul975/claude-team-dashboard's inter-agent message inspector. Unique to ClawCode — no other tool surveyed has this concept.

### F14 — Memory subsystem panel (per agent, ClawCode-extension of Letta ADE)
**Value:** ★★★★ | **Cost:** M | **Phase 115 dep:** Tier 1/Tier 2 split types

Per agent in F11's right column:
- **Memory entry counts** — total / hot tier / warm tier / cold tier
- **Tier 1 file previews** — SOUL.md / IDENTITY.md / MEMORY.md / USER.md last-modified + char count + edit button
- **Vec_memories vs vec_memories_v2 delta** during migration (catches drift)
- **Last consolidation** — daily/weekly/monthly digest timestamps + size delta
- **Dream-pass status** — last fire, next scheduled, priority queue depth

Combines Letta-ADE's memory blocks editor with ClawCode's tier model.

### F15 — Dream-pass queue visibility (ClawCode-unique)
**Value:** ★★★★ | **Cost:** M | **Phase 115 dep:** D-05 priority trigger from Plan 05

Per-agent panel:
- **Pending dream-pass queue depth** + next scheduled fire time
- **Last 7 dream events** — timestamp + outcome (newWikilinks count, promotionCandidates surfaced, suggestedConsolidations, themedReflection extracted)
- **Priority pass trigger count (24h)** — instances where tier-1 truncation fired twice in 24h and forced a priority dream
- **D-10 hybrid policy state** — pending operator-veto windows for additive promotions (priorityScore ≥ 80), with countdown timer
- **Veto button** — one-click veto with rationale field

Operator's first-class window into the auto-consolidation engine.

### F16 — Agent comparison table
**Value:** ★★★★ | **Cost:** M | **Phase 115 dep:** none

Fleet-level view (sidebar nav option):
- One row per agent
- Sortable columns: avg p95 first_token, end_to_end p95, tool_cache_hit_rate, tier1_budget_pct, dream-pass count 7d, IPC delivery success rate, daily cost, MCP error count
- Filter by status / model / SLO breach
- Export CSV

Pattern from Langfuse's filterable trace table. Identifies outliers instantly.

### F17 — Cost dashboard
**Value:** ★★★★ | **Cost:** M | **Phase 115 dep:** none

Already-existing `/api/costs` endpoint finally surfaced:
- **Today / 7d / 30d** total token + image spend
- **Per-agent breakdown** — bar chart sorted by spend
- **Per-model split** — opus vs sonnet vs haiku
- **Trend chart** — daily spend over selected period with projection
- **Budget gauges** — daily/weekly/monthly limit vs actuals (linked to `EscalationBudget`)
- **Anomaly alert** — if any agent's daily spend > 2× its 30d average

Pattern from Helicone's cost trend.

---

## Tier 1.5 — Operator workflow features (added 2026-05-08 from operator review of v1 mockup)

### F26 — Agent config editor (in-UI)
**Value:** ★★★★★ | **Cost:** M | **Phase 115 dep:** none

Operator can edit agent config without leaving the dashboard or touching `clawcode.yaml` directly.

- **Config card** in the agent detail drawer with editable fields:
  - Model (dropdown — sonnet / opus / haiku, with allowedModels filter)
  - Tier escalation (low / mid / high)
  - Discord channel binding(s) — searchable picker showing channel name + recent message
  - Allowed/disallowed tools — chip selector
  - MCP server selection — toggle list with status preview
  - Effort + budgets (daily / weekly token caps with current utilization)
  - Workspace path (read-only, plus `memoryPath` override for shared-workspace agents)
  - Debug flag (`dumpBaseOptionsOnSpawn` from Phase 115-02)
- **Diff preview** before save — shows YAML diff with line-level highlighting
- **Save action** with two confirmation modes:
  - "Save (hot-reload)" — applies via existing ConfigWatcher pattern (Phase 88) for non-restart-required fields
  - "Save + restart" — operator-confirmed via modal, triggers graceful agent restart
- **Validation** — Zod schema runs client-side; errors surface inline before save
- **Audit trail** — every save creates an entry in the audit log (F23)
- **Backend reuse:** existing CLI commands (`clawcode model`, `clawcode openai-key`, etc.) already wrap most of this; the UI is a thin shell over a new `/api/agents/:name/config` endpoint that handles atomic YAML write via the existing `updateAgentModel` / `updateAgentSkills` / `updateAgentMcpServers` helpers.

Pattern: similar to Mastra Studio's right-sidebar form generation from inputSchema, but applied to agent config rather than tool inputs.

### F27 — Conversations view (active + past)
**Value:** ★★★★★ | **Cost:** M | **Phase 115 dep:** none

Two surfaces for the operator:

**Active conversations panel** (real-time):
- Per-agent indicator showing turns currently in-flight
- Live streaming view of the assistant's response as it arrives (mirrors Discord streaming behavior already in place)
- Tool call sequence as it happens, with progress indicator per call
- Operator can interrupt / steer (existing `clawcode steer` pattern surfaced in UI) or just observe

**Past conversations browser**:
- Per-agent OR fleet-wide ("show all Ramy threads across fin-acq + finmentum-content-creator")
- Search transcript text via existing FTS5 ConversationStore (Phase v1.9)
- Filter by date range, agent, channel, instruction-pattern flags (high/medium-risk injection attempts captured by SEC-02)
- Display as expandable thread cards: timestamp / channel / message count / preview / click-to-expand-full-transcript
- Per-message metadata visible on hover: model used, tokens, cost, tool calls, cache hit/miss
- Cross-references to Discord (links to original message in Discord client)

Backend: ConversationStore tables already populate every Discord turn with provenance + session-boundary summarization (Phase v1.9 CONV-01/02/03). Just needs a `/api/conversations` endpoint with filter/search params.

### F28 — Task assignment + tracking
**Value:** ★★★★★ | **Cost:** M | **Phase 115 dep:** none

Operator-facing task creation + assignment + tracking, replacing the existing `/tasks` page with a fleet-aware version.

**Create task flow:**
- "+ New task" button (also bound to Cmd+K → "create task")
- Modal form:
  - Title (required)
  - Description (markdown, with @-mention pickup for agent names)
  - Assign to: agent picker (single or "spawn subagent under fin-acquisition")
  - Priority: low / medium / high / urgent (drives scheduling order)
  - Deadline: optional date/time
  - Tags: free-text chips for grouping
- **Schedule:** "Run now" / "Schedule for later" (cron expression with helper UI)
- **Output destination:** Discord channel (default = agent's primary) / specific subagent thread / dashboard-only

**Task board view:**
- Kanban columns: Backlog / Scheduled / Running / Waiting / Failed / Done
- Each card: title, assigned agent badge, priority pill, deadline countdown, last-update timestamp
- Drag-and-drop between columns (Backlog → Scheduled triggers run-now)
- Click card → detail view with full task history + agent's response transcript
- Filter by agent / priority / status / tag

**Backend:** existing durable task store + state machine (Phase v1.8 LIFE-01..04) already supports this — `tasks.db` has 15-field rows, enforced state transitions, and trigger_state CRUD. The UI is a new surface over existing IPC `/api/tasks` endpoint extended with assignment + create methods.

**Pattern combination:** Mission Control's Kanban task board + AgentOps' agent-aware assignment + ClawCode's existing TaskScheduler (Phase 46).

---

## Two-mode strategy — Basic vs Advanced (added 2026-05-08)

Operator feedback: v1 mockup gave "advanced view vibes" — too dense for the daily glance use case. Solution: **two-mode interface with persistent toggle**.

### Basic Mode (default for new operators / mobile / glanceable)

Answers ONE question: *"Is anything broken right now? If so, where?"*

Surfaces:
- **Top banner** — single status indicator: "All systems normal" (green) / "2 agents need attention" (amber) / "Service degraded" (red)
- **Agent list** (one row per agent, NOT a tile grid):
  - Status dot
  - Display name + model badge (subtle)
  - "Active 2m ago" / "Idle 30m ago" / "Errored — view details"
  - Last message snippet (truncated, italicized)
  - Tap row → Conversations view for that agent (F27 active panel)
- **Quick actions** — 3 most-used: "+ Create task" (F28), "Restart errored agent", "Send message"
- **Settings cog** — opens config editor for selected agent (F26)
- **Mode toggle** — persistent in header

What's HIDDEN in basic mode:
- Tier-1 budget meters
- Tool cache stats
- Tool latency split
- Trace waterfalls
- Migration tracker
- Dream-pass queue
- Cross-agent IPC inbox
- MCP server health (unless degraded — then surfaced as part of "needs attention")

### Advanced Mode (current redesign, for power-user / debugging)

The full Tier 1 + Tier 2 feature set (F01-F25). For when the operator is debugging or doing deep analysis. All 25 features visible, three-panel inspector available.

### Mode persistence

- localStorage key `clawcode_dashboard_mode = "basic" | "advanced"`
- Default: basic for new sessions; advanced for sessions that previously selected it
- Mode toggle in header always visible: text "Basic" / "Advanced" with subtle pill indicator
- Mobile devices default to basic regardless of prior setting (advanced is too dense for <768px)

---

## Mobile responsiveness (added 2026-05-08)

v1 mockup was desktop-1440 only. v2 must support these breakpoints:

| Breakpoint | Behavior |
|---|---|
| **375px** (iPhone SE) | Single column. Header collapses to logo + hamburger + status. Sidebar nav becomes drawer (tap hamburger). Agent list as full-width rows (basic mode default). Detail drawer becomes full-screen modal. Cmd+K palette becomes touch-friendly bottom sheet. |
| **768px** (tablet portrait) | 2-column tile grid. Sidebar nav still drawer. Detail drawer = 90% modal. Tap-friendly hit targets ≥44px. |
| **1024px** (tablet landscape / small laptop) | Sidebar nav fixed (collapsed icons-only). 2-3 column tile grid. Detail drawer = 60% slide-in. |
| **1280px** (laptop) | Full sidebar nav with labels. 3-column tile grid. Detail drawer = 60% slide-in. |
| **1920px** (desktop) | 4-column tile grid. Detail drawer = 50% slide-in. Two-pane layouts where applicable. |

### Mobile-specific patterns

- **Bottom tab nav** on mobile (replaces sidebar): `[Fleet] [Convos] [Tasks] [Settings]` — 4 tabs max
- **Swipeable agent cards** in basic mode (swipe left = restart, swipe right = open settings) with toast-confirm pattern
- **Pull-to-refresh** on fleet view (also re-establishes SSE if connection dropped)
- **Optimized touch targets** — all interactive elements ≥44px
- **Conversations view** is mobile-first natural (Discord-like message list)

---

## Tier 3 — Polish pass (medium value, future iterations)

### F18 — 30-day activity heatmap (per agent)
**Value:** ★★★ | **Cost:** M | **Phase 115 dep:** none

Calendar grid (GitHub-contribution-style) showing turn count per day per agent. Pattern from tugcantopaloglu's activity heatmap. Source: `traces.db` GROUP BY date(started_at).

### F19 — Swim-lane timeline for concurrent agent activity
**Value:** ★★★ | **Cost:** H | **Phase 115 dep:** none

Horizontal timeline with one lane per agent, events as colored blocks. Shows IPC timing correlations. Canvas-rendered for 14-lane performance. Pattern from disler/claude-code-hooks-multi-agent-observability.

### F20 — Notification feed (operator alerts)
**Value:** ★★★ | **Cost:** M | **Phase 115 dep:** none

Header bell icon → slide-over panel with badge-counted feed:
- SLO breach events
- Budget exceeded events
- MCP server degradation events
- Dream-pass priority triggers
- Cross-agent IPC delivery failures
- Migration phase transitions

### F21 — Theme toggle (dark/light + variants)
**Value:** ★★★ | **Cost:** L | **Phase 115 dep:** none

shadcn ships CSS-variable theming. Add light theme + 1-2 alt dark themes (e.g., "muted" with less saturation, "high-contrast" for accessibility). Persist to localStorage.

### F22 — Activity heatmap fleet view
**Value:** ★★★ | **Cost:** M | **Phase 115 dep:** none

Fleet-aggregated heatmap showing which hours of the day the fleet is busiest — informs operator when to schedule deploys + maintenance.

### F23 — Operator action audit log
**Value:** ★★★ | **Cost:** M | **Phase 115 dep:** none

Append-only log: every operator action in the dashboard (restart agent, change config, veto promotion, kick off migration, etc.) recorded with timestamp + operator identity. Compliance-relevant.

### F24 — Knowledge graph integration (re-skin existing /graph view)
**Value:** ★★★ | **Cost:** M | **Phase 115 dep:** none

The existing `/graph` page (679-line standalone HTML) gets re-skinned to match the new dashboard aesthetic and integrated as a tab in the agent detail drawer (F11) so operators don't context-switch to a separate page.

### F25 — Tasks board integration (re-skin existing /tasks view)
**Value:** ★★★ | **Cost:** M | **Phase 115 dep:** none

Existing `/tasks` page (461-line standalone HTML) integrated as fleet-level Kanban view alongside F16 comparison table. Status columns: scheduled / running / waiting / failed / done.

---

## Out of v1 scope (explicit deferrals)

- **Approval-driven governance UI** (Mission Control pattern) — ClawCode's operator is single-user; not needed
- **Skills security scanner** (Mission Control) — relevant but separate phase
- **Multi-framework adapters** (Mission Control) — ClawCode is Claude-only by design
- **Session replay / time-travel debugging** (AgentOps) — high storage cost, deferred
- **OpenTelemetry native** (Phoenix) — overkill for a tightly-coupled daemon
- **i18n** (hoangsonww) — single-operator tool, English-only
- **Prometheus + Grafana + Helm deployment** — internal tool, not enterprise
- **Cloud-hosted dashboard mode** — local-only by design
- **Auth (Clerk / Google Sign-In)** — local-only

---

## Tech Stack Decision

**Locked recommendation:** **Vite + React 19 + shadcn/ui + Tailwind 3.4 + Recharts 3 + TanStack Query + Lucide icons**

Validation:
- Research: 9/10 fit score, validated by simple10/agents-observe (closest analogue)
- ClawCode-compatible: TypeScript + Node.js daemon serves the SPA; no new process
- Phase 115 metrics: every column maps to a shadcn-native component
- Build: Vite + Rolldown, ~30s production build, hot-reload dev iteration
- Bundle: ~200KB gzipped after tree-shake; well within local-tool tolerances

**Implementation pattern:**
```
src/dashboard/
  client/                       ← NEW: Vite React SPA (replaces static/)
    src/
      app.tsx
      routes/
        fleet.tsx               (F01-F03 fleet overview)
        agent-detail.tsx        (F11-F15 per-agent drawer)
        comparison.tsx          (F16 fleet comparison)
        costs.tsx               (F17 cost dashboard)
        graph.tsx               (F24 graph re-skin)
        tasks.tsx               (F25 tasks re-skin)
      components/
        AgentTile.tsx
        Tier1Meter.tsx
        ToolCacheGauge.tsx
        SloBreachBanner.tsx
        CommandPalette.tsx      (F06)
        TraceWaterfall.tsx      (F12)
        IpcInbox.tsx            (F13)
        MemoryPanel.tsx         (F14)
        DreamPassQueue.tsx      (F15)
        MigrationTracker.tsx    (F09)
      hooks/
        useSSE.ts
        useAgentMetrics.ts
        useFleetState.ts
      lib/
        api.ts
        slo-thresholds.ts       (F02 per-model SLO config)
    vite.config.ts
    index.html
  server.ts                     ← Existing — extends to serve SPA + add ~3 new endpoints
  static/                       ← REMOVED in v1 (operator can keep around as fallback)
```

**Migration plan:**
- New SPA lives at `/dashboard` route initially while old static UI stays at `/`
- Operator can flip via config flag once new dashboard hits parity
- Old `static/` removed after 2-week soak

---

## Phased Implementation Plan

### Phase X-00 — Scaffolding (~3-5 hours)
- Vite + React + shadcn project bootstrap in `src/dashboard/client/`
- Build pipeline integration with daemon
- Routes scaffold: `/dashboard/v2` serves new SPA, old `/` unchanged
- F02 per-model SLO threshold config in `slos.ts` + `clawcode.yaml` schema (the 999.38 piece)
- One smoke test that the SPA renders + connects to existing SSE

### Phase X-01 — Tier 1 v1 (~12-18 hours)
- F01 SLO breach banner + fleet header
- F02 Per-model SLO recalibration (999.38 surface — re-derive thresholds from observed data)
- F03 Agent tile grid
- F04 Tier-1 budget meter
- F05 Tool cache gauge
- F06 Cmd+K palette
- F07 Tool latency split panel
- F08 Prompt bloat + lazy recall counters
- F09 Embedding migration tracker
- F10 MCP server health panel

### Phase X-02 — Tier 2 (~15-25 hours)
- F11 Agent detail drawer (three-panel)
- F12 Trace waterfall
- F13 Cross-agent IPC inbox
- F14 Memory subsystem panel
- F15 Dream-pass queue visibility
- F16 Comparison table
- F17 Cost dashboard

### Phase X-03 — Polish + cutover (~6-10 hours)
- F18-F25 polish pass (heatmap, swim-lane, notifications, themes, integration of /graph and /tasks)
- Full feature-parity smoke test against old dashboard
- Operator review + cutover
- Remove old `static/` directory

**Total estimate:** ~40-60 hours of executor time across ~3-4 plans. Comparable scope to Phase 115's wave 2 structural backbone.

---

## Bundling with 999.38

Phase 999.38 was scoped as "dashboard SLO recalibration per model" — every opus tile shows red because SLOs assume sonnet speed. **F02 IS Phase 999.38** in the redesign. The recalibration logic ships in the X-00 scaffolding wave (`slos.ts` extension + per-model threshold config) and surfaces visually in F03/F07/F11. 999.38 closes when the redesigned dashboard ships.

---

## Mockup deliverables

See sibling files in this directory:
- `mockup-fleet-overview.html` — Tier 1 features rendered as if alive
- `mockup-agent-detail.html` — Three-panel inspector with mock fin-acquisition data
- `mockup-cmd-palette.html` — Cmd+K demo
- `index.html` — Landing page linking the three mockups + comparison vs. current

All mockups self-contained (CDN-loaded Tailwind + shadcn-styled), open in any browser, use mocked data shaped like the actual fleet (Admin Clawdy, fin-acquisition, research, etc.) so the operator gets a real-feeling preview.
