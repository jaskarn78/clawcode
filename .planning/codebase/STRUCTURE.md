# Codebase Structure

**Analysis Date:** 2026-04-10

## Directory Layout

```
workspace-coding/                  # Project root
├── src/                           # All TypeScript source
│   ├── index.ts                   # Public library API re-exports
│   ├── agent/                     # Workspace creation + standalone runner
│   ├── bootstrap/                 # First-run walkthrough prompt injection
│   ├── cli/                       # CLI entry point + all command handlers
│   │   ├── index.ts               # Commander setup, registers all commands
│   │   ├── output.ts              # CLI output helpers (cliLog, cliError)
│   │   └── commands/              # One file per CLI command
│   ├── collaboration/             # Inter-agent filesystem inbox
│   ├── config/                    # Config loading, validation, watching
│   ├── dashboard/                 # HTTP dashboard server + SSE + static UI
│   │   └── static/                # index.html, styles.css, app.js
│   ├── discord/                   # Discord bot, routing, threads, webhooks
│   ├── heartbeat/                 # Periodic health checks + context zones
│   │   └── checks/                # Pluggable check modules (one per concern)
│   ├── ipc/                       # Unix socket JSON-RPC server + client
│   ├── manager/                   # Daemon, SessionManager, registry, adapter
│   ├── mcp/                       # MCP server exposing daemon as Claude tools
│   ├── memory/                    # SQLite + sqlite-vec per-agent memory
│   ├── scheduler/                 # Cron task scheduler (croner-backed)
│   ├── security/                  # ACL parser, allowlist matcher, approval log
│   ├── shared/                    # Cross-cutting: errors, logger, types
│   ├── skills/                    # Skill scanner, linker, installer
│   ├── templates/                 # SOUL.md and IDENTITY.md templates
│   └── usage/                     # Token + cost usage tracking
├── skills/                        # Workspace-level skills (copied to ~/.claude/skills/)
│   └── subagent-thread/           # Subagent thread spawning skill
├── dist/                          # Compiled output (not committed)
│   └── cli/                       # Built CLI binary
├── .planning/                     # GSD planning artifacts
│   ├── codebase/                  # This document lives here
│   ├── milestones/                # Versioned phase plans
│   ├── phases/                    # Individual phase directories
│   ├── quick/                     # Quick task plans
│   └── todos/                     # Pending and done todos
├── clawcode.yaml                  # Main config file (agents, defaults, discord)
├── package.json                   # Node.js manifest
├── tsconfig.json                  # TypeScript config
└── tsup.config.ts                 # Build config (tsup bundler)
```

## Directory Purposes

**`src/manager/`:**
- Purpose: Core orchestration — daemon lifecycle, session manager, registry, crash recovery
- Key files:
  - `daemon.ts` — `startDaemon()`, all subsystem wiring, IPC handler dispatch, socket/PID paths
  - `daemon-entry.ts` — minimal script; parses `--config`, calls `startDaemon()`
  - `session-manager.ts` — `SessionManager` class; start/stop/restart/reconcile/fork/send
  - `session-adapter.ts` — `SessionAdapter` interface, `SdkSessionAdapter`, `MockSessionAdapter`
  - `session-config.ts` — `buildSessionConfig()`: assembles system prompt + MCP config
  - `session-memory.ts` — `AgentMemoryManager`: owns all memory subsystem instances per agent
  - `session-recovery.ts` — `SessionRecoveryManager`: exponential backoff restart logic
  - `registry.ts` — `readRegistry` / `writeRegistry` (atomic); `createEntry` / `updateEntry`
  - `types.ts` — `AgentStatus`, `RegistryEntry`, `Registry`, `AgentSessionConfig`, `BackoffConfig`
  - `backoff.ts` — backoff delay calculator
  - `config-reloader.ts` — `ConfigReloader` for hot config reload on file change
  - `fork.ts` — `buildForkName` / `buildForkConfig` for session forking
  - `sdk-types.ts` — TypeScript types for the Claude Agent SDK module interface

