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
- :white_check_mark: **v2.6 Tool Reliability & Memory Dreaming** - Phases 94-95 (shipped 2026-04-25)
- :white_check_mark: **v2.7 Operator Self-Serve + Production Hardening** - Phases 100-108 (shipped 2026-05-01)
- :hourglass: **v2.8 Performance + Reliability** - Phases 110, 101, 114, 999.7, 999.18-20, 999.34-36, 999.38-42 (proposed 2026-05-07)

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
| v2.6 | 94-95 | Complete | 2026-04-25 |


*Milestone v2.1 OpenClaw Agent Migration: 8 phases (75-82) + 1 gap-closure phase (82.1). 31 requirements across SHARED/MIGR/CONF/WORK/MEM/FORK/OPS categories — all satisfied. Zero new npm deps.*

*Milestone v2.2 OpenClaw Parity & Polish shipped 2026-04-23: 7 phases (83-89), 55+ requirements across UI/SKILL/EFFORT/MODEL/CMD/TOOL/MKT categories plus Phase 89 GREET-01..10 (synthesized from the 16 D-01..D-16 decisions in 89-CONTEXT.md). Zero new npm deps. See `.planning/milestones/v2.2-ROADMAP.md` for full details.*

### Phase 94: Tool Reliability & Self-Awareness

**Goal:** Eliminate the class of bugs where agents confidently advertise capabilities (tools, MCP-backed features) that fail at execution time. Every tool must be probed-as-actually-working at boot/heartbeat, and tools whose backing infra is broken must be filtered out of the system prompt so the LLM never promises what it can't deliver. Adds Discord thread-message fetcher + file-sharing-via-Discord-URL helpers across all agents.

**Requirements:** TOOL-01..TOOL-12 (capability probe → dynamic tool advertising → auto-recovery → honest tool errors → cross-agent routing → Discord thread fetcher → file-share helper → defaults.systemPromptDirectives → /clawcode-tools upgrade)

**Depends on:** Phase 85 (MCP awareness foundation), Phase 90.1 (bot-direct fallback), Phase 92 (cutover-time verification — extends to steady-state)

**Plans:** 7/7 plans complete
- [x] 94-01: Capability probe primitive + per-server registry (TOOL-01, TOOL-02)
- [x] 94-02: Dynamic tool advertising — system-prompt filter (TOOL-03)
- [x] 94-03: Auto-recovery primitives — Playwright install, op:// refresh, subprocess restart (TOOL-04, 05, 06)
- [x] 94-04: Honest ToolCallError schema + executor wrap (TOOL-07)
- [x] 94-05: clawcode_fetch_discord_messages + clawcode_share_file auto-injected tools (TOOL-08, 09)
- [x] 94-06: defaults.systemPromptDirectives + file-sharing default directive (TOOL-10)
- [x] 94-07: /clawcode-tools surface upgrade + cross-agent routing suggestions (TOOL-11, 12)

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

**Plans:** 3/3 plans complete
- [x] 95-01-PLAN.md — Idle-window detector + dream prompt builder + LLM dream pass primitive (DREAM-01/02/03)
- [x] 95-02-PLAN.md — Auto-apply additive + dream-log writer + per-agent cron timer (DREAM-04/05/06)
- [x] 95-03-PLAN.md — CLI clawcode dream + /clawcode-dream Discord slash + run-dream-pass IPC (DREAM-07)

**UI hint:** yes — `/clawcode-dream` Discord slash with EmbedBuilder showing latest dream summary; `/clawcode-memory` dashboard adds "Promotion candidates" section listing chunks the dream pass flagged for MEMORY.md inclusion.

**Status:** Opened 2026-04-25. Zero new npm deps planned (reuses Claude Agent SDK + sqlite-vec + croner from existing stack).

### Phase 96: Discord routing and file-sharing hygiene

**Goal:** Eliminate the inverse-of-Phase-94 bug class — agents *under-promising* filesystem capabilities they actually have. Production trigger (2026-04-25 finmentum-client-acquisition Discord screenshot): agent replied "that path is not accessible from my side... use OpenClaw" despite operator-granted ACL on `/home/jjagpal/.openclaw/workspace-finmentum/` and relaxed `clawcode` systemd unit. Phase 96 makes every filesystem capability the agent claims (or denies) match runtime reality: probe accessible paths at boot/heartbeat/on-demand, render a `<filesystem_capability>` block in the system prompt classifying paths (My workspace / Operator-shared / Off-limits), accept ACL-approved cross-workspace paths in `clawcode_share_file`, deprecate Phase 91 mirror sync (read source via ACL instead). Twin of Phase 94 — same primitives reapplied to filesystem instead of MCP capability.

**Requirements:** D-01..D-14 (14 operator-locked decisions in 96-CONTEXT.md — probe schedule + system-prompt block + refresh trigger + silent re-render + declaration model + boundary check + clawcode_list_files tool + alternative-agent suggestion + outputDir template + auto-upload heuristic + Phase 91 mirror deprecation + share-file failure classification + heartbeat refresh + Tara-PDF E2E acceptance)

**Depends on:** Phase 91 (sync-state.json + 7-day rollback semantics — being deprecated), Phase 94 (capability-probe + ToolCallError + auto-injected tools blueprint — Phase 96 mirrors verbatim), Phase 85 (MCP probe + heartbeat foundation), Phase 22 (config-watcher hot-reload)

**Plans:** 6/7 plans executed
- [x] 96-01-PLAN.md — Filesystem capability probe primitive + per-agent snapshot store + fileAccess schema (D-01, D-05, D-06)
- [x] 96-02-PLAN.md — System-prompt `<filesystem_capability>` block + assembler integration + cache-stability handling (D-02)
- [x] 96-03-PLAN.md — clawcode_list_files auto-injected tool + findAlternativeFsAgents helper + ToolCallError (permission) for fs reads (D-07, D-08)
- [x] 96-04-PLAN.md — Extend clawcode_share_file with outputDir resolution + auto-upload heuristic directive + ToolCallError classification (D-09, D-10, D-12)
- [x] 96-05-PLAN.md — /clawcode-probe-fs Discord slash + clawcode probe-fs CLI + /clawcode-status capability block + clawcode fs-status CLI (D-03, D-04)
- [x] 96-06-PLAN.md — Phase 91 mirror deprecation — disable systemd timer, mark deprecated, sync CLI deprecation messaging, 3-value authoritative enum, 7-day re-enable window (D-11)
- [x] 96-07-PLAN.md — Heartbeat fs-probe check + config-watcher reload trigger + auto-refresh on heartbeat tick + clawdy-deploy procedure + UAT-95 (D-01 heartbeat, D-03 watcher, D-13, D-14)

**Wave structure:** 3 waves
- Wave 1 (parallel): 96-01 (primitives + schema) + 96-06 (Phase 91 deprecation — independent subsystem)
- Wave 2 (parallel — all depend on 96-01): 96-02 (system prompt) + 96-03 (list-files tool + alternatives) + 96-04 (share-file extension + outputDir + classified errors)
- Wave 3 (sequential): 96-05 (Discord slash + CLIs + IPC) → 96-07 (heartbeat scheduling + config-watcher + deploy + UAT-95)

**UI hint:** yes — /clawcode-probe-fs Discord slash with EmbedBuilder showing per-path probe status; /clawcode-status gains Capability section reusing renderFilesystemCapabilityBlock from system-prompt block (single source of truth between LLM-visible prompt and operator inspection); status emoji: ✓ ready, ⚠ degraded, ? unknown.

**Status:** Opened 2026-04-25. Zero new npm deps planned (reuses node:fs/promises + Phase 91 atomic temp+rename + Phase 94 wrapMcpToolError + Phase 85 heartbeat runner + Phase 22 config-watcher RELOADABLE_FIELDS + Phase 53 stable-prefix assembler).

### Phase 97: Network capability probe + turn-dispatch lag (deferred to v2.7)

**Goal:** [To be planned in v2.7] Two related issues surfaced during Phase 96 work that were intentionally deferred to keep Phase 96 scope focused. Both deserve their own phase:

**Sub-scope A — Network capability probe + auto-injected MySQL MCP tool (extends Phase 96 D-01..D-06 model):**
- Trigger 1 (10:18): 2026-04-25 `#finmentum-client-acquisition` Discord — Clawdy claimed *"DB access is being blocked from this container (172.17.0.1 is Docker bridge)"*. Belief may have been current OR stale; Phase 96's filesystem probe doesn't cover network/DB reachability.
- Trigger 2 (13:31): 2026-04-25 `#finmentum-client-acquisition` Discord — Clawdy explained 60-second DB query latency: *"The DB query has to go through a subagent because the `exec` tool isn't available to me directly... subagent spins up its own process, fetches 1Password credentials, connects to MySQL, runs the query, and returns results. That round trip takes ~60 seconds."* Bot recommended *"MySQL MCP tool in the OpenClaw layer"* — anti-pattern that Phase 96 D-10 directive will silence in chat post-deploy, but the underlying perf gap remains.
- Scope:
  - Extend Phase 96's capability snapshot to network endpoints. Probe DB/MCP/HTTP reachability at boot + heartbeat. Surface in `<network_capability>` system-prompt block (sibling to `<filesystem_capability>`). When probe fails, suggest the actual fix (e.g., "add 172.17.0.1 to MySQL `bind-address`") via Phase 94 ToolCallError suggestion field.
  - Auto-inject `mysql_query` MCP tool DIRECTLY in ClawCode (not OpenClaw). Agent calls inline — no subagent round-trip, no per-query 1Password re-fetch. Connection pool kept warm. Target: <2s p50 vs current 60s.
  - Optional: cached query endpoint on dashboard API for common pre-computed queries (AUM, pipeline funnel, growth metrics) as fallback for queries too expensive to run inline.
- Phase 96's D-10 directive extension (post-2026-04-25) already kills the OpenClaw-fallback anti-pattern recommendation IN CHAT — Phase 97 closes the underlying CAPABILITY gap so the recommendation isn't even theoretically needed.

**Sub-scope B — Turn-dispatch one-message-behind lag:**
- Trigger: 2026-04-25 operator report — *"When I prompt the bot, it responds to the previous message... if I send a follow-up with a period, it responds to the previous prompt."*
- Scope: investigate `src/discord/capture.ts` ↔ `src/manager/turn-dispatcher.ts` ↔ `src/discord/streaming.ts` race or buffering. Likely candidates: (a) DiscordBridge message-N captures while turn-N is mid-flight, response attaches to N+1's queue slot; (b) TurnDispatcher one-deep queue; (c) streaming final-flush attaches to next message. Reproduce with deterministic test fixture, fix root cause, add regression test pinning message-N → response-N invariant.

**Plans:** TBD (run /gsd:plan-phase 97 in v2.7 to break down)
**Status:** Backlog — Phase 96 must ship first. Phase 97 opens after Phase 96 deploys + UAT-95 passes.

### Phase 99: Memory translator + sync hygiene + restart-greeting fallback (CLOSED 2026-05-05)

**Goal:** Fix four architectural bugs surfaced during Phase 98 cutover (2026-04-25 evening) when recovering fin-acquisition's pre-cutover conversation history. All four are silent-failure bugs — the system reported success but the data wasn't where the agent looks.

**Trigger:** Operator asked why fin-acquisition (post-cutover ClawCode-owned) had no recollection of Apr 10-24 work that happened on OpenClaw side. Investigation surfaced multiple unrelated gaps in the sync/memory/greeting plumbing.

**Sub-scope A — Translator wrong-DB-path bug (silent corruption-class):**
- Trigger: `clawcode sync translate-sessions --agent fin-acquisition` reported `turnsInserted: 6087`. The DB the agent reads from showed only 12 turns. Investigation found the translator wrote to `<basePath>/agents/<agent>/memories.db` but the agent's MemoryStore reads from `<basePath>/agents/<agent>/memory/memories.db` (one extra `memory/` segment).
- Recovery (manual, this session): backup destination DB, ATTACH source DB, `INSERT OR IGNORE` conversation_sessions + conversation_turns. 6099 turns landed in the right DB after merge.
- Scope:
  - Fix path resolution in `src/migration/memory-translator.ts` (or wherever Phase 80 plan put it) — single source of truth via `getAgentMemoryDbPath(agentName, agentBasePath)` helper that BOTH the translator and the daemon's MemoryStore consume.
  - Static-grep regression pin: every SQLite open() that targets a per-agent memories.db must go through `getAgentMemoryDbPath`. CI grep ensures no `path.join('memories.db')` directly.
  - Backfill check: add a startup invariant that compares row counts in BOTH paths and warns if the wrong-path DB has data (would have caught this immediately).
  - Tests: add a translation E2E test that runs the translator + reads back via MemoryStore and verifies turn parity.

**Sub-scope B — No automatic sync timer (Phase 91 promise unfulfilled): ~~CLOSED 2026-05-01~~**
- Trigger: Phase 91's spec promised "5-min systemd timer + hourly conversation-turn translator via rsync over SSH." `systemctl list-timers` shows neither installed. The `clawcode sync run-once` and `translate-sessions` commands are CLI-only — no cron, no systemd timer. Last manual sync was 2026-04-24 22:02; nothing happened automatically until cutover today.
- Scope (decision required):
  - **Path 1 — install the timers** (matches Phase 91 spec): create `clawcode-sync.timer` (5min OnCalendar) + `clawcode-translate-sessions.timer` (hourly OnCalendar) as systemd user units. Wire installer into `clawcode init` or daemon-bootstrap. Update Phase 91 D-11 deprecation to also disable the timers when `authoritativeSide=deprecated`.
  - **Path 2 — document Phase 91 as manual-only** and finish cutover (Phase 98) for all remaining channels so sync becomes obsolete. Aligns with Phase 96 D-11 deprecation we already landed.
- ~~Recommend Path 2~~ → **Path 2 chosen and complete.** Phase 96/98 cutover is done; all channels are ClawCode-native; Phase 91 sync is deprecated (D-11 landed). Building the timers would be infrastructure for a dead subsystem. No code work required.

**Sub-scope C — Auto-summarization on session-end isn't firing for daemon-managed sessions:**
- Trigger: 308 sessions in conversation_sessions table had `status='ended'` but `summary_memory_id IS NULL` — they finished but were never summarized. Phase 64's SessionSummarizer is supposed to fire at session-boundary; clearly didn't fire here.
- Recovery (manual, this session): wrote 319 boilerplate session-summary memory entries (first/last user, last agent, turn count, date) via Python script. Phase 67 resume brief now picks them up.
- Scope:
  - Audit Phase 64 SessionSummarizer trigger sites — find where status=ended is set and verify summarizer fires there. Add a "summarize-pending" job that picks up any ended-but-not-summarized sessions on heartbeat tick.
  - Add a metric/dashboard for "ended sessions awaiting summarization > 0" so this gap shows up before it accumulates 308 deep.
  - Static-grep regression pin: `UPDATE conversation_sessions SET status='ended'` must be co-located with a SessionSummarizer.summarize() call OR a queue-enqueue.

**Sub-scope D — Phase 89 restart-greeting "no prior session to recap" false negative:**
- Trigger: After Phase 98 cutover, fin-acquisition restarted and posted *"I'm back. Restart complete — no prior session to recap. Ask me anything to get rolling."* — even though we had 326 session-summary entries available. Phase 89's `listRecentTerminatedSessions(agentName, 5)` returned the 5 most recent terminated sessions, all from cutover-day with 0 turns (brief restart cycles). The check `getTurnsForSession(candidate.id, max).length > 0` failed for all 5 → fell through to the minimal-embed fallback.
- Recovery (manual, this session): deleted 71 empty cutover-day sessions + their orphan summary memories so listRecentTerminatedSessions returns the actually-meaty translated sessions.
- Scope:
  - Patch Phase 89 logic: if `candidateTurns.length === 0` BUT `candidate.summary_memory_id` is set, USE THE EXISTING SUMMARY instead of falling through. The Haiku-resummarize step is a nice-to-have when raw turns exist; when only a summary exists, just relay it.
  - Increase `listRecentTerminatedSessions` default limit from 5 to e.g., 25 so brief empty sessions don't shadow real ones.
  - Add SQL filter option: `WHERE turn_count > 0 OR summary_memory_id IS NOT NULL` to push the filtering server-side.
  - Test fixture: synthesize a "5 empty + 1 meaty" scenario and verify Phase 89 picks the meaty one.

**Sub-scope E — Skills migration cross-host limitation: ~~DROPPED 2026-05-05~~** (data recovered manually; cross-host CLI deemed not worth building post-cutover).

**Sub-scope F — `/clawcode-status` data wiring (Phase 93 incomplete implementation): ~~CLOSED — promoted to Phase 103, SHIPPED 2026-04-29~~**
- Trigger: Operator ran `/clawcode-status` post-cutover. The 17-field embed (Phase 93 D-93-02-1) has SHAPE-parity with OpenClaw but most fields show `n/a` or `unknown` — the renderer hardcodes "n/a" for Fallbacks/Compactions/Tokens/Runner/Fast/Harness/Reasoning/Elevated/Queue and `data.X` field props are passed through as `undefined` for sessionId/lastActivityAt/effort/permissionMode.
- Field-by-field recovery analysis (recoverable vs not):
  - Recoverable from existing infra: Fallbacks (agent.fallbacks), Context % (Phase 53 zone tracker), Compactions (CompactionManager), Tokens (UsageTracker), Session ID + Last Activity (SessionHandle), Think (Phase 83 EffortStateStore), Reasoning (extended-thinking budget), Permissions (SDK setPermissionMode), Activation (turn trigger source), Queue depth (TurnDispatcher).
  - May not have ClawCode analog: Fast, Elevated (OpenClaw-specific concepts — design decision: drop the fields OR repurpose for ClawCode equivalents).
- **Resolution:** Promoted to standalone Phase 103 (rich telemetry + Usage panel) and shipped 2026-04-29. Rate-limit event wiring, Usage embed, and most n/a fields wired. Remaining honest-n/a: `Fallbacks` — tracked as Phase 999.5 (no source currently exists). See Phase 103 VERIFICATION.md.

**Sub-scope G — Plaintext credential rotation batch: ~~DROPPED 2026-05-05~~** (operator handling rotation outside the GSD workflow).

**Sub-scope H — Cron schedule migration tooling: ~~DROPPED 2026-05-05~~** (data migrated manually; CLI deemed not worth building post-cutover).

**Sub-scope I — Schedule prompts referencing OpenClaw-side paths: ~~DROPPED 2026-05-05~~** (no longer tracking; operator will address per-schedule as they trigger).

**Sub-scope J — Phase 95 dreaming source-material wiring + production hardening (partial):**
- Trigger: Operator enabled dreaming for fin-acquisition. Three latent bugs surfaced + were hotfixed inline this session: (1) Haiku wraps JSON output in ```json``` markdown fence — strict JSON.parse rejects (`f38ae00`); (2) Haiku produces narrative prose preamble before JSON ("Picking up where we left off, …") — extract first balanced JSON object (`ca0122b`); (3) tightened system prompt to require strict JSON-only output (`509ff03`); (4) `entry.timestamp.toISOString()` undefined — wrapper lambda in IPC handler was discarding entry shape, dream-auto-apply was passing the FULL `{agentName, memoryRoot, entry}` but the lambda treated it all as `entry` (`c2d68f9`).
- **Bugs 1-4 above: ~~CLOSED~~** — promoted to Phase 107 (dream JSON enforcement + vec_memories orphan cleanup), SHIPPED 2026-04-30. Dream pass fires end-to-end; JSON output reliable; `memory/dreams/YYYY-MM-DD.md` written correctly.
- BUT the dream's `themedReflection` says "No memory chunks, conversation summaries, or wikilink graph data were provided in this reflection cycle." — meaning the dream-prompt-builder isn't pulling from the 6087 conversation_turns + 326 session-summaries we have. Likely related to sub-scope A (wrong-DB-path) — the prompt builder may be reading from the empty single-`memory/` DB instead of the agent's actual `memory/memory/` DB.
- **Remaining scope (still open — blocked on Sub-scope A DB-path fix):**
  - Fix dream-prompt-builder to read from the agent's actual MemoryStore + ConversationStore (single source of truth — same DB the agent + Phase 67 resume brief use).
  - Test fixture: spawn a dream pass after a synthetic conversation, assert `themedReflection` cites specific session content.
  - Add a `dream.minSourceContent` config (e.g., min 5 chunks OR min 1 session summary) — skip dream pass when source is too sparse to produce meaningful output.

**Plans:** Sub-scopes A/C/D/J shipped 2026-05-02 via ultraplan PRs #3 + #5 (commits 778c8c7 + 3bbde46). Sub-scopes E/G/H/I dropped 2026-05-05 (manual recovery accepted as final).
**Status:** ~~CLOSED 2026-05-05~~ — A/B/C/D/F/J shipped; E/G/H/I dropped (operator decision, manual recovery accepted as final state). Credential rotation (former G scope) handled by operator outside GSD workflow.

