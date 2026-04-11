# Architecture

**Analysis Date:** 2026-04-11

## Pattern Overview

**Overall:** Daemon-centric multi-agent orchestration with adapter-pattern session management

**Key Characteristics:**
- A single long-running daemon process (`startDaemon` in `src/manager/daemon.ts`) owns all agent sessions, Discord routing, heartbeat monitoring, and task scheduling
- All external control surfaces (CLI, MCP server, Dashboard) communicate with the daemon exclusively via a Unix domain socket (JSON-RPC 2.0 IPC)
- Each agent session is a persistent Claude Agent SDK query loop; sessions are identified by a stable `sessionId` and can be resumed across daemon restarts
- Agents are isolated by workspace directory (`~/.clawcode/agents/<name>/`); each gets its own SQLite memory database, skills directory, and identity files
- `SessionAdapter` interface decouples session lifecycle from the Claude SDK, enabling `MockSessionAdapter` for tests and `SdkSessionAdapter` for production

## Layers

**Configuration Layer:**
- Purpose: Load, validate, and resolve agent configurations from `clawcode.yaml`
- Location: `src/config/`
- Contains: `loader.ts` (YAML parsing + Zod validation), `schema.ts` (Zod schemas), `defaults.ts` (default values), `watcher.ts` (chokidar file watch), `differ.ts` (config diff), `audit-trail.ts`
- Depends on: `zod`, `yaml`, `chokidar`
- Used by: `src/manager/daemon.ts`, `src/cli/index.ts`

**Agent Workspace Layer:**
- Purpose: Create and initialize isolated per-agent filesystem workspaces
- Location: `src/agent/`
- Contains: `workspace.ts` (creates `memory/`, `skills/`, `SOUL.md`, `IDENTITY.md`), `runner.ts`
- Depends on: `src/config/`, `src/shared/`
- Used by: CLI `init` command, daemon startup

**Session Management Layer:**
- Purpose: Agent lifecycle — start, stop, restart, fork, crash recovery, registry persistence
- Location: `src/manager/`
- Key files: `session-manager.ts` (orchestrates lifecycle), `session-adapter.ts` (SDK abstraction), `session-memory.ts` (per-agent memory init), `session-recovery.ts` (backoff/restart), `session-config.ts` (build SDK options), `registry.ts` (JSON registry), `fork.ts` (session forking), `escalation.ts` (model escalation), `daemon.ts` (top-level bootstrap), `daemon-entry.ts` (process entry point)
- Depends on: all other layers
- Used by: daemon, IPC handler, CLI commands via IPC

**IPC Layer:**
- Purpose: JSON-RPC 2.0 over Unix domain socket — CLI and MCP server talk to daemon
- Location: `src/ipc/`
- Contains: `server.ts` (newline-delimited JSON socket server), `client.ts` (send request + await response), `protocol.ts` (Zod schema for request/response)
- Socket path: `~/.clawcode/manager/clawcode.sock`
- Used by: daemon (server side), CLI commands (client side), MCP server (client side), dashboard (client side)

**Discord Layer:**
- Purpose: Discord bot integration — receive messages, route to agents, deliver responses
- Location: `src/discord/`
- Key files: `bridge.ts` (discord.js Client, message routing), `router.ts` (channelId → agentName mapping), `thread-manager.ts` (Discord thread sessions), `webhook-manager.ts` (per-agent webhook identities), `delivery-queue.ts` (reliable outbound delivery), `slash-commands.ts`, `streaming.ts` (progressive message editing), `rate-limiter.ts`, `subagent-thread-spawner.ts`, `attachments.ts`, `reactions.ts`
- Depends on: `discord.js`, `src/manager/session-manager.ts`, `src/security/`
- Used by: daemon startup

