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
- **Durable task store + state machine** — `~/.clawcode/manager/tasks.db` with enforced transitions, startup orphan reconciliation, crash recovery (v1.8)
- **Cross-agent RPC handoffs** — `delegate_task` MCP tool with async-ticket semantics, Zod schema validation, cycle detection (v1.8)
- **Trigger engine** — schedulers, webhooks, MySQL/inbox/calendar sources feed a unified dispatcher with 3-layer dedup + policy evaluator + watermark replay (v1.8)
- **Policy layer** — YAML DSL with hot-reload and audit trail; `clawcode policy dry-run` previews what a trigger will fire before you commit (v1.8)
- **Cross-agent trace walker** — `clawcode trace <id>` walks a request across agent boundaries (v1.8)
- **Persistent conversation memory** — every Discord exchange stored in per-agent SQLite with provenance + instruction-pattern detection; session boundaries tracked (v1.9)
- **Session-boundary summarization** — Haiku compresses each ended/crashed session into a standard MemoryEntry that auto-participates in search, decay, tier management, and knowledge graph linking (v1.9)
- **Resume auto-injection** — agents wake up with a structured brief of recent sessions in a dedicated `conversation_context` budget section, with gap-skip for short restarts (v1.9)
- **Conversation search + deep retrieval** — `memory_lookup` MCP tool accepts `scope="conversations"`/`"all"` + `page`; FTS5 raw-turn search + semantic summary search with tunable time-decay weighting and paginated results (v1.9)
- **OpenAI-compatible HTTP endpoint** — `POST /v1/chat/completions` (SSE streaming) + `GET /v1/models` on the daemon; every agent reachable from any OpenAI-compatible client (Python SDK, LangChain, LibreChat, curl) with bearer-key-per-session continuity and OpenAI↔Claude tool-use translation, with fork-based escalation and subagent-thread delegation available mid-turn (v2.0)
- **Browser automation MCP** — auto-injected Playwright-powered server; every agent can `browser_navigate` / `browser_screenshot` (vision-ready) / `browser_click` / `browser_fill` / `browser_extract` (Readability) / `browser_wait_for` against a real headless Chromium with per-agent persistent profile (v2.0)
- **Web search MCP** — auto-injected Brave (primary) / Exa (optional) backend; `web_search` + `web_fetch_url` (Readability-cleaned article text); intra-turn idempotent cache preventing double-charging on repeat queries (v2.0)
- **Image generation MCP** — auto-injected OpenAI Images / MiniMax / fal.ai backends; `image_generate` / `image_edit` / `image_variations` persist to workspace, deliver to Discord via `send_attachment`, spend surfaces in `clawcode costs` as a new category (v2.0)
- **Inter-agent messaging** through filesystem-based inboxes
- **Model escalation** — agents on Sonnet can escalate to Opus when they need it
- **Budget enforcement** — per-agent token limits with Discord alerts
- **Health monitoring** — context fill tracking, automatic zone alerts to Discord
- **Web dashboard** — real-time agent status via SSE + latency / prompt cache / tool-call / warm-path / task-graph panels
- **MCP tools auto-injected** — every agent gets `memory_lookup`, `spawn_subagent_thread`, `ask_advisor`, `delegate_task`, `send_message`, plus `browser_*`, `web_search` / `web_fetch_url`, and `image_generate` / `image_edit` / `image_variations` out of the box (v2.0)
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

Phase 70 (browser automation MCP) requires the Chromium browser binary. Run this once after the first `npm install`:

```bash
npx playwright install chromium --only-shell
# On a fresh Ubuntu/Debian box, also install system libs (one-time, needs sudo):
sudo npx playwright install-deps chromium
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
| `clawcode context-audit <agent>` | Per-section token budget audit (identity / soul / skills / history / summary / conversation_context) |
| `clawcode tasks list` | Show tasks in the durable task store (pending, running, completed, failed) (v1.8) |
| `clawcode tasks status <task_id>` | Inspect a task's full state, payload, and lifecycle history (v1.8) |
| `clawcode tasks retry <task_id>` | Retry a failed task from its last stable state (v1.8) |
| `clawcode triggers` | List active triggers (scheduler / webhook / MySQL / inbox / calendar) (v1.8) |
| `clawcode policy dry-run` | Preview which triggers a policy change would fire without committing (v1.8) |
| `clawcode trace <trace_id>` | Walk a request across agent boundaries with full span timings (v1.8) |
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

Four MCP servers are **auto-injected** for every agent — no configuration needed:

| Server | Condition | Tools Provided |
|--------|-----------|----------------|
| `clawcode` | Always | `memory_lookup`, `spawn_subagent_thread`, `ask_advisor`, `agent_status`, `send_message` |
| `1password` | When `OP_SERVICE_ACCOUNT_TOKEN` is set | Secure credential access via 1Password |
| `browser` | When `defaults.browser.enabled: true` (default) | `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_fill`, `browser_extract`, `browser_wait_for` |
| `search` | When `defaults.search.enabled: true` (default) | `web_search`, `web_fetch_url` |
| `image` | When `defaults.image.enabled: true` (default) | `image_generate`, `image_edit`, `image_variations` |

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

**Per-agent config** (v1.7) — sensible defaults, customize via `clawcode.yaml`:

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

## Proactive Agents + Handoffs (v1.8)

v1.8 turns agents from reactive responders into proactive actors. Every turn — whether it comes from Discord, a cron job, a webhook, a MySQL poll, or a cross-agent delegate — flows through a single dispatcher with durable state and cross-agent observability.

**TurnDispatcher** — the single chokepoint for all turn sources. Every turn carries an origin-prefixed `turnId` and `TurnOrigin` trace metadata so you can always trace a request back to what started it (Discord message, scheduler fire, webhook hit, cross-agent handoff).

**Task Store + State Machine** — durable `~/.clawcode/manager/tasks.db` with 15-field task rows, enforced state transitions (`pending → running → completed/failed`), startup orphan reconciliation (tasks running when the daemon crashed get re-routed on restart), and trigger_state CRUD.

**Cross-agent RPC handoffs** — the `delegate_task` MCP tool lets Agent A hand a task to Agent B and get a ticket back. Results propagate through the inbox when B completes. Zod schema validation on the handoff payload; cycle detection prevents A→B→A loops.

**Trigger engine** — pluggable sources (scheduler, webhook, inbox, MySQL, calendar) feed a common dispatcher. Three-layer dedup catches duplicate fires at the source, the policy layer, and the dispatcher. Watermark replay catches missed events when the daemon was down.

**Policy layer (YAML DSL + hot-reload + audit trail)** — `clawcode.yaml` policies like "every weekday at 9am, fire a morning-briefing trigger for the assistant agent" with dry-run preview (`clawcode policy dry-run`) and audit logs for every policy change.

**Observability** — `clawcode tasks list` / `status` / `retry`, `clawcode triggers`, `clawcode trace <id>` for cross-agent trace chain walking, and a dashboard task-graph panel showing live task state across all agents.

## Persistent Conversation Memory (v1.9)

v1.9 makes agents remember prior conversations. Discord exchanges are stored, summarized, auto-injected on restart, and deeply searchable — agents never wake up to a blank slate again.

**ConversationStore** — per-agent SQLite tables for `conversation_sessions` and `conversation_turns` with full provenance (`channel_id`, `discord_user_id`, `is_trusted_channel`, `discord_message_id`). Session lifecycle (start/end/crash) is tracked explicitly; turns are grouped by `session_id`. Extracted memories carry `source_turn_ids` linking them back to the specific turns they came from — full lineage queryable with a JOIN.

**Capture integration** — DiscordBridge fire-and-forget captures every exchange into the ConversationStore. Instruction-pattern detection (`potentially_directive` marker) flags prompt-injection attempts before they enter the persistent record — never blocks Discord delivery.

**Session-boundary summarization** — when a session ends (stop or crash), a Haiku LLM call from the daemon compresses turns into a structured summary (preferences, decisions, open threads, commitments). Stored as a standard MemoryEntry (`source="conversation"`, tagged `["session-summary", "session:{id}"]`) so it automatically participates in semantic search, relevance decay, tier management, and knowledge graph auto-linking. 10s timeout with raw-turn fallback; sessions < 3 turns skip summary entirely.

**Resume auto-injection** — agents wake up with the last N session summaries (default 3, configurable) rendered into a structured `## Recent Sessions` brief, injected into a dedicated `conversation_context` budget section (2000-token default, configurable) that lives in the assembler's mutable suffix (never pollutes the cached stable prefix). Adaptive gap-skip: restarts within 4 hours (configurable) skip injection entirely so crash recovery and config reloads don't waste token budget.