**Sub-scope resolution summary (updated 2026-05-02):**
- ~~A~~ — CLOSED 2026-05-02 via PR #5 (commit 3bbde46): `getAgentMemoryDbPath()` helper in `src/shared/agent-paths.ts` + 8 callsite migrations + static-grep CI regression pin in `src/shared/__tests__/agent-paths.regression.test.ts`.
- ~~B~~ — CLOSED 2026-05-01: Path 2 chosen, cutover complete, sync deprecated.
- ~~C~~ — CLOSED 2026-05-02 via PR #5 (commit 3bbde46): `ConversationStore.listPendingSummarySessions()` + `SessionManager.summarizePendingSessions()` + `summarize-pending` heartbeat check at 30-min cadence × 5 sessions/tick. Backlog of 308 drains in ~30h wall-clock.
- ~~D~~ — CLOSED 2026-05-02 via PR #5 (commit 3bbde46): restart-greeting lookback bumped 5 → 25 + `summaryMemoryId` fallback when no candidate has turns.
- ~~F~~ — CLOSED: Promoted to Phase 103, shipped 2026-04-29.
- ~~J~~ — CLOSED 2026-05-02. JSON bugs 1-4 closed via Phase 107 (2026-04-30); source-material wiring closed via PR #3 (commit 778c8c7) + PR #5 (path fix unblocks dream prompt builder seeing canonical DB).
- ~~E~~ ~~G~~ ~~H~~ ~~I~~ — DROPPED 2026-05-05: manual recovery accepted as final state. Credential rotation handled by operator outside GSD workflow. No further work tracked under Phase 99.

### Phase 100: GSD-via-Discord on Admin Clawdy (operator-self-serve dev workflow)

**Goal:** Operator can drive a full GSD workflow (`/gsd:plan-phase`, `/gsd:execute-phase`, `/gsd:autonomous`, `/gsd:debug`, etc.) from the `#admin-clawdy` Discord channel, with long-running phases auto-routed into a subagent thread so the main channel stays free.

**Trigger:** Operator wants to plan/execute new and existing projects from Discord without dropping into a local terminal — the entire GSD framework (discuss → plan → execute → verify) should be available wherever the operator already lives, which is Discord.

**Pre-existing primitives we can reuse:**
- `~/.claude/get-shit-done/` user-level skills (already installed at the OS level for jjagpal user — needs to be available to the `clawcode` system user too)
- `spawn_subagent_thread` MCP tool (Phase 99-M auto-relay shipped 2026-04-26)
- subagent-routing directive (Phase 99-K shipped 2026-04-26 — already tells agents to route >30s work into subthreads)
- Subagent thread spawner with parent-completion auto-relay
- Admin Clawdy agent already bound to `#admin-clawdy` channel + has bot identity + has SOUL/IDENTITY

