# Milestones: ClawCode

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
