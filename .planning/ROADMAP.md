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
- :arrow_forward: **v2.0 Open Endpoint + Eyes & Hands** - Phases 69-72 (active, started 2026-04-18)

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

Phases 57-63 delivered: TurnDispatcher foundation (single chokepoint for all turn sources), task store + state machine (durable tasks.db with 15-field rows + enforced transitions), cross-agent RPC handoffs (delegate_task MCP + async-ticket semantics + schema validation + cycle detection), trigger engine (3-layer dedup + policy evaluator + watermark replay + SchedulerSource migration), additional trigger sources (MySQL/webhook/inbox/calendar), policy layer + dry-run (YAML DSL + hot-reload + audit trail), observability surfaces (CLIs + dashboard task graph + cross-agent trace chain walker).

</details>

<details>
<summary>v1.9 Persistent Conversation Memory (Phases 64-68 + 68.1) - SHIPPED 2026-04-18</summary>

See `.planning/milestones/v1.9-ROADMAP.md` for full details.

Phases 64-68 delivered: ConversationStore schema + lifecycle (per-agent sessions and turns with SEC-01 provenance), capture integration (fire-and-forget turn recording + SEC-02 instruction-pattern detection), session-boundary summarization (Haiku-based compression stored as standard MemoryEntry with session-summary tags), resume auto-injection (structured context brief with gap-skip + dedicated conversation_context budget), conversation search + deep retrieval (FTS5 raw-turn search + semantic summary search + paginated decay-weighted results via enhanced memory_lookup MCP tool). Phase 68.1 closed the isTrustedChannel cross-phase wiring gap surfaced by milestone audit.

</details>

### v2.0 Open Endpoint + Eyes & Hands (Active)

- [x] **Phase 69: OpenAI-Compatible Endpoint** — `POST /v1/chat/completions` + `GET /v1/models` on the daemon with SSE streaming, bearer-key-per-session auth, OpenAI↔Claude tool-use translation, and `TurnOrigin="openai-api"` tracing. (completed 2026-04-19)
- [x] **Phase 70: Browser Automation MCP** — Playwright-over-CDP auto-injected MCP server with 6 tools (navigate/screenshot/click/fill/extract/wait_for), per-agent persistent profile dir, and warm-start singleton. (completed 2026-04-19)
- [x] **Phase 71: Web Search MCP** — Brave-primary (Exa optional) auto-injected MCP server with `web_search` + `web_fetch_url` tools joining the v1.7 intra-turn idempotent cache whitelist. (completed 2026-04-19)
- [ ] **Phase 72: Image Generation MCP** — Auto-injected MCP server with MiniMax / OpenAI Images / fal.ai backends selectable by per-agent config, `image_generate` + `image_edit` tools, workspace-persisted output, and `clawcode costs` integration.

## Phase Details

