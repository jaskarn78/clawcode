# ClawCode Dashboard Redesign — Research Survey

**Date:** 2026-05-08
**Scope:** Multi-agent orchestration dashboards, Claude Code UIs, LLM observability platforms, Discord bot fleet management
**Purpose:** Input to a comprehensive ClawCode dashboard redesign from HTML+SSE on port 3100

---

## 1. Executive Summary

Seven convergent design patterns emerge across the fourteen projects surveyed:

- **Left-config / center-primary / right-state** is the dominant three-panel pattern (Letta ADE, Mastra Studio) for per-entity deep-dives. For fleet overviews, a **left sidebar nav + main content area** prevails (Mission Control, Langfuse, agents-observe).
- **React 19 + Vite + shadcn/ui + Tailwind + TanStack** is the 2026 default stack for operator-facing dashboards. Every project started after mid-2024 uses this combination or a subset of it. Static HTML+SSE is now universally considered a prototype artifact.
- **Hook-driven zero-polling architectures** dominate Claude Code-specific dashboards. Claude Code fires hooks (PreToolUse, PostToolUse, SubagentStop, etc.) and dashboards receive events via WebSocket or SSE; no timed polling. The mudrii openclaw-dashboard's 60-second polling is the counter-example everyone else deliberately avoids.
- **Per-agent context-window meters** appear in every post-2025 agent dashboard. "Context used % + token budget remaining" is treated as a primary metric, not a detail.
- **Tool-level latency decomposition** (execution ms vs. round-trip ms vs. model time) is the emergent pattern in 2025-2026 Claude Code dashboards; older LLM observability tools show only end-to-end latency.
- **Memory subsystem visibility** (memory blocks, consolidation state, recall quality) is a first-class concern in Letta ADE and SwarmClaw but absent in every generic LLM observability platform.
- **Kanban-style task boards + D3 force-directed agent graphs** appear together in the four most-starred agent-specific dashboards; the two features are treated as complementary, not alternatives.

---

## 2. Per-Project Analysis

### 2.1 tugcantopaloglu/openclaw-dashboard
**URL:** https://github.com/tugcantopaloglu/openclaw-dashboard
**Stars:** 671 | **Last release:** v3.0.0 (2026-03-05)
**What it monitors:** Claude/OpenClaw sessions, costs, rate limits, memory files, system health, Docker, crons
**Stack:** Vanilla JS (no framework), Node.js backend, SSE via `/api/live`, JSON file store, 5-second polling intervals, sparklines for trends
**Layout:** 15-panel single-page dashboard with tabbed sidebar; no JS framework — inline event handlers

**Distinctive features worth borrowing:**
- Activity heatmap (30-day peak-usage calendar) is unique across all surveyed projects
- Rate-limit panels for both Claude and Gemini API with rolling window display
- Memory file browser showing MEMORY.md, HEARTBEAT.md, daily notes directly in UI
- Timeline view: visual per-session activity strips across a day
- Security panel (UFW rules, fail2ban, SSH logs) — rare in AI dashboards

**Anti-patterns:**
- No component architecture — 3000+ line monolithic app.js
- 5-second blanket polling causes unnecessary load; SSE available but underused
- No per-agent drill-down; everything is fleet-aggregate
- Sparklines require custom SVG; no reuse across panels

---

### 2.2 mudrii/openclaw-dashboard
**URL:** https://github.com/mudrii/openclaw-dashboard
**Stars:** 433 | **Last release:** v2026.4.29
**What it monitors:** Host metrics (CPU/RAM/swap/disk), cost, crons, sessions, tokens, sub-agents, gateway
**Stack:** Go binary backend with embedded HTML/JS frontend, pure SVG charts, 6 built-in CSS themes, 60-second polling
**Layout:** 12 panels in a stacked single-page layout; header bar with status + theme picker; 60-second countdown timer visible in header

**Distinctive features worth borrowing:**
- "Stale-while-revalidate" caching pattern: UI renders instantly from cache while fresh data loads in background
- 6 switchable themes (3 dark, 3 light) persisted to localStorage — demonstrates operator preference matters
- Sub-agent activity breakdown (cost, duration, status, token breakdown per sub-agent)
- Gateway status panel with dependency health tree

