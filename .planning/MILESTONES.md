# Milestones: ClawCode

## v2.1 OpenClaw Agent Migration (Shipped: 2026-04-21)

**Phases completed:** 15 phases, 40 plans, 86 tasks

**Key accomplishments:**

- One-liner:
- Landed the OpenAI-compatible HTTP server on `node:http` — `POST /v1/chat/completions` (JSON + SSE) and `GET /v1/models` — with pure-function bidirectional OpenAI<->Claude translator (Map<tool_use_id, openaiIndex> accumulator), SSE writer with keepalive + backpressure + `[DONE]` terminator, and full bearer-auth delegation to Plan 01's ApiKeysStore. Zero imports from src/manager/, src/memory/, src/config/ — fully testable in vitest with mock driver.
- Landed the OpenAI endpoint into the real daemon lifecycle — per-bearer-key session continuity via `api_key_sessions` migration + ApiKeySessionIndex, production `OpenAiSessionDriver` wiring TurnDispatcher + SessionManager + TraceCollector with zero contract changes, factored `startOpenAiEndpoint` bootstrap (env overrides + non-fatal EADDRINUSE + Pitfall 10 shutdown), full `clawcode openai-key create|list|revoke` CLI with IPC-first direct-DB-fallback, and the headline Python OpenAI-SDK E2E smoke script + README endpoint section. No Discord bridge or TurnDispatcher contract changes.
- Playwright-backed resident-singleton BrowserManager with per-agent storageState persistence, locked Option 2 architecture (shared Chromium + per-agent BrowserContext), and frozen type/error contracts consumed by Plan 02/03.
- Six pure browser tool handlers over Playwright's BrowserContext, wired into a stdio MCP subprocess (`clawcode browser-mcp`) that delegates every call to the daemon via `browser-tool-call` IPC — Plan 03 completes the daemon-side handler.
- Closes BROWSER-01..06 end-to-end: every agent gets a browser MCP entry, the daemon owns a warmed Chromium singleton that hard-fails boot on probe failure, the browser-tool-call IPC dispatches to the 6 pure handlers with write-vs-read save triggering, and scripts/browser-smoke.mjs proves the whole chain works against example.com.
- Pure daemon-agnostic search core — Brave + Exa provider clients, bounded URL fetcher with streaming size guards, Readability adapter reusing Phase 70, pure DI tool handlers — plus web_search + web_fetch_url appended to the v1.7 idempotent tool-cache whitelist. Zero new npm deps.
- Closes SEARCH-01..03 end-to-end: every agent auto-gets a `search` MCP entry, the daemon owns lazily-constructed Brave + Exa clients, the `search-tool-call` IPC dispatches to `webSearch`/`webFetchUrl` via a pure handler, and `scripts/search-smoke.mjs` validates the whole chain against a live daemon. Zero new npm deps. Zero Phase 70 diff. Zero Discord diff.
- Three lazy-env image-generation provider clients (OpenAI gpt-image-1, MiniMax image-01, fal.ai flux-pro), atomic workspace writer, UsageTracker schema migration with category column, and three pure DI tool handlers — zero new npm deps, all backed by 99 net-new tests.
- Closes IMAGE-01..04 end-to-end and the v2.0 milestone: every agent auto-gets an `image` MCP entry, the daemon owns lazily-constructed OpenAI + MiniMax + fal.ai image clients, the `image-tool-call` IPC dispatches to `imageGenerate` / `imageEdit` / `imageVariations` via a pure handler, `clawcode costs` now shows image spend in a new Category column distinct from token spend, and `scripts/image-smoke.mjs` validates the whole chain against a live daemon. Zero new npm deps. Zero Discord diff. Zero v1.7 SLO surface diff.
- Decision:
- New file: `src/manager/conversation-brief-cache.ts` (80 LOC)
- Modified: `src/openai/driver.ts` (+58 LOC, 375 → 433)
- Namespace-prefixed `openclaw:<slug>[:<tier>]` model ids now route to a new OpenClawTemplateDriver that caches per-caller persistent SDK sessions keyed on (bearer, slug, sha256(SOUL).slice(0,16), tier) — Phase 69 literal-agent routing untouched.
- Per-agent `security.denyScopeAll` flag gates scope='all' bearer keys on admin-grade native agents; every completed openclaw-template turn attributes cost to `agent="openclaw:<slug>"` via the UsageTracker; daemon shutdown drains the transient-session cache before yanking sockets; operator-facing smoke + README land alongside.
- Adds optional `memoryPath:` config field with schema validation, cross-agent conflict guard, resolved-type contract, and hot-reload classification — unblocking the 5-agent finmentum family to share one workspace while keeping memories/inbox/heartbeat isolated.
- Replaces the Plan 01 tsc-green stub with real memoryPath resolution, then threads the resolved path through all 13 runtime consumers — session-memory DBs, heartbeat log, inbox discovery, send-message IPC, Discord attachments, consolidation, and health-log CLI — so two agents sharing a basePath with distinct memoryPath overrides get fully isolated runtime state.
- End-to-end integration test locks in SHARED-02 (2-agent memory/inbox/file-inode isolation) and SHARED-03 (5-agent finmentum pairwise isolation across 25 cross-agent queries) against a real temp filesystem — plus negative tests proving the Plan 01 schema + loadConfig conflict guards both surface both conflicting agent names.
- Closes 75-VERIFICATION.md Truth #7 (FAILED → VERIFIED): one-line swap in `src/manager/session-config.ts:318` from `join(config.workspace, "memory")` to `join(config.memoryPath, "memory")` so the READ path matches the WRITE path in `AgentMemoryManager.saveContextSummary`. Adds a dedicated regression test that would have caught the asymmetry in Plan 03 if it had existed.
- Three pure-read modules (openclaw-config-reader / source-memory-reader / ledger) that lock the OpenclawSourceEntry + LedgerRow source-of-truth contracts for every subsequent v2.1 migration phase, with a committed redacted openclaw.json fixture and 23 unit tests covering schema + binding-join + read-only sqlite + JSONL invariants.
- Pure-function `buildPlan()` that produces a SHA256-stable PlanReport from OpenClaw inventory + chunk counts, with finmentum-family 5-agent basePath collapse and 4 non-fatal warning kinds — 24 unit tests proving determinism, collapse rule, and pinned byte-parity.
- Nested commander subcommand `clawcode migrate openclaw <list|plan>` wires Wave 1 readers + Wave 2 diff engine into the two user-facing read-side commands, with hand-rolled ANSI color helpers and a 12-test integration suite that proves the zero-write contract via vi.mock factories on both `node:fs` and `node:fs/promises`.
- Additive extension of Phase 76's JSONL ledger schema with optional `step`, `outcome`, `file_hashes` fields plus a closed `LEDGER_OUTCOMES` enum — zero Phase 76 regressions, zero new dependencies.
- Two pure-logic modules delivering the 4-guard pre-flight chain (daemon → readonly → secret → channel) with fail-fast ordering, per-guard ledger witnesses, and literal-string refusal messages pinned in tests — zero new dependencies, 28 new unit tests, zero regressions.
- Final phase wrap: `clawcode migrate openclaw apply [--only <name>]` registered as nested commander subcommand, runtime fs-guard installed via install/uninstall symmetric around runApplyPreflight, 8 integration tests (A-H) covering all 5 phase success criteria — daemon refuse, secret refuse, channel collision, APPLY_NOT_IMPLEMENTED all-pass, MIGR-07 source-tree mtime invariant + static-grep regression. Zero new dependencies; 33 new tests; ESM frozen-namespace limitation worked around via CJS-module patching.
- File-pointer SOUL/IDENTITY contract landed: agentSchema + Zod mutual-exclusion guard + ResolvedAgentConfig + loader expandHome + session-config 3-branch lazy-read precedence. Plans 02/03 can now build the writer and mapper on a stable, typed contract.
- Two pure-logic migration modules + CLI wiring landed: `model-map.ts` (hardcoded defaults + literal warning template + --model-map parser) and `config-mapper.ts` (mapAgent pure function). Plan 03's yaml-writer now has a stable, typed, fully-tested contract to consume — 36 new tests pin every edge case including byte-exact warning copy, MCP auto-inject dedup, and fail-fast CLI flag validation.
- Closes CONF-04 (atomic + comment-preserving write) and finalizes CONF-01/02/03 by landing a Document-AST writer that produces clawcode.yaml with preserved comments + key ordering, pre-write secret scan, unmappable-model gate, and sha256 witness rows in the ledger. Full `clawcode migrate openclaw apply` pipeline now runs end-to-end: read openclaw.json → buildPlan → mapAgent each → install fs-guard → 4 pre-flight guards → writeClawcodeYaml → ledger witness → uninstall fs-guard.
- One-liner:
- Dedicated session-archiver module landed: verbatim `fs.cp` of `~/.openclaw/agents/<name>/sessions/` → `<target>/archive/openclaw-sessions/`, graceful missing-source skip, manifest-sha ledger witness, and zero ConversationStore references pinned by static-grep invariant. Closes WORK-04 "archive-only, no replay" contract.
- runApplyAction now end-to-end for workspace migration: after Phase 78 YAML write, iterates planned agents sorted by copy-mode (full → uploads-only → skip), invokes copyAgentWorkspace + archiveOpenclawSessions per agent with finmentum-aware source resolution, handles per-agent rollback without cascading failures, and records full witness trail in the ledger. 7 integration tests pin all 5 Phase 79 success criteria; 21/21 migrate-openclaw tests pass; 461/461 full regression suite green. Zero new npm deps.
- Additive origin_id UNIQUE primitive on the memories table with INSERT OR IGNORE bifurcation in MemoryStore.insert(), closing MEM-02/MEM-03 so Plans 02/03 inherit path-hash idempotency and the zero-raw-vec-SQL guarantee for free.
- 1. [Rule 1 — Bug] Upserted/skipped misclassification at same-ms boundary
- Wires `translateAgentMemories` into `runApplyAction`'s per-agent loop, introduces a CLI-local `EmbeddingService` singleton distinct from the daemon's, and pins all five Phase 80 success criteria via an end-to-end integration test that exercises the real ONNX pipeline + sqlite-vec + origin_id idempotency path.
- Four-check verifier (workspace/memory/discord/daemon) + per-agent atomic rollback with source-invariant sha256 hash-witness, both pure TypeScript libraries with zero new npm deps.
- `clawcode migrate openclaw verify [agent]` + `rollback <agent>` subcommands wired into Commander via late-bound migrateOpenclawHandlers dispatch holder, with 15 unit tests pinning formatVerifyTable emoji literals + env-var forwarding + ledger witness rows, plus 7 integration tests proving MIGR-03 resume idempotency (zero duplicate origin_ids on re-run) + MIGR-04/05 end-to-end verify/rollback cycles.
- FORK-01 + FORK-02 regression suite — 43 tests across 2 files pin the v1.5 fork-to-Opus escalation path + UsageTracker cost visibility for migrated agents regardless of primary model (Haiku, Sonnet, MiniMax, Gemini), with no budget ceiling.
- Five Wave-1 migration modules shipped TDD — pilot-selector scoring + line formatter, cutoverAgent three-guard orchestrator, buildMigrationReport with three cross-agent invariants, fs-guard allowlist one-path carve-out, and removeBindingsForAgent write helper. 52 new tests; zero regressions in the 235-test baseline migration suite.
- Wave 2 wires Wave 1 modules into `clawcode migrate openclaw` and proves the four phase-level success criteria via 19 new integration tests. Three CLI surfaces land: pilot-highlight line in `plan` output, `cutover <agent>` subcommand (the only CLI path that writes to `~/.openclaw/`), and `complete` subcommand (writes the milestone v2.1 migration report). Milestone v2.1 closes: all 31 requirements complete.
- Aligned finmentum-family `soulFile`/`identityFile` YAML pointers with workspace-copier's shared-basePath on-disk location — closes the one cross-phase wiring gap from v2.1 milestone audit, unblocks `clawcode migrate openclaw verify` for all 5 finmentum agents.

