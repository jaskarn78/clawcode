# Feature Research

**Domain:** Multi-agent AI orchestration (persistent Claude Code agents with Discord integration)
**Researched:** 2026-04-08
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Agent lifecycle management (start/stop/restart) | Every orchestration system has this. CrewAI, AutoGen, LangGraph all provide process control. Without it, you're manually managing terminals. | MEDIUM | Central manager process that tracks PIDs, handles graceful shutdown, and can restart crashed agents. OpenClaw's agent manager is the reference. |
| Per-agent workspace isolation | OpenClaw, CrewAI, and AutoGen all isolate agent state. Shared state causes cross-contamination bugs that are impossible to debug. | LOW | Each agent gets its own directory tree: config, memory, session state. Claude Code already supports per-project `.claude/` directories -- leverage this. |
| Agent identity system (SOUL.md / IDENTITY.md) | SOUL.md is becoming an industry pattern (SoulSpec.org, soul-md.xyz). OpenClaw pioneered the separation of soul (philosophy) from identity (presentation) from config (capabilities). Users expect persistent personality across sessions. | LOW | Markdown files per agent. SOUL.md for behavioral philosophy, IDENTITY.md for name/avatar/tone. Already a proven pattern -- just formalize it. |
| Discord channel binding | Core value prop of ClawCode. Each agent owns channel(s). Messages route to the right agent. OpenClaw does this with its gateway; ClawCode does it with native Discord plugin per process. | MEDIUM | Channel-to-agent mapping in central config. The Discord plugin already handles the connection -- this is routing logic on top. |
| Per-agent memory (conversation history + facts) | CrewAI has unified memory with scope trees. AutoGen maintains conversation history. LangGraph has checkpointing. Any agent without memory feels broken after the first session reset. | HIGH | SQLite-backed with markdown logs for human readability. This is the most complex table-stakes feature because it needs to survive process restarts and context window limits. |
| Central configuration | Every framework has a single config defining all agents. CrewAI uses YAML crew definitions. OpenClaw uses AGENTS.md + per-agent configs. Without central config, adding/modifying agents requires code changes. | LOW | Single YAML/JSON file defining all agents, their workspaces, channels, models, skills. Declarative, not imperative. |
| Auto-compaction / context management | Claude Code sessions hit context limits. OpenClaw has heartbeat-driven compaction. Without this, agents silently degrade as context fills up, producing worse responses with no warning. | MEDIUM | Monitor context fill percentage. At threshold, trigger `/compact` equivalent. Flush conversation to memory before compacting. |
| Boot-all-from-config | Users expect `clawcode start` to bring up all agents from a config file. Manual startup per agent is a non-starter for 14+ agents. | LOW | Read config, iterate agents, spawn Claude Code processes. Simple but essential. |
| Graceful error recovery | Agents crash. Processes die. OOM kills happen. If the system can't detect and recover from failures, it's a toy. AutoGen and CrewAI both handle this at the framework level. | MEDIUM | Heartbeat monitoring + automatic restart. Exponential backoff for repeated failures. Alert the admin agent on persistent failures. |

### Differentiators (Competitive Advantage)

