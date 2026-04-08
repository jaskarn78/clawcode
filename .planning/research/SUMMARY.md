# Project Research Summary

**Project:** ClawCode
**Domain:** Multi-agent Claude Code orchestration with Discord integration
**Researched:** 2026-04-08
**Confidence:** MEDIUM-HIGH

## Executive Summary

ClawCode is a multi-agent orchestration system that manages 14+ persistent Claude Code sessions as individual agents, each with distinct identity, memory, and Discord channel bindings. The recommended approach treats Claude Code itself as the agent runtime -- not a framework wrapping an LLM, but orchestration code managing full Claude Code sessions via the official Agent SDK. This is the core architectural insight that separates ClawCode from competitors like CrewAI, AutoGen, and LangGraph, all of which build agent frameworks around raw model APIs. The stack is TypeScript on Node.js 22 LTS, with the Claude Agent SDK as the primary orchestration primitive, SQLite per-agent for memory, and local embeddings via Hugging Face Transformers for semantic search.

The architecture follows a supervisor pattern: a single deterministic TypeScript manager process (not an AI agent) boots, monitors, and restarts agent sessions from a central YAML config. Communication between agents is strictly asynchronous and file-based. Memory is tiered (hot/warm/cold) with per-agent SQLite databases -- never shared. Discord integration delegates to the existing Claude Code Discord plugin with a thin routing layer on top. This design prioritizes isolation, debuggability, and resilience over cleverness.

The primary risks are: (1) context window amnesia after auto-compaction silently erasing agent identity and task state, (2) SQLite write contention when 14+ agents write simultaneously, (3) zombie processes accumulating when the manager crashes, and (4) Discord rate limit exhaustion from a shared bot token. All four must be addressed in Phase 1 -- they are foundational, not features to bolt on later. The Claude Agent SDK being pre-1.0 (v0.2.x) is a secondary risk mitigated by pinning versions and wrapping SDK calls in a thin adapter.

## Key Findings

### Recommended Stack

The stack is deliberately conservative: proven libraries on a stable runtime, with the Claude Agent SDK as the only pre-1.0 dependency. Local embeddings eliminate API costs and network dependencies for memory search. SQLite eliminates the operational burden of running a database server. Every dependency was chosen to minimize moving parts in a system managing 14+ concurrent processes.

**Core technologies:**
- **TypeScript 6.0 + Node.js 22 LTS:** Type safety for complex agent configs and process lifecycle; LTS stability for long-running processes
- **@anthropic-ai/claude-agent-sdk 0.2.x:** The orchestration primitive -- programmatic session creation, resumption, subagent definitions, and tool approval hooks
- **better-sqlite3 + sqlite-vec:** Per-agent synchronous SQLite with vector search extension for semantic memory; no external DB server
- **@huggingface/transformers 4.x:** Local all-MiniLM-L6-v2 embeddings (384-dim) -- zero cost, zero network dependency, ~50ms per embedding
- **croner 10.x:** TypeScript-native cron scheduling with timezone/DST handling
- **execa 9.x:** Promise-based process management with graceful termination
- **zod 4.x:** Runtime schema validation for configs, messages, and memory entries
- **pino 9.x:** High-performance structured logging (critical with 14+ concurrent loggers)

**Critical version constraint:** Pin @anthropic-ai/claude-agent-sdk to exact version. It is pre-1.0 and breaking changes between minor versions are expected.

### Expected Features

**Must have (table stakes -- v1.0):**
- Central YAML config defining all agents, workspaces, channels, models
- Agent lifecycle management (start/stop/restart, boot-all-from-config)
- Per-agent workspace isolation with SOUL.md + IDENTITY.md
- Discord channel binding (message routing to correct agent)
- Per-agent memory (SQLite + markdown logs)
- Extensible heartbeat framework with context-fill monitoring
- Auto-compaction with identity-preserving instructions
- Graceful error recovery with exponential backoff

**Should have (differentiators -- v1.x after core stabilizes):**
- Memory auto-consolidation (daily -> weekly -> monthly digests)
- Memory relevance decay and deduplication
- Cross-agent async communication (file-based inbox)
- Cron/scheduler for periodic agent tasks
- Skills registry with per-agent assignment
- Subagent spawning with model selection (haiku/sonnet/opus)

