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