Features that set ClawCode apart from CrewAI/AutoGen/LangGraph and from OpenClaw itself.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Native Claude Code processes (no gateway) | Every other multi-agent system is a framework you build on top of. ClawCode treats Claude Code itself as the agent runtime. No bridge, no middleware, no translation layer. Each agent IS a full Claude Code session with all its capabilities (MCP, tools, filesystem, git). | MEDIUM | This is the core architectural insight. Competitors wrap LLMs in frameworks. ClawCode wraps orchestration around Claude Code. The agent already exists -- we just manage it. |
| Intelligent memory with relevance decay | CrewAI has scoped memory but no temporal decay. Most systems treat all memories equally. Real memory fades. Unaccessed facts should lose priority over time, keeping active context sharp and relevant. | HIGH | Composite scoring: semantic similarity + recency + access frequency + importance. Auto-archive memories below threshold. This prevents the "infinite context" problem where old irrelevant facts crowd out recent relevant ones. |
| Memory auto-consolidation (daily -> weekly -> monthly) | No competitor does this well. Raw conversation logs are useless at scale. Automatic summarization from daily logs into weekly/monthly digests mirrors how human organizations actually manage institutional knowledge. | HIGH | LLM-powered summarization pipeline. Daily: extract key facts. Weekly: merge dailies into themes. Monthly: distill to essential knowledge. Raw always preserved for audit. |
| Tiered memory storage (hot/warm/cold) | Inspired by database storage tiers. Hot memory is in active context. Warm is searchable but not loaded. Cold is archived. This is how you scale to months/years of agent operation without drowning in context. | HIGH | Hot = current session context. Warm = SQLite with semantic search (embeddings). Cold = compressed markdown archives. Retrieval promotes cold -> warm -> hot as needed. |
| Cross-agent communication | AutoGen has GroupChat. CrewAI has crew-internal messaging. But ClawCode agents are separate processes, potentially in different workspaces. Enabling them to message each other creates emergent collaboration without forced coupling. | MEDIUM | Message bus or shared file protocol. Agent A writes to Agent B's inbox. Agent B picks up on next heartbeat. Async by design -- no blocking RPC between agents. |
| Admin agent (privileged cross-workspace access) | Unique to ClawCode's architecture. One agent that can reach into any other agent's workspace, check health, read memory, trigger actions. Like a sysadmin for your AI team. | MEDIUM | Special agent with elevated filesystem permissions. Can read other agents' memory, trigger restarts via manager, coordinate cross-agent tasks. Security boundary is critical here. |
| Skills registry with per-agent assignment | Claude Code has skills (SKILL.md). But there's no registry, no discovery, no way to say "Agent X gets skills A,B,C while Agent Y gets D,E,F." A proper registry makes skills a first-class composable unit. | MEDIUM | Catalog of available skills. Per-agent assignment in config. Skills are directories with SKILL.md -- the format exists, we add the management layer. |
| Subagent spawning with model selection | Claude Code's Agent tool already spawns subagents. ClawCode adds the ability to choose the model (haiku for cheap/fast tasks, opus for complex reasoning). This is cost optimization built into the architecture. | LOW | Wrapper around Claude Code's native Agent tool. Config specifies default model per agent. Subagent spawning can override to a cheaper model for simple subtasks. |
| Extensible heartbeat framework | Most monitoring is baked-in and rigid. An extensible heartbeat where you can add custom checks (memory pressure, context fill, task queue depth, Discord connection health) without modifying core code. | LOW | Heartbeat runs on interval. Checks are pluggable functions. Start empty, add checks as needed. Each check returns healthy/warning/critical. |
| Cron/scheduler within persistent sessions | LangGraph requires external schedulers. CrewAI has no built-in scheduling. Running cron-like tasks inside a persistent Claude Code session means the agent can do periodic work (summarize daily logs, check RSS feeds, post updates) without external tooling. | MEDIUM | Time-based task execution within the agent's own session. No separate cron daemon -- the agent IS the executor. Tasks defined in agent config. |
| Memory deduplication | When the same fact gets stored 50 times across conversations ("user prefers dark mode"), it wastes storage and pollutes search results. Automatic deduplication merges repeated facts into single authoritative entries. | MEDIUM | On memory write, check for semantic similarity with existing memories. If above threshold, merge into existing entry (update timestamp, increment confidence). Prevents memory bloat over long-running agents. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems for ClawCode specifically.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Multi-provider model support (Ollama, OpenRouter) | "I want to use GPT-4 or local models" | ClawCode's value is native Claude Code integration. Supporting other providers means building a gateway layer -- exactly what we're eliminating. It re-introduces the middleware complexity OpenClaw has. | Use Claude Code's native model selection (sonnet/opus/haiku). If users need other models, they use a different framework. Opinionated simplicity. |
| Real-time streaming between agents | "Agents should see each other's output in real-time" | Creates tight coupling between agent processes. One slow agent blocks others. Debugging becomes a nightmare. AutoGen's GroupChat pattern consumes 20+ LLM calls per task because of this. | Async message passing. Agents communicate via inboxes checked on heartbeat. Eventual consistency, not real-time. Much simpler to debug and reason about. |
| WhatsApp/Telegram/Slack support (v1) | "I want agents on all platforms" | Each platform has different APIs, rate limits, attachment handling, threading models. Supporting multiple platforms in v1 splits focus and delays core feature delivery. | Discord-only for v1. The architecture should be channel-agnostic internally so platforms can be added later, but v1 ships with Discord only. |
| Visual workflow builder / no-code UI | "I want to drag and drop agent configurations" | Premature abstraction. The configuration surface is still evolving. Building a UI locks you into a config schema before it's stable. CrewAI added no-code and it created a maintenance burden. | YAML/JSON config files. Human-readable, version-controllable, scriptable. Add a UI only after the config schema is stable (v2+). |
| Agent-to-agent RPC / synchronous calls | "Agent A should call Agent B and wait for a response" | Synchronous calls between LLM processes are inherently unreliable. Timeouts, context window issues, and cascading failures. Distributed systems 101: avoid synchronous coupling. | Async message passing with optional callback. Agent A posts a request, continues its work, gets notified when Agent B responds. |
| Shared memory / global knowledge base | "All agents should see the same facts" | Violates workspace isolation. Creates race conditions on writes. Makes it impossible to reason about what an agent knows. CrewAI's scoped memory exists precisely because global memory failed. | Per-agent memory with explicit sharing. The admin agent can copy specific facts between agent memories. Controlled, auditable, no surprises. |
| Voice/TTS integration | "Agents should talk in voice channels" | Adds significant complexity (speech-to-text, text-to-speech, real-time audio streaming). Orthogonal to the core orchestration problem. | Out of scope for v1. Could be added as a skill/plugin later if the extensibility framework is solid. |
| Auto-scaling / dynamic agent spawning | "Spin up new agents based on load" | Over-engineering for the scale ClawCode targets (14-30 agents). Dynamic spawning needs service discovery, load balancing, and resource management that adds massive complexity. | Fixed agent pool defined in config. If you need more agents, update config and restart. Manual scaling is fine for this scale. |