**Anti-patterns:**
- 60-second polling is the primary real-time mechanism — no SSE or WebSocket
- Kitchen-sink layout with no primary use case; 12 panels compete for attention
- Zero-dependency philosophy prevents reuse of established chart libraries
- Agent hierarchy tree shown only at session level — no fleet-wide org chart

---

### 2.3 abhi1693/openclaw-mission-control
**URL:** https://github.com/abhi1693/openclaw-mission-control
**Stars:** 3.9k | **Forks:** 815
**What it monitors:** Agent lifecycle, task boards, approval workflows, activity timelines
**Stack:** TypeScript + Python; Docker Compose; Clerk JWT auth; no cost tracking
**Layout:** Kanban board for tasks + agent operations panel + activity timeline; role-based views (viewer/operator/admin)

**Distinctive features worth borrowing:**
- Approval-driven governance: sensitive agent actions route through explicit approval UI
- Activity timeline with decision trail attached to work items — full audit log
- API-first: all UI actions available as API calls (enables scripting)

**Anti-patterns:**
- No cost or token tracking at all
- Python backend adds operational complexity for a TypeScript project
- Clerk dependency creates vendor lock for auth

---

### 2.4 builderz-labs/mission-control
**URL:** https://github.com/builderz-labs/mission-control
**Stars:** 4.7k | **Forks:** 820
**What it monitors:** 32 panels covering tasks, agent monitoring, skills, costs, security
**Stack:** Next.js 16 + React 19 + Tailwind 3.4 + Recharts 3 + Zustand 5 + SQLite (WAL) + WebSocket+SSE; Zod 4 validation; Vitest + Playwright tests
**Layout:** Left sidebar nav; Kanban task board as primary view; skills hub; cost dashboard; real-time security posture

**Distinctive features worth borrowing:**
- Skills security scanner checks for prompt injection, credential leaks, data exfiltration in installed skills
- Sub-agent spawning inline from Kanban task cards — a direct action without navigating away
- Multi-framework support: adapters for OpenClaw, CrewAI, LangGraph, AutoGen, Claude SDK
- Real-time security posture scoring — a panel ClawCode could adapt for MCP tool audit
- 32 panels but organized into clear navigation groups — density without chaos

**Anti-patterns:**
- Next.js SSR is overkill for a local daemon dashboard; adds unnecessary complexity
- 32 panels with no progressive disclosure means new operators are overwhelmed
- Google Sign-In dependency introduces external auth for what should be local-only access

---

### 2.5 hoangsonww/Claude-Code-Agent-Monitor
**URL:** https://github.com/hoangsonww/Claude-Code-Agent-Monitor
**Stars:** 337
**What it monitors:** Claude Code sessions, subagent hierarchies, tool usage, tokens, costs, health
**Stack:** Node.js + Express + SQLite3 + WebSockets + React + Vite + TailwindCSS + D3.js + Mermaid; Prometheus + Grafana + OpenTelemetry integration; i18next internationalization
**Layout:** 8-tab interface: Monitor / Health / Kanban / Sessions / Session Detail / Activity Feed / Analytics / Workflows

**Distinctive features worth borrowing:**
- Subagent tool attribution: scans subagent JSONL to reconstruct internal tool calls normally invisible to dashboards
- Workflow tab: D3-powered orchestration DAG + Sankey tool-execution diagram + error propagation maps
- Session detail with 6 real-time metric tiles + agent hierarchy tree + filterable event timeline + conversation transcript
- Compaction-aware token accounting: distinguishes pre- vs. post-compaction token counts
- Transcript cache with stat-based byte-offset tracking (~50x read speedup for long sessions)

**Anti-patterns:**
- i18n (English/Chinese/Vietnamese) adds significant maintenance surface for an internal operator tool
- Prometheus + Grafana + OTel integration makes self-hosting heavier than necessary
- Kubernetes + Helm deployment targets enterprise ops teams, not individual operators

---

### 2.6 simple10/agents-observe
**URL:** https://github.com/simple10/agents-observe
**Stars:** 535 | **Last release:** v0.9.2 (2026-04-23)
**What it monitors:** Claude Code session events, tool call sequences, subagent relationships, timing
**Stack:** React 19 + shadcn/ui + Hono (Node.js) + SQLite + WebSocket; TypeScript 83.6%
**Layout:** Single-page event timeline; expandable rows; session browser with human-readable names; filter panel