**Conversation search + deep retrieval** — the `memory_lookup` MCP tool now accepts `scope="memories"|"conversations"|"all"` (backward-compatible default preserves pre-v1.9 response shape) and `page` parameters. `scope="conversations"` hits semantic search over session summaries; `scope="all"` merges semantic + FTS5 full-text search over raw turns with session-summary-prefers-raw-turn dedup. Results are paginated at 10 per page, time-decay-weighted (tunable half-life via `conversation.retrievalHalfLifeDays`), and carry `origin` tags (`memory` / `conversation-turn` / `session-summary`) so the agent can reason about provenance.

**Per-agent config** (v1.9) — customize via `clawcode.yaml`:

```yaml
agents:
  - name: assistant
    memory:
      conversation:
        enabled: true
        turnRetentionDays: 90                  # default 90
        resumeSessionCount: 3                  # recent sessions in brief (default 3)
        resumeGapThresholdHours: 4             # skip inject if gap < threshold (default 4)
        conversationContextBudget: 2000        # tokens for brief (default 2000)
        retrievalHalfLifeDays: 14              # decay weighting half-life (default 14)
```

## OpenAI-Compatible Endpoint (v2.0)

Every ClawCode agent is reachable from any OpenAI-compatible client — the daemon runs a `/v1/chat/completions` + `/v1/models` HTTP surface alongside the Discord bridge. Point the OpenAI Python SDK, LangChain, LibreChat, or any custom app at `http://clawdy:3101/v1` with a bearer key and treat an agent as a model. Each bearer key gets its own persistent conversation (OPENAI-05) — different keys against the same agent are fully isolated.

### Quick start

```bash
# 1. Start the daemon (OpenAI endpoint enabled by default on port 3101).
clawcode start-all

# 2. Mint a bearer key for an agent — printed ONCE, stored as SHA-256 hash.
clawcode openai-key create clawdy --label my-integration

# Output:
#   Key:     ck_clawdy_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
#   Agent:   clawdy
#   Label:   my-integration
#   Expires: never
#   Hash:    ab12cd34...
#
#   Store this key securely — it will not be shown again.

# 3. Call the endpoint from Python.
python - <<'PY'
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:3101/v1", api_key="ck_clawdy_XXXXXXXX...")
resp = client.chat.completions.create(
    model="clawdy",
    messages=[{"role": "user", "content": "hello"}],
)
print(resp.choices[0].message.content)
PY
```

### curl

```bash
curl http://127.0.0.1:3101/v1/models \
  -H "Authorization: Bearer ck_clawdy_XXXX"

curl http://127.0.0.1:3101/v1/chat/completions \
  -H "Authorization: Bearer ck_clawdy_XXXX" \
  -H "Content-Type: application/json" \
  -d '{"model":"clawdy","messages":[{"role":"user","content":"hello"}]}'
```

### Integration cookbook

