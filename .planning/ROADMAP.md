# Roadmap: ClawCode

## Milestones

- :white_check_mark: **v1.0 Core Multi-Agent System** - Phases 1-5 (shipped 2026-04-09)
- :white_check_mark: **v1.1 Advanced Intelligence** - Phases 6-20 (shipped 2026-04-09)
- :white_check_mark: **v1.2 Production Hardening & Platform Parity** - Phases 21-30 (shipped 2026-04-09)
- :white_check_mark: **v1.3 Agent Integrations** - Phases 31-32 (shipped 2026-04-09)
- :white_check_mark: **v1.4 Agent Runtime** - Phases 33-35 (shipped 2026-04-10)
- :construction: **v1.5 Smart Memory & Model Tiering** - Phases 36-41 (in progress)

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

### :construction: v1.5 Smart Memory & Model Tiering (In Progress)

**Milestone Goal:** Reduce context bloat by loading memory on-demand via a knowledge graph, and default agents to haiku with intelligent escalation to sonnet/opus.

- [x] **Phase 36: Knowledge Graph Foundation** - Wikilink syntax and backlink queries over agent memories (completed 2026-04-10)
- [x] **Phase 37: On-Demand Memory Loading** - Agents retrieve memories via tool calls instead of eager context stuffing (completed 2026-04-10)
- [x] **Phase 38: Graph Intelligence** - Graph-augmented search and automatic link discovery (completed 2026-04-10)
- [x] **Phase 39: Model Tiering & Escalation** - Haiku default with smart escalation to sonnet/opus (completed 2026-04-10)
- [x] **Phase 40: Cost Optimization & Budgets** - Token tracking, importance scoring, and escalation budget enforcement (completed 2026-04-10)
- [x] **Phase 41: Context Assembly Pipeline** - Modular context composition with per-source token budgets (completed 2026-04-10)

## Phase Details

### Phase 36: Knowledge Graph Foundation
**Goal**: Agent memories are structurally linked via wikilinks and queryable as a graph
**Depends on**: Nothing (first phase of v1.5)
**Requirements**: GRAPH-01, GRAPH-02
**Success Criteria** (what must be TRUE):
  1. Agent can write a memory containing `[[another-memory]]` and the system creates a directed link between them
  2. Agent can query "what links to memory X?" and receive a list of all memories containing wikilinks to X
  3. Consolidation and archival operations preserve graph edges (no dangling references after memory lifecycle events)
  4. Graph traversal terminates correctly on circular references (visited-set tracking prevents infinite loops)
**Plans:** 2/2 plans complete
Plans:
- [x] 36-01-PLAN.md — Wikilink parsing, graph schema, link-aware insert/merge (GRAPH-01)
- [ ] 36-02-PLAN.md — Backlink/forward-link queries, re-warm edge restoration (GRAPH-02)

### Phase 37: On-Demand Memory Loading
**Goal**: Agents pull relevant memories when needed instead of having everything stuffed into context at session start
**Depends on**: Phase 36
**Requirements**: LOAD-01, LOAD-02
**Success Criteria** (what must be TRUE):
  1. Agent can invoke a `memory_lookup` tool to search and retrieve memories mid-conversation
  2. Agent identity loads as a compact fingerprint (~200-300 tokens) instead of the full SOUL.md in the system prompt
  3. Full SOUL.md content is available as a retrievable memory when the agent needs deeper identity context
  4. System prompt size with on-demand loading is measurably smaller than the v1.4 eager-injection approach
**Plans:** 2/2 plans complete
Plans:
- [x] 37-01-PLAN.md — Fingerprint extraction + memory_lookup MCP tool (LOAD-01, LOAD-02)
- [ ] 37-02-PLAN.md — Session config refactor + SOUL.md storage (LOAD-01, LOAD-02)

### Phase 38: Graph Intelligence
**Goal**: Memory search leverages graph structure for richer retrieval, and the graph grows automatically
**Depends on**: Phase 36, Phase 37
**Requirements**: GRAPH-03, GRAPH-04
**Success Criteria** (what must be TRUE):
  1. Memory search results include 1-hop graph neighbors alongside direct KNN hits, providing richer context
  2. A background job periodically scans for semantically similar unlinked memories and suggests (or creates) links
  3. Graph expansion respects token budgets (neighbor inclusion is relevance-gated, not unbounded fan-out)
