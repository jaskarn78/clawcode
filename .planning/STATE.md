---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Open Endpoint + Eyes & Hands
status: Milestone complete
stopped_at: "Completed quick task 260419-p51 — multi-agent bearer keys + (key_hash, agent) composite-PK session index + fork-escalation regression pin + spawn-subagent-from-OpenAI-endpoint README. 8 atomic commits on master (NOT pushed). ~45 net new tests. tsc at 29 baseline; 3111 pass, 7 tolerated failures in daemon-openai.test.ts. Task 4 (deploy + smoke + rotate OpenClaw + body-capture flip) deferred to orchestrator."
last_updated: "2026-04-19T18:30:00.000Z"
last_activity: 2026-04-19
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 10
  completed_plans: 10
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18)

**Core value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.
**Current focus:** Phase 72 — Image Generation MCP

## Current Position

Phase: 72
Plan: Not started

## Performance Metrics

**Velocity:**

- Total plans completed: 63+ (v1.0-v1.9 across 10 milestones)
- Average duration: ~3.5 min
- Total execution time: ~3.7+ hours

**Recent Trend:**

- v1.9 plans: stable 5-30min each
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v2.0 Roadmap]: Bearer-key = session boundary — one isolated ConversationStore session per API key (OPENAI-05). No multi-user-per-key fan-out until v2.1 "Multi-User Foundations".
- [v2.0 Roadmap]: New `TurnOrigin="openai-api"` kind on the v1.8 TurnDispatcher (OPENAI-07). Zero dispatcher refactor — just a new origin discriminant consumed by existing trace pipeline.
- [v2.0 Roadmap]: OpenAI endpoint is a new HTTP listener on the existing daemon process. One binary, one socket, one lifecycle. No gateway layer, no separate service.
- [v2.0 Roadmap]: Browser / search / image MCP servers all follow the existing `clawcode` + `1password` auto-injection pattern. Opt-out via `mcpServers: []`, not opt-in.
- [v2.0 Roadmap]: Phase 69 ships FIRST — hardest phase (session mapping, tool translation, streaming) and also unblocks dev-loop testing for Phases 70-72 (OpenAI endpoint replaces Discord round-trip during MCP development).
- [v2.0 Roadmap]: Phases 70-72 sequenced 70 → 71 → 72. Browser front-loads Playwright integration risk. Search is self-contained. Image-gen benefits from search being in place (agents commonly search → find reference → edit).
- [v2.0 Roadmap]: v1.7 prompt-cache hit rate + first-token p95 SLO is a non-regression gate on every phase. Every v2.0 phase carries a success criterion pinning this.
- [v2.0 Roadmap]: Browser is a resident singleton that warms at daemon boot (following the v1.7 embedder pattern from Phase 56) — NOT lazy-per-request. Search + image backends are lazy-per-first-call to keep idle daemon-boot SLO clean.
- [v2.0 Roadmap]: Scope locked at `/v1/chat/completions` + `/v1/models` only. Legacy `/v1/completions` and `/v1/embeddings` explicitly out of scope.
- [v2.0 Roadmap]: Image delivery reuses the existing `send_attachment` MCP tool — zero new Discord delivery surface introduced.
- [Phase 69]: Phase 69-01: SHA-256 (not Argon2) for bearer-key storage — high-entropy tokens don't need password KDFs
- [Phase 69]: Phase 69-01: length-guard BEFORE timingSafeEqual in verifyKey (Pitfall 6 — prevents RangeError on mismatched-length buffers)
- [Phase 69-openai-compatible-endpoint]: Phase 69-02: OpenAiSessionDriver is a DI interface on server.ts, NOT a SessionAdapter extension — Plan 03 provides the real impl while Plan 02 stays hermetic from src/manager/
- [Phase 69-openai-compatible-endpoint]: Phase 69-02: Translator uses Map<tool_use_id, openaiIndex> primary + Map<sdkBlockIndex, openaiIndex> secondary for streamed tool-call accumulation (Pitfall 1 guard)
- [Phase 69-openai-compatible-endpoint]: Phase 69-02: Body-too-large uses req.pause() (not req.destroy()) so the 413 response body can still be written before the socket closes
- [Phase 69-openai-compatible-endpoint]: Phase 69-02: Both req.on('close') AND res.on('close') wired to AbortController — Node event ordering varies on SSE connections, wiring both is the robust disconnect guard
- [Phase 69-openai-compatible-endpoint]: Phase 69-03: NO additive fields on TurnDispatcher — clientSystemAppend routed via user-message body with delimiter (Pitfall 8 preserved, Discord path byte-for-byte unchanged)
- [Phase 69-openai-compatible-endpoint]: Phase 69-03: SdkStreamEvent synthesis in driver.ts — bridges TurnDispatcher's (accumulated:string) callback into async-iterable of content_block_delta+result events via bounded queue + pending-resolver
- [Phase 69-openai-compatible-endpoint]: Phase 69-03: Handler-arrow-fn intercepts openai-key-* IPC methods BEFORE routeMethod — avoids growing 23-arg signature; new handlers reach daemon state via closures over pre-declared let openAiEndpointRef
- [Phase 69-openai-compatible-endpoint]: Phase 69-03: Factored startOpenAiEndpoint into src/openai/endpoint-bootstrap.ts specifically so 10 integration tests drive boot + env + EADDRINUSE + shutdown ordering without booting full daemon
- [Phase 70-browser-automation-mcp]: Option 2 architecture locked: shared chromium.launch() + per-agent newContext({ storageState }) — Pitfall 1 guard via grep, Pitfall 2 (--no-sandbox) absent
- [Phase 70-browser-automation-mcp]: Plan 70-01: BrowserManager warm/getContext/close mirrors embedder.ts warmPromise pattern; DI driver seam lets manager tests run without real Chromium
- [Phase 70-browser-automation-mcp]: Plan 70-01: storageState persistence uses atomic .tmp → rename with indexedDB:true; zero-byte guard (Pitfall 10) returns undefined on partial-write recovery; debounced 5s saver collapses burst writes
- [Phase 70-browser-automation-mcp]: Plan 70-02: tools.ts stays PURE — MCP content envelope shaping lives in mcp-server.ts; 35 test cases run against vi.fn() BrowserContext mock with no Chromium
- [Phase 70-browser-automation-mcp]: Plan 70-02: action-timeout on click/fill maps to element_not_found (common root cause = selector never actionable); browser_wait_for keeps 'timeout' type for BROWSER-05 contract
- [Phase 70-browser-automation-mcp]: Plan 70-02: agent-name resolution precedence arg > CLAWCODE_AGENT env > invalid_argument error — no IPC round-trip on the error path
- [Phase 70-browser-automation-mcp]: Plan 70-02: __testOnly_buildHandler DI seam — MCP SDK doesn't expose clean tool introspection; returning the exact registered handler lets tests pin the forward-to-daemon contract without a real StdioServerTransport
- [Phase 70-browser-automation-mcp]: Plan 70-02: src/ipc/types.ts created as new module — project previously kept IPC types in protocol.ts (Zod schemas); Phase 70 introduces a separate types module so Plan 02 declares the contract without touching protocol.ts's IPC_METHODS enum (Plan 03 appends)
- [Phase 70-browser-automation-mcp]: Plan 70-03: Extracted handleBrowserToolCall into src/browser/daemon-handler.ts — pure deps-based dispatcher gives tests a clean seam against real BrowserManager + mock driver without IPC transport or real Chromium
- [Phase 70-browser-automation-mcp]: Plan 70-03: Browser IPC handler intercepted BEFORE routeMethod (mirrors Phase 69 openai-key-* pattern) — keeps 24-arg routeMethod signature from growing
- [Phase 70-browser-automation-mcp]: Plan 70-03: WRITE_PRODUCING_TOOLS set (navigate/click/fill) gates saveAgentState — read-only tools (screenshot/extract/wait_for) skip the flush, preventing write amplification
- [Phase 70-browser-automation-mcp]: Plan 70-03: daemon shutdown orders browserManager.close() BEFORE server.close() — in-flight browser-tool-call requests fail cleanly rather than hang (Pitfall 5 end-to-end)
- [Phase 70-browser-automation-mcp]: Plan 70-03: Smoke script is zero-dependency Node ESM — inlines a minimal JSON-RPC-over-Unix-socket client so it works on a fresh clone with no build step; exit 2 on daemon-not-running distinguishes infra-skip from assertion-fail
- [Phase 71]: Plan 71-01: Reuse Phase 70 parseArticle via direct import from src/browser/readability.js — no hoist to src/shared/
- [Phase 71]: Plan 71-01: Lazy API-key reads at client search() call time — missing key surfaces as invalid_argument on first call, not daemon-boot crash
- [Phase 71]: Plan 71-01: Native fetch over provider wrapper packages (no @brave/search-client, no exa-js) — zero npm deps, error mapping under our control
- [Phase 71]: Plan 71-01: vi.spyOn(globalThis,'fetch') for all test mocking — mirrors attachments.test.ts, zero new test deps; error taxonomy locked at 7 discriminants (CONTEXT D-02)
- [Phase 71-web-search-mcp]: Plan 71-02: IPC handler intercepted BEFORE routeMethod (same closure pattern as Phase 70 browser-tool-call + Phase 69 openai-key-*) — keeps 24-arg routeMethod signature stable
- [Phase 71-web-search-mcp]: Plan 71-02: Daemon-owned BraveClient + ExaClient singletons constructed unconditionally at boot — lazy API-key reads inside .search() keep daemon bootable without keys present
- [Phase 71-web-search-mcp]: Plan 71-02: No warm-path probe for search — HTTP clients hold no state, Phase 70's warm-path probe pattern does not apply. Keeps daemon boot + v1.7 SLO ceiling intact with zero new measurement surface
- [Phase 71-web-search-mcp]: Plan 71-02: SEARCH-03 intra-turn cache is end-to-end operational with zero net-new code in src/mcp/ or src/performance/ — Plan 01's IDEMPOTENT_TOOL_DEFAULTS extension + existing v1.7 invokeWithCache machinery covers both tools automatically
- [Phase 72-image-generation-mcp]: Plan 72-01: Zero new npm deps — native fetch + native FormData + native Blob (Node 22) replaced node-fetch / form-data / axios / got
- [Phase 72-image-generation-mcp]: Plan 72-01: image_generate / image_edit / image_variations explicitly NOT in IDEMPOTENT_TOOL_DEFAULTS — same prompt yields different images (caching = correctness bug)
- [Phase 72-image-generation-mcp]: Plan 72-01: UsageTracker schema migration is idempotent ALTER TABLE × 3 with try/catch swallowing only 'duplicate column' — pre-Phase-72 DBs auto-migrate on construction; second construction does not throw
- [Phase 72-image-generation-mcp]: Plan 72-01: recordCost failure is non-fatal (try/catch + console.warn) — generation already cost real money, can't fail the tool just because the local cost-DB locked
- [Phase 72-image-generation-mcp]: Plan 72-01: composite model column model='${backend}:${model}' for image rows — keeps existing CostByAgentModel grouping splitting image rows from token rows for the same agent without schema break
- [Phase 72-image-generation-mcp]: Plan 72-02: IPC handler intercepted BEFORE routeMethod (same closure pattern as browser-tool-call + search-tool-call + openai-key-*) — keeps 24-arg routeMethod signature from growing
- [Phase 72-image-generation-mcp]: Plan 72-02: usageTrackerLookup as callback (not bound tracker) — keeps handler agent-agnostic AND lets call succeed when agent's tracker DB isn't open yet (recordCost no-op rather than crash)
- [Phase 72-image-generation-mcp]: Plan 72-02: Daemon-owned image clients constructed unconditionally at boot but lazy API-key reads keep daemon bootable without any keys present — missing keys surface as invalid_input on first tool call
- [Phase 72-image-generation-mcp]: Plan 72-02: Costs CLI Category column between Agent and Model — legacy null/undefined category displays as 'tokens' for back-compat; image rows distinct at a glance (closes IMAGE-04 end-to-end)