- **OpenClaw** — set the `openai:default` provider `baseUrl` to `http://clawdy:3101/v1` and drop the ClawCode bearer key into `apiKey`. Agent names become model ids.
- **LibreChat** — same pattern: add an OpenAI-compatible endpoint with `baseUrl: http://clawdy:3101/v1` and the bearer key. Each agent appears as a selectable model in the UI.
- **LangChain / LlamaIndex** — any `OpenAI(base_url=..., api_key=...)` constructor works unchanged.

### Key management

```bash
clawcode openai-key create clawdy --label ci-bot --expires 365d
clawcode openai-key create --all --label openclaw-all   # multi-agent key (P51-MULTI-AGENT-KEY)
clawcode openai-key list                                # table view, never shows plaintext
clawcode openai-key revoke ci-bot                       # by label
clawcode openai-key revoke ab12cd34                     # by 8+ hex prefix of the hash
```

Two key shapes are supported:

- **Pinned** (`create <agent>`) — scope is `agent:<name>`; accepted only on that single agent. Legacy, back-compat.
- **Multi-agent** (`create --all`) — scope is `all`; accepted on ANY configured agent as the `model` field of the request. One bearer, whole fleet. Each `(key_hash, agent_name)` pair carries its own persistent conversation (`api_key_sessions_v2` composite-PK), so the same `--all` key chatting with `clawdy` and `fin-test` maintains two independent session histories.

### Spawning subagents from OpenAI-endpoint turns

Every ClawCode agent that has the `subagent-thread` skill loaded exposes the `spawn_subagent_thread` MCP tool to itself. When a caller asks the agent (via the OpenAI endpoint) to delegate work — especially with a model upgrade like "spawn an opus agent" — the agent can call the tool from within the turn, wait for the subagent's response, and summarize back to the OpenAI client.

Example:

```bash
curl http://clawdy:3101/v1/chat/completions \
  -H "Authorization: Bearer ck_fin-te_XXXXXXXXXXXXXXXXXXXXXXXXXXXX" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fin-test",
    "messages": [{
      "role": "user",
      "content": "Spawn an opus subagent to deeply research the S&P 500 sector rotation since Jan 2026 and summarize in 3 bullets."
    }]
  }'
```

The agent:

1. Recognizes the delegation intent.
2. Calls `spawn_subagent_thread` with `model: "opus"` and the research prompt.
3. Waits for the subagent's completion (streamed through the daemon's trace collector — turn lifecycle is recorded under the OpenAI-API turn origin).
4. Summarizes the subagent's output back to the OpenAI client in the final response.

Fork-based escalation (`"this needs opus"` keyword trigger + error-threshold auto-escalation) also works unchanged across OpenAI-endpoint turns — the parent's persistent SDK query survives the fork spawn (Phase 73 invariant; pinned by `escalation.test.ts`).

For the Discord-initiated version of this flow, see the `subagent-thread` skill docs — identical tool, same underlying session, different caller path.

### Environment

- `CLAWCODE_OPENAI_HOST` — override listener bind (default `0.0.0.0`).
- `CLAWCODE_OPENAI_PORT` — override listener port (default `3101`).
- `CLAWCODE_OPENAI_LOG_DIR` — override request-log directory (default `~/.clawcode/manager/`).
- `CLAWCODE_OPENAI_LOG_BODIES` — set to `true` to capture full message bodies in the request log. **Default off** — prompts may contain PII. Leave off unless you're debugging a specific request.
- Disable entirely via `defaults.openai.enabled: false` in `clawcode.yaml`.

Port conflicts are non-fatal: the daemon logs a warning and continues without the endpoint.

### Request logging

Every request to `/v1/chat/completions` and `/v1/models` is appended as one JSON line to `~/.clawcode/manager/openai-requests-YYYY-MM-DD.jsonl` (UTC date — single rollover boundary across operator timezones).

```bash
clawcode openai-log tail --agent clawdy --since 1h        # padded-column table
clawcode openai-log tail --since 24h --json               # raw JSONL for jq
clawcode openai-log tail --since 48h                      # reads today + yesterday's files
```

Redaction rules baked in:

