# Codebase Structure

**Analysis Date:** 2026-04-11

## Directory Layout

```
workspace-coding/
├── src/                        # All TypeScript source
│   ├── index.ts                # Public API entry point (re-exports)
│   ├── agent/                  # Workspace creation and runner
│   ├── bootstrap/              # First-run detection and prompt building
│   ├── cli/                    # CLI commands (clawcode binary)
│   │   ├── index.ts            # Commander root, init action
│   │   ├── output.ts           # CLI logging helpers
│   │   └── commands/           # One file per subcommand
│   ├── collaboration/          # Inter-agent filesystem inbox
│   ├── config/                 # Config loading, schema, watcher
│   ├── dashboard/              # HTTP dashboard (SSE + static)
│   │   └── static/             # index.html, styles.css, app.js
│   ├── discord/                # Discord bridge, routing, threads
│   ├── heartbeat/              # Periodic health check runner
│   │   └── checks/             # Pluggable check modules
│   ├── ipc/                    # Unix socket JSON-RPC server/client
│   ├── manager/                # Daemon, SessionManager, registry
│   ├── mcp/                    # MCP server (exposes IPC as tools)
│   ├── memory/                 # SQLite memory, embeddings, tiers
│   ├── scheduler/              # Cron-based task scheduling
│   ├── security/               # ACL parsing, allowlist, approval log
│   ├── shared/                 # Logger, errors, shared types
│   ├── skills/                 # SKILL.md scanner, linker, installer
│   ├── templates/              # Default SOUL.md and IDENTITY.md templates
│   └── usage/                  # Token/cost tracking, budget enforcement
├── skills/                     # Workspace-level SKILL.md files
│   └── subagent-thread/        # subagent-thread skill
├── dist/                       # Compiled output (tsup, ESM)
├── .planning/                  # GSD planning artifacts
│   ├── codebase/               # Codebase map documents (this directory)
│   ├── milestones/             # Per-milestone phase files
│   ├── phases/                 # Phase execution artifacts
│   └── ...
├── clawcode.yaml               # Agent config (agents, defaults, mcpServers)
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

## Directory Purposes

**`src/agent/`:**
- Purpose: Create per-agent workspace filesystem layout
- Contains: `workspace.ts` (mkdir, SOUL.md, IDENTITY.md, memory/, skills/), `runner.ts`
- Key files: `src/agent/workspace.ts`

**`src/bootstrap/`:**
- Purpose: Detect if an agent needs a first-run bootstrap prompt (no existing memories or files)
- Contains: `detector.ts`, `prompt-builder.ts`, `writer.ts`, `types.ts`
- Key files: `src/bootstrap/detector.ts` — called by `SessionManager.startAgent`

**`src/cli/`:**
- Purpose: User-facing `clawcode` binary; most commands are thin IPC wrappers
- Contains: `index.ts` (entry, `init` and `run` commands inline), `commands/` (one file per command)
- Commands: `start`, `stop`, `restart`, `start-all`, `status`, `routes`, `health`, `schedules`, `skills`, `send`, `threads`, `webhooks`, `fork`, `mcp`, `memory`, `usage`, `delivery-queue`, `security`, `spawn-thread`, `mcp-servers`, `dashboard`, `agent-create`, `run`, `costs`
- Test files: co-located in `src/cli/__tests__/` and some commands have `.test.ts` siblings

**`src/collaboration/`:**
- Purpose: Filesystem-based inter-agent messaging
- Contains: `inbox.ts` (create and write inbox messages), `types.ts`
- Message location: `~/.clawcode/agents/<name>/inbox/<timestamp>-<from>-<id>.json`

**`src/config/`:**
- Purpose: Load and validate `clawcode.yaml`; watch for hot-reload; diff for reconciliation
- Contains: `loader.ts`, `schema.ts`, `defaults.ts`, `watcher.ts`, `differ.ts`, `audit-trail.ts`, `types.ts`
- Key files: `src/config/schema.ts` (Zod schemas for all config shapes), `src/config/loader.ts` (parse + `resolveAgentConfig`)

**`src/dashboard/`:**
- Purpose: Browser-based agent monitoring UI, no external HTTP framework
- Contains: `server.ts` (Node.js `http.createServer`), `sse.ts` (SSE manager), `static/` (served files), `types.ts`
- Key files: `src/dashboard/static/index.html`, `src/dashboard/static/app.js`

**`src/discord/`:**
- Purpose: All Discord bot functionality
- Contains: `bridge.ts` (discord.js Client), `router.ts` (channel routing), `thread-manager.ts` (thread sessions), `thread-registry.ts`, `webhook-manager.ts`, `delivery-queue.ts` (SQLite-backed reliable delivery), `rate-limiter.ts`, `slash-commands.ts`, `streaming.ts` (progressive edits), `attachments.ts`, `reactions.ts`, `subagent-thread-spawner.ts`, `debug-bridge.ts`, type files
- Key files: `src/discord/bridge.ts`, `src/discord/router.ts`, `src/discord/delivery-queue.ts`

**`src/heartbeat/`:**
- Purpose: Periodic health monitoring for running agents
- Contains: `runner.ts` (setInterval, tick, zone tracking), `discovery.ts` (dynamic check loading), `context-zones.ts` (zone state machine), `types.ts`
- `checks/`: `context-fill.ts`, `consolidation.ts`, `tier-maintenance.ts`, `auto-linker.ts`, `inbox.ts`, `thread-idle.ts`, `attachment-cleanup.ts`
- Key files: `src/heartbeat/runner.ts`, `src/heartbeat/context-zones.ts`

**`src/ipc/`:**
- Purpose: Unix socket JSON-RPC 2.0 transport between CLI/MCP and daemon
- Contains: `server.ts` (socket server, newline-delimited JSON), `client.ts` (send + await), `protocol.ts` (Zod schema)
- Socket path at runtime: `~/.clawcode/manager/clawcode.sock`

**`src/manager/`:**
- Purpose: Core daemon and session lifecycle management
- Contains: `daemon.ts` (top-level `startDaemon` bootstrap), `daemon-entry.ts` (process entry), `session-manager.ts`, `session-adapter.ts`, `session-memory.ts`, `session-config.ts`, `session-recovery.ts`, `registry.ts`, `fork.ts`, `escalation.ts`, `backoff.ts`, `context-assembler.ts`, `config-reloader.ts`, `sdk-types.ts`, `types.ts`
- Key files: `src/manager/daemon.ts` (wires everything together), `src/manager/session-manager.ts`, `src/manager/session-adapter.ts`

**`src/mcp/`:**
- Purpose: MCP server that agents load — exposes IPC methods as Claude-callable tools
- Contains: `server.ts`, `health.ts`
- Tools: `agent_status`, `list_agents`, `send_message`, `list_schedules`, `list_webhooks`, `spawn_subagent_thread`, `memory_lookup`, `ask_advisor`

**`src/memory/`:**
- Purpose: Per-agent persistent memory with vector search, tiers, consolidation
- Contains: `store.ts`, `embedder.ts`, `search.ts`, `tier-manager.ts`, `tiers.ts`, `consolidation.ts`, `decay.ts`, `dedup.ts`, `graph.ts`, `graph-search.ts`, `compaction.ts`, `episode-store.ts`, `session-log.ts`, `context-summary.ts`, `importance.ts`, `fingerprint.ts`, `similarity.ts`, `relevance.ts`, `errors.ts`, `schema.ts`, `types.ts`, `index.ts`
- Key files: `src/memory/store.ts`, `src/memory/embedder.ts`, `src/memory/tier-manager.ts`
- DB per agent: `~/.clawcode/agents/<name>/memory/memories.db`

**`src/scheduler/`:**
- Purpose: Run cron-scheduled prompts against agents using croner
- Contains: `scheduler.ts`, `types.ts`

**`src/security/`:**
- Purpose: Channel ACL enforcement; allow-always pattern persistence
- Contains: `acl-parser.ts` (parse workspace `SECURITY.md`), `allowlist-matcher.ts`, `approval-log.ts`, `types.ts`

**`src/shared/`:**
- Purpose: Cross-cutting utilities: logger, error classes, shared types
- Contains: `logger.ts` (pino singleton), `errors.ts` (typed error classes), `types.ts` (`ResolvedAgentConfig`, `WorkspaceResult`), `async-queue.ts`
- Key files: `src/shared/errors.ts` — always import errors from here

**`src/skills/`:**
- Purpose: Manage SKILL.md files for agent capabilities
- Contains: `scanner.ts` (build catalog from directory), `linker.ts` (symlink into agent workspace), `installer.ts` (install workspace skills to global path), `types.ts`
- Skill catalog: `Map<string, SkillEntry>` where key is skill name

**`src/templates/`:**
- Purpose: Default content for agent identity files
- Contains: `SOUL.md`, `IDENTITY.md`
- Used by: `src/agent/workspace.ts` when no config-provided content

**`src/usage/`:**
- Purpose: Token/cost tracking and budget enforcement
- Contains: `tracker.ts` (per-agent SQLite usage log), `budget.ts` (`EscalationBudget` — daily/weekly token limits), `advisor-budget.ts` (`AdvisorBudget` — rate-limit Opus advisor queries), `pricing.ts`, `types.ts`

**`skills/`:**
- Purpose: Workspace-level SKILL.md files (project-specific skills)
- Currently contains: `subagent-thread/` skill
- Installed to global skills path at daemon startup

**`dist/`:**
- Purpose: Compiled ESM output from tsup
- Generated: Yes
- Committed: No (in `.gitignore`)

**`.planning/`:**
- Purpose: GSD workflow artifacts — not source code
- Generated: Partially (phases auto-created)
- Committed: Yes

## Key File Locations

**Entry Points:**
- `src/index.ts`: Public programmatic API
- `src/cli/index.ts`: CLI binary entry (registered as `clawcode` in `package.json` bin)
- `src/manager/daemon-entry.ts`: Daemon process entry (spawned as background process)
- `src/mcp/server.ts`: MCP server entry (loaded by agent sessions)

**Configuration:**
- `clawcode.yaml`: Primary config file (agents, defaults, mcpServers, discord)
- `tsconfig.json`: TypeScript config (ESM, strict, Node22 target)
- `tsup.config.ts`: Build config
- `vitest.config.ts`: Test config

**Core Logic:**
- `src/manager/daemon.ts`: Full daemon bootstrap — wires all subsystems
- `src/manager/session-manager.ts`: Agent lifecycle orchestration
- `src/manager/session-adapter.ts`: Claude SDK abstraction + `SdkSessionAdapter`
- `src/config/schema.ts`: All Zod schemas (authoritative type definitions)
- `src/shared/types.ts`: `ResolvedAgentConfig` — used everywhere
- `src/discord/bridge.ts`: Discord bot main entry

**Runtime State:**
- `~/.clawcode/manager/registry.json`: Agent status registry
- `~/.clawcode/manager/clawcode.sock`: IPC socket
- `~/.clawcode/manager/clawcode.pid`: Daemon PID
- `~/.clawcode/agents/<name>/memory/memories.db`: Per-agent memory
- `~/.clawcode/agents/<name>/SOUL.md`: Agent soul/personality
- `~/.clawcode/agents/<name>/IDENTITY.md`: Agent identity

**Testing:**
- `src/**/__tests__/*.test.ts`: Test suites in `__tests__` subdirectories
- `src/**/*.test.ts`: Some tests co-located alongside source (e.g., `src/cli/commands/costs.test.ts`)
- `src/manager/session-adapter.ts`: Contains `MockSessionAdapter` and `MockSessionHandle` for test use

## Naming Conventions

**Files:**
- `kebab-case.ts` for all source files
- `kebab-case.test.ts` for co-located tests
- `__tests__/kebab-case.test.ts` for directory-grouped tests
- `types.ts` for type-only modules within a feature directory
- `schema.ts` for Zod schema files
- `index.ts` for barrel exports

**Directories:**
- `kebab-case/` for feature modules
- `__tests__/` for grouped test files within a module directory

**TypeScript:**
- `PascalCase` for classes and types (`SessionManager`, `ResolvedAgentConfig`)
- `camelCase` for functions and variables (`startDaemon`, `buildRoutingTable`)
- `SCREAMING_SNAKE_CASE` for constants (`SOCKET_PATH`, `DEFAULT_BACKOFF_CONFIG`)
- `camelCase` for type/interface fields (all readonly)

## Where to Add New Code

**New Agent Feature / Behavior:**
- Primary code: `src/manager/` (if lifecycle-related) or a new `src/<feature>/` directory
- Wire into daemon: `src/manager/daemon.ts` (add initialization in `startDaemon`)
- Expose via IPC: add method to `routeMethod` in `src/manager/daemon.ts`
- Tests: `src/<feature>/__tests__/<feature>.test.ts`

**New CLI Command:**
- Create: `src/cli/commands/<command-name>.ts` with `register<Name>Command(program)` export
- Register: import and call in `src/cli/index.ts`
- Tests: `src/cli/commands/<command-name>.test.ts` or `src/cli/__tests__/<command-name>.test.ts`

**New Heartbeat Check:**
- Create: `src/heartbeat/checks/<check-name>.ts` implementing `CheckModule` from `src/heartbeat/types.ts`
- Discovery: automatic — `src/heartbeat/discovery.ts` loads all `.ts` files in `checks/` directory
- Tests: `src/heartbeat/checks/__tests__/<check-name>.test.ts`

**New Memory Feature:**
- Implementation: `src/memory/<feature>.ts`
- Export from barrel: `src/memory/index.ts`
- Tests: `src/memory/__tests__/<feature>.test.ts`

**New MCP Tool:**
- Add to `TOOL_DEFINITIONS` in `src/mcp/server.ts`
- Add corresponding IPC method handler in daemon's `routeMethod`

**New Discord Feature:**
- Create: `src/discord/<feature>.ts`
- Wire into `DiscordBridge` in `src/discord/bridge.ts` or `startDaemon` in `src/manager/daemon.ts`

**Shared Utilities:**
- Shared helpers: `src/shared/` (logger, errors, types used across multiple modules)
- Feature-local helpers: keep in the feature directory

**New Agent Config Option:**
- Add Zod field to `src/config/schema.ts` (agent schema)
- Add resolved field to `ResolvedAgentConfig` in `src/shared/types.ts`
- Wire through `resolveAgentConfig` in `src/config/loader.ts`
- Use in session config via `src/manager/session-config.ts`

## Special Directories

**`.claude/worktrees/`:**
- Purpose: Git worktrees for managed agent sessions (agent processes run in these)
- Generated: Yes (by agent workspace creation)
- Committed: No

**`.planning/`:**
- Purpose: GSD workflow artifacts (phases, milestones, codebase maps)
- Generated: Partially
- Committed: Yes

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes
- Committed: No

**`dist/`:**
- Purpose: Compiled TypeScript output (tsup, ESM)
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-04-11*