---

## v1.9 Persistent Conversation Memory (Shipped: 2026-04-18)

**Phases completed:** 5 phases, 13 plans, 27 tasks

**Key accomplishments:**

- Conversation type contracts, Zod config schema, and SQLite migrations for persistent conversation sessions/turns with SEC-01 provenance tracking
- ConversationStore class with 8-method session lifecycle CRUD, transactional turn recording with provenance fields, and AgentMemoryManager wiring
- Instruction-pattern detector with high/medium risk classification, conversation schema extension for instruction_flags, and fire-and-forget capture helper tying detection to turn recording
- Wired ConversationStore lifecycle into SessionManager and fire-and-forget turn capture into DiscordBridge -- every successful Discord response now auto-persists with SEC-02 instruction detection
- CreateMemoryInput now accepts optional sourceTurnIds; MemoryStore.insert persists source_turn_ids in a single atomic transaction and propagates the frozen array (or null) into the returned MemoryEntry — closing the CONV-03 write-path gap Phase 64 left open.
- Pure dependency-injected session-boundary summarization pipeline — compresses a completed (ended or crashed) conversation session into a standard MemoryEntry (source="conversation", tags ["session-summary", "session:{id}"], sourceTurnIds populated) via an injected `summarize` function, with AbortController-timeout, raw-turn fallback on LLM failure, and idempotent markSummarized dual-write.
- summarizeWithHaiku helper + SessionManager lifecycle hooks (stopAgent awaited, onError fire-and-forget) complete the session-boundary summarization pipeline end-to-end.
- Pure `assembleConversationBrief(input, deps)` helper renders last-N session-summary MemoryEntries as markdown under a stable `## Recent Sessions` heading, with 4-hour gap-skip short-circuit and accumulate-strategy budget enforcement — all behaviour covered by 11 unit tests with deterministic `now: number` injection.
- Wired the `assembleConversationBrief` helper from Plan 01 into `buildSessionConfig` via three new `SessionConfigDeps` fields (conversationStores/memoryStores/now), extended the assembler's canonical `SECTION_NAMES` to 8 entries with `conversation_context` landing in the mutable suffix (never the cached stable prefix), and proved end-to-end wiring with 5 tests including a mutable-suffix-only invariant assertion and a graceful-degradation path.
- Closed the single runtime gap blocking SESS-02 and SESS-03 by threading `conversationStores` + `memoryStores` through `SessionManager.configDeps()` — a surgical two-line addition that activates the entire Phase 67 read-path at runtime.
- FTS5 external-content virtual table + sync triggers + ConversationStore.searchTurns + pure-DI searchByScope orchestrator with BM25 sign inversion, decay weighting, session-summary dedup, and offset-based pagination.
- Extended `memory_lookup` MCP tool with backward-compatible scope + page parameters, extracted the IPC case body to a reusable helper, and landed 10 end-to-end integration tests exercising the full MCP → IPC → searchByScope → SQL → response chain with real in-memory SQLite stores.
- Threaded the `retrievalHalfLifeDays` config knob from `conversationConfigSchema` through `ResolvedAgentConfig` → daemon `memory-lookup` IPC case → `invokeMemoryLookup` → `searchByScope`'s `halfLifeDays` parameter, turning the inert RETR-03 tunable knob into a live runtime control proven by a TDD regression test.

