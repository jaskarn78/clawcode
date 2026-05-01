# ClawCode

Multi-agent orchestration built natively on [Claude Code](https://claude.ai/code). Run multiple persistent AI agents — each with their own identity, workspace, memory, and Discord channel — managed by a single daemon process.

## What It Does

ClawCode turns Claude Code into a multi-agent platform. Each agent is a persistent Claude Code session bound to a Discord channel with:

- **Persistent identity** via SOUL.md / IDENTITY.md, loaded lazily at session boot
- **Long-term memory** — per-agent SQLite + local 384-dim embeddings (zero API cost), tiered hot/warm/cold with auto-consolidation and decay
- **Discord integration** — each agent lives in its own channel, types in real time, handles attachments/threads/reactions/webhooks
- **OpenAI-compatible HTTP endpoint** — `/v1/chat/completions` + `/v1/models` on port 3101; every agent reachable from any OpenAI client with per-bearer-key session continuity
- **MCP tools auto-injected** — `memory_lookup`, `spawn_subagent_thread`, `ask_advisor`, `delegate_task`, `send_message`, `browser_*`, `web_search` / `web_fetch_url`, `image_generate` / `image_edit` / `image_variations`
- **Model tiering** — fork-based escalation (Haiku → Opus) with per-agent budgets and Discord alerts
- **Cross-agent handoffs** — durable task store + trigger engine + policy DSL; agents delegate work asynchronously
- **Self-updating** — `clawcode update --restart` pulls, rebuilds, and restarts

**Migration from OpenClaw** — one-shot migrator (`clawcode migrate openclaw`) ports 15-agent fleets from OpenClaw to ClawCode with full memory/workspace/identity preservation. Shipped in v2.1 — see [milestones/v2.1-ROADMAP.md](.planning/milestones/v2.1-ROADMAP.md).

## Architecture

```
Discord                    CLI / MCP / OpenAI HTTP
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
   Per-Agent SQLite (memory, usage, delivery, conversation)
```

Each agent gets an isolated workspace at `~/.clawcode/agents/<name>/` with its own SQLite databases, memory store, skills, and identity files. Finmentum-family agents can share a basePath via per-agent `memoryPath:` overrides (v2.1).

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

# Bootstrap the runtime config from the example (gitignored — your local
# edits stay out of the repo)
cp clawcode.example.yaml clawcode.yaml

# One-time browser install (for the browser MCP)
npx playwright install chromium --only-shell
# On fresh Ubuntu/Debian, also install system libs:
sudo npx playwright install-deps chromium
```

### Create an Agent

```bash
clawcode agent-create
```

The interactive wizard sets up SOUL, IDENTITY, Discord channel binding, and skills.

### Run

```bash
clawcode start-all              # start all agents + daemon
clawcode status                 # live agent status
journalctl -u clawcode -f       # service logs (deployment)
```

## CLI Commands

### Core
- `clawcode start-all` / `stop-all` / `restart <agent>` — lifecycle
- `clawcode status` — agent health + context fill
- `clawcode agent-create` — interactive agent wizard
- `clawcode update [--restart]` — git pull + rebuild + optional restart

### Memory & Costs
- `clawcode memory search <agent> "<query>"` — semantic search
- `clawcode costs [--period today|7d|30d] [--agent <name>]` — token + image spend
- `clawcode latency <agent>` — p50/p95/p99 per-turn trace
- `clawcode context-audit <agent>` — per-section token budgets

### OpenAI Endpoint
- `clawcode openai-key create <agent> [--label X]` — mint pinned bearer key
- `clawcode openai-key create --all [--label X]` — mint multi-agent key
- `clawcode openai-key list` / `revoke <prefix>`
- `clawcode openai-log tail --since 1h` — request log

### Migration (v2.1)
- `clawcode migrate openclaw list` — show source OpenClaw agents + ledger status
- `clawcode migrate openclaw plan [--agent <name>]` — deterministic per-agent diff (zero writes)
- `clawcode migrate openclaw apply [--only <name>]` — 4 pre-flight guards → atomic YAML write → workspace copy → memory translate
- `clawcode migrate openclaw verify [<agent>]` — pass/fail checks
- `clawcode migrate openclaw rollback <agent>` — per-agent reversal, source untouched
- `clawcode migrate openclaw cutover <agent>` — unbind OpenClaw Discord bot
- `clawcode migrate openclaw complete` — generate migration report

### Ops
- `clawcode fleet status` / `restart` / `logs` — multi-agent control
- `clawcode trace <id>` — cross-agent request walker
- `clawcode policy dry-run <trigger>` — preview trigger dispatch
- `clawcode webhook list` / `create` / `delete` — per-agent Discord webhooks

## Authentication

ClawCode delegates to Claude Code — no separate API key. Run `claude login` as the agent user (or `sudo -u clawcode claude login` in deployment). Anthropic, OpenAI, Google, and MiniMax API keys are configured via environment file (see Deployment below).

## MCP Servers

Auto-injected by the daemon for every agent:

| Server | Tools | Source |
|--------|-------|--------|
| `memory` | `memory_lookup`, `search_documents` | v1.5 |
| `collab` | `spawn_subagent_thread`, `ask_advisor`, `delegate_task`, `send_message` | v1.3, v1.8 |
| `browser` | `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_fill`, `browser_extract`, `browser_wait_for` | v2.0 Phase 70 |
| `search` | `web_search`, `web_fetch_url` | v2.0 Phase 71 |
| `image` | `image_generate`, `image_edit`, `image_variations` | v2.0 Phase 72 |
| `clawcode` | Discord / inbox / attachments | v1.0 |
| `1password` | `op://` secret resolution (when `OP_SERVICE_ACCOUNT_TOKEN` set) | v1.4 (v2.7: pooled via daemon broker — one shared MCP child per service-account token) |

Disable per-server via `defaults.<server>.enabled: false` in `clawcode.yaml`, or override per-agent by listing a server in the agent's `mcpServers:` block.

## Memory System

Per-agent SQLite at `<workspace>/memory/memories.db` with sqlite-vec 384-dim vectors. Writes go through `MemoryStore.insert()` — never raw SQL. Key features:

- **Auto-compaction** at configurable context-fill threshold
- **Knowledge graph** — wikilinks + backlinks + graph-enriched search
- **Consolidation** — daily logs → weekly/monthly digests, raw archived
- **Decay + dedup + tiered hot/warm/cold** with importance scoring
- **Conversation memory** (v1.9) — every Discord turn captured with provenance + session-boundary summarization + resume auto-injection
- **Shared-workspace isolation** (v2.1) — per-agent `memoryPath:` keeps `memories.db` / inbox / heartbeat / session-state distinct across agents sharing a `basePath`

## Deployment (Ubuntu)

```bash
sudo bash scripts/install.sh
```

Installs Node 22, Claude Code CLI, builds the project, creates `clawcode` system user, and sets up a hardened systemd service.

```bash
sudo -u clawcode claude login                       # authenticate
sudo editor /etc/clawcode/clawcode.yaml              # configure agents
sudo systemctl start clawcode && sudo systemctl enable clawcode
journalctl -u clawcode -f                            # logs
```

Service files:
- **Config:** `/etc/clawcode/clawcode.yaml`
- **Env:** `/etc/clawcode/env` (API keys + PATH)
- **Data:** `/home/clawcode/.clawcode/` (agents/, manager/, skills/)
- **Dashboard:** http://127.0.0.1:3100

### Update

```bash
clawcode update --restart        # git pull + npm ci + npm run build + systemctl restart
```

Restart preserves running-agent state via the auto pre-deploy snapshot (v2.7): the daemon writes `pre-deploy-snapshot.json` on shutdown and replays the captured agent set on next boot, so `systemctl restart` does not require manually re-starting agents.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript 6.0 (ESM-only) |
| Runtime | Node.js 22 LTS |
| Agent SDK | @anthropic-ai/claude-agent-sdk 0.2.x |
| Database | better-sqlite3 + sqlite-vec |
| Embeddings | @huggingface/transformers (local ONNX, 384-dim MiniLM) |
| Discord | discord.js 14.x |
| Scheduling | croner |
| Validation | zod 4.x |
| Logging | pino |
| CLI | commander |
| Browser | playwright |
| Testing | vitest |
| Build | tsup |

## Development

```bash
npm run dev          # dev mode, no build step
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run build        # production build via tsup
```

## Project Structure

```
src/
  cli/          CLI entry + commands (start, status, memory, costs, migrate, etc.)
  config/       YAML loading, validation, hot-reload, agent schema
  agent/        Workspace creation + management
  manager/      Session lifecycle, daemon, recovery, escalation, TurnDispatcher
  discord/      Bridge, routing, threads, webhooks, streaming, capture
  memory/       SQLite store, embeddings, tiers, consolidation, ConversationStore
  heartbeat/    Health checks, context zones, auto-maintenance
  scheduler/    Cron-based task execution
  ipc/          Unix socket JSON-RPC
  mcp/          MCP server for agent-to-agent tools
  security/     Channel ACLs, allowlists, instruction-pattern detector
  collaboration/Inter-agent inbox messaging
  usage/        Token tracking, budgets, cost estimation, Discord summaries
  skills/       Skill discovery, linking, installation
  bootstrap/    First-run agent initialization
  dashboard/    Web UI with SSE
  performance/  TraceStore, SLOs, token counter
  benchmarks/   Bench harness + regression gate
  tasks/        Durable task store + state machine
  triggers/     Trigger engine + policy DSL
  documents/    RAG document ingestion + KNN search
  openai/       OpenAI-compatible HTTP endpoint + driver
  browser/      Playwright browser manager + MCP subprocess
  search/       Brave + Exa web search clients + MCP subprocess
  image/        OpenAI/MiniMax/fal.ai image clients + MCP subprocess
  migration/    OpenClaw → ClawCode migration toolchain (v2.1)
  shared/       Logger, errors, types, canonicalStringify
scripts/
  install.sh    Ubuntu deployment installer
  *-smoke.mjs   End-to-end smoke tests per milestone
```

## Milestone History & Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) for the full version-by-version + phase-by-phase changelog.

Recent milestones:
- **v2.7 Operator Self-Serve + Production Hardening** (2026-05-01) — GSD-via-Discord, /clawcode-status rich telemetry + Usage panel, daemon-side op:// secret cache, trigger-policy default-allow + coalescer storm fix, MCP lifecycle hardening, 1password-mcp broker pooling
- **v2.6 Tool Reliability & Memory Dreaming** (2026-04-25) — capability probes, dynamic tool advertising, idle-time memory dreaming
- **v2.5 Cutover Parity Verification** (2026-04-25) — verifier infrastructure, status/marketplace/manifest UX fixes
- **v2.4 OpenClaw ↔ ClawCode Continuous Sync** (2026-04-24) — pull-model rsync sync + cutover semantics
- **v2.3 Marketplace & Memory Activation** (2026-04-24) — ClawHub Marketplace, workspace-memory activation
- **v2.2 OpenClaw Parity & Polish** (2026-04-23) — effort mapping, skills migration, model picker, restart greeting

Full roadmaps + requirements + verification reports: [`.planning/milestones/`](./.planning/milestones/)

## License

Private repository. All rights reserved.
