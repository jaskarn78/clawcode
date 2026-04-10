# External Integrations

**Analysis Date:** 2026-04-10

## APIs & External Services

**Claude / Anthropic:**
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` ^0.2.97) — spawns persistent Claude Code sessions per agent
  - Client: `src/manager/session-adapter.ts` → `SdkSessionAdapter`
  - Auth: OAuth subscription auth (Claude Code session). `ANTHROPIC_API_KEY` is explicitly stripped from subprocess env in `buildCleanEnv()` to force OAuth
  - Models: `sonnet`, `opus`, `haiku` (selectable per agent in `clawcode.yaml`)

**Discord:**
- discord.js 14.x — connects each agent to Discord channels
  - Client: `src/discord/bridge.ts` → `DiscordBridge`
  - Auth: Bot token loaded from `~/.claude/channels/discord/.env` (key: `DISCORD_BOT_TOKEN`) or env var `DISCORD_BOT_TOKEN`
  - Gateway intents: Guilds, GuildMessages, MessageContent, DirectMessages, GuildMessageReactions
  - Slash commands registered via `src/discord/slash-commands.ts`
  - Webhook delivery (custom display names per agent): `src/discord/webhook-manager.ts`

**MCP Servers (configured per agent in `clawcode.yaml`):**
The `mcpServers` section defines external tools passed to Claude Code sessions. Configured servers in `clawcode.yaml`:

| Server | Command | Auth env var (1Password path) |
|--------|---------|-------------------------------|
| finnhub | `node /home/jjagpal/clawd/mcp-servers/finnhub/server.js` | `FINNHUB_API_KEY` via `op://clawdbot/Finnhub/api-key` |
| finmentum-db | `mcporter serve mysql` | `MYSQL_PASSWORD` via `op://clawdbot/Finmentum DB/password` |
| google-workspace | `node .../google-workspace-mcp/dist/index.js` | No token (uses gcloud auth) |
| homeassistant | `python3 homeassistant.py` | `HA_TOKEN` via `op://clawdbot/HA Access Token/Access Token` |
| strava | `python3 strava.py` | `STRAVA_*` tokens via `op://clawdbot/Strava OAuth Tokens/...` |
| openai | `python3 openai_server.py` | `OPENAI_API_KEY` via `${OPENAI_API_KEY}` |
| anthropic | `python3 anthropic_server.py` | `ANTHROPIC_API_KEY` via `${ANTHROPIC_API_KEY}` |
| brave-search | `python3 brave_search.py` | `BRAVE_API_KEY` via `${BRAVE_API_KEY}` |
| elevenlabs | `python3 elevenlabs.py` | `ELEVENLABS_API_KEY` via `${ELEVENLABS_API_KEY}` |
| ollama | `python3 ollama.py` | `OLLAMA_URL` (local Tailscale IP `100.117.64.85:11434`) |
| browserless | `python3 browserless.py` | `BROWSERLESS_URL` (local Tailscale IP `100.117.64.85:3000`) |
| chatterbox-tts | `python3 chatterbox_tts.py` | `CHATTERBOX_URL` (local Tailscale IP `100.117.64.85:4123`) |
| fal-ai | `python3 fal_ai.py` | `FAL_API_KEY` via `op://clawdbot/fal.ai Admin API Credentials/credential` |
| finmentum-content | `python3 finmentum_content.py` | Multiple via 1Password: HeyGen, Pexels, Jamendo, MySQL |

MCP server configs are resolved in `src/config/loader.ts` → `resolveAgentConfig()` and passed to the SDK in `src/manager/session-adapter.ts` → `transformMcpServersForSdk()`.

**ClawCode as MCP Server:**
- ClawCode exposes itself as an MCP server at `src/mcp/server.ts` using `@modelcontextprotocol/sdk` ^1.29.0
- Transport: stdio (`StdioServerTransport`)
- Tools exposed: `agent_status`, `list_agents`, `send_message`, `list_schedules`, `list_webhooks`, `spawn_subagent_thread`
- All tools delegate to the daemon via Unix socket IPC (`src/ipc/client.ts`)

## Secret Management

**1Password CLI (`op://`):**
- All production secrets referenced via 1Password URIs (e.g., `op://clawdbot/Finnhub/api-key`)
- The `clawcode.yaml` config file uses `op://` paths that are resolved at runtime by the 1Password CLI
- Vault: `clawdbot`
- Discord bot token: `op://clawdbot/Clawdbot Discord Token/credential`

