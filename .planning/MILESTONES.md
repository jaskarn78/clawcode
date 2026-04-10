# Milestones: ClawCode

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