- `bearer_key_prefix` is only the **first 12 chars** of the incoming bearer — never more. The full key never lands in the log.
- `messages[]` is **stripped by default**. Set `CLAWCODE_OPENAI_LOG_BODIES=true` to capture bodies verbatim. **Warning:** prompts often contain PII / tool-result text / secrets in tool args. Treat a logs directory with `CLAWCODE_OPENAI_LOG_BODIES=true` as a secrets directory — lock down perms and rotate aggressively.

Fields captured per record: `request_id`, `timestamp_iso`, `method`, `path`, `agent`, `model`, `stream`, `status_code`, `ttfb_ms` (stream only), `total_ms`, `bearer_key_prefix`, `messages_count`, `response_bytes`, `error_type`, `error_code`, `finish_reason`. Writes are synchronous + fail-silent (fs errors rate-limited to 1 warn/min so `/v1/chat/completions` is never blocked by an observability feed).

### End-to-end smoke

```bash
pip install openai
python scripts/openai-smoke.py --create-key
```

Runs OPENAI-01 (non-stream), OPENAI-02 (stream), OPENAI-03 (models list), and OPENAI-05 (per-bearer session continuity) against a live daemon. Exits 0 on all-pass.

### Scope and limits (v2.0)

- One bearer key → one persistent session with the pinned agent.
- No rate limiting or billing metering (v2.1 territory).
- No `/v1/embeddings` or legacy `/v1/completions` (out of scope).
- Admin key-management is CLI only (no admin API).

## Browser Automation (Phase 70)