**Defer (v2+):**
- Admin agent with cross-workspace MCP tools (needs security model first)
- Tiered memory hot/warm/cold (only needed at scale)
- Multi-platform support (Slack, Telegram) -- Discord-only for v1
- Visual config UI (config schema must stabilize first)

**Anti-features (explicitly avoid):**
- Multi-provider model support (destroys the native Claude Code advantage)
- Synchronous inter-agent RPC (guaranteed deadlocks at scale)
- Shared memory / global knowledge base (violates isolation, causes races)
- Real-time streaming between agents (creates tight coupling)

### Architecture Approach

Four-layer architecture: Control Plane (manager, config, health monitor), Agent Runtime Layer (individual Claude Code SDK sessions), Communication Layer (Discord router, file-based IPC, agent mailboxes), and Persistence Layer (per-agent SQLite memory, session store, scheduler state). The manager is pure deterministic TypeScript code -- not an AI agent. Each agent is an SDK V2 session with its own workspace, identity files, and isolated memory database.

**Major components:**
1. **Agent Manager** -- Supervisor process: boots agents from config, monitors health via heartbeat, handles restart with backoff, tracks PIDs in persistent registry
2. **Agent Runtime** -- Wrapper around Claude Agent SDK sessions: identity loading, workspace management, lifecycle hooks (PreToolUse for heartbeat files)
3. **Discord Router** -- Thin routing layer mapping channel IDs to agent session IDs; delegates actual Discord communication to the existing plugin
4. **Memory Store** -- Per-agent SQLite database with tables for memories, vectors, daily logs, and context snapshots; markdown logs for human readability
5. **IPC Bus** -- File-based JSON message passing between agents via per-agent inbox directories; chokidar watches for new messages
6. **Scheduler** -- Cron job execution in the manager process dispatching scheduled tasks to agent sessions

### Critical Pitfalls

1. **Context window amnesia after auto-compaction** -- Auto-compaction silently drops identity instructions and task state. Prevent by implementing proactive compaction at 60-70% capacity with explicit preservation instructions, and re-reading SOUL.md/IDENTITY.md after every compaction.

2. **SQLite SQLITE_BUSY from concurrent writes** -- 14+ agents writing simultaneously causes "database is locked" errors even with WAL mode. Prevent by using per-agent databases (never shared), WAL mode with 5000ms busy_timeout, BEGIN IMMEDIATE for all writes, and periodic WAL checkpointing.

3. **Zombie processes after manager crash** -- Orphaned Claude Code processes consume resources and create ghost Discord responses. Prevent by tracking PIDs in a persistent registry, using process groups, implementing cleanup on manager startup, and handling SIGTERM -> SIGKILL shutdown sequence.

4. **Discord rate limit exhaustion** -- 14 agents sharing one bot token collectively exceed 50 req/s. Prevent by implementing a centralized rate limiter across all agent processes, exponential backoff with jitter on 429s, and response debouncing.

5. **Agent identity drift over long sessions** -- Persona consistency degrades 30%+ after 8-12 turns. Prevent by periodic identity re-injection, behavioral specifications (not just personality descriptions) in SOUL.md, and structured output constraints.

## Implications for Roadmap

Based on combined research, here is the suggested phase structure:

### Phase 1: Foundation and Agent Manager
**Rationale:** Everything depends on the manager being able to boot agents from config and keep them alive. Process lifecycle is the single most critical capability. The three highest-severity pitfalls (zombie processes, SQLite contention, Discord rate limits) must be addressed here.
**Delivers:** A working system where N agents boot from YAML config, connect to Discord channels, and survive crashes.
**Features:** Central config, agent lifecycle management, per-agent workspace isolation, boot-all-from-config, graceful error recovery, PID registry, basic heartbeat
**Avoids:** Zombie processes (persistent PID registry), SQLite contention (per-agent databases from day one)

### Phase 2: Discord Integration
**Rationale:** Discord is the user-facing interface. Without routing, agents are headless. Depends on Phase 1 agent lifecycle.
**Delivers:** Messages in Discord channels route to the correct agent and responses come back.
**Features:** Discord channel binding, channel-to-agent routing, rate limit coordination across agents
**Avoids:** Rate limit exhaustion (centralized limiter), duplicate responses (strict channel binding)

