# Architecture Research

**Domain:** Multi-agent Claude Code orchestration system
**Researched:** 2026-04-08
**Confidence:** HIGH

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CONTROL PLANE                                │
│                                                                     │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐   │
│  │ Agent Manager  │  │ Config Store  │  │ Health Monitor        │   │
│  │ (TypeScript)   │  │ (YAML/JSON)   │  │ (Heartbeat Framework) │   │
│  └──────┬────────┘  └───────┬───────┘  └───────────┬───────────┘   │
│         │                   │                       │               │
├─────────┴───────────────────┴───────────────────────┴───────────────┤
│                        AGENT RUNTIME LAYER                          │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Agent A  │  │ Agent B  │  │ Agent C  │  │ Admin    │           │
│  │ (Claude  │  │ (Claude  │  │ (Claude  │  │ Agent    │           │
│  │  Code    │  │  Code    │  │  Code    │  │ (priv.)  │           │
│  │  SDK)    │  │  SDK)    │  │  SDK)    │  │          │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │              │              │                 │
├───────┴──────────────┴──────────────┴──────────────┴────────────────┤
│                        COMMUNICATION LAYER                          │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐    │
│  │ Discord Router   │  │ IPC Bus          │  │ Mailbox/Queue  │    │
│  │ (Channel Binding)│  │ (File + Events)  │  │ (Agent-Agent)  │    │
│  └──────────────────┘  └──────────────────┘  └────────────────┘    │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        PERSISTENCE LAYER                            │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │ Memory Store │  │ Session      │  │ Cron/Sched   │             │
│  │ (SQLite +    │  │ Store        │  │ Store        │             │
│  │  Markdown)   │  │ (Claude SDK) │  │ (JSON/SQLite)│             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Agent Manager | Start/stop/restart agent processes, boot from config, monitor health | TypeScript process using Claude Agent SDK to spawn and manage sessions |
| Config Store | Define all agents, their workspaces, channels, models, skills | YAML or JSON files in a central config directory |
| Health Monitor | Periodic heartbeat checks, auto-restart on failure, resource monitoring | Heartbeat loop in the manager process polling agent liveness |
| Agent Runtime | Individual Claude Code sessions with identity, workspace, memory | Claude Agent SDK V2 sessions (`createSession`/`resumeSession`) |
| Admin Agent | Privileged agent with cross-workspace access and management tools | A Claude Code session with MCP tools exposing other agents' state |
| Discord Router | Route Discord messages to the correct agent based on channel binding | Message dispatch layer mapping channel IDs to agent session IDs |
| IPC Bus | Manager-to-agent and agent-to-agent signaling | File-based message passing (JSON files in shared directory) + filesystem watchers |
| Mailbox/Queue | Async inter-agent messages for cross-agent communication | Per-agent inbox directories or SQLite message queue |
| Memory Store | Per-agent tiered memory (hot/warm/cold) with semantic search | SQLite databases per agent + structured markdown logs |
| Session Store | Claude Code session persistence and resumption | Built-in Claude Agent SDK session management |
| Cron/Scheduler | Scheduled task execution within agent sessions | JSON job definitions with cron expressions, executed by manager |

## Recommended Project Structure

```
src/
├── manager/                # Agent Manager (control plane)
│   ├── manager.ts          # Main manager process entry point
│   ├── lifecycle.ts        # Agent start/stop/restart logic
│   ├── health.ts           # Heartbeat and health monitoring
│   └── boot.ts             # Config-driven agent bootstrapping
├── agent/                  # Agent runtime infrastructure
│   ├── runtime.ts          # Agent session wrapper around Claude SDK
│   ├── identity.ts         # SOUL.md / IDENTITY.md loader
│   ├── workspace.ts        # Per-agent workspace directory management
│   └── hooks.ts            # Agent lifecycle hooks (PreToolUse, etc.)
├── discord/                # Discord integration layer
│   ├── router.ts           # Channel-to-agent message routing
│   ├── bindings.ts         # Channel/thread binding management
│   └── webhook.ts          # Thread creation and webhook management
├── memory/                 # Memory subsystem
│   ├── store.ts            # SQLite memory store operations
│   ├── tiers.ts            # Hot/warm/cold tier management
│   ├── consolidation.ts    # Daily/weekly/monthly digest generation
│   ├── search.ts           # Semantic search over memories
│   └── decay.ts            # Relevance decay and deduplication
├── ipc/                    # Inter-process communication
│   ├── bus.ts              # File-based message bus
│   ├── mailbox.ts          # Per-agent message inbox
│   └── protocol.ts         # Message type definitions
├── scheduler/              # Cron and scheduled tasks
│   ├── scheduler.ts        # Job runner and scheduling engine
│   ├── jobs.ts             # Job definition and parsing
│   └── store.ts            # Job state persistence
├── config/                 # Configuration management
│   ├── schema.ts           # Config validation schema
│   ├── loader.ts           # Config file loading
│   └── defaults.ts         # Default values
├── admin/                  # Admin agent capabilities
│   ├── tools.ts            # MCP tools for cross-agent management
│   ├── dashboard.ts        # Status aggregation
│   └── commands.ts         # Admin command definitions
└── shared/                 # Shared utilities
    ├── types.ts            # Shared type definitions
    ├── errors.ts           # Error types and handling
    └── logger.ts           # Structured logging
```

