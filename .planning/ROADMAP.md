# Roadmap: ClawCode

## Milestones

- :white_check_mark: **v1.0 Core Multi-Agent System** - Phases 1-5 (shipped 2026-04-09)
- :white_check_mark: **v1.1 Advanced Intelligence** - Phases 6-20 (shipped 2026-04-09)
- :white_check_mark: **v1.2 Production Hardening & Platform Parity** - Phases 21-30 (shipped 2026-04-09)
- :white_check_mark: **v1.3 Agent Integrations** - Phases 31-32 (shipped 2026-04-09)
- :white_check_mark: **v1.4 Agent Runtime** - Phases 33-35 (shipped 2026-04-10)
- :white_check_mark: **v1.5 Smart Memory & Model Tiering** - Phases 36-41 (shipped 2026-04-10)
- :white_check_mark: **v1.6 Platform Operations & RAG** - Phases 42-49 (shipped 2026-04-12)
- :hourglass_flowing_sand: **v1.7 Performance & Latency** - Phases 50-56 (active, started 2026-04-13)

## Phases

<details>
<summary>v1.0 Core Multi-Agent System (Phases 1-5) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

Phases 1-5 delivered: central config, agent lifecycle, Discord routing, per-agent memory, heartbeat framework.

</details>

<details>
<summary>v1.1 Advanced Intelligence (Phases 6-20) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for full details.

Phases 6-20 delivered: memory consolidation, relevance/dedup, tiered storage, task scheduling, skills registry, agent collaboration, Discord slash commands, attachments, thread bindings, webhook identities, session forking, context summaries, MCP bridge, reaction handling, memory search CLI.

</details>

<details>
<summary>v1.2 Production Hardening & Platform Parity (Phases 21-30) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.2-ROADMAP.md` for full details.

Phases 21-30 delivered: tech debt cleanup, config hot-reload, context health zones, episode memory, delivery queue, subagent Discord threads, security & execution approval, agent bootstrap, web dashboard.

</details>

<details>
<summary>v1.3 Agent Integrations (Phases 31-32) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.3-ROADMAP.md` for full details.

Phases 31-32 delivered: subagent thread skill (Discord-visible subagent work via skill interface), MCP client consumption (per-agent external MCP server config with health checks).

</details>

<details>
<summary>v1.4 Agent Runtime (Phases 33-35) - SHIPPED 2026-04-10</summary>

See `.planning/milestones/v1.4-ROADMAP.md` for full details.

Phases 33-35 delivered: global skill install (workspace skills auto-installed to ~/.claude/skills/), standalone agent runner (`clawcode run <agent>` command), OpenClaw coexistence fixes (token hard-fail, slash command namespace, dashboard non-fatal, env var interpolation).

</details>

<details>
<summary>v1.5 Smart Memory & Model Tiering (Phases 36-41) - SHIPPED 2026-04-10</summary>

See `.planning/milestones/v1.5-ROADMAP.md` for full details.

Phases 36-41 delivered: knowledge graph (wikilinks, backlinks, graph traversal), on-demand memory loading (personality fingerprint, memory_lookup MCP tool), graph intelligence (graph-enriched search, auto-linker heartbeat), model tiering (haiku default, fork-based escalation, opus advisor, /model command), cost optimization (per-agent token tracking, importance scoring, escalation budgets), context assembly pipeline (per-source token budgets).

</details>

<details>
<summary>v1.6 Platform Operations & RAG (Phases 42-49) - SHIPPED 2026-04-12</summary>

See `.planning/milestones/v1.6-ROADMAP.md` for full details.

Phases 42-49 delivered: auto-start agents on daemon boot, systemd production integration, agent-to-agent Discord communication (MCP tool + webhook embeds + bridge routing), memory auto-linking on save, scheduled memory consolidation via TaskScheduler, Discord slash commands for fleet control, webhook auto-provisioning per agent, RAG over documents (text/markdown/PDF ingestion, chunking, sqlite-vec KNN search, 4 MCP tools).

</details>

### v1.7 Performance & Latency (Phases 50-56) - ACTIVE

**Goal:** Reduce end-to-end latency from Discord message arrival to agent reply across the ClawCode fleet.

- [x] **Phase 50: Latency Instrumentation** - Phase-level timing trace for every Discord turn + per-agent latency report (completed 2026-04-13)
- [x] **Phase 51: SLOs & Regression Gate** - Documented SLO targets surfaced on dashboard + CI benchmark fails on p95 regression (completed 2026-04-13)
- [x] **Phase 52: Prompt Caching** - Apply Anthropic cache_control to stable prefixes, surface hit-rate, verify invalidation (completed 2026-04-14)
- [ ] **Phase 53: Context & Token Budget Tuning** - Audit payload size by section, tighten budgets, lazy-load skills, shrink resume summary
- [ ] **Phase 54: Streaming & Typing Indicator** - First-token metric, tighter Discord chunk cadence, typing indicator within 500ms
- [ ] **Phase 55: Tool-Call Overhead** - Parallelize independent calls, intra-turn idempotent cache, per-tool timing telemetry
- [ ] **Phase 56: Warm-Path Optimizations** - SQLite/sqlite-vec warmup, resident embeddings, session keep-alive, readiness health check

