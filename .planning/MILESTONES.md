# Milestones: ClawCode

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
