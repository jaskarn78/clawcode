# Codebase Concerns

**Analysis Date:** 2026-04-10

---

## 1. OpenClaw Coexistence Conflicts

### Shared Discord Bot Token — HIGH RISK

**Issue:** ClawCode and OpenClaw can connect the same Discord bot token simultaneously, causing dual-consumer conflicts.

- **ClawCode token resolution chain** (`src/manager/daemon.ts` lines 305–333):
  1. Tries `config.discord.botToken` from `clawcode.yaml` (resolves via 1Password `op read`)
  2. Falls back to `loadBotToken()` which reads `~/.claude/channels/discord/.env` (the Claude Code plugin token — **same token OpenClaw uses**)
  3. Falls back to `process.env.DISCORD_BOT_TOKEN`
- **Impact:** If `clawcode.yaml` has no `discord.botToken`, or if the 1Password CLI (`op`) fails, ClawCode silently falls back to the OpenClaw/Claude Code plugin token. Both systems will receive every Discord message event on their separate `discord.js` clients. Discord delivers events to all concurrent gateway connections — resulting in duplicate message handling, double responses, and response race conditions.
- **Current production `clawcode.yaml`:** Uses `botToken: op://clawdbot/Clawdbot Discord Token/credential` — this is a separate bot token, so the conflict is avoided **only if `op` resolves successfully**. If `op` fails (1Password CLI not authenticated, offline, etc.), the fallback silently picks up the shared plugin token.
- **The fallback path has no warning for this specific case** — the log says "using shared Discord bot token from Claude Code plugin" but does not indicate this will conflict with OpenClaw.
- **Fix approach:** Remove the fallback to the plugin token entirely. If `op` resolution fails, fail hard and refuse to start the Discord bridge rather than silently creating a conflict.

### Discord Thread Bindings — Competing State Files

**Issue:** Both OpenClaw and ClawCode maintain separate `thread-bindings.json` files at different paths, but both reference Discord thread IDs from the same Discord guild.

- **ClawCode path:** `~/.clawcode/manager/thread-bindings.json` (from `src/discord/thread-types.ts` line 45)
- **OpenClaw path:** `~/.openclaw/discord/thread-bindings.json` (observed at runtime)
- **Impact:** If an agent in ClawCode creates a thread in a channel also used by OpenClaw, both systems may attempt to bind and route messages for it independently. Thread creation events are broadcast to all connected gateway clients. If both systems are running the same bot token, both receive `threadCreate`, resulting in duplicate session spawning.
- **No cross-system awareness:** ClawCode's `ThreadManager` has no knowledge of OpenClaw's thread bindings and vice versa.

### Slash Command Registration Conflicts

**Issue:** Both systems may register Discord slash commands under the same application ID, with the later registration overwriting the earlier one.

- ClawCode's `SlashCommandHandler` (`src/discord/slash-commands.ts` line 169) registers guild-scoped commands via `Routes.applicationGuildCommands(clientId, guildId)` on every startup.
- If both ClawCode and OpenClaw register slash commands on startup using the same bot/application ID, whichever starts last wins. The other system's registered commands are silently deleted.
- **Fix approach:** Use non-overlapping slash command namespaces, or establish a single command registration authority.

### Port Conflict — Dashboard HTTP Server

**Issue:** The ClawCode dashboard binds an HTTP port that could conflict with other services.

- **Default port:** `3100` (`src/manager/daemon.ts` line 474: `Number(process.env.CLAWCODE_DASHBOARD_PORT) || 3100`)
- OpenClaw uses ports in the `3000` range for its gateway and browser automation (`http://100.117.64.85:3000` is browserless, `http://100.117.64.85:4123` is Chatterbox TTS).
- The `browserless` MCP server at `100.117.64.85:3000` is an external service, not a local port — no direct conflict, but if ClawCode ever runs alongside another local dev server on 3100, the daemon will crash on startup (no retry logic, no port increment).
- **No graceful handling:** If port 3100 is taken, `startDashboardServer` rejects the promise and the entire daemon fails to start (the dashboard server is not optional).
- **Fix approach:** Make the dashboard server optional/non-fatal, or auto-increment the port on bind failure.

### Unix Domain Socket — Namespace Separation

**Status:** Low risk. ClawCode uses `~/.clawcode/manager/clawcode.sock` (`src/manager/daemon.ts` line 61), distinct from any OpenClaw IPC paths. `ensureCleanSocket()` correctly detects live vs. stale sockets. No conflict detected.

