# Architecture

**Analysis Date:** 2026-04-10

## Pattern Overview

**Overall:** Daemon-centric multi-agent orchestration with a layered process model

**Key Characteristics:**
- A long-running daemon process owns all agent sessions, IPC surface, Discord bridge, heartbeat, scheduler, and registry
- Each Claude Code agent session is managed via the `@anthropic-ai/claude-agent-sdk` query() API, with per-turn resume for session continuity
- A Unix domain socket (JSON-RPC 2.0 over newline-delimited JSON) is the sole control plane between CLI commands and the daemon
- Discord acts as the user-facing communication channel; messages are routed by channel ID to the named agent that owns that channel
- An alternative `clawcode run <agent>` path runs a single agent in the foreground without any daemon infrastructure

## Layers

**CLI Layer:**
- Purpose: User entry points — init, start, stop, status, send, fork, memory, usage, etc.
- Location: `src/cli/index.ts`, `src/cli/commands/`
- Contains: Commander command registrations, one file per command
- Depends on: IPC client (`src/ipc/client.ts`) for all runtime control; config loader for init
- Used by: End user via `clawcode` binary

**IPC Layer:**
- Purpose: JSON-RPC 2.0 transport over Unix domain socket at `~/.clawcode/manager/clawcode.sock`
- Location: `src/ipc/server.ts`, `src/ipc/client.ts`, `src/ipc/protocol.ts`
- Contains: Socket server (daemon side) and client (CLI side)
- Depends on: Nothing from the app layer — pure transport
- Used by: CLI commands (client side), daemon (server side), MCP server (`src/mcp/server.ts`)

**Daemon Layer:**
- Purpose: Central orchestrator — owns all subsystems, started once, runs persistently
- Location: `src/manager/daemon.ts`, `src/manager/daemon-entry.ts`
- Contains: `startDaemon()` function wiring all subsystems; `SOCKET_PATH`, `PID_PATH`, `REGISTRY_PATH` constants
- Depends on: All subsystems below
- Used by: `clawcode start-all` (spawns as background process via `daemon-entry.ts`)

**Session Management Layer:**
- Purpose: Lifecycle management of individual Claude Code agent sessions
- Location: `src/manager/session-manager.ts`
- Contains: `SessionManager` class — start, stop, restart, reconcile, fork, send, stream
- Depends on: `SessionAdapter` interface, `AgentMemoryManager`, `SessionRecoveryManager`, `buildSessionConfig`, registry functions
- Used by: Daemon, IPC handler dispatch, `clawcode run` command

**Session Adapter Layer:**
- Purpose: Abstracts the Claude Agent SDK behind a stable interface; enables mock injection in tests
- Location: `src/manager/session-adapter.ts`
- Contains: `SessionAdapter` interface, `SessionHandle` type, `SdkSessionAdapter` (production), `MockSessionAdapter` (tests)
- Key pattern: Each `send`/`sendAndCollect`/`sendAndStream` call issues a fresh `sdk.query()` with `resume: sessionId` for per-turn continuity
- Depends on: `@anthropic-ai/claude-agent-sdk` (dynamic import, cached after first load)
- Used by: `SessionManager`

**Config Layer:**
- Purpose: Load, validate, and resolve agent configs from `clawcode.yaml`
- Location: `src/config/`
- Contains: `schema.ts` (Zod schemas), `loader.ts` (YAML parse + validation + defaults merge), `watcher.ts` (chokidar file watching), `differ.ts` (config diff), `audit-trail.ts`
- Key type: `ResolvedAgentConfig` in `src/shared/types.ts` — the canonical agent config after defaults merge
- Depends on: `zod`, `yaml`, `chokidar`
- Used by: Daemon startup, CLI init command, `ConfigReloader`

