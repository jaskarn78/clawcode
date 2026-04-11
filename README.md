# ClawCode

Multi-agent orchestration system built natively on [Claude Code](https://claude.ai/code). Run multiple persistent AI agents, each with their own identity, workspace, memory, and Discord channel — managed by a single daemon process.

## What It Does

ClawCode turns Claude Code into a multi-agent platform. Each agent is a persistent Claude Code session bound to a Discord channel, with:

- **Persistent identity** via SOUL.md and IDENTITY.md files
- **Long-term memory** with semantic search (local embeddings, no API calls)
- **Tiered memory management** — hot/warm/cold with automatic consolidation
- **Discord integration** — each agent lives in its own channel, responds naturally
- **Scheduled tasks** via cron (reminders, reports, maintenance)
- **Inter-agent messaging** through filesystem-based inboxes
- **Model escalation** — agents on Sonnet can escalate to Opus when they need it
- **Budget enforcement** — per-agent token limits with Discord alerts
- **Health monitoring** — context fill tracking, automatic zone alerts to Discord
- **Web dashboard** — real-time agent status via SSE
- **MCP tools auto-injected** — every agent gets `memory_lookup`, `spawn_subagent_thread`, `ask_advisor` out of the box
- **1Password integration** — auto-injected when `OP_SERVICE_ACCOUNT_TOKEN` is set
- **Self-updating** — `clawcode update` pulls, rebuilds, and restarts from git

## Architecture

```
Discord                    CLI / MCP
   |                          |
   v                          v
DiscordBridge -----> IPC (Unix Socket, JSON-RPC 2.0)
                          |
                     startDaemon()
                          |
          +---------------+---------------+
          |               |               |
   SessionManager   HeartbeatRunner  TaskScheduler
          |               |               |
   SdkSessionAdapter   Checks[]      Cron Jobs
          |
   Claude Agent SDK
          |
   Agent Sessions (1 per agent)
          |
   Per-Agent SQLite (memory, usage, delivery)
```

Each agent gets an isolated workspace at `~/.clawcode/agents/<name>/` with its own SQLite databases, memory store, skills directory, and identity files.

## Quick Start

### Prerequisites

- Node.js 22 LTS
- [Claude Code CLI](https://claude.ai/code) installed and authenticated (`claude login`)
- Discord bot token (optional, for Discord integration)

### Install

```bash
git clone https://github.com/jaskarn78/clawcode.git
cd clawcode
npm install
npm run build
```

### Create an Agent

The interactive wizard walks through everything:

```bash
clawcode agent-create
```

```
  ClawCode Agent Setup
  ====================

Agent name: assistant
Discord channel ID: 1234567890123456
Soul/personality: You are a helpful assistant with a dry wit.
Model (sonnet/opus/haiku) [sonnet]:
Display name: Assistant
Emoji: 🤖
Workspace path [~/.clawcode/agents/assistant]:

  Optional features:
  Add scheduled tasks (cron)? [y/N]:
  Enable model escalation (Sonnet → Opus)? [y/N]: y
    Daily Opus token limit [50000]:
  Make this an admin agent? [y/N]:
  Use webhook identity? [y/N]: y
    Webhook display name [Assistant]:
    Avatar URL:
  Bind to additional channels? [y/N]:

Agent 'assistant' added to clawcode.yaml
Initializing workspace...
  Created: ~/.clawcode/agents/assistant
    - SOUL.md
    - IDENTITY.md

  Start with:
    clawcode start assistant
```

Or configure manually in `clawcode.yaml`:

```yaml
discord:
  botToken: "op://vault/item/field"  # 1Password reference
  # botToken: "your-token"           # or literal (not recommended)

defaults:
  model: sonnet
  heartbeat:
    intervalMs: 30000

agents:
  - name: assistant
    model: sonnet
    channels: ["DISCORD_CHANNEL_ID"]
    soul: |
      You are a helpful assistant with a dry wit.
      You remember conversations and learn from them.

  - name: researcher
    model: sonnet
    channels: ["ANOTHER_CHANNEL_ID"]
    escalationBudget:
      daily:
        opus: 100000
    soul: |
      You are a research specialist. Dig deep into topics.
```

### Initialize & Run

```bash
# Initialize agent workspaces
clawcode init

# Start all agents
clawcode start-all

# Or start one agent
clawcode start assistant

# Check status
clawcode status
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `clawcode init` | Initialize agent workspaces from config |
| `clawcode agent-create` | Interactive agent setup wizard |
| `clawcode start <name>` | Start a single agent |
| `clawcode start-all` | Start daemon with all agents |
| `clawcode stop <name>` | Stop an agent |
| `clawcode restart <name>` | Restart an agent |
| `clawcode status` | Show all agent statuses |
| `clawcode send <to> <message>` | Send a message to an agent |
| `clawcode health` | Show heartbeat health for all agents |
| `clawcode memory <agent>` | Query agent memory |
| `clawcode routes` | Show Discord channel routing table |
| `clawcode schedules` | Show cron schedule status |
| `clawcode threads` | List active Discord thread sessions |
| `clawcode webhooks` | Show webhook configurations |
| `clawcode fork <agent>` | Fork an agent session |
| `clawcode skills` | List available skills |
| `clawcode usage` | Show token usage stats |
| `clawcode costs` | Show cost breakdown by agent/model |
| `clawcode security` | Manage channel access policies |
| `clawcode dashboard` | Launch web dashboard |
| `clawcode mcp` | Start MCP server (for agent-to-agent tools) |
| `clawcode run <agent> <prompt>` | One-shot: send prompt and exit |
| `clawcode update` | Pull latest or specific release, rebuild, restart |
| `clawcode update --list` | List available releases |
| `clawcode update --check` | Check for updates without applying |
| `clawcode update --version v1.0.0` | Update to a specific release |

## Authentication

ClawCode uses **Claude Code's own authentication** — no separate Anthropic API key needed. Run `claude login` before starting the daemon.

For Discord, set the bot token in `clawcode.yaml`:
- **1Password (recommended):** `botToken: "op://vault/item/field"` — resolved via `op read` at startup
- **Literal:** `botToken: "your-token"` — stored in plaintext (not recommended for production)

## MCP Servers

Two MCP servers are **auto-injected** for every agent — no configuration needed:

| Server | Condition | Tools Provided |
|--------|-----------|----------------|
| `clawcode` | Always | `memory_lookup`, `spawn_subagent_thread`, `ask_advisor`, `agent_status`, `send_message` |
| `1password` | When `OP_SERVICE_ACCOUNT_TOKEN` is set | Secure credential access via 1Password |

Add custom MCP servers in `clawcode.yaml`:

```yaml
# Shared definitions (referenced by name in agent configs)
mcpServers:
  finnhub:
    name: finnhub
    command: node
    args: ["/path/to/finnhub-mcp/server.js"]
    env:
      API_KEY: "op://vault/Finnhub/api-key"

agents:
  - name: trader
    mcpServers: ["finnhub"]  # Reference shared definition
    # ...
```

## Memory System

Each agent has a local SQLite database with vector search powered by [sqlite-vec](https://github.com/asg017/sqlite-vec) and [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) embeddings running locally via ONNX.

**Tiered storage:**
- **Hot tier** — frequently accessed memories loaded into agent context
- **Warm tier** — searchable via semantic similarity (KNN)
- **Cold tier** — archived as YAML+markdown files, retrieved on demand

**Automatic maintenance:**
- Deduplication (cosine similarity > 0.85)
- Daily/weekly/monthly consolidation
- Relevance decay over time
- Wikilink-style knowledge graph between memories
- Context zone alerts delivered to Discord when memory fills up

## Deployment (Ubuntu)

For production deployment on Ubuntu 25:

```bash
sudo bash scripts/install.sh
```

This installs Node.js 22, Claude Code CLI, builds the project, creates a `clawcode` system user, and sets up a systemd service with security hardening.

```bash
# Authenticate (Claude Code handles auth — no separate API key needed)
sudo -u clawcode claude login

# Configure agents
sudo editor /etc/clawcode/clawcode.yaml

# Or use the interactive wizard
sudo -u clawcode clawcode agent-create -c /etc/clawcode/clawcode.yaml

# Start and enable on boot
sudo systemctl start clawcode
sudo systemctl enable clawcode

# View logs
journalctl -u clawcode -f
```

### Updating

```bash
# Check for updates
clawcode update --check

# Update to latest and restart
clawcode update --restart

# Update to a specific release
clawcode update --version v1.0.0 --restart

# List available releases
clawcode update --list
```

### Creating Releases

```bash
bash scripts/release.sh patch    # v0.1.0 → v0.1.1
bash scripts/release.sh minor    # v0.1.0 → v0.2.0
bash scripts/release.sh major    # v0.1.0 → v1.0.0
bash scripts/release.sh v2.0.0   # explicit version
```

Tags are pushed to GitHub and a release is created automatically via GitHub Actions with an auto-generated changelog.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript 6.0 (ESM-only) |
| Runtime | Node.js 22 LTS |
| Agent SDK | @anthropic-ai/claude-agent-sdk 0.2.x |
| Database | better-sqlite3 + sqlite-vec |
| Embeddings | @huggingface/transformers (local ONNX) |
| Discord | discord.js 14.x |
| Scheduling | croner |
| Validation | zod 4.x |
| Logging | pino |
| CLI | commander |
| Testing | vitest |
| Build | tsup |

## Development

```bash
# Run in dev mode (no build step)
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Build for production
npm run build
```

## Project Structure

```
src/
  cli/          # CLI entry point and commands
  config/       # YAML config loading, validation, hot-reload
  agent/        # Workspace creation and management
  manager/      # Session lifecycle, daemon, recovery, escalation
  discord/      # Bridge, routing, threads, webhooks, streaming
  memory/       # SQLite store, embeddings, tiers, consolidation
  heartbeat/    # Health checks, context zones, auto-maintenance
  scheduler/    # Cron-based task execution
  ipc/          # Unix socket JSON-RPC server/client
  mcp/          # MCP server for agent-to-agent tools
  security/     # Channel ACLs, allowlists, approval log
  collaboration/# Inter-agent inbox messaging
  usage/        # Token tracking, budgets, cost estimation
  skills/       # Skill discovery, linking, installation
  bootstrap/    # First-run agent initialization
  dashboard/    # Web UI with SSE real-time updates
  shared/       # Logger, errors, types, utilities
scripts/
  install.sh    # Ubuntu deployment installer
```

## License

Private repository. All rights reserved.