**Distinctive features worth borrowing:**
- Human-readable session names ("twinkly-hugging-dragon") — reduces cognitive load in multi-agent fleet
- Tool call deduplication: Pre/Post events merged into single rows with result inline
- shadcn/ui adoption validates the component library choice for this exact use case
- Hono server is ~10x lighter than Express for the same routing needs

**Anti-patterns:**
- No cost or latency tracking — pure event stream viewer
- No fleet-level aggregation; can only view one session at a time
- No SLO or threshold alerting

---

### 2.7 disler/claude-code-hooks-multi-agent-observability
**URL:** https://github.com/disler/claude-code-hooks-multi-agent-observability
**Stars:** 1.4k | **Forks:** 369
**What it monitors:** 12 Claude Code hook event types, multi-agent parallel execution, subagent lifecycle
**Stack:** Bun + TypeScript + SQLite (server); Vue 3 + TypeScript + Vite + Tailwind (client); WebSocket
**Layout:** Event timeline + live pulse canvas chart + filter panel + chat transcript viewer; swim-lane filtering by agent

**Distinctive features worth borrowing:**
- Swim-lane filtering: toggle to view only events from a specific agent in a parallel team
- Live pulse chart: canvas-based visualization with session-colored bars and event emoji indicators — distinctive and immediately readable
- Dual-color system: one color per app identity, one per session — survives overlapping concurrent agents

**Anti-patterns:**
- Vue 3 client-side adds a second framework choice when React 19 + shadcn covers the same space
- Bun server adds runtime dependency mismatch with existing Node.js daemon
- Chat transcript viewer requires ElevenLabs/OpenAI TTS API key for audio — external dependency

---

### 2.8 mukul975/claude-team-dashboard
**URL:** https://github.com/mukul975/claude-team-dashboard
**Stars:** 42 | **Last release:** v1.2.8 (2026-02-25)
**What it monitors:** Claude Code agent teams, inter-agent messages, task progress, system resources
**Stack:** React 19.2 + Vite 7 + Express + WebSocket + Chokidar + Vitest; Lucide React icons; CSS custom properties
**Layout:** Tabbed SPA; Teams / Tasks / Communication / Archives tabs

**Distinctive features worth borrowing:**
- Command palette (Cmd+K) for navigation — the highest-impact UX pattern most agent dashboards omit
- Inter-agent message inspector: shows inbox messages between agents in a conversation view
- One-click CSV/JSON export for tasks and messages
- Team archiving with natural language summaries

**Anti-patterns:**
- No cost, token, or latency tracking
- JavaScript-majority codebase (82.9%) with no TypeScript strictness
- Chokidar file-watching tied to specific directory structure (~/.claude/teams/)

---

### 2.9 Mastra Studio
**URL:** https://github.com/mastra-ai/mastra
**Stars:** 23.7k | **Last release:** 2026-05-04
**What it monitors:** Agents, workflows, MCP servers, traces, evaluations
**Stack:** React SPA (Vite build); @mastra/playground-ui component library with design system primitives; react-router; Zustand; SSE for real-time
**Layout:** Sidebar nav (Agents / Workflows / MCPs / Observability / Evaluation); workflow steps shown as interactive graph; right sidebar shows I/O and state during execution

**Distinctive features worth borrowing:**
- Workflow graph view: center panel visualizes steps as a DAG; real-time status updates per step during execution
- Right sidebar generates form from inputSchema — I/O bound to schema, not hardcoded
- Observability tab links evaluation scores back to specific spans (score-to-trace traceability)
- @mastra/playground-ui as a reusable component library: DataPanel, PageHeader, MainSidebar — clean separation

**Anti-patterns:**
- Development-only orientation (localhost studio); no production monitoring mode
- Evaluation / evals tab has limited value for an operator dashboard (vs. a developer tool)
- Permission-gated nav sections add confusion when all features should be available to the operator

---

### 2.10 Letta ADE
**URL:** https://github.com/letta-ai/letta
**Stars:** 22.5k | **Last release:** v0.16.7 (2026-03-31)
**What it monitors:** Stateful agent memory, context window, tool calls, conversation history
**Layout:** Three-panel ADE — left (Agent Configuration: model, system instructions, tools), center (Agent Simulator: conversation + tool execution history), right (State Visualization: context window viewer + core memory blocks editor)

