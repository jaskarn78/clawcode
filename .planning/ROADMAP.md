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
- :white_check_mark: **v2.2 OpenClaw Parity & Polish** - Phases 83-89 (shipped 2026-04-23)
- :hammer: **v2.3 Marketplace & Memory Activation** - Phase 90+ (opened 2026-04-24)

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

<details>
<summary>v2.2 OpenClaw Parity & Polish (Phases 83-89) - SHIPPED 2026-04-23</summary>

See `.planning/milestones/v2.2-ROADMAP.md` for full details.

Phases 83-89 delivered: Extended-thinking effort mapping (P0 silent no-op fix + SDK canary), skills library migration CLI (secret-scan gated), MCP tool awareness & reliability (phantom-error class eliminated), dual Discord model picker (direct IPC dispatch + allowedModels allowlist), native CC slash commands (SDK-reported commands as clawcode-* Discord slashes), skills marketplace (/clawcode-skills-browse install pipeline), and agent restart greeting (restartAgent-only Discord greeting with Haiku summarization + webhook identity + cool-down).

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

**Status:** v2.3 Marketplace & Memory Activation opened 2026-04-24 with Phase 90 (ClawHub marketplace + fin-acquisition memory prep). Phase 90 decomposed into 7 plans (2026-04-24) spanning 4 execution waves; HUB/MEM/WIRE requirement categories all assigned. Additional v2.3 phases TBD.

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
| v2.2 | 83-89 | Complete | 2026-04-23 |
| v2.3 | 90+ | In progress | — |

### Phase 90: ClawHub Marketplace + fin-acquisition Memory Prep
**Goal**: Extend `/clawcode-skills-browse` to discover and install from clawhub.ai (skills + plugins/MCPs) with install-time configuration, and prep the fin-acquisition ClawCode agent for a future manual cutover from OpenClaw by wiring the MEMORY.md auto-load, workspace-file scanner, dated-session flush, and MCP server list — without flipping the channel yet.
**Depends on**: Phase 88 (Skills Marketplace — reuses `loadMarketplaceCatalog`, `installSingleSkill`, `updateAgentSkills`), Phase 84 (skills migration pipeline — secret-scan, frontmatter normalize, idempotency, scope-tag check), Phase 86 (atomic YAML writer pattern `updateAgentModel`), Phase 69 (OpenAI endpoint — target of eventual cutover), Phase 85 (MCP readiness handshake), Phase 89 (restart greeting — `memory_chunks` retrieval feeds its greeting summary). v2.1 OpenClaw Agent Migration produced the ClawCode fin-acquisition agent + migrated skills + MEMORY.md workspace artifacts — Phase 90 activates them.
**Requirements**: HUB-01, HUB-02, HUB-03, HUB-04, HUB-05, HUB-06, HUB-07, HUB-08, MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06, WIRE-01, WIRE-02, WIRE-03, WIRE-04, WIRE-05, WIRE-06, WIRE-07 (synthesized from the Apr 23-24 fin-acquisition Discord conversation-history gap analysis; 1:1 mapping lives in 90-CONTEXT.md)
**Success Criteria** (what must be TRUE):
  1. `/clawcode-skills-browse` with no argument shows ClawHub results alongside local skills, paginated, with category/rating/download-count badges
  2. Selecting a ClawHub skill runs the full Phase 84 pipeline and Phase 88 atomic YAML persist — secret-scan refusals block with a specific ephemeral Discord message (never silently skipped, per Phase 88 MKT-05 precedent)
  3. `/clawcode-plugins-browse` (new sibling command) lists ClawHub plugins; selecting one writes a new `mcpServers:` entry via a new `updateAgentMcpServers` atomic YAML writer (mirrors Phase 86 `updateAgentModel` + Phase 88 `updateAgentSkills`)
  4. Install-time config modal surfaces required env vars and credentials; rewrites values to `op://` references where 1Password has a matching item; writes literals only with explicit operator confirmation
  5. Invalid clawhub packages (missing frontmatter, deprecated category, scope mismatch with bound agent, hard-coded secret) are rejected with a specific ephemeral Discord message — never silently skipped
  6. On fin-acquisition ClawCode agent session start, `MEMORY.md` is injected into the system prompt — next turn answers "what's our firm legal name?" with "Finmentum LLC" without being re-told (closes the Apr 20 "remember the last thing we worked on?" crisis class)
  7. Within 30s of `memory/2026-04-24-<anything>.md` being written to workspace, `memory_chunks` table has the new chunks indexed and retrievable by semantic query
  8. A pre-turn retrieval for "Zaid's investment proportion" returns the relevant chunk from the seeded dated memory files (via WIRE-06 backfill)
  9. Mid-session flush produces `memory/YYYY-MM-DD-HHMM.md` files every 15 minutes (default) during active use; on SIGKILL, the most recent flush survives intact on disk (closes the dashboard-restart-drop crisis)
  10. "Remember this: Zaid wants 40% in SGOV" in chat triggers a one-shot `memory/YYYY-MM-DD-<slug>.md` write and is retrievable on the next turn
  11. Opus subagent return captured as `memory/YYYY-MM-DD-subagent-<hash>.md`; parent can answer "do you recall the opus agent you spawned?" across session boundaries (closes Apr 23 gap)
  12. After Phase 90 ships, `cat clawcode.yaml` shows fin-acquisition with full `mcpServers` list (finmentum-db, finmentum-content, google-workspace, browserless, fal-ai, brave-search), heartbeat config (50m + haiku + HEARTBEAT.md prompt), effort=auto, allowedModels=[sonnet, opus, haiku] — but channel binding still routes to OpenClaw (no cutover yet)
  13. `clawcode mcp-status fin-acquisition` shows all 6 MCP servers with `ready` status (verifies WIRE-01 + Phase 85 readiness gate end-to-end)
  14. `.planning/migrations/fin-acquisition-cutover.md` runbook exists with pre-cutover checklist, rsync commands (513MB uploads), rollback procedure — operator-executable, not auto-run
