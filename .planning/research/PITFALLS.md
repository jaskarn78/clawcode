# Pitfalls Research

**Domain:** Multi-agent Claude Code orchestration (ClawCode)
**Researched:** 2026-04-08
**Confidence:** HIGH (multiple verified sources, domain-specific research)

## Critical Pitfalls

### Pitfall 1: Context Window Amnesia After Auto-Compaction

**What goes wrong:**
Each agent is a persistent Claude Code session. When a session hits ~83.5% context capacity, auto-compaction fires and summarizes the conversation. During summarization, the model decides what to keep and what to discard. Subtle but critical details -- agent identity instructions, rate limit configurations, ongoing task state, inter-agent coordination context -- get silently dropped. The agent continues operating but with degraded understanding of its own purpose and current tasks.

**Why it happens:**
Auto-compaction is optimized for general coding sessions, not for persistent agent personas. It has no concept of "always preserve these tokens" beyond CLAUDE.md and system prompt. Identity files (SOUL.md, IDENTITY.md) are in the initial context but lose weight as the conversation grows. After compaction, the summary may omit persona nuances, replacing a richly-defined agent personality with a generic assistant mode.

**How to avoid:**
1. Implement proactive manual compaction using `/compact` with explicit preservation instructions BEFORE hitting the auto-compact threshold (e.g., at 60-70% capacity).
2. Structure compaction instructions to always re-inject: agent identity, current task state, active inter-agent commitments, and memory pointers.
3. Design a heartbeat check that monitors context usage percentage and triggers compaction with curated instructions rather than letting auto-compact decide.
4. Keep CLAUDE.md and IDENTITY.md files small and high-signal so they survive compaction priority.
5. After each compaction, re-read SOUL.md and IDENTITY.md to re-anchor identity.

**Warning signs:**
- Agent responses become generic or lose personality/tone
- Agent forgets ongoing multi-step tasks mid-execution
- Agent re-asks questions it already resolved earlier in the session
- Context usage oscillating rapidly between compactions (too much work per cycle)

**Phase to address:**
Phase 1 (Agent Manager core) -- the compaction-aware heartbeat must be part of the foundational agent lifecycle, not bolted on later.

---

### Pitfall 2: SQLite SQLITE_BUSY Deadlocks from Concurrent Agent Writes

**What goes wrong:**
Multiple agent processes write to the same SQLite database (memory store, semantic search index) simultaneously. Even with WAL mode enabled, SQLite allows only one writer at a time. When two agents try to write simultaneously, one gets SQLITE_BUSY. With default or low busy_timeout, this manifests as "database is locked" errors that crash memory operations. Worse: if agents use read-then-write transaction patterns (BEGIN then read then write), they create upgrade deadlocks that busy_timeout cannot resolve.

**Why it happens:**
SQLite's concurrency model is fundamentally single-writer. WAL mode helps readers coexist with writers but does NOT solve writer-writer contention. Developers assume WAL = concurrent writes, which is false. Additionally, if any agent crashes mid-transaction, it can leave lock files (.db-wal, .db-shm) in a state that blocks all other processes until recovery.

**How to avoid:**
1. Use WAL mode (mandatory) with a generous busy_timeout of at least 5000ms. Testing shows anything below 5 seconds causes intermittent failures under concurrent write load.
2. Never use read-then-write transactions. Use BEGIN IMMEDIATE for all write transactions to fail fast rather than deadlock.
3. Keep write transactions as small as possible: single-statement writes preferred. Batch inserts rather than individual row-by-row writes.
4. Consider a write-serialization pattern: route all writes through a single writer process (the Agent Manager) and have agents submit write requests via IPC rather than writing directly.
5. Implement explicit WAL checkpointing on a schedule to prevent checkpoint starvation (WAL file growing unbounded from constant concurrent reads).
6. Handle the WAL-reset bug (affects SQLite 3.7.0 through 3.51.2): ensure SQLite is updated when a fix is available, or implement checksums on critical data.

**Warning signs:**
- Intermittent "database is locked" errors in agent logs
- WAL file growing continuously (checkpoint starvation)
- Memory operations timing out or silently failing
- Agent state becoming inconsistent (writes lost)
- Lock files persisting after agent crash/restart