**`src/cli/commands/`:**
- Purpose: One file per `clawcode` subcommand; all use `sendIpcRequest` to talk to daemon
- Key files:
  - `start.ts` — `clawcode start <agent>`
  - `stop.ts` — `clawcode stop <agent>`
  - `restart.ts` — `clawcode restart <agent>`
  - `start-all.ts` — `clawcode start-all` (spawns daemon as background process)
  - `status.ts` — `clawcode status`
  - `run.ts` — `clawcode run <agent>` (foreground, no daemon)
  - `send.ts` — `clawcode send <agent> <message>`
  - `fork.ts` — `clawcode fork <agent>`
  - `memory.ts` — `clawcode memory <agent>`
  - `threads.ts` — `clawcode threads`
  - `schedules.ts` — `clawcode schedules`
  - `webhooks.ts` — `clawcode webhooks`
  - `skills.ts` — `clawcode skills`
  - `mcp.ts` — `clawcode mcp` (start MCP server)
  - `mcp-servers.ts` — `clawcode mcp-servers` (show configured MCP servers)
  - `usage.ts` — `clawcode usage`
  - `delivery-queue.ts` — `clawcode delivery-queue`
  - `security.ts` — `clawcode security`
  - `spawn-thread.ts` — `clawcode spawn-thread`
  - `health.ts` — `clawcode health`
  - `routes.ts` — `clawcode routes`
  - `dashboard.ts` — `clawcode dashboard` (open browser dashboard)
  - `agent-create.ts` — `clawcode agent create` (interactive wizard)

**`src/discord/`:**
- Purpose: All Discord integration
- Key files:
  - `bridge.ts` — `DiscordBridge` class; discord.js Client; message receive + response send
  - `router.ts` — `buildRoutingTable`, `getAgentForChannel`
  - `delivery-queue.ts` — `DeliveryQueue`; ordered async message delivery
  - `thread-manager.ts` — `ThreadManager`; Discord thread → subagent session lifecycle
  - `thread-registry.ts` — persists thread-to-session mappings
  - `webhook-manager.ts` — `WebhookManager`; per-agent webhook personas
  - `slash-commands.ts` — `SlashCommandHandler`; registers and dispatches slash commands
  - `rate-limiter.ts` — per-channel rate limiter
  - `streaming.ts` — `ProgressiveMessageEditor` for live streaming updates
  - `attachments.ts` — download and format Discord attachments
  - `reactions.ts` — reaction event formatting
  - `subagent-thread-spawner.ts` — `SubagentThreadSpawner`; spawns Discord threads for subagents

**`src/memory/`:**
- Purpose: Per-agent persistent memory
- Key files:
  - `store.ts` — `MemoryStore`; SQLite DB per agent with sqlite-vec
  - `embedder.ts` — `EmbeddingService`; local HuggingFace ONNX inference
  - `search.ts` — `SemanticSearch`; vector KNN queries
  - `tiers.ts` / `tier-manager.ts` — hot/warm/cold tiering
  - `consolidation.ts` — time-based memory consolidation
  - `compaction.ts` — context fill tracking; `CharacterCountFillProvider`
  - `decay.ts` — relevance decay
  - `dedup.ts` — duplicate detection on insert
  - `session-log.ts` — `SessionLogger`; per-session log entries
  - `episode-store.ts` / `episode-archival.ts` — episodic memory
  - `context-summary.ts` — save/load context summaries
  - `schema.ts` — Zod schema for memory config
  - `index.ts` — barrel re-exports
  - `errors.ts` — `MemoryError`

**`src/config/`:**
- Purpose: Load and validate `clawcode.yaml`
- Key files:
  - `schema.ts` — all Zod schemas: agent, defaults, heartbeat, schedule, slash command, MCP server
  - `loader.ts` — `loadConfig`, `resolveAllAgents`, `resolveAgentConfig`
  - `defaults.ts` — `expandHome`, default values
  - `watcher.ts` — `ConfigWatcher` (chokidar)
  - `differ.ts` — `ConfigDiff` for change detection
  - `audit-trail.ts` — config change audit log

**`src/heartbeat/`:**
- Purpose: Periodic checks for running agents
- Key files:
  - `runner.ts` — `HeartbeatRunner`; setInterval, runs all checks for each agent
  - `discovery.ts` — dynamic import of check modules from `checks/` directory
  - `context-zones.ts` — `ContextZoneTracker`; zone thresholds (green/yellow/orange/red)
  - `types.ts` — `CheckModule`, `CheckContext`, `CheckResult`, `HeartbeatConfig`
  - `checks/consolidation.ts` — consolidation health check
  - `checks/context-fill.ts` — context fill percentage check
  - `checks/inbox.ts` — inbox message check
  - `checks/tier-maintenance.ts` — memory tier maintenance
  - `checks/thread-idle.ts` — idle thread cleanup
  - `checks/attachment-cleanup.ts` — attachment file cleanup