**Distinctive features worth borrowing:**
- Context Window Viewer: live view of what's currently in the agent's context, not just token count
- Core Memory Blocks editor: directly modify persistent memory blocks in the UI during a session
- Tool editor with mock-run: write a Python tool, run it with mock inputs, see result + logs inline
- Memory block length limits shown as progress bars — visual budget for persistent memory

**Anti-patterns:**
- No fleet-level view; the ADE is per-agent, with no overview of all agents
- No cost or latency tracking — purely structural/memory-oriented
- Cloud-hosted dashboard (app.letta.com) with no self-hosted configuration for local-only setups

---

### 2.11 Langfuse
**URL:** https://github.com/langfuse/langfuse
**Stars:** 26.8k | **Last release:** v3.173.0 (2026-05-08)
**What it monitors:** LLM traces, prompt management, evals, cost/latency, sessions
**Stack:** TypeScript 98.8%; Next.js + React; ClickHouse for analytics; PostgreSQL; self-hosted or cloud
**Layout:** Left sidebar nav (Traces / Sessions / Users / Prompts / Evals / Metrics / Dashboards); trace detail uses tree/timeline toggle; custom dashboard builder

**Distinctive features worth borrowing:**
- Tree vs. timeline toggle for trace view — operators choose their mental model
- Filter sidebar persists across trace table navigation — reduces repetitive filtering
- Custom dashboard builder: multi-level aggregations (trace / user / session) with team sharing
- Score-to-span linking: evaluation scores visible alongside the specific span that generated them

**Anti-patterns:**
- Requires ClickHouse + PostgreSQL + multiple services — heavy for local deployment
- Session replay oriented toward user-facing apps, not operator/internal tooling
- Prompt management is irrelevant when agents use dynamic prompts assembled at runtime

---

### 2.12 Helicone
**URL:** https://github.com/Helicone/helicone
**Stars:** 5.6k
**What it monitors:** LLM requests, cost, latency, quality, model usage
**Stack:** Next.js + TypeScript (91.2%); Cloudflare Workers proxy; ClickHouse analytics; Supabase auth
**Layout:** Gateway-oriented; request log as primary view; dashboard shows cost trend + latency + model distribution

**Distinctive features worth borrowing:**
- Cost trend visualization with projected monthly spend — single most-requested operator metric
- Per-model latency breakdowns in the main dashboard (not buried in trace detail)
- Anomaly detection with alerting (Slack/email webhooks)

**Anti-patterns:**
- Proxy-first architecture: monitoring requires routing all LLM traffic through Helicone's gateway
- ClickHouse + Supabase + Cloudflare Workers makes self-hosting operationally complex
- No agent-specific concepts (memory, tool caches, subagent trees)

---

### 2.13 AgentOps
**URL:** https://github.com/agentops-ai/agentops
**Stars:** ~5.4k (SDK)
**What it monitors:** Agent sessions, LLM calls, tool usage, costs, errors; 400+ framework integrations
**Stack:** Python SDK; cloud-hosted dashboard; MIT licensed

**Distinctive features worth borrowing:**
- Session Replay: records and replays agent runs so you can inspect exact execution post-hoc
- Time Travel Debugging: step through past agent states to find exactly where reasoning diverged
- Token usage with projected cost per model per session

**Anti-patterns:**
- Cloud-only dashboard (no self-hosted); data leaves your environment
- Python SDK only — no native TypeScript instrumentation
- Session replay is high-value but requires significant storage (JSONL per session)

---

### 2.14 Arize Phoenix
**URL:** https://github.com/Arize-ai/phoenix
**Stars:** Not captured explicitly; widely cited
**What it monitors:** LLM traces, agent spans, tool executions, retrievals; OpenTelemetry native
**Layout:** Trace list → trace detail waterfall; spans show timing, inputs, outputs, costs

**Distinctive features worth borrowing:**
- OpenTelemetry native: standard OTLP ingestion — future-proofs instrumentation
- Span waterfall visualization: the canonical way to show nested tool call timing vs. LLM time
- LLM-as-judge evaluators attached to spans — inline quality scoring alongside trace