## Feature Dependencies

```
[Central Config]
    +-- requires --> [nothing -- foundational]

[Agent Lifecycle Management]
    +-- requires --> [Central Config]
    +-- requires --> [Boot-all-from-config]

[Per-agent Workspace Isolation]
    +-- requires --> [Central Config]

[Agent Identity (SOUL.md)]
    +-- requires --> [Per-agent Workspace Isolation]

[Discord Channel Binding]
    +-- requires --> [Central Config]
    +-- requires --> [Agent Lifecycle Management]

[Per-agent Memory]
    +-- requires --> [Per-agent Workspace Isolation]

[Auto-compaction]
    +-- requires --> [Heartbeat Framework]
    +-- requires --> [Per-agent Memory]

[Memory Consolidation (daily/weekly/monthly)]
    +-- requires --> [Per-agent Memory]
    +-- requires --> [Cron/Scheduler]

[Memory Relevance Decay]
    +-- requires --> [Per-agent Memory]

[Memory Deduplication]
    +-- requires --> [Per-agent Memory]

[Tiered Memory (hot/warm/cold)]
    +-- requires --> [Per-agent Memory]
    +-- requires --> [Memory Relevance Decay]

[Cross-agent Communication]
    +-- requires --> [Agent Lifecycle Management]
    +-- requires --> [Per-agent Workspace Isolation]

[Admin Agent]
    +-- requires --> [Cross-agent Communication]
    +-- requires --> [Agent Lifecycle Management]

[Skills Registry]
    +-- requires --> [Per-agent Workspace Isolation]
    +-- requires --> [Central Config]

[Subagent Spawning]
    +-- requires --> [Agent Lifecycle Management]

[Cron/Scheduler]
    +-- requires --> [Heartbeat Framework]

[Heartbeat Framework]
    +-- requires --> [Agent Lifecycle Management]

[Graceful Error Recovery]
    +-- requires --> [Heartbeat Framework]
    +-- requires --> [Agent Lifecycle Management]
```

