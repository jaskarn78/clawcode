# Requirements — Milestone v2.0: Open Endpoint + Eyes & Hands

**Status:** Active
**Started:** 2026-04-18
**Total requirements:** 20

**Milestone goal:** Make every ClawCode agent reachable from any OpenAI-compatible client AND give agents perception + action beyond Discord (browse web, search, generate images).

---

## v2.0 Requirements

### OpenAI-Compatible Endpoint (OPENAI-*)

The daemon exposes a stable, OpenAI-compatible HTTP surface so any client that speaks the OpenAI API can reach a ClawCode agent as if it were a model.

- [ ] **OPENAI-01**: User (as API client) can send `POST /v1/chat/completions` to the daemon with `model: "<agent-name>"` and receive a valid OpenAI-shape response populated from the named agent's Claude session.
- [ ] **OPENAI-02**: User (as API client) can request `stream: true` and receive `text/event-stream` chunks in OpenAI SSE format (`data: {...}\n\n`, final `data: [DONE]`) with assistant deltas as the agent generates.
- [ ] **OPENAI-03**: User (as API client) can call `GET /v1/models` and see every configured ClawCode agent listed as a model (`id: "<agent-name>"`, `object: "model"`, `owned_by: "clawcode"`).
- [ ] **OPENAI-04**: User (as operator) can generate per-client bearer API keys, pin each key to a specific agent, and have the daemon reject requests with missing, unknown, or agent-mismatched keys with `401` / `403`.
- [ ] **OPENAI-05**: User (as API client) can make a sequence of `POST /v1/chat/completions` requests with the same bearer key and have the agent retain conversational memory across requests (per-bearer-key session — one isolated session per API key, persisted via ConversationStore).
- [ ] **OPENAI-06**: User (as API client) can receive OpenAI-format `tool_calls` in responses when the agent chooses a tool, and can reply with `role: "tool"` messages that the daemon translates bidirectionally to Claude tool-use blocks.
- [ ] **OPENAI-07**: User (as operator) can observe `TurnOrigin = "openai-api"` on every trace row originating from the endpoint, with the bearer key fingerprint and client-sent `X-Request-Id` preserved — no TurnDispatcher refactor, just a new origin kind.

### Browser Automation (BROWSER-*)

Agents can drive a real headless Chromium to read, interact with, and extract data from live web pages.

- [ ] **BROWSER-01**: User (via agent) can open a URL with `browser_navigate` and receive a page-loaded signal, with the current URL/title returned.
- [ ] **BROWSER-02**: User (via agent) can capture a full-page or viewport `browser_screenshot` saved to the agent workspace, with the path returned in a form Claude vision can ingest (inline base64 or workspace file reference).
- [ ] **BROWSER-03**: User (via agent) can interact with a page via `browser_click` (selector) and `browser_fill` (selector + value) and observe the resulting page state.
- [ ] **BROWSER-04**: User (via agent) can extract clean text or structured content from a rendered page with `browser_extract` (accepts selector or "main content" mode with Readability-style extraction).
- [ ] **BROWSER-05**: User (via agent) can wait for a condition (`browser_wait_for`) — selector visible, URL match, timeout — before next action, with clear timeout/failure results.
- [ ] **BROWSER-06**: User (as operator) can trust that each agent's browser has a persistent profile dir under `<agent-workspace>/browser/` so cookies and sessions survive daemon restarts, and that the browser warms at daemon start (resident singleton like the embedder) with a boot-time health probe.

### Web Search (SEARCH-*)

Agents can search the live web and fetch clean article content for grounding and citations.

- [ ] **SEARCH-01**: User (via agent) can call `web_search` with a query and receive a ranked list of results (title, URL, snippet, published date when available) from Brave Search, with an optional Exa backend selectable per-agent config.
- [ ] **SEARCH-02**: User (via agent) can call `web_fetch_url` on a result URL and receive clean, readable page text (headers + paragraphs, no nav/ads) along with metadata (title, author, publish date when extractable).
- [ ] **SEARCH-03**: User (as operator) can trust that duplicate `web_search` / `web_fetch_url` calls within a single turn return cached results (no double-charging), joining the v1.7 idempotent tool-cache whitelist, with the cache scoped to a single Turn (zero cross-turn leak).

### Image Generation (IMAGE-*)

Agents can produce visual output and deliver it to Discord (or any consumer) via the existing attachment pipeline.

- [ ] **IMAGE-01**: User (via agent) can call `image_generate` with a prompt plus optional size/style/model parameters and select a backend (MiniMax, OpenAI Images, or fal.ai) chosen by per-agent config, receiving a workspace-persisted image file path as the result.
- [ ] **IMAGE-02**: User (via agent) can call `image_edit` with an input image path + edit prompt and receive a new image reflecting the edits from whichever backend supports it (config-gated — only backends advertising edit support are available).
- [ ] **IMAGE-03**: User (via agent) can deliver a generated image to a Discord channel by calling the existing `send_attachment` MCP tool with the workspace path returned from `image_generate` — no new delivery surface.
- [ ] **IMAGE-04**: User (as operator) can budget and observe per-agent image-generation spend in the existing `clawcode costs` CLI with image calls recorded as a new cost category alongside tokens.