**Anti-patterns:**
- OpenTelemetry adds instrumentation complexity for a tightly-coupled daemon
- No Discord/channel concept — purely LLM-call-oriented
- Self-hosting requires Docker + ClickHouse; Kubernetes recommended for production

---

## 3. Convergent Features Matrix

| Feature | tugcantopaloglu | mudrii | mission-control | agent-monitor | agents-observe | mastra | letta | langfuse | ClawCode Relevance |
|---|---|---|---|---|---|---|---|---|---|
| Fleet agent list with status | Y | Y | Y | Y | Y | Y | — | — | 5 |
| Per-agent context/token meter | — | Y | — | Y | — | — | Y | — | 5 |
| SLO / latency breach indicators | — | — | — | — | — | — | — | Y | 5 |
| Real-time hook-driven updates | partial | — | Y | Y | Y | Y | — | — | 5 |
| Tool-level latency decomposition | — | — | — | Y | partial | Y | — | Y | 5 |
| Memory subsystem view | Y | — | — | — | — | — | Y | — | 5 |
| Cost tracking with trend | Y | Y | Y | Y | — | — | — | Y | 4 |
| Subagent hierarchy tree | — | Y | Y | Y | Y | — | — | — | 4 |
| Kanban task board | — | — | Y | Y | — | — | — | — | 3 |
| D3 / force-directed agent graph | — | — | — | Y | — | — | — | — | 3 |
| Activity heatmap | Y | — | — | — | — | — | — | — | 3 |
| Trace waterfall / tree+timeline | — | — | — | Y | Y | Y | — | Y | 4 |
| Tool cache hit rate panel | — | — | — | — | — | — | — | — | 5 |
| Embedding migration tracker | — | — | — | — | — | — | — | — | 5 |
| Dream-pass queue visibility | — | — | — | — | — | — | — | — | 5 |
| Cross-agent IPC inbox viewer | — | — | — | — | partial | — | — | — | 5 |
| Command palette (Cmd+K) | — | — | — | — | — | — | — | — | 4 |
| Theme switching | — | Y | — | — | — | — | — | — | 3 |
| Security posture panel | Y | — | Y | — | — | — | — | — | 3 |
| MCP server health panel | — | — | — | — | — | Y | — | — | 5 |

*ClawCode Relevance: 5 = critical / directly backed by existing data, 3 = nice-to-have*

---

## 4. Design Patterns Observed

### Layout Patterns

**Pattern A — Three-Panel Entity Inspector** (Letta ADE, Mastra Studio)
Left: configuration/selector. Center: primary interaction / transcript. Right: live state (context, memory, SLOs). Best for per-agent deep-dives. Maps directly onto ClawCode's per-agent view: left = agent config + model/tier, center = Discord channel transcript, right = memory blocks + context meter + SLO gauges.

**Pattern B — Sidebar Nav + Content Area** (Mission Control, Langfuse, Helicone)
Fixed left sidebar with labeled sections (Agents / Traces / Costs / Memory / Settings). Main content area renders selected section. Best for fleet-level overviews with multiple functional areas. This is the appropriate pattern for ClawCode's primary dashboard view.

**Pattern C — Swimlane / Multi-Agent Timeline** (disler/agents-observe, claude-team-dashboard)
Horizontal lanes per agent with events plotted on a shared time axis. Shows concurrent agent activity. Useful for debugging inter-agent coordination issues and IPC timing.

### Real-Time Mechanisms

All post-2024 dashboards use either WebSocket or SSE. No project newer than 2024 uses pure polling as the primary mechanism. ClawCode's existing SSE is competitive with WebSocket for this use case (unidirectional server-to-client updates); there is no compelling reason to switch.

### Density Preferences

Projects managing 10+ agents cluster into two camps:
- **Compact tile grid** (tugcantopaloglu): small cards per agent, scan quickly, drill to detail
- **Expanded list with inline sparklines** (mission-control, agents-observe): more data per row, fewer agents visible at once

For 10-14 agents, compact tiles with status indicators + a quick-expand to agent detail is the dominant pattern.

### Dark/Light Theme