### Phase 3: Agent Identity and Basic Memory
**Rationale:** Agents need persistent identity and memory to be useful beyond single sessions. Identity drift becomes a problem as soon as agents run for more than a few hours. Memory schema must include trust/provenance from the start.
**Delivers:** Agents with stable personalities and persistent memory that survives restarts and compactions.
**Features:** SOUL.md/IDENTITY.md system, per-agent SQLite memory, auto-compaction with identity preservation, memory trust levels
**Avoids:** Identity drift (periodic re-injection), memory poisoning (trust classification from day one), context amnesia (proactive compaction)

### Phase 4: Advanced Memory
**Rationale:** Once basic memory works, add the intelligence layer. Consolidation, decay, and semantic search make agents genuinely useful over weeks and months. Depends on Phase 3 memory foundation.
**Delivers:** Agents with intelligent memory that consolidates, decays, and is semantically searchable.
**Features:** Memory auto-consolidation (daily/weekly/monthly), relevance decay, deduplication, semantic search via sqlite-vec + local embeddings, storage lifecycle (TTLs, cleanup, VACUUM)
**Avoids:** Storage bloat (hard TTLs, log rotation), unbounded WAL growth (scheduled checkpointing)

### Phase 5: Scheduling and Operations
**Rationale:** Periodic tasks (memory consolidation triggers, health checks, status reports) need a scheduler. This phase makes the system self-maintaining.
**Delivers:** Agents that perform scheduled work autonomously and a health monitoring system that catches problems early.
**Features:** Cron/scheduler, extended heartbeat framework (context fill, memory pressure, Discord connection health), auto-compaction triggers
**Avoids:** Performance traps (scheduled WAL checkpointing, embedding batching)

### Phase 6: Multi-Agent Communication
**Rationale:** Cross-agent features are the capstone. They depend on stable agent lifecycle, identity, and memory. Building communication before agents are individually reliable creates cascading failure risk.
**Delivers:** Agents that can collaborate via async messaging without tight coupling.
**Features:** File-based IPC bus, per-agent inbox/mailbox, cross-agent async messaging, circuit breakers, distributed tracing
**Avoids:** Inter-agent deadlocks (async-only, fire-and-forget with optional callbacks), cascading failures (circuit breakers, timeouts)

### Phase 7: Skills, Subagents, and Admin
**Rationale:** These are power features that layer on top of a working multi-agent system. The admin agent requires both cross-agent communication and lifecycle management.
**Delivers:** Composable skills, cost-optimized subagent spawning, and a privileged admin agent.
**Features:** Skills registry with per-agent assignment, subagent spawning with model selection, admin agent with MCP tools
**Avoids:** Privilege escalation (admin in separate process group, scoped permissions)

### Phase Ordering Rationale

- **Dependency-driven:** The feature dependency graph from FEATURES.md shows Central Config -> Lifecycle -> Workspace -> Memory as the critical path. Every other feature branches from this chain.
- **Risk-front-loaded:** The four critical pitfalls (zombies, SQLite, rate limits, identity drift) are all addressed in Phases 1-3. This means the system is production-reliable before adding advanced features.
- **Incremental value:** Phase 1+2 delivers a working multi-agent Discord system. Phase 3 makes it persistent. Phase 4 makes it intelligent. Each phase boundary is a usable milestone.
- **Isolation before communication:** Cross-agent features (Phase 6) come after individual agent reliability (Phases 1-5). This matches the architectural principle that you cannot build controlled communication without established boundaries.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Identity + Memory):** The Claude Agent SDK V2 session API is unstable preview. How session.send() interacts with compaction, and whether PreToolUse hooks can reliably trigger heartbeat file writes, needs hands-on validation.
- **Phase 4 (Advanced Memory):** sqlite-vec integration with better-sqlite3 for production KNN search at scale needs benchmarking. The consolidation pipeline (LLM-powered summarization) needs prompt engineering research.
- **Phase 6 (Multi-Agent Communication):** File-based IPC performance and reliability with 14+ agents needs load testing. The interaction between chokidar watchers and high message volumes needs validation.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Process management, YAML config loading, and health monitoring are well-documented Node.js patterns.
- **Phase 2 (Discord):** Channel routing is a lookup table. Discord plugin delegation is straightforward.
- **Phase 5 (Scheduling):** Croner is well-documented and the scheduling pattern is standard.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Core stack is proven (Node.js, SQLite, TypeScript). Agent SDK is pre-1.0 and fast-moving -- the main uncertainty. All versions verified via npm on 2026-04-08. |
| Features | HIGH | Comprehensive competitor analysis (CrewAI, AutoGen, LangGraph, OpenClaw). Clear MVP definition with dependency graph. Feature prioritization is well-grounded. |
| Architecture | HIGH | Four-layer architecture with clear component boundaries. Build order aligns with feature dependencies. Anti-patterns well-documented. Claude Agent SDK V2 API documented but marked unstable. |
| Pitfalls | HIGH | 8 pitfalls identified with specific prevention strategies, warning signs, and phase mappings. Sources include academic papers (arXiv), official docs (SQLite, Discord), and production experience reports. |

