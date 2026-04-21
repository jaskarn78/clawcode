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
- :hammer: **v2.2 OpenClaw Parity & Polish** - Phases 83-88 (opened 2026-04-21)

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

### v2.2 OpenClaw Parity & Polish (Phases 83-88) - ACTIVE

- [x] **Phase 83: Extended-Thinking Effort Mapping** — Close the P0 silent no-op at persistent-session-handle.ts:599; wire `/clawcode-effort` through to SDK `Query.setMaxThinkingTokens()`; SDK canary for Phases 86/87. (completed 2026-04-21)
- [x] **Phase 84: Skills Library Migration** — Port 5 P1 OpenClaw skills into ClawCode via `clawcode migrate openclaw skills`; secret-scan gated; reuses v2.1 atomic-writer + ledger patterns. (completed 2026-04-21)
- [x] **Phase 85: MCP Tool Awareness & Reliability** — Fix phantom-error class ("1Password isn't logged in" when it is); readiness gate, health-check heartbeat reconnect, system-prompt tool-status surface. (completed 2026-04-21)
- [x] **Phase 86: Dual Discord Model Picker (Core)** — Replace LLM-prompt routing with direct IPC dispatch; add `allowedModels` schema field; atomic YAML persistence; locks unified `clawcode-*` namespace before Phase 87. (completed 2026-04-21)
- [ ] **Phase 87: Native CC Slash Commands** — Register SDK-exposed commands as per-agent Discord slash commands; dispatch-split control-plane vs prompt-channel; unify duplicate clawcode-* commands; requires 30-min SDK spike (CMD-00) first.
- [x] **Phase 88: Skills Marketplace** — `/clawcode-skills-browse` Discord picker that runs the Phase 84 migration utility against a single skill; atomic post-install `skills:` list update + hot-reload. (completed 2026-04-21)

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

### Phase 83: Extended-Thinking Effort Mapping
**Goal**: Users can change a running agent's reasoning effort from Discord and have it actually take effect on the next SDK turn — including the "off" disable, the `auto` reset, per-skill overrides, and fork quarantine.
**Depends on**: Nothing (first phase of v2.2; isolated surface)
**Requirements**: EFFORT-01, EFFORT-02, EFFORT-03, EFFORT-04, EFFORT-05, EFFORT-06, EFFORT-07, UI-01 (effort picker UI)
**Success Criteria** (what must be TRUE):
  1. `/clawcode-effort <level>` observably changes SDK thinking-token behavior on the next turn (verified by a query-options spy test; not just the stored level)
  2. `/clawcode-effort off` forces `MAX_THINKING_TOKENS=0` and thinking is fully disabled for that agent's next turn
  3. `/clawcode-effort auto` resets to model default; the agent's next turn carries no runtime thinking cap
  4. An agent restart re-applies the persisted effort level from either `clawcode.yaml` `agents[*].effort` / `defaults.effort` or the runtime state file — no regression to default
  5. A v1.5 fork-to-Opus call initiated at `effort=max` on the parent launches the Opus advisor at the agent default, not `max` (cost-spike prevention verified via fork config test)
  6. `/clawcode-status` shows the current effort level for every agent, and a SKILL.md `effort:` frontmatter override takes effect for turns invoking that skill then reverts at turn boundary
**Plans**: 3 plans
- [x] 83-01-PLAN.md — Schema extension (7 effort levels) + P0 SDK wire (Query.setMaxThinkingTokens spy test)
- [x] 83-02-PLAN.md — Runtime effort persistence across restart + fork quarantine
- [x] 83-03-PLAN.md — UI-01 StringChoices picker + effort in /clawcode-status + per-skill effort frontmatter
**UI hint**: yes