**Plans**: 7 plans in 4 execution waves (planned 2026-04-24)
- [x] 90-01-PLAN.md — MEMORY.md auto-inject into v1.7 stable prefix (MEM-01) [Wave 1]
- [ ] 90-02-PLAN.md — chokidar file-scanner + memory_chunks tables + hybrid RRF retrieval (MEM-02 + MEM-03) [Wave 2 — depends on 90-01]
- [ ] 90-03-PLAN.md — periodic 15-min flush + "remember this" cue detection + subagent-output capture (MEM-04 + MEM-05 + MEM-06) [Wave 3 — depends on 90-01 + 90-02]
- [x] 90-04-PLAN.md — ClawHub HTTP client + TTL cache + catalog union + skills install pipeline (HUB-01 + HUB-03 + HUB-06 + HUB-08) [Wave 1]
- [x] 90-05-PLAN.md — updateAgentMcpServers atomic YAML writer + ClawHub plugins install + /clawcode-plugins-browse slash command (HUB-02 + HUB-04) [Wave 2 — depends on 90-04]
- [ ] 90-06-PLAN.md — Discord install-time config modal + 1Password op:// fuzzy rewrite + GitHub OAuth device-code flow + /clawcode-clawhub-auth (HUB-05 + HUB-07) [Wave 3 — depends on 90-04 + 90-05]
- [ ] 90-07-PLAN.md — fin-acquisition agent wiring (6 MCPs + heartbeat + effort + allowedModels) + webhook identity probe + `clawcode memory backfill` CLI + cutover runbook (WIRE-01..07) [Wave 4 — depends on all prior]
**UI hint**: yes (StringSelectMenuBuilder + Modal + EmbedBuilder — UI-01 compliance)

---

*Milestone v2.1 OpenClaw Agent Migration: 8 phases (75-82) + 1 gap-closure phase (82.1). 31 requirements across SHARED/MIGR/CONF/WORK/MEM/FORK/OPS categories — all satisfied. Zero new npm deps.*

*Milestone v2.2 OpenClaw Parity & Polish shipped 2026-04-23: 7 phases (83-89), 55+ requirements across UI/SKILL/EFFORT/MODEL/CMD/TOOL/MKT categories plus Phase 89 GREET-01..10 (synthesized from the 16 D-01..D-16 decisions in 89-CONTEXT.md). Zero new npm deps. See `.planning/milestones/v2.2-ROADMAP.md` for full details.*