### Phase 69: OpenAI-Compatible Endpoint
**Goal**: Every ClawCode agent is reachable from any OpenAI-compatible client (Python `openai` SDK, LangChain, curl, custom apps) with first-class streaming, tool-use, and per-key session continuity — without touching the Discord surface or the v1.8 TurnDispatcher contract.
**Depends on**: v1.8 TurnDispatcher (Phase 57), v1.9 ConversationStore (Phase 64), v1.7 streaming + prompt-cache infrastructure (Phases 52, 54)
**Requirements**: OPENAI-01, OPENAI-02, OPENAI-03, OPENAI-04, OPENAI-05, OPENAI-06, OPENAI-07
**Success Criteria** (what must be TRUE):
  1. Python `openai` SDK pointed at `http://clawdy:3100/v1` with `model="<agent-name>"` receives a streamed assistant response identical in shape to an OpenAI server response (SSE `data: {...}\n\n` chunks terminated by `data: [DONE]`).
  2. `GET /v1/models` returns every configured ClawCode agent as an OpenAI-shape model entry (`id`, `object: "model"`, `owned_by: "clawcode"`) usable by any client that calls `list_models()` first.
  3. Two sequential `POST /v1/chat/completions` requests sharing the same bearer key preserve conversational state (agent remembers what was said) AND two requests with different bearer keys pointed at the same agent are fully isolated (neither sees the other's history).
  4. An OpenAI-format `tool_calls` round-trip (assistant emits `tool_calls` → client sends `role: "tool"` response → assistant continues) works against a ClawCode MCP tool with zero client-side awareness that the backend is Claude.
  5. Every trace row originating from the endpoint carries `TurnOrigin.kind = "openai-api"` with bearer-key fingerprint and client-sent `X-Request-Id` preserved, visible in `clawcode traces` CLI and dashboard — with zero TurnDispatcher contract changes.
  6. Missing / unknown / agent-mismatched bearer keys return `401` / `403` (never a 500 or a leaked agent name), and the v1.7 prompt-cache hit rate + first-token p95 SLO show no regression when driven through the endpoint vs. the Discord path.
**Plans**: 3 plans (see `.planning/phases/69-openai-compatible-endpoint/`)

### Phase 70: Browser Automation MCP
**Goal**: Every agent can drive a real headless Chromium — navigate the live web, screenshot pages into Claude vision, click/fill forms, extract clean content, and wait for dynamic conditions — with a persistent per-agent profile that survives daemon restarts.
**Depends on**: Phase 69 (testable via OpenAI endpoint without Discord round-trip), v1.7 warm-path infrastructure (Phase 56), existing MCP auto-injection pattern (`clawcode`, `1password`)
**Requirements**: BROWSER-01, BROWSER-02, BROWSER-03, BROWSER-04, BROWSER-05, BROWSER-06
**Success Criteria** (what must be TRUE):
  1. Clawdy opens `amazon.com`, captures a full-page screenshot, and describes the homepage layout based on the image — end-to-end through the vision pipeline with the screenshot delivered as an inline base64 or workspace-file reference Claude vision ingests directly.
  2. An agent can complete a multi-step interaction (navigate → fill a search input → click submit → wait for results container to render → extract the result list as clean text) using only `browser_*` MCP tools, returning structured content with no nav/ads/footers in the final text.
  3. Each agent's browser profile dir lives at `<agent-workspace>/browser/` and survives a daemon restart — logging into a site with one agent does NOT log any other agent in, and the logged-in agent stays logged in after `systemctl restart clawcoded`.
  4. The browser warms at daemon startup as a resident singleton (like the embedder from Phase 56), with a boot-time health probe that hard-fails daemon start if Chromium can't launch — and the browser MCP server auto-injects into every agent unless `mcpServers: []` opts out, matching the existing `clawcode`/`1password` pattern.
  5. `browser_wait_for` failures (timeout, selector never visible, URL never matches) return structured failure results — the agent sees a clear error it can recover from, never a silent hang or a raw stack trace — and p95 first-token on non-browser turns shows zero regression vs. the v1.7 baseline when the browser is idle.
**Plans**: 3 plans (see `.planning/phases/70-browser-automation-mcp/`)
**UI hint**: yes

### Phase 71: Web Search MCP
**Goal**: Every agent can search the live web and fetch clean article text for grounding and citations, with intra-turn deduplication preventing accidental re-charging on repeat queries.
**Depends on**: Phase 70 (Playwright risk front-loaded), v1.7 intra-turn idempotent tool-cache (Phase 55), existing MCP auto-injection pattern
**Requirements**: SEARCH-01, SEARCH-02, SEARCH-03
**Success Criteria** (what must be TRUE):
  1. An agent calls `web_search("claude 4.7 release notes")` and receives a ranked list of results from Brave (title, URL, snippet, published date when available), with the same call returning Exa results instead when the agent's config selects `searchBackend: "exa"`.
  2. An agent calls `web_fetch_url(<result-url>)` and receives clean, readable article text (headings + paragraphs, no nav/ads/footer) plus extractable metadata (title, author, publish date) — the body is usable as citation material without further post-processing.
  3. Duplicate `web_search` calls with the same query in one turn return cached results and do NOT re-hit the Brave API (verified by a single outbound HTTP request in the trace), with the cache scoped strictly to the current Turn — a later Turn with the same query hits the API fresh.
  4. The search MCP server auto-injects into every agent following the `clawcode`/`1password` pattern (opt-out via `mcpServers: []`), and the `web_search` + `web_fetch_url` tools appear on the v1.7 intra-turn idempotent whitelist so their cached reads emit the correct `cached: true` trace metadata.
  5. The v1.7 prompt-cache hit rate and first-token p95 SLO show no regression when agents are idle (search never called) — the Brave client is lazily initialized, not eagerly instantiated at daemon boot.
**Plans**: 2 plans
  - [x] 71-01-PLAN.md — Providers + tools + config (Brave/Exa clients, URL fetcher, pure tool handlers, schema + idempotent whitelist)
  - [x] 71-02-PLAN.md — MCP subprocess + CLI + auto-inject + smoke (stdio server, daemon wiring, loader auto-inject, smoke script, README)

### Phase 72: Image Generation MCP
**Goal**: Every agent can generate and edit images via MiniMax, OpenAI Images, or fal.ai backends (per-agent config selectable), persist output to its workspace, deliver to Discord through the existing `send_attachment` pipeline, and surface image-generation spend in `clawcode costs` alongside token spend.
**Depends on**: Phase 71 (agents commonly search → find reference → edit), existing `send_attachment` MCP tool, v1.5 cost-tracking infrastructure (Phase 40), existing MCP auto-injection pattern
**Requirements**: IMAGE-01, IMAGE-02, IMAGE-03, IMAGE-04
**Success Criteria** (what must be TRUE):
  1. An agent calls `image_generate("a cyberpunk skyline at dusk", size="1024x1024", backend="minimax")` and receives a workspace-persisted image file path — the file exists at `<agent-workspace>/generated-images/<id>.png`, readable by the agent's next turn or by a human inspecting the workspace.
  2. An agent calls `image_edit(<workspace-path>, "add neon reflections on the wet streets")` against a backend whose config advertises edit support and receives a new image reflecting the edits — if the agent's configured backend does NOT advertise edit support, the tool returns a clean "unsupported" error rather than silently falling back.
  3. An agent generates an image with `image_generate` and delivers it to its Discord channel via the existing `send_attachment` MCP tool using the returned workspace path — with zero new delivery surface introduced (send_attachment unchanged).
  4. Running `clawcode costs` shows per-agent image-generation spend as a distinct cost category alongside token spend, with per-backend rate cards driving the dollar amount — an operator can answer "how much did Clawdy spend on MiniMax this week?" without leaving the CLI.
  5. The image MCP server auto-injects into every agent (opt-out via `mcpServers: []`) and the v1.7 prompt-cache hit rate + first-token p95 SLO show no regression when agents are idle — backend HTTP clients lazily initialize at first call, not at daemon boot.
**Plans**: 2 plans
  - [x] 72-01-PLAN.md — Providers + tools + cost integration (OpenAI/MiniMax/fal clients, workspace writer, costs.ts + UsageTracker schema migration, pure tool handlers, schema extension)
  - [ ] 72-02-PLAN.md — MCP subprocess + CLI + auto-inject + costs CLI category extension + smoke + README (stdio server, daemon wiring, loader auto-inject, formatCostsTable category column, smoke script)
**UI hint**: yes

## Progress

**Status:** v2.0 Open Endpoint + Eyes & Hands started 2026-04-18. 4 phases (69-72), 20 requirements mapped 1:1.

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
| v2.0 | 69-72 | Active | — |

### v2.0 Phase Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 69. OpenAI-Compatible Endpoint | 3/3 | Complete    | 2026-04-19 |
| 70. Browser Automation MCP | 3/3 | Complete    | 2026-04-19 |
| 71. Web Search MCP | 2/2 | Complete    | 2026-04-19 |
| 72. Image Generation MCP | 1/2 | In Progress|  |

---

*Active milestone: v2.0 Open Endpoint + Eyes & Hands. Run `/gsd:plan-phase 69` to begin.*