**Discord Layer:**
- Purpose: Bot connection, message routing, webhook delivery, slash commands, thread management
- Location: `src/discord/`
- Contains:
  - `bridge.ts` — `DiscordBridge` class using `discord.js`; connects to Discord, listens for messages, routes to agents, sends responses
  - `router.ts` — builds an immutable `RoutingTable` (channelId → agentName, agentName → channelIds[])
  - `delivery-queue.ts` — async delivery queue for ordered message dispatch
  - `thread-manager.ts` — Discord thread lifecycle for subagent thread sessions
  - `webhook-manager.ts` — per-agent webhook identities for rich Discord personas
  - `slash-commands.ts` — Discord slash command registration and dispatch
  - `rate-limiter.ts` — per-channel rate limiting
  - `streaming.ts` — `ProgressiveMessageEditor` for streaming response edits
  - `attachments.ts` — attachment download and metadata formatting
- Depends on: `discord.js`, `SessionManager`, `RoutingTable`
- Used by: Daemon, `clawcode run` command

**Memory Layer:**
- Purpose: Persistent per-agent semantic memory using SQLite + sqlite-vec
- Location: `src/memory/`
- Contains:
  - `store.ts` — `MemoryStore`, opens per-agent SQLite DB, loads `sqlite-vec`, CRUD + vector operations
  - `embedder.ts` — `EmbeddingService` using `@huggingface/transformers` (all-MiniLM-L6-v2, 384-dim, local ONNX)
  - `search.ts` — `SemanticSearch`, KNN queries over sqlite-vec
  - `tiers.ts` / `tier-manager.ts` — hot/warm/cold memory tiering
  - `consolidation.ts` — time-based memory consolidation (daily/weekly/monthly)
  - `compaction.ts` — context fill management; `CharacterCountFillProvider`
  - `session-log.ts` — per-session interaction logging
  - `decay.ts` — relevance decay scoring
  - `dedup.ts` — duplicate detection on insert
  - `episode-store.ts` / `episode-archival.ts` — episodic memory archival
- Depends on: `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers`, `nanoid`
- Used by: `AgentMemoryManager` in `src/manager/session-memory.ts`

**Heartbeat Layer:**
- Purpose: Periodic health checks for running agents; context-fill monitoring; zone-based snapshots
- Location: `src/heartbeat/`
- Contains:
  - `runner.ts` — `HeartbeatRunner` — setInterval-based check executor
  - `discovery.ts` — dynamically discovers check modules from `src/heartbeat/checks/`
  - `context-zones.ts` — `ContextZoneTracker` — tracks green/yellow/orange/red fill zones, triggers snapshot callbacks
  - `checks/` — pluggable check modules: `consolidation.ts`, `context-fill.ts`, `inbox.ts`, `tier-maintenance.ts`, `thread-idle.ts`, `attachment-cleanup.ts`
- Depends on: `SessionManager`, registry
- Used by: Daemon

**Scheduler Layer:**
- Purpose: Cron-triggered agent prompts using `croner`
- Location: `src/scheduler/`
- Contains: `TaskScheduler` — registers croner jobs per agent, sends scheduled prompts via `SessionManager`
- Depends on: `croner`, `SessionManager`
- Used by: Daemon

**Security Layer:**
- Purpose: Channel ACLs, allowlist matching, approval audit log
- Location: `src/security/`
- Contains: `acl-parser.ts` (parses SECURITY.md per workspace), `allowlist-matcher.ts`, `approval-log.ts`
- Used by: Daemon startup, Discord bridge message routing

**MCP Server Layer:**
- Purpose: Expose daemon control surface as an MCP tool server (for Claude Code tool use)
- Location: `src/mcp/`
- Contains: `server.ts` — `McpServer` using `@modelcontextprotocol/sdk`; tools delegate to daemon IPC
- Depends on: `src/ipc/client.ts`, `@modelcontextprotocol/sdk`
- Used by: External Claude Code sessions via stdio MCP protocol

**Dashboard Layer:**
- Purpose: Web UI for real-time agent status via SSE + REST
- Location: `src/dashboard/`
- Contains: `server.ts` (Node.js `http` server, no framework), `sse.ts` (`SseManager`), `static/` (HTML/CSS/JS)
- Depends on: `src/ipc/client.ts` for data, no HTTP framework
- Used by: Daemon (started alongside IPC server)

**Skills Layer:**
- Purpose: Skill file management — scanning, linking into agent workspaces, installing to `~/.claude/skills/`
- Location: `src/skills/`
- Contains: `scanner.ts`, `linker.ts`, `installer.ts`
- Workspace skills directory: `skills/` at project root