**Phase to address:**
Phase 1 (Memory system foundation) -- the database access pattern must be correct from day one. Retrofitting write serialization into an existing concurrent system is extremely painful.

---

### Pitfall 3: Agent Identity Drift Over Long Sessions

**What goes wrong:**
After 8-12 dialogue turns, LLM persona self-consistency degrades by over 30%, even with context intact. For persistent agents running for hours or days, the agent's personality, communication style, and behavioral patterns gradually converge toward a generic Claude assistant. An agent defined as "terse and technical" starts writing verbose, friendly responses. An agent meant to be cautious becomes cavalier. Users interacting via Discord notice personality changes and lose trust.

**Why it happens:**
The transformer attention mechanism gives less weight to early self-descriptive tokens (identity instructions) as sequence length grows. Recent conversation tokens dominate the model's behavior. Research shows that larger models experience GREATER identity drift, and simply assigning a persona via system prompt does not reliably maintain identity. Auto-compaction makes this worse: the compacted summary may flatten personality nuances.

**How to avoid:**
1. Re-inject identity anchors periodically. After every compaction and at regular intervals (e.g., every 20 messages), prepend a condensed identity reminder to the next prompt.
2. Keep SOUL.md/IDENTITY.md files as behavioral specifications, not just personality descriptions. Define: tone examples, forbidden patterns, response length constraints, and decision-making heuristics.
3. Implement identity verification in the heartbeat: periodically ask the agent to self-describe and compare against the identity specification. Flag drift for human review.
4. Use structured output constraints (response templates, required sections) to mechanically enforce identity-consistent behavior even when the model drifts.
5. Prefer shorter, more frequent sessions with clean restarts over indefinitely long sessions when identity fidelity is critical.

**Warning signs:**
- Agent tone shifts (formal agent becomes casual, or vice versa)
- Agent starts responding in ways that match generic Claude patterns rather than its defined personality
- Agent forgets its own name or role when asked
- User complaints about personality inconsistency in Discord

**Phase to address:**
Phase 2 (Agent identity and workspace) -- identity anchoring must be designed into the persona system, not added as an afterthought to a running agent.

---

### Pitfall 4: Zombie Processes and Unmanaged Agent Lifecycle

**What goes wrong:**
The Agent Manager spawns Claude Code CLI processes. When an agent crashes, hangs, or the manager restarts, child processes become orphaned (zombies). They continue consuming system resources (memory, CPU, API tokens) without being monitored or controlled. With 14+ agents, unmanaged zombie processes can exhaust system resources within hours. Worse: zombie agents may continue responding in Discord channels, creating ghost responses that conflict with newly-spawned replacement agents.

**Why it happens:**
Node.js child process management has well-documented pitfalls: child.kill() does not release the process from memory (just sends a signal), unref'd child processes inside worker threads become zombies, and ChildProcess instances are retained in the parent even after exit. Process group management is non-trivial on Linux -- killing the parent does not automatically kill children unless they share a process group.

**How to avoid:**
1. Track all spawned processes by PID in a persistent registry (file or SQLite). On manager startup, check for orphaned processes from previous runs and clean them up.
2. Use process groups: spawn agents in their own process group and use negative-PID kills to terminate the entire group.
3. Implement a heartbeat/health-check: if an agent process does not respond to a health ping within N seconds, forcefully terminate and restart it.
4. Always handle the 'close' and 'exit' events on child processes. Clean up the ChildProcess reference and remove from the active registry.
5. Use subprocess.disconnect() after exit to prevent memory leaks from retained ChildProcess instances.
6. Implement a PID file per agent: on startup, check if the PID file exists and the process is still running. If stale, clean up.
7. On manager shutdown, send SIGTERM to all agents, wait a grace period, then SIGKILL survivors.

**Warning signs:**
- System memory usage climbing over time without corresponding increase in agents
- `ps aux | grep claude` showing more processes than expected
- Multiple responses appearing in a single Discord channel
- Agent Manager restart leaves old agents running

**Phase to address:**
Phase 1 (Agent Manager core) -- process lifecycle management IS the Agent Manager's primary responsibility. This must be rock-solid before adding any features on top.

---

### Pitfall 5: Inter-Agent Communication Deadlocks and Cascading Failures