**Sub-scope candidates (refined during discuss-phase):**
1. **Skills availability** — `/home/clawcode/.claude/get-shit-done/` symlink or copy from `/home/jjagpal/.claude/get-shit-done/` (or install into the clawcode user's skills path). Decide: shared vs. per-user copy.
2. **Project workspace resolution** — GSD writes to `.planning/` in cwd. Admin Clawdy's current cwd is its own workspace. Need a way to point Admin Clawdy at a project repo (config field, runtime CLI, or per-project agent variant). For smallest-version: Admin Clawdy operates on a single configured `gsd.projectDir` (e.g. the ClawCode repo itself, or a fresh project repo on clawdy).
3. **Slash command routing** — verify the SDK auto-recognizes `/gsd:*` slash commands from Discord message bodies; if not, add a thin ClawCode-side slash dispatcher that maps `/gsd:plan-phase 5` → Skill invocation.
4. **Auto-thread for long workflows** — autonomous + execute-phase can run for hours and produce hundreds of tool calls. Per Phase 99-K directive, those MUST route into a subthread. Add a pre-flight that detects `/gsd:autonomous` or `/gsd:execute-phase` and auto-spawns a subagent thread before invoking.
5. **Artifact relay** — when GSD creates `.planning/phases/<phase>/PLAN.md`, surface a Discord-friendly summary (filename + link to file in workspace) back to the main channel. Subthread is verbose; main channel gets the highlights.
6. **Smoke test** — operator types `/gsd:autonomous` in `#admin-clawdy`, agent acknowledges + spawns subthread, workflow runs, completes, agent posts summary in main channel + thread URL.

**Requirements:** REQ-100-01..REQ-100-10 (synthesized from CONTEXT.md decision lock-ins — slash dispatch, settingSources flow, auto-thread pre-spawn, gsd.projectDir, symlink delivery, artifact relay, agent-restart classification, sandbox bootstrap, channel guard, UAT smoke).

**Plans:** 8/8 plans complete
- [x] 100-01-PLAN.md — Schema extensions: agent.settingSources + agent.gsd.projectDir + ResolvedAgentConfig propagation + loader resolver
- [x] 100-02-PLAN.md — Session-adapter wiring: replace hardcoded cwd + settingSources with config-driven values (createSession + resumeSession)
- [x] 100-03-PLAN.md — Differ classification: settingSources + gsd.projectDir as agent-restart (NON_RELOADABLE) fields
- [x] 100-04-PLAN.md — Slash dispatcher: /gsd-* inline handler with auto-thread pre-spawn for long-runners (12th application)
- [x] 100-05-PLAN.md — Phase 99-M relay extension: append artifact paths to parent's main-channel summary prompt
- [x] 100-06-PLAN.md — Install helper: clawcode gsd install CLI subcommand (symlinks + sandbox git init, local-only)
- [x] 100-07-PLAN.md — clawcode.yaml fixture: admin-clawdy agent block with 5 GSD slashCommands + settingSources + gsd.projectDir
- [x] 100-08-PLAN.md — Smoke-test runbook: operator-runnable deploy procedure + post-deploy UAT verification

**Wave structure:** 5 waves
- Wave 1 (parallel): 100-01 (schema foundation)
- Wave 2 (parallel — both depend on 100-01): 100-02 (session-adapter) + 100-03 (differ classification)
- Wave 3 (parallel — depend on 100-01/02): 100-04 (slash dispatcher) + 100-05 (relay extension)
- Wave 4 (parallel — depend on 100-04 + 100-01): 100-06 (install CLI) + 100-07 (yaml fixture)
- Wave 5 (sequential — depends on all): 100-08 (smoke-test runbook + UAT)

**UI hint:** yes — operator types `/gsd-autonomous`, `/gsd-plan-phase`, `/gsd-execute-phase` in #admin-clawdy → ack message in main channel within 3s + thread URL; subagent works in `gsd:<cmd>:<target>` thread; on completion, parent posts main-channel summary including "Artifacts: .planning/phases/N-*/" line. Short-runners (`/gsd-debug`, `/gsd-quick`) reply inline.

**Status:** Plans drafted 2026-04-26 — ready to execute. Zero new npm deps planned (reuses Claude Agent SDK 0.2.97 settingSources field + Phase 99-M relayCompletionToParent + node:fs/promises symlink primitives + Phase 22 config-watcher). Production deploy to clawdy host is operator-driven per 100-08 SMOKE-TEST.md runbook (autonomous=false on Plan 08).

### Phase 101: Robust document-ingestion pipeline (operator-daily-driver unblock)

**Goal:** Make agents reliable at processing PDFs, scanned documents, financial statements, and other structured documents that operator workflows depend on. Eliminate the failure modes seen during the 2026-04-28 Pon tax return debug — where a scanned PDF without a text layer caused "image dimension limit for many-image requests" errors, the subagent fell back to manual PyMuPDF page-by-page rendering, claimed to save analysis to a file that was never written, and the relay back to the parent agent was built on a Discord-truncated subagent reply (only 2000 chars made it through).

**Trigger:** Pon tax return analysis 2026-04-28 morning — operator's daily-driver workflow (financial document analysis for client meetings) hit hard limits on the SDK's image-batch ceiling and produced an unrecoverable artifact (claimed-but-not-written file). Phase 100-fu directives (`long-output-to-file`, `verify-file-writes`) addressed the Discord-output side of failures but the upstream document-handling pipeline is still ad-hoc.

**Pre-existing primitives we can reuse:**
- Claude Agent SDK 0.2.97 vision support (image input via `<image>` blocks; subject to per-request dimension limits documented at platform.claude.com/docs/en/build-with-claude/vision)
- Phase 49 RAG-over-documents infrastructure (`ingest-document` IPC + `vec_document_chunks` + `memory_chunks_fts` for searchable extracted text)
- Phase 90 MEM-03 hybrid-RRF retrieval over `memory_chunks` — extracted documents land in this surface for auto-injection into agent context
- Phase 100-fu `long-output-to-file` + `verify-file-writes` directives (addresses the "subagent claims save but doesn't deliver" failure mode)
- `playwright` MCP server (already on every agent's mcpServers list — capable of rendering web-based document viewers if Playwright is the right OCR fallback)
- `op://` rewrite + 1Password vault scoping (Phase 100-fu — for any document API keys that need vault-scoped distribution)

**Sub-scope candidates (refined during discuss-phase):**
1. **Document type detection + handler dispatch** — first-pass classifier on input file: text-PDF (has text layer → direct extract), scanned-PDF (image-only → OCR pipeline), spreadsheet (xlsx/csv → structured parser), Word (docx → text extract), image (PNG/JPG → vision). Each type routes to the right handler. Detection via `pdftotext` exit code or `file` CLI heuristic.
2. **OCR fallback for scanned PDFs** — when the text-layer path returns empty/whitespace, fall back to OCR. Two paths to evaluate: (a) Tesseract CLI on clawdy (free, ~5s/page on M-series, accuracy decent but inconsistent on financial forms), (b) Claude vision API per page (higher accuracy, ~$0.01/page, subject to image-dimension limits — must downscale aggressively before send).
3. **Page-batching strategy** — for multi-page documents, the SDK's per-request image ceiling (current ~20 images / ~30MB total per request) means agents need to chunk: process N pages per Claude call, accumulate results, stitch. Page-batch size + overlap window tunable per document type (tax returns: 5 pages per batch with no overlap; complex prospectuses: 3 pages with 1-page overlap).
4. **Structured extraction surface** — beyond raw text, extract typed structures from financial documents: tables (line items, amounts, dates), forms (named field → value), totals, dates, account numbers. Output schema-validated via zod (per CLAUDE.md convention) so downstream consumers can rely on shape. Per-type schemas: `ExtractedTaxReturn`, `ExtractedBrokerageStatement`, `Extracted401kStatement`, `ExtractedADV`, etc. — operator-curated set.
5. **New MCP tool: `ingest_document(path, taskHint?, extract?: "text"|"structured"|"both")`** — wraps the full pipeline: (a) detect type, (b) extract via right handler, (c) structured-extract if requested, (d) save full text to `<workspace>/documents/<doc-slug>-<date>.md`, (e) save structured output to `<workspace>/documents/<doc-slug>-<date>.json`, (f) auto-ingest text into Phase 49 RAG via existing `ingest-document` IPC, (g) return summary + paths + structured fields. Single tool call, all the plumbing handled.
6. **Memory pipeline integration** — extracted documents auto-feed into `memory_chunks` + `vec_memory_chunks` so Phase 90 pre-turn retrieval surfaces relevant chunks on subsequent turns. Cross-cuts: when an agent references a client's document, the next turn auto-pulls the relevant chunks into the `<memory-context>` block. Already 80% there via Phase 49 — this phase wires it end-to-end for the new ingestion path.
7. **Fail-mode taxonomy + operator alerts** — when ingestion fails (OCR returns garbage, structured extraction can't find required fields, page-batch truncates mid-table, etc.), surface a structured failure via the trigger-engine delivery callback to admin-clawdy. Operator gets "fin couldn't parse Pon's tax return Schedule C — Tesseract OCR gave 12% confidence, recommend manual review" instead of the agent silently falling back to claim-but-fail.
8. **Pon tax-return UAT case** — the canonical regression artifact. Phase ships when fin-acquisition can ingest the same Pon 2025 tax return that failed 2026-04-28 morning, produce a structured `ExtractedTaxReturn` matching operator-curated truth values (Box 1 wages, Schedule C profits, backdoor Roth amounts, etc.), and post a complete summary to thread without truncation, with the file actually written and verified.

**Plans:** TBD (run /gsd:plan-phase 101 in v2.7 to break down)

**Status:** Pending — opened 2026-04-28 evening after the Pon tax return debug session. Closely related to Phase 100-fu's long-output-to-file directive (which addresses the Discord-output side); Phase 101 addresses the upstream document-parsing side. Likely the single highest-leverage operator-facing feature in the v2.7 milestone — fin-acquisition's daily workflow is document-heavy, and the current ad-hoc PyMuPDF fallbacks are unreliable.

### Phase 103: /clawcode-status rich telemetry + Usage panel (operator-observability)

**Goal:** Replace the 11 hardcoded `n/a` fields in `/clawcode-status` with live telemetry from existing managers, and add a Claude-app-style session/weekly usage panel (`/clawcode-usage`) backed by the SDK's native `rate_limit_event` stream — so operator can see at a glance which agent is healthy, what model/effort it's running, how much context is left, and how close the OAuth Max subscription is to its 5-hour and 7-day windows.

**Trigger:** 2026-04-26 — operator asked whether the `/clawcode-status` data-wiring work was still on the backlog (it was, as Phase 99 sub-scope F). Coupled with the live request to mirror the Claude app's session/weekly usage bars (iOS screenshot reference). Discovery during scoping: ClawCode auths via OAuth Max subscription (not API key), and the Claude Agent SDK 0.2.x exposes `SDKRateLimitInfo` via per-turn `rate_limit_event` messages — which carries exactly the data the Usage panel needs (status, resetsAt, rateLimitType, utilization, overage state). Promoting Phase 99-F to standalone Phase 103 because the Usage panel is a meaningful operator-facing surface, not just a wiring chore.

**Pre-existing primitives we can reuse:**
- `SDKRateLimitInfo` (claude-agent-sdk 0.2.97 — `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2553-2563`) — fired as `rate_limit_event` messages per `query()` turn. Carries `status` (allowed/allowed_warning/rejected), `resetsAt`, `rateLimitType` ('five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage'), `utilization` (0-1), overage fields.
- `CompactionManager` (Phase 47) — knows compaction count + last-compaction timestamp per agent.
- `UsageTracker` — tokens in/out/cache, fallback count, per-turn cost.
- `SessionHandle` — current SDK session ID, last-activity timestamp.
- `EffortStateStore` (Phase 53) — current `think` budget per agent.
- `TurnDispatcher` — queue depth + in-flight turn ID.
- Phase 53 zone tracker — context-window utilization %.
- Existing `/clawcode-status` slash command + `buildStatusData()` — the embed scaffolding is already in place; this phase fills in real values and adds new fields.

**Sub-scope candidates (refined during discuss-phase):**
1. **New `RateLimitTracker` per agent** — listens for `rate_limit_event` messages emitted by the SDK during `query()` execution. Stores latest snapshot per `rateLimitType` (so 5-hour, 7-day, 7-day-opus, 7-day-sonnet, overage are tracked independently). In-memory + persisted to per-agent SQLite for restart resilience. Exposes `getLatest(type)` and `getAllSnapshots()` for the embed builders.
2. **Wire 11 hardcoded `n/a` fields in `buildStatusData`** to live telemetry: Fallbacks (UsageTracker), Compactions (CompactionManager), Tokens (UsageTracker), Session ID (SessionHandle), Last Activity (SessionHandle), Think effort (EffortStateStore), Reasoning (effort tier label), Permissions (AgentConfig.permissions or settingSources), Activation (boot timestamp from process manager), Queue (TurnDispatcher depth), Context % (Phase 53 zone tracker). Drop the 3 OpenClaw-specific fields (Fast/Elevated/Harness) — they don't apply to ClawCode's OAuth Max model.
3. **Session/weekly bars on `/clawcode-status` embed** — append two compact bars: "5h session: ▓▓▓░░░ 47% (resets 2:40pm)" and "7-day weekly: ▓▓▓▓▓░ 71% (resets Mon 9am)". Backed by `RateLimitTracker.getLatest('five_hour' | 'seven_day')`. Drop 3 OpenClaw fields to make embed room.
4. **New `/clawcode-usage` slash command** — dedicated Usage panel matching the Claude app screenshot. Fields: 5-hour session usage with reset countdown, 7-day weekly usage with reset countdown, Opus weekly carve-out, Sonnet weekly carve-out, overage state (allowed/disabled/exceeded), surpassed-threshold warnings. Per-agent (defaults to channel-bound agent) with optional `agent:` arg to query a specific agent. Includes ASCII progress bars + emoji status indicators (🟢 green / 🟡 warning / 🔴 rejected).
5. **Tests pinning rate-limit snapshot capture + render** — Vitest unit tests: (a) RateLimitTracker correctly merges incoming `rate_limit_event` snapshots, dedupes by type, retains latest. (b) Persistence round-trip (write → restart → read latest). (c) `buildStatusData` includes all 11 newly-wired fields with non-`n/a` values when underlying managers have data. (d) `/clawcode-usage` embed renders all 4 rate-limit types with correct bar widths + reset times + status colors.

**Plans:** 3/3 plans complete

Plans:
- [x] 103-01-PLAN.md — Wire 8 live fields into /clawcode-status (Session ID, Last Activity, Tokens, Permissions, Effort, Reasoning label, Activation, Queue, Context %, Compactions count) + drop 3 OpenClaw fields (Fast/Elevated/Harness) + add compaction counter mirror on SessionManager — completed 2026-04-29
- [x] 103-02-PLAN.md — RateLimitTracker (in-memory + per-agent SQLite via UsageTracker DB) + SDK rate_limit_event branch in iterateUntilResult + 7th DI-mirror application on SessionHandle (getRateLimitTracker/setRateLimitTracker)
- [x] 103-03-PLAN.md — list-rate-limit-snapshots IPC method (avoiding rate-limit-status collision) + /clawcode-usage CONTROL_COMMAND with EmbedBuilder inline-handler short-circuit (11th application) + buildUsageEmbed pure renderer + optional 5h+7d bars suffix on /clawcode-status (OBS-08) + slash-command-cap regression test

**Status:** Executing — Plan 01 complete 2026-04-29 (8 fields wired live, 3 OpenClaw fields dropped, compaction counter mirror added). Plans 02 + 03 pending. ~1 day estimate end-to-end.

---

### Phase 104: Daemon-side op:// secret cache + retry/backoff

**Goal:** Resolve all `op://` references in clawcode.yaml (`discord.botToken`, `agents.*.mcpEnvOverrides.*`, `mcpServers.*.env.*`) once at daemon boot into an in-memory map, inject literal values into agent envs at spawn so restarts re-use the cache without re-hitting the 1Password API. Add exponential backoff (e.g., 1s/2s/4s, 3 attempts) on `op read` failures so transient rate-limits don't crash-fail an agent.

**Why now:** Root cause of the 2026-04-30 incident — systemd crash-loop × N agents × ~5 secrets each saturated the 1Password service-account read quota into a long-tail throttle, blocking every read operation for ~10 minutes. The bridge stale-routingTable bug surfaced it (deploy → restart → boot storm), but the underlying fragility is structural: every restart re-resolves every secret in parallel, and a single rate-limit response on any one of them kills agent start with no retry. Cache + backoff makes the daemon resilient to bursty op API behavior. Pairs naturally with Phase 999.9 (shared MCP) — cache fixes boot, pool fixes runtime.

**Requirements:** [SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07] (derived in 104-RESEARCH.md §phase_requirements):
- SEC-01: All three op:// resolution sites (Discord botToken, shared mcpServers[].env, per-agent mcpEnvOverrides) route through one `SecretsResolver` singleton.
- SEC-02: Resolved values cached in-memory keyed on the verbatim op:// URI; restart-within-process re-uses cached values.
- SEC-03: `op read` failures retry with exponential backoff (3 attempts, 1s/2s/4s + jitter); rate-limit errors bail early via AbortError; empty resolution non-retryable.
- SEC-04: Boot-time pre-resolution runs in parallel via `Promise.allSettled`; partial failures fail-open with structured pino logs (mirror existing MCP-disabled pattern).
- SEC-05: Cache invalidation wired via ConfigWatcher diff (yaml edit) + recovery/op-refresh (auth-error) + IPC `secrets-invalidate` (manual rotation).
- SEC-06: New IPC `secrets-status` returns counter snapshot (cacheSize, hits, misses, retries, rateLimitHits, lastFailureAt, lastFailureReason, lastRefreshedAt) for /clawcode-status renderer.
- SEC-07: No resolved secret value ever appears in pino logs, error messages, or IPC responses — only op:// URI + structured fields.

**Open questions resolved (see 104-RESEARCH.md §Open Questions):**
- TTL: until-restart + explicit invalidation (HIGH confidence)
- Cache key: full URI verbatim (HIGH)
- Partial failure: fail open, mirror MCP-disable pattern (HIGH)
- Module location: dedicated `src/manager/secrets-resolver.ts` (HIGH)
- Invalidation: ConfigWatcher + recovery/op-refresh + `secrets-invalidate` IPC; skip signals (HIGH)
- Backoff: 3 attempts × 1s/2s/4s × jitter; AbortError on attempt 2 for rate-limit errors (MEDIUM — calibrate post-deploy)
- Telemetry: counter struct exposed via new IPC `secrets-status` (MEDIUM — confirm in v1.0)

**Plans:** 5/5 plans complete

Plans:
- [x] 104-00-PLAN.md — Wave 0: install p-retry@^8.0.0 + scaffold five vitest test files (RES-01..RES-09, WATCH-01/02, callsites grep, daemon-boot-degraded, secrets-status IPC)
- [x] 104-01-PLAN.md — Wave 1: implement `SecretsResolver` class (resolve/preResolveAll/invalidate/snapshot); turn RES-01..RES-09 green (SEC-02, SEC-03, SEC-07)
- [x] 104-02-PLAN.md — Wave 2: build `collectAllOpRefs` walker + rewrite three call sites in daemon.ts (Discord botToken, per-agent opEnvResolver, loader sync wrapper) + boot pre-resolve (SEC-01, SEC-04)
- [x] 104-03-PLAN.md — Wave 3: ConfigWatcher.onChange diff invalidation + recovery/op-refresh `invalidate?` dep wiring (SEC-05)
- [x] 104-04-PLAN.md — Wave 3: register `secrets-status` + `secrets-invalidate` IPC methods, zod schemas, daemon handler branches (SEC-06)

**Status:** Shipped. All 7 requirements complete. Makes deploys + restarts robust against bursty 1P behavior. Sequenced before Phase 999.9 (shared 1password-mcp pooling).

---

### Phase 105: Trigger-policy default-allow + QUEUE_FULL coalescer storm fix

**Goal:** Two production-impact bugs observed on clawdy 2026-04-30, both in the core dispatch hot path. Ship as a coherent "performance + functionality unblock" patch. (Original 105 scope included two more items — cross-agent IPC channel delivery + inbox heartbeat timeout — those are deferred to Phase 999.12 since they have lower operator impact and can ship independently.)

1. **Trigger policy fail-closes when `~clawcode/.clawcode/policies.yaml` is absent.** `daemon.ts:2033` falls back to `new PolicyEvaluator([], configuredAgentNames)`; with empty rules every event hits the final `return { allow: false, reason: "no matching rule" }` branch in `policy-evaluator.ts`. Today's journal shows the 09:00 fin-acquisition standup cron and the 08:26 finmentum-content-creator one-shot reminder both rejected this way — **every scheduler/reminder/calendar/inbox event silently dropped** for every agent. Switch the missing-file fallback to the default-allow semantic (allow if `targetAgent` is in `configuredAgents`) — `evaluatePolicy()` already implements it at `policy-evaluator.ts:18127`. Replace the misleading `"using default policy"` log line.

2. **QUEUE_FULL coalescer runaway recursive retry storm.** Today 09:47–09:58 PT, fin-acquisition was processing one slow turn while ~10 user messages arrived in burst. The Discord-bridge `streamAndPostResponse` drain block re-tries every ~150ms, hits `QUEUE_FULL` on the depth-2 SerialTurnQueue, throws the payload back into the `messageCoalescer`, and re-enters — each iteration **wraps the prior failed payload in another `[Combined: 1 message received during prior turn]\n\n(1) ...` header** (verified +54 chars/iteration in journal: 9607 → 8454 → 8508 → 8562 → 8616 → ... → 8832). Daemon CPU spikes; the eventual successful turn receives a multiply-wrapped corrupted payload. Fix: idempotent coalesce (skip wrapping if payload already starts with `[Combined:`), wait for in-flight slot via `SerialTurnQueue.hasInFlight()` before recursing, cap drain depth at N to prevent unbounded retry. Preserve the legitimate "user sent 3 messages while agent was working" combine-into-one-payload feature.

**Trigger:** 2026-04-30 — operator reported "scheduled reminders never fire" + later "fin-acquisition slowdown / 9-min turn". Diagnosed via SSH journalctl on clawdy in this session. Admin Clawdy mis-attributed the slowdown to Anthropic credits — actually QUEUE_FULL retry storm; "Credit balance is too low" string Admin Clawdy saw is from `restart-greeting.ts:API_ERROR_FINGERPRINTS` regex matching old session content, not live API responses.

**Requirements:** [POLICY-01 default-allow fallback, POLICY-02 boot log clarity, POLICY-03 PolicyWatcher hot-reload back-compat; COAL-01 idempotent coalesce wrapper detection, COAL-02 wait-for-in-flight gate, COAL-03 drain depth cap, COAL-04 storm warning log] — see 105-PLAN.md when planned.

**Plans:** 3/4 plans executed

Plans:
- [x] 105-00-PLAN.md — Wave 0 RED tests: POLICY-01/02 regression locks + CO-7..CO-11 + MC-7 coalescer storm RED tests
- [x] 105-01-PLAN.md — Wave 1 GREEN POLICY: default-allow when policies.yaml missing (POLICY-01..03)
- [x] 105-02-PLAN.md — Wave 1 GREEN COAL: coalescer storm — idempotent wrapper + drain gate + depth cap (COAL-01..04)
- [x] 105-03-PLAN.md — Wave 2 deploy gate + clawdy ship + journalctl smoke (bundled into Phase 106 overnight deploy 2026-05-01; see 105-03-SUMMARY.md)

**Status:** Shipped per commits a7a3564 (POLICY fix) + fb2a98e (COAL fix). Both production bugs resolved: scheduler events no longer silently dropped, QUEUE_FULL retry storm eliminated.

---

### Phase 106: Agent context hygiene bundle — delegate scoping + research stall + CLI hot-fix

**Goal:** Bundle three loose ends from 2026-04-30's session into one ship. All three are infrastructure / agent-prompt-rendering hygiene; same touch points; one deploy.

#### Pillar A — Delegate map should NOT inherit into spawned subagent system prompts (DSCOPE-01..04)

The 2026-04-30 999.13 deploy went wrong because when fin-acquisition spawned fin-research as a subagent, fin-research-as-spawned-subagent inherited fin-acq's full system prompt including the `delegates: { research: fin-research }` directive. fin-research then saw "delegate research → fin-research" and tried to recursively call itself ("I'll spawn a focused research agent to handle this"). The SDK recursion guard blocked the actual spawn but the agent stalled instead of pivoting to do the work itself.

The 999.13 yaml fan-out was rolled back, but the underlying bug is in the prompt-rendering layer — not the directive text. Properly, the `delegates` directive should only appear in the *primary* agent's system prompt, NOT in any subagent thread spawned by that primary. Subagents are leaf workers, not orchestrators; they shouldn't see the delegate map at all.

**DSCOPE-01:** `renderDelegatesBlock` (or equivalent) is gated by an `isSubagent` (or similar) context flag. When rendering a subagent's system prompt, the block is omitted entirely.
**DSCOPE-02:** Identify the system-prompt-assembly code path for spawned subagents (likely `subagent-thread-spawner.ts` or `spawn-subagent-thread` skill). Wire the flag at the right boundary.
**DSCOPE-03:** Tests pin the behavior: primary agent's prompt CONTAINS the directive when `delegates` is configured; same agent's spawned subagent's prompt does NOT contain the directive even though the parent's config has it.
**DSCOPE-04:** Yaml fan-out is restored (the same 8 channel-bound agents from quick-260430-po4): finmentum group → `{ research: fin-research }`, non-finmentum group → `{ research: research }`. Operator-curated; no Admin Clawdy.

#### Pillar B — Research agent boot stall (STALL-01..02)

After today's 999.12 deploy at 22:09:24, the snapshot listed 6 agents to auto-start. 4 of them reached `warm-path ready` within 2-4 min (finmentum-content-creator, fin-acquisition, Admin Clawdy, personal). 2 of them — `research` and `fin-research` — registered schedules + memory scanner but never reached `warm-path ready`. They're stopped in `clawcode status` and the journal shows no error for them.

**STALL-01:** Investigate root cause. Hypothesis: research agents have a different MCP set (`brave-search`, `playwright`, `browserless`, `fal-ai`, `google-workspace`) and one of those is hanging during MCP load. Check via `pgrep -a` for stalled MCP procs spawned by these agents. Also check daemon SDK output / handle. If MCP load timeout is a dependency, instrument it with a telemetry log to make next-time diagnosis instant.
**STALL-02:** Add a warmup-timeout check: if an agent doesn't reach `warm-path ready` within 60s of `agent.start`, log `level=50` with full context (which MCP loads are pending, what the SDK was last doing). Today's silent stall ate operator time; next time it should self-report.

#### Pillar C — `clawcode mcp-tracker` CLI hot-fix (TRACK-CLI-01)

After 999.15's deploy, `clawcode mcp-tracker` returns "Error: Invalid Request". The IPC handler `mcp-tracker-snapshot` and the CLI client request shape don't match — likely a method name typo OR a zod schema validation rejecting the empty params. ~10-line fix.

**TRACK-CLI-01:** Diagnose mismatch (one of: method-name discrepancy daemon vs CLI; zod schema rejecting empty params; missing IPC method registration in daemon's routeMethod dispatch). Fix and re-test. Smoke: `clawcode mcp-tracker -a fin-acquisition` returns the formatted table.

#### Out of scope

- Async correlation-ID reply path (Phase 999.2 longer-term)
- Discord bridge zombie-connection resilience (separate small phase)
- new-reel skill rebuild (separate, multi-day)

#### Trigger

2026-05-01 — overnight cleanup run. All three issues surfaced during today's session, none individually big enough for own phase, all touching agent-prompt / MCP-lifecycle infrastructure.

#### Requirements

[DSCOPE-01 subagent-prompt scoping flag, DSCOPE-02 spawner wiring, DSCOPE-03 tests, DSCOPE-04 yaml fan-out restore; STALL-01 root cause + fix, STALL-02 warmup-timeout telemetry; TRACK-CLI-01 IPC schema match]

**Plans:** 4/5 plans executed

Plans:
- [x] 106-00-PLAN.md — Wave 0 RED tests: DSCOPE config-strip snapshot, STALL-02 fake-timer warmup-timeout, TRACK-CLI expected-tuple extension
- [x] 106-01-PLAN.md — Wave 1 GREEN DSCOPE: caller-side strip of `delegates` from sourceConfig spread in subagent-thread-spawner.ts (~3 LOC + comment)
- [x] 106-02-PLAN.md — Wave 1 GREEN STALL-02: 60s warmup-timeout sentinel + lastStep tracker inside startAgent (~30 LOC)
- [x] 106-03-PLAN.md — Wave 1 GREEN TRACK-CLI: append `mcp-tracker-snapshot` to IPC_METHODS enum (1 LOC + comment, mirrors commit a9c39c7)
- [x] 106-04-PLAN.md — Wave 2: pre-deploy validation, deploy gate poll (channels silent ≥30 min, 6h cap), ssh deploy on clawdy, smoke (TRACK-CLI table + STALL repro classify A/B/C), restore yaml fan-out (8 agents), SUMMARY (shipped 2026-05-01 autonomous overnight; see 106-04-SUMMARY.md)

**Status:** Shipped 2026-05-01 overnight via `/gsd:autonomous`. Deploy gate satisfied (31 min silence at 23:20 PT). All 3 fixes live: DSCOPE, STALL-02, TRACK-CLI. yaml fan-out restored across 8 agents.

---

### Phase 107: Memory pipeline integrity — dream JSON output enforcement + vec_memories orphan cleanup

**Goal:** Bundle two memory-pipeline integrity bugs reported by Admin Clawdy 2026-05-01. Both daemon-side data integrity issues; same memory subsystem; one ship.

#### Pillar A — Dream pass JSON output enforcement (DREAM-OUT-01..04)

**Symptom:** Dream pass schema validation failed with:
```
dream-result-schema-validation-failed:
  JSON parse failed (Unexpected token 'N', "Noted — co"... is not valid JSON)
```
Haiku (the dream model) returned chat-style prose instead of the structured JSON the pipeline expects. Phase 95's prompt was already tightened in commit `509ff03` (rules like "FIRST character MUST be `{`", "NO markdown fences"); model is ignoring them.

**Fix path:**
1. **DREAM-OUT-01:** Audit `src/manager/dream-prompt-builder.ts` — strengthen rules. Add explicit fallback contract: "If you cannot produce valid JSON for any reason, output `{\"newWikilinks\":[],\"promotionCandidates\":[],\"summary\":\"\",\"errors\":[\"<reason>\"]}` — never plain prose."
2. **DREAM-OUT-02:** Switch to SDK structured-output mode if available (`response_format: { type: "json_schema", schema: <zod-derived> }`). Stronger than prompt-side rules. Confirm SDK v0.2.x supports it.
3. **DREAM-OUT-03:** Validation-failure recovery: when LLM returns invalid JSON, fall back to no-op result instead of throwing. Log warn with offending response prefix. Don't crash the pipeline.
4. **DREAM-OUT-04:** Vitest tests pinning: synthetic LLM returning prose → no-op result, no throw, warn logged. Synthetic LLM returning valid JSON → parsed correctly.

#### Pillar B — vec_memories orphan cleanup on memory delete (VEC-CLEAN-01..04)

**Symptom:** `memories` row deletes don't cascade to `vec_memories` (sqlite-vec virtual table). Orphan embeddings accumulate, bloat the index, can return phantom matches in semantic search. sqlite-vec virtual tables don't support FK constraints (vtab interface limitation), so `memories` and `vec_memories` are decoupled.

**Fix path:**
1. **VEC-CLEAN-01:** Audit all `memories` delete paths (`MemoryStore.deleteById`, `deleteByTag`, `deleteOlderThan`, etc. — find via grep). Each must issue paired `vec_memories` delete in same transaction.
2. **VEC-CLEAN-02:** Transaction wrapper if not already present. Both deletes must be atomic.
3. **VEC-CLEAN-03:** `clawcode memory cleanup-orphans` CLI subcommand: scan `vec_memories` for rowids not in `memories`, delete them. Operator-runnable + auto-callable for one-time recovery + future hygiene.
4. **VEC-CLEAN-04:** Tests: unit test that delete-from-memories also clears vec_memories; integration test that semantic search post-delete doesn't return the deleted memory.

#### Trigger

2026-05-01 — Admin Clawdy report after manual DB cleanup verified DB fix worked but dream pass still failed for separate reason. vec_memories orphans manually patched but root cause persists.

#### Requirements

[DREAM-OUT-01..04, VEC-CLEAN-01..04]

#### Plans

**Plans:** 3/3 plans executed ✅

Plans:
- [x] 107-01-PLAN.md — Pillar A: Dream JSON enforcement (DREAM-OUT-01 fallback envelope + DREAM-OUT-03 warn-level recovery + DREAM-OUT-04 vitest; DREAM-OUT-02 deferred with anchors)
- [x] 107-02-PLAN.md — Pillar B: vec_memories orphan cleanup (VEC-CLEAN-01..04: audit, atomicity, cleanupOrphans method + IPC + CLI subcommand, vitest)
- [x] 107-03-PLAN.md — Wave 2 deploy gate + smoke (deployed 2026-05-01 04:33:49 PDT via rsync + systemctl restart; smoke PASS — dream warn CLEAN, cleanupOrphans CLI PASS + idempotent, 0 historical orphans cleaned)

**Status:** Shipped 2026-05-01 via `/gsd:autonomous`. Operator explicit deploy approval after Wave 1 GREEN. All 7 active requirements completed. DREAM-OUT-02 deferred to future phase (anchors in 107-01-PLAN.md `<deferred>` block).

#### Replaces

- Was Phase 999.16 (dream JSON enforcement) and Phase 999.17 (vec_memories orphan cleanup) in backlog. Bundled and promoted to active sequential because of related subsystem + small individual scope.

---

### Phase 108: Shared 1password-mcp via daemon-managed broker (SHIPPED 2026-05-01)

**Goal:** Pool one shared `1password-mcp` subprocess per unique `OP_SERVICE_ACCOUNT_TOKEN` across agents. In current config, drops 11 instances → 2 (default scope + finmentum scope). Reduces fan-out load against 1Password service-account quota during boot storms + concurrent tool use. Pairs with Phase 104 (boot-time secret cache, shipped) and Phase 999.14/15 (MCP lifecycle, shipped).

**Architecture (operator-approved 2026-05-01):**
- **Transport:** daemon-managed broker (fan-out proxy). Daemon owns the single MCP child per service-account token; agents talk to broker, not directly to MCP child.
- **Keep-alive:** drain immediately on last referencing agent stop. Add TTL keep-warm later if cold-starts hurt.
- **Crash recovery:** auto-respawn pool + per-call failure (in-flight requests fail with structured error, agents retry via existing semantics).
- **Concurrency:** per-agent semaphore (4 concurrent calls per agent).
- **Audit/trace:** broker logs every JSON-RPC with `agent`, `turnId`, `tool` structured fields.

**Trigger:** 2026-04-30 — three concurrent `1password-mcp` processes against same service-account quota during FCC migration + daemon crash-loop boot storm → 1Password long-tail rate-limit blocked all `op read` operations for ~10 minutes.

**Plans:** 6/6 plans executed — LIVE on clawdy

Plans:
- [x] 108-00-PLAN.md — Wave 0 RED: broker test scaffolding + shared fakes (FakePooledChild, FakeBrokerSocketPair) + 6 RED test files for pooled-child / broker / shim-server / mcp-broker-shim CLI / heartbeat / integration
- [x] 108-01-PLAN.md — Wave 1: PooledChild data plane — id rewriter, initialize cache-and-replay, drain-then-SIGTERM lifecycle, types.ts contract module
- [x] 108-02-PLAN.md — Wave 1: OnePasswordMcpBroker control plane (token-keyed pool registry, per-agent semaphore, audit logs, auto-respawn) + ShimServer unix-socket listener
- [x] 108-03-PLAN.md — Wave 1: `clawcode mcp-broker-shim` CLI subcommand — agent stdio ↔ broker socket bridge, mirrors browser-mcp/search-mcp/image-mcp precedent
- [x] 108-04-PLAN.md — Wave 1: daemon boot integration — loader rewire (line 189-200), broker after SecretsResolver, reconciler `__broker:` skip-list, heartbeat mcp-broker check, shutdown ordering
- [x] 108-05-PLAN.md — Wave 2: pre-deploy gauntlet + 30-min channel-silence gate + operator deploy phrase + ssh deploy + 5-check post-deploy smoke + phase SUMMARY (deployed by operator at 06:34 PT after 6 deploy iterations + 5 hot-fixes; LIVE at 07:14 PT)

**Replaces:** Phase 999.9 (BACKLOG). Promoted per renumbering convention from commit `bfd8dfe`.

**Status:** Shipped 2026-05-01. Pool fan-out proven (`agentRefCount=3`), MCP child count dropped ~60% (15 → 6 processes). 5 hot-fixes from live debugging captured in commits `9a1f12d` (broker integration) + `4e755ee` (status update). Closed v2.7 milestone (commit `3f308f0`).

---

### Phase 109: MCP/Secret Resilience bundle — broker observability + orphan reaper + preflight + fleet-stats (SHIPPED 2026-05-03)

**Goal:** Bundle four coherent infrastructure changes addressing the 2026-05-03 fleet incident (cgroup at 97.8% MemoryMax, 4 orphan claude procs invisible to the daemon, host swap exhausted): broker observability, orphan-claude reaper, preflight gating, fleet-stats dashboard endpoint.

**Sub-scopes (all shipped):**
- **109-A** — per-pool 1Password broker rps + throttle counters (`rpsLastMin`, `throttleEvents24h`, `lastRetryAfterSec`); new `clawcode broker-status` CLI; new broker-status IPC method.
- **109-B** — orphan-claude reaper (alert mode default; reap mode behind config flag). Detects claude procs whose ppid is the daemon but absent from `tracker.getRegisteredAgents()`. Hot-reloadable via `defaults.orphanClaudeReaper`. Kill-switch: `CLAWCODE_ORPHAN_CLAUDE_REAPER_DISABLE=1`.
- **109-C** — `clawcode preflight` — blocks unsafe restarts (cgroup memory >80% or any broker tool calls inflight).
- **109-D** — fleet-stats IPC + `/api/fleet-stats` dashboard endpoint. cgroup memory pressure, claude proc drift, per-MCP-pattern aggregate RSS.

**Trigger:** 2026-05-03 operator-reported fleet incident — host swap exhausted, daemon could not see 4 claude processes.

**Status:** Shipped 2026-05-03 (commit `8880fe8`). Linux-only signals (cgroup, /proc) degrade to null on hosts without them. PoolStatus extensions are optional fields → existing 108 heartbeat consumer unchanged. /api/status payload byte-stable (FleetStatsData lives at a new endpoint, not folded into DashboardState). 87 tests passing across 7 affected suites.

**Note on number reuse:** the original Phase 109 ROADMAP entry was scoped as "Image ingest pipeline — local resize + Haiku 4.5 vision pre-pass". That pending scope was renumbered to **Phase 113** when this resilience bundle shipped under the 109 commit tag. See Phase 113 below.

---

### Phase 110: MCP memory reduction — foundational scaffolding (Stage 0a SHIPPED 2026-05-03; later stages active)

**Goal:** Multi-stage MCP memory-reduction effort. Stage 0a (foundational scaffolding, no behavior change) lands the schema + observability + CLI surface for the upcoming shim-runtime swap (Stage 0b) and broker generalization (Stage 1).

**Stage 0a (SHIPPED 2026-05-03, commit `5aa5ab6`, PR #6):**
- **Schema additions** (`src/config/schema.ts`):
  - `defaults.shimRuntime.{search,image,browser}` — per-shim runtime selector. Stage 0a accepts only "node"; Stage 0b widens the enum and lands the alternate-runtime spawn path.
  - `defaults.brokers` — server-id keyed dispatch table for typed multi-server pools. Schema only; Stage 1a wires the broker class to read this map.
- **CLI alias** (`src/cli/commands/mcp-broker-shim.ts`):
  - `mcp-broker-shim --type <serverType>` as the broker generalization key (preferred form going forward).
  - Legacy `--pool <name>` retained as alias indefinitely; `--type` wins when both passed.
  - `normalizeServerType()` exported for unit testing.
  - Every shim log line now carries a `serverType` field (journalctl greps by serverType work day one).
- **Observability** (`src/dashboard/types.ts`, `src/manager/fleet-stats.ts`, `src/manager/daemon.ts`):
  - `McpRuntime` classification ("node" | "static" | "python" | "external") on every mcpFleet entry.

**Pending stages:**
- **Stage 0b** — shim-runtime swap (widen enum, land alternate-runtime spawn path) — PLANNED 2026-05-05, 9 plans / 6 waves
- **Stage 1a** — broker generalization (wire broker class to read `defaults.brokers` dispatch table)
- **Stage 1b+** — TBD per memory-reduction findings

**Stage 0b Requirements:** [0B-RT-00, 0B-RT-01, 0B-RT-02, 0B-RT-03, 0B-RT-04, 0B-RT-05, 0B-RT-06, 0B-RT-07, 0B-RT-08, 0B-RT-09, 0B-RT-10, 0B-RT-11, 0B-RT-12, 0B-RT-13]

**Plans:** 5/9 plans executed
- [x] 110-00-PLAN.md — Wave 0 spike + kill-switch gate (minimal Go shim, RSS measurement on admin-clawdy)
- [x] 110-01-PLAN.md — Daemon `list-mcp-tools` IPC method (ships first, before any Go shim builds against it)
- [x] 110-02-PLAN.md — Schema enum widening + loader auto-inject + fleet-stats classifier
- [x] 110-03-PLAN.md — CI Go build matrix + npm prebuild-install bundling
- [x] 110-04-PLAN.md — Search Go shim implementation (IPC client + Register + main wiring)
- [x] 110-05-PLAN.md — Search rollout (admin-clawdy canary flipped 2026-05-06; smoke confirmed; 4-agent expanded canary same day)
- [x] 110-06-PLAN.md — Image Go shim implementation + rollout (code on master 2026-05-06; prod binary active; canary on 4 agents)
- [x] 110-07-PLAN.md — Browser Go shim implementation + rollout (code on master 2026-05-06; prod binary active; canary on 4 agents)
- [ ] 110-08-PLAN.md — Cleanup decision (keep Node fallback OR remove) + rollback drill (remaining fleet: fin-acquisition, fin-research, finmentum-content-creator, fin-tax, fin-playground)

**Status:** Stage 0a SHIPPED 2026-05-03; Stage 0b PLANNED 2026-05-05 (9 plans, 6 waves, target ≥ 2.7 GiB RSS savings); Stage 1a active. No production behavior changes from Stage 0a; every dial defaults to current behavior.

**Note on number reuse:** the original Phase 110 ROADMAP entry was scoped as "Retroactive sequential renumbering for shipped 999.x items". That backlog scope was renumbered to **Phase 114** when this MCP memory-reduction work shipped under the 110 commit tag. See Phase 114 below.

---

### Phase 113: Image ingest pipeline — local resize + Haiku 4.5 vision pre-pass (SHIPPED — commit `5dfac40`, 2026-05-07)

**Goal:** Cut response latency and token cost on screenshot-heavy turns (operator + Ramy share frequent screenshots). Two layered optimizations to the image-ingest path: (1) local resize before forwarding to Claude, (2) parallel Haiku 4.5 vision pre-pass that produces a structured `<screenshot-analysis>` text block, letting the main agent skip vision entirely on the dominant case (chat screenshots, error messages, dashboards — text-extraction-shaped queries).

**Approach (operator-approved 2026-05-01):**

1. **Local resize-on-ingest.** When a Discord attachment is an image, resize to ≤1568px longest side (Anthropic's documented vision sweet spot) using `sharp`. Anthropic resizes server-side anyway and bills you for the original — local resize cuts upload bandwidth, latency, and token cost ~30-60% for typical screenshots with zero user-visible quality loss.

2. **Parallel Haiku 4.5 vision pre-pass.** When an image arrives, fire a Haiku call with a structured extraction prompt ("extract all visible text verbatim, describe layout/UI elements, flag highlights/errors") in parallel with message routing. Inject the result as a `<screenshot-analysis>` block into the main agent's message context. By default, drop the original image from the main agent's context — the analysis is sufficient for the dominant case, the main model (Sonnet/Opus) processes only text and runs faster.

3. **Per-agent `vision.preserveImage` flag (default false).** For agents whose work is design/visual (color, layout, UI feedback questions), opt-in to keep the image in main agent context alongside the analysis. Admin Clawdy + Ramy's flow stay default-off.

4. **Graceful fallback on Haiku failure.** If Haiku times out or errors, fall through to today's behavior: send image directly to main agent. Agent path that exists today is preserved as the fallback so this is purely additive — no failure mode is introduced that doesn't already exist.

5. **Metrics.** Log per-image-bearing-turn token + latency delta so the win is verifiable in production after deploy.

**Trigger:** 2026-05-01 operator request — "Ramy and I both share a lot of screenshots to provide the agents with context, if we could improve performance and efficiency with that, it would probably help."

**Why Haiku pre-pass over OCR (Tesseract):** stays within Anthropic ecosystem, no new binary dependencies, no version drift risk, no fail points beyond what already exists.

**Token + speed math (typical chat screenshot):**
- Status quo: Sonnet/Opus does ~1500 input tokens of vision + reasoning → ~3-5s response
- Phase 113: Haiku does ~1500 vision tokens (5x cheaper than Sonnet, ~20x cheaper than Opus) → returns ~300-500 token structured text → main agent processes JUST text → **~40-60% latency drop AND ~50-70% token cost drop on screenshot-heavy turns**

**Requirements:** TBD — likely 6-8 (resize, Haiku-call wiring, analysis-block injection, preserveImage config, fallback path, metrics, tests).

**Plans:** 0 plans (TBD — likely 3 plans: resize substrate, Haiku pre-pass + analysis injection, deploy gate + metrics).

**Originally numbered:** Phase 109 (renumbered 2026-05-05 after the 109 commit tag was used for the MCP/Secret Resilience bundle).

---

### Phase 114: Retroactive sequential renumbering for shipped 999.x items (BACKLOG — low priority, renumbered from original Phase 110)

**Goal:** Cosmetic cleanup — rename the SHIPPED `999.x` phase directories and ROADMAP entries to next-sequential numbers, preserving git-history searchability via redirect notes. Resolves the long-running visual mismatch where shipped work kept its backlog parking-lot number instead of being promoted to a clean sequential phase ID.

**Scope (SHIPPED 999.x items eligible for rename, as of 2026-05-05):**
- 999.1 (Agent output directives, SHIPPED 2026-04-29)
- 999.2 (a2a refactor, SHIPPED 2026-04-29)
- 999.3 (delegateTo, SHIPPED 2026-04-29)
- 999.6 (pre-deploy snapshot/restore, SHIPPED 2026-05-01)
- 999.8 (dashboard graph fixes, SHIPPED 2026-04-30)
- 999.12 (cross-agent IPC + heartbeat inbox, SHIPPED 2026-05-01)
- 999.13 (delegate map + timezone, SHIPPED partial 2026-04-30)
- 999.14 (MCP child lifecycle, SHIPPED 2026-04-30)
- 999.15 (MCP PID tracking, SHIPPED 2026-04-30)
- 999.21 (`/get-shit-done` consolidation, SHIPPED 2026-05-01)
- 999.22 (`mutate-verify` directive, SHIPPED 2026-05-01)
- 999.24 (sudoers expansion, SHIPPED 2026-05-01)
- 999.25 (boot wake-order priority, SHIPPED 2026-05-01)
- 999.26 (broker token-sticky-drift, SHIPPED 2026-05-01)
- 999.27 (env-resolver oscillation, SHIPPED 2026-05-01)
- 999.28 (mcp-server-mysql grandchild leak, SHIPPED 2026-05-02)
- 999.29 (dream-pass adapter wiring, SHIPPED 2026-05-02)
- 999.30 (subagent relay on work-completion, SHIPPED 2026-05-04 — see Backlog entry; was tagged as `999.25` in commits, renumbered)
- 999.31 (`/ultra-plan` + `/ultra-review` subcommands, SHIPPED 2026-05-04)
- 999.32 (GSD `/gsd-do` consolidation, SHIPPED 2026-05-04)
- 999.33 (preResolveAll concurrency bound, SHIPPED 2026-05-04)

**Approach (sketch):**
1. Pick a renumbering scheme (e.g., chronological-by-ship-date → 115, 116, 117, ...) OR (e.g., bundle-by-domain → group related ones together).
2. Rename each `.planning/phases/999.X-<slug>/` directory to `.planning/phases/<NEW>-<slug>/` via `git mv`.
3. Update each ROADMAP entry's `### Phase 999.X:` header to `### Phase <NEW>:` and add a `**Originally numbered:** 999.X` line for traceability.
4. **DO NOT** rewrite historical commit messages — they reference `999.X-NN` as-is, and rewriting would break git-history searchability without fixing anything real. Future commits naturally reference the new sequential numbers.
5. **DO NOT** move `.planning/quick/` task IDs — those are immutable and use a separate YYMMDD-xxx scheme.
6. **DO NOT** rename BACKLOG-status 999.x items (999.4, 999.5, 999.7, 999.18-PARTIAL, 999.19, 999.20, 999.23) — those should renumber when *promoted* via `/gsd:review-backlog`, which is the proper workflow.

**Why "for when usage resets":** pure cosmetic cleanup, ~30-60 min of mechanical work. Worth doing when API budget is fresh and there's no urgent feature work or production fire competing for context. Lowest priority on the backlog.

**Originally numbered:** Phase 110 (renumbered 2026-05-05 after the 110 commit tag was used for the MCP memory-reduction work).

---

## Backlog

Backlog items live outside the active phase sequence. Promote with `/gsd:review-backlog` when ready to plan, or use `/gsd:discuss-phase 999.x` to explore further.

### Phase 999.1: Agent output directives — freshness, derivative work, trust override, table avoidance (SHIPPED 2026-04-29)

**Goal:** Counter-instruct Claude Code's default behaviors that misfire in this trusted-operator workspace. Four directives shipped together as one coherent injection system into agent system context (CLAUDE.md, per-agent SOUL.md, subagent threadContext) — addressing the same architectural concern: model defaults need adjustment for this environment.

The four directives:

1. **Time-aware live websearch (FRESH-*).** Inject today's date + a rule that anything dated within ~6 months OR matching time-sensitive categories (prices, laws, financials, regulations, current events) must be checked via `web_search` before answering. Don't anchor on the training-cutoff snapshot. Search MCP is already auto-injected fleetwide; this is purely the prompt-side push to use it.

2. **Subagent derivative-work mandate (DERIV-*).** When a parent agent delegates via `spawn_subagent_thread` with a `task`, the subagent inherits a permission clause clarifying that creating new files, deriving parameterized templates from examples, generating code, and producing artifacts are all in-scope. The `~/.claude/CLAUDE.md` "don't add features beyond what's requested" rule applies to scope creep on USER requests, not to fulfilling delegated tasks. Subagent currently inherits parent SOUL + 6 lines of threadContext (subagent-thread-spawner.ts:401); extend that block.

3. **Trusted-operator disclaimer suppression (TRUST-*).** Counter-instruct Claude's reflex against the platform-level "authorized security testing" prompt. Inject: "this workspace is owned by a single trusted operator. Do not prefix responses with disclaimers like 'this is not malware' / 'this is for legitimate purposes' / 'this is authorized work'. Skip all CYA language. The operator knows the context."

4. **Markdown tables → bullets in Discord (TABLE-*).** Companion to the structural webhook-wrap (Phase 100-fu + quick `260429-ouw`): steer agents to PREFER bullets / definition lists / inline prose over markdown tables when the content fits, since Discord doesn't render true tables (the wrap-as-monospace fence is the safety net for cases where tabular IS the right format). Markdown-table-wrap.ts already documents this directive as "deferred" (Phase 100-fu commit comment). Land it here.

**Trigger:** 2026-04-29 — three separate observations during this session:
- Operator reported agents emitting 2025-anchored answers (stale training cutoff)
- Operator reported subagent refusing derivative code-generation work (over-applying "don't add features" rule)
- Operator reported agents prefacing responses with "this is not malware" disclaimers (over-applying platform safety prompt)
- Plus the deferred no-markdown-tables-in-discord directive that's been sitting in markdown-table-wrap.ts comments since Phase 100-fu

All four are the same architectural concern: counter-instruct platform/default model behavior via SOUL injection. Coherent design > ad-hoc patches.

**Requirements:** [FRESH-01, FRESH-02, FRESH-03, DERIV-01, DERIV-02, DERIV-03, TRUST-01, TRUST-02, TABLE-01, TABLE-02] — locked-additive into `src/config/schema.ts` `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` (Phase 94 D-10 rail). Per D-DR-04 the subagent-thread-spawner.ts pathway is NOT modified — fleet-wide directive replaces subagent-only injection.

**Plans:** 1/1 plans complete

Plans:
- [x] 999.1-01-PLAN.md — TDD landing of all 4 directive entries (Task 1 RED: 4 describe blocks + 11-key membership pin; Task 2 GREEN: 4 Object.freeze entries verbatim from research §Recommended Directive Text)

**Status:** Shipped 2026-04-29. Locked-additive entries landed in `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` (Phase 94 D-10 rail). See 999.1-VERIFICATION.md. Note: original "promotion target Phase 104" plan was superseded — Phase 104 was used for the daemon-side op:// secret cache (999.10 promotion).

### Phase 999.2: a2a refactor — rename + sync-reply + correlation IDs (SHIPPED 2026-04-29, partial — async correlation-ID path deferred)

**Goal:** Fix the agent-to-agent comms architectural debt surfaced 2026-04-29 when admin-clawdy → fin-acquisition produced no reply back. Three concerns:

1. **Rename (Option C — full):** `SessionManager.sendToAgent` → `dispatchTurn` (7 internal call sites). MCP tool `send_message` → `ask_agent`. MCP tool `send_to_agent` → `post_to_agent`. IPC methods aligned. Backwards-compat aliases shipped to avoid agent breakage during transition.
2. **v2 sync-reply:** `ask_agent` returns target's response in tool result so caller's LLM has it in context. New `mirror_to_target_channel` flag posts Q+A as webhook embeds in target's channel for visibility. Stop swallowing `sendToAgent` errors.
3. **Async correlation IDs (longer-term):** alternative non-blocking path where caller fires-and-forgets, target's reply auto-posts back to caller's channel via correlation-ID lookup. Bigger redesign — needs reply hook in turn-dispatcher and per-message tracking.

**Trigger:** 2026-04-29 — operator's admin-clawdy → fin-acquisition Q&A test surfaced that `send_message` MCP wrapper silently discards target's response. Diagnosed in this session.

**Requirements:** [A2A-01, A2A-02, A2A-03, A2A-04, A2A-05, A2A-06, A2A-07, A2A-08, A2A-09, A2A-10, A2A-11, A2A-12] — see 999.2-{01,02,03}-PLAN.md.

**Plans:** 3/3 plans complete

Plans:
- [x] 999.2-01-PLAN.md — Rename SessionManager.sendToAgent → dispatchTurn (7 production call sites + ~14 test mocks + 4 doc-comment files; pure rename, no behavior change). Wave 1.
- [x] 999.2-02-PLAN.md — Rename MCP tools (send_message → ask_agent, send_to_agent → post_to_agent) and IPC methods (send-message → ask-agent, send-to-agent → post-to-agent) with back-compat aliases (canonical names registered FIRST per D-RNX-04). Wave 2.
- [x] 999.2-03-PLAN.md — v2 sync-reply behavior on ask_agent: surface target's reply in tool-result text (fixes 2026-04-29 smoking-gun bug), mirror_to_target_channel flag for webhook embeds, error propagation (remove silent catch). Wave 3.

**Status:** Shipped 2026-04-29 — rename + back-compat aliases + v2 sync-reply landed; async correlation-ID path remains deferred for a future phase. See 999.2-VERIFICATION.md. Note: original "promotion target Phase 106" plan was superseded — Phase 106 was used for the agent-context-hygiene bundle (delegate scoping fix + research stall + CLI hot-fix).

### Phase 999.3: Specialist subagent routing via delegateTo (SHIPPED 2026-04-29)

**Goal:** Let any agent delegate research/coding work to a dedicated standing specialist agent (`fin-research` for fin-* agents, `research` for non-fin) and have the streamed output land in a Discord thread in the **caller's** channel, with autoRelay summary back to caller's main channel.

**Approach:** extend existing `spawn_subagent_thread` MCP tool with `delegateTo: <agent_name>` param. When set, the spawned subagent inherits the target agent's config (model, soul, identity, skills, mcpServers) instead of the caller's. Thread is created in the caller's channel. Existing autoRelay infrastructure (Phase 99-M) handles the summary.

**Phase 2 extension** (not in scope for first iteration): per-agent `specialists: { research: <name>, coding: <name> }` config in `clawcode.yaml`, plus a `consult_specialist(role)` convenience tool that resolves to the right standing agent automatically.

**Trigger:** 2026-04-29 — operator wants admin-clawdy + fin-acquisition to delegate elevated-thinking research/coding to fin-research / research standing agents with thread streaming.

**Requirements:** [SPEC-01, SPEC-02, SPEC-03, SPEC-04, SPEC-05, SPEC-06, SPEC-07] — see 999.3-01-PLAN.md.

**Plans:** 1/1 plans complete

Plans:
- [x] 999.3-01-PLAN.md — RED+GREEN delegateTo branch in spawnInThread + 4-surface fan-through (types → spawner → daemon IPC → MCP tool); 10 new tests (DEL-01..DEL-10); recursion-guard invariant preserved.

**Status:** Shipped 2026-04-29. `delegateTo` parameter live on `spawn_subagent_thread` MCP tool, IPC handler, and spawnInThread; 4-surface fan-through complete with 10 DEL-01..DEL-10 tests. See 999.3-VERIFICATION.md. Note: original "promotion target Phase 105" plan was superseded — Phase 105 was used for trigger-policy default-allow + QUEUE_FULL coalescer storm fix. Follow-up gaps captured in 999.18 (relay reliability), 999.19 (cleanup + memory consolidation + delegate-channel routing), 999.22 (soul guard).

### Phase 999.4: /clawcode-usage accuracy fixes (SHIPPED 2026-05-01)

**Goal:** Fix two bugs in Phase 103 Plan 03's `/clawcode-usage` embed exposed during live test on 2026-04-29:

1. **`resetsAt` unit mismatch.** SDK `SDKRateLimitInfo.resetsAt` is documented as ms epoch but actually arrives as **seconds** epoch from the OAuth Max session. `formatDistanceToNow` treats it as ms, producing wildly wrong reset times (e.g. "in 55 years"). Fix: detect+normalize at the RateLimitTracker boundary OR at the renderer boundary. Tests must pin both seconds-epoch and ms-epoch inputs.
2. **`utilization` derive when undefined.** SDK sometimes sends `status: "allowed"` + `resetsAt` + overage state without `utilization`. Renderer falls back to `n/a` even when other fields imply state. Investigate whether `utilization` can be derived from `surpassedThreshold` or aggregated `tokens_in/out` against subscription tier.

**Trigger:** 2026-04-29 live test post Phase 103 deploy — `/clawcode-usage` rendered "5-hour session — 🟢 \`──────────  n/a\` · resets in about 1 hour" when SDK had clearly returned a populated rate_limit_event.

**Status:** Shipped 2026-05-01 (local repo, deploy held). RateLimitTracker boundary normalization: `normalizeEpochToMs(value < 1e12 ? value*1000 : value)` applied to `resetsAt` + `overageResetsAt` in `record()`. Heuristic safe both ways — ms-epoch values from 2001+ are >= 1e12 so they pass through unchanged. Utilization derivation: when SDK omits `utilization`, derive from `status` (`rejected` → 1.0) + `surpassedThreshold` (`allowed_warning` → threshold as lower bound). Tests: 8 new (3 epoch normalization + 1 undefined passthrough + 4 utilization derivation), 19/19 pass total.

### Phase 999.5: /clawcode-status finish-up — Fallbacks + remaining no-source fields (BACKLOG)

**Goal:** Wire the last honest-`n/a` items in `/clawcode-status` once data sources exist, OR document them permanently as "no source" with an explicit comment. Currently the only `n/a` line is `🔄 Fallbacks: n/a` (Phase 103 Plan 01 left as honest-n/a — Research §11 noted no current source for fallback count). After production runs in for a few days, audit for any other fields that settle into having no source and either wire them or convert them to documented permanent-n/a.

**Trigger:** 2026-04-29 — Phase 103 closure noted Fallbacks as the only honest-n/a remaining; user wants to revisit after production observation period.

**Requirements:** TBD — likely 2-3.

**Plans:** 0 plans (TBD — 1 plan when promoted)

**Promotion target:** active milestone, can wait until production has been observed for ~1 week.

### Phase 999.6: Auto pre-deploy snapshot + post-deploy restore of running-agent state (SHIPPED 2026-05-01)

**Goal:** Make every production deploy preserve the runtime list of running agents and restore them on daemon boot, independent of static `autoStart` config. Currently `autoStart=false` agents that an operator manually started for the day get lost across a `clawcode update --restart` because the daemon honors only the static config on boot.

**Approach (sketch):**

1. New `snapshot-running-agents` IPC method (or auto-fire on `stop-all` IPC) writes `/home/clawcode/.clawcode/manager/pre-deploy-snapshot.json` with `{ snapshotAt, runningAgents: [name, sessionId?, ...] }`.
2. `clawcode update` calls the snapshot before `stop-all` (or `stop-all` does it implicitly).
3. Daemon boot reads the snapshot if it exists:
   - For each name in the snapshot, override the static `autoStart` flag and start the agent
   - After all listed agents start (or fail), DELETE the snapshot so the next normal restart honors `autoStart` config again
4. CLI affordance: `clawcode update --restart` becomes a one-shot "save state, deploy, restore state" command.

**Trigger:** 2026-04-29 — operator pain during today's two prod deploys: `autoStart=false` agents that were running (e.g., research-clawdy, fin-research) didn't come back automatically, requiring manual restart.

**Requirements:** [SNAP-01, SNAP-02, SNAP-03, SNAP-04, SNAP-05]

**Plans:** 2/3 plans executed

Plans:
- [x] 999.6-00-PLAN.md — Wave 0 RED tests: snapshot-manager unit + daemon source-grep wiring + schema field
- [x] 999.6-01-PLAN.md — Wave 1 GREEN: implement src/manager/snapshot-manager.ts, wire daemon shutdown writer + boot reader, add preDeploySnapshotMaxAgeHours to defaultsSchema
- [x] 999.6-02-PLAN.md — Wave 2 deploy gate: validated end-to-end in production alongside 999.12 (commit 831e48a)

**Status:** Shipped 2026-05-01. Snapshot manager implemented, daemon wired (shutdown writer + boot reader), schema field added, validated end-to-end in production.

### Phase 999.7: Context-audit telemetry pipeline restoration + tool-call latency audit (PARTIAL — context-audit shipped 2026-05-01, tool-call profiling still open)

**Goal:** Two related observability gaps surfaced during the 2026-04-29 health audit:

1. **`clawcode context-audit` returns `sampledTurns: 0`** for all agents on prod — the per-turn per-section token-count telemetry pipe (Phase 1.7 Plan 03 infrastructure) isn't capturing data. The CLI infrastructure works, the data table exists, but no writes are happening. Investigate where the write-side broke.
2. **Tool-call p95 latency is 216-238s** (Admin Clawdy + fin-acquisition). Not directive-related (Phase 104 cache behavior is healthy at 70-77% hit rate post-deploy). This is MCP/browser/search roundtrip time. Worth profiling per-tool to see whether specific tools dominate the tail.

**Trigger:** 2026-04-29 — operator health audit before Phase 106 deploy. Memory graph linking confirmed healthy (527-1426 memories per agent, 4.6K-9.6K links, auto-linker active). Cache behavior healthy. But context-audit observability is dead and tool latency is slow.

**Status (2026-05-01):** Item 1 SHIPPED (local repo, deploy held). Root cause: `session-config.ts` called `assembleContext` (untraced) instead of `assembleContextTraced`. The traced wrapper is a no-op without a Turn — buildSessionConfig had no Turn to thread, so per-section `section_tokens` metadata was never written. Fix: added `traceCollector` to SessionConfigDeps; wired from session-manager.ts via `this.memory.traceCollectors.get(agentName)`; buildSessionConfig now opens a synthetic `bootstrap:<agent>:<ts>` Turn around `assembleContextTraced` and ends it with status `success`/`error`. Result: one trace row per session start (not per-turn — that's a separate refactor) with full section_tokens populated, unblocking `clawcode context-audit` reporting. Item 2 (tool-call p95 profiling) still open — needs a separate quick task once item 1's data is in production.

**Plans:** 0 plans (item 1 shipped via direct edit; item 2 TBD when promoted)

**Side-finding (informational, not blocking):** Prefix-hash didn't visibly change at the Phase 104 deploy boundary (still `92b7...` from Phase 103). Either Phase 104 directives are in a part of the prefix excluded from the hash computation, or they're landing in a different position than expected. Cache behavior + token telemetry confirm the directives ARE in the prompt, but understanding why the hash is stable across the deploy boundary is worth a quick investigation when this phase opens.

### Phase 999.8: Dashboard knowledge-graph fixes — node cap + tier colors + tier maintenance (SHIPPED 2026-04-30)

**Goal:** Three bugs/gaps surfaced 2026-04-29 when operator opened the knowledge-graph dashboard:

1. **Hardcoded 500-node cap** (`src/manager/daemon.ts:5927` — `LIMIT 500` in `memory-graph` IPC handler). fin-acquisition has 1,434 memories; user only sees 500. Admin Clawdy has 534; user sees 500. Cap truncates >65% of one agent's graph. Fix: remove the cap or make it configurable with a sane default (e.g. 5000) and add lazy-load/pagination if perf becomes a concern at high counts.

2. **No color differentiation for warm vs cold tiers** (`src/dashboard/static/graph.html:421-425`). Current `nodeClr` only emits 3 colors: grey (orphan), red (hot), purple (everything else — both warm AND cold lumped together). User can't visually distinguish active-context warm memories from archived cold ones. Fix: emit a distinct color per tier (hot/warm/cold) + add a legend.

3. **Tier maintenance appears broken or never wired** — production data shows almost everything stuck at "warm":
   - Admin Clawdy: 534 warm, 0 hot, 0 cold
   - fin-acquisition: 1,433 warm, 1 hot, 0 cold
   
   Per Phase 1.1 design: hot = active context (~10-50 memories), warm = searchable, cold = archived (grows over time). Reality: zero archived, virtually no hot. Either (a) the tier-promotion/demotion heartbeat isn't running, (b) it runs but never matches anything, or (c) tier maintenance was never built. Investigation required during planning.

**Trigger:** 2026-04-29 operator dashboard inspection during Phase 106 deploy queue — surfaced both the truncation cap and the missing color tier visualization.

**Requirements:** 12 — CAP-01, CAP-02, CAP-03, CAP-04, COLOR-01, COLOR-02, HB-01, HB-02, HB-03, HB-04, HB-05, HB-06

**Plans:** 3/3 plans complete

Plans:
- [x] 999.8-01-PLAN.md — Lift 500-node cap on memory-graph IPC (default 5000, optional `limit` clamped [1, 50000]) — CAP-01..CAP-04
- [x] 999.8-02-PLAN.md — 4-color tier palette (hot/warm/cold/orphan) + top-right legend with live counts on the dashboard graph — COLOR-01, COLOR-02
- [x] 999.8-03-PLAN.md — Restore heartbeat-check discovery via static `CHECK_REGISTRY` (11 modules); fixes silent `checkCount:0` in production — HB-01..HB-06

**Status:** Shipped 2026-04-30. All 3 plans landed: memory-graph cap raised, 4-color tier palette + legend, heartbeat-check static registry restored. See 999.8-VERIFICATION.md. Note: original "promotion target Phase 107" plan was superseded — Phase 107 was used for the memory-pipeline-integrity bundle (dream JSON enforcement + vec_memories orphan cleanup, originally 999.16/999.17).

### Phase 999.9: Shared 1password-mcp by service-account scope (PROMOTED to Phase 108)

**Goal:** Pool one shared `1password-mcp` subprocess per unique `OP_SERVICE_ACCOUNT_TOKEN` across agents instead of spawning a fresh instance per agent. In current config, this drops 9 instances → 2 (default account + finmentum scope), reducing memory + fd + process count and capping fan-out load against the 1Password read API during boot storms and concurrent tool use.

**Why now:** Surfaced 2026-04-30 during FCC migration — three concurrent `1password-mcp` processes were running against the same service-account quota; combined with a daemon crash-loop that re-resolved every `op://` reference per restart, our service account hit a long-tail rate-limit window that blocked ALL read operations for ~10 minutes. Per-token pooling is the structural fix; daemon-side secret cache (separate phase) is the boot-time fix.

**Requirements:** TBD — to be derived in `/gsd:discuss-phase 999.9`.

**Open questions to settle in discuss-phase:**
- Does the MCP protocol natively support multi-client over a single stdio transport, or do we need a fan-out proxy that brokers session IDs?
- Shutdown ordering when the last agent referencing a pool exits — drain immediately or keep warm for a TTL?
- Blast radius — an MCP crash now affects N agents instead of 1. What's the recovery story (restart pool, fail individual tool calls, both)?
- Per-tool concurrency limits inside the shared instance to keep one chatty agent from starving the others.
- Per-agent audit/trace continuity when N agents share one MCP — how do tool-call traces stay attributable to the originating Turn?

**Plans:** 0 plans (TBD — promote with `/gsd:discuss-phase 999.9` to settle scope, then `/gsd:plan-phase 999.9`)

**Promotion target:** active milestone, sequence after Phase 104 daemon-side secret cache + retry/backoff (already shipped) — that fix removed boot-time pressure; this phase focuses purely on the runtime pooling design.

### Phase 999.12: Cross-agent IPC channel delivery + heartbeat inbox timeout (SHIPPED 2026-05-01)

**Goal:** Two operator-visible orchestration / observability fixes split out of the original 105 scope to keep that phase tightly focused on infrastructure perf.

1. **Cross-agent IPC `dispatchTurn()` returns response to caller, never posts to target's bound Discord channel.** Phase 999.2 renamed `sendToAgent` → `dispatchTurn` and the Discord-bridge path uses `streamFromAgent` (which DOES post). At 2026-04-30 09:14:57 admin-clawdy invoked `dispatchTurn` → fin-acquisition with 971 chars; fin-acq replied 1087 chars at 09:15:55 — visible in caller's tool result, **never posted in #finmentum-client-acquisition**. Mirror the Phase 100 follow-up `triggerDeliveryFn` pattern: add an optional delivery callback that routes the response to the target agent's bound channel via webhook (preferred) → bot-direct fallback. Caller-only (RPC) semantics stay the default; channel delivery is opt-in via flag (`mirror_to_target_channel: true` from Phase 999.2 backlog text).

2. **Heartbeat inbox check 10s timeout is too tight for cross-agent turns.** At 2026-04-30 09:15:07 (10s after dispatchTurn started) the inbox check logged `"heartbeat check critical"` while fin-acq was mid-turn; the turn completed normally at 09:15:55. Either bump timeout to ≥60s, gate the check on whether the agent is actively responding (use `SerialTurnQueue.hasInFlight()`), or move to event-driven (subscribe to `agent responded` rather than poll inbox).

**Trigger:** Split out of original 105 during 2026-04-30 prioritization — 105 re-scoped to POLICY + coalescer (highest-impact perf/functionality), these two items deferred since they have lower blast radius.

**Requirements:** [IPC-01 deliveryFn for dispatchTurn, IPC-02 mirror flag, IPC-03 webhook→bot fallback parity with triggerDeliveryFn; HB-01 inbox timeout bump, HB-02 active-turn awareness] — see 999.12-PLAN.md when planned.

**Plans:** 2/3 plans executed

Plans:
- [x] 999.12-00-PLAN.md — Wave 0 RED tests: bot-direct fallback (IPC-02), inbox skip + timeout override (HB-01/02)
- [x] 999.12-01-PLAN.md — Wave 1 GREEN: extend handleAskAgentIpc with bot-direct fallback; HeartbeatConfig.inboxTimeoutMs + active-turn skip (IPC-01..03, HB-01, HB-02)
- [x] 999.12-02-PLAN.md — Wave 2 deploy gate + clawdy ship + journalctl smoke for both pillars (commit 831e48a)

**Status:** Shipped 2026-05-01. Bot-direct fallback for ask-agent response mirror and heartbeat inbox timeout both validated end-to-end in production alongside 999.6 snapshot.

### Phase 999.13: Extendible specialist delegate map + agent-context timezone rendering (SHIPPED 2026-04-30, partial — DSCOPE bug rolled back, fix in 106)

**Goal:** Two "agent context hygiene" pillars in one phase. Both are surface-level prompt formatting that affects how the LLM reasons; same touch points (session-prompt-builder + daemon serialization); ship together.

#### Pillar A — Extendible specialist delegate map

Per-agent typed map of `{ specialty: targetAgentName }` injected as a delegation directive at session boot. Specialty keys are free-form strings — no enum lock-in — so future specialties (coding, legal, tax, devops, etc.) drop in via yaml without code changes.

Schema (`src/config/schema.ts` agentSchema):
```ts
delegates: z.record(z.string().min(1), z.string().min(1)).optional()
```
`superRefine` validates every value points to a configured agent name.

Prompt injection (session-prompt-builder): when `agent.delegates` is non-empty, inject canonical block:
```
## Specialist Delegation
For tasks matching a specialty below, delegate via the spawn-subagent-thread skill:
- research → {delegates.research}
- coding → {delegates.coding}
- ...
Verify the target is at opus/high before delegating; if mismatch, surface to operator and stop. The subthread posts its summary back to your channel when done.
```
Block omitted when delegates is unset/empty.

Initial yaml fan-out (research only; future specialties added by operator over time):
- **finmentum group** → `delegates: { research: fin-research }`: fin-acquisition, fin-tax, fin-playground, finmentum-content-creator
- **non-finmentum group** → `delegates: { research: research }`: test-agent, personal, general, projects
- **Admin Clawdy:** leave alone — already has hand-rolled SOUL contract; overlapping injection would be noise.

Out of scope: deterministic daemon-side router (intent classifier → forced delegation). Directive is prompt-side; model recognizes and picks. Acceptable tradeoff.

#### Pillar B — Agent-context timezone rendering

ClawCode daemon currently serializes `ts` fields as ISO UTC strings when building agent context (heartbeats, schedules, restart greetings, message history, memory snapshots). Host (clawdy) runs in PDT but agents see `2026-04-30T18:32:51Z` everywhere and have to mentally subtract 7h on every reference. Today's Admin Clawdy session added a `CLAUDE.md` rule "always convert ts UTC to PT before quoting time" as a workaround — that's prompt-tax on every turn. Root fix is daemon-side: emit times in operator-local TZ at the serialization boundary.

Scope:
- Identify all daemon paths that serialize `ts` into agent-visible context. Likely sites: `restart-greeting.ts`, heartbeat builder, scheduler-source event payload, conversation history compactor, memory snapshot writer.
- Convert ISO UTC → operator-local TZ at serialization boundary. Format: `"2026-04-30 11:32:51 PDT"` (human-readable + TZ abbreviation — bare local time without TZ is ambiguous on DST boundaries).
- Add `defaults.timezone: z.string().optional()` config knob (IANA TZ name, e.g. `"America/Los_Angeles"`). Default falls back to host TZ via `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Internal storage / DB / structured event keys stay UTC — only agent-visible rendering changes. Presentation-layer only.

Out of scope: per-user TZ preferences (operator-A in PT, operator-B in ET); historical session re-rendering — forward-going only.

**Trigger:** 2026-04-30 — operator's "should fin-acq auto-spawn fin-research subthread when Ramy asks for a deep dive?" question + Admin Clawdy's session today wanting a CLAUDE.md rule for UTC→PT conversion. Both surfaced together; both should ship together.

**Requirements:** [DELEG-01 schema field with refine, DELEG-02 prompt injection at session boot, DELEG-03 yaml fan-out across channel-bound agents, DELEG-04 specialty extendibility tests; TZ-01 default TZ resolution from host or config knob, TZ-02 ISO UTC → local string at every serialization site, TZ-03 DST round-trip tests, TZ-04 defaults.timezone config knob, TZ-05 deploy smoke verifying agent-visible PT-formatted time string]

**Plans:** 3/4 plans executed

Plans:
- [x] 999.13-00-PLAN.md — Wave 0 RED tests for both pillars (DELEG + TZ)
- [x] 999.13-01-PLAN.md — Pillar A GREEN: delegates schema + renderer + injection (DELEG-01..04)
- [x] 999.13-02-PLAN.md — Pillar B GREEN: agent-visible TZ helper + 5 site conversions (TZ-01..05)
- [ ] 999.13-03-PLAN.md — Wave 3 gate superseded: yaml fan-out was rolled back due to DSCOPE recursive delegation bug; DSCOPE properly fixed in Phase 106 (commit 0bf3cab); fan-out restored in 106-04

**Status:** Shipped 2026-04-30, partial. Delegates schema + TZ rendering both implemented and live. Yaml fan-out rolled back at deploy due to DSCOPE recursive-delegation bug; root cause fixed in Phase 106 (DSCOPE-02), fan-out restored across 8 agents in Phase 106 deploy.

### Phase 999.14: MCP server child process lifecycle hardening (SHIPPED 2026-04-30)

**Goal:** Stop MCP server processes from leaking on agent restart. Today (2026-04-30) MariaDB hit 152 connections (capped at default 151) — root cause was 15 orphan `mcp-server-mysql` processes accumulating across the day's two clawcode restarts (105 deploy + quick-260430). Each agent restart spawns a fresh `npm exec mcp-server-mysql`; the npm wrapper exits cleanly but its `sh -c mcp-server-mysql` and `node` children get reparented to PID 1 and keep their MariaDB connections alive forever. Same pattern likely affects `1password-mcp` and any other npm-launched MCP server.

**Diagnosis from incident:**
- Live `claude` agents → `npm exec mcp-server-mysql` → `sh -c mcp-server-mysql` → `node mcp-server-mysql` (correct chain)
- After agent restart: npm exits → `sh + node` reparented to init → orphaned with live DB connections
- Bumped MariaDB `max_connections` 151 → 500 + `extra_max_connections = 10` as immediate mitigation. Killed 15 orphan procs to restore 152 → 3 active connections. But the leak is structural — will recur on every clawcode restart cycle.

**Scope:**
1. **Spawn-side fix** — when daemon spawns an MCP server child, capture the full process group ID, set up SIGTERM/SIGKILL on the agent's `disconnect` / shutdown signal. Use `detached: false` and explicit `process.kill(-pid)` to kill the whole group, not just the npm wrapper.
2. **Reaper sweep** — periodic (e.g. every 60s) scan of MCP server procs owned by `clawcode` user with PPID=1. SIGTERM them; SIGKILL after 10s grace. Add to daemon health-check loop.
3. **Restart hardening** — when daemon shuts down (systemd stop/restart), explicitly kill all known MCP child PIDs before exiting. Today the systemd service file relies on the npm wrappers cascading SIGTERM down — but they don't.
4. **Sticky orphan detection at boot** — on daemon start, scan for any pre-existing `clawcode`-owned MCP procs with PPID=1 (left over from previous daemon crash or hard-restart) and kill them before spawning fresh ones. Prevents stacking.

**Verification:**
- Vitest unit tests for the spawn-side wiring (process-group kill on disconnect).
- Integration test: spawn 5 agents, restart daemon, assert zero PPID=1 MCP procs remain.
- Deploy smoke: `pgrep -cf "mcp-server-mysql"` matches expected count (= number of finmentum-db-using running agents) before AND after a `systemctl restart clawcode`.
- Long-soak: after 24h with multiple agent restarts, MariaDB `Threads_connected` stays bounded near (live agent count × ~2 MCP servers per agent × 1 conn each).

**Out of scope:**
- MCP server connection pooling itself (separate redesign — would be Phase 999.9 territory). This phase is about not leaking the MCP processes, not about how many connections they hold.
- Cross-agent shared MCP servers (Phase 999.9 backlog item — different goal).

**Trigger:** 2026-04-30 incident — MariaDB saturated at 152/151 connections, fin-acquisition reported "DB is saturated". Diagnosed via SSH to clawdy + Unraid host. Root cause confirmed via `ps -ef --forest` showing 15 orphan MCP server pairs (sh+node) with PPID=1. Immediate mitigation applied (max_connections bump + orphan kill); structural fix deferred to this phase.

**Second-class incident — `Max thread sessions (3)` cap pin (same day, ~14:47 PT):** fin-acquisition reported "tools failing across the board" — actual error was `Max thread sessions (3) reached for agent 'fin-acquisition'`. Root cause: 3 stale Discord-thread bindings (KYGbsd 22h32m old, DswGzG 22h31m, GPbP2n 17h6m, all idle ≥17h) pinning the cap. Investigation revealed `daemon.ts:4029-4031` shutdown-cleanup AND `archive_thread` MCP tool both wrap Discord's `setArchived` call — when Discord returns 50001 (Missing Access — thread already deleted server-side), the catch swallows the error and the registry entry persists forever. **All three bindings on fin-acquisition were stuck this way for ~22 hours** before the operator noticed. Mitigation applied (manual edit of `thread-bindings.json` + daemon restart). Structural fix folded into this phase.

**Requirements:** [MCP-01 spawn-side process-group wiring, MCP-02 SIGTERM-on-disconnect handler, MCP-03 periodic orphan reaper sweep, MCP-04 graceful daemon-shutdown MCP cleanup, MCP-05 boot-time orphan scan, MCP-06 vitest tests for spawn lifecycle, MCP-07 long-soak verification on clawdy, MCP-08 prune registry on failed Discord-archive cleanup, MCP-09 periodic stale-binding sweep (idle > N hours), MCP-10 operator CLI for thread inspection + manual archive]

**MCP-08 — prune registry on failed Discord-archive cleanup.** Today's incident: `cleanupSubagentThread` and `archive-discord-thread` IPC handler both call Discord's archive API, then prune the registry only on success. When Discord returns 50001 (or 10003 unknown channel, or any non-recoverable not-found), the thread is already gone — the registry entry has no reason to persist. Wrap the Discord call: on success → archive + prune. On 50001/10003/404-class errors → still prune the registry (the binding is dead). On 5xx / network / rate-limit errors → leave the registry intact (transient). Add structured log line distinguishing the three outcomes.

**MCP-09 — periodic stale-binding sweep.** Belt-and-suspenders against MCP-08 missing edge cases: every 60s (piggyback on the orphan-reaper interval from MCP-03), scan thread-bindings.json for entries where `now() - lastActivity > {idleThresholdMs}` (default: 24h). For each: try the same Discord-archive flow as MCP-08; if it fails with not-found-class errors, prune anyway. Threshold configurable via `defaults.threadIdleArchiveAfter: z.string().optional()` (e.g. `"24h"`, `"6h"`). Default: `"24h"`. Operator can disable by setting to `"0"`.

**MCP-10 — operator CLI for thread inspection + manual archive.** Today the only path to free the cap was direct file edit + daemon restart. Add CLI:
- `clawcode threads -a <agent>` — already exists, lists bindings
- `clawcode threads archive <threadId> [--lock]` — calls `archive-discord-thread` IPC method (uses MCP-08 path, prunes on Discord 50001/etc.)
- `clawcode threads prune --stale-after <duration>` — runs the MCP-09 sweep on demand
- `clawcode threads prune --agent <name>` — force-prunes ALL bindings for an agent (escape hatch — use after a known stale-state, like today)

These three (MCP-08, MCP-09, MCP-10) collectively ensure the cap doesn't pin again. MCP-08 catches Discord-deleted-then-our-call-fails. MCP-09 catches anything-idle-too-long regardless of Discord state. MCP-10 gives operators a manual escape hatch when both pruning paths somehow miss.

**Plans:** 3/3 plans executed

Plans:
- [x] 999.14-00-PLAN.md — Wave 0: process-tracker + orphan-reaper + proc-scan modules + RED tests (MCP-01/02/03/06 substrate). To extend with: thread-binding sweeper module + MCP-08/09 RED tests.
- [x] 999.14-01-PLAN.md — Wave 1: daemon boot wiring (MCP-05 boot scan, MCP-03 reaper interval), per-agent register (MCP-01), persistent-handle disconnect (MCP-02), shutdown cleanup (MCP-04). MCP-08 cleanup-failure prune, MCP-09 stale-binding sweep, MCP-10 CLI commands.
- [x] 999.14-02-PLAN.md — Wave 2 deploy gate + 5× restart soak. Post-deploy: bare-name fallback hot-fix shipped (commit bcc70a8).

**Status:** Shipped 2026-04-30. All 10 requirements (MCP-01..MCP-10) implemented. Post-deploy hot-fix for bare-name fallback in orphan reaper shipped same day (bcc70a8).

### Phase 999.15: MCP child PID tracking — full reconciliation, self-healing, and operator visibility (SHIPPED 2026-04-30)

**Goal:** Fix the daemon-side PID staleness exposed by the 999.14 deploy on 2026-04-30. Post-deploy verification showed 3 of 5 agents had recorded claude subprocess PIDs that were already dead — the SDK respawned claude during warmup, and our 1s settle window captured the dying first PID instead of the surviving second one. 999.14's hot-fix made orphan reaping self-healing via cmdline-only matching (bypassing the tracker), so the staleness is currently cosmetic for the orphan path. But the tracker IS used by graceful-shutdown and per-agent-restart paths, where staleness silently leaks live MCP children. This phase fixes the tracker properly.

#### Why this is a real bug, not just cosmetic

The orphan reaper is currently self-healing via cmdline match (PPID=1 + uid + age + cmdline regex). Tracker staleness doesn't break orphan cleanup. **But the tracker is used by:**

- **Graceful shutdown (MCP-04):** `tracker.killAll(5s)` SIGTERMs recorded PIDs before daemon exit. Live MCP children never registered (because initial settle missed them) survive daemon exit → become orphans on next boot → 60s+ window of orphan accumulation before reaper catches them.
- **Per-agent restart:** `clawcode restart fin-acquisition` → `stopAgent` → `tracker.killAgentGroup(name)` SIGTERMs stale PIDs (no-op). Old MCP children from the previous claude instance leak.
- **SDK retry storms:** if an agent has a bad MCP env (e.g. 1Password rate-limit), SDK retries claude spawn N times. Tracker only knows the last (or worse, an early failed) instance.
- **Operator visibility:** today there's no command to see what the tracker thinks is registered. Operators have to grep journal logs and pid trees.

#### Scope (TRACK-01..08)

**TRACK-01 — Per-tick reconciliation** in `startOrphanReaper`'s existing 60s interval (extend `onTickAfter` callback). For each registered agent: if recorded `claudePid` is dead → re-discover (with `minAge=10s`) → update tracker. If `mcpPidCount=0` OR claudePid changed → re-walk MCP children + replace. Idempotent. Self-healing. Cheap (already walking /proc each tick).

**TRACK-02 — Polling discovery at agent.start.** Replace fixed 1s settle with polled wait: 6 attempts × 5s = max 30s, each checking for a `claude` proc with `ppid===daemonPid` AND `age >= 5s` (so we don't grab a freshly-spawned claude about to be respawned). Combined with TRACK-01 reconciliation, even if polling misses the settle window the reaper catches up.

**TRACK-03 — Tracker API additions:**
- `updateAgent(name, claudePid)` — replaces tracked claudePid
- `replaceMcpPids(name, pids)` — replaces full MCP child PID set
- `getRegisteredAgents()` — returns map of `agent → { claudePid, mcpPids[] }`
- `pruneDeadPids(name)` — reads /proc, removes any PIDs no longer alive
- Plus shared `isPidAlive(pid)` helper in `proc-scan.ts` (uses `process.kill(pid, 0)` standard liveness check)

**TRACK-04 — Reconciliation logging.** Reconciler emits one structured pino warn log per cycle WHEN STATE CHANGES (no log for no-op cycles):
```json
{ "component": "mcp-tracker", "action": "reconcile", "agent": "fin-acquisition",
  "oldClaudePid": 4067770, "newClaudePid": 4068098,
  "oldMcpCount": 0, "newMcpCount": 8,
  "reason": "stale-claude" | "missing-mcps" | "agent-restart" }
```
Operators grep for `action: "reconcile"` to audit tracker drift.

**TRACK-05 — `clawcode mcp-status [-a <agent>]` CLI.** New CLI subcommand. Calls new IPC method `mcp-tracker-snapshot`. Prints table: `AGENT | CLAUDE_PID | MCP_PIDS | MCP_PROCS_ALIVE | CMDLINES`. Useful both for production debug AND for verifying TRACK-01 works in long-soak.

**TRACK-06 — `tracker.killAgentGroup` reconciles before kill.** Today it SIGTERMs recorded PIDs (which may be stale). New flow: (1) reconcile to sync /proc state, (2) SIGTERM the reconciled set, (3) 5s grace then SIGKILL stragglers. Guarantees agent-stop / agent-restart cleanup catches even MCP children that initial settle missed.

**TRACK-07 — Long-soak deploy verification on clawdy:**
- Cold restart: after 90s every agent has live `claudePid` + non-empty `mcpPids`. Zero orphans.
- Per-agent restart: `clawcode restart fin-acquisition` → old children SIGTERM'd cleanly, new ones registered after warmup. No orphan accumulation.
- Forced respawn: `kill -9` the live claude PID for one agent → within 60s reconciler updates tracker to new PID + new MCP children.

**TRACK-08 — Tests for SDK respawn scenarios:**
1. Initial settle finds dying claude → polled discovery retries → eventually finds surviving claude (mock /proc with two claude PIDs over time)
2. Tracker has stale claudePid → reconciler detects + re-registers (mock proc walk)
3. Per-agent restart with stale entries → killAgentGroup reconciles before SIGTERM (assert all live PIDs got SIGTERM)
4. Tracker snapshot IPC returns full state map (e2e through IPC client)
5. CLI `mcp-status` formats the snapshot correctly (snapshot test on formatter output)

#### Out of scope

- Process-group leadership tracking (would require SDK spawn-time integration; SDK doesn't expose it; post-reparent pgid is unreliable per 999.14 RESEARCH Open Question 2). Reconciliation by /proc walk is more robust anyway.
- Replacing the orphan reaper's cmdline-based detection with PID-based detection — the cmdline path is now self-healing and covers orphans directly. Tracker is for graceful-shutdown / restart paths only.
- Daemon-side process supervision of MCP children (auto-restart MCP if it dies). Leave SDK-side respawn as authoritative.
- Migrating to the agent SDK's process management API once it lands. SDK is pre-1.0; if/when it exposes PIDs, TRACK-01..05 simplify. Not waiting.

#### What "thorough" catches that the 999.14 hot-fix doesn't

- Claude respawn during warmup → caught by TRACK-01 reconciliation
- Claude respawn mid-session (heartbeat failure, MCP env error retry) → TRACK-01 within 60s
- MCP child crash + respawn under live claude → TRACK-01 (mcpPidCount drops, reconcile re-walks)
- Agent restart with stale tracker → TRACK-06 reconcile-before-kill
- Forced kill from operator (`kill -9 <claude>`) → TRACK-01

**Trigger:** 2026-04-30 999.14 deploy reveal — diagnosed mid-deploy via journal + ps output (3/5 agents had `claudePid` not matching live claude proc). Hot-fix shipped (cmdline-only orphan detection bypasses tracker for orphan path), but tracker staleness needs proper fix to keep graceful-shutdown + agent-restart paths robust at fleet scale.

**Requirements:** [TRACK-01..08 as scoped above]

**Plans:** 5/5 plans executed

Plans:
- [x] 999.15-00-PLAN.md — Wave 0 RED tests across 6 test files (TRACK-01..06+08)
- [x] 999.15-01-PLAN.md — Tracker API extensions + isPidAlive (TRACK-03 + TRACK-04 substrate)
- [x] 999.15-02-PLAN.md — Reconciler + polled discovery + reconcile-before-kill (TRACK-01/02/04/06)
- [x] 999.15-03-PLAN.md — mcp-tracker IPC + CLI (TRACK-05)
- [x] 999.15-04-PLAN.md — Local gate + operator deploy + long-soak smokes on clawdy (TRACK-07)

**Status:** Shipped 2026-04-30. All 8 requirements (TRACK-01..08) implemented. mcp-tracker CLI post-deploy bug noted (Invalid Request) — fixed in Phase 106 TRACK-CLI-01 (commit fa72303).

### Phase 999.16: Dream pass JSON output enforcement (REPLACED by Phase 107)

### Phase 999.17: vec_memories orphan cleanup on memory delete (REPLACED by Phase 107)

### Phase 999.18: Subagent relay reliability — root-cause fix (PARTIAL — dominant fix shipped 2026-05-01; remaining edge cases pending timer findings)

**Goal:** Diagnose and fix the silent-relay-drop bug where subagent completion summaries don't always land in the parent's main channel. `relayCompletionToParent` (src/discord/subagent-thread-spawner.ts:201) has 5 silent-return points; quick task 260501-i3r added structured `subagent relay skipped` logs at each so production logs now reveal which branch fires when a relay drops. Once 1-2 weeks of operator data accumulates, identify the actual cause (most likely candidate: streaming-edit placeholders not surfacing in `messages.fetch` cache → `no-bot-messages` reason) and ship a targeted fix.

**Trigger:** 2026-05-01 — operator report ("summary doesn't always land back to main channel" during research subagent runs). Quick task 260501-i3r (commit 4a38e36) gave the diagnostic substrate; root-cause fix waits on real failure data.

**Depends on:** quick task 260501-i3r diagnostic logs + ~1-2 weeks of production observation to identify the dominant failure mode.

**Requirements:** TBD — likely 4-6.

**Plans:** 0 plans landed in this phase directory; the dominant root cause was diagnosed and fixed via quick task `260501-nfe` (commits 9275734, 251eb5a, 6ddde6b). Edge-case follow-ups pending timer findings (Sun 2026-05-03).

**Status (2026-05-01):** PARTIAL. Code-trace mid-session revealed the dominant failure mode was upstream of the 5 silent-return points: `relayCompletionToParent` was calling `turnDispatcher.dispatch()` (non-streaming) and silently discarding the response string. Phase 99-M's commit message claimed the parent posts "via normal Discord pipeline" but the implementation never wired the pipeline. **Fix shipped via quick task `260501-nfe`** — switched to `dispatchStream()` + `ProgressiveMessageEditor` posting to parent's main channel (mirrors bridge.ts user-message path). 39/39 spawner tests pass; relay path now posts on every successful dispatch. Two new relay-skipped reason tags added (`parent-channel-fetch-failed`, `empty-response-from-parent`) for the new failure modes after dispatch but before successful post.

The original 5 silent-return logs (quick task 260501-i3r, commit 4a38e36) remain in place. The Sun 2026-05-03 13:31 UTC timer will run the journal sweep with all 7 reason tags in scope (5 original + 2 new) and surface any remaining edge cases. Phase 999.18 stays active until the timer findings are reviewed and any residual bugs are addressed.

**Promotion target:** if timer findings show no significant residual issues, mark fully SHIPPED and close. Otherwise plan a small follow-up to address the dominant remaining tag.

**Local repo only — fix not yet deployed to clawdy** (per Ramy-active deploy hold + explicit operator instruction).

### Phase 999.19: Subagent cleanup, memory consolidation, and delegate-channel routing (BACKLOG)

**Goal:** Three coordinated changes to make `delegateTo` (Phase 999.3) usable as a real research-fanout primitive instead of a fleet-leak generator:

1. **Spawn delegated threads on the *delegate's* channel, not the parent's.** Today the spawner uses `parentConfig.channels[0]` (subagent-thread-spawner.ts:350) so every `delegateTo: research` thread lands on `#admin-clawdy`. Switch to `sourceConfig.channels[0]` when delegating so threads naturally appear under `#research` / `#fin-research`. Discord's native thread panel becomes the discovery surface — no custom log-thread needed. The cross-channel completion relay still posts to the parent's main channel for operator visibility (`relayCompletionToParent` already reads parent's channel correctly — keeps working unchanged).

2. **Default `autoArchive: true` for the delegate path.** Currently `autoArchive` defaults `false`, leaking `Admin Clawdy-via-research-*` sessions in `/clawcode-fleet` indefinitely. Flip the default when `delegateTo` is set so the subagent session stops + archives + prunes from the registry the moment its turn finishes. Non-delegate `-sub-` spawns keep current behavior.

3. **Memory consolidation into the *delegate's* SQLite store.** Before `autoArchive` stops the session, write a summary record (task + key findings + thread URL) directly into the dedicated agent's per-agent memory DB. The delegate's session may not be running; consolidation must use a direct DB write (not a message dispatch) and call the delegate's embedder for the vector. Then the dedicated `research` agent surfaces all past delegated work via its normal hybrid-RRF retrieval (Phase 90 MEM-03) on subsequent turns — institutional memory without keeping the agent live.

Plus: fix the **`-via-` naming pattern leak across the codebase**. Phase 999.3 introduced `${parent}-via-${delegate}-${shortId}` session names but `THREAD_SUFFIX_RE` (restart-greeting.ts:199), prune Rule 2 (registry.ts:413), and 5 hardcoded `-sub-/-thread-` filters (openai/server.ts:376, openai/endpoint-bootstrap.ts:285, daemon.ts:2736/4142/5932, cli/commands/threads.ts:103, capability-manifest.ts:184) all only match `-sub-`. Treat `-via-` like `-sub-` everywhere.

**Trigger:** 2026-05-01 — operator observed `Admin Clawdy-via-research-*` ephemeral sessions accumulating in `/clawcode-fleet` listing, expecting delegated work to consolidate back to the dedicated research agent's memory and clean up after itself.

**Requirements:** TBD — likely 8-10.

**Plans:** 0 plans (TBD — 3 plans: filter+routing fix wave, consolidation pipeline, integration tests).

**Promotion target:** active milestone, after Phase 108. Should land before Phase 999.20 (which depends on this spawn API surface).

### Phase 999.20: `/research` and `/research-search` Discord slash commands (BACKLOG)

**Goal:** Two new Discord slash commands that make research workflows first-class, building on Phase 999.19's spawn + consolidation foundation:

1. **`/research <topic> [agent:research|fin-research]`** — calls the delegated-spawn path with `delegateTo` set to the chosen research agent. Posts the new thread URL ephemerally to the operator. Multiple invocations spawn parallel threads on the chosen research channel; each consolidates into the dedicated agent's memory on completion (per 999.19).
2. **`/research-search <query> [agent:research|fin-research]`** — IPC into the chosen agent's memory store, runs the existing hybrid-RRF retrieval (Phase 90 MEM-03 substrate already exists), returns top 5 hits with their original deep-dive thread links. Lets the operator surface past research semantically without scrolling Discord history.

Discoverability flow: spawn deep dives via `/research`, find past work via `/research-search` or the `#research` channel's native thread panel.

**Trigger:** 2026-05-01 — operator wants easy access to all of their delegated research without hunting through subthreads.

**Depends on:** Phase 999.19 — delegate-channel routing + consolidation pipeline must be in place first; otherwise these commands would re-create the leak/scatter problems 999.19 fixes.

**Requirements:** TBD — likely 5-7.

**Plans:** 0 plans (TBD — 2 plans: spawn command + search command + integration tests).

**Promotion target:** active milestone, after Phase 999.19.

### Phase 999.21: `/get-shit-done` Discord slash command consolidation (SHIPPED 2026-05-01)

**Goal:** Consolidate the 20 existing `gsd-*` Discord slash commands (slash-types.ts:284-432, the curated subset of 57 GSD skills) under a single `/get-shit-done` top-level command with all 20 nested as subcommands. Pure UX polish — internal `claudeCommand: "/gsd:autonomous {args}"` mappings stay unchanged, only the Discord-facing surface flips from 20 top-level entries to 1 expandable group.

20 fits cleanly under one Discord top-level command (cap is 25 subcommands per command, no subcommand groups needed). User confirmed all 20 nested — no top-level escapes for "frequently typed" commands.

Reduces slash-menu clutter from 20 entries to 1, improves discoverability via the Discord-native subcommand UI ("/get-shit-done " auto-suggests all 20 with their descriptions).

**Trigger:** 2026-05-01 — operator request to clean up the slash command surface.

**Requirements:** TBD — likely 3-4 (rewrite slash-types.ts entries, update handler dispatch to support subcommand routing, update slash-commands tests, deploy gate).

**Plans:** 0 plans — shipped via quick task 260501-jld (3 atomic code commits + docs commit, no roadmap renumbering).

**Status:** Shipped 2026-05-01 via quick task `260501-jld` (executor commits 7e3a587, 5a838ed, 642292a, e422045). 19 flat `gsd-*` Discord slash commands collapsed into one `/get-shit-done` top-level command with 19 nested subcommands. (Original task brief said 20 — actual count was 19 per `slash-types.ts` audit; existing test `slash-types-gsd-commands.test.ts:31` already pinned `toHaveLength(19)`.) claudeCommand text values byte-identical pre/post (pinned via static test). Dispatch uses single rewrite-at-entry pattern in `handleInteraction` — `/get-shit-done` + `getSubcommand()` remap to `gsd-${sub}` so all existing carve-outs (handleSetGsdProjectCommand, GSD_LONG_RUNNERS, agent-routed branch, cmdDef.find lookups) keep working unchanged. Three test files added/updated: 12 GS1 invariants, 3 GSR registration pins, 6 GSDN nested-form pins. Full `src/discord` vitest sweep: 594/594 pass. Discord slot delta: -18 (19 flat → 1 composite). **Deploy note:** new top-level `/get-shit-done` registration replaces stale `/gsd-*` entries on next Discord cache flush — operators may briefly see both during propagation. **Local repo only — not yet deployed to clawdy** (per Ramy-active deploy hold).

### Phase 999.22: Soul guard against agent hallucinated tool-use claims (SHIPPED 2026-05-01)

**Goal:** Prevent agents (especially `Admin Clawdy`) from claiming to have performed actions they didn't actually execute. Add a soul-level constraint and verification protocol so agents must read-back-confirm any file edit, config change, or system mutation before reporting it as done.

**Trigger:** 2026-05-01 production outage — Admin Clawdy posted "Set. `threads.maxThreadSessions: 10` is live in `clawcode.yaml` under `defaults` — takes effect on next daemon reload" but the file mtime (`2026-04-30 23:21:22`) and a grep both confirmed no edit was performed. The fabricated success report led directly to the cascading reload attempts that killed the daemon (paired with 999.23 and 999.24).

**Approach (sketch):**

1. Add a soul addendum: "Before reporting any mutation as done (file edit, config change, systemctl action, IPC call), Read the resulting state and quote the change verbatim in your reply. If you cannot verify it landed, report failure, not success."
2. Consider a system-level guard: hook on Bash/Edit completion that reminds the agent to verify and quote.
3. Add a "claim-verify" pattern to the standard delegation context for Admin Clawdy / agents with mutation tools.

**Requirements:** TBD — likely 3-5.

**Plans:** 0 plans — shipped via quick task 260501-k5s (TDD RED + GREEN + docs, 3 atomic commits).

**Status:** Shipped 2026-05-01 via quick task `260501-k5s` (executor commits fd3aa10, 9486ad5, 67a1f03). Added new `mutate-verify` directive to fleet-wide `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` rail in `src/config/schema.ts` (Phase 94 D-10 substrate, Phase 999.1 locked-additive convention). Key count: 11 → 12, locked-additive verified via static-grep + git-diff (existing 11 keys byte-identical). Directive covers the 4 brief requirements: read-back rule, passive-success-framing ban (Set./Done./Live./Saved./Updated.), failure-by-default on uncertainty, evidence-quoting format. Fleet scope (matches FRESH-/TRUST-/TABLE-* pattern, NOT subagent-only DERIV-* pattern). Tests: 38/38 pass (was 33+5 RED → all GREEN). Operational note: directive read at agent session boot; NEW agent sessions pick it up automatically; existing live sessions will not have it until next session start (no daemon restart required for the directive itself — only for refreshing live agents). **Local repo only — deploy held per Ramy-active rule + explicit operator instruction "Wait for me to give deploy order".**

### Phase 999.23: Daemon SIGHUP handler + systemd restart-on-SIGHUP hardening (SHIPPED 2026-05-01)

**Goal:** Stop SIGHUP from killing the daemon silently. Two layered fixes:

1. **Install a SIGHUP handler in the daemon** that performs a config reload (or at minimum logs the signal + ignores it) instead of letting Node.js's default SIGHUP termination behavior take over. `process.on("SIGHUP", () => { log.info("sighup received — reloading config"); reloadConfig(); })`.
2. **Add `RestartForceExitStatus=SIGHUP` to the systemd unit** so even if the handler crashes or is removed, systemd treats SIGHUP termination as a failure that triggers `Restart=on-failure`. Belt-and-suspenders.

**Trigger:** 2026-05-01 production outage — daemon died at 06:07:55 PDT from SIGHUP (after Admin Clawdy's bash tool fell back to `kill -HUP <pid>` when sudo rejected its reload attempts). systemd treated SIGHUP as a clean exit (default behavior), so `Restart=on-failure` didn't fire. Daemon stayed dead for ~9 minutes until manual restart.

**Approach (sketch):**

1. Add SIGHUP handler in `src/manager/daemon.ts` boot path (alongside existing SIGTERM/SIGINT handlers).
2. Decide reload semantics: full config reload (re-read yaml, diff, apply additive changes) OR ignore-with-log. Likely ignore-with-log first, full reload as a follow-up phase.
3. Update `/etc/systemd/system/clawcode.service` template (and the deploy/install path that writes it) with `RestartForceExitStatus=SIGHUP` under `[Service]`.
4. Smoke test: kill -HUP the daemon, confirm it survives (or restarts within ~10s if handler not installed).

**Status:** Shipped 2026-05-01 (local repo, deploy held). Two-layer fix:
1. **Daemon SIGHUP handler** (`src/manager/daemon.ts:4694-4708`) — added alongside SIGTERM/SIGINT. Logs the signal, runs the existing `shutdown()` cleanup (close MCP children, unlink socket + PID), then exits with code 129 (128 + signal 1 = SIGHUP). Goes through the SAME shutdown path so MCP children + agents drain cleanly.
2. **systemd `RestartForceExitStatus=129`** (`scripts/install.sh:228`) — added under `[Service]` so the existing `Restart=on-failure` policy treats exit code 129 as a restart trigger. Without this, code 129 looks like a clean exit and systemd leaves the daemon dead.

Together these close the 2026-05-01 outage loop: a `kill -HUP` (from any source — agent bash, manual operator, future SIGHUP-from-systemctl-reload) now triggers a graceful drain + automatic systemd restart within ~10s instead of silent death.

Tests: signal handling is integration-level (no unit test). Will be validated at next deploy via deliberate `kill -HUP <pid>` smoke. Pairs with shipped 999.24 (sudoers expansion) — together they remove the agent's incentive to fall back to `kill -HUP` AND the consequence of doing so.

### Phase 999.24: Sudoers expansion for clawcode user — systemctl reload/restart (SHIPPED 2026-05-01)

**Goal:** Whitelist the exact `systemctl` invocations that Admin Clawdy needs to legitimately reload or restart the daemon, so the agent doesn't fall back to `kill -HUP` when sudo rejects its requests. Currently `/etc/sudoers.d/clawcode` (328 bytes) doesn't allow `systemctl reload clawcode.service`, `systemctl restart clawcode.service`, or `systemctl kill --signal=SIGHUP clawcode.service`.

**Trigger:** 2026-05-01 production outage — Admin Clawdy's three sequential `sudo systemctl ...` attempts all rejected with "command not allowed" (journal evidence at 06:07:42-06:07:50). The agent then bypassed sudo by directly signaling the daemon's PID (which the clawcode user is permitted to do without sudo), and SIGHUP killed the daemon.

**Approach (sketch):**

1. Audit the current `/etc/sudoers.d/clawcode` file to understand the current allowlist.
2. Add NOPASSWD lines for the legitimate operator paths:
   - `clawcode ALL=(root) NOPASSWD: /usr/bin/systemctl reload clawcode.service`
   - `clawcode ALL=(root) NOPASSWD: /usr/bin/systemctl restart clawcode.service`
   - (Avoid adding generic `systemctl *` — keep narrow.)
3. Validate via `visudo -c` before deploying.
4. Ship via the install/update flow so future deploys don't regress.

**Requirements:** TBD — likely 2-3.

**Plans:** 0 plans — shipped via quick task 260501-j7x (atomic sudoers swap on clawdy, no repo code changes).

**Status:** Shipped 2026-05-01 via quick task `260501-j7x` (commit `c3dc129`). Added new `CLAWCODE_SERVICE` Cmnd_Alias to `/etc/sudoers.d/clawcode` covering exact-match `systemctl reload clawcode.service` and `systemctl restart clawcode.service`. Original `CLAWCODE_INSTALL` block preserved byte-equal. Atomic install via `install -m 0440 -o root -g root` (mandatory mode for sudoers.d). Validated via `visudo -cf` pre-install. Daemon left running; no live reload/restart smoke test (would have killed daemon — Phase 999.23 SIGHUP handler still pending). Pairs with future 999.23: together they close the "agent kills its own daemon" loop. Future hardening: install/update flow does NOT currently template sudoers.d entries — a later phase should add this so the grant survives reinstalls (out of scope for 260501-j7x).

### Phase 999.25: Agent boot wake-order priority (SHIPPED 2026-05-01)

**Goal:** Operator-controllable boot order for the auto-start sequence so critical agents (Admin Clawdy, fin-acquisition, research) come up before peripheral ones during cold restarts.

**Trigger:** 2026-05-01 — operator request for "wake order" semantics. Today the boot order is determined by YAML order, which is incidental and not necessarily aligned with operator priority.

**Approach:**
- New optional `wakeOrder?: number` field on `agentConfigSchema`. Lower numbers boot first; undefined boots LAST in YAML order.
- daemon.ts boot path sorts the auto-start array via `[...autoStartAgents].sort((a,b) => (a.wakeOrder ?? Infinity) - (b.wakeOrder ?? Infinity))` BEFORE passing to `manager.startAll`. Stable sort preserves YAML order for ties + unordered agents.
- Boot remains sequential (`startAll` uses `for...await`); wakeOrder only changes the ORDER, not total time. Tiered parallel boot was considered and deferred — too much overlap with the boot-storm conditions that drove Phase 104 + Phase 108.
- Loader pass-through: `wakeOrder` flows through `resolveAgentConfig` to the daemon without a `defaults.X` fallback (per-agent or undefined).

**Status:** Shipped 2026-05-01 (local repo, deploy held). Schema field added (`src/config/schema.ts`), threaded through `ResolvedAgentConfig` (`src/shared/types.ts`), wired in `src/config/loader.ts` and the daemon's auto-start IIFE (`src/manager/daemon.ts`). Logs the resolved order at info level when any agent declares wakeOrder, so the journal records the boot sequence. Tests: 9 new (sort behavior + operator example + edge cases like negative numbers + zero) + static-grep pin against daemon source so a future refactor that drops the sort fails CI before production regresses. 13/13 tests pass.

**Example yaml:**
```yaml
agents:
  - name: admin-clawdy
    wakeOrder: 1            # boots first
  - name: fin-acquisition
    wakeOrder: 2            # boots second
  - name: research
    wakeOrder: 3            # tier 3
  - name: fin-research
    wakeOrder: 3            # tier 3 — ties keep YAML order
  - name: misc-agent        # no wakeOrder → boots last
```

**Out of scope (deferred):** Tiered parallel boot (group by wakeOrder, Promise.all within group). Re-creates Phase 104/108 boot-storm risk. Would need plan-checker, boot-storm load test, and per-tier max-concurrency cap. Revisit if cold-restart time becomes an operational pain point.

### Phase 999.26: Phase 108 broker token-sticky-drift loop (SHIPPED 2026-05-01)

**Goal:** Fix the broker reconnect storm where finmentum-scope agents repeatedly bounce between two token hashes, consuming MCP capacity and slowing turns to the point of QUEUE_FULL on user messages.

**Trigger:** 2026-05-01 ~15:00-15:19 PDT — Ramy reported fin-acquisition not responding. Investigation showed:
- **79 `agent token sticky drift — rejecting connection` events in 20 minutes** for finmentum-scope agents:
  - fin-acquisition: 55 events (every ~22s)
  - finmentum-content-creator: 13 events
  - fin-research: 11 events
- Pattern per cycle: agent connects with `newHash":"dcfc03f8"` → broker rejects against `stickyHash":"aa18cf6f"` → handshake-accepted on different pool → repeats ~22s later.
- Two real production user messages from Ramy hit `QUEUE_FULL` (15:12:50 + 15:19:07) because fin-acquisition's queue was saturated by slow turns waiting on broker reconnects.
- Memory pressure: daemon at 15G / 20G with peak 20G during the loop.
- fin-acquisition session reached turnCount 104 (Ramy was deep in active conversation), making restart-to-clear costly.

**Proximate cause hypothesis:** the broker's per-agent stickyHash binding (set at first connect) does not align with the token the agent's MCP env-override resolver produces on subsequent calls. Possibilities:
1. Vault-scope token cache TTL mismatch between SecretsResolver and the broker's pool key
2. `mcpEnvOverrides` resolution returns Finmentum-scope token (`aa18cf6f`) at session start but clawdbot-scope token (`dcfc03f8`) on later tool calls (or vice versa)
3. Broker pool keying uses one hash basis (e.g., raw token) while agent shim uses another (e.g., normalized OP_SERVICE_ACCOUNT_TOKEN env var)

**Scope:**
- Add diagnostic log at the agent shim send site: include `tokenSource` (cache-vs-fresh), `tokenScope` (clawdbot-vs-finmentum), `stickyHashAtConnect` to clarify whether the drift is on the agent or broker side.
- Audit `OnePasswordMcpBroker` sticky-hash binding logic — should the binding rebind on graceful drift (e.g., when secret is rotated) instead of permanently rejecting?
- Audit `resolveMcpEnvOverrides` (Phase 100 follow-up) to confirm it returns the SAME scoped token on every call within a session lifetime.
- Tests: synthesize a sticky-drift scenario (agent connects with token A, broker binds, agent sends with token B) and assert: either the broker rebinds gracefully OR a single warn log + connection close (NOT a tight reconnect loop).
- Consider: drift-counter circuit breaker — after N drift events in a window, force a fresh broker pool spawn for that token rather than continuing to reject.

**Operational mitigation (NOT a code fix):** stop+start the affected agent clears its broker binding. But this drops in-flight conversation context — costly during active operator/client work.

**Pairs with:**
- Phase 999.22 mutate-verify (shipped, undeployed): would have prevented Admin Clawdy's "fin-acquisition is healthy, not stalled. 🟢" hallucination at 15:19:25 (response generated 18s AFTER the QUEUE_FULL log).
- Phase 999.4 utilization derivation (shipped, undeployed): unrelated but was triaged in same session.

**Requirements:** TBD — likely 4-6 (diagnostic logs, sticky-hash audit, env-resolver audit, drift-counter, regression test).

**Plans:** 0 plans (TBD — likely 1-2 plans when promoted).

**Promotion target:** active milestone — production-impact bug, blocks reliable Ramy/fin-acquisition workflow. Should ship before next high-traffic window. Diagnostic logs (item 1) could ship as a quick task to gather evidence before the architectural decision.

**Status (2026-05-01):** Shipped (local repo, deploy held). Root cause identified directly from code reading + journal evidence — diagnostic-logs Stage 1 was skipped because the bug was clear:

- `OnePasswordMcpBroker.acceptConnection` set `agentTokenSticky.set(agent, hash)` on first connect (`src/mcp/broker/broker.ts:181`).
- On any subsequent connect with a different hash (legitimate 1Password rotation, scope-resolver returning a different token), the broker rejected with JSON-RPC error code `BROKER_ERROR_CODE_DRAIN_TIMEOUT` and message "Agent token mapping changed; daemon restart required".
- The shim subprocess saw the error → exited with `SHIM_EXIT_TEMPFAIL` → SDK respawn loop → same env → same new hash → rejected again. Tight ~3s loop, observed 79 events in 20 min for finmentum-scope agents.
- The "daemon restart required" message was overly conservative — the daemon's env-resolver is the trust boundary; if it gives the broker a new token, the broker should follow.

**Fix (commit landing in this push):** rebind on token drift in `acceptConnection` — log warn (not error) with `oldHash`/`newHash` for audit, call new `detachAgentFromOldPool(agentName, oldTokenHash)` helper to decrement old pool refCount + drop queued entries + trigger drain when refCount hits 0, update sticky map to new hash, then fall through to the normal first-connect path on the new pool. Inflight requests on the old pool's child complete naturally (the OLD token is still valid until 1P actually invalidates it).

**Tests:** 5 new regression tests in `src/mcp/broker/__tests__/broker.test.ts`:
1. Agent reconnect with rotated tokenHash rebinds to new pool (no rejection).
2. Rebind logs warn (not error) with oldHash + newHash for audit trail.
3. Rebind does NOT send a JSON-RPC error to the new connection (no respawn loop).
4. Rebind preserves other agents on the old pool (refCount only decrements by 1).
5. Rebind survives multiple rotations for the same agent (no permanent latch).

35/35 broker tests pass (16 broker.test + 19 integration/shim/pooled). **Local repo only — deploy held per Ramy-active rule + queued with rest of pending deploys.** First post-deploy check: `journalctl -u clawcode --since "5 min ago" | grep "agent token sticky drift"` should return zero hits and instead show `agent token rotated — rebinding to new pool` warns when rotations actually occur.

**Post-deploy observation (2026-05-01 16:15-16:20 PDT):** rebind fix verified — zero "rejecting connection" events, ~4 graceful rebinds/min. BUT discovered two follow-up issues during smoke:
1. **Env-resolver oscillation (Phase 999.27):** rebind warns fire ~1Hz with finmentum-scope agents bouncing between `aa18cf6f` and `dcfc03f8` token hashes 1 second apart. Not a 1Password rotation (rotations are minutes-to-days); the daemon's `mcpEnvOverrides` resolver is returning two different tokens for the same agent on adjacent calls. Tracked as Phase 999.27 below.
2. **Pool churn from rapid rebinds (Phase 999.26.1 follow-up):** `beginDrain` fast-path immediately SIGTERMs the pool child when `inflight.size === 0`. Combined with 999.27 oscillation, this kills+respawns the pool child every second. fin-acquisition's warm-path probe `initialize` was in-flight when the pool child got SIGTERMed → 5s health-check timeout → agent marked failed. Mitigation: add a small drain delay (~500ms-1s) before pool kill to absorb oscillation cycles. Easy follow-up; doesn't fix root cause but reduces blast radius. Recovered fin-acquisition manually via `clawcode start fin-acquisition`.

### Phase 999.27: Env-resolver oscillation root cause (SHIPPED 2026-05-01)

**Goal:** Stop the daemon's `mcpEnvOverrides` resolver (Phase 100 follow-up) from returning two different `OP_SERVICE_ACCOUNT_TOKEN` values for the same agent on adjacent calls. The 999.26 rebind fix prevents this from breaking the broker, but the rapid token oscillation still causes pool churn and warm-path timeouts during agent boot.

**Trigger:** 2026-05-01 16:15 PDT — post-deploy smoke of 999.26. Journal shows finmentum-scope agents (fin-acquisition, fin-research, finmentum-content-creator) rebinding between two specific token hashes:
- `aa18cf6f` — likely Finmentum vault scope token
- `dcfc03f8` — likely clawdbot fleet scope token

Example oscillation (~1 Hz):
```
16:15:48  finmentum-content-creator  oldHash=aa18cf6f  newHash=dcfc03f8
16:15:49  finmentum-content-creator  oldHash=dcfc03f8  newHash=aa18cf6f  ← 1 second later
16:16:11  fin-research               oldHash=aa18cf6f  newHash=dcfc03f8
16:16:12  fin-research               oldHash=dcfc03f8  newHash=aa18cf6f
16:16:33  fin-acquisition            oldHash=aa18cf6f  newHash=dcfc03f8
16:16:37  fin-acquisition            oldHash=dcfc03f8  newHash=aa18cf6f
```

**Hypotheses (need investigation):**

1. **Two 1password-mcp shim subprocesses per agent** — one with the daemon-default clawdbot token (inherited from process.env), one with the Finmentum-scope override (from `mcpEnvOverrides`). Each spawns its own pool. If both shims are active and alternating dispatches, the rebind fires for every alternation. Investigate: `ps -ef | grep mcp-broker-shim | grep <agent>` should show ONE shim per agent — if there are two with different env, that's the bug.

2. **Cache TTL flapping** — Phase 104's secrets boot-cache caches op-resolved values; Phase 100's `resolveMcpEnvOverrides` may bypass it on retry. If the cache returns the Finmentum token on hit and the resolver returns the clawdbot token on miss (because it falls back when op rate-limits), the agent's MCP child gets respawned with different env each cycle.

3. **Async race in `mcpEnvOverrides`** — multiple concurrent shim respawns hit the resolver simultaneously; one gets cache, one gets fresh op-read with a different scope. Race condition rather than design intent.

**Investigation steps:**
- `ps -ef | grep mcp-broker-shim` — count shims per finmentum agent
- `ps -ef | grep -A1 mcp-broker-shim | grep CLAWCODE_AGENT` — confirm env per shim
- Audit `src/manager/op-env-resolver.ts` for per-agent token determinism
- Audit `src/manager/secrets-resolver.ts` cache layer — does it return consistent values for the same key?
- Add diagnostic logs at the resolver boundary: `tokenScope` (clawdbot vs finmentum) + `resolvedFromCache` (boolean) + `resolverCallId` (nanoid) so we can correlate which call returns which scope.

**Scope:**
- Phase 1 (diagnostic): add resolver-boundary logs to confirm which hypothesis is correct.
- Phase 2 (fix): depends on Phase 1 findings. Likely candidates:
  - Pin per-agent token to a single resolved value for the agent lifetime (no per-call re-resolution).
  - Force the env-resolver to be a pure function (cache-stable per agent).
  - Add a "resolved-token-fingerprint" pre-flight before every shim spawn to bail loudly if the token changes mid-session.

**Pairs with:**
- Phase 999.26 (shipped) — rebind fix prevents this from killing the agent. Without 999.26, this same oscillation hits the rejection loop and saturates MCP capacity.
- Phase 999.26.1 follow-up (pool drain delay) — would mitigate the warm-path-timeout symptom while 999.27 root-cause work happens.

**Requirements:** TBD — likely 4-6 (diagnostic logs, resolver audit, per-agent token pinning, regression test, smoke verification).

**Plans:** 0 plans (TBD when promoted; Phase 1 diagnostics could be a quick task).

**Promotion target:** active milestone — high priority. Each agent boot during oscillation has ~50% probability of warm-path timeout (the 5s health check window vs ~1s oscillation period). Operator currently must manually `clawcode start <agent>` after every daemon restart for the finmentum-scope agents.

**Status (2026-05-01 16:34 PDT):** SHIPPED LIVE. Real root cause was simpler than any hypothesis: the per-agent capability-probe + heartbeat-reconnect paths spawn the broker shim using `ResolvedAgentConfig.mcpServers[].env` (the BASE shared-mcpServers env with the daemon's clawdbot-fleet token), not `AgentSessionConfig.mcpServers[].env` (which has Phase 100 `mcpEnvOverrides` resolved on top). For finmentum-scope agents, the agent's actual long-lived shim has `aa18cf6f` (Finmentum), but the heartbeat probe shim has `dcfc03f8` (clawdbot fleet) — broker sees drift every 60s heartbeat tick, rebinds, churns the pool. **Confirmed via /proc env audit:** ps showed each agent has exactly one long-lived shim with the CORRECT token; broker journal showed transient handshakes with WRONG token at heartbeat cadence (60s).

**Fix:** new `src/mcp/broker-shim-detect.ts` helper (`isBrokerPooledMcpServer` + `filterOutBrokerPooled`) detects the broker-shim signature (`command=clawcode` + `args includes "mcp-broker-shim"`) and skips it from per-agent probes. Applied at 4 sites:
1. `session-manager.ts` warm-path `mcpProbe` (filter before `performMcpReadinessHandshake`)
2. `session-manager.ts` agent-start capability probe (filter before serversByName Map construction)
3. `daemon.ts` on-demand mcp-status IPC handler
4. `heartbeat/checks/mcp-reconnect.ts` per-agent heartbeat tick

The broker has its own dedicated heartbeat (`heartbeat/checks/mcp-broker.ts`) that uses `getPoolStatus()` to verify pool aliveness without spawning probe shims — no coverage loss.

**Tests:** 9 new tests in `src/mcp/__tests__/broker-shim-detect.test.ts` — broker shim signature match, false-positive guards (clawcode-CLI MCPs that AREN'T broker-pooled like `clawcode mcp` / `browser-mcp`), third-party MCPs (npx/node/python), filter order preservation, edge cases (empty / all-shim arrays). 42/42 broker + 6/6 mcp-reconnect tests pass.

**Production verification (2026-05-01 16:34 PDT):** Daemon restarted with fix, then journaled for 60s+:
- `agent token rotated — rebinding` events: **0** (was 4-5/min pre-fix)
- All 4 priority agents (Admin Clawdy, fin-acquisition, research, fin-research) warm-path PASSED on first try (no manual `clawcode start` needed)
- fin-acquisition specifically: warm-path completed in 2311ms (vs 5245ms timeout pre-fix)
- Wake-order log fired correctly: `Admin Clawdy=1, fin-acquisition=2, research=3, fin-research=3, finmentum-content-creator=null`

**Pairs with shipped Phase 999.26.1** (drain delay before kill — see Phase 999.26 entry above) which absorbs any remaining transient probe-shim disconnects without churning the pool child.

### Phase 999.28: MCP probe wrapper group-kill — mcp-server-mysql grandchild leak (SHIPPED 2026-05-02)

**Goal:** Stop `checkMcpServerHealth` and `rpcCall` cleanup paths from leaking grandchildren into PPID=1. Both paths spawned the npm wrapper non-detached and only `child.kill("SIGKILL")` on the wrapper PID; the wrapper forks `sh -c` which forks `node /.../bin/mcp-server-mysql`, and that grandchild reparented to init holding its MariaDB connection open. With probes firing every 60s × 14 agents, the 999.14 orphan reaper sweep cadence couldn't keep up — zombies accumulated on clawdy.

**Trigger:** 2026-05-02 — operator surfaced via ultraplan: "mcp-mysql leak and 0 dreamlinks". Production observation: persistent `node mcp-server-mysql` processes attached to PID 1 across 14 agents holding MySQL connections idle.

**Fix:**
- `spawn(...)` now passes `detached: true` so the child is its own pgid leader. Combined with `child.unref()` so the one-shot probe doesn't pin the daemon's event loop.
- Cleanup replaces `child.kill("SIGKILL")` with `killGroup(child.pid, "SIGKILL", log)` from `src/mcp/process-tracker.ts` — `process.kill` on the negative PID hits wrapper + sh + node grandchildren together.
- Silent fallback Logger keeps existing call sites and tests unchanged (no deps churn).
- Linux-only regression tests use `/proc/<pid>/stat` (not signal 0) to detect post-SIGKILL state since zombies still respond to signal 0 in CI containers with delayed init reaping.

**PR:** [#4](https://github.com/jaskarn78/clawcode/pull/4) merged 2026-05-02 (commit `d15c8f1`); deployed to clawdy 2026-05-02.

**Tests:** 5 new Linux-only leak regression tests across `src/mcp/__tests__/health.test.ts` (2) and `src/mcp/__tests__/json-rpc-call.test.ts` (3). 9/9 pass.

**Files changed:** `src/mcp/health.ts`, `src/mcp/json-rpc-call.ts`, plus paired test files. 4 files, 389 insertions, 19 deletions.

**Status:** Shipped 2026-05-02 — live on clawdy. Per-probe killGroup eliminates grandchild reparenting; orphan reaper now has no slack to fall behind.

### Phase 999.29: Dream-pass adapter wiring — listRecentMemoryChunks + getRecentSummaries + applyAutoLinks (SHIPPED 2026-05-02)

**Goal:** Three IPC adapter functions in the run-dream-pass handler were stubbed to `return []` / `{ added: 0 }` from Phase 95-02 ("real link application is deferred to a future plan"). Result: every dream-pass embed posted "Wikilinks 0 applied" because the LLM was producing wikilinks but `applyAutoLinks` discarded them; `themedReflection` cited no data because `getRecentChunks`/`getRecentSummaries` returned empty arrays. Confirmed pattern across fin-acquisition dreams from 04-26 through 05-01: only 1 wikilink ever applied (on 04-28).

**Trigger:** 2026-05-02 — operator: every dream pass embed shows "Wikilinks 0 applied"; verbatim "No memory chunks, conversation summaries, or wikilink graph data were provided in this reflection cycle" in themed reflections.

**Fix:**
- New `MemoryStore.listRecentMemoryChunks(limit)` — reads `memory_chunks` ordered by `file_mtime_ms DESC` to feed the dream prompt.
- New `appendDreamWikilinks` writer in `src/manager/dream-graph-edges.ts` — persists path→path edges to `<memoryRoot>/graph-edges.json` with dedupe + atomic temp+rename. Dream-pass primitive already reads this file back as the "existing wikilinks" prompt section (`dream-pass.ts:222-224`), so this completes the round-trip.
- Daemon `getRecentSummaries` now hydrates from `conversationStore.listRecentTerminatedSessions(agent, limit)` + linked `memoryStore.getById(summaryMemoryId)`.

**PR:** [#3](https://github.com/jaskarn78/clawcode/pull/3) merged 2026-05-02 (commit `778c8c7`); deployed to clawdy 2026-05-02.

**Tests:** 2 new test files: `src/manager/__tests__/dream-graph-edges.test.ts` (6 cases — file-missing creation, dedupe, empty-input, all-duplicate, malformed-JSON tolerance, nested-mkdir) + `src/memory/__tests__/store.test.ts` additions for `listRecentMemoryChunks` (DESC ordering + limit + empty store). 71/71 pass.

**Files changed:** `src/manager/daemon.ts`, `src/manager/dream-graph-edges.ts` (new), `src/manager/dream-pass.ts` (Promise type widening), `src/memory/store.ts`. 6 files, 422 insertions, 16 deletions.

**Status:** Shipped 2026-05-02 — live on clawdy. Pairs with Phase 99-A (translator DB path fix) — together they unblock dream-pass `themedReflection` from citing real data, closing Phase 99 sub-scope J.

### Phase 999.30: Subagent relay on work-completion, not session-end (SHIPPED 2026-05-04)

**Note on number collision:** committed under tag `feat(999.25)` (commits `81975aa`, `12f4ac1`) but Phase 999.25 was already taken by "Agent boot wake-order priority". Renumbered to 999.30 in ROADMAP 2026-05-05. Commit-tag history preserved as-is.

**Goal:** Subagent results were delivered to operator hours late because the relay to the parent channel only fired on session-end. After this phase, operators see results within seconds (explicit tool) or 5 minutes (quiescence sweep fallback).

**Trigger:** 2026-05-04 — operator-reported relay latency. Subagent finished work, posted to its thread, but parent channel didn't see the relay until the subagent session ended (could be hours later).

**Three relay triggers, deduped via `binding.completedAt`:**
1. **Explicit `mcp__clawcode__subagent_complete({ agentName })` tool** — subagent calls when work is done. Daemon handler looks up binding, fires relay, stamps completedAt. Operator agents calling this get `{ ok: false, reason: "no-binding" }`.
2. **Quiescence sweep** — new module `src/manager/subagent-completion-sweep.ts` wired into the existing 60s `onTickAfter`. Bindings idle past `quiescenceMinutes` (default 5) get auto-relayed. Safety net for legacy subagents.
3. **Session-end callback** (existing) — now skips if `completedAt` is set; logs `skip-session-end-relay`.

Single source of truth: `src/manager/relay-and-mark-completed.ts`. Pure, idempotent helper used by both the IPC handler and the sweep.

**Schema:** `defaults.subagentCompletion.{enabled, quiescenceMinutes}`. Hot-reloadable. Env kill-switch `CLAWCODE_SUBAGENT_COMPLETION_DISABLE=1`.

**Back-compat:** `ThreadBinding.completedAt` is optional + nullable. Pre-Phase-999.30 bindings parse unchanged.

**PR:** [#9](https://github.com/jaskarn78/clawcode/pull/9) merged 2026-05-04 (commit `12f4ac1`).

**Status:** Shipped 2026-05-04 — code merged. Deploy status: TBD (depends on recent deploy state).

### Phase 999.31: `/ultra-plan` + `/ultra-review` slash commands at top level (SHIPPED 2026-05-04)

**Goal:** Surface the cloud `/ultraplan` and `/ultrareview` workflows as discoverable top-level slash commands instead of buried under `/get-shit-done` subcommands.

**Three-commit progression:**
- `b46acd9` — added `/ultra-plan` + `/ultra-review` as subcommands of `/get-shit-done`
- `709e5ce` — fix: `/ultra-plan` now routes to native `/ultraplan` (was incorrectly routing to `/oh-my-claudecode:ralplan`)
- `848a443` — fix: moved `/ultra-plan` + `/ultra-review` to top-level (not GSD subcommands), since they have their own workflow shape

**Status:** Shipped 2026-05-04. Slash commands now discoverable at top level.

### Phase 999.32: GSD consolidation into `/gsd-do` entry, remove `/clawcode-probe-fs` (SHIPPED 2026-05-04)

**Goal:** Consolidate the GSD entry surface into a single `/gsd-do` command (routes to the right GSD subcommand based on freeform input). Removes the standalone `/clawcode-probe-fs` slash command (functionality merged into the unified entry).

**Status:** Shipped 2026-05-04 (commit `584a20a`). Reduces operator decision overhead — one slash command instead of nine.

### Phase 999.33: Bound `preResolveAll` concurrency to 4 in-flight (SHIPPED 2026-05-04, partial boot-storm fix)

**Goal:** Boot-storm partial fix — secret resolver's `preResolveAll` was firing all in-flight resolutions in parallel during cold-restart, contributing to the cgroup memory pressure seen in the 2026-05-03 fleet incident. Cap parallelism at 4.

**Status:** Shipped 2026-05-04 (commit `eee88c2`). Marked partial fix because boot-storm has multiple contributors — this is one of several mitigations layered with Phase 109 (orphan reaper, preflight gate).

### Phase 999.34: Cross-agent IPC for subagent threads — addressable subagent identity (BACKLOG)

**Goal:** Enable agents to address messages to subagent thread sessions, not just registered top-level agents. Today `send_to_agent` / `delegate_task` / `ask_agent` accept an agent name from `clawcode.yaml`'s `agents:` registry. Subagents (spawned via `spawn_subagent_thread`) live as ephemeral `ThreadBinding` records keyed by `bindingId` + `threadId` — they have NO entry in the agent registry, so the messaging tools cannot reach them.

**Trigger (2026-05-05):** admin-clawdy attempted to post mid-task instructions into a `reelforge-build-end-to-end` subagent thread. The messaging tool rejected the subagent session name because it's not in the agent registry. Operator had to relay the message manually via local terminal — the exact failure mode Phase 999.30 eliminated for the reverse direction (subagent → operator).

**Why this matters (architectural, not just ergonomic):**
- Phase 999.30 shipped *parent → operator* relay on work-completion. The *parent → in-flight subagent* direction has no equivalent. Asymmetric IPC = manual relay tax.
- Multi-agent workflows where a planner agent iteratively guides a builder subagent (course-correct mid-task, hand off updated context, queue follow-on work) cannot happen autonomously today.
- Operator becomes a manual relay every time admin-clawdy or another planner agent needs to redirect a long-running subagent.
- The same gap blocks: peer → subagent (one builder talking to another), operator-from-different-channel → subagent (operator on `#admin-clawdy` reaching a subagent in a different thread without channel-hopping).

**Sub-scope candidates (refine during /gsd:discuss-phase):**
1. **Subagent addressing scheme.** Define the reference syntax. Options:
   - `<parent-agent>/<subagent-session-name>` (path-style, human-friendly)
   - `subagent:<bindingId>` (binding-id-style, canonical)
   - Both accepted with binding-id as the wire form (path-style is sugar resolved at IPC boundary)
2. **Registry lookup extension.** New IPC method `get-subagent-binding` returning enough metadata to dispatch a turn (parent agent, thread ID, current state, last activity). `getAgentConfig` / `dispatchTurn` etc. need a fork or wrapper that resolves subagent bindings as well as registered agents.
3. **Tool surface (pick one):**
   - Extend existing `send_to_agent` / `delegate_task` to accept the subagent reference forms (back-compat preserved; old callers unchanged)
   - Add new dedicated tools `send_to_subagent` / `delegate_to_subagent` (cleaner separation; explicit caller intent)
4. **Permission model.** Should ANY agent post to ANY subagent thread, or only the parent that spawned it? Default proposal: **parent-only, with `clawcode.yaml`-tagged "globally addressable" subagents as opt-in escape hatch**. Operator can mark long-running subagents as fleet-addressable for orchestration scenarios.
5. **Discoverability.** New tool `list_active_subagents([parentAgent])` so agents find session names without relying on operator memory or chat history scrubbing.
6. **Lifecycle envelope.** Send to a completed/timed-out subagent → structured error response. Mirror 999.30's `{ ok: false, reason: "subagent-completed" | "subagent-not-found" | "permission-denied" }` pattern.
7. **Discord-side compat.** When the subagent is paused waiting for next message (the actual blocker case), the message must arrive via the same Discord thread the subagent is reading from — not a side-channel. This means the IPC method ultimately posts to the bound thread, not directly to the subagent's stdin.

**Pre-existing primitives to reuse:**
- Phase 999.30 `src/manager/subagent-completion-sweep.ts` — already iterates active bindings; same iterator backs `list_active_subagents`
- `ThreadBinding` type from `src/discord/subagent-thread-spawner.ts`
- IPC pipeline from `delegate_task` (Phase 59) + the relay-and-mark-completed helper from 999.30
- `dispatchStream` + `ProgressiveMessageEditor` from quick task `260501-nfe` (the same pipeline 999.30 uses for parent → operator delivery)

**Status:** Backlog — captured 2026-05-05 from operator-reported failure (admin-clawdy → reelforge-build-end-to-end thread). Operator confirms message was relayed manually for now.

**Promotion target:** likely next milestone (v2.8?) tackling autonomous multi-agent orchestration. Pairs with Phase 999.19 (subagent cleanup / memory consolidation / delegate-channel routing) — both address making subagent thread management first-class. Could bundle.

**Risk callout:** permission model mistakes here have real blast radius — accidentally letting any agent post to any subagent thread breaks isolation guarantees subagents currently rely on. Operator decision on default permission model gates execution.

### Phase 999.40: Daemon-side response cache for repeated MCP tool calls (BACKLOG)

**Goal:** Cache MCP tool-call responses (e.g. `web_search`) at the daemon layer with content-keyed lookups. When an agent re-asks the same query within a TTL window, the daemon returns the cached result instead of re-hitting brave/exa/openai. Speeds up second-and-later identical queries from ~2-5s to <50ms. Helps both Node and Go shim runtimes equally — not Phase 110-specific.

**Trigger:** 2026-05-06 — during Phase 110 dev validation latency benchmark, observed Anthropic API + search-backend round-trip dominates per-turn latency (~2-5s of the ~3s typical turn). Repeated identical queries gave near-identical results from brave/exa, suggesting cache hits would be safe and fast. Operator request to add to backlog.

**Sub-scope candidates:**
1. **Cache key derivation** — content-hash of `(tool_name, normalized_query)`. For `web_search`, normalize query whitespace + case-fold. For `search_documents`, key on `(agent, query, top_k)`.
2. **TTL per tool** — config-driven defaults: `web_search` 5 min (fresh news matters), `search_documents` 30 min, `image_generate` 0 (always re-generate). Operator override per-tool.
3. **Storage** — better-sqlite3 in `~/.clawcode/manager/tool-cache.db`. Schema: `(key, tool, query, response_json, created_at, expires_at)`.
4. **Eviction** — LRU + size cap (e.g. 100 MB default). Evict expired entries on each lookup.
5. **Cache stamping** — response wrapped with `cached: true | { age_ms, source: "cache" }` so agents can decide whether to trust or refresh.
6. **Bypass mechanism** — agent can pass `bypass_cache: true` in tool args to force re-fetch.
7. **Per-agent isolation** — search results are public-data so cross-agent OK; document-search is per-agent.
8. **Observability** — `clawcode tool-cache-stats` CLI showing hit rate, size, top-cached keys.

**Why deferred:** out of Phase 110 scope (Phase 110 is shim runtime, not tool dispatch). Best done as standalone phase with independent rollout.

**Pre-existing primitives to reuse:**
- better-sqlite3 (already pinned, used for memory + tasks DBs)
- Phase 90 RRF retrieval (similar cache-on-content pattern)
- Phase 104 op:// cache (similar TTL + storage pattern)

**Promotion target:** future milestone (post-v2.7). No Phase 110 dependency.

### Phase 999.41: Generalize API-error-dominated-session guard to dream-pass + session-flush + all summarization paths (BACKLOG)

**Goal:** The "Credit balance is too low" / "API Error: 429" false-positive text keeps re-surfacing in Discord-visible content despite Phase 105's fix at `restart-greeting.ts:isApiErrorDominatedSession`. Phase 105 only guards the restart-greeting summarization path; other summarization sites (dream-pass `themedReflection`, session-flush summaries, possibly context-compaction summaries) don't apply the same guard, so when an agent's session history is API-error-dominated, those pipelines reliably produce misleading "Credit balance is too low" outputs even on OAuth/Max accounts where credit balance is not a real concept.

**Trigger:** 2026-05-06 — after the Phase 110 PM deploy + Brave fix, operator pinged ClawdyV2 to recall context of an earlier message. ClawdyV2 reported: *"my session flushes from earlier today are all 'Credit balance is too low' (no preserved content)"*. Operator suspects the same false-positive Haiku summarization is leaking into dream output too. Phase 105 (restart-greeting) hardened ONE summarization site; the underlying class of bug is "any LLM summarization of an API-error-dominated session reliably produces misleading 'credit balance' / 'auth failed' / 'rate limit' text."

**Sub-scope candidates:**

1. **Audit summarization sites.** Find every code path that takes session history (or any LLM-conversation transcript) and feeds it to Haiku/Sonnet for summarization. Known sites:
   - `src/manager/restart-greeting.ts` — already guarded (Phase 105)
   - `src/manager/dream-pass.ts` — runs a single-shot dream over agent's session via `dispatchTurn`; if the LLM returns a response containing API-error fingerprints, those land in `themedReflection`
   - **Session-flush summary** — operator-observed in screenshot; needs file-finder pass
   - **Context-compaction summary** (when agent hits context window) — possibly affected
   - **CLI `clawcode dream <agent>` direct invocation** — same dream-pass code path
   - **Memory consolidation** (Phase 999.39 dreams-path tied) — may share summarization shape

2. **Promote `isApiErrorDominatedSession` + `API_ERROR_FINGERPRINTS` to a shared module.** Currently lives at `src/manager/restart-greeting.ts:249-269`. Move to `src/shared/api-error-detection.ts` (or similar) so all summarization sites can import the same fingerprint set + 50%-threshold detector. Single source of truth for what "this session is API-error dominated" means.

3. **Per-site verbatim recovery message.** restart-greeting has `PLATFORM_ERROR_RECOVERY_MESSAGE`. dream-pass doesn't have an equivalent — when API-error-dominated, dream-pass should return `kind: "failed", error: "skipped: prior session was API-error dominated"` or a verbatim no-op themedReflection. Same for session-flush + context-compact.

4. **Output-side guard.** Some summarization outputs come from the LLM itself returning text that looks like an API error (e.g., Haiku summarizing "API Error: 401" → "Credit balance is too low"). Add an output-scan: after summarization completes, run `API_ERROR_FINGERPRINTS` on the SUMMARY itself; if matched, replace with the verbatim recovery message. Belt-and-suspenders against the LLM "obeying instructions" but still leaking the misleading phrase.

5. **Telemetry for API-error-dominated detections.** Counter metric: `summarization.api_error_dominated_detected{path=restart-greeting|dream|flush|compact}`. Helps confirm the guard is working in prod and surface platform-incident rates.

6. **Test fixture corpus.** Lock the canonical "API-error-dominated" sessions as test fixtures so all summarization paths regression-test against the same input set. Currently each path has its own (or zero) test coverage of this.

**Why deferred (not Phase 110):** Phase 110 is shim runtime, not summarization quality. Operator can keep doing what Phase 105 did — fix one path at a time when bitten — but the full audit + shared module is a separate phase.

**Pre-existing primitives to reuse:**
- `src/manager/restart-greeting.ts:isApiErrorDominatedSession` + `API_ERROR_FINGERPRINTS` (the canonical detector)
- `PLATFORM_ERROR_RECOVERY_MESSAGE` (the verbatim recovery shape)
- Phase 105 test corpus (`src/manager/__tests__/restart-greeting.test.ts:578` "detects 'Credit balance is too low'")

**Related backlog/phases:**
- Phase 105 (POLICY+COAL) — original Phase that introduced `isApiErrorDominatedSession`. This is its generalization.
- Phase 999.39 (memory consolidation fail-loud, dreams path) — overlapping subsystem; coordinate planning so the two don't fight over `dream-pass.ts`.
- Phase 107 (DREAM-OUT-03) — already added structured warn-log on parse-failed dream output; this phase extends to detect API-error-dominated INPUT before dispatch.

**Promotion target:** v2.7 maintenance window or sooner if frequency of operator-visible false positives accelerates.

### Untagged maintenance ships (2026-05-04 → 2026-05-05)

Three quick fixes shipped without a phase tag:
- **`716fb46` (PR #7) 2026-05-04** — Auto-prune spawned subagent threads after inactivity. Companion to Phase 999.30 (work-completion relay). Cleans up stale subagent thread state on the daemon.
- **`98ff1bc` (PR #8) 2026-05-04** — Hot-reload reaper dial fix: pass `newConfig` through `ConfigWatcher` so the orphan-claude reaper picks up live config changes without daemon restart. Closure-capture fix.
- **`bca9400` (PR #10) 2026-05-05** — Marketplace skip-empty-name: clawhub items with missing/empty `name` field caused marketplace UI to crash. Skip them silently with debug log.

### Phase 999.42: Hermes-parity memory + auto-skill gaps (BACKLOG)

**Source:** Competitive analysis of Hermes Agent (NousResearch, Feb 2026, 64K stars).
**Threat:** Hermes ships `hermes claw migrate` — directly imports `~/.openclaw`. Explicitly targeting ClawCode users.

**Three capability gaps to close:**

**A — FTS5 session archive**
Hermes stores every session in a SQLite FTS5 table, enabling full-text search across all past sessions at retrieval time. ClawCode uses flat MEMORY.md files — no cross-session search. Add a SQLite FTS5 archive layer to the memory pipeline.

**B — Auto-skill suggestion**
Hermes auto-creates skills when an agent uses 5+ tool calls in a single successful task (written via `skill_manage` tool with patch/edit/create actions). ClawCode skills are manually authored YAML. Add LLM-driven skill suggestion after repeated task patterns are detected.

**C — Skill patch/edit action**
Hermes supports progressive skill refinement (patch → edit → create). ClawCode skills are create-only. Add patch/edit lifecycle to the skill_manage equivalent.

**Priority:** Medium — architectural gaps, not feature requests. A is highest-value (retrieval quality directly affects agent performance).