**Plans:** 2/2 plans complete
Plans:
- [ ] 38-01-PLAN.md — Graph-enriched search: GraphSearch class + IPC wiring (GRAPH-03)
- [ ] 38-02-PLAN.md — Auto-linker heartbeat check for automatic link discovery (GRAPH-04)

### Phase 39: Model Tiering & Escalation
**Goal**: Agents run on haiku by default and escalate to more capable models when tasks demand it
**Depends on**: Phase 37
**Requirements**: TIER-01, TIER-02, TIER-03, TIER-05
**Success Criteria** (what must be TRUE):
  1. New agent sessions start with haiku as the default model instead of sonnet
  2. Agent automatically escalates to sonnet or opus when task complexity exceeds haiku's capability (error-rate, keyword, or complexity triggers)
  3. Agent can invoke opus as an advisor tool for hard decisions without abandoning its current session
  4. Operator can set or change an agent's default model via a Discord slash command
  5. Escalated sessions automatically de-escalate after task completion (no permanent model drift)
**Plans:** 2/2 plans complete
Plans:
- [x] 39-01-PLAN.md — Haiku default + EscalationMonitor for fork-based escalation (TIER-01, TIER-02)
- [ ] 39-02-PLAN.md — ask_advisor MCP tool + /model slash command (TIER-03, TIER-05)

### Phase 40: Cost Optimization & Budgets
**Goal**: Token spend is tracked, scored, and budget-enforced across the agent fleet
**Depends on**: Phase 39
**Requirements**: COST-01, COST-02, TIER-04
**Success Criteria** (what must be TRUE):
  1. Per-agent, per-model token usage is recorded in SQLite and viewable via CLI (`clawcode costs`) and dashboard
  2. New memories receive automatic importance scores based on content heuristics (length, entity density, recency)
  3. Per-agent escalation budgets enforce daily/weekly token limits for upgraded models
  4. Discord alerts fire when an agent approaches or exceeds its escalation budget
**Plans:** 2/2 plans complete
Plans:
- [x] 40-01-PLAN.md — Cost tracking, pricing map, importance scoring, CLI + dashboard (COST-01, COST-02)
- [ ] 40-02-PLAN.md — Escalation budgets with Discord alerts (TIER-04)




### Phase 41: Context Assembly Pipeline
**Goal**: Identity, memories, graph results, and tools are composed into context with explicit per-source token budgets
**Depends on**: Phase 38, Phase 39, Phase 40
**Requirements**: LOAD-03
**Success Criteria** (what must be TRUE):
  1. Context assembly composes identity, hot memories, graph-expanded results, and tool definitions with configurable per-source token budgets
  2. Total assembled context stays within a defined ceiling (no source can exceed its budget and starve others)
  3. Net system prompt size for a v1.5 agent is equal to or smaller than an equivalent v1.4 agent
**Plans:** 2/2 plans complete
Plans:
- [x] 41-01-PLAN.md — Context assembler module with TDD (LOAD-03)
- [ ] 41-02-PLAN.md — Schema extension + buildSessionConfig refactor (LOAD-03)




## Progress

**Execution Order:** Phases execute in numeric order: 36 -> 37 -> 38 -> 39 -> 40 -> 41

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-5 | v1.0 | - | Complete | 2026-04-09 |
| 6-20 | v1.1 | - | Complete | 2026-04-09 |
| 21-30 | v1.2 | - | Complete | 2026-04-09 |
| 31. Subagent Thread Skill | v1.3 | 2/2 | Complete | 2026-04-09 |
| 32. MCP Client Consumption | v1.3 | 2/2 | Complete | 2026-04-09 |
| 33. Global Skill Install | v1.4 | 1/1 | Complete | 2026-04-10 |
| 34. Standalone Agent Runner | v1.4 | 2/2 | Complete | 2026-04-10 |
| 35. Resolve OpenClaw Coexistence | v1.4 | 2/2 | Complete | 2026-04-10 |
| 36. Knowledge Graph Foundation | v1.5 | 1/2 | Complete    | 2026-04-10 |
| 37. On-Demand Memory Loading | v1.5 | 1/2 | Complete    | 2026-04-10 |
| 38. Graph Intelligence | v1.5 | 0/2 | Complete    | 2026-04-10 |
| 39. Model Tiering & Escalation | v1.5 | 1/2 | Complete    | 2026-04-10 |
| 40. Cost Optimization & Budgets | v1.5 | 1/2 | Complete    | 2026-04-10 |
| 41. Context Assembly Pipeline | v1.5 | 1/2 | Complete    | 2026-04-10 |

