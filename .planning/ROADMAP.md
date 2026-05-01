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

### Phase 99: Memory translator + sync hygiene + restart-greeting fallback (deferred to v2.7)

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

**Sub-scope B — No automatic sync timer (Phase 91 promise unfulfilled):**
- Trigger: Phase 91's spec promised "5-min systemd timer + hourly conversation-turn translator via rsync over SSH." `systemctl list-timers` shows neither installed. The `clawcode sync run-once` and `translate-sessions` commands are CLI-only — no cron, no systemd timer. Last manual sync was 2026-04-24 22:02; nothing happened automatically until cutover today.
- Scope (decision required):
  - **Path 1 — install the timers** (matches Phase 91 spec): create `clawcode-sync.timer` (5min OnCalendar) + `clawcode-translate-sessions.timer` (hourly OnCalendar) as systemd user units. Wire installer into `clawcode init` or daemon-bootstrap. Update Phase 91 D-11 deprecation to also disable the timers when `authoritativeSide=deprecated`.
  - **Path 2 — document Phase 91 as manual-only** and finish cutover (Phase 98) for all remaining channels so sync becomes obsolete. Aligns with Phase 96 D-11 deprecation we already landed.
- Recommend Path 2 — sync becomes vestigial post-cutover; building auto-sync infrastructure for a deprecating subsystem is wasted work.

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

**Sub-scope E — Skills migration cross-host limitation (Phase 84 gap):**
- Trigger: Post-cutover, the user asked whether `finmentum-crm` skill was migrated. Investigation found that 15 finmentum skills' SKILL.md files DID copy to ClawCode side at `/home/clawcode/.clawcode/agents/finmentum/skills/<name>/SKILL.md` but were NOT registered in the agent's `skills:` field in clawcode.yaml AND were not symlinked to the canonical scan path `/home/clawcode/.clawcode/skills/<name>/`. Phase 84's `clawcode migrate openclaw skills` reported zero results when run on clawdy because OpenClaw lives on a separate host (claude-bot, 100.71.14.96).
- Recovery (manual, this session): scrubbed plaintext MySQL credentials from `finmentum-crm/SKILL.md`, symlinked all 15 skills from agent-workspace path to canonical scan path, added `skills:` field listing all 15 to fin-acquisition's agent block. Config-watcher auto-reloaded.
- Scope:
  - Extend `clawcode migrate openclaw skills` to support `--source <ssh-host>` for cross-host OpenClaw → ClawCode migration. Mirror Phase 91 `rsync over SSH` pattern.
  - OR document Phase 84 as "single-host migration only" + define a manual recipe (essentially what we did): rsync skills, symlink to canonical path, edit yaml `skills:` field, restart agent. Recipe should live in `.planning/runbooks/skills-cross-host-migration.md`.
  - Either way: the secret-scan must run cross-host (Phase 84 originally refused finmentum-crm BECAUSE it had plaintext MySQL creds — that gate must not be lost in the cross-host path).

**Sub-scope F — `/clawcode-status` data wiring (Phase 93 incomplete implementation):**
- Trigger: Operator ran `/clawcode-status` post-cutover. The 17-field embed (Phase 93 D-93-02-1) has SHAPE-parity with OpenClaw but most fields show `n/a` or `unknown` — the renderer hardcodes "n/a" for Fallbacks/Compactions/Tokens/Runner/Fast/Harness/Reasoning/Elevated/Queue and `data.X` field props are passed through as `undefined` for sessionId/lastActivityAt/effort/permissionMode.
- Field-by-field recovery analysis (recoverable vs not):
  - Recoverable from existing infra: Fallbacks (agent.fallbacks), Context % (Phase 53 zone tracker), Compactions (CompactionManager), Tokens (UsageTracker), Session ID + Last Activity (SessionHandle), Think (Phase 83 EffortStateStore), Reasoning (extended-thinking budget), Permissions (SDK setPermissionMode), Activation (turn trigger source), Queue depth (TurnDispatcher).
  - May not have ClawCode analog: Fast, Elevated (OpenClaw-specific concepts — design decision: drop the fields OR repurpose for ClawCode equivalents).
- Scope: extend the daemon's `/clawcode-status` IPC handler to thread per-agent telemetry into the renderer's data object. Add small API surface to existing managers (`CompactionManager.getCount(agent)`, `UsageTracker.getSessionTotals(agent)`, etc.). Update the renderer to drop hardcoded `n/a` and use the wired fields. Test coverage required (status renders into Discord embeds — operators see this constantly).