## Data Storage

**Databases (SQLite via better-sqlite3):**
- Memory store: `~/.clawcode/agents/{agent-name}/memory.db`
  - Tables: `memories`, `session_logs`, `vec_memories` (virtual, sqlite-vec)
  - WAL mode, `busy_timeout = 5000`, `synchronous = NORMAL`
  - Vector schema: 384-dim float32 cosine distance
  - Implemented in `src/memory/store.ts`
- Usage tracking: `~/.clawcode/agents/{agent-name}/usage.db` (inferred from `UsageTracker` in `src/usage/tracker.ts`)
- Registry: `~/.clawcode/manager/registry.json` (JSON file, not SQLite — `src/manager/registry.ts`)

**File Storage:**
- Agent workspaces: `~/.clawcode/agents/{agent-name}/` (SOUL.md, IDENTITY.md, memory, attachments)
- Inbox attachments: `{workspace}/inbox/attachments/` (Discord attachment downloads)
- Thread attachments: `/tmp/thread-attachments/`
- Skills: `~/.clawcode/skills/` (symlinked from workspace `skills/`)

**Local Embeddings:**
- Model: `Xenova/all-MiniLM-L6-v2` (384 dimensions, ONNX via `@huggingface/transformers`)
- Cache: `~/.cache/huggingface/` (~23MB, downloaded on first warmup)
- No external API calls for embeddings

## Authentication & Identity

**Claude Code OAuth:**
- Agent sessions use Claude Code's OAuth subscription auth (not API key)
- `ANTHROPIC_API_KEY` stripped from SDK subprocess env in `src/manager/session-adapter.ts`

**Discord Bot:**
- Token loaded from `~/.claude/channels/discord/.env` (line: `DISCORD_BOT_TOKEN=...`)
- Fallback: `DISCORD_BOT_TOKEN` environment variable
- Bot permissions: read messages, send messages, manage reactions, create threads

## IPC (Internal)

**Unix Domain Socket:**
- Path: defined in `src/manager/daemon.ts` as `SOCKET_PATH`
- Protocol: newline-delimited JSON-RPC 2.0
- Server: `src/ipc/server.ts`
- Client: `src/ipc/client.ts`
- Used by CLI commands and the MCP server to communicate with the running daemon

## Dashboard

**HTTP Server:**
- Built with raw `node:http` (no framework)
- Port: `CLAWCODE_DASHBOARD_PORT` env var, default 3100
- Implemented in `src/dashboard/server.ts`
- SSE endpoint for real-time agent status: `src/dashboard/sse.ts`
- Static files served from `src/dashboard/static/`

## Monitoring & Observability

**Error Tracking:** None

**Logs:**
- pino structured JSON to stdout
- Log level: `CLAWCODE_LOG_LEVEL` env var (default: `info`)
- Shared logger instance: `src/shared/logger.ts`
- Child loggers per component (e.g., `logger.child({ component: "ipc-server" })`)

## CI/CD & Deployment

**Hosting:** Not detected (self-hosted, runs on developer machine)

**CI Pipeline:** Not detected (no GitHub Actions or CI config files present)

## Environment Variables Summary

| Variable | Purpose | Source |
|----------|---------|--------|
| `CLAWCODE_LOG_LEVEL` | Pino log level | `src/shared/logger.ts` |
| `CLAWCODE_DASHBOARD_PORT` | Dashboard HTTP port | `src/manager/daemon.ts` |
| `DISCORD_BOT_TOKEN` | Discord bot auth | `src/discord/bridge.ts` |
| `OPENAI_API_KEY` | OpenAI MCP server | `clawcode.yaml` |
| `ANTHROPIC_API_KEY` | Anthropic MCP server | `clawcode.yaml` |
| `BRAVE_API_KEY` | Brave Search MCP server | `clawcode.yaml` |
| `ELEVENLABS_API_KEY` | ElevenLabs MCP server | `clawcode.yaml` |

Most secrets use 1Password `op://` URIs in `clawcode.yaml` rather than env vars.

## Webhooks & Callbacks

**Incoming:** None detected

**Outgoing:**
- Discord webhooks (per-agent custom identity) — `src/discord/webhook-manager.ts`
- Webhook URLs configured per agent in `clawcode.yaml` via `webhook.webhookUrl`

---

*Integration audit: 2026-04-10*