**What goes wrong:**
Agent A sends a message to Agent B and waits for a response. Agent B is at capacity, in compaction, or has crashed. Agent A blocks indefinitely. Meanwhile, Agent C is waiting on Agent A. The entire multi-agent system grinds to a halt with no explicit error signals -- monitoring just shows increased latency. Research shows coordination failures represent 37% of multi-agent system breakdowns.

**Why it happens:**
Developers implement synchronous request-response patterns between agents. In multi-agent LLM systems, simultaneous decisions produce deadlock rates up to 95-100% with 3+ agents. Adding neighbor-to-neighbor messaging does not reliably fix the problem -- messages arrive too late and agents often do not follow their stated plans.

**How to avoid:**
1. All inter-agent communication must be asynchronous and fire-and-forget with optional callbacks. Never block an agent waiting for another agent's response.
2. Implement circuit breakers: after N consecutive failures communicating with an agent, stop trying and route around it.
3. Use a message queue pattern (could be SQLite-backed or file-based) rather than direct agent-to-agent calls. Agents post messages; recipients poll or get notified.
4. Set hard timeouts on all inter-agent operations (5-10 seconds max for non-critical, 30 seconds for critical).
5. Design for graceful degradation: if an agent is unavailable, the requesting agent should continue with partial information rather than blocking.
6. Implement distributed tracing: tag every inter-agent message with a trace ID so cascading failure chains can be diagnosed.

**Warning signs:**
- Agent response times increasing without corresponding workload increase
- Agents producing partial or incomplete results
- Circular dependency patterns in agent communication logs
- Monitoring showing "healthy" agents that are actually blocked

**Phase to address:**
Phase 3 (Cross-agent communication) -- but the async-first architecture decision must be made in Phase 1 so the communication layer is designed correctly from the start.

---

### Pitfall 6: Discord Rate Limit Exhaustion with Multiple Bots

**What goes wrong:**
While rate limits are per-bot-token (each agent gets its own limits), all agents sharing a single bot token (likely in this architecture since they use the same Discord plugin) share the same rate limit bucket. 50 requests/second globally, with per-route limits. When multiple agents respond simultaneously in their channels, they collectively exhaust the rate limit. Discord returns 429 errors. If the system retries aggressively, it triggers the abuse detection: 10,000+ failed requests (401/403/429) in 10 minutes results in a minimum 1-hour IP ban.

**Why it happens:**
Developers test with 1-2 agents and never hit rate limits. At 14 agents, burst traffic (e.g., all agents responding to a broadcast, or multiple users messaging different agents simultaneously) easily exceeds 50 req/s. Rate limit headers are per-route, making coordination between independent processes complex.

**How to avoid:**
1. If using a single bot token: implement a centralized rate limiter (shared between all agent processes) that queues Discord API calls and respects global and per-route limits. A shared Redis/SQLite-backed token bucket is the standard approach.
2. Parse and respect X-RateLimit-Bucket, X-RateLimit-Remaining, and Retry-After headers on every response. Never hardcode rate limits.
3. Implement exponential backoff with jitter on 429 responses. Never retry immediately.
4. Consider using multiple bot tokens (one per agent or per agent-group) to get independent rate limit pools. This requires separate Discord bot applications.
5. Debounce agent responses: if an agent would send multiple messages in quick succession, batch them into a single message with formatting.
6. Implement a priority queue for Discord sends: admin commands and error notifications get priority over regular chat responses.

**Warning signs:**
- 429 errors appearing in Discord API responses
- Agent responses intermittently delayed or missing
- Discord API returning 1-hour bans
- Message send latency increasing during peak usage

**Phase to address:**
Phase 1 (Discord channel routing) -- rate limiting must be baked into the Discord communication layer from the start. Retrofitting rate limiting across 14 independent processes is a nightmare.

---

### Pitfall 7: Memory Poisoning via Hallucinated Context

**What goes wrong:**
An agent hallucinates a fact during conversation and writes it to persistent memory (SQLite semantic search, markdown logs). Subsequent agents or future sessions of the same agent retrieve this hallucinated "memory" as verified fact. Over time, the memory store accumulates incorrect information that compounds. The memory deduplication system may even elevate hallucinated facts to "authoritative" status if they appear across multiple logs.