**`src/ipc/`:**
- Purpose: JSON-RPC 2.0 transport over Unix domain socket
- Key files:
  - `server.ts` — `createIpcServer()`; buffers + parses newline-delimited JSON
  - `client.ts` — `sendIpcRequest()`; connect, write request, read response
  - `protocol.ts` — Zod schemas for `IpcRequest` and `IpcResponse`

**`src/security/`:**
- Purpose: Channel-level access control
- Key files:
  - `acl-parser.ts` — parses `SECURITY.md` in agent workspace; `checkChannelAccess()`
  - `allowlist-matcher.ts` — `AllowlistMatcher`; pattern matching for tool allowlists
  - `approval-log.ts` — `ApprovalLog`; JSONL audit log at `~/.clawcode/manager/approval-audit.jsonl`
  - `types.ts` — `SecurityPolicy`

**`src/shared/`:**
- Purpose: Cross-cutting utilities; no domain logic
- Key files:
  - `errors.ts` — all typed error classes: `ConfigValidationError`, `ConfigFileNotFoundError`, `WorkspaceError`, `ManagerError`, `ManagerNotRunningError`, `SessionError`, `IpcError`
  - `logger.ts` — pino logger singleton
  - `types.ts` — `ResolvedAgentConfig`, `WorkspaceResult`
  - `async-queue.ts` — `AsyncQueue` utility

**`src/agent/`:**
- Key files:
  - `workspace.ts` — `createWorkspace` / `createWorkspaces`; creates workspace dirs, writes SOUL.md, IDENTITY.md
  - `runner.ts` — `AgentRunner`; standalone single-agent lifecycle with crash recovery (no daemon required)

**`src/skills/`:**
- Key files:
  - `scanner.ts` — `scanSkillsDirectory()`; builds `SkillsCatalog` Map
  - `linker.ts` — `linkAgentSkills()`; symlinks skill files into agent workspace `skills/`
  - `installer.ts` — `installWorkspaceSkills()`; copies project `skills/` to `~/.claude/skills/`

**`src/bootstrap/`:**
- Key files:
  - `detector.ts` — `detectBootstrapNeeded(config)`: returns `"needed"` | `"not-needed"`
  - `prompt-builder.ts` — `buildBootstrapPrompt()`: generates first-run walkthrough system prompt
  - `writer.ts` — writes bootstrap files to workspace

**`src/mcp/`:**
- Key files:
  - `server.ts` — `createMcpServer()`; MCP tools: `agent_status`, `send_message`, `spawn_subagent_thread`, etc.
  - `health.ts` — health check for MCP server

**`src/scheduler/`:**
- Key files:
  - `scheduler.ts` — `TaskScheduler`; manages croner jobs per agent
  - `types.ts` — scheduler types

**`src/usage/`:**
- Key files:
  - `tracker.ts` — `UsageTracker`; records token + cost data per session turn
  - `types.ts` — usage record types

**`src/collaboration/`:**
- Key files:
  - `inbox.ts` — `writeMessage` / `createMessage`; drops JSON files into `{workspace}/inbox/`
  - `types.ts` — `InboxMessage`

**`src/dashboard/`:**
- Key files:
  - `server.ts` — `startDashboardServer()`; Node.js http server, REST + SSE endpoints
  - `sse.ts` — `SseManager`; Server-Sent Events for live status updates
  - `static/index.html` / `static/styles.css` / `static/app.js` — dashboard web UI

**`src/templates/`:**
- `SOUL.md` — default soul template written to new agent workspaces
- `IDENTITY.md` — default identity template written to new agent workspaces

## Key File Locations

**Entry Points:**
- `src/cli/index.ts` — CLI entry; Commander program + all command registrations
- `src/manager/daemon-entry.ts` — Daemon process entry point
- `src/mcp/server.ts` — MCP server (stdio transport)
- `src/index.ts` — Public library API

**Configuration:**
- `clawcode.yaml` — Main config (agents, defaults, discord, MCP servers)
- `tsconfig.json` — TypeScript compiler config
- `tsup.config.ts` — Build bundler config
- `package.json` — Dependencies, scripts, `"type": "module"` (ESM)