### PID File — Namespace Separation

**Status:** Low risk. ClawCode uses `~/.clawcode/manager/clawcode.pid`. Not shared with OpenClaw. However, there is no check for whether the PID in the file is actually a ClawCode process — a stale PID from a previous crash could collide with an unrelated process that reused that PID.

### Config Directory — Shared `~/.claude/skills/`

**Issue:** ClawCode writes skills to `~/.claude/skills/` on every daemon startup.

- `src/skills/installer.ts` line 10: `GLOBAL_SKILLS_DIR = join(homedir(), ".claude", "skills")`
- `src/manager/daemon.ts` lines 148–149: `installWorkspaceSkills(join(process.cwd(), "skills"), undefined, log)` — called twice per startup (once with default dir, once with skillsPath).
- OpenClaw's agents also read skills from `~/.claude/skills/` (the Claude Code plugin scans this directory).
- **Impact:** ClawCode overwrites skill files in the shared directory on every startup. If ClawCode's workspace `skills/` directory contains a `SKILL.md` with the same name as one used by OpenClaw agents, ClawCode silently overwrites it. No locking. No version check beyond content equality.
- **Fix approach:** Use a ClawCode-specific skills namespace (e.g., `~/.clawcode/skills/`) rather than writing directly to the shared Claude Code skills directory.

### Shared `~/.claude/` Ecosystem — Session ID Namespace

**Issue:** Both ClawCode and OpenClaw create Claude Code sessions. Sessions are identified by a UUID assigned by the Claude Agent SDK. There is no namespace collision risk for session IDs themselves, but both systems write to `~/.claude/` subdirectories for session state (project config, etc.). If OpenClaw uses `settingSources: ["global"]` and ClawCode uses `settingSources: ["project"]`, they do not share the same Claude Code settings — low risk.

### MCP Server Instances — Competing Processes

**Issue:** ClawCode agents reference MCP servers in `/home/jjagpal/.openclaw/workspace-general/mcp-servers/` (`clawcode.yaml` lines 50–133). These are Python scripts that also run as MCP servers for OpenClaw agents in `workspace-general`.

- **Impact:** When both ClawCode and OpenClaw are running, the same MCP server script (e.g., `homeassistant.py`, `brave_search.py`) will be started as separate child processes — once per Claude Code session that uses it. For stateless HTTP-proxying MCP servers this is fine. For servers that hold local state or have API rate limits (Finnhub, Strava, ElevenLabs), running two instances doubles API usage and can hit rate limits unexpectedly.
- **No deduplication:** Each Claude Code session spawns its own MCP server processes; there is no shared MCP server pool between ClawCode and OpenClaw.

### Environment Variable Collisions

- **`DISCORD_BOT_TOKEN`:** Both systems read this env var. If set in the environment, both pick it up. ClawCode preferentially uses `clawcode.yaml`'s `discord.botToken` — only safe if that succeeds.
- **`ANTHROPIC_API_KEY`:** ClawCode **strips** this env var before spawning SDK subprocesses (`src/manager/session-adapter.ts` line 170: `buildCleanEnv()` removes it). This is intentional — forces OAuth. But if OpenClaw relies on `ANTHROPIC_API_KEY` being present in the environment, and ClawCode's start-all strips it from the child process environment (`src/cli/commands/start-all.ts` line 89), the daemon subprocess won't have it. OpenClaw is unaffected (different process tree) but worth noting.
- **`OPENAI_API_KEY`, `BRAVE_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`:** Used verbatim in `clawcode.yaml` MCP server env sections via `'${VAR_NAME}'` interpolation. If these are not in the ClawCode process environment, the MCP servers start with empty API keys and silently fail.

### Resource Contention

**Issue:** Running 14+ OpenClaw agents alongside ClawCode agents creates significant resource pressure.

- Each ClawCode agent spawns a `claude` CLI subprocess via the Agent SDK, each loading its own Node.js runtime.
- Each agent spawns separate MCP server child processes (e.g., Python scripts) per session.
- The `@huggingface/transformers` embedding model (`all-MiniLM-L6-v2`, ~23MB) is loaded per `EmbeddingService` instance. One instance is shared across all agents via `AgentMemoryManager` (`src/manager/session-memory.ts` line 33), but the model download happens once per Node.js process.
- **Combined footprint:** 14 OpenClaw + 1+ ClawCode agents = 15+ `claude` processes + 30+ Python MCP server processes + Node.js daemon. On a machine without memory limits, this can exceed 8–16GB RAM.
- **No resource caps configured.** No maximum concurrent agent limit. No OOM protection.