**Memory Layer:**
- Purpose: Per-agent persistent memory with vector search, tiering, consolidation, and episodic storage
- Location: `src/memory/`
- Key files: `store.ts` (SQLite + sqlite-vec CRUD), `embedder.ts` (`@huggingface/transformers` ONNX, all-MiniLM-L6-v2), `search.ts` (semantic KNN), `tier-manager.ts` (hot/warm/cold tier transitions), `tiers.ts` (promotion/demotion rules), `consolidation.ts` (daily/weekly/monthly compaction), `decay.ts` (relevance decay), `dedup.ts` (similarity deduplication), `graph.ts` (wikilink graph), `graph-search.ts` (graph traversal), `compaction.ts` (context fill), `episode-store.ts`, `session-log.ts`
- DB path per agent: `~/.clawcode/agents/<name>/memory/memories.db`
- Depends on: `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers`
- Used by: `src/manager/session-memory.ts`, heartbeat checks, MCP tools

**Heartbeat Layer:**
- Purpose: Periodic health checks for each running agent; context zone tracking; triggers snapshots
- Location: `src/heartbeat/`
- Key files: `runner.ts` (interval timer, check dispatch), `discovery.ts` (dynamic check module loading), `context-zones.ts` (green/yellow/orange/red zone tracker), `checks/` (pluggable check modules: `context-fill.ts`, `consolidation.ts`, `tier-maintenance.ts`, `auto-linker.ts`, `inbox.ts`, `thread-idle.ts`, `attachment-cleanup.ts`)
- Depends on: `src/manager/session-manager.ts`
- Used by: daemon

**Scheduler Layer:**
- Purpose: Cron-based scheduled prompts sent to agents
- Location: `src/scheduler/`
- Contains: `scheduler.ts` (croner integration), `types.ts`
- Depends on: `croner`, `src/manager/session-manager.ts`
- Used by: daemon

**Skills Layer:**
- Purpose: Scan, catalog, link, and install SKILL.md files into agent workspaces
- Location: `src/skills/`
- Contains: `scanner.ts` (catalog SKILL.md files), `linker.ts` (symlink into agent workspace), `installer.ts` (install workspace skills globally), `types.ts`
- Used by: daemon startup, CLI `skills` command

**Security Layer:**
- Purpose: Channel ACL enforcement and allowlist/approval-log management
- Location: `src/security/`
- Contains: `acl-parser.ts` (parse SECURITY.md), `allowlist-matcher.ts` (pattern matching), `approval-log.ts` (persist allow-always decisions), `types.ts`
- Used by: `src/discord/bridge.ts`, daemon

**Collaboration Layer:**
- Purpose: Filesystem-based inter-agent messaging via inbox directories
- Location: `src/collaboration/`
- Contains: `inbox.ts` (atomic JSON write to `<workspace>/inbox/`), `types.ts`
- Pattern: atomic write (write `.tmp`, rename to final) prevents partial reads
- Used by: daemon IPC handler for `send-message` method

**Usage Layer:**
- Purpose: Track token/cost usage per agent session; enforce escalation budgets; advisor budget for Opus queries
- Location: `src/usage/`
- Contains: `tracker.ts` (SQLite usage log per agent), `budget.ts` (`EscalationBudget`, SQLite), `advisor-budget.ts` (`AdvisorBudget`, rate-limits Opus advisor calls), `pricing.ts`, `types.ts`
- Used by: `src/manager/session-manager.ts`, `src/manager/escalation.ts`, daemon

**MCP Server Layer:**
- Purpose: Expose ClawCode daemon tools to Claude Code sessions via MCP
- Location: `src/mcp/`
- Contains: `server.ts` (MCP tool definitions bridging to IPC), `health.ts`
- Exposes tools: `agent_status`, `send_message`, `memory_lookup`, `spawn_subagent_thread`, `ask_advisor`, etc.
- Used by: agents that load `clawcode` as an MCP server in their session config

**Bootstrap Layer:**
- Purpose: Detect when an agent needs a first-run bootstrap prompt and build it
- Location: `src/bootstrap/`
- Contains: `detector.ts` (checks for existing memories/SOUL.md), `prompt-builder.ts`, `writer.ts`, `types.ts`
- Used by: `src/manager/session-manager.ts` on `startAgent`

**Dashboard Layer:**
- Purpose: Web UI for agent status monitoring via SSE + REST
- Location: `src/dashboard/`
- Contains: `server.ts` (Node.js `http` module, no framework), `sse.ts` (Server-Sent Events), `static/` (HTML/CSS/JS)
- Port: configurable, default via `dashboard` command
- Used by: daemon