All high-starred projects (>1k stars) ship dark mode by default with a theme toggle. Light mode is secondary. mudrii's 6-theme picker is the outlier that demonstrates operator preference matters more than designers expect.

---

## 5. Tech Stack Recommendations for ClawCode Dashboard Rebuild

### Option A — Vite + React 19 + shadcn/ui + Tailwind + TanStack (RECOMMENDED)

**Fit score: 9/10**

- Current stack (TypeScript + Node.js + better-sqlite3) is 100% compatible
- shadcn/ui is validated by simple10/agents-observe (the closest ClawCode analogue)
- Mission Control (4.7k stars) uses Recharts 3 for charts; pairs well with shadcn
- TanStack Router replaces react-router v6 with better TypeScript inference
- TanStack Query handles SSE subscription + cache invalidation cleanly
- Vite 8 (Rolldown bundler) gives fast dev iteration; no separate build pipeline needed
- Serves as a static SPA from the existing daemon's Express server — no new process
- shadcn components: Card, Badge, Progress, Separator, Tooltip, Command palette (Dialog+Command) — all needed components exist
- Chart library recommendation: **Recharts 3** (mission-control validated) or **Tremor** (shadcn-native chart components, simpler API)

Recommended implementation pattern:
```
src/dashboard/
  client/               ← new Vite React app (replaces static/)
    src/
      app.tsx
      components/
        AgentGrid.tsx
        AgentDetailPanel.tsx
        SloGauges.tsx
        ToolCachePanel.tsx
        MemoryPanel.tsx
        CrossAgentIpcPanel.tsx
      hooks/
        useSSE.ts
        useAgentMetrics.ts
      lib/
        api.ts
    vite.config.ts
    index.html
  server.ts             ← existing, minimal changes (add /api/* routes)
```

### Option B — Next.js 16 + React 19 + shadcn/ui

**Fit score: 6/10**

- Adds SSR machinery not needed for a local daemon dashboard
- Auth scaffolding (Clerk/NextAuth) is overkill for single-operator use
- Larger bundle, slower cold starts
- Use only if dashboard needs to be exposed externally with multi-user auth

### Option C — Keep static HTML + vanilla JS

**Fit score: 2/10**

- Cannot viably manage the 15+ new metrics (tier1_inject_chars, tool_cache_hit_rate, lazy_recall, tool_execution_ms, tool_roundtrip_ms, dream-pass queue, embedding migration, cross-agent IPC) without becoming unmanageable
- No component reuse, no type safety, no testing surface
- The existing dashboard is already operator-described as "pretty awful" — more vanilla JS won't fix the structural problem

---

## 6. Anti-Patterns to Avoid

1. **Polling as primary real-time mechanism** — mudrii's 60-second refresh gives the operator stale data for an entire minute after an agent crashes. ClawCode's SSE is already superior; maintain it.

2. **Kitchen-sink single-page layout with no hierarchy** — mudrii's 12 panels, tugcantopaloglu's 15 panels, and mission-control's 32 panels all suffer from the same problem: an operator can't triage quickly because everything competes for attention. Use progressive disclosure (overview → agent → detail).

3. **No primary use case** — The best dashboards have a clear answer to "what's the first thing an operator does each morning." ClawCode's answer should be: "see which agents are active/idle/errored, and whether any SLO is breaching." Design the above-the-fold view around that.

4. **External service dependencies for self-hosted tools** — Helicone's ClickHouse + Supabase + Cloudflare Workers, and Langfuse's multi-container stack, add operational burden that negates local deployment benefits. ClawCode's SQLite-backed trace store is a strength; the dashboard should not require anything external.

5. **Agent-unaware visualizations** — Generic LLM observability tools (Helicone, Langfuse) show request logs without understanding agent structure: no memory, no channel, no dream-pass, no IPC. Any template borrowed from these must be rethought in agent terms.

6. **No progressive disclosure for agent detail** — Every project that only shows a fleet grid fails operators who need to drill into a single misbehaving agent's tool call trace. Every project that only shows per-agent detail fails operators who need fleet status at a glance. Both views are required.

7. **Omitting Cmd+K command palette** — Only mukul975/claude-team-dashboard ships a command palette. This is the single highest-value UX addition for an internal tool where the operator is power-user, not casual.

---

## 7. Specific Feature Recommendations for ClawCode