## Phase Details

### Phase 50: Latency Instrumentation
**Goal**: Operators can see exactly where time is spent in every Discord message → reply cycle
**Depends on**: Nothing (foundation for v1.7)
**Requirements**: PERF-01, PERF-02
**Success Criteria** (what must be TRUE):
  1. Every Discord turn produces a structured trace with phase-level timings (receive, context assemble, first token, each tool call, final send) in a queryable trace store
  2. `clawcode latency <agent>` CLI prints p50 / p95 / p99 for end-to-end, first-token, context-assemble, and tool-call segments
  3. The web dashboard shows a per-agent latency panel with the same percentile breakdown updated from the trace store
  4. Traces persist across daemon restarts and are retained for at least a configurable window (default 7 days)
**Plans:** 5/5 plans complete
Plans:
- [x] 50-00-PLAN.md — Wave 0: test scaffolding (red state) for trace-collector, trace-store, trace-store-persistence, percentiles, latency CLI, retention heartbeat, dashboard server, bridge, session-adapter, context-assembler (append), scheduler (append)
- [x] 50-01-PLAN.md — Wave 1: src/performance/ subsystem (TraceStore + TraceCollector + percentile SQL + types) + perf.traceRetentionDays config
- [x] 50-02-PLAN.md — Wave 2: SDK-side instrumentation — per-agent TraceStore lifecycle + SessionManager accessors + SdkSessionAdapter spans (first_token, tool_call, end_to_end) + ContextAssembler assembleContextTraced
- [x] 50-02b-PLAN.md — Wave 2: Caller-side wiring — DiscordBridge receive span + Turn lifecycle ownership + Scheduler turnId prefix + auto-discovered retention heartbeat check (CASCADE-only)
- [x] 50-03-PLAN.md — Wave 3: `clawcode latency` CLI + IPC route + dashboard REST endpoint + Latency panel

### Phase 51: SLOs & Regression Gate
**Goal**: Latency wins are defended automatically — regressions break the build
**Depends on**: Phase 50
**Requirements**: PERF-03, PERF-04
**Success Criteria** (what must be TRUE):
  1. Per-surface SLO targets (e.g., first-token p50 ≤ 2s, end-to-end p95 ≤ 6s) are documented in the repo and visible on the dashboard with red/green indicators against live percentiles
  2. A CI benchmark command runs a fixed prompt set against a local daemon and produces a reproducible latency report
  3. The CI job fails when any tracked p95 regresses beyond a configurable threshold vs. a stored baseline
  4. Updating the baseline is an explicit, auditable operator action (not automatic on every run)
**Plans:** 3/3 plans complete
Plans:
- [x] 51-01-PLAN.md — SLO source of truth + bench report/baseline Zod schemas + thresholds loader
- [x] 51-02-PLAN.md — clawcode bench CLI + isolated daemon harness + bench-run-prompt IPC method
- [x] 51-03-PLAN.md — Dashboard SLO indicators + starter prompts.yaml / thresholds.yaml / README + .github/workflows/bench.yml (includes human-verify checkpoint)

### Phase 52: Prompt Caching
**Goal**: Stable prefixes hit Anthropic prompt cache, cutting input tokens and first-token latency
**Depends on**: Phase 50
**Requirements**: CACHE-01, CACHE-02, CACHE-03, CACHE-04
**Success Criteria** (what must be TRUE):
  1. The system prompt prefix (identity, soul, skills header) carries Anthropic `cache_control` markers and reliably scores as cached on repeat turns
  2. Memory hot-tier entries and skills/tool definitions sit inside the cached prefix when stable across turns; mutable sections (recent history, per-turn summary) live after the cache boundary
  3. The dashboard and daily summary report per-agent cache hit rate (cached input tokens / total input tokens) with trend over time
  4. Editing identity, soul, hot-tier memory, or the skill set demonstrably evicts the stale prefix on the next turn and the telemetry reflects the drop and recovery
  5. Measured first-token latency improves on cache-hit turns versus cache-miss turns by a margin visible in the Phase 50 telemetry