### Dependency Notes

- **Central Config is foundational:** Everything depends on knowing which agents exist, where they live, and what they do. Build this first.
- **Heartbeat Framework unlocks monitoring:** Auto-compaction, cron, and error recovery all need a periodic check system. Build the heartbeat early with an empty check list, then add checks incrementally.
- **Memory is a deep tree:** Basic per-agent memory must exist before any advanced memory feature (consolidation, decay, dedup, tiering). Memory is the longest dependency chain.
- **Cross-agent communication requires isolation first:** You can't build controlled communication between agents if their boundaries aren't established.
- **Admin Agent is a capstone:** It needs both cross-agent communication and lifecycle management. Build it last among the core features.

## MVP Definition

### Launch With (v1.0)

Minimum viable product -- what's needed to prove ClawCode works better than managing Claude Code sessions manually.

- [ ] Central config (YAML) defining agents, workspaces, channels, models -- the single source of truth
- [ ] Agent lifecycle management (start/stop/restart individual agents, boot-all) -- the manager process
- [ ] Per-agent workspace isolation with SOUL.md + IDENTITY.md -- agent identity
- [ ] Discord channel binding -- messages route to the correct agent
- [ ] Per-agent memory (SQLite + markdown logs) -- basic persistence across sessions
- [ ] Heartbeat framework (extensible, starts with context-fill check) -- monitoring foundation
- [ ] Auto-compaction at configurable context threshold -- prevents silent degradation
- [ ] Graceful error recovery (detect crash, restart with backoff) -- production reliability

### Add After Validation (v1.x)

Features to add once core orchestration is stable and running reliably.

- [ ] Memory auto-consolidation (daily -> weekly -> monthly) -- trigger: agents running for 1+ weeks and daily logs pile up
- [ ] Memory relevance decay -- trigger: search results return too many stale/irrelevant memories
- [ ] Memory deduplication -- trigger: duplicate facts observed in memory stores
- [ ] Cron/scheduler for periodic tasks -- trigger: users want agents to do scheduled work (summaries, reports)
- [ ] Skills registry with per-agent assignment -- trigger: more than 5 skills exist and assignment becomes manual
- [ ] Cross-agent communication (async inbox) -- trigger: users need agents to collaborate on tasks
- [ ] Subagent spawning with model selection -- trigger: cost optimization becomes important

### Future Consideration (v2+)

Features to defer until the orchestration layer is battle-tested.

- [ ] Admin agent with cross-workspace access -- needs solid security model first
- [ ] Tiered memory storage (hot/warm/cold) -- only needed at scale (months of operation)
- [ ] Multi-platform support (Slack, Telegram) -- architecture should be channel-agnostic, but v1 is Discord only
- [ ] Visual config UI -- only after config schema stabilizes
- [ ] Agent marketplace / shared skill registry -- community feature, needs ecosystem first

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Central config system | HIGH | LOW | P1 |
| Agent lifecycle management | HIGH | MEDIUM | P1 |
| Per-agent workspace isolation | HIGH | LOW | P1 |
| Agent identity (SOUL.md/IDENTITY.md) | HIGH | LOW | P1 |
| Discord channel binding | HIGH | MEDIUM | P1 |
| Per-agent memory (SQLite + markdown) | HIGH | HIGH | P1 |
| Heartbeat framework | HIGH | LOW | P1 |
| Auto-compaction | HIGH | MEDIUM | P1 |
| Graceful error recovery | HIGH | MEDIUM | P1 |
| Memory auto-consolidation | MEDIUM | HIGH | P2 |
| Memory relevance decay | MEDIUM | MEDIUM | P2 |
| Memory deduplication | MEDIUM | MEDIUM | P2 |
| Cron/scheduler | MEDIUM | MEDIUM | P2 |
| Skills registry | MEDIUM | MEDIUM | P2 |
| Cross-agent communication | MEDIUM | MEDIUM | P2 |
| Subagent spawning + model selection | MEDIUM | LOW | P2 |
| Admin agent | MEDIUM | HIGH | P3 |
| Tiered memory (hot/warm/cold) | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch -- without these, ClawCode is worse than manual Claude Code management
- P2: Should have, add after core is stable -- these make ClawCode genuinely powerful
- P3: Nice to have, future consideration -- these are the long-term vision

