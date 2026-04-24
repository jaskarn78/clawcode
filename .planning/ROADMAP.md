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
- :hammer: **v2.5 Cutover Parity Verification** - Phase 92 (opened 2026-04-24)

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

**Status:** v2.5 Cutover Parity Verification opened 2026-04-24 — Phase 92 (fin-acquisition cutover parity verifier) awaiting `/gsd:plan-phase 92` decomposition. Blocks Phase 91 `set-authoritative clawcode --confirm-cutover` until cutover-ready: true report lands.

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
| v2.5 | 92 | Opened | 2026-04-24 |

### Phase 92: OpenClaw → ClawCode fin-acquisition Cutover Parity Verifier

**Goal:** Before the operator flips `sync.authoritative` to clawcode, run an automated parity check that proves the ClawCode fin-acquisition agent can handle every task the OpenClaw source agent has historically handled — tool use, skill invocation, MCP access, memory recall, uploads — via both entry points (Discord bot + /v1/chat/completions API). Emits gap report, auto-applies additive-reversible fixes, gates destructive mutations behind admin-clawdy confirmation, and sets `cutover-ready: true` as a hard precondition for Phase 91 set-authoritative.

**Requirements:** CUT-01..CUT-10 (Discord-history ingestor → source profiler → target probe → diff engine → additive auto-fix → destructive propose-and-confirm → dry-run default → dual-entry canary → cutover-ready gate → set-authoritative precondition)

**Depends on:** Phase 91 (sync direction + set-authoritative command), Phase 90 (memory-scanner for indexing proposed files), Phase 86 (updateAgentModel/Skills/McpServers atomic writers), Phase 85 (list-mcp-status IPC), Phase 80 (memory-translator origin_id idempotency)

**Plans:** 2/6 plans executed
- [x] 92-01-PLAN.md — Discord history ingestor + source-agent profiler (CUT-01, CUT-02) — Wave 1
- [x] 92-02-PLAN.md — Target capability probe + diff engine with typed CutoverGap union (CUT-03, CUT-04) — Wave 1
- [ ] 92-03-PLAN.md — Additive fix auto-applier + ledger (CUT-05) — Wave 2 (depends on 92-02)
- [ ] 92-04-PLAN.md — Destructive-fix admin-clawdy embed flow (CUT-06, CUT-07) — Wave 2 (depends on 92-02; checkpoint task)
- [ ] 92-05-PLAN.md — Dual-entry canary runner (CUT-08) — Wave 3 (depends on 92-01, 92-03)
- [ ] 92-06-PLAN.md — Cutover-ready gate + set-authoritative precondition (CUT-09, CUT-10) — Wave 3 (depends on 92-01..05)

**UI hint:** yes — admin-clawdy ephemeral embed with Accept/Reject/Defer buttons (Phase 86-03 ButtonBuilder pattern); cutover-report summary embed.

**Status:** Opened 2026-04-24. Zero new npm deps planned (reuses discord.js 14.26.2 + better-sqlite3 + Claude Agent SDK per v2.2 discipline).

### Phase 93: Status-detail parity + ClawHub public-catalog defaults + plugin manifest-URL resilience

**Goal:** Bundle three user-reported fixes from the 2026-04-24 fin-acquisition Discord session into a single phase: (a) restore the rich `/clawcode-status` output deferred in Phase 83 EFFORT-07 by mirroring the OpenClaw `/status` 17-element field set with honest `unknown`/`n/a` placeholders for ClawCode-only gaps; (b) auto-inject `defaults.clawhubBaseUrl` as a synthetic ClawHub catalog source so `/clawcode-skills-browse` surfaces public skills out-of-the-box without requiring an explicit `marketplaceSources[{kind:"clawhub"}]` config entry; (c) distinguish HTTP 404 from malformed-body errors in the plugin install pipeline so plugins listed without a fetchable manifest (e.g. `hivemind`) emit a `manifest-unavailable` outcome with actionable Discord copy instead of misleading "manifest is invalid" wording. Zero new npm deps; pure UX-resilience work against the existing stack.

**Requirements:** Sub-plan IDs (no formal REQ-IDs — added outside the milestone requirements process):
- 93-01 — Status-detail parity (rich `/clawcode-status` block via pure status-render module)
- 93-02 — ClawHub public-catalog default injection + dropdown divider
- 93-03 — Plugin manifest-URL 404 vs invalid distinction

**Depends on:** Phase 92 (logical ordering only — no shared code surfaces)

**Plans:** 3 plans (decomposed via /gsd:plan-phase 93 on 2026-04-24)
- [ ] 93-01-PLAN.md — Pure status-render module + /clawcode-status daemon short-circuit rewire — Wave 1
- [ ] 93-02-PLAN.md — loadMarketplaceCatalog auto-inject + /clawcode-skills-browse divider — Wave 1
- [ ] 93-03-PLAN.md — ClawhubManifestNotFoundError + manifest-unavailable outcome + Discord copy — Wave 1

**UI hint:** yes — Discord ephemeral embed parity with OpenClaw `/status` (canonical Unicode emojis, no FE0F variation selectors); StringSelectMenu sentinel-value divider in skills picker; new "manifest unavailable (404)" copy in plugin install error path.

**Status:** Opened 2026-04-24. Plans created 2026-04-24. Zero new npm deps planned (reuses date-fns ^4.1.0 + discord.js ^14.26.2 + existing zod schemas + native fetch). All three plans run in Wave 1 (independent code surfaces — discord/status-render.ts vs marketplace/catalog.ts vs marketplace/clawhub-client.ts).

---

*Milestone v2.1 OpenClaw Agent Migration: 8 phases (75-82) + 1 gap-closure phase (82.1). 31 requirements across SHARED/MIGR/CONF/WORK/MEM/FORK/OPS categories — all satisfied. Zero new npm deps.*

*Milestone v2.2 OpenClaw Parity & Polish shipped 2026-04-23: 7 phases (83-89), 55+ requirements across UI/SKILL/EFFORT/MODEL/CMD/TOOL/MKT categories plus Phase 89 GREET-01..10 (synthesized from the 16 D-01..D-16 decisions in 89-CONTEXT.md). Zero new npm deps. See `.planning/milestones/v2.2-ROADMAP.md` for full details.*