**Why it happens:**
Memory systems that auto-persist conversation content without validation treat all agent outputs as equally trustworthy. The auto-consolidation pipeline (daily -> weekly -> monthly digests) further launders hallucinated content by stripping the original conversational context that might have signaled uncertainty.

**How to avoid:**
1. Classify memories by source: user-provided facts (HIGH trust), agent-derived conclusions (MEDIUM trust), and auto-extracted context (LOW trust). Store the trust level alongside the memory.
2. Never auto-persist agent reasoning or conclusions without a confidence marker. Only auto-persist user-stated facts and explicitly confirmed information.
3. Implement memory validation: before consolidation, cross-reference agent-derived memories against user-confirmed facts. Flag contradictions for human review.
4. Add provenance tracking: every memory entry stores the conversation turn, timestamp, and agent that created it. This enables audit trails.
5. Implement memory decay with trust weighting: LOW-trust memories decay faster than HIGH-trust ones.
6. During consolidation, preserve uncertainty markers. "User said X" is different from "Agent concluded X" and the consolidation pipeline must maintain this distinction.

**Warning signs:**
- Agent confidently stating facts that no user ever provided
- Contradictory memories in the same agent's memory store
- Memory consolidation producing summaries that don't match source material
- Users correcting agents on "facts" the agent insists it remembers

**Phase to address:**
Phase 2 (Memory system) -- the trust/provenance model must be part of the memory schema from the start. Adding trust levels to an existing flat memory store requires a data migration and is error-prone.

---

### Pitfall 8: Unbounded Memory Growth and Storage Bloat

**What goes wrong:**
Each agent generates daily markdown logs, conversation histories, semantic embeddings, and consolidated digests. With 14 agents running daily, storage accumulates rapidly. The SQLite database grows as embeddings accumulate. WAL files grow if checkpointing is neglected. Cold archive storage is never actually cleaned up. Within weeks, disk usage becomes a problem, and semantic search slows down as the index grows.

**Why it happens:**
The tiered storage design (hot/warm/cold) is specified but the cold tier often becomes a write-only graveyard. Developers implement the write path (archiving) but not the cleanup path (TTL-based deletion). Memory relevance decay is designed to reduce priority but not to actually delete anything. Embeddings for archived memories remain in the search index.

**How to avoid:**
1. Implement hard TTLs on cold storage from day one. Memories older than N days in cold storage get permanently deleted (with optional export).
2. Design the semantic search index to exclude cold-tier memories. Only hot and warm memories should be searchable by default.
3. Implement SQLite VACUUM on a schedule (weekly) to reclaim space from deleted rows.
4. Set WAL checkpoint thresholds: checkpoint when WAL exceeds 10MB.
5. Monitor per-agent storage usage and alert when any agent exceeds a threshold.
6. Implement log rotation for daily markdown logs: keep 30 days of daily logs, 12 weeks of weekly digests, 12 months of monthly digests. Delete older.

**Warning signs:**
- Disk usage climbing steadily without plateau
- Semantic search response times increasing
- WAL files measured in hundreds of megabytes
- SQLite database files exceeding expected size