---

## Future Requirements (deferred to later milestones)

These surfaced during v2.0 scoping but are intentionally out of scope here:

- Multi-user auth beyond bearer-key-per-client (deferred to v2.1 "Multi-User Foundations")
- SMS / email / voice reach surfaces (deferred to v2.2+ "Extended Reach")
- Skill marketplace / agent-initiated install (deferred to v2.1+)
- Dream state / replay mode / personality evolution (deferred to v2.2+)
- Billing / usage metering per user (deferred to v2.1+)
- OpenAI-compatible `/v1/embeddings` and `/v1/completions` (legacy) surfaces — only `/v1/chat/completions` + `/v1/models` in scope
- Full browser automation parity (download handlers, multi-tab, PDF capture) — v2.0 delivers the 6 core tools; advanced surfaces later
- Image variations beyond the three named backends (Stable Diffusion / Midjourney via proxy / Recraft) — later

---

## Out of Scope (explicit exclusions)

- **Gateway layer / separate service** — the OpenAI endpoint is a new listener on the existing daemon process. One binary, one socket, one lifecycle.
- **Discord-plugin changes** — v2.0 does not touch the Discord bridge. The OpenAI endpoint is an entirely new surface.
- **TurnDispatcher refactor** — `openai-api` is a new TurnOrigin kind. Zero changes to v1.8's dispatcher contract.
- **Per-agent opt-in for browser/search/image MCPs** — all three are auto-injected like `clawcode` and `1password`. Agents that want to opt out set `mcpServers: []`.
- **New runtime or package manager** — Node 22 + npm only.
- **Voice / TTS** — stays out of scope (user-facing decision from v1.9).
- **Shared knowledge graph across agents** — workspace isolation is load-bearing.

---

## Traceability

Every v2.0 requirement is mapped to exactly one phase. Coverage: 20/20.

| Requirement | Phase | Status |
|-------------|-------|--------|
| OPENAI-01 | Phase 69 — OpenAI-Compatible Endpoint | Pending |
| OPENAI-02 | Phase 69 — OpenAI-Compatible Endpoint | Pending |
| OPENAI-03 | Phase 69 — OpenAI-Compatible Endpoint | Pending |
| OPENAI-04 | Phase 69 — OpenAI-Compatible Endpoint | Pending |
| OPENAI-05 | Phase 69 — OpenAI-Compatible Endpoint | Pending |
| OPENAI-06 | Phase 69 — OpenAI-Compatible Endpoint | Pending |
| OPENAI-07 | Phase 69 — OpenAI-Compatible Endpoint | Pending |
| BROWSER-01 | Phase 70 — Browser Automation MCP | Pending |
| BROWSER-02 | Phase 70 — Browser Automation MCP | Pending |
| BROWSER-03 | Phase 70 — Browser Automation MCP | Pending |
| BROWSER-04 | Phase 70 — Browser Automation MCP | Pending |
| BROWSER-05 | Phase 70 — Browser Automation MCP | Pending |
| BROWSER-06 | Phase 70 — Browser Automation MCP | Pending |
| SEARCH-01 | Phase 71 — Web Search MCP | Pending |
| SEARCH-02 | Phase 71 — Web Search MCP | Pending |
| SEARCH-03 | Phase 71 — Web Search MCP | Pending |
| IMAGE-01 | Phase 72 — Image Generation MCP | Pending |
| IMAGE-02 | Phase 72 — Image Generation MCP | Pending |
| IMAGE-03 | Phase 72 — Image Generation MCP | Pending |
| IMAGE-04 | Phase 72 — Image Generation MCP | Pending |

### Per-phase requirement summary

| Phase | Requirements | Count |
|-------|--------------|-------|
| Phase 69 — OpenAI-Compatible Endpoint | OPENAI-01, OPENAI-02, OPENAI-03, OPENAI-04, OPENAI-05, OPENAI-06, OPENAI-07 | 7 |
| Phase 70 — Browser Automation MCP | BROWSER-01, BROWSER-02, BROWSER-03, BROWSER-04, BROWSER-05, BROWSER-06 | 6 |
| Phase 71 — Web Search MCP | SEARCH-01, SEARCH-02, SEARCH-03 | 3 |
| Phase 72 — Image Generation MCP | IMAGE-01, IMAGE-02, IMAGE-03, IMAGE-04 | 4 |
| **Total** | | **20** |

**Coverage:** 20/20 requirements mapped to exactly one phase each. No orphans. No duplicates.
