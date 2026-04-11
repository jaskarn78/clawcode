# External Integrations

**Analysis Date:** 2026-04-11

## Claude AI (Anthropic)

**Agent Sessions:**
- SDK: `@anthropic-ai/claude-agent-sdk` ^0.2.97
- Used in: `src/manager/session-adapter.ts` (`SdkSessionAdapter`)
- Integration: `query()` API with `resume: sessionId` for multi-turn session continuity. Each `send`/`sendAndCollect`/`sendAndStream` call creates a new query with `resume` option.
- Auth: OAuth subscription auth (no `ANTHROPIC_API_KEY`). The adapter explicitly strips `ANTHROPIC_API_KEY` from the subprocess env via `buildCleanEnv()` in `src/manager/session-adapter.ts`.
- Models: `haiku` (default), `sonnet`, `opus` — defined in `src/config/schema.ts` `modelSchema`.
- Session options: `permissionMode: "bypassPermissions"`, `settingSources: ["project"]`, per-agent `systemPrompt`, `cwd` (agent workspace), optional `mcpServers`.

**Advisor Feature:**
- An agent can ask `opus` for advice without switching sessions via the `ask_advisor` MCP tool.
- Budget enforcement: `src/usage/advisor-budget.ts` limits advisor invocations.
- Implemented in `src/manager/daemon.ts` via `AdvisorBudget` and `EscalationBudget`.

**Model Escalation:**
- `src/manager/escalation.ts` (`EscalationMonitor`) — Monitors agent responses for capability failures and transparently forks to a higher-tier model.
- Keyword trigger: `"this needs opus"` in response causes escalation.
- Error threshold: 3 consecutive errors triggers escalation.
- Budget cap: `EscalationBudget` in `src/usage/budget.ts` enforces daily/weekly token limits per model tier per agent.

**Usage Tracking:**
- `src/usage/tracker.ts` (`UsageTracker`) — SQLite-backed per-agent usage event storage.
- Cost reported by SDK `result` message fields: `total_cost_usd`, `usage.input_tokens`, `usage.output_tokens`, `num_turns`, `duration_ms`, `model`.
- Pricing constants in `src/usage/pricing.ts`: haiku $0.25/$1.25 per M, sonnet $3/$15 per M, opus $15/$75 per M.

## Discord

**Primary Bot Client:**
- SDK: `discord.js` ^14.26.2
- Used in: `src/discord/bridge.ts` (`DiscordBridge`), `src/discord/webhook-manager.ts`, `src/discord/slash-commands.ts`, `src/discord/thread-manager.ts`
- Auth token location: `~/.claude/channels/discord/.env` (primary) or `DISCORD_BOT_TOKEN` env var (fallback). Loaded by `loadBotToken()` in `src/discord/bridge.ts`.

**Gateway Intents Used:**
- `Guilds`, `GuildMessages`, `MessageContent`, `DirectMessages`, `GuildMessageReactions`
- Partials: `Channel`, `Message`, `Reaction`

**Message Routing:**
- Channel-to-agent routing table built at startup from `clawcode.yaml` agent `channels` array.
- Router: `src/discord/router.ts`, types in `src/discord/types.ts`.
- Thread routing: `src/discord/thread-manager.ts` handles `threadCreate` events and routes thread messages to ephemeral sessions.

**Webhooks:**
- `src/discord/webhook-manager.ts` (`WebhookManager`) — Uses `discord.js` `WebhookClient` for per-agent custom display names/avatars.
- Config: `webhook.webhookUrl`, `webhook.displayName`, `webhook.avatarUrl` per agent in `clawcode.yaml`.

**Slash Commands:**
- `src/discord/slash-commands.ts` (`SlashCommandHandler`) — Registers and handles Discord application commands.
- Commands defined per-agent in `clawcode.yaml` `slashCommands` array. Discord option types 1-11.

**Reactions:**
- Bridge listens to `messageReactionAdd` / `messageReactionRemove` events and forwards to agent session. Toggleable per agent via `reactions: bool` in config.

**Security/ACL:**
- `src/security/acl-parser.ts` — Parses `SECURITY.md` allowlists for per-channel user access control.
- Checked in `DiscordBridge.handleMessage()` before routing. Silent ignore on block.

**Delivery Queue:**
- `src/discord/delivery-queue.ts` (`DeliveryQueue`) — Async queue for reliable Discord message delivery with retry on failure.

**Rate Limiter:**
- `src/discord/rate-limiter.ts` (`createRateLimiter`) — Per-channel rate limiting. Default config from `src/discord/types.ts`.

**Attachment Handling:**
- `src/discord/attachments.ts` — Downloads Discord attachments to agent workspace `inbox/attachments/` directory. Images include multimodal reading hints for agents.

**Streaming Responses:**
- `src/discord/streaming.ts` (`ProgressiveMessageEditor`) — Sends initial message then edits in-place as agent streams output. Falls back to split messages when response exceeds 2000 chars.

## MCP (Model Context Protocol)

**ClawCode as MCP Server:**
- `src/mcp/server.ts` — Exposes ClawCode daemon capabilities as MCP tools that agents can call.
- SDK: `@modelcontextprotocol/sdk` 1.29.0 (transitive via claude-agent-sdk), transport: `StdioServerTransport`.
- Tools: `agent_status`, `list_agents`, `send_message`, `list_schedules`, `list_webhooks`, `spawn_subagent_thread`, `memory_lookup`, `ask_advisor`.
- Each tool delegates to daemon via IPC (Unix socket).