**Phase to address:**
Phase 2 (Memory system) -- storage lifecycle management must be part of the initial memory implementation, not a "we'll clean up later" task.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Direct SQLite writes from each agent | Simpler architecture, no IPC needed | SQLITE_BUSY errors, write conflicts, data corruption risk | Never for production; OK for single-agent prototype only |
| Skipping rate limit coordination | Each agent operates independently | 429 errors at scale, potential IP bans | Only if using separate bot tokens per agent |
| Flat memory store (no trust levels) | Faster to implement, simpler schema | Memory poisoning, unreliable agent knowledge over time | MVP only, must add trust before multi-agent interactions |
| Synchronous inter-agent calls | Simpler mental model | Deadlocks, cascading failures | Never -- async-first is non-negotiable |
| No process registry (PID tracking) | Fewer moving parts in MVP | Zombie processes accumulate, resource exhaustion | Never -- process lifecycle is the manager's core job |
| Single compaction strategy for all agents | Uniform behavior | Identity drift in persona-heavy agents, task loss in work-heavy agents | Early MVP only, must customize per-agent type quickly |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Discord Plugin (shared bot token) | Assuming rate limits are per-process | Rate limits are per-token; centralize rate limiting across all agent processes |
| Discord message routing | Routing by channel ID only | Also handle threads, DMs, and message edits/deletes; bind agents to channel+thread combos |
| SQLite from multiple processes | Opening separate connections with default settings | WAL mode + busy_timeout(5000) + IMMEDIATE transactions + periodic checkpointing |
| Claude Code CLI spawning | Using child_process.fork() or exec() | Use spawn() for long-running processes; it provides stream-based I/O without buffering entire output |
| Claude Code auto-compaction | Relying on default compaction to preserve agent state | Hook into compaction lifecycle; inject custom preservation instructions before threshold is hit |
| Embedding providers for semantic search | Calling external APIs for every memory write | Batch embeddings, cache results, implement fallback for API failures |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full-table semantic search on every query | Search latency >500ms, CPU spikes | Index only hot+warm memories; use relevance score threshold cutoffs | >10,000 memories per agent |
| Uncontrolled WAL growth | Disk usage spikes, slow writes | Scheduled checkpointing (every 5 min or 10MB threshold) | >5 concurrent readers with continuous writes |
| All-agents-respond-at-once bursts | 429 errors, delayed messages | Stagger agent response times; implement response queuing | >8 agents responding within 1 second |
| Per-message memory writes | Write contention, I/O bottleneck | Batch memory writes; buffer in-memory and flush periodically | >50 messages/minute across all agents |
| Embedding computation per message | API cost explosion, latency | Batch embeddings every N messages or on a timer; skip low-value messages | >100 messages/day per agent |
| Unbounded conversation history in logs | Disk fills up, log parsing slows | Rotate daily, cap per-file size, implement structured logging | >30 days of continuous operation |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Admin agent credentials accessible to regular agents | Privilege escalation -- any agent could access all workspaces | Strict workspace isolation; admin agent in separate process group with distinct credentials |
| Discord bot token in shared config readable by all agents | Token theft allows impersonation of any agent | Token passed via environment variable to manager only; agents receive scoped channel access |
| Memory store contains user PII without access controls | Data leak between agents; GDPR/privacy violations | Per-agent memory isolation; no cross-agent memory reads without explicit admin bridge |
| Agent-spawned subagents inheriting parent permissions | Subagent could access parent's full workspace | Subagents run with minimal permissions; explicit capability grants only |
| SQLite database files world-readable | Any process on the system can read agent memories | Set file permissions to 600; database directory permissions to 700 |
| Inter-agent messages containing unvalidated user input | Prompt injection propagating across agent network | Sanitize all user input at the Discord ingestion layer before it enters any agent context |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Agent responds during compaction with degraded quality | Users see confused, off-topic, or personality-inconsistent responses | Queue incoming messages during compaction; send a "thinking..." indicator |
| Multiple agents responding to the same message | Confusing duplicate responses in Discord | Strict channel-to-agent binding; message deduplication at the routing layer |
| Agent restart loses conversation context | User has to repeat their request | Persist conversation state to disk; restore context on restart from last checkpoint |
| Long agent response times during peak load | Users think the bot is dead | Send typing indicators; implement response streaming; acknowledge receipt immediately |
| No feedback when agent is down | Users message into the void | Health monitoring with auto-restart; "agent offline" status in Discord |
| Memory consolidation changes how agent references past conversations | User says "remember when we discussed X" and agent can't find the specific conversation | Keep raw conversation logs alongside consolidated summaries; search both |

## "Looks Done But Isn't" Checklist