### Roadmap Evolution

- 2026-04-18: Milestone v1.9 Persistent Conversation Memory shipped (Phases 64-68 + 68.1)
- 2026-04-18: Milestone v2.0 Open Endpoint + Eyes & Hands started — 20 requirements defined across 4 categories
- 2026-04-18: v2.0 roadmap created — 4 phases (69-72), 20/20 requirements mapped 1:1, zero orphans
- 2026-04-19: Phase 73 added — OpenClaw endpoint latency (research integration, TTFB instrumentation, persistent subprocess via streamInput, brief cache, readiness-wait tune). Dir: `.planning/phases/73-openclaw-endpoint-latency/`

### Pending Todos

None yet.

### Blockers/Concerns

- **OpenAI SDK compatibility surface breadth unknown** — need to verify real-world OpenAI SDK clients (Python `openai`, LangChain, Vercel AI SDK) all round-trip cleanly against our `/v1/chat/completions` implementation. Validate with the OpenAI SDK's own happy-path tests in Phase 69.
- **Playwright warm-singleton memory footprint unknown** — a resident Chromium per daemon adds baseline RSS; must verify with N=14 agents that we don't need per-agent Chromium processes. Measure in Phase 70.
- **Tool-use bidirectional translation edge cases** — OpenAI `tool_calls` array vs. Claude `tool_use` blocks differ in parallel-call semantics and streaming delta shape. Phase 69 must handle streamed tool-call accumulation correctly (OpenAI emits per-tool-call deltas; Claude emits per-block deltas).
- **Bearer-key-to-session mapping persistence** — one session per bearer key must survive daemon restarts (ConversationStore handles the session rows, but we need a bearer_key → session_id index with zero-leak enforcement). Locked design gap to resolve in Phase 69 research.
- **12 of 15 v1.1 phases missing formal VERIFICATION.md artifacts (docs only)** — legacy carry-over, not blocking.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260418-sux | Fix schedule display field mismatch and add registry ghost-entry reconciliation | 2026-04-18 | 3d4ff24 | [260418-sux-fix-schedule-display-field-mismatch-and-](./quick/260418-sux-fix-schedule-display-field-mismatch-and-/) |
| 260419-jtk | Harden OpenAI streaming for OpenClaw: usage trailing chunk + tool-call verify + warm-path startup race | 2026-04-19 | 18252fe | [260419-jtk-harden-openai-streaming-for-openclaw-emi](./quick/260419-jtk-harden-openai-streaming-for-openclaw-emi/) |
| 260419-mvh | Fix initMemory→warm-path cascade + add OpenAI request/payload JSONL logging + `openai-log tail` CLI | 2026-04-19 | 34dfb83 | [260419-mvh-fix-initmemory-warm-path-cascade-add-ope](./quick/260419-mvh-fix-initmemory-warm-path-cascade-add-ope/) |
| 260419-nic | Discord `/clawcode-interrupt` + `/clawcode-steer` slash commands — mid-turn abort + steering via Phase 73 interrupt primitive | 2026-04-19 | 8ff6780 | [260419-nic-add-discord-stop-and-steer-slash-command](./quick/260419-nic-add-discord-stop-and-steer-slash-command/) |
| 260419-p51 | Multi-agent bearer keys (scope=all) + composite-PK session index + fork-escalation regression pin + spawn-subagent UX docs | 2026-04-19 | edecd6e | [260419-p51-multi-agent-bearer-keys-fork-escalation-](./quick/260419-p51-multi-agent-bearer-keys-fork-escalation-/) |
| Phase 69 P01 | 13 | 3 tasks | 7 files |
| Phase 69-openai-compatible-endpoint P02 | 24 | 4 tasks | 9 files |
| Phase 69-openai-compatible-endpoint P03 | 18 | 5 tasks | 16 files |
| Phase 70-browser-automation-mcp P01 | 15min | 3 tasks | 9 files |
| Phase 70-browser-automation-mcp P02 | 20min | 3 tasks | 14 files |
| Phase 70-browser-automation-mcp P03 | 27min | 3 tasks | 12 files |
| Phase 71 P01 | 21 min | 3 tasks | 16 files |
| Phase 71-web-search-mcp P02 | 10 min | 2 tasks | 10 files |
| Phase 72-image-generation-mcp P01 | 32min | 3 tasks | 20 files |
| Phase 72-image-generation-mcp P02 | 24 min | 2 tasks | 16 files |

## Session Continuity

Last activity: 2026-04-19 - Completed quick task 260419-p51 (multi-agent bearer keys + composite-PK session index + fork-escalation regression pin + spawn-subagent UX docs)
Stopped at: 8 atomic commits on master (NOT pushed). Task 4 (deploy + smoke + rotate OpenClaw + body-capture flip) deferred to orchestrator.
Resume file: None