### Phase 42: Auto-start agents on daemon boot

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 41
**Plans:** 1/1 plans complete

Plans:
- [x] TBD (run /gsd:plan-phase 42 to break down) (completed 2026-04-11)

### Phase 43: Systemd production integration

**Goal:** Fix the systemd unit file so the clawcode service starts reliably in production with correct ExecStart, PATH, and env var loading
**Requirements**: SYSINT-01, SYSINT-02, SYSINT-03
**Depends on:** Phase 42
**Plans:** 1/1 plans complete

Plans:
- [x] 43-01-PLAN.md — Fix systemd unit template in install.sh (ExecStart, PATH, EnvironmentFile)

### Phase 44: Agent-to-agent Discord communication

**Goal:** Agents can send visible, auditable messages to each other through Discord via an MCP tool that posts webhook embeds to target agent channels
**Requirements**: A2A-01, A2A-02, A2A-03, A2A-04, A2A-05, A2A-06
**Depends on:** Phase 43
**Plans:** 2/2 plans complete

Plans:
- [x] 44-01-PLAN.md — MCP tool, IPC handler, webhook embed delivery, inbox fallback (A2A-01, A2A-02, A2A-05, A2A-06)
- [x] 44-02-PLAN.md — Bridge bot-filter modification for agent webhook routing + context prefix (A2A-03, A2A-04)

### Phase 45: Memory auto-linking on save

**Goal:** New/updated memories get graph edges to similar memories immediately on save instead of waiting for the 6-hour heartbeat cycle
**Requirements**: AUTOLINK-01
**Depends on:** Phase 44
**Plans:** 1/1 plans complete

Plans:
- [x] 45-01-PLAN.md — autoLinkMemory function + store.ts insert hook (AUTOLINK-01)

### Phase 46: Scheduled memory consolidation

**Goal:** Memory consolidation runs on a configurable cron schedule per agent via TaskScheduler instead of the fixed 24h heartbeat check
**Requirements**: CONSOL-01
**Depends on:** Phase 45
**Plans:** 1/1 plans complete

Plans:
- [x] 46-01-PLAN.md — Schema + scheduler handler support, daemon wiring, heartbeat deprecation (CONSOL-01)

### Phase 47: Discord slash commands for control

**Goal:** Operators can manage the agent fleet via Discord slash commands (start, stop, restart, fleet status) that bypass agent sessions and go directly to the daemon via IPC
**Requirements**: CTRL-01, CTRL-02, CTRL-03, CTRL-04
**Depends on:** Phase 46
**Plans:** 1/1 plans complete

Plans:
- [x] 47-01-PLAN.md — Control slash commands (type ext, IPC routing, fleet embed)



### Phase 48: Webhook identity per agent

**Goal:** Auto-provision Discord webhooks for each agent's bound channel on daemon startup, eliminating manual webhookUrl configuration
**Requirements**: WEBHOOK-AUTO-01
**Depends on:** Phase 47
**Plans:** 1/1 plans complete

Plans:
- [x] 48-01-PLAN.md — Webhook provisioner + daemon wiring (WEBHOOK-AUTO-01)



### Phase 49: RAG over documents

**Goal:** Agents can ingest documents (text, markdown, PDF), chunk and embed them, then search over chunks using semantic similarity via MCP tools
**Requirements**: RAG-CHUNK, RAG-STORE, RAG-PDF, RAG-INGEST, RAG-SEARCH, RAG-DELETE
**Depends on:** Phase 48
**Plans:** 1/2 plans executed

Plans:
- [x] 49-01-PLAN.md — Document chunker, types, and DocumentStore with schema/ingest/search/delete (RAG-CHUNK, RAG-STORE, RAG-PDF)
- [ ] 49-02-PLAN.md — MCP tools and IPC handlers for ingest, search, delete, list (RAG-INGEST, RAG-SEARCH, RAG-DELETE)