Every agent gets a full headless Chromium browser via the auto-injected `browser` MCP server (the `clawcode browser-mcp` stdio subprocess — a thin translator to the daemon's shared Chromium singleton). Six tools cover the common web-automation surface; cookies, localStorage, and IndexedDB persist across daemon restarts via a per-agent `storageState` on disk.

### First-run install

```bash
# One-time (needs network — downloads ~200MB Chromium shell):
npx playwright install chromium --only-shell

# On a fresh Ubuntu/Debian box (needs sudo, installs libnss3/libatk/etc):
sudo npx playwright install-deps chromium
```

The daemon hard-fails at startup if the Chromium install is missing — the error message names the exact install command.

### Tools

| Tool | Args | Returns |
|------|------|---------|
| `browser_navigate` | `url: string, waitUntil?: "load"\|"domcontentloaded"\|"networkidle", timeoutMs?: number` | `{ url, title, status }` |
| `browser_screenshot` | `fullPage?: boolean, savePath?: string` | `{ path, bytes, inlineBase64? }` (base64 only when under `maxScreenshotInlineBytes`) |
| `browser_click` | `selector: string, timeoutMs?: number` | `{ clicked: true, selector, newUrl? }` |
| `browser_fill` | `selector: string, value: string, timeoutMs?: number` | `{ filled: true, selector }` |
| `browser_extract` | `mode: "selector"\|"readability", selector?: string` | `{ text, html?, metadata? }` (readability returns title, byline, publishedTime, etc.) |
| `browser_wait_for` | `selector?: string, url?: string, timeoutMs?: number` | `{ matched: boolean, elapsedMs }` (structured timeout — never throws) |

Agent steering baked into the tool descriptions:

- `browser_navigate` — avoids `networkidle` as default (hangs on SPAs).
- `browser_click / fill / wait_for` — prefer `getByRole() / getByTestId() / getByText()` selectors over raw CSS.
- `browser_screenshot` — path-based workflow for repeats (avoid filling conversation history with base64 payloads).

### Opt-out

Set `defaults.browser.enabled: false` in `clawcode.yaml` to disable the browser MCP globally — no Chromium process, no auto-inject. Agents can also override the auto-inject by listing their own `browser` entry in `mcpServers:`.

### End-to-end smoke

```bash
# daemon must be running
node scripts/browser-smoke.mjs
# or: node scripts/browser-smoke.mjs clawdy https://example.com
```

The smoke drives `browser_navigate → browser_screenshot → browser_extract(readability)` against https://example.com and asserts the extracted text contains "Example Domain". Exits 0 on success.

### Example (via OpenAI SDK — Phase 69 endpoint)

Because MCP servers are injected at agent-session creation, you can drive the browser through the Phase-69 OpenAI-compatible endpoint — no Discord round-trip needed:

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:3101/v1", api_key="ck_clawdy_XXXX")
response = client.chat.completions.create(
    model="clawdy",
    messages=[{"role": "user", "content": "Navigate to https://example.com, screenshot it, and summarize the page."}],
)
print(response.choices[0].message.content)
```

The agent receives the `browser_*` tools in its system prompt and will plan, navigate, screenshot, and extract — all within a single turn.

### Caveat

Chromium adds ~200-400MB RSS to the daemon baseline. Measure at scale with:

```bash
ps -o rss -p $(pgrep -f clawcoded)
```

v2.1 may revisit shared-Chromium vs. per-agent Chromium if the N-agent footprint becomes an issue.

## Web Search (Phase 71)

Every agent gets live web search + clean article fetching via the auto-injected `search` MCP server (the `clawcode search-mcp` stdio subprocess — a thin translator to the daemon's shared Brave + Exa clients). Two tools cover the common research surface; duplicate calls within a single Turn short-circuit through the v1.7 intra-turn idempotent tool-cache.

### Setup

Set `BRAVE_API_KEY` in the environment before starting the daemon:

```bash
# In clawcode.yaml or systemd EnvironmentFile:
BRAVE_API_KEY=your-brave-subscription-token
```

Switch to Exa with `defaults.search.backend: "exa"` and set `EXA_API_KEY` instead. Keys are read lazily on the first search call — a missing key surfaces as `invalid_argument` rather than a daemon-boot crash.

### Tools

| Tool | Args | Returns |
|------|------|---------|
| `web_search` | `query: string, numResults?: number (default 20, max 20)` | `{ results: [{ title, url, snippet, publishedDate? }], total, provider, query }` |
| `web_fetch_url` | `url: string, mode?: "readability" \| "raw" (default "readability"), maxBytes?: number (default 1 MiB)` | `{ url, title, byline, publishedDate, text, html?, wordCount, mode }` |

- `web_search` — ranked result list; clamps `numResults` to `config.maxResults` (default 20). Backend switch via `defaults.search.backend: "brave" \| "exa"`.
- `web_fetch_url` — Mozilla Readability extraction by default (clean article text + metadata); `mode: "raw"` returns stripped HTML text for non-article pages. Hard 1 MiB size cap, 30s timeout.

Error taxonomy (never throws — always `{ error: { type, message, ... } }`): `network`, `rate_limit` (with `retryAfter`), `invalid_url`, `size_limit`, `extraction_failed`, `invalid_argument`, `internal`.

### Intra-Turn Cache

Both tools are on the v1.7 idempotent-tool whitelist (alongside `memory_lookup`, `search_documents`, etc.). Duplicate calls with identical args within a single Turn return the prior result with `cached: true` in the trace. Cross-turn calls always hit the network fresh.

### Opt-out

Set `defaults.search.enabled: false` in `clawcode.yaml` to disable the search MCP globally — no auto-inject, agents will not see the tools. Agents can also override the auto-inject by listing their own `search` entry in `mcpServers:`.

### End-to-end smoke

```bash
# daemon must be running with BRAVE_API_KEY set
node scripts/search-smoke.mjs
# or: node scripts/search-smoke.mjs clawdy "anthropic claude api"
```

The smoke drives `web_search → web_fetch_url → web_search (repeat)` against a live daemon. Exits 0 on success, 2 on daemon-not-running, 1 on assertion failure.

### Known limitations

- Brave API rate limits vary by subscription tier; 429 surfaces as a structured `rate_limit` error with `retryAfter` seconds extracted from the `retry-after` header.
- No `robots.txt` enforcement — agents are expected to respect site ToS themselves. Blanket enforcement would be too aggressive for an assistant tool.
- Image / news / video sub-APIs are deferred to v2.x (text web search only for v2.0).
- Alternate backends (Google CSE, SerpAPI, DuckDuckGo) are deferred to v2.x.

## Image Generation (Phase 72)

Every agent gets text-to-image generation, image editing, and image variations via the auto-injected `image` MCP server (the `clawcode image-mcp` stdio subprocess — a thin translator to the daemon's shared OpenAI / MiniMax / fal.ai image clients). Output is written atomically to the agent workspace so the returned path can be handed directly to the existing `send_attachment` tool for Discord delivery — no new delivery surface is introduced.

### Setup

Set at minimum `OPENAI_API_KEY` in the environment before starting the daemon (OpenAI is the default backend). Alternate backends have their own keys:

```bash
# In clawcode.yaml or systemd EnvironmentFile:
OPENAI_API_KEY=sk-proj-...          # default backend
MINIMAX_API_KEY=...                  # optional — when defaults.image.backend="minimax"
FAL_API_KEY=...                      # optional — when defaults.image.backend="fal"
```

All three keys are read lazily on the first tool call — a missing key surfaces as `invalid_input` rather than a daemon-boot crash, so the daemon stays bootable on a dev box with only one backend configured.

### Tools

| Tool | Args | Returns | Backends |
|------|------|---------|----------|
| `image_generate` | `prompt: string, size?: "256x256"\|"512x512"\|"1024x1024"\|"1024x1792"\|"1792x1024" (default "1024x1024"), style?, backend?, model?, n?: 1-4 (default 1)` | `{ images: [{ path, url?, size, backend, model, prompt, cost_cents }], total_cost_cents }` | openai, minimax, fal |
| `image_edit` | `imagePath: string, prompt: string, backend?, maskPath?, model?, size?` | `{ images: [...], total_cost_cents }` | openai, fal — MiniMax returns `unsupported_operation` |
| `image_variations` | `imagePath: string, n?: 1-4 (default 1), backend?, model?, size?` | `{ images: [...], total_cost_cents }` | openai — MiniMax + fal return `unsupported_operation` |

Backend support matrix:

| Backend | Default model | Generate | Edit | Variations |
|---------|---------------|----------|------|------------|
| OpenAI | `gpt-image-1` (alt: `dall-e-3`, `dall-e-2`) | yes | yes | yes |
| MiniMax | `image-01` | yes | no | no |
| fal.ai | `fal-ai/flux-pro` (alt: `fal-ai/flux-schnell`, `fal-ai/flux/dev/image-to-image`) | yes | yes (image-to-image) | no |

Backends where an op is unsupported return a helpful `unsupported_operation` error naming the backends that DO support it — the agent can self-route without asking:

```
MiniMax does not support image_edit. Backends with edit support: openai, fal.
```

Error taxonomy (never throws — always `{ error: { type, message, backend?, status? } }`): `rate_limit`, `invalid_input`, `backend_unavailable`, `unsupported_operation`, `content_policy`, `network`, `size_limit`, `internal`.

### Discord delivery

Generated images are written atomically to `<agent-workspace>/generated-images/<timestamp>-<id>.png` (configurable via `defaults.image.workspaceSubdir`). Agents pass the returned `path` to the existing `send_attachment` MCP tool:

```
# Clawdy in a Discord channel:
User> generate a cat in a tophat and post it
# Clawdy calls image_generate → receives {path, ...}
# Clawdy calls send_attachment(channel, path) → Discord upload
```

No new Discord delivery surface — pure composition of existing tools.

### Cost tracking

Every successful generate / edit / variations call records a row in the per-agent `usage_events` SQLite store with `category="image"`, composite model `${backend}:${model}`, `count`, and `cost_cents` from the rate-card table in `src/image/costs.ts`. View with `clawcode costs` — image rows are distinct from token rows via the new Category column:

```
$ clawcode costs --period today
Agent     Category  Model                     Tokens In  Tokens Out  Cost (USD)
--------  --------  ------------------------  ---------  ----------  ----------
clawdy    tokens    haiku                     150,000    25,000      $0.0688
clawdy    image     openai:gpt-image-1        0          0           $0.1200
clawdy    image     fal:fal-ai/flux-pro       0          0           $0.0500
                                                                     ----------
TOTAL                                         150,000    25,000      $0.2388
```

Pricing is best-effort per published rate cards (OpenAI/MiniMax/fal docs); override sources are listed in `src/image/costs.ts`.

### Intra-turn cache

`image_generate`, `image_edit`, and `image_variations` are deliberately **NOT** on the v1.7 idempotent-tool whitelist. Image generation is non-deterministic — the same prompt yields different images each call — so caching would be a correctness bug. Each call hits network fresh even within a single Turn.

### Opt-out

Set `defaults.image.enabled: false` in `clawcode.yaml` to disable the image MCP globally — no auto-inject, agents will not see the tools. Agents can also override the auto-inject by listing their own `image` entry in `mcpServers:`.

### End-to-end smoke

```bash
# daemon must be running with OPENAI_API_KEY (or MINIMAX/FAL_API_KEY) set
node scripts/image-smoke.mjs
# or: node scripts/image-smoke.mjs clawdy "a cat in a tophat"
```

Expected output on success:

```
Phase 72 image smoke — agent=clawdy prompt="a cat in a tophat" socket=/home/user/.clawcode/manager/clawcode.sock
[1/1] image_generate — backend=openai, model=gpt-image-1 (8341ms)
       path: /home/user/.clawcode/agents/clawdy/generated-images/1734...-abc.png
SMOKE PASS — image written to <path> (284521 bytes, cost 4¢)
```

Exits 0 on success, 2 on daemon-not-running, 1 on assertion failure (missing key, network error, empty file, etc.).

### Known limitations

- OpenAI DALL-E 2 / 3 / gpt-image-1 are the only models covered by the built-in pricing table; custom models return `cost_cents: 0` (generation succeeds, cost row is just under-reported).
- fal.ai returns hosted URLs with ~1h expiry — we fetch bytes immediately and persist to disk; the hosted URL on the returned metadata is for logging only.
- Stable Diffusion, Midjourney, video generation, inpainting with precise masks — all deferred to v2.x.

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
  manager/      # Session lifecycle, daemon, recovery, escalation, TurnDispatcher (v1.8)
  discord/      # Bridge, routing, threads, webhooks, streaming, capture (v1.9)
  memory/       # SQLite store, embeddings, tiers, consolidation, ConversationStore + search + summarizer + brief (v1.9)
  heartbeat/    # Health checks, context zones, auto-maintenance
  scheduler/    # Cron-based task execution
  ipc/          # Unix socket JSON-RPC server/client
  mcp/          # MCP server for agent-to-agent tools (memory_lookup, delegate_task, send_message, etc.)
  security/     # Channel ACLs, allowlists, approval log, instruction-pattern detector (v1.9)
  collaboration/# Inter-agent inbox messaging
  usage/        # Token tracking, budgets, cost estimation, daily Discord summary
  skills/       # Skill discovery, linking, installation
  bootstrap/    # First-run agent initialization
  dashboard/    # Web UI with SSE real-time updates + latency/cache/tools/warm-path/task-graph panels
  performance/  # TraceStore, TraceCollector, SLOs, percentiles, token counter (v1.7)
  benchmarks/   # bench harness: runner, baseline, thresholds, keep-alive (v1.7)
  tasks/        # Durable task store, state machine, handoff schema, payload store, reconciler (v1.8)
  triggers/     # Trigger engine, 3-layer dedup, policy differ (v1.8)
  documents/    # RAG document ingestion + chunking + KNN search (v1.6)
  shared/       # Logger, errors, types, canonicalStringify
scripts/
  install.sh    # Ubuntu deployment installer
```

## License

Private repository. All rights reserved.