### Phase 84: Skills Library Migration
**Goal**: Operator can port the 5 P1 OpenClaw skills (`finmentum-crm`, `new-reel`, `frontend-design`, `self-improving-agent`, `tuya-ac`) into ClawCode via a gated CLI that's safe to re-run and emits an auditable report.
**Depends on**: Nothing (CLI-only; independent of effort/model/CMD work)
**Requirements**: SKILL-01, SKILL-02, SKILL-03, SKILL-04, SKILL-05, SKILL-06, SKILL-07, SKILL-08
**Success Criteria** (what must be TRUE):
  1. `clawcode migrate openclaw skills apply` copies the 5 P1 skills into ClawCode's skill catalog and each resolves in the catalog of every agent it was linked to (per-agent linker verification passes)
  2. `finmentum-crm` is blocked with a refusal report while its SKILL.md contains literal MySQL credentials; once the creds are moved to MCP env/op:// refs, the copy proceeds
  3. `tuya-ac` SKILL.md has `name:` + `description:` frontmatter after migration (normalization applied); the other four skills' frontmatter is preserved untouched
  4. Re-running `apply` against the already-migrated source produces zero filesystem writes (ledger-driven idempotency; hash-compared)
  5. `.planning/milestones/v2.2-skills-migration-report.md` exists and lists per-skill outcome (migrated / skipped / failed-secret-scan / deprecated) plus per-agent link status
  6. Finmentum-scoped skills (`finmentum-crm`, `new-reel`) are linked only to Finmentum agents by default; `~/.openclaw/skills/` mtime is unchanged (source-tree read-only invariant verified post-run)
**Plans**: 3 plans
- [x] 84-01-PLAN.md — CLI scaffold + secret-scan gate + JSONL ledger + fs-guard (SKILL-01, SKILL-02, SKILL-05, SKILL-07)
- [x] 84-02-PLAN.md — Transformer (tuya-ac frontmatter) + copy + per-agent linker verification + scope tags + .learnings dedup (SKILL-03, SKILL-04, SKILL-08)
- [x] 84-03-PLAN.md — Migration report generator at .planning/milestones/v2.2-skills-migration-report.md (SKILL-06)

### Phase 85: MCP Tool Awareness & Reliability
**Goal**: Eliminate the phantom-error class where agents claim "1Password isn't logged in" / "MCP not configured" / "key expired" while every MCP server is actually healthy; agents only report an MCP error when the server returned one.
**Depends on**: Nothing (uses v1.3 MCP health-check infra + v1.7 two-block prompt assembly; no cross-feature dependency)
**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05, TOOL-06, TOOL-07
**Success Criteria** (what must be TRUE):
  1. An agent with a misconfigured mandatory MCP server never reaches `status: ready` — daemon refuses to flip the registry until every mandatory MCP passes JSON-RPC `initialize` (extends the v1.7 warm-path gate)
  2. A running agent's system prompt shows a live MCP tool-status table (server name, readiness, exposed tool names) placed inside the v1.7 stable prefix so it survives compaction
  3. When a real MCP tool call fails, the agent's tool-result contains the actual JSON-RPC error code + message verbatim (not a generic "tool unavailable"); pinned via a regression test
  4. When an MCP server drops, the v1.3 health-check heartbeat auto-reconnects it and the reconnect outcome surfaces in `/clawcode-status` within one heartbeat cycle
  5. `/clawcode-tools` lists every configured MCP server with live status (ready / degraded / failed), last-successful-call timestamp, and recent failure count — surfacing any phantom-error contradiction to the operator
**Plans**: 3 plans
- [x] 85-01-PLAN.md — Readiness gate (JSON-RPC initialize on startup, mandatory vs optional classification) + heartbeat reconnect + verbatim JSON-RPC error pass-through (TOOL-01, TOOL-03, TOOL-04)
- [x] 85-02-PLAN.md — System prompt assembly: pre-authenticated framing + live tool-status table + verbatim-error rule in v1.7 stable cached prefix (TOOL-02, TOOL-05, TOOL-07)
- [x] 85-03-PLAN.md — /clawcode-tools Discord slash (EmbedBuilder, UI-01) + clawcode tools CLI parity (TOOL-06 + UI-01)

### Phase 86: Dual Discord Model Picker (Core)
**Goal**: Users can change a running agent's model from Discord via a direct IPC dispatch (no LLM-prompt round-trip), restricted to the per-agent `allowedModels` allowlist, persisted atomically to `clawcode.yaml`, with cache-invalidation UX that mirrors native `/model`.
**Depends on**: Phase 83 (SDK canary — mid-session `Query.setModel()` concurrency validated by the effort-mapping wiring)
**Requirements**: MODEL-01, MODEL-02, MODEL-03, MODEL-04, MODEL-05, MODEL-06, MODEL-07, UI-01 (model picker UI)
**Success Criteria** (what must be TRUE):
  1. `/clawcode-model` with no argument opens a Discord `StringSelectMenuBuilder` menu showing the bound agent's `allowedModels` (max 25 per Discord UI cap); selection dispatches via IPC `SessionManager.setModelForAgent()` → `SessionHandle.setModel()` → SDK `Query.setModel()` — no LLM prompt path
  2. `/clawcode-model <model-not-in-allowlist>` is rejected with an ephemeral error listing allowed values; the allowlist is read from `agents[*].allowedModels` (or `defaults.allowedModels` fallback)
  3. A model change during an active conversation shows an ephemeral confirmation prompt warning about prompt-cache invalidation (mirrors native `/model` behavior); on confirm, the new model is written to `clawcode.yaml` via the v2.1 atomic temp+rename writer (comments preserved, secret-guard passes)
  4. After daemon restart the persisted model is honored (`/clawcode-status` shows the new model for the agent); hot-reload classification for `agents.*.allowedModels` is explicit and does not trigger an unintended session restart
  5. v2.1 migrated configs (15 agents) parse unchanged — `allowedModels` is additive and optional; `clawcode migrate openclaw verify` still passes after the schema extension