**CLI Layer:**
- Purpose: User-facing command interface, communicates with daemon via IPC
- Location: `src/cli/`
- Contains: `index.ts` (Commander root + `init` action), `commands/` (one file per subcommand), `output.ts` (logging helpers)
- All commands (except `init`) send IPC requests to the running daemon

## Data Flow

**Discord Message to Agent Response:**

1. `DiscordBridge` receives `messageCreate` event from discord.js
2. `checkChannelAccess` verifies security policy for the channel
3. `buildRoutingTable` lookup: `channelId → agentName` via `src/discord/router.ts`
4. Attachments downloaded via `src/discord/attachments.ts`
5. `SessionManager.streamFromAgent(agentName, message, onChunk)` called
6. `SdkSessionAdapter` calls `sdk.query({ prompt, options: { resume: sessionId } })`
7. Claude Agent SDK streams assistant messages back; `onChunk` callback called per chunk
8. `ProgressiveMessageEditor` in `src/discord/streaming.ts` edits Discord message in place as chunks arrive
9. Rate limiter (`src/discord/rate-limiter.ts`) enforces per-channel limits
10. `DeliveryQueue` ensures reliable final message delivery

**Agent Session Start:**

1. CLI `start <name>` sends IPC `start` request to daemon
2. Daemon IPC handler calls `SessionManager.startAgent(name, config)`
3. `detectBootstrapNeeded` checks workspace state (`src/bootstrap/detector.ts`)
4. `buildSessionConfig` assembles system prompt: identity + hot memories + tool definitions + graph context + discord bindings + context summary (via `src/manager/context-assembler.ts`)
5. `TierManager.refreshHotTier()` promotes relevant memories to hot tier
6. `SdkSessionAdapter.createSession(sessionConfig)` calls `sdk.query({ prompt: "Session initialized." })`
7. Initial query drained to extract `sessionId`
8. `handle.onError` registered for crash detection → `SessionRecoveryManager.handleCrash`
9. Registry updated to `running` with `sessionId`

**Memory Write (on compaction tick):**

1. `HeartbeatRunner` fires `context-fill` check
2. If fill % exceeds threshold, `CompactionManager` triggers
3. Conversation turns extracted from `SessionLogger`
4. New memories written to `MemoryStore` via `store.add()` with embedding
5. `dedup.checkForDuplicate` consulted before insert (cosine similarity threshold 0.85)
6. `TierManager.runMaintenance()` promotes/demotes/archives memories
7. Cold memories written as YAML+markdown to `<workspace>/memory/cold/`

**IPC Request Routing:**

1. CLI client writes JSON-RPC 2.0 request to Unix socket (`~/.clawcode/manager/clawcode.sock`)
2. `createIpcServer` in `src/ipc/server.ts` reads newline-delimited JSON
3. `routeMethod` in daemon dispatches to the appropriate subsystem (SessionManager, HeartbeatRunner, TaskScheduler, etc.)
4. Response written back to socket

**State Management:**
- Agent lifecycle state: `~/.clawcode/manager/registry.json` (immutable updates via `updateEntry`)
- Per-agent memory: `~/.clawcode/agents/<name>/memory/memories.db` (SQLite)
- Discord thread bindings: `~/.clawcode/manager/thread-registry.json`
- Escalation budget: `~/.clawcode/manager/escalation-budget.db`
- Advisor budget: `~/.clawcode/manager/advisor-budget.db`
- Delivery queue: `~/.clawcode/manager/delivery-queue.db`
- Approval log: `~/.clawcode/manager/approval-audit.jsonl`
- Inter-agent messages: `~/.clawcode/agents/<name>/inbox/*.json`

## Key Abstractions

**SessionAdapter:**
- Purpose: Decouples session create/resume from Claude SDK; enables testability
- Files: `src/manager/session-adapter.ts`
- Pattern: Interface with `SdkSessionAdapter` (production) and `MockSessionAdapter` (tests)

**SessionHandle:**
- Purpose: Represents one active agent session; provides `send`, `sendAndCollect`, `sendAndStream`, `close`, `onError`, `onEnd`
- Files: `src/manager/session-adapter.ts`
- Pattern: Per-turn query pattern — each `send*` call creates a fresh `sdk.query({ resume: sessionId })` rather than holding a persistent stream

