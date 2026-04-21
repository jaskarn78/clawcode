# Roadmap: ClawCode

## Milestones

- :white_check_mark: **v1.0 Core Multi-Agent System** - Phases 1-5 (shipped 2026-04-09)
- :white_check_mark: **v1.1 Advanced Intelligence** - Phases 6-20 (shipped 2026-04-09)
- :white_check_mark: **v1.2 Production Hardening & Platform Parity** - Phases 21-30 (shipped 2026-04-09)
- :white_check_mark: **v1.3 Agent Integrations** - Phases 31-32 (shipped 2026-04-09)
- :white_check_mark: **v1.4 Agent Runtime** - Phases 33-35 (shipped 2026-04-10)
- :white_check_mark: **v1.5 Smart Memory & Model Tiering** - Phases 36-41 (shipped 2026-04-10)
- :white_check_mark: **v1.6 Platform Operations & RAG** - Phases 42-49 (shipped 2026-04-12)
- :white_check_mark: **v1.7 Performance & Latency** - Phases 50-56 (shipped 2026-04-14)
- :white_check_mark: **v1.8 Proactive Agents + Handoffs** - Phases 57-63 (shipped 2026-04-17)
- :white_check_mark: **v1.9 Persistent Conversation Memory** - Phases 64-68 + 68.1 (shipped 2026-04-18)
- :white_check_mark: **v2.0 Open Endpoint + Eyes & Hands** - Phases 69-74 (shipped 2026-04-20)
- :white_check_mark: **v2.1 OpenClaw Agent Migration** - Phases 75-82 + 82.1 (shipped 2026-04-21)

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

Phases 33-35 delivered: global skill install, standalone agent runner, OpenClaw coexistence (token hard-fail, slash command namespace, dashboard non-fatal).

</details>

<details>
<summary>v1.5 Smart Memory & Model Tiering (Phases 36-41) - SHIPPED 2026-04-10</summary>

See `.planning/milestones/v1.5-ROADMAP.md` for full details.

Phases 36-41 delivered: knowledge graph (wikilinks + backlinks), on-demand memory loading (memory_lookup MCP + personality fingerprint), graph intelligence (graph-enriched search + auto-linker), model tiering (haiku default + fork-based escalation + opus advisor), cost optimization (per-agent tracking + importance scoring + escalation budgets), context assembly pipeline (per-source token budgets).

</details>

<details>
<summary>v1.6 Platform Operations & RAG (Phases 42-49) - SHIPPED 2026-04-12</summary>

See `.planning/milestones/v1.6-ROADMAP.md` for full details.

Phases 42-49 delivered: auto-start agents on daemon boot, systemd production integration, agent-to-agent Discord communication, memory auto-linking on save, scheduled consolidation, Discord slash commands for control, webhook auto-provisioning, RAG over documents.

</details>

<details>
<summary>v1.7 Performance & Latency (Phases 50-56) - SHIPPED 2026-04-14</summary>

See `.planning/milestones/v1.7-ROADMAP.md` for full details.

Phases 50-56 delivered: phase-level latency instrumentation, SLO targets + CI regression gate, prompt caching (Anthropic preset+append), context audit + token budget tuning, streaming + typing indicator, tool-call overhead reduction, warm-path optimizations.

</details>

<details>
<summary>v1.8 Proactive Agents + Handoffs (Phases 57-63) - SHIPPED 2026-04-17</summary>

See `.planning/milestones/v1.8-ROADMAP.md` for full details.

Phases 57-63 delivered: TurnDispatcher foundation, task store + state machine, cross-agent RPC handoffs, trigger engine, additional trigger sources, policy layer + dry-run, observability surfaces.

</details>

<details>
<summary>v1.9 Persistent Conversation Memory (Phases 64-68 + 68.1) - SHIPPED 2026-04-18</summary>

See `.planning/milestones/v1.9-ROADMAP.md` for full details.

Phases 64-68 delivered: ConversationStore schema + lifecycle, capture integration (fire-and-forget + SEC-02), session-boundary summarization, resume auto-injection, conversation search + deep retrieval. Phase 68.1 closed the isTrustedChannel cross-phase wiring gap.

</details>

<details>
<summary>v2.0 Open Endpoint + Eyes & Hands (Phases 69-74) - SHIPPED 2026-04-20</summary>

Phases 69-74 delivered: OpenAI-compatible endpoint, browser automation MCP, web search MCP, image generation MCP, OpenClaw endpoint latency (sub-2s TTFB), seamless OpenClaw backend (caller-provided agent config).

</details>

<details>
<summary>v2.1 OpenClaw Agent Migration (Phases 75-82 + 82.1) - SHIPPED 2026-04-21</summary>

