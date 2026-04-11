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
- **Health monitoring** — context fill tracking, automatic zone alerts
- **Web dashboard** — real-time agent status via SSE

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
- [Claude Code CLI](https://claude.ai/code) installed
- Anthropic API key
- Discord bot token (optional, for Discord integration)

### Install

```bash
git clone https://github.com/jaskarn78/clawcode.git
cd clawcode
npm install
npm run build
```

### Configure

Create a `clawcode.yaml` in the project root:

```yaml
discord:
  botToken: "your-discord-bot-token"

defaults:
  model: sonnet
  heartbeat:
    intervalMs: 30000

agents:
  - name: assistant
    model: sonnet
    channels: ["DISCORD_CHANNEL_ID"]
    workspace: ~/.clawcode/agents/assistant
    soul: |
      You are a helpful assistant with a dry wit.
      You remember conversations and learn from them.

  - name: researcher
    model: sonnet
    channels: ["ANOTHER_CHANNEL_ID"]
    workspace: ~/.clawcode/agents/researcher
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
| `clawcode agent-create` | Scaffold a new agent config |
| `clawcode run <agent> <prompt>` | One-shot: send prompt and exit |

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

## Deployment (Ubuntu)

For production deployment on Ubuntu 25:

```bash
sudo bash scripts/install.sh
```

This installs Node.js 22, Claude Code CLI, builds the project, creates a `clawcode` system user, and sets up a systemd service with security hardening.

```bash
# Configure
sudo editor /etc/clawcode/env           # Set ANTHROPIC_API_KEY
sudo editor /etc/clawcode/clawcode.yaml  # Configure agents

# Run
sudo systemctl start clawcode
sudo systemctl enable clawcode

# Logs
journalctl -u clawcode -f
```

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
```

## License

Private repository. All rights reserved.