**MemoryStore:**
- Purpose: SQLite-backed CRUD for memories with vector index via sqlite-vec
- Files: `src/memory/store.ts`
- Pattern: Synchronous better-sqlite3 with prepared statements; `sqlite-vec` extension loaded via `db.loadExtension()`

**RoutingTable:**
- Purpose: Bidirectional map of `channelId ↔ agentName`; built at daemon start from config
- Files: `src/discord/router.ts`, `src/discord/types.ts`
- Pattern: Immutable Maps built once; throws on duplicate channel bindings

**CheckModule:**
- Purpose: Pluggable heartbeat check interface
- Files: `src/heartbeat/types.ts`, `src/heartbeat/checks/`
- Pattern: `{ name, execute(context): Promise<CheckResult>, interval?, timeout? }` — discovered dynamically via `src/heartbeat/discovery.ts`

**ResolvedAgentConfig:**
- Purpose: Fully merged agent config (agent + defaults); source of truth for all agent behavior
- Files: `src/shared/types.ts`
- Pattern: All fields concrete (no optionals except `soul`, `identity`, `webhook`, `escalationBudget`, `contextBudgets`); produced by `resolveAgentConfig` in `src/config/loader.ts`

## Entry Points

**Daemon Entry:**
- Location: `src/manager/daemon-entry.ts`
- Triggers: `node dist/manager/daemon-entry.js --config clawcode.yaml` (spawned by `start-all` CLI command)
- Responsibilities: Parse `--config` arg, call `startDaemon()`, handle fatal errors

**CLI Entry:**
- Location: `src/cli/index.ts` (bin: `clawcode`)
- Triggers: User runs `clawcode <command>`
- Responsibilities: Commander root, `init` action (workspace creation), register all subcommands

**MCP Server Entry:**
- Location: `src/mcp/server.ts`
- Triggers: Claude Agent SDK loads it as an MCP server (`stdio` transport) within an agent session
- Responsibilities: Expose IPC methods as MCP tools; agents call `memory_lookup`, `spawn_subagent_thread`, `ask_advisor`, etc.

**Public API Entry:**
- Location: `src/index.ts`
- Triggers: Programmatic consumers (`import { SessionManager } from 'clawcode'`)
- Responsibilities: Re-export core types, errors, `SessionManager`, `startDaemon`, `loadConfig`, `createWorkspace`

## Error Handling

**Strategy:** Typed error classes extending `Error`; errors bubble to CLI output or IPC error responses; heartbeat timeouts return `critical` `CheckResult` rather than throwing

**Patterns:**
- `ConfigValidationError`, `ConfigFileNotFoundError`, `WorkspaceError`, `ManagerError`, `SessionError`, `IpcError` defined in `src/shared/errors.ts`
- Agent crashes handled by `SessionRecoveryManager` — exponential backoff (1s base, 300s max, 10 retries); terminal `failed` status after max retries
- IPC errors return JSON-RPC error objects (code -32603 for handler errors, -32600 for invalid requests)
- Usage extraction errors in `SdkSessionAdapter` are swallowed with try/catch — never break the send flow
- `MemoryError`, `EmbeddingError` in `src/memory/errors.ts`

## Cross-Cutting Concerns

**Logging:** pino (`src/shared/logger.ts`); structured JSON; each component creates a `logger.child({ component: '...' })`; heartbeat results written to NDJSON `<workspace>/memory/heartbeat.log`

**Validation:** Zod v4 at config load (`src/config/schema.ts`), IPC request parsing (`src/ipc/protocol.ts`), and memory entry creation (`src/memory/schema.ts`)

**Authentication:** Discord bot token loaded from `~/.claude/channels/discord/.env` or `DISCORD_BOT_TOKEN` env var; 1Password `op://` references resolved via `op read` CLI at daemon startup

**Immutability:** All config types use `readonly`; registry updates produce new objects via `updateEntry` (never mutate in place); `ResolvedAgentConfig` is fully readonly

---

*Architecture analysis: 2026-04-11*