- [ ] **Agent Manager:** Can it handle manager crash + restart without losing track of running agents? Verify PID registry survives restarts.
- [ ] **Discord routing:** Does it handle edited messages, deleted messages, reactions, and thread creation? Not just new messages.
- [ ] **Memory system:** Does consolidation preserve provenance/trust metadata? Verify a consolidated memory can be traced to its source.
- [ ] **Auto-compaction:** Does the agent re-anchor its identity after compaction? Test by checking persona consistency before and after.
- [ ] **SQLite concurrency:** Does it work with 14 simultaneous writers? Test under actual concurrency, not sequential simulation.
- [ ] **Inter-agent communication:** Does it handle the recipient being mid-compaction or crashed? Test timeout and fallback paths.
- [ ] **Process cleanup:** After a hard kill (SIGKILL) of the manager, are all child processes also terminated? Test kill -9 scenarios.
- [ ] **Rate limiting:** Does it prevent 429s under burst load? Test 14 agents all responding within 1 second.
- [ ] **Cold storage cleanup:** Are old memories actually deleted, or just marked? Verify disk usage stabilizes over time.
- [ ] **Heartbeat system:** Does it detect a hung agent (process alive but unresponsive)? Not just crashed processes.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| SQLite corruption from WAL bug | HIGH | Restore from backup; implement regular automated backups; upgrade SQLite |
| Zombie process accumulation | LOW | Kill orphaned processes by PID; restart manager with clean registry |
| Memory poisoning | HIGH | Audit memory store for hallucinated entries; rebuild trust scores; manual cleanup |
| Identity drift | LOW | Restart agent session; re-inject identity files; verify with self-description test |
| Rate limit IP ban | MEDIUM | Wait out the ban (1+ hour); implement centralized rate limiter before resuming |
| Inter-agent deadlock | LOW | Restart blocked agents; implement timeouts to prevent recurrence |
| Disk exhaustion from logs/WAL | MEDIUM | Emergency cleanup of WAL files and old logs; implement rotation and TTL |
| Context loss after compaction | MEDIUM | Re-read identity and state files; manually re-inject critical context; consider session restart |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Context window amnesia | Phase 1: Agent Manager | Heartbeat monitors context %; compaction uses curated instructions |
| SQLite concurrent access | Phase 1: Memory foundation | Load test with 14 concurrent writers; zero SQLITE_BUSY errors |
| Identity drift | Phase 2: Agent identity | Persona consistency test after 50+ messages and 2+ compactions |
| Zombie processes | Phase 1: Agent Manager | Kill -9 manager; verify all children terminated; restart cleanly |
| Inter-agent deadlocks | Phase 3: Cross-agent communication | Timeout test: block one agent, verify others continue operating |
| Discord rate limits | Phase 1: Discord routing | Burst test: 14 agents respond simultaneously; zero 429 errors |
| Memory poisoning | Phase 2: Memory system | Inject hallucinated content; verify trust scoring flags it |
| Storage bloat | Phase 2: Memory system | Run 30-day simulation; verify disk usage plateaus |

## Sources

- [SQLite WAL Documentation](https://www.sqlite.org/wal.html)
- [SQLite Concurrent Writes and "database is locked" Errors](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/)
- [Abusing SQLite to Handle Concurrency](https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/)
- [SQLite File Locking and Concurrency](https://sqlite.org/lockingv3.html)
- [Discord Rate Limits Documentation](https://docs.discord.com/developers/topics/rate-limits)
- [Handling Rate Limits at Scale (Xenon Bot)](https://blog.xenon.bot/handling-rate-limits-at-scale-fb7b453cb235)
- [Discord API Rate Limiting Guide 2026](https://space-node.net/blog/discord-bot-rate-limiting-guide-2026)
- [Why Multi-Agent AI Systems Fail (Galileo)](https://galileo.ai/blog/multi-agent-ai-failures-prevention)
- [Why Do Multi-Agent LLM Systems Fail? (arXiv)](https://arxiv.org/abs/2503.13657)
- [Examining Identity Drift in Conversations of LLM Agents (arXiv)](https://arxiv.org/abs/2412.00804)
- [Understanding Persona Drift in LLMs](https://www.emergentmind.com/topics/persona-drift)
- [Claude Code Context Management](https://claudefa.st/blog/guide/mechanics/context-management)
- [Claude Code Auto-Compact Explained](https://lalatenduswain.medium.com/understanding-context-left-until-auto-compact-0-in-claude-cli-b7f6e43a62dc)
- [Claude Code Memory Documentation](https://code.claude.com/docs/en/memory)
- [Node.js Child Process Documentation](https://nodejs.org/api/child_process.html)
- [Node.js Zombie Process Issue #46569](https://github.com/nodejs/node/issues/46569)

---
*Pitfalls research for: ClawCode multi-agent Claude Code orchestration*
*Researched: 2026-04-08*
