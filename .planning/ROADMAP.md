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
- :white_check_mark: **v2.3 Marketplace & Memory Activation** - Phase 90 (shipped 2026-04-24)
- :white_check_mark: **v2.4 OpenClaw ↔ ClawCode Continuous Sync** - Phase 91 (shipped 2026-04-24)
- :white_check_mark: **v2.5 Cutover Parity Verification** - Phases 92-93 (shipped 2026-04-25)
- :hammer: **v2.6 Tool Reliability & Memory Dreaming** - Phases 94-95 (opened 2026-04-25)

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

<details>
<summary>v2.3 Marketplace & Memory Activation (Phase 90) - SHIPPED 2026-04-24</summary>

See `.planning/milestones/v2.3-ROADMAP.md` for full details.

Phase 90 delivered: ClawHub Marketplace extension (/clawcode-skills-browse unions clawhub.ai skills + /clawcode-plugins-browse for plugins→mcpServers + install-time ModalBuilder config + 1Password op:// fuzzy rewrite + GitHub device-code OAuth); workspace-memory activation (MEMORY.md auto-inject at session-start + chokidar file-scanner with hybrid RRF retrieval + periodic mid-session flush + "remember this" cue detection + subagent-output capture); fin-acquisition ClawCode agent pre-cutover wiring (6 MCPs + verbatim-OpenClaw heartbeat + effort/allowedModels/greet + memory backfill CLI + daemon webhook identity probe + 9-section operator runbook). Channel 1481670479017414767 INTENTIONALLY unchanged — cutover deferred to operator.

</details>

<details>
<summary>v2.4 OpenClaw ↔ ClawCode Continuous Sync (Phase 91) - SHIPPED 2026-04-24</summary>

See `.planning/milestones/v2.4-ROADMAP.md` for full details.

Phase 91 delivered: continuous uni-directional sync from OpenClaw fin-acquisition workspace to ClawCode mirror (pull model, 5-min systemd timer + hourly conversation-turn translator via rsync over SSH); sync-state.json with direction-aware `authoritative` flag (never bidirectional); sha256 conflict detection with source-wins + skip-file semantics + bot-direct admin-clawdy alerts; `/clawcode-sync-status` Discord slash with EmbedBuilder (8th inline-short-circuit application); `clawcode sync *` CLI (status/run-once/resolve/set-authoritative/start-reverse/stop/finalize/translate-sessions) with drain-then-flip cutover semantics + 7-day rollback window; exclude-filter regression test pinning `*.sqlite`/`sessions/*.jsonl`/`.git`/editor-snapshots never land on destination; cutover runbook extended with 5 sync-specific sections. Zero new npm deps.

</details>

<details>
<summary>v2.5 Cutover Parity Verification (Phases 92-93) - SHIPPED 2026-04-25</summary>

See `.planning/milestones/v2.5-ROADMAP.md` for full details.

Phase 92 delivered: complete cutover-parity verifier infrastructure (6 plans, 134 tests, zero new npm deps) — Discord history ingestor + Mission Control API ingestor + LLM source profiler emitting AGENT-PROFILE.json with topIntents[]; target-capability probe (clawcode.yaml + workspace inventory + Phase 85 list-mcp-status IPC); pure diff engine with 9-kind typed CutoverGap discriminated union; additive auto-applier (4 kinds) reusing Phase 86 atomic YAML writers + Phase 91 rsync primitives + append-only ledger; destructive embed flow (5 kinds) via admin-clawdy ButtonBuilder with Accept/Reject/Defer + customId `cutover-` namespace + preChangeSnapshot capture; dual-entry canary runner (Discord bot + /v1/chat/completions API) with 30s timeout; cutover-ready report aggregator + Phase 91 set-authoritative precondition (24h freshness gate + --skip-verify audit row); ledger-rewind rollback CLI. **D-12 finding:** fin-acquisition is a model-binding alias not a discrete OpenClaw agent — verifier infrastructure is reusable for future per-agent migrations but moot for fin-acquisition itself (operator cutover reduces to a single modelByChannel swap).

Phase 93 delivered: three operator-reported UX fixes from the 2026-04-24 fin-acquisition Discord session — (a) rich `/clawcode-status` parity with OpenClaw's 17-field block via pure status-render module + daemon short-circuit; (b) `defaults.clawhubBaseUrl` auto-injection so `/clawcode-skills-browse` surfaces public skills out-of-the-box; (c) HTTP 404 vs malformed-body distinction in plugin install pipeline emitting `manifest-unavailable` outcome with actionable Discord copy. Zero new npm deps.

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

**Status:** v2.5 Cutover Parity Verification shipped 2026-04-25 — Phases 92 (cutover parity verifier infrastructure, 6 plans, 134 tests) + 93 (status/marketplace/manifest UX fixes, 3 plans). D-12 finding documented: fin-acquisition has no discrete OpenClaw identity, so the cutover surface for it reduces to a 1-line modelByChannel swap; verifier infrastructure remains reusable for future per-agent migrations.

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
| v2.3 | 90 | Complete | 2026-04-24 |
| v2.4 | 91 | Complete | 2026-04-24 |
| v2.5 | 92-93 | Complete | 2026-04-25 |
| v2.6 | 94-95 | Opened | 2026-04-25 |


*Milestone v2.1 OpenClaw Agent Migration: 8 phases (75-82) + 1 gap-closure phase (82.1). 31 requirements across SHARED/MIGR/CONF/WORK/MEM/FORK/OPS categories — all satisfied. Zero new npm deps.*

*Milestone v2.2 OpenClaw Parity & Polish shipped 2026-04-23: 7 phases (83-89), 55+ requirements across UI/SKILL/EFFORT/MODEL/CMD/TOOL/MKT categories plus Phase 89 GREET-01..10 (synthesized from the 16 D-01..D-16 decisions in 89-CONTEXT.md). Zero new npm deps. See `.planning/milestones/v2.2-ROADMAP.md` for full details.*

### Phase 94: Tool Reliability & Self-Awareness

**Goal:** Eliminate the class of bugs where agents confidently advertise capabilities (tools, MCP-backed features) that fail at execution time. Every tool must be probed-as-actually-working at boot/heartbeat, and tools whose backing infra is broken must be filtered out of the system prompt so the LLM never promises what it can't deliver. Adds Discord thread-message fetcher + file-sharing-via-Discord-URL helpers across all agents.

**Requirements:** TOOL-01..TOOL-12 (capability probe → dynamic tool advertising → auto-recovery → honest tool errors → cross-agent routing → Discord thread fetcher → file-share helper → defaults.systemPromptDirectives → /clawcode-tools upgrade)

**Depends on:** Phase 85 (MCP awareness foundation), Phase 90.1 (bot-direct fallback), Phase 92 (cutover-time verification — extends to steady-state)

**Plans:** 2/7 plans executed
- [x] 94-01: Capability probe primitive + per-server registry (TOOL-01, TOOL-02)
- [ ] 94-02: Dynamic tool advertising — system-prompt filter (TOOL-03)
- [ ] 94-03: Auto-recovery primitives — Playwright install, op:// refresh, subprocess restart (TOOL-04, 05, 06)
- [x] 94-04: Honest ToolCallError schema + executor wrap (TOOL-07)
- [ ] 94-05: clawcode_fetch_discord_messages + clawcode_share_file auto-injected tools (TOOL-08, 09)
- [ ] 94-06: defaults.systemPromptDirectives + file-sharing default directive (TOOL-10)
- [ ] 94-07: /clawcode-tools surface upgrade + cross-agent routing suggestions (TOOL-11, 12)

**UI hint:** yes — /clawcode-tools embed gains capability probe column with status emoji + last-good timestamp + recovery suggestion. Cross-agent routing surfaces as ephemeral mention chips for healthy alternative agents.

**Status:** Opened 2026-04-25. Zero new npm deps planned (Phase 85 IPC + heartbeat infrastructure + node:child_process for capability probes).

### Phase 95: Memory Dreaming — Autonomous Reflection & Consolidation

**Goal:** Add an idle-time autonomous reflection cycle to ClawCode's memory system. While agents are quiet, the daemon spawns short LLM "dream" passes that re-read recent memory chunks, infer new wikilinks/backlinks between related notes, promote frequently-referenced chunks toward MEMORY.md core, and write operator-readable reflections to `memory/dreams/YYYY-MM-DD.md`. Mirrors the OpenClaw "dreaming" behavior pattern but built natively on top of ClawCode's existing knowledge-graph + sqlite-vec + RRF retrieval infrastructure.

**Requirements (synthesized):**
- DREAM-01: Idle-window detector — schedules a dream pass when an agent has been silent for >N minutes (configurable per-agent; default 30m)
- DREAM-02: Dream prompt builder — assembles recent memory chunks + current MEMORY.md + recent conversation summaries into a focused reflection prompt
- DREAM-03: LLM dream pass — Haiku-class model by default (cheap), reads context, emits structured output: {newWikilinks, promotionCandidates, themedReflection, suggestedConsolidations}
- DREAM-04: Auto-apply additive results — new wikilinks added via existing Phase 36-41 auto-linker; promotion candidates surface in /clawcode-memory dashboard for operator review
- DREAM-05: Dream-log writer — atomic temp+rename markdown to `memory/dreams/YYYY-MM-DD.md` with per-dream sections + timestamp + token cost
- DREAM-06: Cron timer — croner schedule per-agent (configurable in clawcode.yaml `agents.*.dream` block), default disabled fleet-wide, opt-in per agent
- DREAM-07: `clawcode dream <agent>` CLI for manual trigger + `/clawcode-dream` Discord slash for operator-driven reflection

**Depends on:** Phase 36-41 (knowledge graph + auto-linker), Phase 80 (memory translator + origin_id idempotency), Phase 90 (memory-scanner + RRF retrieval — provides the chunk corpus to dream over), Phase 94 (capability probe — dream pass needs to know which tools/MCPs are healthy before suggesting consolidations that depend on them)

**Plans (suggested — run /gsd:plan-phase 95 to decompose):** ~3 plans
- [ ] 95-01: Idle-window detector + dream prompt builder + LLM pass (DREAM-01..03)
- [ ] 95-02: Auto-apply pipeline + dream-log writer + cron timer (DREAM-04..06)
- [ ] 95-03: CLI + Discord slash + observability (DREAM-07)

**UI hint:** yes — `/clawcode-dream` Discord slash with EmbedBuilder showing latest dream summary; `/clawcode-memory` dashboard adds "Promotion candidates" section listing chunks the dream pass flagged for MEMORY.md inclusion.

**Status:** Opened 2026-04-25. Zero new npm deps planned (reuses Claude Agent SDK + sqlite-vec + croner from existing stack).