---

## 2. Technical Debt

### Single Wired TODO — Heartbeat Discord Notification

- **Files:** `src/manager/daemon.ts` lines 219–226
- **Issue:** Heartbeat zone transition notifications are logged but not delivered to Discord. The `notificationCallback` has a `TODO: Wire to Discord delivery queue (Phase 26)` comment. Context zone transitions (yellow/orange/red) are only visible in daemon logs, not in Discord channels.
- **Impact:** Operators cannot observe agent context health from Discord without tailing logs.
- **Fix approach:** Wire `notificationCallback` to `deliveryQueue.enqueue()` for the agent's primary channel.

### `daemon.ts` Size and Complexity — 1005 Lines

- **File:** `src/manager/daemon.ts`
- **Issue:** The `startDaemon()` function is the single largest function in the codebase (~400 lines, lines 130–521). It initializes 12+ subsystems sequentially with no extracted helper functions. The `routeMethod()` switch statement is another ~400 lines.
- **Impact:** Any new IPC method, subsystem, or startup concern must be added to this file. Extremely high merge conflict surface area.
- **Fix approach:** Extract subsystem initialization into `initializeDiscord()`, `initializeSecurity()`, `initializeHeartbeat()` etc. Extract `routeMethod` into a dedicated router module.

### `session-adapter.ts` Contains Production + Mock Code — 467 Lines

- **File:** `src/manager/session-adapter.ts`
- **Issue:** `MockSessionHandle`, `MockSessionAdapter`, and `createMockAdapter()` are in the same file as production `SdkSessionAdapter`. Mock code ships in production bundle.
- **Fix approach:** Move mock implementations to `src/manager/__mocks__/session-adapter.ts`.

### Pending-Session IDs on SDK Drain Failure

- **File:** `src/manager/session-adapter.ts` lines 269, 280
- **Issue:** If `drainInitialQuery()` fails or finds no `result` message, `sessionId` is set to `pending-{timestamp}`. The registry stores this ephemeral ID. On the next query, the SDK cannot resume a `pending-*` session — it will create a new session, losing history.
- **Impact:** Silently loses conversation context on initial session establishment failures.

### Config Loader Silent `${VAR}` Non-Resolution

- **File:** `src/config/loader.ts` (observed in `clawcode.yaml` lines 72–96)
- **Issue:** `'${OPENAI_API_KEY}'`, `'${BRAVE_API_KEY}'`, etc. in `clawcode.yaml` are YAML string literals, not interpolated by the loader. They are passed literally to MCP server `env` blocks. MCP servers receive the string `"${OPENAI_API_KEY}"` as their API key.
- **Actual behavior:** The env vars are expected to be already present in the process environment (shell-expanded before YAML parse), but YAML's single-quote syntax prevents shell expansion. This is a known footgun with YAML + shell variables.
- **Impact:** If the calling shell doesn't export these variables, MCP servers get literal `"${VAR_NAME}"` as credentials and silently fail on first API call.
- **Fix approach:** Add explicit env var resolution in the config loader for `${VAR_NAME}` patterns.

### Duplicate `installWorkspaceSkills` Call on Daemon Start