---

## v1.8 Proactive Agents + Handoffs (Shipped: 2026-04-17)

**Phases completed:** 7 phases, 21 plans, 48 tasks

**Key accomplishments:**

- TurnOrigin contract + TurnDispatcher chokepoint class wrapping SessionManager.sendToAgent/streamFromAgent with origin-prefixed turnIds, caller-owned Turn lifecycle, and Discord snowflake preservation helper
- Extends the v1.7 trace store so every persisted trace row can carry a TurnOrigin JSON blob — schema migration, TurnRecord field, and Turn.recordOrigin API stitched together and proven round-trippable.
- Every agent turn on the daemon path now flows through the TurnDispatcher chokepoint — DiscordBridge routes through `dispatchStream` (caller-owned Turn), TaskScheduler routes through `dispatch` (dispatcher-owned Turn), each trace row carries a `TurnOrigin` JSON blob, and `src/cli/commands/run.ts` compiles unchanged under TS strict via the optional-field + fallback design.
- Locked the 8-status TaskStatus union, 15-field LIFE-02 row shape, and pure-function `assertLegalTransition` state machine — pure data foundation that Plans 58-02 (TaskStore) and 58-03 (reconciler + daemon wiring) build on with zero re-litigation.
- Shipped the complete `TaskStore` SQLite persistence layer — idempotent schema/migration, Zod-validated 15-field insert/get, LIFE-01 state-machine-enforced `transition`, reconciler-only `markOrphaned` escape hatch, `listStaleRunning` for the reconciler scan, and `trigger_state` CRUD for Phase 60 — with zero daemon wiring and 124 passing tests across the Phase 58 suite.
- Landed the startup-only orphan reconciler, wired TaskStore as a daemon singleton between TurnDispatcher and EscalationBudget, called reconciliation synchronously before SessionManager.startAll, and exposed `taskStore` on startDaemon's return value — closing Phase 58 with LIFE-01 + LIFE-04 proven and zero IPC / MCP / CLI surface added (Phase 59+ own all of that).
- Typed handoff errors, deterministic SHA-256 input digest, ~100-LOC JSON-Schema→Zod v4 compiler with HAND-06 `.strict()`, YAML-fed SchemaRegistry with first-boot tolerance, and 4 pure authorization functions — all composable by Plan 59-02 TaskManager with zero daemon wiring in this plan.
- TaskManager class implementing async-ticket delegation with 6-step authorization, AbortController deadline propagation, pinned schema hot-reload immunity, and digest-based retry idempotency
- 4 MCP tools + 5 IPC methods + CLI tasks retry/status + AbortSignal end-to-end plumbing + PayloadStore + daemon step 6-quater TaskManager wiring -- closes Phase 59 with all 5 ROADMAP success criteria proven
- TriggerEvent Zod schema, three-layer dedup pipeline (LRU + debounce + SQLite UNIQUE), and PolicyEvaluator pure function with 48 tests
- TriggerEngine with 3-layer dedup -> policy -> causationId dispatch pipeline, watermark-based replay, TriggerSourceRegistry, and extended TurnOrigin/TaskStore/config schemas
- SchedulerSource adapter routing prompt-based cron fires through TriggerEngine dedup+causation pipeline, with hourly task-retention heartbeat purging terminal rows
- MysqlSource polling adapter with committed-read ROLLBACKed-row protection, WebhookSource with HMAC-SHA256 verification and content-addressed idempotency keys, plus Zod config schemas for all 4 trigger source types
- InboxSource chokidar watcher for instant inbox delivery + CalendarSource MCP client poller with once-per-event dedup via fired-ID tracking in cursor_blob
- All 4 trigger sources (MySQL, webhook, inbox, calendar) registered with TriggerEngine in daemon boot, mysql2 pool with graceful shutdown, webhook routed through WebhookSource.handleHttp, heartbeat inbox demoted to reconciler fallback
- Zod-validated policy DSL with Handlebars template compilation, glob source matching, sliding-window throttle, rule differ, and PolicyEvaluator class replacing Phase 60's pass-through
- PolicyWatcher with chokidar hot-reload, JSONL audit trail, TriggerEngine evaluator injection, and daemon boot-time policy validation
- Standalone `clawcode policy dry-run --since 1h` command reads trigger_events from read-only SQLite + policies.yaml directly -- no daemon needed -- with color-coded table and JSON output
- Read-only CLI commands for trigger fire visibility (clawcode triggers) and inter-agent task listing (clawcode tasks list) with color-coded tables, human-readable token costs, and temporal proximity task correlation
- Real-time SVG task graph dashboard page with list-tasks IPC, SSE broadcast, and vanilla JS force-directed layout
- Cross-agent causation chain walker with box-drawing tree output, trigger_id/task_id extraction from TurnOrigin.source, and cumulative token cost visibility