### Structure Rationale

- **manager/:** Isolated control plane. The manager is the only component that spawns and kills agent processes. Clean separation means agents never manage their own lifecycle.
- **agent/:** Runtime infrastructure that wraps the Claude Agent SDK. Each agent is a session with identity files, workspace paths, and hooks. This layer does NOT contain agent logic (that's in CLAUDE.md/SOUL.md files).
- **discord/:** Thin routing layer. The existing Discord plugin handles actual Discord communication. This layer only maps channels to agents and routes messages.
- **memory/:** Self-contained memory subsystem. Operates independently of agent runtime. Can be tested and evolved without touching agent code.
- **ipc/:** Explicit communication layer. File-based IPC is chosen over sockets because Claude Code sessions already operate on the filesystem and it provides natural persistence/debugging.
- **scheduler/:** Extracted from OpenClaw's cron system. Runs in the manager process, dispatches messages to agent sessions.

## Architectural Patterns

### Pattern 1: SDK-Native Agent Sessions

**What:** Each agent is a Claude Agent SDK V2 session (`unstable_v2_createSession`), not a raw CLI process. The manager creates sessions programmatically, sends messages via `session.send()`, and streams responses via `session.stream()`.

**When to use:** Always. This is the primary agent runtime pattern.

**Trade-offs:**
- Pro: Native session management, resume capability, structured message types, tool approval hooks
- Pro: No shell process management (child_process.spawn) complexity
- Pro: Multi-turn conversations are first-class
- Con: V2 API is still unstable preview (may change)
- Con: Each session consumes API tokens even when idle (context reloading on resume)

**Example:**
```typescript
import { unstable_v2_createSession, unstable_v2_resumeSession } from "@anthropic-ai/claude-agent-sdk";

// Boot an agent from config
async function bootAgent(config: AgentConfig): Promise<ManagedAgent> {
  const session = unstable_v2_createSession({
    model: config.model ?? "sonnet",
    cwd: config.workspacePath,
    settingSources: ["user", "project"],
    allowedTools: config.allowedTools ?? ["Read", "Edit", "Bash", "Glob", "Grep", "Agent"],
    systemPrompt: buildSystemPrompt(config),
    agents: config.subagents,
  });

  return {
    id: config.id,
    session,
    sessionId: undefined, // captured from first message
    status: "booting",
  };
}

// Resume a previously running agent
async function resumeAgent(config: AgentConfig, sessionId: string): Promise<ManagedAgent> {
  const session = unstable_v2_resumeSession(sessionId, {
    model: config.model ?? "sonnet",
    cwd: config.workspacePath,
    settingSources: ["user", "project"],
  });

  return {
    id: config.id,
    session,
    sessionId,
    status: "running",
  };
}
```

### Pattern 2: Manager as Supervisor Process

**What:** A single long-running TypeScript process acts as the supervisor. It reads config, boots agents, monitors health, handles restarts, and provides the admin interface. It does NOT use Claude Code itself -- it is pure TypeScript orchestration code.

**When to use:** For the control plane. The manager is deterministic code, not an AI agent.

**Trade-offs:**
- Pro: Deterministic behavior -- restart logic, health checks, and scheduling don't depend on LLM reasoning
- Pro: Lower cost -- no API tokens for management operations
- Pro: Can run as a systemd service or pm2-managed process
- Con: Requires writing and maintaining TypeScript code for all management operations
- Con: The admin agent (which IS an AI) needs a bridge to invoke manager functions

**Example:**
```typescript
class AgentManager {
  private agents: Map<string, ManagedAgent> = new Map();
  private config: SystemConfig;
  private healthInterval: NodeJS.Timer;

  async boot(): Promise<void> {
    this.config = await loadConfig();
    for (const agentConfig of this.config.agents) {
      const savedSessionId = await this.loadSessionId(agentConfig.id);
      const agent = savedSessionId
        ? await resumeAgent(agentConfig, savedSessionId)
        : await bootAgent(agentConfig);
      this.agents.set(agentConfig.id, agent);
    }
    this.healthInterval = setInterval(() => this.checkHealth(), 30_000);
  }

  async restart(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.session.close();
      const config = this.config.agents.find(a => a.id === agentId);
      const newAgent = await bootAgent(config);
      this.agents.set(agentId, newAgent);
    }
  }
}
```

### Pattern 3: File-Based IPC with Filesystem Watchers

**What:** Inter-agent and manager-to-agent communication uses JSON message files dropped into per-agent inbox directories. A filesystem watcher (chokidar or fs.watch) detects new messages and triggers processing.

**When to use:** For cross-agent communication and manager commands. NOT for Discord message routing (that goes through the Discord plugin directly).

**Trade-offs:**
- Pro: Naturally persistent -- messages survive process crashes
- Pro: Debuggable -- messages are readable JSON files
- Pro: No additional infrastructure (no Redis, no message broker)
- Pro: Works with Claude Code's file-centric architecture
- Con: Filesystem watchers can have platform-specific quirks
- Con: Higher latency than in-memory channels (~10-50ms)
- Con: Need to handle cleanup of processed messages

**Example:**
```typescript
// Message structure
interface AgentMessage {
  id: string;
  from: string;       // sender agent ID
  to: string;         // recipient agent ID
  type: "text" | "command" | "query" | "response";
  payload: unknown;
  timestamp: number;
  ttl?: number;       // optional expiry in ms
}

// Each agent has: ~/.clawcode/ipc/{agentId}/inbox/
// Manager writes message file, agent's watcher picks it up
```

### Pattern 4: Tiered Memory Architecture

**What:** Each agent's memory operates across three tiers with automatic promotion/demotion based on access patterns and time decay.

**When to use:** For all persistent agent memory.

**Trade-offs:**
- Pro: Keeps context window lean by only loading hot memories
- Pro: Warm tier provides fast semantic search without context overhead
- Pro: Cold tier preserves everything for potential retrieval
- Con: Consolidation logic adds complexity
- Con: Semantic search quality depends on embedding approach

```
HOT (Active Context)
├── Current conversation context
├── Recently accessed memories (last 24h)
├── Agent identity files (SOUL.md, IDENTITY.md)
└── Loaded into system prompt / CLAUDE.md

WARM (Searchable)
├── SQLite with full-text search
├── Weekly/monthly digests
├── Indexed by topic, entity, date
└── Retrieved on-demand via memory search tool

COLD (Archived)
├── Raw daily markdown logs
├── Old conversation transcripts
├── Compressed/deduplicated
└── Retrieved only by explicit date/topic query
```

### Pattern 5: Discord Plugin Delegation (NOT Custom Bot)

**What:** The existing Claude Code Discord plugin (`plugin:discord:discord`) handles all Discord communication. ClawCode adds a thin routing layer that maps channel IDs to agent IDs, forwarding incoming messages to the correct agent session.

**When to use:** For all Discord integration.

**Trade-offs:**
- Pro: Leverages battle-tested Discord integration
- Pro: No need to build Discord.js bot from scratch
- Pro: Thread management, webhooks, reactions already work
- Con: Constrained by plugin's API surface
- Con: Single Discord bot token shared across all agents (agents differentiate by channel, not by bot identity)

## Data Flow

### Discord Message Flow (Inbound)

```
Discord Channel Message
    |
    v
Discord Plugin (plugin:discord:discord)
    |
    v
Discord Router (channel ID lookup)
    |
    v
Agent Session (via session.send())
    |
    v
Claude processes message with agent's identity/memory
    |
    v
Response → Discord Plugin → reply(chat_id, text)
```

### Agent Boot Flow

```
Manager Process starts
    |
    v
Load Config (agents.yaml)
    |
    v
For each agent definition:
    |
    ├── Create workspace directory if missing
    ├── Write/update SOUL.md, IDENTITY.md
    ├── Check for saved session ID
    |       |
    |       ├── Found → resumeSession(sessionId)
    |       └── Not found → createSession(options)
    |
    ├── Register Discord channel bindings
    ├── Start health monitoring
    └── Agent ready
```

### Memory Consolidation Flow

```
Agent conversation turn
    |
    v
Hot Memory (in-context facts extracted)
    |
    v
Daily: Flush hot → daily markdown log
    |
    v
Weekly: Summarize daily logs → weekly digest (warm tier)
    |
    v
Monthly: Summarize weekly digests → monthly digest (warm tier)
    |
    v
Quarterly+: Move old warm entries → cold archive
```

### Inter-Agent Communication Flow

```
Agent A wants to message Agent B
    |
    v
Agent A writes JSON message → ~/.clawcode/ipc/agent-b/inbox/{msg-id}.json
    |
    v
Agent B's IPC watcher detects new file
    |
    v
Agent B's session receives message via session.send()
    |
    v
Agent B processes and optionally replies → Agent A's inbox
```

### Admin Agent Flow

```
Admin receives command (via Discord or direct)
    |
    v
Admin invokes MCP tool (e.g., list-agents, restart-agent)
    |
    v
MCP tool calls Manager API (HTTP or IPC)
    |
    v
Manager executes command
    |
    v
Result returned to Admin → relayed to user
```

### Key Data Flows Summary

1. **Discord inbound:** Discord Plugin → Router → Agent Session → Claude SDK → Response → Discord Plugin
2. **Agent lifecycle:** Manager → Config → SDK createSession/resumeSession → Health Monitor loop
3. **Memory cycle:** Conversation → Hot extraction → Daily flush → Weekly/Monthly consolidation → Cold archive
4. **Cross-agent:** Agent A → IPC filesystem → Agent B inbox → Agent B session
5. **Admin operations:** Admin Agent → MCP tools → Manager API → Agent lifecycle commands

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 agents | Single manager process, all agents in one machine, file-based IPC. This is the target for v1. |
| 5-15 agents | Memory pressure becomes real. Implement aggressive context compaction, stagger agent boot, set per-agent token budgets. Consider SQLite WAL mode for concurrent memory access. |
| 15-30 agents | Need process-level resource limits (CPU/memory caps per agent). Consider splitting agents across multiple machines with a shared config store. Replace file IPC with a proper message broker. |
| 30+ agents | Beyond scope. Would require a distributed architecture with load balancing, which is not the goal of this project. |

### Scaling Priorities

1. **First bottleneck: Context window cost.** Each active agent consumes API tokens. Agents idle for long periods should be "parked" (session saved, not resumed until needed). The manager should track idle time and park inactive agents.
2. **Second bottleneck: Memory/CPU on host.** Each Claude Code SDK session is a Node.js process. 15+ concurrent sessions will stress a single machine. Resource limits and staggered operations matter.
3. **Third bottleneck: SQLite contention.** Multiple agents writing to separate SQLite databases is fine. Shared databases (if any) need WAL mode and careful transaction management.

## Anti-Patterns

### Anti-Pattern 1: Manager as AI Agent

**What people do:** Make the manager itself a Claude Code session that uses AI reasoning to decide when to restart agents, how to route messages, etc.

**Why it's wrong:** Management operations must be deterministic and fast. An LLM deciding whether to restart a crashed agent adds latency, cost, and unpredictability. The manager should be pure code with clear rules.

**Do this instead:** The manager is a TypeScript process with deterministic logic. The admin agent (which IS an AI) communicates with the manager through well-defined MCP tools, but the manager executes commands, not the admin agent.

### Anti-Pattern 2: Shared Context Across Agents

**What people do:** Try to share conversation context or memory between agents by giving them access to each other's SQLite databases or session transcripts.

**Why it's wrong:** Agents lose their distinct identity. Context pollution makes each agent less effective. SQLite concurrent writes from multiple processes cause corruption.

**Do this instead:** Each agent owns its memory exclusively. Cross-agent information sharing happens through explicit IPC messages. The admin agent can read (but not write) other agents' state via MCP tools.

### Anti-Pattern 3: Raw CLI Process Spawning

**What people do:** Use `child_process.spawn("claude", ["-p", "..."])` to run agents as CLI subprocesses, parsing stdout for responses.

**Why it's wrong:** Fragile stdout parsing, no structured message types, no session resumption, no tool approval hooks, no streaming control. Managing process lifecycle manually is error-prone.

**Do this instead:** Use the Claude Agent SDK TypeScript package directly. It provides `createSession()`, `send()`, `stream()`, structured messages, and session resumption natively.

### Anti-Pattern 4: Polling-Based Health Checks

**What people do:** Have the manager repeatedly query each agent "are you alive?" via the SDK, consuming API tokens for health checks.

**Why it's wrong:** Expensive and slow. Each health check is an API call that costs tokens and takes seconds.

**Do this instead:** Use process-level signals: track whether the session object is still open, monitor last-activity timestamps, and use filesystem heartbeat files that agents touch periodically (via a PreToolUse hook or similar mechanism).

### Anti-Pattern 5: Custom Discord Bot

**What people do:** Build a Discord.js bot from scratch to handle all Discord communication, bypassing the existing plugin.

**Why it's wrong:** Duplicates functionality that the Claude Code Discord plugin already provides. The plugin handles authentication, rate limiting, message formatting, thread management, and more.

**Do this instead:** Use the existing Discord plugin for all Discord communication. Add a thin routing layer on top that maps channels to agents.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Discord | Via Claude Code Discord plugin (`plugin:discord:discord`) | Already functional. ClawCode adds channel-to-agent routing on top. |
| Anthropic API | Via Claude Agent SDK (handles auth, rate limiting, retries) | SDK manages API keys, token counting, and retry logic. |
| Embedding Provider | TBD: Either Claude API (expensive but consistent) or local model | Needed for semantic memory search. Could start with full-text SQLite search and add embeddings later. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Manager <-> Agent | SDK session API (createSession, send, stream, close) | Manager holds session references, sends messages programmatically |
| Agent <-> Agent | File-based IPC (JSON messages in inbox directories) | Async, persistent, debuggable. Agent reads its inbox via a custom MCP tool or hook. |
| Agent <-> Memory | Direct SQLite access (each agent owns its DB) | No cross-agent memory access. Memory module provides read/write API. |
| Admin <-> Manager | MCP tools exposed by the manager as an MCP server | Admin agent invokes tools like `list-agents`, `restart-agent`, `get-agent-status` |
| Discord <-> Router | Plugin delivers messages; router maps channel to agent | Router is a lookup table. Plugin does the heavy lifting. |
| Manager <-> Scheduler | Direct function calls (scheduler runs in manager process) | Scheduler triggers agent messages at scheduled times via session.send() |

## Build Order (Dependency Chain)

The components have clear dependencies that dictate build order:

```
Phase 1: Foundation
  Config Schema + Loader (everything depends on config)
  Agent Runtime wrapper (SDK session creation/resume)
  Basic Manager (boot agents from config, start/stop)

Phase 2: Communication
  Discord Router (requires: agent runtime, config)
  Channel Binding management (requires: discord router, config)

Phase 3: Persistence
  Memory Store - basic SQLite operations (requires: agent runtime)
  Session persistence - save/load session IDs (requires: manager)

Phase 4: Intelligence
  Memory Tiers - hot/warm/cold (requires: memory store)
  Memory Consolidation - daily/weekly/monthly (requires: memory tiers)
  Memory Search - full-text then semantic (requires: memory store)

Phase 5: Operations
  Health Monitor (requires: manager, agent runtime)
  Scheduler/Cron (requires: manager, agent runtime)
  Auto-compaction (requires: memory store, health monitor)

Phase 6: Multi-Agent
  IPC Bus (requires: agent runtime)
  Cross-Agent Communication (requires: IPC bus)
  Admin Agent + MCP tools (requires: IPC, manager API)

Phase 7: Polish
  Skills Registry (requires: agent runtime)
  Memory Decay + Deduplication (requires: memory tiers)
  Heartbeat Framework extensions (requires: health monitor)
```

**Key dependency insight:** Phase 1-2 gives you a working system (agents boot from config, Discord messages route to agents). Each subsequent phase adds a capability without requiring the others. This enables iterative delivery where you get value at each phase boundary.

## Sources

- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) - HIGH confidence
- [Claude Agent SDK V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) - HIGH confidence (API is unstable but documented)
- [Claude Agent SDK Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents) - HIGH confidence
- [Claude Agent SDK Claude Code Features](https://platform.claude.com/docs/en/agent-sdk/claude-code-features) - HIGH confidence
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) - HIGH confidence
- [Claude Code Headless Mode](https://code.claude.com/docs/en/headless) - HIGH confidence
- [Multi-Agent Orchestration Patterns (Chanl)](https://www.chanl.ai/blog/multi-agent-orchestration-patterns-production-2026) - MEDIUM confidence
- Existing OpenClaw implementation at `~/.openclaw/` - HIGH confidence (direct inspection)

---
*Architecture research for: ClawCode multi-agent orchestration*
*Researched: 2026-04-08*