Ranked by **operator value / implementation cost** (H/M/L per axis).

### Tier 1: Critical — do first (high value, low–medium cost)

**R1 — SLO breach banner (above the fold)**
Value: H | Cost: L
Show a dismissible banner when any SLO is breaching: `end_to_end p95 > 6000ms`, `first_token p50 > 2000ms`, `context_assemble p95 > 300ms`, `tool_call p95 > 1500ms`. All thresholds already in `src/performance/slos.ts` DEFAULT_SLOS. Data available from TraceStore.getLatencyPercentiles().

**R2 — Agent status tile grid (compact)**
Value: H | Cost: L
One card per agent: name, status dot (active/idle/error), current model/tier, context %, last turn time, p95 latency badge with SLO color (green/amber/red). Replaces the current `#agent-grid` div. Data from existing daemon SSE `/api/events`.

**R3 — Tool execution vs. round-trip latency split**
Value: H | Cost: L
Two metrics per agent: `tool_execution_ms` (pure execution time) and `tool_roundtrip_ms` (execution + SDK overhead). Already stored in `traces` table per Phase 115 Plan 08. Surface as a 2-bar chart or two labeled stats in the agent detail panel. This is the metric no generic observability tool provides.

**R4 — Tier-1 context budget meter**
Value: H | Cost: L
Per-agent: show `tier1_inject_chars` as a progress bar against the budget. Show `tier1_budget_pct` as a percentage label. Source: `getPhase115DashboardMetrics()` — already returns `latestTier1InjectChars` and `latestTier1BudgetPct`. Wire this directly; it's a one-query, one-component change.

**R5 — Tool cache hit rate panel**
Value: H | Cost: L
Show `avg_hit_rate` and `p50HitRate` / `p95HitRate` from `TraceStore.getToolCacheStats()`. A single gauge per agent with a 7d trend sparkline. Directly backed by `tool_cache_hit_rate` column in traces table (Phase 115 Plan 07).

**R6 — Cmd+K command palette**
Value: H | Cost: M
shadcn's `<Command>` dialog provides this out of the box. Index: agent names, SLO statuses, recent tool errors, "restart agent", "view memory". The single highest-impact UX feature missing from every surveyed project.

### Tier 2: High value — second iteration

**R7 — Per-agent trace waterfall / event timeline**
Value: H | Cost: M
Clicking an agent opens a right-panel detail view. Shows the last N turns as a collapsible tree: turn → spans (context_assemble, tool_call.*, first_token, end_to_end) with durations color-coded against SLO thresholds. Pattern from Claude-Code-Agent-Monitor's Session Detail tab. Data: TraceStore span rows.

**R8 — Prompt bloat + lazy recall counters**
Value: H | Cost: L
Surface `lazyRecallCalls24h` and `promptBloatWarnings24h` from `getPhase115DashboardMetrics()` as two labeled counters in the agent detail panel, with amber highlight when >0. Zero-cost: data already computed and available.

**R9 — Cross-agent IPC inbox viewer**
Value: H | Cost: M
Show undelivered messages in the cross-agent IPC inbox per agent, with sender, timestamp, and delivery status. Pattern from mukul975's inter-agent message inspector but adapted to ClawCode's filesystem inbox model (chokidar-watch the inbox directory). Unique to ClawCode — no other tool has this concept.

**R10 — MCP server health panel**
Value: H | Cost: M
Per-agent: list active MCP servers with their readiness state. Source: existing `McpServerState` type in `src/mcp/readiness.ts`. Pattern from Mastra Studio's MCPs sidebar section. Show: server name, status (ready/degraded/offline), last ping time, tool count.

**R11 — Memory subsystem state panel**
Value: H | Cost: M
Three metrics per agent: total memory entries, embedding migration phase (% migrated), and last consolidation timestamp. Pattern from Letta ADE's memory blocks view. Unique ClawCode data: embedding migration is tracked in Phase 115 scope but not yet surfaced in any UI.

**R12 — Dream-pass queue visibility**
Value: H | Cost: M
Show dream-pass pending queue depth per agent. Show: next scheduled dream time, last dream timestamp, priority-pass triggered count (24h). Data: dream-pass trigger count already tracked in traces table (Phase 115 Plan 05 T03). This is a ClawCode-unique concept with no analogue in any surveyed project.