**Bootstrap Layer:**
- Purpose: Detect first-run agents needing workspace setup; inject walkthrough prompt
- Location: `src/bootstrap/`
- Contains: `detector.ts` (`detectBootstrapNeeded`), `prompt-builder.ts`, `writer.ts`
- Used by: `buildSessionConfig` in `src/manager/session-config.ts`

**Collaboration Layer:**
- Purpose: Inter-agent filesystem inbox for async message delivery
- Location: `src/collaboration/`
- Contains: `inbox.ts` — write messages to agent workspace `inbox/` directories

## Data Flow

**Daemon Startup Flow:**

1. `clawcode start-all` spawns `daemon-entry.ts` as a detached background process
2. `startDaemon()` in `src/manager/daemon.ts` runs: creates manager dir, cleans stale socket, writes PID, loads config, installs skills
3. Resolves all `ResolvedAgentConfig` objects from `clawcode.yaml` via `loadConfig` + `resolveAllAgents`
4. Creates `SessionManager` with `SdkSessionAdapter`, scans skills catalog, builds routing table
5. Calls `manager.reconcileRegistry()` — resumes any sessions that were running before restart, schedules recovery for crashed ones
6. Starts heartbeat runner, task scheduler, thread manager, webhook manager, security matchers, dashboard server
7. Creates IPC server (Unix socket), starts Discord bridge
8. IPC server begins accepting commands from CLI

**Agent Start Flow:**

1. CLI sends `agent.start` via `sendIpcRequest()` to daemon's Unix socket
2. IPC server routes to `SessionManager.startAgent(name, config)`
3. `AgentMemoryManager.initMemory()` opens per-agent SQLite DB, initializes `MemoryStore`, `EmbeddingService`, `TierManager`, `SessionLogger`, `UsageTracker`
4. `detectBootstrapNeeded()` checks if workspace SOUL.md/IDENTITY.md exist
5. `buildSessionConfig()` assembles `AgentSessionConfig`: reads SOUL.md + IDENTITY.md, injects hot-tier memories, skills list, Discord channel bindings, admin roster, context summary
6. `SdkSessionAdapter.createSession()` calls `sdk.query()` to establish the Claude Code session; extracts `session_id` from first result message
7. `SessionHandle` is stored in `sessions` Map; `onError` handler wired to crash recovery
8. Registry entry updated to `running` with `sessionId`

**Discord Message Flow:**

1. `DiscordBridge` receives Discord message event via `discord.js` Client
2. `AllowlistMatcher` / security ACL check against channel and user
3. `router.getAgentForChannel(table, channelId)` looks up agent name
4. Rate limiter checked; attachments downloaded if present
5. If thread message: `ThreadManager` routes to subagent session
6. `SessionManager.streamFromAgent(name, message, onChunk)` calls `sdk.query()` with `resume: sessionId`
7. `ProgressiveMessageEditor` streams response chunks back to Discord as live edits
8. Final response sent; usage recorded via `UsageTracker`

**IPC Command Flow:**

1. CLI calls `sendIpcRequest(SOCKET_PATH, method, params)` in `src/ipc/client.ts`
2. Unix socket client connects, writes newline-delimited JSON-RPC request, reads response
3. `createIpcServer` in `src/ipc/server.ts` buffers incoming bytes, splits on newlines, parses JSON-RPC
4. Validated request dispatched to `IpcHandler` function in daemon
5. Handler routes by method name to `SessionManager` or other subsystem
6. JSON-RPC response written back to socket

**State Management:**
- Agent lifecycle state: `~/.clawcode/manager/registry.json` (atomic rename writes)
- Session handles: in-memory `Map<string, SessionHandle>` in `SessionManager`
- Memory: per-agent SQLite DB at `{workspace}/memory/memory.db`
- Thread registry: `~/.clawcode/manager/thread-registry.json`
- Security approval log: `~/.clawcode/manager/approval-audit.jsonl`

## Key Abstractions