**Plans**: 3 plans
- [x] 86-01-PLAN.md — Schema allowedModels + SessionHandle.setModel SDK wire (spy-test canary per Phase 83 blueprint) + ModelNotAllowedError (MODEL-01, MODEL-03, MODEL-06)
- [x] 86-02-PLAN.md — Atomic YAML persistence (updateAgentModel) + /clawcode-status live model line (MODEL-04, MODEL-07)
- [x] 86-03-PLAN.md — Discord StringSelectMenuBuilder picker + cache-invalidation button confirmation (MODEL-02, MODEL-05 + UI-01 co-validation)
**UI hint**: yes

### Phase 87: Native CC Slash Commands
**Goal**: Every SDK-reported slash command (per `system/init.slash_commands`) is registered as a per-agent Discord slash command with the `clawcode-` prefix, dispatched through the correct channel (control-plane SDK method vs prompt-channel TurnDispatcher), with existing duplicate clawcode-* commands unified onto the native path.
**Depends on**: Phase 83 (effort-mapping SDK canary), Phase 86 (model picker — unifies `clawcode-model` + locks namespace)
**Requirements**: CMD-00, CMD-01, CMD-02, CMD-03, CMD-04, CMD-05, CMD-06, CMD-07, UI-01 (slash command UI surface)
**Success Criteria** (what must be TRUE):
  1. A 30-minute SDK spike confirming mid-session `Query.setModel()` / `Query.setPermissionMode()` / `Query.setMaxThinkingTokens()` concurrency safety is committed to `.planning/research/CMD-SDK-SPIKE.md` before any implementation code lands
  2. On agent session start, ClawCode reads `system/init.slash_commands` and registers each as a `clawcode-<name>` Discord slash command; a static-grep regression test rejects any hardcoded native-command list in code
  3. Control-plane commands (`/model`, `/permissions`, `/effort`) dispatch via the corresponding SDK `Query.setX()` method; prompt-channel commands stream through the existing `TurnDispatcher` with output surfaced via the v1.7 `ProgressiveMessageEditor`
  4. The four existing duplicates (`clawcode-compact`, `clawcode-usage`, `clawcode-model`, `clawcode-effort`) are unified onto the native SDK dispatch path — the old LLM-prompt routing is removed
  5. Per-agent SECURITY.md ACLs gate command registration: destructive or admin-only commands (`/init`, `/security-review`, `/batch`) are not registered on agents whose ACL forbids them; across the 15-agent fleet the Discord 100-command-per-guild cap is respected via per-guild name-dedupe
**Plans**: TBD
**UI hint**: yes