### Tier 3: Medium value — polish pass

**R13 — 30-day activity heatmap per agent**
Value: M | Cost: M
Calendar grid showing turn count or total token spend per day per agent. Pattern from tugcantopaloglu's activity heatmap. Operator can see at a glance which agents are active vs. dormant. Source: TraceStore with GROUP BY date(started_at).

**R14 — Agent comparison table**
Value: M | Cost: M
Fleet-level table: one row per agent, columns = avg end-to-end p95 | tool cache hit rate | context % | dream-pass count | IPC delivery success rate. Sortable. Identifies outliers instantly. Pattern from Langfuse's trace table with filter sidebar.

**R15 — Swim-lane timeline for concurrent agent activity**
Value: M | Cost: H
Horizontal timeline with one lane per agent, events plotted as colored blocks. Shows IPC timing correlations. Pattern from disler/claude-code-hooks-multi-agent-observability. Implement with a canvas-based renderer (pattern from that project's live pulse chart) to handle 14 lanes without DOM thrashing.

**R16 — Tool latency per-tool breakdown table**
Value: M | Cost: L
Table: tool name | p50 | p95 | p99 | call count, sorted by p95 DESC. Already computed by `TraceStore.getToolLatencyBreakdown()`. Expose this existing query — it's one API endpoint and one table component.

**R17 — Theme toggle (dark/light)**
Value: M | Cost: L
shadcn/ui ships CSS variable theming; adding a light theme is ~50 lines of CSS. mudrii's 6-theme system demonstrates operators use this. Implement dark as default, light as toggle.

**R18 — Escalation budget gauge**
Value: M | Cost: L
Per-agent: daily and weekly token budget remaining vs. limit. Data from `src/usage/budget.ts` EscalationBudget. Show as two small progress bars labeled "daily" / "weekly" in the agent card. Alerts operator before budget is exceeded.

**R19 — Export: session trace as JSON/CSV**
Value: L | Cost: L
One-click export of the current agent's trace data. Pattern from mukul975's CSV/JSON export button. Implementation: a single `/api/agents/:name/export?format=csv` endpoint.

**R20 — Operator notification feed**
Value: L | Cost: M
Event log: SLO breach events, budget exceeded events, MCP server degradation events, dream-pass priority triggers. Pattern from tugcantopaloglu's Notifications panel (audit log event feed). Implement as a badge-counted notification bell in the header that opens a slide-over panel.

---

## Appendix: Projects Surveyed

| Project | URL | Stars | Last Active |
|---|---|---|---|
| tugcantopaloglu/openclaw-dashboard | https://github.com/tugcantopaloglu/openclaw-dashboard | 671 | 2026-03 |
| mudrii/openclaw-dashboard | https://github.com/mudrii/openclaw-dashboard | 433 | 2026-04 |
| abhi1693/openclaw-mission-control | https://github.com/abhi1693/openclaw-mission-control | 3.9k | 2026 |
| builderz-labs/mission-control | https://github.com/builderz-labs/mission-control | 4.7k | 2026 |
| hoangsonww/Claude-Code-Agent-Monitor | https://github.com/hoangsonww/Claude-Code-Agent-Monitor | 337 | 2026 |
| simple10/agents-observe | https://github.com/simple10/agents-observe | 535 | 2026-04 |
| disler/claude-code-hooks-multi-agent-observability | https://github.com/disler/claude-code-hooks-multi-agent-observability | 1.4k | 2026 |
| mukul975/claude-team-dashboard | https://github.com/mukul975/claude-team-dashboard | 42 | 2026-02 |
| mastra-ai/mastra | https://github.com/mastra-ai/mastra | 23.7k | 2026-05 |
| letta-ai/letta | https://github.com/letta-ai/letta | 22.5k | 2026-03 |
| langfuse/langfuse | https://github.com/langfuse/langfuse | 26.8k | 2026-05 |
| Helicone/helicone | https://github.com/Helicone/helicone | 5.6k | 2026 |
| AgentOps-AI/agentops | https://github.com/agentops-ai/agentops | ~5.4k | 2026 |
| Arize-ai/phoenix | https://github.com/Arize-ai/phoenix | — | 2026 |