- **File:** `src/manager/daemon.ts` lines 148–149 and 169
- **Issue:** `installWorkspaceSkills` is called twice during daemon startup — once with the default `~/.claude/skills/` path, and once again with `skillsPath` from the first resolved agent's config. Both calls may write to the same directory.
- **Impact:** Redundant filesystem writes on every daemon start. Race condition if both calls overlap (unlikely in practice since they're sequential, but still a logic smell).

---

## 3. Security Concerns

### `permissionMode: "bypassPermissions"` for All Agent Sessions

- **Files:** `src/manager/session-adapter.ts` lines 190, 214
- **Issue:** Every agent session is created with `permissionMode: "bypassPermissions"`. This disables all Claude Code safety prompts — agents can execute shell commands, write files, and call tools without any approval gate.
- **Current mitigation:** `src/security/allowlist-matcher.ts` provides an allowlist system for IPC-based execution approval. `SECURITY.md` per-agent ACLs control channel access.
- **Gap:** Allowlist applies to the ClawCode IPC approval flow, not to tools the agent invokes autonomously inside the Claude Code session. An agent with MCP servers can call any tool in those MCP servers without restriction.
- **Recommendation:** Document this explicitly in agent SOUL.md files. Consider `permissionMode: "acceptEdits"` for non-admin agents as a baseline.

### Shell Injection in 1Password Token Resolution

- **File:** `src/manager/daemon.ts` line 315
- **Issue:** `execSync(`op read "${raw}"`, ...)` — the `raw` value comes from `clawcode.yaml` `discord.botToken`. If the YAML file is compromised or contains malicious content like `" && malicious-command`, this would execute arbitrary shell commands.
- **Current mitigation:** The YAML file is user-controlled and not web-accessible.
- **Recommendation:** Use `execSync('op', ['read', raw])` with an argument array form to prevent shell interpretation, or validate `raw` matches `^op://[^";&|]+$` before interpolation.

### Dashboard HTTP Server — No Authentication

- **File:** `src/dashboard/server.ts`
- **Issue:** The dashboard at port 3100 (default) exposes REST endpoints (`POST /api/agents/:name/start|stop|restart`) with no authentication. Any process or user on the local machine can stop/start/restart agents.
- **Current mitigation:** Localhost-only binding (Node's default `server.listen(port)` binds `0.0.0.0` — not localhost-only unless specified).
- **Risk:** If the machine has other users or runs network-accessible services, the dashboard is an unauthenticated agent control plane.
- **Fix approach:** Bind to `127.0.0.1` explicitly, or add a Bearer token check to the REST endpoints.

### Discord Message Content Not Sanitized Before Agent Injection

- **File:** `src/discord/bridge.ts` lines 519–559 (`formatDiscordMessage`)
- **Issue:** Discord message content is injected directly into the agent's prompt with no sanitization. A user could craft a Discord message containing prompt injection payloads (e.g., `</channel>\n[SYSTEM] Now do X`).
- **Current mitigation:** The `<channel ...>` XML wrapper provides partial context isolation.
- **Risk:** Agents running with `bypassPermissions` and powerful MCP tools are high-value targets for prompt injection.

### Webhook Token Exposed in Thread Bindings JSON

- **Files:** `~/.openclaw/discord/thread-bindings.json` (observed at runtime)
- **Issue:** OpenClaw's thread bindings file contains raw Discord webhook tokens in plaintext (`webhookToken` field). This file is committed-adjacent (sits in `~/.openclaw/`, not git-tracked). ClawCode does not create this file, but if ClawCode-created thread registries similarly store webhook tokens, the same exposure applies.
- **Check:** `~/.clawcode/manager/thread-bindings.json` — ClawCode's `ThreadBinding` type (`src/discord/thread-types.ts`) does not include a `webhookToken` field. Lower risk for ClawCode, but worth confirming `WebhookManager` doesn't persist tokens.

---

## 4. Performance Risks

### Embedding Model Load on First Memory Operation

- **File:** `src/memory/embedder.ts` line 69
- **Issue:** `@huggingface/transformers` uses dynamic `import()` on first call. The ONNX model (~23MB) downloads on first use and is cached in `~/.cache/huggingface`. On a cold start, the first memory write per daemon startup has 2–10 second latency.
- **Impact:** First message to each agent after daemon cold-start may time out at the Discord level (Discord shows "application did not respond") because memory initialization blocks the first agent response.

### Sequential Agent Startup — Workspace Initialization

- **File:** `src/agent/workspace.ts` line 113 (referenced from `src/manager/daemon.ts` line 174)
- **Issue:** `linkAgentSkills` is called sequentially for each agent in a `for...of` loop. With 14 agents, skill linking is done one agent at a time. Each involves filesystem reads and symlink creation.
- **Impact:** Daemon startup time scales linearly with agent count. For 14 agents with multiple skills each, this adds seconds to startup.
- **Fix approach:** `await Promise.all(resolvedAgents.map(...))` for skill linking.

### Registry File Read on Every `status` IPC Call

- **File:** `src/manager/daemon.ts` line 577
- **Issue:** The `status` IPC method reads `registry.json` from disk on every invocation. The SSE manager (`src/dashboard/sse.ts` line 85) polls via IPC every 3 seconds. This causes `registry.json` to be read from disk ~20 times per minute continuously.
- **Impact:** Unnecessary filesystem I/O in a long-running daemon. Low impact on SSD but measurable over days.
- **Fix approach:** Cache the registry in memory and invalidate on write.

### Delivery Queue DB Polling Loop

- **File:** `src/discord/delivery-queue.ts` line 330
- **Issue:** The delivery queue uses `setInterval` to poll SQLite for pending items. Polling interval and backoff details need verification, but any fixed-interval polling on SQLite is less efficient than a reactive approach.
- **Current state:** Acceptable for current load (1 agent), but with 14+ agents each sending frequent messages, contention on `delivery-queue.db` could become measurable.

---

## 5. Fragile Areas

### `startDaemon()` — All-or-Nothing Initialization

- **File:** `src/manager/daemon.ts` lines 130–521
- **Issue:** `startDaemon()` initializes all 12+ subsystems serially. If any subsystem throws after the IPC socket has been created but before the function returns, the daemon dies but the stale socket cleanup may not run (the `ensureCleanSocket` only runs at startup, not on mid-init failure).
- **Scenario:** If `startDashboardServer()` throws (port 3100 in use), the IPC socket `clawcode.sock` is left on disk. The next `clawcode start-all` will detect the socket, find no active listener, clean it up, and start fresh — correct behavior. But any in-flight agent sessions are orphaned.
- **Current mitigation:** `ensureCleanSocket()` correctly handles stale sockets. Risk is moderate.

### Config Hot-Reload Race Condition

- **File:** `src/config/watcher.ts` line 103 (debounce), `src/manager/config-reloader.ts`
- **Issue:** `ConfigWatcher` debounces file changes by 500ms (default). If `clawcode.yaml` is written while an agent is mid-response (agent currently holding a session query), the `configReloader.applyChanges()` may stop/restart the agent while its current turn is executing.
- **Impact:** In-flight Discord response can be silently dropped. No user-visible error.
- **Fix approach:** Gate config reloads on agents being in idle state, or add a "reload pending" flag that defers application until the current turn completes.

### Slash Command Handler Falls Back to Own Discord Client

- **File:** `src/discord/slash-commands.ts` lines 85–100
- **Issue:** If `discordClient` is not provided (e.g., bridge failed to start), `SlashCommandHandler` creates its own `Client` and calls `client.login(botToken)`. This creates a second gateway connection using the same token — a duplicate gateway which Discord.js warns about.
- **Current code:** The `SlashCommandHandler` is passed `discordBridge?.discordClient` — so this only triggers if `discordBridge` is null (bridge start failed). In that case, slash commands get their own client.
- **Impact:** Two simultaneous Discord gateway connections with the same token can cause rate limiting and missed events.

### Memory Initialization Failure Is Silently Non-Fatal

- **File:** `src/manager/session-memory.ts` lines 95–99
- **Issue:** If `MemoryStore`, `UsageTracker`, or any other memory component fails to initialize, the error is caught and logged as "failed to initialize memory (non-fatal)". The agent starts without memory persistence.
- **Impact:** Agents run indefinitely without storing memories. Operators must monitor logs to detect this. No Discord alert, no health check reports it.
- **Fix approach:** Add a memory-health heartbeat check that reports missing MemoryStore for an agent as a warning.

### `registry.json.tmp` Leftover on Crash

- **File:** `src/manager/registry.ts` line 56
- **Issue:** Registry writes use atomic rename (`tmp` → `final`). If the process crashes between `writeFile(tmpPath)` and `rename(tmpPath, path)`, a stale `registry.json.tmp` is left on disk. On next startup, nothing cleans up the `.tmp` file — it persists indefinitely.
- **Impact:** Low risk (harmless orphan file) but can cause confusion during debugging.

### No Test Coverage for `daemon.ts` `routeMethod` IPC Cases

- **Files:** `src/manager/__tests__/daemon.test.ts`
- **Issue:** The 400-line `routeMethod` switch has unit tests for startup/shutdown but not for every IPC method (e.g., `spawn-subagent-thread`, `memory-list`, `security-*`). New IPC methods added in recent phases (34+) may lack test coverage.
- **Risk:** Regressions in IPC routing go undetected until runtime.

---

*Concerns audit: 2026-04-10*