---

## v1.7 Performance & Latency (Shipped: 2026-04-14)

**Phases completed:** 7 phases, 24 plans, 46 tasks

**Key accomplishments:**

- Ten RED test files scaffolded (6 new + 4 APPEND-only) with exact describe/it names matching every `-t` filter in 50-VALIDATION.md; downstream Wave 1/2/3 can now follow strict TDD.
- TraceStore + TraceCollector primitives for per-agent latency tracing — WAL+CASCADE SQLite store, ROW_NUMBER percentile SQL, in-memory span buffer with single-transaction flush, and `perf.traceRetentionDays` config surface.
- Per-agent TraceStore/TraceCollector lifecycle inside AgentMemoryManager, caller-owned Turn threading through SessionManager → SessionHandle, shared iterateWithTracing helper emitting first_token / tool_call.<name> / end_to_end spans in all three send variants, and assembleContextTraced wrapper around ContextAssembler.
- Caller-owned Turn lifecycle at the two hot-path entry points (DiscordBridge.handleMessage for channels and threads; TaskScheduler trigger for cron-driven turns) plus an auto-discovered trace-retention heartbeat check that prunes expired turns via CASCADE-only deletion — closing PERF-01 by ensuring every turn type produces a persisted trace and expired traces are cleaned up automatically.
- Foundation-level types and pure functions that downstream Phase 51 plans (51-02 CLI + harness, 51-03 dashboard + CI) consume directly: DEFAULT_SLOS catalog, perf.slos? Zod override on both agent + defaults schemas, ResolvedAgentConfig.perf.slos? TS mirror, BenchReport / Baseline schemas, loadThresholds + evaluateRegression with per-segment escape hatches.
- Runtime substrate for PERF-04: CLI command `clawcode bench` spawns an isolated daemon on a tempdir HOME (socket at `<tmpHome>/.clawcode/manager/clawcode.sock`), runs each prompt N=5 times via a new `bench-run-prompt` IPC method (caller-owned Turn lifecycle per Phase 50 contract), snapshots latency percentiles, writes a reproducible JSON report, and offers `--update-baseline` (operator-confirmed, never auto-writes; commit hint emitted to stdout) and `--check-regression` (CI-grade exit 0 = clean, 1 = regression).
- Closes Phase 51's user-visible and CI-visible surface: dashboard Latency panel surfaces per-segment SLO status (cyan/red/gray cell tint + monospace "SLO target" subtitle driven by server-emitted fields so per-agent overrides never drift), bench starter kit (prompts.yaml + thresholds.yaml + README.md) ships, and .github/workflows/bench.yml fails any PR that regresses a tracked p95 past threshold. Tasks 1-3 complete and atomically committed; Task 4 is a human-verify checkpoint that confirms the dashboard renders correctly in a browser AND the CI workflow is syntactically valid on GitHub.
- Per-turn cache-telemetry capture from SDK result message through TraceCollector into TraceStore: idempotent ALTER TABLE migration adding 5 columns (cache_read_input_tokens / cache_creation_input_tokens / input_tokens / prefix_hash / cache_eviction_expected), getCacheTelemetry query method returning 8-field CacheTelemetryReport, CACHE_HIT_RATE_SLO (healthy ≥ 0.60 / breach < 0.30) + evaluateCacheHitRateStatus, session-adapter cache capture wired inside iterateWithTracing's result branch.
- Two-block context assembly (stablePrefix fed to SDK's `{ type: 'preset', preset: 'claude_code', append }` systemPrompt form; mutableSuffix prepended to every user message), hot-tier `stable_token` mechanism preventing cache thrashing on single hot-tier updates (CONTEXT D-05), and per-turn prefixHash comparison inside `iterateWithTracing` via `PrefixHashProvider` closure (CONTEXT D-04) catching skills hot-reload + identity swap + hot-tier drift through the SAME handle without session teardown — end-to-end enforced by new `src/performance/__tests__/cache-eviction.test.ts` 4-scenario integration test.
- Foundation plan for Phase 53: installs `@anthropic-ai/tokenizer@0.0.4`, ships the `countTokens(text)` helper, extends the `perf` Zod surface with three new optional fields (`memoryAssemblyBudgets`, `lazySkills`, `resumeSummaryBudget`) on BOTH agentSchema AND defaultsSchema, mirrors those on `ResolvedAgentConfig.perf` via inline literal unions, and delivers the `clawcode context-audit <agent>` CLI that reads `traces.db` filesystem-direct and aggregates per-section p50/p95 token counts from `metadata_json.section_tokens` (populated by Wave 2). Addresses CTX-01.
- Per-section token budgets enforced by ContextAssembler with identity/soul warn-and-keep, hot_tier importance-ordered drop, and resume-summary 1500-token cap with 2-attempt regenerate + hard-truncate fallback; context_assemble span now emits section_tokens metadata for Plan 53-01 audit consumption.
- Lazy-skill compression with word-boundary re-inflate-on-mention renders unused skills as one-line catalog entries while recently-used skills keep full SKILL.md bodies; context_assemble span metadata now carries skills_included_count + skills_compressed_count alongside section_tokens; clawcode bench --context-audit enforces the 15% per-prompt response-length regression gate against a shared baseline.
- Wave 1 pure-data foundation for Phase 54 — streamingConfigSchema with 300ms editIntervalMs floor wired into both agentSchema.perf and defaultsSchema.perf, ResolvedAgentConfig.perf.streaming? inline-literal TS mirror, DEFAULT_SLOS gains typing_indicator p95 500ms (observational), CanonicalSegment expanded to 6 names in canonical order, TraceStore.getFirstTokenPercentiles convenience wrapper with empty-window no-data row.
- Relocate the Discord typing fire from post-session-dispatch (inside `streamAndPostResponse`) to the EARLIEST point where we know the message is ours to answer (`DiscordBridge.handleMessage` entry after Turn creation) + emit a `typing_indicator` span on the caller-owned Turn for Plan 54-01's 500ms SLO to aggregate against.
- ProgressiveMessageEditor default editIntervalMs drops 1500 -> 750ms with a per-agent override wired through `agentConfig.perf.streaming.editIntervalMs` (300ms floor enforced by Zod in Plan 54-01); first_visible_token span emitted once per editor on the first editFn call; rate-limit errors (DiscordAPIError code 20028, HTTP 429, RateLimitError) DOUBLE the interval for the rest of the turn via isDiscordRateLimitError + a single pino.WARN per editor; bench report carries rate_limit_errors counter; --check-regression hard-fails on non-zero with the CONTEXT-verbatim message; runner overall_percentiles filtered to the 4 Phase 51 segments so baseline.json Zod parse keeps working; zero new IPC methods.
- Surface the First Token metric as a prominent first-class read in BOTH the CLI (block ABOVE the segments table) and the dashboard (headline card at the top of each agent tile). Extend the Latency (24h) panel from 4 to 6 canonical segments (adding first_visible_token and typing_indicator). Drive color / threshold / subtitle from a new server-emitted `first_token_headline` object evaluated in daemon.ts with a count<5 cold-start guard. Tasks 1-3 complete; Task 4 (human-verify checkpoint) PENDING.
- Wave 1 pure-data foundation for Phase 55 — perf.tools Zod schema (maxConcurrent default 10 + min 1 floor, idempotent default whitelist locked at 4 CONTEXT D-02 entries, slos record optional) wired into both agentSchema.perf and defaultsSchema.perf, ResolvedAgentConfig.perf.tools? inline-literal TS mirror, canonicalStringify utility for deterministic cache-key hashing, TraceStore.getToolPercentiles with per-tool p50/p95/p99 aggregation sorted by p95 DESC, getPerToolSlo helper with always-valid fallback to global tool_call SLO.
- Wave 2 latency win — ToolCache class with deep-freeze-clone on set+get (two-direction mutation isolation), runWithConcurrencyLimit worker-pool semaphore with Promise.allSettled error isolation, Turn.toolCache lazy getter (cross-turn leak impossible by construction), MCP server `invokeWithCache` wrapper for the 2 registered whitelisted tools (memory_lookup, search_documents), session-adapter span metadata enrichment (tool_name, is_parallel via pre-scan, cached via hitCount-delta detection), and a 24-test proof suite covering parallel started_at within 10ms, non-idempotent bypass, config-driven whitelist, and fresh-cache-per-turn.
- Composite warm-path readiness helper (`runWarmPathCheck` + 10s timeout) plus READ-ONLY SQLite warmup across memories/usage/traces DBs, forward-compat registry schema, and a daemon-startup embedder probe that hard-fails on ONNX load failure.
- SessionManager.startAgent now blocks on `runWarmPathCheck` before flipping the registry to `status: 'running'`. The warm-path readiness state surfaces through CLI `clawcode status` (WARM-PATH column), Discord `/clawcode-fleet` embed (appended suffix), and the web dashboard per-agent card (badge) — all driven by the server-emit pattern, zero client-side threshold logic, and without adding a new IPC method.
- Warm session reuse IS happening.

---

## v1.5 Smart Memory & Model Tiering (Shipped: 2026-04-11)

**Phases completed:** 6 phases, 12 plans, 18 tasks

**Key accomplishments:**

- Wikilink parser with regex matchAll, SQLite adjacency table with CASCADE foreign keys, and link-aware insert/merge in MemoryStore
- Backlink and forward-link query functions with frozen results, plus re-warm edge restoration and lifecycle CASCADE verification
- memory_lookup MCP tool with IPC-to-SemanticSearch routing and SOUL.md fingerprint extraction for compact identity summaries
- findByTag:
- Background auto-linker heartbeat check discovers semantically similar unlinked memories and creates bidirectional graph edges with cosineSimilarity utility
- Haiku default model with fork-based transparent escalation to sonnet on 3+ consecutive errors or keyword trigger
- ask_advisor MCP tool for one-shot opus consultations with daily budget enforcement, plus /model slash command for runtime model override
- 1. [Rule 1 - Bug] Updated existing store test
- Per-agent daily/weekly token budget enforcement with Discord alert embeds at 80%/100% thresholds
- Pure assembleContext function with per-source token budgets, line-boundary truncation for memories, and pass-through for discord/summary sections
- Wired assembleContext into buildSessionConfig with per-agent contextBudgets schema, maintaining full backward compatibility

---

## v1.4 Agent Runtime (Shipped: 2026-04-10)

**Phases completed:** 0 phases, 0 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v1.3 Agent Integrations (Shipped: 2026-04-09)

**Phases completed:** 2 phases, 4 plans, 7 tasks

**Key accomplishments:**

- CLI command, MCP tool, and skill documentation wrapping spawn-subagent-thread IPC for agent-driven Discord thread creation
- Conditional system prompt injection telling agents with subagent-thread skill to prefer spawn_subagent_thread MCP tool over raw Agent tool for Discord-visible subagent work
- MCP server config in clawcode.yaml with shared definitions, per-agent resolution, and SDK session passthrough
- MCP tool listing in agent system prompts, server health checking via JSON-RPC initialize, and CLI mcp-servers command with IPC plumbing

---

## v1.2 Production Hardening & Platform Parity (Shipped: 2026-04-09)

**Phases completed:** 10 phases, 20 plans, 37 tasks

**Key accomplishments:**

- Split 960-line session-manager.ts into four focused modules (302/155/223/146 lines) using composition pattern with unchanged public API
- Eliminated all as-unknown-as casts from 7 test files and added unit tests for 4 untested CLI commands (fork, send, webhooks, mcp)
- Explicit TypeScript interfaces replacing any types for Claude Agent SDK v2 unstable API with migration documentation
- Chokidar-based config watcher with field-level diffing, reloadable/non-reloadable classification, and JSONL audit trail
- ConfigReloader dispatches config diffs to routing, scheduler, heartbeat, skills, and webhooks subsystems with routingTableRef pattern for live IPC updates
- 4-zone context classification (green/yellow/orange/red) with configurable thresholds, transition tracking, and auto-snapshot on upward entry to yellow+
- Zone trackers in HeartbeatRunner with IPC endpoints, color-coded CLI status column, and auto-snapshot/notification callbacks
- EpisodeStore with structured content format, schema migration, and semantic search integration via existing MemoryStore/sqlite-vec infrastructure
- Episode archival pipeline moving old episodes to cold tier with vec_memories removal, plus CLI episodes subcommand for operator visibility
- SQLite-backed Discord delivery queue with enqueue/retry/fail lifecycle and exponential backoff (1s base, 30s cap, 3 max attempts)
- Wired SQLite delivery queue into Discord bridge send path with IPC status endpoint and CLI visibility command
- SubagentThreadSpawner service that creates Discord threads for subagent sessions with webhook identity and binding persistence
- End-to-end subagent thread spawning via IPC with automatic session lifecycle cleanup and thread-aware message routing
- Glob-based command allowlist matcher, SECURITY.md channel ACL parser, and JSONL approval audit log with allow-always persistence
- Channel ACL enforcement in Discord bridge, 6 security IPC methods in daemon, and CLI security status command with tests
- First-run bootstrap detection, prompt generation, and identity file writer with flag-based idempotency
- Bootstrap detection wired into startAgent with early-return prompt replacement and 4-test integration suite
- Dependency-free HTTP dashboard with SSE real-time agent status, bold dark aesthetic using JetBrains Mono and hot pink accent, plus REST API for agent control
- All dashboard panels (schedules, health, memory, delivery queue, messages) with SSE real-time updates and daemon auto-start wiring

---

## v1.1 Advanced Intelligence (Shipped: 2026-04-09)

**Phases completed:** 15 phases, 32 plans, 43 tasks

**Key accomplishments:**

- MemorySource extended with 'consolidation', Zod schemas for consolidation config, digest types, SQLite migration, and SessionManager accessors for pipeline access
- ISO-week-aware consolidation pipeline that digests 7+ daily logs into weekly summaries and 4+ weekly digests into monthly summaries, with idempotent detection and atomic file archival
- Daily consolidation heartbeat check wired to HeartbeatRunner with per-check timeout override and Set-based concurrency lock
- Exponential half-life decay scoring with configurable weights and combined semantic+relevance re-ranking
- KNN-based duplicate detection with atomic merge preserving max importance, tag union, and embedding replacement
- SemanticSearch re-ranks with combined semantic+decay scoring via 2x over-fetch; MemoryStore deduplicates on insert with configurable similarity threshold
- MemoryTier type with pure tier transition functions using date-fns, tier config schema, and SQLite tier column migration with listByTier/updateTier/getEmbedding store methods
- TierManager class with cold archival to markdown+base64, hot memory injection into system prompt, and full maintenance cycle (demote/archive/promote)
- Cron-based TaskScheduler using croner with per-agent sequential locking, schedule config schema, and full type system
- TaskScheduler wired into daemon boot/shutdown with IPC "schedules" method for querying schedule statuses
- `clawcode schedules` CLI command displaying formatted table of scheduled tasks with ANSI-colored status, relative time display, and error truncation
- SkillEntry/SkillsCatalog types with filesystem scanner that parses SKILL.md frontmatter, plus skillsPath config integration
- Skills registry wired into daemon lifecycle with workspace symlinks, system prompt injection, and IPC query method
- `clawcode skills` command displaying skill catalog with agent assignments in a formatted table
- InboxMessage types with atomic file-based inbox operations and admin/subagentModel config schema extensions
- Inbox heartbeat check delivers queued messages via sendToAgent; send-message IPC method writes to target agent inbox
- Admin agent startup validation and system prompt injection with cross-workspace agent visibility table and subagent model guidance
- CLI `clawcode send <agent> "message"` command with --from and --priority options using IPC send-message method
- SlashCommandDef/SlashCommandOption types, 5 default commands, and Zod schema extension for per-agent slash command config
- SlashCommandHandler with guild-scoped registration via Discord REST API, interaction routing to agents by channel, and deferred reply pattern for long-running commands
- Attachment download module with 25MB size limit, 30s timeout, atomic writes, XML metadata formatting, and stale file cleanup
- Bridge downloads Discord attachments to agent workspace inbox and formats messages with local paths and multimodal image hints
- Thread binding type system with atomic persistent registry and config schema extension for Discord thread-to-agent sessions
- ThreadManager class with TDD-driven spawn/route/limit logic plus bridge threadCreate listener and thread-priority message routing
- Idle thread cleanup via heartbeat, daemon ThreadManager integration, and CLI threads command with table display
- Webhook identity types, config schema extension, and WebhookManager for per-agent Discord identities
- Daemon integration, IPC method, and CLI command for webhook identity management
- Session fork capability with pure functions, IPC method, and CLI command
- Context summary persistence and auto-injection into system prompt on session resume
- MCP stdio server exposing ClawCode tools for external Claude Code sessions
- Reaction event forwarding from Discord to bound agents
- Memory search and list CLI commands with IPC integration

---

## Completed Milestones

### v1.0 — Core Multi-Agent System (2026-04-08 to 2026-04-09)

**Status:** Complete
**Phases:** 5 | **Plans:** 11 | **Tests:** 210 | **Commits:** 85

**What shipped:**

1. **Central YAML config system** — Zod validation, defaults merging, per-agent overrides
2. **Agent lifecycle management** — Start/stop/restart, crash recovery with exponential backoff, PID registry, Unix socket IPC
3. **Discord channel routing** — Channel-to-agent binding, token bucket rate limiter (50 req/s + per-channel), native plugin integration
4. **Per-agent memory system** — SQLite + sqlite-vec, local embeddings (all-MiniLM-L6-v2), semantic search, daily session logs, auto-compaction
5. **Extensible heartbeat framework** — Directory-based check discovery, context fill monitoring, NDJSON logging

**Key decisions:**

- Agents are Claude Code SDK sessions, not separate OS processes
- Manager is deterministic TypeScript, not AI
- Discord routing via native plugin (system prompt channel binding), not separate bridge
- Memory uses local embeddings (zero cost, offline-capable)

**Archive:** [v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) | [v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md)

---
*Last updated: 2026-04-09*