**Plans:** 3/3 plans complete
Plans:
- [x] 52-01-PLAN.md — Wave 1: traces schema (ALTER TABLE 5 cols) + Turn.recordCacheUsage + TraceStore.getCacheTelemetry + CACHE_HIT_RATE_SLO + session-adapter usage capture
- [x] 52-02-PLAN.md — Wave 2: two-block context assembly (stablePrefix / mutableSuffix) + SDK preset+append wiring + hot-tier stable_token + per-session prefixHash + cacheEvictionExpected
- [x] 52-03-PLAN.md — Wave 3: clawcode cache CLI + cache IPC method + dashboard Prompt Cache panel + cache_effect_ms metric + human-verify checkpoint

### Phase 53: Context & Token Budget Tuning
**Goal**: Per-turn payload shrinks without measurable response-quality loss
**Depends on**: Phase 50
**Requirements**: CTX-01, CTX-02, CTX-03, CTX-04
**Success Criteria** (what must be TRUE):
  1. A reproducible context-audit script outputs average and p95 payload sizes per section (identity, memory, skills, history, summary) per agent
  2. Default memory assembly budgets are tightened based on the audit and the change is validated against a regression prompt set with no quality drop
  3. Skills and MCP tool definitions load lazily or compress when not referenced in recent turns, configurable per agent, and the savings show up in the Phase 50 payload metrics
  4. Session-resume summary carries a strict token-cost upper bound and resume payloads stay under it across the fleet
**Plans**: TBD

### Phase 54: Streaming & Typing Indicator
**Goal**: Users see activity and tokens sooner on every Discord turn
**Depends on**: Phase 50
**Requirements**: STREAM-01, STREAM-02, STREAM-03
**Success Criteria** (what must be TRUE):
  1. First-token latency is a first-class, separately reported metric per agent in CLI, dashboard, and trace store
  2. Discord streaming delivery uses a tighter chunk cadence (smaller batches, lower debounce) and measured first-token-visible-in-Discord latency drops versus baseline without triggering Discord rate-limit errors
  3. The typing indicator fires within 500ms of Discord message arrival, before any LLM work starts, for every bound agent
  4. Streaming cadence is configurable per agent with safe defaults
**Plans**: TBD
**UI hint**: yes

### Phase 55: Tool-Call Overhead
**Goal**: A turn spends less time waiting on tools
**Depends on**: Phase 50
**Requirements**: TOOL-01, TOOL-02, TOOL-03
**Success Criteria** (what must be TRUE):
  1. Independent tool calls within a single turn execute in parallel — current serialization points are identified and removed, verified by trace comparison before/after
  2. Idempotent tool results (e.g., repeated `memory_lookup` with identical args, repeated `search_documents`) are cached within a turn and second-call latency approaches zero
  3. Per-tool round-trip timing is logged and visible on the dashboard so slow tools are directly attributable
  4. Cache is scoped strictly to a single turn — no stale data leaks across turns
**Plans**: TBD

### Phase 56: Warm-Path Optimizations
**Goal**: The hot path stays hot — no first-query penalties, no cold re-init between messages
**Depends on**: Phase 50
**Requirements**: WARM-01, WARM-02, WARM-03, WARM-04
**Success Criteria** (what must be TRUE):
  1. SQLite prepared statements and sqlite-vec handles are warmed at agent start — the first memory query after startup shows no statistically significant latency penalty vs. subsequent queries
  2. The embedding model stays resident across turns — `memory_lookup` after an idle period has no cold-start penalty in trace data
  3. Consecutive Discord messages in the same thread reuse a warm session (no full re-init), measurable as lower end-to-end latency on the second and later messages in a burst
  4. Startup health check verifies warm-path readiness (SQLite, embeddings, session ready) before the agent is marked "ready" in `/clawcode-fleet` — agents never appear ready while still cold
**Plans**: TBD

## Progress

**Status:** v1.7 Performance & Latency active — Phases 50-56.

| Milestone | Phases | Status | Completed |
|-----------|--------|--------|-----------|
| v1.0 | 1-5 | Complete | 2026-04-09 |
| v1.1 | 6-20 | Complete | 2026-04-09 |
| v1.2 | 21-30 | Complete | 2026-04-09 |
| v1.3 | 31-32 | Complete | 2026-04-09 |
| v1.4 | 33-35 | Complete | 2026-04-10 |
| v1.5 | 36-41 | Complete | 2026-04-10 |
| v1.6 | 42-49 | Complete | 2026-04-12 |
| v1.7 | 50-56 | In progress | — |

### v1.7 Phase Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 50. Latency Instrumentation | 5/5 | Complete    | 2026-04-13 |
| 51. SLOs & Regression Gate | 3/3 | Complete    | 2026-04-13 |
| 52. Prompt Caching | 3/3 | Complete    | 2026-04-14 |
| 53. Context & Token Budget Tuning | 0/0 | Not started | — |
| 54. Streaming & Typing Indicator | 0/0 | Not started | — |
| 55. Tool-Call Overhead | 0/0 | Not started | — |
| 56. Warm-Path Optimizations | 0/0 | Not started | — |