See `.planning/milestones/v2.1-ROADMAP.md` for full details.

Phases 75-82 delivered: shared-workspace runtime support (memoryPath field), migration CLI with plan/apply/verify/rollback/cutover/complete subcommands, pre-flight guards (daemon + secret scanner + channel collision + read-only source), config mapping + atomic YAML writer (soulFile/identityFile pointers), workspace migration with hash-witness, memory translation with origin_id idempotency + MiniLM re-embedding, fork-to-Opus regression across 4 primary models, pilot selection + dual-bot cutover + migration report. Phase 82.1 closed the finmentum soulFile path-routing gap.

</details>

## Phase Details

### Phase 69: OpenAI-Compatible Endpoint
**Goal**: Every ClawCode agent is reachable from any OpenAI-compatible client with first-class streaming, tool-use, and per-key session continuity.
**Status**: Shipped 2026-04-19. See `.planning/phases/69-openai-compatible-endpoint/`.

### Phase 70: Browser Automation MCP
**Goal**: Every agent can drive a real headless Chromium with a persistent per-agent profile.
**Status**: Shipped 2026-04-19. See `.planning/phases/70-browser-automation-mcp/`.
**UI hint**: yes

### Phase 71: Web Search MCP
**Goal**: Every agent can search the live web and fetch clean article text with intra-turn deduplication.
**Status**: Shipped 2026-04-19. See `.planning/phases/71-web-search-mcp/`.

### Phase 72: Image Generation MCP
**Goal**: Every agent can generate and edit images via MiniMax/OpenAI/fal.ai with workspace persistence and cost tracking.
**Status**: Shipped 2026-04-19. See `.planning/phases/72-image-generation-mcp/`.
**UI hint**: yes

### Phase 73: OpenClaw Endpoint Latency
**Goal**: Sub-2s TTFB on warm agents for synchronous OpenClaw-agent consumption via persistent `streamInput()` subprocess + brief cache.
**Status**: Shipped 2026-04-19. See `.planning/phases/73-openclaw-endpoint-latency/`.

### Phase 74: Seamless OpenClaw Backend
**Goal**: Caller-provided agent config on `/v1/chat/completions` — OpenClaw agents use ClawCode as a rendering backend without pre-registration.
**Status**: Shipped 2026-04-20. See `.planning/phases/74-seamless-openclaw-backend-caller-provided-agent-config/`.

## Progress

**Status:** v2.1 OpenClaw Agent Migration shipped 2026-04-21 (8 phases + 1 gap-closure phase, 31/31 requirements satisfied). Ready for next milestone.

| Milestone | Phases | Status | Completed |
|-----------|--------|--------|-----------|
| v1.0 | 1-5 | Complete | 2026-04-09 |
| v1.1 | 6-20 | Complete | 2026-04-09 |
| v1.2 | 21-30 | Complete | 2026-04-09 |
| v1.3 | 31-32 | Complete | 2026-04-09 |
| v1.4 | 33-35 | Complete | 2026-04-10 |
| v1.5 | 36-41 | Complete | 2026-04-10 |
| v1.6 | 42-49 | Complete | 2026-04-12 |
| v1.7 | 50-56 | Complete | 2026-04-14 |
| v1.8 | 57-63 | Complete | 2026-04-17 |
| v1.9 | 64-68 + 68.1 | Complete | 2026-04-18 |
| v2.0 | 69-74 | Complete | 2026-04-20 |
| v2.1 | 75-82 + 82.1 | Complete | 2026-04-21 |

### v2.1 Phase Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 75. Shared-Workspace Runtime Support | 4/4 | Complete    | 2026-04-20 |
| 76. Migration CLI Read-Side + Dry-Run | 3/3 | Complete    | 2026-04-20 |
| 77. Pre-flight Guards + Safety Rails | 3/3 | Complete    | 2026-04-20 |
| 78. Config Mapping + YAML Writer | 3/3 | Complete    | 2026-04-20 |
| 79. Workspace Migration | 3/3 | Complete    | 2026-04-20 |
| 80. Memory Translation + Re-embedding | 2/3 | Complete    | 2026-04-20 |
| 81. Verify + Rollback + Resume + Fork | 3/3 | Complete    | 2026-04-21 |
| 82. Pilot + Cutover + Completion | 2/2 | Complete    | 2026-04-21 |
| 82.1. Finmentum SoulFile Path Fix (gap closure) | 1/1 | Complete    | 2026-04-21 |

---

*Milestone v2.1 OpenClaw Agent Migration: 8 phases (75-82) + 1 gap-closure phase (82.1). 31 requirements across SHARED/MIGR/CONF/WORK/MEM/FORK/OPS categories — all satisfied. Zero new npm deps.*