**Runtime State (not in repo):**
- `~/.clawcode/manager/registry.json` — Agent status registry
- `~/.clawcode/manager/clawcode.sock` — Unix domain socket
- `~/.clawcode/manager/clawcode.pid` — Daemon PID
- `~/.clawcode/manager/approval-audit.jsonl` — Security approval log
- `~/.clawcode/manager/thread-registry.json` — Thread session registry
- `{agent.workspace}/memory/memory.db` — Per-agent SQLite memory database
- `{agent.workspace}/inbox/` — Inter-agent message inbox
- `{agent.workspace}/SOUL.md` — Agent personality
- `{agent.workspace}/IDENTITY.md` — Agent identity
- `{agent.workspace}/SECURITY.md` — Agent channel ACLs
- `{agent.workspace}/skills/` — Symlinked skills for this agent

## Naming Conventions

**Files:**
- kebab-case for all TypeScript source files: `session-manager.ts`, `delivery-queue.ts`
- `types.ts` — type-only module in each directory
- `index.ts` — barrel exports (only in `src/` root and `src/memory/`)
- `*.test.ts` — tests co-located with source or in `__tests__/` subdirectory
- `schema.ts` — Zod schema definitions
- `errors.ts` — typed error classes

**Directories:**
- lowercase, single word or kebab-case: `manager/`, `discord/`, `heartbeat/checks/`
- `__tests__/` — test files for the parent module

**TypeScript:**
- Classes: PascalCase (`SessionManager`, `DiscordBridge`, `HeartbeatRunner`)
- Interfaces/Types: PascalCase (`SessionHandle`, `ResolvedAgentConfig`, `RoutingTable`)
- Functions: camelCase (`buildSessionConfig`, `resolveAllAgents`, `sendIpcRequest`)
- Constants: SCREAMING_SNAKE_CASE (`SOCKET_PATH`, `DEFAULT_BACKOFF_CONFIG`)
- Zod schemas: camelCase with `Schema` suffix (`configSchema`, `ipcRequestSchema`)

## Where to Add New Code

**New CLI command:**
- Create: `src/cli/commands/<command-name>.ts` exporting `register<CommandName>Command(program: Command)`
- Register in: `src/cli/index.ts` — import and call `register<CommandName>Command(program)`
- Pattern: Use `sendIpcRequest(SOCKET_PATH, method, params)` for all daemon interaction
- Tests: `src/cli/commands/__tests__/<command-name>.test.ts`

**New IPC method:**
- Add handler in: `src/manager/daemon.ts` `routeMethod()` function
- Add method name to: `src/ipc/protocol.ts` `IpcRequest` method union type
- Consume in CLI via: `sendIpcRequest(SOCKET_PATH, 'new-method', params)`

**New heartbeat check:**
- Create: `src/heartbeat/checks/<check-name>.ts` implementing `CheckModule` interface from `src/heartbeat/types.ts`
- Discovery is automatic — `HeartbeatRunner` imports all `.ts` files in `checks/` directory

**New Discord feature:**
- Add to: `src/discord/` following existing file-per-concern pattern
- Wire into: `src/discord/bridge.ts` (message handling) or `src/manager/daemon.ts` (initialization)

**New memory operation:**
- Add to: `src/memory/store.ts` with a prepared statement
- Expose through: `AgentMemoryManager` in `src/manager/session-memory.ts`
- Accessor in: `SessionManager` (delegates to `AgentMemoryManager`)

**New agent config field:**
- Schema: `src/config/schema.ts` — add to `agentSchema`
- Resolved type: `src/shared/types.ts` — add to `ResolvedAgentConfig`
- Loader: `src/config/loader.ts` — update `resolveAgentConfig()`
- Usage: consumed in `buildSessionConfig()` (`src/manager/session-config.ts`) or daemon startup

**Utilities:**
- Shared helpers with no domain logic: `src/shared/`
- Domain-specific helpers: co-locate in the relevant module directory

## Special Directories

**`dist/`:**
- Purpose: Compiled TypeScript output
- Generated: Yes (by `tsup`)
- Committed: No

**`.planning/`:**
- Purpose: GSD planning artifacts — phases, milestones, quick tasks, codebase analysis
- Generated: By GSD commands
- Committed: Yes

**`skills/`:**
- Purpose: Workspace-level skills copied to `~/.claude/skills/` at daemon startup and init
- Generated: No (hand-authored markdown skill files)
- Committed: Yes

**`.claude/`:**
- Purpose: Claude Code worktree artifacts
- Committed: No (gitignored)

---

*Structure analysis: 2026-04-10*
