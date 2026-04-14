# ClawCode

Multi-agent orchestration system built natively on [Claude Code](https://claude.ai/code). Run multiple persistent AI agents, each with their own identity, workspace, memory, and Discord channel — managed by a single daemon process.

## What It Does

ClawCode turns Claude Code into a multi-agent platform. Each agent is a persistent Claude Code session bound to a Discord channel, with:

- **Persistent identity** via SOUL.md and IDENTITY.md files
- **Long-term memory** with semantic search (local embeddings, no API calls)
- **Tiered memory management** — hot/warm/cold with automatic consolidation
- **Discord integration** — each agent lives in its own channel, responds naturally
- **Typing indicator + tight streaming cadence** — typing fires within 500ms; edit cadence 750ms (tunable) with rate-limit backoff
- **Prompt caching** — Anthropic preset+append with two-block context assembly + per-turn prefix-hash eviction detection
- **Intra-turn tool cache** — idempotent tool results (memory_lookup / search_documents / etc.) cached per turn, zero cross-turn leak
- **Per-turn latency traces** — p50/p95/p99 tracing + SLO colors on CLI + dashboard, with CI regression gate (`clawcode bench --check-regression`)
- **Context audit + lazy skills** — `clawcode context-audit <agent>` reports per-section token budgets; unused skills compress to one-line catalog entries
- **Warm-path startup gate** — READ-ONLY SQLite warmup + resident embedding singleton + ready-flag before agents go live
- **Scheduled tasks** via cron (reminders, reports, maintenance)
- **Inter-agent messaging** through filesystem-based inboxes
- **Model escalation** — agents on Sonnet can escalate to Opus when they need it
- **Budget enforcement** — per-agent token limits with Discord alerts
- **Health monitoring** — context fill tracking, automatic zone alerts to Discord
- **Web dashboard** — real-time agent status via SSE + latency / prompt cache / tool-call / warm-path panels
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
| `clawcode latency <agent>` | Per-agent latency percentiles (p50/p95/p99) with SLO colors |
| `clawcode cache <agent>` | Prompt-cache hit rate + first-token cache effect per agent |
| `clawcode tools <agent>` | Per-tool round-trip timing with SLO status |
| `clawcode bench` | Run latency benchmark; `--check-regression` for CI gate; `--update-baseline` to roll the baseline |
| `clawcode context-audit <agent>` | Per-section token budget audit (identity / soul / skills / history / summary) |
| `clawcode security` | Manage channel access policies |
| `clawcode dashboard` | Launch web dashboard |
| `clawcode mcp` | Start MCP server (for agent-to-agent tools) |
| `clawcode run <agent> <prompt>` | One-shot: send prompt and exit |
| `clawcode update` | Pull latest from git, rebuild, optionally restart |

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

## Performance & Latency (v1.7)

v1.7 ships end-to-end latency optimization across the hot path. Every Discord message → reply cycle is observable, budgeted, cached, and gated:

**Measurement:** Per-turn traces capture phase-level timings (`receive`, `first_token`, `first_visible_token`, `context_assemble`, `tool_call.<name>`, `typing_indicator`, `end_to_end`) in a per-agent `traces.db`. View with:

```bash
clawcode latency <agent>              # percentile table with SLO colors + First Token headline
clawcode cache <agent>                # prompt cache hit rate + cache_effect_ms
clawcode tools <agent>                # per-tool round-trip timing
clawcode bench --check-regression     # CI gate: fails on p95 regression vs baseline
```

**Caching:** System prompt uses Anthropic's preset+append form so identity / soul / skills header / stable hot-tier memory sit in a cached prefix. Per-turn prefix-hash diffing catches eviction when config changes (identity / soul / skills / hot-tier). Dashboard shows per-agent hit rate; daily summary embed carries `💾 Cache: X% over N turns`.

**Budgets:** Configurable per-section token budgets (identity / soul / skills_header / hot_tier / recent_history / per_turn_summary / resume_summary) with per-section truncation strategies. Unused skills compress to one-line catalog entries; usage-mention word-boundary match re-inflates. Resume summary hard-capped at 1500 tokens.

**Streaming:** First-token latency is a first-class headline metric on CLI + dashboard. Typing indicator fires at message arrival (≤ 500ms before LLM work starts). Discord edit cadence defaults to 750ms with a 300ms floor + rate-limit backoff.

**Tool-call overhead:** Intra-turn idempotent cache on memory_lookup / search_documents / memory_list / memory_graph (whitelist, per-turn Map GC'd at turn end, zero cross-turn leak). Per-tool latency telemetry surfaces slow tools directly.

**Warm path:** SQLite + sqlite-vec handles warmed with READ-ONLY queries at agent start. Embedding model is a singleton at daemon level with a startup probe. Agent doesn't flip to `ready` in `clawcode status` / `/clawcode-fleet` until warm-path check passes (10s timeout; errors show in fleet status).

**Per-agent config** — sensible defaults, customize via `clawcode.yaml`:

```yaml
agents:
  - name: assistant
    perf:
      traceRetentionDays: 7                # default 7
      streaming:
        editIntervalMs: 750                # default 750, min 300
      resumeSummaryBudget: 1500            # default 1500, min 500
      memoryAssemblyBudgets:
        hotTier: 2000
        recentHistory: 8000
      lazySkills:
        enabled: true
        usageThresholdTurns: 20            # min 5
      slos:
        - segment: first_token
          metric: p50
          thresholdMs: 1500                # override default 2000
      tools:
        maxConcurrent: 10
        idempotent: [memory_lookup, search_documents, memory_list, memory_graph]
```

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

Pull the latest code, rebuild, and restart:

```bash
clawcode update --restart
```

Or without restart (apply on next daemon start):

```bash
clawcode update
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript 6.0 (ESM-only) |
| Runtime | Node.js 22 LTS |
| Agent SDK | @anthropic-ai/claude-agent-sdk 0.2.x |
| Database | better-sqlite3 + sqlite-vec |
| Embeddings | @huggingface/transformers (local ONNX) |
| Tokenizer | @anthropic-ai/tokenizer (token counting for budgets) |
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
  usage/        # Token tracking, budgets, cost estimation, daily Discord summary
  skills/       # Skill discovery, linking, installation
  bootstrap/    # First-run agent initialization
  dashboard/    # Web UI with SSE real-time updates + latency/cache/tools/warm-path panels
  performance/  # TraceStore, TraceCollector, SLOs, percentiles, token counter (v1.7)
  benchmarks/   # bench harness: runner, baseline, thresholds, keep-alive (v1.7)
  shared/       # Logger, errors, types, canonicalStringify
scripts/
  install.sh    # Ubuntu deployment installer
```

## License

Private repository. All rights reserved.