**Agent MCP Clients:**
- Agents can be configured with external MCP servers via the `mcpServers` array per agent in `clawcode.yaml`.
- Config schema: `src/config/schema.ts` `mcpServerSchema` — `name`, `command`, `args`, `env`.
- Passed to SDK `query()` as `mcpServers` option. Transformed via `transformMcpServersForSdk()` in `src/manager/session-adapter.ts`.

## Data Storage

**Databases:**
- Per-agent memory: `~/.clawcode/agents/<name>/memory.db` — better-sqlite3 with sqlite-vec extension.
- Per-agent usage: `~/.clawcode/agents/<name>/usage.db` — better-sqlite3 (no vector).
- Thread registry: SQLite via `THREAD_REGISTRY_PATH` from `src/discord/thread-types.ts`.
- Approval log: `src/security/approval-log.ts` — SQLite-backed audit log for command approvals.
- Config audit trail: `src/config/audit-trail.ts` — SQLite-backed diff history for config changes.

**Memory Schema:**
- Tables: `memories`, `vec_memories` (virtual, vec0), `session_logs`, `memory_links`
- Vector index: `float[384]` with `distance_metric=cosine` in `vec0` virtual table.
- Tiers: `hot`, `warm`, `cold` (column on `memories` table).

**File Storage:**
- Local filesystem only. Attachment downloads to agent workspace `inbox/attachments/`.
- Agent workspaces: `~/.clawcode/agents/<name>/` (default base path from config `defaults.basePath`).

**Caching:**
- `~/.cache/huggingface` — HuggingFace model cache for `all-MiniLM-L6-v2` (23MB, downloaded on first warmup).

## IPC (Inter-Process Communication)

**Daemon Socket:**
- Unix domain socket at `SOCKET_PATH` (defined in `src/manager/daemon.ts`).
- Protocol: newline-delimited JSON-RPC 2.0.
- Server: `src/ipc/server.ts`, Client: `src/ipc/client.ts`.
- CLI commands communicate with daemon via this socket.

**Collaboration Inbox:**
- `src/collaboration/inbox.ts` — Filesystem-based agent-to-agent messaging via JSON files in agent workspace `inbox/` directory.
- Watched by heartbeat check `src/heartbeat/checks/inbox.ts`.

## File Watching

**Config Hot-Reload:**
- `chokidar` ^5.0.0 watches `clawcode.yaml` for changes.
- `src/config/watcher.ts` (`ConfigWatcher`) — Debounced (500ms default) reload, diff computation, audit trail recording, daemon notification.
- `src/manager/config-reloader.ts` (`ConfigReloader`) — Applies config diffs to running sessions.

## Dashboard

**HTTP Server:**
- Built-in `node:http` — no external HTTP framework.
- `src/dashboard/server.ts` — serves static files from `src/dashboard/static/`, SSE endpoint, REST API for agent control.
- SSE: `src/dashboard/sse.ts` (`SseManager`) — real-time status push to browser.
- Static: `src/dashboard/static/index.html`, `app.js`, `styles.css`.

## Authentication & Identity

**Discord:**
- Bot token auth. Token stored at `~/.claude/channels/discord/.env` outside the project.

**Claude:**
- OAuth subscription auth (Claude Code CLI login). API key intentionally stripped from subprocess env.

**No external auth provider** — security is handled by Discord channel ACLs (`src/security/acl-parser.ts`) and per-agent command allowlists (`src/security/allowlist-matcher.ts`).

## Monitoring & Observability

**Error Tracking:**
- No external error tracking service. Errors logged via `pino` to stdout.

**Logs:**
- `pino` ^9 JSON logs. Singleton in `src/shared/logger.ts`. Level via `CLAWCODE_LOG_LEVEL` (default: `"info"`).
- Log level options: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

**Heartbeat:**
- `src/heartbeat/runner.ts` (`HeartbeatRunner`) — Periodic health checks for each agent session.
- Checks: context fill zones, memory consolidation, tier maintenance, inbox processing, thread idle cleanup, attachment cleanup, auto-linker.
- Config: `heartbeat.intervalSeconds` (default 60) and `heartbeat.checkTimeoutSeconds` (default 10) per agent.

**Budget Alerts:**
- `DiscordBridge.sendBudgetAlert()` posts Discord embeds when token budgets hit warning/exceeded thresholds.

## CI/CD & Deployment

**Hosting:**
- Local process. Daemon runs as background process on developer machine.
- No cloud hosting detected.

**CI Pipeline:**
- None detected in repository.

## Webhooks & Callbacks

**Incoming:**
- None. Discord events are received via WebSocket gateway (discord.js manages reconnection).

**Outgoing:**
- Discord webhook delivery: `WebhookClient` in `src/discord/webhook-manager.ts` — agents post messages to Discord with custom identity via webhook URLs.
- Budget alert embeds sent to agent Discord channels.

## Environment Configuration

**Required env vars (runtime):**
- `DISCORD_BOT_TOKEN` — Only if `~/.claude/channels/discord/.env` is absent.
- `CLAWCODE_LOG_LEVEL` — Optional, defaults to `"info"`.

**Secrets location:**
- Discord bot token: `~/.claude/channels/discord/.env` (outside project, not committed)
- Claude auth: Claude Code CLI OAuth session (managed by `claude` CLI)

---

*Integration audit: 2026-04-11*