**SessionAdapter / SessionHandle:**
- Purpose: Decouple session creation from SDK internals; enable test mocking
- Files: `src/manager/session-adapter.ts`
- Pattern: Interface + two implementations (`SdkSessionAdapter`, `MockSessionAdapter`); `SessionHandle` is a plain object with `send`, `sendAndCollect`, `sendAndStream`, `close`, `onError`, `onEnd`

**ResolvedAgentConfig:**
- Purpose: Single canonical config type after defaults merge; passed everywhere
- File: `src/shared/types.ts`
- Pattern: Readonly object; produced by `resolveAgentConfig()` in `src/config/loader.ts`

**RoutingTable:**
- Purpose: Bidirectional map: channelId ↔ agentName
- File: `src/discord/types.ts`, built by `src/discord/router.ts`
- Pattern: Two immutable Maps; validated for duplicate channel claims on construction

**Registry / RegistryEntry:**
- Purpose: Persistent agent status store; survives daemon restarts
- File: `src/manager/types.ts`, operations in `src/manager/registry.ts`
- Pattern: Immutable records; atomic rename writes; all updates produce new objects

**IpcHandler:**
- Purpose: Single dispatch function — `(method, params) => Promise<unknown>`
- File: `src/ipc/server.ts` (type), `src/manager/daemon.ts` (implementation)
- Pattern: Big routing switch inside daemon; all subsystem access goes through this

**MemoryStore:**
- Purpose: Per-agent SQLite + sqlite-vec storage for memories and session logs
- File: `src/memory/store.ts`
- Pattern: Prepared statements, WAL mode, dedup on insert, vector embedding stored alongside text

## Entry Points

**CLI Binary:**
- Location: `src/cli/index.ts` → compiled to `dist/cli/index.js` → `bin/clawcode`
- Triggers: User running `clawcode <command>`
- Responsibilities: Parses args via Commander, delegates to registered command handlers

**Daemon Entry:**
- Location: `src/manager/daemon-entry.ts`
- Triggers: Spawned as child process by `clawcode start-all`
- Responsibilities: Parses `--config` flag, calls `startDaemon()`

**`clawcode run <agent>`:**
- Location: `src/cli/commands/run.ts`
- Triggers: User runs foreground single-agent mode
- Responsibilities: Creates `SessionManager` + `DiscordBridge` directly, no IPC socket or daemon needed

**MCP Server:**
- Location: `src/mcp/server.ts`
- Triggers: Started by Claude Code as an MCP tool server (stdio transport)
- Responsibilities: Exposes `agent_status`, `send_message`, `spawn_subagent_thread`, etc. as Claude tools; proxies to daemon via IPC

**Public API:**
- Location: `src/index.ts`
- Triggers: Programmatic import by consumers
- Responsibilities: Re-exports core types, `SessionManager`, config functions, errors for library usage

## Error Handling

**Strategy:** Typed error classes in `src/shared/errors.ts`; errors propagate through layers and are caught at CLI boundaries (process.exit) or IPC boundaries (JSON-RPC error response)

**Patterns:**
- `ConfigFileNotFoundError` / `ConfigValidationError` — thrown by config loader, caught in CLI action handlers
- `SessionError` — thrown by `SessionManager` for invalid state transitions
- `ManagerError` — thrown by daemon for startup failures
- `ManagerNotRunningError` — thrown by IPC client when socket is not reachable
- `IpcError` — wraps daemon-side errors for transport back to CLI client
- Crash recovery: `SessionRecoveryManager` (`src/manager/session-recovery.ts`) handles exponential backoff restarts; after `maxRetries` exhausted, status set to `failed`

## Cross-Cutting Concerns

**Logging:** `pino` via `src/shared/logger.ts`; structured JSON; each subsystem creates a child logger with `component` field

**Validation:** Zod v4 schemas in `src/config/schema.ts` and `src/ipc/protocol.ts`; all external input validated at boundaries

**Authentication:** Discord bot token loaded from `~/.claude/channels/discord/.env` or `DISCORD_BOT_TOKEN` env var; 1Password `op://` references supported in `clawcode.yaml`

**Immutability:** All shared types are `readonly`; registry updates produce new objects via `updateEntry()`; configs never mutated in place

---

*Architecture analysis: 2026-04-10*