**Overall confidence:** MEDIUM-HIGH

The main uncertainty is the Claude Agent SDK V2 preview API. If it changes significantly, the agent runtime wrapper (Phase 1) will need updating, but the thin adapter pattern recommended in STACK.md isolates this risk.

### Gaps to Address

- **Agent SDK V2 stability:** The `unstable_v2_createSession` / `unstable_v2_resumeSession` APIs are explicitly marked unstable. Need a fallback strategy if V2 is removed or significantly changed before graduating to stable. The CLI `--print` flag is the degraded-mode fallback.
- **Discord plugin API surface:** Research assumes the existing Discord plugin handles most Discord communication. The exact capabilities and limitations of the plugin need validation -- specifically whether it supports thread management, reactions, and message editing in the ways the routing layer requires.
- **Local embedding quality:** all-MiniLM-L6-v2 is recommended for cost/speed but its quality for agent memory search (vs. a purpose-built embedding model) needs validation with real agent memory content. Start with full-text SQLite search as fallback.
- **Process group behavior on Linux:** The recommendation to use process groups for zombie cleanup assumes standard Linux process group semantics. Need to verify this works correctly with the Claude Agent SDK's process spawning model.
- **Compaction hook mechanism:** The strategy to inject custom preservation instructions before auto-compaction requires a way to detect approaching context limits programmatically. The exact mechanism (heartbeat polling vs. SDK callback) needs validation.

## Sources

### Primary (HIGH confidence)
- [Claude Agent SDK TypeScript](https://platform.claude.com/docs/en/agent-sdk/typescript) -- SDK API, session management
- [Claude Agent SDK V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) -- V2 session API
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) -- multi-agent coordination
- [SQLite WAL Documentation](https://www.sqlite.org/wal.html) -- concurrency model
- [Discord Rate Limits](https://docs.discord.com/developers/topics/rate-limits) -- rate limit buckets
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec) -- vector search extension
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) -- SQLite driver
- Existing OpenClaw implementation at ~/.openclaw/ -- reference architecture

### Secondary (MEDIUM confidence)
- [Multi-Agent Orchestration Patterns (Chanl)](https://www.chanl.ai/blog/multi-agent-orchestration-patterns-production-2026) -- production patterns
- [CrewAI Memory Docs](https://docs.crewai.com/en/concepts/memory) -- competitor memory system
- [Examining Identity Drift in LLM Agents (arXiv 2412.00804)](https://arxiv.org/abs/2412.00804) -- persona degradation research
- [Why Multi-Agent AI Systems Fail (Galileo)](https://galileo.ai/blog/multi-agent-ai-failures-prevention) -- failure mode analysis
- [Why Do Multi-Agent LLM Systems Fail (arXiv 2503.13657)](https://arxiv.org/abs/2503.13657) -- deadlock research

### Tertiary (LOW confidence)
- [SoulSpec.org](https://soulspec.org/) -- SOUL.md as emerging standard (adoption unclear)
- [Node.js Zombie Process Issue #46569](https://github.com/nodejs/node/issues/46569) -- specific zombie edge case

---
*Research completed: 2026-04-08*
*Ready for roadmap: yes*