### Phase 88: Skills Marketplace
**Goal**: Discord users can browse available skills via `/clawcode-skills-browse` and install one to the bound agent with a single select-menu interaction; install runs the Phase 84 migration pipeline (secret-scan + frontmatter + idempotency) against just the chosen skill.
**Depends on**: Phase 84 (reuses the skills migration utility end-to-end), Phase 86 (atomic YAML writer already proven for `allowedModels` — same pattern used for `skills:` list updates)
**Requirements**: MKT-01, MKT-02, MKT-03, MKT-04, MKT-05, MKT-06, MKT-07, UI-01 (skills browser + skills picker UI)
**Success Criteria** (what must be TRUE):
  1. `/clawcode-skills-browse` opens a Discord `StringSelectMenuBuilder` (or autocomplete on large catalogs) showing skill name + short description + category; skills source resolves from a configurable list in `clawcode.yaml` (initially ClawCode's local skills catalog unified with `~/.openclaw/skills/`)
  2. Selecting a skill runs the Phase 84 migration utility against that one skill — secret-scan, frontmatter normalization, and hash-based idempotency all enforced; skills that would fail a Phase 84 gate (secret scan, deprecation list, scope-tag mismatch) are rejected with an ephemeral explanation and never silently skipped
  3. Post-install the daemon updates the bound agent's `skills:` list in `clawcode.yaml` using the v2.1 atomic writer, triggers hot-reload, and the skill is linked into the agent's catalog via the v1.4 global-install path
  4. Install emits exactly one summary Discord message (skill name, install path, post-install catalog entry) — no multi-message spam
  5. `/clawcode-skills` (no `-browse`) lists the currently installed skills for the bound agent and offers an ephemeral select-menu remove option
**Plans**: TBD
**UI hint**: yes

## Progress

**Status:** v2.1 OpenClaw Agent Migration shipped 2026-04-21. v2.2 OpenClaw Parity & Polish opened 2026-04-21 with 6 phases (83-88), 45 requirements across 7 categories. Zero new npm deps expected.

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
| v2.2 | 83-88 | In progress | — |

### v2.2 Phase Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 83. Extended-Thinking Effort Mapping | 3/3 | Complete    | 2026-04-21 |
| 84. Skills Library Migration | 3/3 | Complete    | 2026-04-21 |
| 85. MCP Tool Awareness & Reliability | 3/3 | Complete    | 2026-04-21 |
| 86. Dual Discord Model Picker (Core) | 2/3 | Complete    | 2026-04-21 |
| 87. Native CC Slash Commands | 0/? | Not started | - |
| 88. Skills Marketplace | 0/? | Not started | - |

## v2.2 Dependency Graph

```
Phase 83 (Effort)  ──┬─→ Phase 86 (Model Picker Core)  ──┬─→ Phase 87 (Native CC)
                     │                                    │
                     └────────────────────────────────────┘

Phase 84 (Skills)  ────────────────────────→ Phase 88 (Marketplace)

Phase 85 (MCP Tools)  ── (independent; parallel-safe with 83/84/86)
```

- **83 first** — SDK canary + P0 fix; validates SDK mid-session mutation strategy for 86/87
- **84, 85 parallel-safe with 83** — no shared surface; 84 is CLI-only, 85 is readiness-gate + prompt work
- **86 after 83** — reuses the SDK mid-session-mutation pattern proven in 83; locks the unified `clawcode-*` namespace before 87
- **87 after 83 + 86** — depends on both effort-unify and model-unify; highest risk, gated by CMD-00 spike
- **88 after 84 + 86** — reuses Phase 84 migration pipeline for per-skill install; reuses Phase 86 atomic YAML writer for `skills:` list update

## v2.2 Notes

- **Zero new npm dependencies** — verified by `.planning/research/STACK.md`. `yaml@2.8.3`, `discord.js@14.26.2`, `@anthropic-ai/claude-agent-sdk@0.2.97`, `better-sqlite3@12.8.0` cover every v2.2 surface.
- **SDK pin** — `@anthropic-ai/claude-agent-sdk` to exact `0.2.97` (not `^0.2.97`) per STACK.md pre-1.0 churn guidance.
- **UI-01 cross-cutting** — the single UI-01 requirement (native discord.js selection elements, no free-text fallback when a structured element fits) is a shared success criterion for every phase that introduces Discord UI: 83 (effort picker), 86 (model picker), 87 (native slash commands + autocomplete), 88 (skills browser + installed-skills picker). UI-01 is NOT assigned to a single owning phase; it is validated as part of each UI-bearing phase's acceptance.
- **Deferred** — `MODEL-F1` (dual-picker OpenClaw-side read of materialized allowlist) is explicitly pushed to a future milestone per the requirements doc; Phase 86 lays the `allowedModels` schema foundation that future work builds on.

---

*Milestone v2.1 OpenClaw Agent Migration: 8 phases (75-82) + 1 gap-closure phase (82.1). 31 requirements across SHARED/MIGR/CONF/WORK/MEM/FORK/OPS categories — all satisfied. Zero new npm deps.*

*Milestone v2.2 OpenClaw Parity & Polish opened 2026-04-21: 6 phases (83-88), 45 requirements across UI/SKILL/EFFORT/MODEL/CMD/TOOL/MKT categories. Zero new npm deps expected.*