## Competitor Feature Analysis

| Feature | OpenClaw | CrewAI | AutoGen/AG2 | LangGraph | ClawCode Approach |
|---------|----------|--------|-------------|-----------|-------------------|
| Agent runtime | Custom gateway process | Python framework | Python framework | Graph execution engine | Native Claude Code processes -- no framework layer |
| Process management | Built-in agent manager | Crew lifecycle | GroupChat manager | External (user manages) | Central manager process with heartbeat monitoring |
| Memory | SQLite + semantic search + markdown | Unified scoped memory (LLM-analyzed) | In-memory conversation history | Checkpointing (SQLite/Postgres) | SQLite + markdown + decay + consolidation + dedup |
| Agent identity | SOUL.md + IDENTITY.md (pioneered it) | Role/backstory/goal strings | System message | State schema | SOUL.md + IDENTITY.md (carry forward from OpenClaw) |
| Inter-agent comms | Explicit channels + shared files | Crew-internal task passing | GroupChat (shared conversation) | Graph edges (directed) | Async inbox (file-based message passing) |
| Scheduling | Built-in cron | None built-in | None built-in | External scheduler required | Cron within persistent sessions |
| Skills/plugins | Skills + tools + plugins | Tools (Python functions) | Tools (Python functions) | Tools as graph nodes | Skills registry with per-agent assignment |
| Chat integration | 22+ channels (Discord, WhatsApp, Telegram, etc.) | None (API only) | None (API only) | None (API only) | Discord-only via native plugin (channel-agnostic architecture for future) |
| Context management | Heartbeat + auto-compaction | Task output passing | Conversation truncation | Checkpointing with time-travel | Heartbeat + auto-compaction + tiered memory |
| Workspace isolation | Per-agent dirs + sandbox (Landlock/seccomp) | No workspace concept | No workspace concept | Thread-based state isolation | Per-agent dirs (leverage Claude Code's project isolation) |
| Config | AGENTS.md + per-agent YAML | Python code / YAML | Python code | Python code | Single YAML config file |

## Sources

- [Best Multi-Agent Frameworks in 2026](https://gurusup.com/blog/best-multi-agent-frameworks-2026) -- framework comparison
- [CrewAI Memory Docs](https://docs.crewai.com/en/concepts/memory) -- CrewAI's unified memory system
- [AutoGen Conversation Patterns](https://microsoft.github.io/autogen/0.2/docs/tutorial/conversation-patterns/) -- GroupChat patterns
- [AutoGen Group Chat Design](https://microsoft.github.io/autogen/stable//user-guide/core-user-guide/design-patterns/group-chat.html) -- speaker selection
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) -- checkpointing system
- [OpenClaw Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent) -- workspace isolation architecture
- [SoulSpec.org](https://soulspec.org/) -- open standard for AI agent personas
- [SOUL.md Pattern](https://www.soul-md.xyz/) -- composable AI agent identity
- [AI Agent Skills Guide 2026](https://calmops.com/ai/ai-agent-skills-complete-guide-2026/) -- skills as portable capabilities
- [CrewAI vs LangGraph vs AutoGen vs OpenAgents](https://openagents.org/blog/posts/2026-02-23-open-source-ai-agent-frameworks-compared) -- framework comparison
- [Architecture and Orchestration of Memory Systems in AI Agents](https://www.analyticsvidhya.com/blog/2026/04/memory-systems-in-ai-agents/) -- episodic/semantic memory patterns
- [AI Agent Failure Modes](https://dev.to/clevagent/three-ai-agent-failure-modes-that-traditional-monitoring-will-never-catch-2ik4) -- monitoring patterns

---
*Feature research for: ClawCode multi-agent orchestration*
*Researched: 2026-04-08*