**Sub-scope G — Plaintext credential rotation batch (security):**
- Trigger: Multiple plaintext credentials surfaced during Phase 96/98 work. Operator deferred rotation to a Phase 99 batch.
- Credentials known exposed (each at multiple disk locations + in agent contexts):
  - Anthropic API key (`/home/jjagpal/.openclaw/openclaw.json` env block)
  - OpenAI API key (same)
  - Google API key (same)
  - MiniMax API key (same)
  - ElevenLabs API key (`openclaw.json` messages.tts.providers block)
  - Discord bot token (`openclaw.json` channels.discord.token, ~`MTQ3MDE2MjYzMDY4NDcwNDg4MQ.GLLa1Z.*`)
  - Discord webhook token for #finmentum-client-acquisition (`webhook ID 1490470938318344194`)
  - MySQL password (`KME6fka2nuy@cmu@pmj`) — was in finmentum-crm/SKILL.md (now scrubbed) AND in OpenClaw session jsonl files (now translated into ClawCode's conversation_turns) AND likely in heartbeat/audit logs. Scrubbed from active SKILL.md as of 2026-04-26.
  - SSH password (`686Shanghai`) — used inline in command-line invocations during Phase 96/98 work; now in shell history on multiple hosts.
- Scope:
  - Generate fresh credentials for each. Rotate in 1Password vault. Update env files / config refs. Restart affected services.
  - Set up SSH key auth for jjagpal user across both hosts (claude-bot + clawdy) so passwords never touch the command line.
  - Audit + redact translated session turns containing the old MySQL password (the conversation_turns table will need a one-shot SQL to redact occurrences in `content` columns).
  - Document rotation runbook for future credential exposure events.

**Sub-scope H — Cron schedule migration tooling (Phase 47/91 gap):**
- Trigger: Operator asked whether OpenClaw cron jobs migrated to ClawCode after Phase 98 cutover. Investigation found ZERO of OpenClaw's 44 enabled cron jobs (34 for fin-acquisition: 11 client birthdays, birthday card prep, holiday gift reminder, ADV/Reg S-P compliance reviews, Schwab data sync, etc.) had transferred. Phase 91 sync only covered FILES, not schedules.
- Recovery (manual, this session): wrote translation script that read `~/.openclaw/cron/jobs.json` (filtered to fin-acquisition + cron-kind + agentTurn-kind), shifted PT cron expressions +7h to UTC (PDT approximation), emitted ClawCode `scheduleEntrySchema` YAML, inserted into fin-acquisition's agent block. 30 of 34 migrated (4 `every`-kind interval schedules skipped). Disabled the 30 corresponding jobs on OpenClaw side to prevent duplicate firings.
- Scope:
  - Build first-class `clawcode migrate openclaw schedules` CLI subcommand (mirror of Phase 84 skills migration). Supports `--source <ssh-host>` for cross-host. Translates kind=cron AND kind=every. Writes via Phase 86 atomic-yaml-writer pattern.
  - Extend `scheduleEntrySchema` with optional `tz` field so the scheduler can do per-job tz resolution instead of the `+7h UTC offset hack` we used (off by 1h during PST winter season; acceptable for birthdays but not for time-sensitive ops jobs).
  - Add interval (`every`-kind) schedule support to `scheduleEntrySchema` (currently cron-only).
  - Idempotent — running migration twice doesn't duplicate. Match by name+cron tuple.

**Sub-scope I — Schedule prompts referencing OpenClaw-side paths/scripts:**
- Trigger: 2 of the migrated schedules (`schwab-sdd-auto-click` + `schwab-data-sync`) reference `python3 /home/jjagpal/.openclaw/workspace-finmentum/scripts/sync_schwab_twr.py` — a Python script that lives on claude-bot, not clawdy. Phase 96 D-05/D-06 fileAccess allows reading, but the script's runtime deps + execution context don't exist on clawdy.
- Scope (deferred decision):
  - **Path 1 — copy scripts to clawdy** with deps: cron-job runtime needs Python venv on clawdy with the right packages. Replicate the script + venv. Update path references to clawdy-side.
  - **Path 2 — invoke remote** (ssh from clawdy → claude-bot → run script): introduces dependency on claude-bot staying available + SSH access from the clawcode user. Risky.
  - **Path 3 — port to clawcode-native MCP/tool**: rewrite the Schwab sync logic as a ClawCode skill or MCP server. Cleanest long-term.
- Track which migrated schedules reference OpenClaw paths so they're not silently broken.

**Sub-scope J — Phase 95 dreaming source-material wiring + production hardening:**
- Trigger: Operator enabled dreaming for fin-acquisition. Three latent bugs surfaced + were hotfixed inline this session: (1) Haiku wraps JSON output in ```json``` markdown fence — strict JSON.parse rejects (`f38ae00`); (2) Haiku produces narrative prose preamble before JSON ("Picking up where we left off, …") — extract first balanced JSON object (`ca0122b`); (3) tightened system prompt to require strict JSON-only output (`509ff03`); (4) `entry.timestamp.toISOString()` undefined — wrapper lambda in IPC handler was discarding entry shape, dream-auto-apply was passing the FULL `{agentName, memoryRoot, entry}` but the lambda treated it all as `entry` (`c2d68f9`).
- After all 4 hotfixes: dream pass fires successfully end-to-end, log written to `memory/dreams/YYYY-MM-DD.md`.
- BUT the dream's `themedReflection` says "No memory chunks, conversation summaries, or wikilink graph data were provided in this reflection cycle." — meaning the dream-prompt-builder isn't pulling from the 6087 conversation_turns + 326 session-summaries we have. Likely related to sub-scope A (wrong-DB-path) — the prompt builder may be reading from the empty single-`memory/` DB instead of the agent's actual `memory/memory/` DB.
- Scope:
  - Fix dream-prompt-builder to read from the agent's actual MemoryStore + ConversationStore (single source of truth — same DB the agent + Phase 67 resume brief use).
  - Test fixture: spawn a dream pass after a synthetic conversation, assert `themedReflection` cites specific session content.
  - Add a `dream.minSourceContent` config (e.g., min 5 chunks OR min 1 session summary) — skip dream pass when source is too sparse to produce meaningful output.
  - Consider: Phase 99 sub-scope J could BLOCK on sub-scope A (wrong-DB-path) since the underlying issue is the same.

**Plans:** TBD (run /gsd:plan-phase 99 in v2.7 to break down)
**Status:** Backlog — opened 2026-04-25 evening during Phase 98 cutover recovery, expanded 2026-04-26 with sub-scopes E/F/G/H/I/J as more issues surfaced. None of these block production but all degrade UX or carry security/operational debt. Phase 99 priority below Phase 97 (cutover-blocking gaps come first).

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

### Phase 102: Meeting copilot deploy + ClawCode integration (finance-clawdy-coach)

**Goal:** Take the existing finance-clawdy-coach project (https://github.com/jaskarn78/finance-clawdy-coach — built but never deployed/tested) from on-disk to production-running, validate the live coaching pipeline through one real client meeting, then evaluate whether to integrate it with ClawCode's fin-acquisition agent (deeper memory continuity) or leave it standalone.

**Trigger:** Operator (Ramy at Finmentum) needs real-time coaching during client RIA calls. Mac-side BlackHole 2ch capture + Linux-side Deepgram Nova-2 STT + CoachingEngine (rules + Claude Haiku) + Discord webhook delivery + post-call CRM extraction (finance-clawdy FastAPI :9000) + MySQL upsert. Architecture is sound and tested in isolation (104 pytest tests); production validation is the missing piece.

**Pre-existing primitives we can reuse:**
- finance-clawdy-coach repo (FastAPI server + Mac listener + finance-clawdy CRM service, all complete)
- Deepgram API key (operator-provisioned, 1Password)
- Anthropic API key for the Haiku coaching brain (1Password — possibly already shared with ClawCode's daemon)
- Discord webhook URL for the coaching channel (existing)
- finmentum MySQL CRM (existing — the database that fin-acquisition's `finmentum-db` MCP server already reads)
- ClawCode's fin-acquisition agent on clawdy with vault-scoped 1Password (Phase 100-fu, just shipped) — knows clients, has memory, has the right tools
- ClawCode's `send_to_agent` IPC (Phase 30+) — used by Path C integration option

**Sub-scope candidates (refined during discuss-phase):**
1. **Path A — bare-bones deploy + smoke test (must-do).** Deploy server + finance-clawdy on clawdy host (or claude-bot), wire env vars (Deepgram + Anthropic + Discord webhook + MySQL), set up Mac client on operator's MacBook with BlackHole + listener.py launched-on-demand. Run ONE real client meeting end-to-end. Capture: did capture work? Was Deepgram latency acceptable? Were coaching prompts useful? Did finance-clawdy upsert correctly? Required for any further integration decisions.
2. **Path B — light integration: webhook → ClawCode thread.** Coaching webhook posts to a Discord thread bound to fin-acquisition. fin sees the live transcript (read_thread MCP), can answer ad-hoc questions in the same thread without disrupting coaching. Post-call summary same path. Trade-off: coaching stays autonomous (its own Haiku calls); ClawCode gets visibility but doesn't drive.
3. **Path C — deep integration: replace finance-clawdy LLM calls with `send_to_agent` IPC.** finance-clawdy stops calling Anthropic directly; dispatches turns to fin-acquisition. Pre-call: coaching engine asks fin "what should I know about <client>" → fin queries memory_lookup → returns context → coaching prompts now include client-specific recall. Post-call: transcript → fin processes with full continuity → updates fin's OWN memory (knowledge graph + tier promotion) AND the CRM. Couples the two projects but aligns memory/identity.
4. **Path-A operations:** systemd unit files for server + finance-clawdy, healthcheck integration with clawdy's existing monitoring, journalctl integration, `setup.sh` runbook adapted for clawdy host (it currently assumes interactive prompts).
5. **Mac client lifecycle:** how does the client launch? Operator runs `python listener.py` before each meeting? Could add a menu-bar wrapper (BitBar/SwiftBar?) to make it one-click. Or auto-detect via Google Calendar + auto-launch (deferred to v2 per repo's PROJECT.md).
6. **Cost gate / budget alarm:** Deepgram (~$0.43/hr Nova-2) + Anthropic Haiku coaching (~$0.001/UtteranceEnd × ~50 utterances/call = $0.05/call) + Anthropic for finance-clawdy CRM extraction (~$0.10/call). Per-call budget ~$0.50-0.70. Add a daily-cap circuit breaker to prevent runaway costs from a misconfigured loop.
7. **Privacy + audit:** "client must never know" constraint (per repo PROJECT.md). Verify no bot joins the meeting, no cloud transcripts persist beyond the JSONL spool retention window (operator-curated), no PII leaks into ClawCode's general-purpose memory if Path C is chosen (need a memory namespace/tag for "from-meeting-coach" content so it's properly access-controlled).
8. **First-real-call UAT:** the canonical regression artifact. Phase 102 ships when operator runs a real client meeting end-to-end and reports back: capture worked, coaching prompts were useful, finance-clawdy CRM upsert succeeded, summary embed matched reality.

**Plans:** TBD (run /gsd:plan-phase 102 in v2.7 to break down)

**Status:** Pending — opened 2026-04-28 evening after reviewing the finance-clawdy-coach repo (https://github.com/jaskarn78/finance-clawdy-coach). Highest-leverage operator-facing feature in v2.7 IF Path A validates the pipeline. Path B/C decision deferred until post-A.

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

## Backlog

Backlog items live outside the active phase sequence. Promote with `/gsd:review-backlog` when ready to plan, or use `/gsd:discuss-phase 999.x` to explore further.

### Phase 999.1: Agent output directives — freshness, derivative work, trust override, table avoidance (BACKLOG)

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

**Promotion target:** active milestone, will likely become Phase 104.

### Phase 999.2: a2a refactor — rename + sync-reply + correlation IDs (BACKLOG)

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

**Promotion target:** active milestone, will likely become **Phase 106** (deprioritized 2026-04-29 in favor of specialist routing — 999.3 → Phase 105 — which has a smaller blast radius and unblocks elevated-thinking delegation sooner).

### Phase 999.3: Specialist subagent routing via delegateTo (BACKLOG)

**Goal:** Let any agent delegate research/coding work to a dedicated standing specialist agent (`fin-research` for fin-* agents, `research` for non-fin) and have the streamed output land in a Discord thread in the **caller's** channel, with autoRelay summary back to caller's main channel.

**Approach:** extend existing `spawn_subagent_thread` MCP tool with `delegateTo: <agent_name>` param. When set, the spawned subagent inherits the target agent's config (model, soul, identity, skills, mcpServers) instead of the caller's. Thread is created in the caller's channel. Existing autoRelay infrastructure (Phase 99-M) handles the summary.

**Phase 2 extension** (not in scope for first iteration): per-agent `specialists: { research: <name>, coding: <name> }` config in `clawcode.yaml`, plus a `consult_specialist(role)` convenience tool that resolves to the right standing agent automatically.

**Trigger:** 2026-04-29 — operator wants admin-clawdy + fin-acquisition to delegate elevated-thinking research/coding to fin-research / research standing agents with thread streaming.

**Requirements:** [SPEC-01, SPEC-02, SPEC-03, SPEC-04, SPEC-05, SPEC-06, SPEC-07] — see 999.3-01-PLAN.md.

**Plans:** 1/1 plans complete

Plans:
- [x] 999.3-01-PLAN.md — RED+GREEN delegateTo branch in spawnInThread + 4-surface fan-through (types → spawner → daemon IPC → MCP tool); 10 new tests (DEL-01..DEL-10); recursion-guard invariant preserved.

**Promotion target:** active milestone, will likely become **Phase 105** (promoted 2026-04-29 ahead of 999.2 a2a refactor — smaller blast radius, leverages existing spawn_subagent_thread infra, unblocks elevated-thinking delegation sooner).

### Phase 999.4: /clawcode-usage accuracy fixes (BACKLOG)

**Goal:** Fix two bugs in Phase 103 Plan 03's `/clawcode-usage` embed exposed during live test on 2026-04-29:

1. **`resetsAt` unit mismatch.** SDK `SDKRateLimitInfo.resetsAt` is documented as ms epoch but actually arrives as **seconds** epoch from the OAuth Max session. `formatDistanceToNow` treats it as ms, producing wildly wrong reset times (e.g. "in 55 years"). Fix: detect+normalize at the RateLimitTracker boundary OR at the renderer boundary. Tests must pin both seconds-epoch and ms-epoch inputs.
2. **`utilization` derive when undefined.** SDK sometimes sends `status: "allowed"` + `resetsAt` + overage state without `utilization`. Renderer falls back to `n/a` even when other fields imply state. Investigate whether `utilization` can be derived from `surpassedThreshold` or aggregated `tokens_in/out` against subscription tier.

**Trigger:** 2026-04-29 live test post Phase 103 deploy — `/clawcode-usage` rendered "5-hour session — 🟢 \`──────────  n/a\` · resets in about 1 hour" when SDK had clearly returned a populated rate_limit_event.

**Requirements:** TBD — likely 3-4.

**Plans:** 0 plans (TBD — likely 1-2 plans when promoted)

**Promotion target:** active milestone, will likely become Phase 107 (after the 3 priority items above).

### Phase 999.5: /clawcode-status finish-up — Fallbacks + remaining no-source fields (BACKLOG)

**Goal:** Wire the last honest-`n/a` items in `/clawcode-status` once data sources exist, OR document them permanently as "no source" with an explicit comment. Currently the only `n/a` line is `🔄 Fallbacks: n/a` (Phase 103 Plan 01 left as honest-n/a — Research §11 noted no current source for fallback count). After production runs in for a few days, audit for any other fields that settle into having no source and either wire them or convert them to documented permanent-n/a.

**Trigger:** 2026-04-29 — Phase 103 closure noted Fallbacks as the only honest-n/a remaining; user wants to revisit after production observation period.

**Requirements:** TBD — likely 2-3.

**Plans:** 0 plans (TBD — 1 plan when promoted)

**Promotion target:** active milestone, can wait until production has been observed for ~1 week.

### Phase 999.6: Auto pre-deploy snapshot + post-deploy restore of running-agent state (BACKLOG)

**Goal:** Make every production deploy preserve the runtime list of running agents and restore them on daemon boot, independent of static `autoStart` config. Currently `autoStart=false` agents that an operator manually started for the day get lost across a `clawcode update --restart` because the daemon honors only the static config on boot.

**Approach (sketch):**

1. New `snapshot-running-agents` IPC method (or auto-fire on `stop-all` IPC) writes `/home/clawcode/.clawcode/manager/pre-deploy-snapshot.json` with `{ snapshotAt, runningAgents: [name, sessionId?, ...] }`.
2. `clawcode update` calls the snapshot before `stop-all` (or `stop-all` does it implicitly).
3. Daemon boot reads the snapshot if it exists:
   - For each name in the snapshot, override the static `autoStart` flag and start the agent
   - After all listed agents start (or fail), DELETE the snapshot so the next normal restart honors `autoStart` config again
4. CLI affordance: `clawcode update --restart` becomes a one-shot "save state, deploy, restore state" command.

**Trigger:** 2026-04-29 — operator pain during today's two prod deploys: `autoStart=false` agents that were running (e.g., research-clawdy, fin-research) didn't come back automatically, requiring manual restart.

**Requirements:** TBD — likely 4-5 (SNAP-01..SNAP-05).

**Plans:** 0 plans (TBD — likely 1-2 plans when promoted)

**Promotion target:** active milestone, queue after Phase 106 (a2a refactor) since Phase 105 + 106 are higher operator-pain priorities. Could also be a quick task if scope stays small.

### Phase 999.7: Context-audit telemetry pipeline restoration + tool-call latency audit (BACKLOG)

**Goal:** Two related observability gaps surfaced during the 2026-04-29 health audit:

1. **`clawcode context-audit` returns `sampledTurns: 0`** for all agents on prod — the per-turn per-section token-count telemetry pipe (Phase 1.7 Plan 03 infrastructure) isn't capturing data. The CLI infrastructure works, the data table exists, but no writes are happening. Investigate where the write-side broke.
2. **Tool-call p95 latency is 216-238s** (Admin Clawdy + fin-acquisition). Not directive-related (Phase 104 cache behavior is healthy at 70-77% hit rate post-deploy). This is MCP/browser/search roundtrip time. Worth profiling per-tool to see whether specific tools dominate the tail.

**Trigger:** 2026-04-29 — operator health audit before Phase 106 deploy. Memory graph linking confirmed healthy (527-1426 memories per agent, 4.6K-9.6K links, auto-linker active). Cache behavior healthy. But context-audit observability is dead and tool latency is slow.

**Requirements:** TBD — likely 4-6.

**Plans:** 0 plans (TBD — likely 1-2 plans when promoted: one for context-audit pipeline, one for tool-call profiling)

**Promotion target:** active milestone, queue after Phase 106. Can also be split into two quick tasks if scope stays narrow.

**Side-finding (informational, not blocking):** Prefix-hash didn't visibly change at the Phase 104 deploy boundary (still `92b7...` from Phase 103). Either Phase 104 directives are in a part of the prefix excluded from the hash computation, or they're landing in a different position than expected. Cache behavior + token telemetry confirm the directives ARE in the prompt, but understanding why the hash is stable across the deploy boundary is worth a quick investigation when this phase opens.

### Phase 999.8: Dashboard knowledge-graph fixes — node cap + tier colors + tier maintenance (BACKLOG)

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

**Promotion target:** active milestone, will likely become **Phase 107**. Bundle deploy with Phases 105 + 106 if scope stays small.

### Phase 999.9: Shared 1password-mcp by service-account scope (BACKLOG)

**Goal:** Pool one shared `1password-mcp` subprocess per unique `OP_SERVICE_ACCOUNT_TOKEN` across agents instead of spawning a fresh instance per agent. In current config, this drops 9 instances → 2 (default account + finmentum scope), reducing memory + fd + process count and capping fan-out load against the 1Password read API during boot storms and concurrent tool use.

**Why now:** Surfaced 2026-04-30 during FCC migration — three concurrent `1password-mcp` processes were running against the same service-account quota; combined with a daemon crash-loop that re-resolved every `op://` reference per restart, our service account hit a long-tail rate-limit window that blocked ALL read operations for ~10 minutes. Per-token pooling is the structural fix; daemon-side secret cache (separate phase) is the boot-time fix.

**Requirements:** TBD — to be derived in `/gsd:discuss-phase 999.9`.

**Open questions to settle in discuss-phase:**
- Does the MCP protocol natively support multi-client over a single stdio transport, or do we need a fan-out proxy that brokers session IDs?
- Shutdown ordering when the last agent referencing a pool exits — drain immediately or keep warm for a TTL?
- Blast radius — an MCP crash now affects N agents instead of 1. What's the recovery story (restart pool, fail individual tool calls, both)?
- Per-tool concurrency limits inside the shared instance to keep one chatty agent from starving the others.
- Per-agent audit/trace continuity when N agents share one MCP — how do tool-call traces stay attributable to the originating Turn?

**Plans:** 4 plans

Plans:
- [x] 999.13-00-PLAN.md — Wave 0 RED tests for both pillars (DELEG + TZ)
- [x] 999.13-01-PLAN.md — Pillar A GREEN: delegates schema + renderer + injection (DELEG-01..04)
- [x] 999.13-02-PLAN.md — Pillar B GREEN: agent-visible TZ helper + 5 site conversions (TZ-01..05)
- [ ] 999.13-03-PLAN.md — Wave 3 gate + operator-approved deploy + journalctl smoke

**Promotion target:** active milestone, sequence after Phase 104 daemon-side secret cache + retry/backoff — that fix removes the boot-time pressure and lets this phase focus purely on the runtime pooling design.

### Phase 104: Daemon-side op:// secret cache + retry/backoff (BACKLOG)

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

**Promotion target:** active milestone, sequence BEFORE Phase 999.9 (shared 1password-mcp pooling). High operator-impact: makes deploys + restarts robust against bursty 1P behavior with minimal architectural change (~50 lines around the existing `op read` site).

### Phase 105: Trigger-policy default-allow + QUEUE_FULL coalescer storm fix (BACKLOG)

**Goal:** Two production-impact bugs observed on clawdy 2026-04-30, both in the core dispatch hot path. Ship as a coherent "performance + functionality unblock" patch. (Original 105 scope included two more items — cross-agent IPC channel delivery + inbox heartbeat timeout — those are deferred to Phase 999.12 since they have lower operator impact and can ship independently.)

1. **Trigger policy fail-closes when `~clawcode/.clawcode/policies.yaml` is absent.** `daemon.ts:2033` falls back to `new PolicyEvaluator([], configuredAgentNames)`; with empty rules every event hits the final `return { allow: false, reason: "no matching rule" }` branch in `policy-evaluator.ts`. Today's journal shows the 09:00 fin-acquisition standup cron and the 08:26 finmentum-content-creator one-shot reminder both rejected this way — **every scheduler/reminder/calendar/inbox event silently dropped** for every agent. Switch the missing-file fallback to the default-allow semantic (allow if `targetAgent` is in `configuredAgents`) — `evaluatePolicy()` already implements it at `policy-evaluator.ts:18127`. Replace the misleading `"using default policy"` log line.

2. **QUEUE_FULL coalescer runaway recursive retry storm.** Today 09:47–09:58 PT, fin-acquisition was processing one slow turn while ~10 user messages arrived in burst. The Discord-bridge `streamAndPostResponse` drain block re-tries every ~150ms, hits `QUEUE_FULL` on the depth-2 SerialTurnQueue, throws the payload back into the `messageCoalescer`, and re-enters — each iteration **wraps the prior failed payload in another `[Combined: 1 message received during prior turn]\n\n(1) ...` header** (verified +54 chars/iteration in journal: 9607 → 8454 → 8508 → 8562 → 8616 → ... → 8832). Daemon CPU spikes; the eventual successful turn receives a multiply-wrapped corrupted payload. Fix: idempotent coalesce (skip wrapping if payload already starts with `[Combined:`), wait for in-flight slot via `SerialTurnQueue.hasInFlight()` before recursing, cap drain depth at N to prevent unbounded retry. Preserve the legitimate "user sent 3 messages while agent was working" combine-into-one-payload feature.

**Trigger:** 2026-04-30 — operator reported "scheduled reminders never fire" + later "fin-acquisition slowdown / 9-min turn". Diagnosed via SSH journalctl on clawdy in this session. Admin Clawdy mis-attributed the slowdown to Anthropic credits — actually QUEUE_FULL retry storm; "Credit balance is too low" string Admin Clawdy saw is from `restart-greeting.ts:API_ERROR_FINGERPRINTS` regex matching old session content, not live API responses.

**Requirements:** [POLICY-01 default-allow fallback, POLICY-02 boot log clarity, POLICY-03 PolicyWatcher hot-reload back-compat; COAL-01 idempotent coalesce wrapper detection, COAL-02 wait-for-in-flight gate, COAL-03 drain depth cap, COAL-04 storm warning log] — see 105-PLAN.md when planned.

**Plans:** 3/4 plans executed

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

**Promotion target:** active milestone — highest operator impact in the 999.x backlog. Without (1) every cron/reminder is invisibly dropped (every scheduled feature broken across all 11 agents). Without (2) the daemon enters a CPU-burning recursive loop under bursty load and the eventual turn receives corrupted nested-wrapper payload. Both are tiny diffs (~5 lines for POLICY, ~30 for COAL) with massive ROI. Sequence after Phase 104 (already complete) since 1P fix removes a confounding factor.

### Phase 999.12: Cross-agent IPC channel delivery + heartbeat inbox timeout (BACKLOG)

**Goal:** Two operator-visible orchestration / observability fixes split out of the original 105 scope to keep that phase tightly focused on infrastructure perf.

1. **Cross-agent IPC `dispatchTurn()` returns response to caller, never posts to target's bound Discord channel.** Phase 999.2 renamed `sendToAgent` → `dispatchTurn` and the Discord-bridge path uses `streamFromAgent` (which DOES post). At 2026-04-30 09:14:57 admin-clawdy invoked `dispatchTurn` → fin-acquisition with 971 chars; fin-acq replied 1087 chars at 09:15:55 — visible in caller's tool result, **never posted in #finmentum-client-acquisition**. Mirror the Phase 100 follow-up `triggerDeliveryFn` pattern: add an optional delivery callback that routes the response to the target agent's bound channel via webhook (preferred) → bot-direct fallback. Caller-only (RPC) semantics stay the default; channel delivery is opt-in via flag (`mirror_to_target_channel: true` from Phase 999.2 backlog text).

2. **Heartbeat inbox check 10s timeout is too tight for cross-agent turns.** At 2026-04-30 09:15:07 (10s after dispatchTurn started) the inbox check logged `"heartbeat check critical"` while fin-acq was mid-turn; the turn completed normally at 09:15:55. Either bump timeout to ≥60s, gate the check on whether the agent is actively responding (use `SerialTurnQueue.hasInFlight()`), or move to event-driven (subscribe to `agent responded` rather than poll inbox).

**Trigger:** Split out of original 105 during 2026-04-30 prioritization — 105 re-scoped to POLICY + coalescer (highest-impact perf/functionality), these two items deferred since they have lower blast radius.

**Requirements:** [IPC-01 deliveryFn for dispatchTurn, IPC-02 mirror flag, IPC-03 webhook→bot fallback parity with triggerDeliveryFn; HB-01 inbox timeout bump, HB-02 active-turn awareness] — see 999.12-PLAN.md when planned.

**Plans:** 4 plans

Plans:
- [x] 999.13-00-PLAN.md — Wave 0 RED tests for both pillars (DELEG + TZ)
- [x] 999.13-01-PLAN.md — Pillar A GREEN: delegates schema + renderer + injection (DELEG-01..04)
- [ ] 999.13-02-PLAN.md — Pillar B GREEN: agent-visible TZ helper + 5 site conversions (TZ-01..05)
- [ ] 999.13-03-PLAN.md — Wave 3 gate + operator-approved deploy + journalctl smoke

**Promotion target:** active milestone — sequence AFTER Phase 105. Medium operator impact: blocks one orchestration pattern (admin-clawdy → fin-acq channel mirror) and produces noisy false-critical heartbeat logs, but neither blocks core scheduler/IPC functionality the way 105 does.

### Phase 999.13: Extendible specialist delegate map + agent-context timezone rendering (BACKLOG)

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
- [ ] 999.13-01-PLAN.md — Pillar A GREEN: delegates schema + renderer + injection (DELEG-01..04)
- [ ] 999.13-02-PLAN.md — Pillar B GREEN: agent-visible TZ helper + 5 site conversions (TZ-01..05)
- [ ] 999.13-03-PLAN.md — Wave 3 gate + operator-approved deploy + journalctl smoke

**Promotion target:** active milestone — high operator impact. Without (A) Ramy's deep-dive workflow stays inline-only with no fin-research isolation; without (B) every agent burns prompt budget on UTC→PT conversion every turn. Sequence after Phase 105 (already complete) and Phase 999.12 (queued) since both pillars touch the same session-prompt-builder + serialization layer.

### Phase 999.14: MCP server child process lifecycle hardening (BACKLOG)

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

**Plans:** 2/3 plans executed

Plans:
- [x] 999.14-00-PLAN.md — Wave 0: process-tracker + orphan-reaper + proc-scan modules + RED tests (MCP-01/02/03/06 substrate). To extend with: thread-binding sweeper module + MCP-08/09 RED tests.
- [x] 999.14-01-PLAN.md — Wave 1: daemon boot wiring (MCP-05 boot scan, MCP-03 reaper interval), per-agent register (MCP-01), persistent-handle disconnect (MCP-02), shutdown cleanup (MCP-04). To extend with: MCP-08 cleanup-failure prune, MCP-09 stale-binding sweep, MCP-10 CLI commands.
- [ ] 999.14-02-PLAN.md — Wave 2: full-suite gate + operator-approved bundled deploy (with 999.13) + 5× restart soak on clawdy (MCP-06/07). To extend smoke: simulate Discord 50001 → registry pruned; force a stale binding → MCP-09 sweeps it.

**Promotion target:** active milestone — high operator impact (recurring incident, takes down all finmentum agents when MariaDB saturates). Sequence: independent of 999.12 and 999.13. Could ship anytime. Pairs with 999.9 (shared 1password-mcp pooling) since both touch MCP server lifecycle.

### Phase 999.15: MCP child PID tracking — full reconciliation, self-healing, and operator visibility (BACKLOG)

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

**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

**Promotion target:** active milestone — sequence after 999.14 since this builds on its substrate (proc-scan, process-tracker, orphan-reaper). Medium operator impact: today the cosmetic staleness is hidden by cmdline-based orphan detection, but graceful-shutdown reliability + per-agent restart cleanup will degrade as the fleet scales (more agents = more SDK-respawn races = more leaked MCP children on agent-restart). Pairs naturally with 999.9 (shared 1password-mcp pooling) since both touch MCP server lifecycle architecture.
