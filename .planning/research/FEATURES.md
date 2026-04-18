# Feature Research: Persistent Conversation Memory

**Domain:** Conversation persistence + retrieval for multi-agent orchestration (ClawCode v1.9)
**Researched:** 2026-04-17
**Confidence:** HIGH

## Scope Note

This research covers ONLY what is NEW for v1.9. The following already exist and are not re-covered:
- Per-agent SQLite memory stores with semantic search (v1.0)
- Memory consolidation daily->weekly->monthly (v1.1)
- Relevance decay, dedup, tiered hot/warm/cold (v1.1)
- Context summary on resume (v1.1, budget-enforced in v1.7)
- memory_lookup MCP tool for on-demand search (v1.5)
- Episode-based memory (v1.2)
- Knowledge graph with auto-linking (v1.5-v1.6)
- Context assembly pipeline with per-source budgets (v1.5, v1.7)

## Feature Landscape

### Table Stakes (Users Expect These)

Features that make "persistent conversation memory" actually work. Without these, the system just has generic memory -- not conversation continuity.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Structured turn storage** | Raw conversation turns must be queryable by session, time range, and content -- not just appended to daily markdown files. The existing `SessionLogger` writes unstructured markdown; agents cannot query "what did user X say yesterday about topic Y" without parsing markdown. | MEDIUM | New `conversation_turns` table in per-agent SQLite. Schema: `id, session_id, turn_index, role, content, channel_id, user_id, timestamp, token_count`. Embeddings optional at write time (batch later). |
| **Session boundary tracking** | Every session (from agent start to stop/crash/compaction) needs an explicit record: start time, end time, turn count, summary. Without this, "last session" and "two sessions ago" are undefined. | LOW | New `sessions` table: `id, agent_name, started_at, ended_at, turn_count, summary_id, status (active/ended/crashed)`. Write row on session start, update on end/crash. |
| **Session-end summarization** | When a session ends, raw turns must be compressed into key facts, decisions, and user preferences. This is the bridge between raw history and retrievable knowledge. Existing compaction extracts memories, but does not produce a session-scoped narrative summary tied to a session_id. | MEDIUM | Run LLM summarization on session turns at session boundary. Store result in `session_summaries` table linked to session_id. Use haiku for cost efficiency -- these are internal summaries, not user-facing. Depends on: session boundary tracking, structured turn storage. |
| **Auto-inject on resume** | When an agent restarts, it should receive a structured brief of recent sessions -- not just the last compaction summary. "You last spoke with user X about Y, decided Z, and they prefer A." The existing `context-summary.md` is compaction-driven, not session-driven. | MEDIUM | Build a `ConversationResumeBrief` that assembles: (1) last N session summaries, (2) active user preferences, (3) unresolved topics. Feed into context assembly pipeline's `resumeSummary` slot. Respects existing 1500-token budget. Depends on: session-end summarization. |
| **Semantic search over conversation history** | Agent must be able to search past conversations by meaning, not just recent memory. "What did we discuss about the deployment?" should find relevant turns from weeks ago. The existing `memory_lookup` MCP tool searches the memories table -- not raw conversation turns. | MEDIUM | Embed conversation turns (batch, not inline) and store in `vec_conversation_turns` virtual table. Extend `memory_lookup` MCP tool with a `source: "conversations"` parameter, or add a `conversation_search` tool. KNN over turn embeddings + optional session_id filter. Depends on: structured turn storage. |
| **Cross-session continuity** | "Last time we talked about X" must be answerable. This is the whole point -- if the agent cannot reference prior sessions naturally, persistent memory has failed. | LOW (integration) | Not a separate feature -- it is the emergent behavior of the above four features working together. The resume brief gives recent context; conversation_search gives deep retrieval. No new code beyond wiring. |

### Differentiators (Competitive Advantage)

Features that go beyond baseline conversation persistence. These make ClawCode agents feel genuinely intelligent about their history.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Fact extraction from turns** | Instead of just summarizing sessions, extract structured facts ("user prefers dark mode", "project deadline is May 15") and store as first-class memory entries with `source: "conversation"`. Facts persist across consolidation cycles and feed into the knowledge graph. | MEDIUM | Post-session LLM pass that extracts facts as individual memory entries (not just a narrative summary). Each fact gets embedded and auto-linked via the existing knowledge graph pipeline. Reuses `calculateImportance()` for scoring. Depends on: session-end summarization. |
| **User preference tracking** | Explicitly track user preferences extracted from conversations. Preferences are high-importance, slow-decay facts that persist longer than general conversation memories. Tag with `["preference", "user:<id>"]` for targeted retrieval. | LOW | Tag-based filtering on extracted facts. No new storage -- uses existing memory store with specific tags + elevated importance (0.8+). The existing tier system naturally promotes frequently-accessed preferences to hot tier. |
| **Conversation topic threading** | Group turns within a session by topic/subject, enabling "we discussed three things: X, Y, Z" rather than treating a session as one monolithic block. | HIGH | Requires topic segmentation -- either rule-based (detect subject shifts via embedding distance between consecutive turns) or LLM-based. Adds a `topic_id` to turns. Defer to v1.10+ unless the summarizer naturally produces per-topic breakdowns. |
| **Temporal-aware retrieval** | When searching conversation history, weight recency alongside semantic similarity. "What did we discuss about deployments?" should favor last week's conversation over last month's, all else equal. | LOW | Already have relevance decay infrastructure in `decay.ts`. Apply the same `combinedScore = semantic * weight + decay * weight` formula to conversation turn search results. Reuse `halfLifeDays` config. |
| **Proactive context surfacing** | Agent detects that the current conversation relates to a prior one and proactively mentions it: "This reminds me of our discussion on April 3rd about..." without being asked. | HIGH | Requires per-turn similarity check against recent session summaries. Could use the existing auto-link heartbeat pattern -- run a lightweight embedding comparison of the current message against recent session summaries, surface top match if above threshold. Expensive if done every turn; better as a periodic check or triggered by topic keywords. Defer unless the resume brief already covers most cases. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Store every turn with full embeddings inline** | "We need semantic search, so embed everything at write time" | Embedding every turn synchronously adds ~50ms latency per message. At 14 agents handling concurrent conversations, that is 700ms+ of embedding work per burst. Writes should be fast; embeddings are a read-optimization. | Batch-embed turns asynchronously. Write raw turns immediately, queue embedding jobs for a background heartbeat or post-session pass. |
| **Full conversation replay in context** | "Just inject the last 50 turns so the agent remembers everything" | 50 turns at ~100 tokens each = 5000 tokens. The context assembly pipeline has a total ceiling. Stuffing raw turns competes with identity, skills, hot memories, and graph context. Diminishing returns after ~10 turns. | Session summaries + on-demand search. The resume brief gives the agent the gist; `conversation_search` tool lets it pull specific turns when needed. |
| **Cross-agent conversation sharing** | "Agent A should see what Agent B discussed with the user" | Violates workspace isolation (explicit design constraint from PROJECT.md). Cross-agent memory sharing introduces consistency problems and privacy concerns. | Use the existing cross-agent messaging (v1.6) for explicit handoffs. Agent A can ask Agent B "what did you discuss with user X about Y?" via IPC. The admin agent already has cross-workspace access. |
| **Real-time conversation streaming to persistent store** | "Write every token as it streams in" | SQLite write contention under streaming. The TurnDispatcher already manages turn lifecycle -- waiting for turn completion before persisting is cleaner and avoids partial-turn corruption. | Persist complete turns only. Buffer in memory during streaming, write to SQLite when the turn ends (success or error). |
| **LLM-powered entity extraction on every turn** | "Extract entities in real-time for the knowledge graph" | Doubles token cost per turn. The project explicitly lists "LLM-powered entity/relation extraction -- doubles token cost on writes" as out of scope. | Extract facts at session boundaries (batch). The auto-linker heartbeat (v1.6) handles graph connections on the already-stored memories. |
| **Unlimited conversation retention without compaction** | "Never delete anything, disk is cheap" | SQLite vec search degrades past ~100K vectors per table. Token cost of searching grows. More importantly, ancient conversations are noise -- relevance decay exists for a reason. | Time-windowed retention with configurable TTL. Archive conversations older than N days to cold storage (existing tier system). Summaries persist; raw turns eventually age out. |

## Feature Dependencies

```
[Structured Turn Storage]
    |
    +--requires--> [Session Boundary Tracking]
    |                   |
    |                   +--enables--> [Session-End Summarization]
    |                                       |
    |                                       +--enables--> [Auto-Inject on Resume]
    |                                       |
    |                                       +--enables--> [Fact Extraction from Turns]
    |                                                          |
    |                                                          +--enables--> [User Preference Tracking]
    |
    +--enables--> [Semantic Search over History]
    |                   |
    |                   +--enhanced-by--> [Temporal-Aware Retrieval]
    |
    +--enables--> [Conversation Topic Threading] (deferred)

[Auto-Inject on Resume] --integrates-with--> [Context Assembly Pipeline] (existing v1.5/v1.7)
[Semantic Search over History] --integrates-with--> [memory_lookup MCP Tool] (existing v1.5)
[Fact Extraction] --integrates-with--> [Knowledge Graph Auto-Linker] (existing v1.6)
[Temporal-Aware Retrieval] --reuses--> [Relevance Decay] (existing v1.1)
```

### Dependency Notes

- **Structured Turn Storage requires Session Boundary Tracking:** Turns must belong to a session. The session_id foreign key is how we partition history into discrete conversations.
- **Session-End Summarization requires both:** Cannot summarize a session without knowing which turns belong to it and when it ended.
- **Auto-Inject requires Session-End Summarization:** The resume brief is built from session summaries. Without summaries, the brief would need to process raw turns at resume time (too slow, too many tokens).
- **Fact Extraction enhances Session-End Summarization:** Facts are extracted alongside the narrative summary. Same LLM call can produce both (structured output with summary + facts array).
- **Semantic Search over History is independent of summarization:** Can be built in parallel. Only requires structured turn storage + batch embeddings.

## MVP Definition

### Launch With (Core v1.9)

Minimum set that delivers "agents remember conversations across sessions."

- [x] **Structured turn storage** -- `conversation_turns` + `sessions` tables in per-agent SQLite. Every Discord message exchange persisted with session_id, role, content, timestamp, channel_id. This is the foundation everything else builds on.
- [x] **Session boundary tracking** -- Explicit session lifecycle (start/end/crash). The TurnDispatcher and session-manager already know when sessions start and stop; this adds the persistence layer.
- [x] **Session-end summarization** -- LLM-generated summary at session boundary. Compress turns into key facts, decisions, preferences. Store linked to session_id. Use haiku model for cost.
- [x] **Auto-inject on resume** -- Build `ConversationResumeBrief` from last N session summaries. Integrate into context assembly pipeline's `resumeSummary` source. Replace the current compaction-driven context-summary.md with session-aware brief.
- [x] **Conversation search tool** -- Extend memory_lookup or add conversation_search MCP tool. Semantic search over embedded conversation turns. Enables deep retrieval beyond the auto-injected brief.

### Add After Validation (v1.9.x)

Features to add once core conversation persistence is proven stable.

- [ ] **Fact extraction** -- Add structured fact extraction to the session-end summarization pass. Extract as individual memory entries with conversation source + knowledge graph auto-linking.
- [ ] **User preference tracking** -- Tag extracted preferences with elevated importance + user-specific tags. Verify hot-tier promotion works for frequently-referenced preferences.
- [ ] **Temporal-aware retrieval** -- Apply relevance decay weighting to conversation search results. Verify the existing decay formula works well for conversation turns (may need different halfLifeDays).
- [ ] **Batch embedding optimization** -- Profile embedding throughput under real load. Tune batch size and scheduling for the background embedding heartbeat.

### Future Consideration (v2+)

Features to defer until conversation memory proves its value.

- [ ] **Conversation topic threading** -- Topic segmentation within sessions. HIGH complexity, uncertain value over session-level summaries.
- [ ] **Proactive context surfacing** -- Per-turn similarity check against prior sessions. HIGH cost per turn, may not justify the compute overhead.
- [ ] **Cross-agent conversation handoff context** -- When Agent A hands off to Agent B, include relevant conversation history in the handoff payload. Requires careful privacy controls.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Structured turn storage | HIGH | MEDIUM | P1 |
| Session boundary tracking | HIGH | LOW | P1 |
| Session-end summarization | HIGH | MEDIUM | P1 |
| Auto-inject on resume | HIGH | MEDIUM | P1 |
| Conversation search tool | HIGH | MEDIUM | P1 |
| Fact extraction from turns | MEDIUM | MEDIUM | P2 |
| User preference tracking | MEDIUM | LOW | P2 |
| Temporal-aware retrieval | MEDIUM | LOW | P2 |
| Batch embedding optimization | MEDIUM | LOW | P2 |
| Conversation topic threading | LOW | HIGH | P3 |
| Proactive context surfacing | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.9 launch -- these ARE the milestone
- P2: Should have, add in v1.9.x once core is validated
- P3: Nice to have, defer to future milestone

## Existing Infrastructure Reuse Map

Critical for implementation -- what v1.9 builds ON vs. builds NEW.

| Existing Component | How v1.9 Uses It | New Work Required |
|-------------------|-------------------|-------------------|
| `MemoryStore` (store.ts) | Hosts new tables via migration. Reuse `getDatabase()` for raw SQL access to conversation_turns. | Add `conversation_turns`, `sessions`, `session_summaries` tables via new migration methods. |
| `SessionLogger` (session-log.ts) | **Replace or augment.** Currently writes unstructured markdown. v1.9 writes structured SQLite rows instead. Keep markdown as human-readable archive, but SQLite is the source of truth. | New `ConversationTurnStore` class that wraps per-agent SQLite. SessionLogger can continue writing markdown as a side effect. |
| `CompactionManager` (compaction.ts) | Reuse the flush+extract+embed pattern. Session-end summarization follows the same workflow: flush turns, extract facts, embed, store. | Factor out the extract+embed pipeline into a shared function. Compaction and session-end summarization both call it. |
| `context-summary.ts` | **Enhance.** Currently loads a single `context-summary.md` file. v1.9 builds a richer `ConversationResumeBrief` from multiple session summaries. The `enforceSummaryBudget()` function remains the budget gate. | New `buildResumeBrief()` function that reads session_summaries, assembles brief, passes through `enforceSummaryBudget()`. |
| `context-assembler.ts` | **Wire in.** The `contextSummary` / `resumeSummary` source slot already exists. v1.9 populates it with the conversation resume brief instead of the static context-summary.md. | Update `session-config.ts` to call `buildResumeBrief()` instead of `loadLatestSummary()`. |
| `EmbeddingService` (embedder.ts) | Reuse for batch-embedding conversation turns. The singleton embedder is already warmed at daemon startup (v1.7). | No new work. Call `embedder.embed()` in batch during post-session processing. |
| `TurnDispatcher` (turn-dispatcher.ts) | **Hook into.** Every turn flows through TurnDispatcher. This is where we intercept to persist turns to SQLite. The dispatcher's `dispatch()` and `dispatchStream()` methods are the natural persistence hook points. | Add a `ConversationTurnPersister` that the dispatcher calls after successful turn completion. |
| `AgentMemoryManager` (session-memory.ts) | **Extend.** Already manages per-agent MemoryStore, SessionLogger, EpisodeStore, etc. Add ConversationTurnStore to its lifecycle. | Add `conversationTurnStores: Map<string, ConversationTurnStore>` and wire init/cleanup. |
| `memory_lookup` MCP tool | **Extend.** Add `source: "conversations"` parameter to search conversation turns in addition to memories. | Update tool schema and handler to support conversation turn search. |
| Relevance decay (decay.ts) | Reuse for temporal-aware conversation retrieval. Same formula, potentially different halfLifeDays. | Config extension only -- add `conversationDecay` to memory config schema. |
| Knowledge graph (graph.ts) | Extracted facts auto-link via existing `autoLinkMemory()`. No changes needed to graph infrastructure. | None -- facts are standard memory entries that flow through existing graph pipeline. |

## Competitor Feature Analysis

| Feature | Zep | MemGPT/Letta | Mem0 | ClawCode v1.9 Approach |
|---------|-----|--------------|------|------------------------|
| Turn storage | Temporal knowledge graph edges | Recall memory table (all turns logged) | Structured memory entries extracted from turns | SQLite `conversation_turns` table per agent. Queryable, embeddable, session-scoped. |
| Session summarization | Automatic via Graphiti pipeline | Context compaction when window fills | Async extraction to long-term store | LLM summarization at session boundary. Haiku model for cost. Structured summary + facts. |
| Auto-inject on resume | Graph-enriched context from temporal KG | Core memory always in-context | Relevant memories injected via API | Resume brief from last N session summaries. Fits existing context assembly pipeline. Budget-enforced at 1500 tokens. |
| Cross-session search | Temporal graph traversal with event/ingestion time axes | `conversation_search` tool (text + date search) | Semantic search over extracted memories | KNN over embedded turns + session_id filtering. Extends existing memory_lookup. |
| Fact extraction | Automatic entity/relation extraction with temporal edges | Agent-driven (agent decides what to archive) | Async LLM extraction on new messages | Session-boundary batch extraction. Avoids per-turn cost. Feeds into knowledge graph. |
| Temporal awareness | First-class temporal edges (event time + ingestion time) | Date-range search filters | Recency-weighted retrieval | Relevance decay formula applied to conversation search. Reuses existing infrastructure. |

## Sources

- [Zep: Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/html/2501.13956v1) -- Session summarization, fact extraction, temporal awareness patterns
- [MemGPT/Letta: Understanding Memory Management](https://docs.letta.com/advanced/memory-management/) -- Tiered storage, conversation_search tool, archival/recall pattern
- [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/pdf/2504.19413) -- Async extraction, long-term persistence patterns
- [OpenAI Agents SDK: Session Memory](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory) -- Session boundary detection, turn-boundary summarization, keep_last_n_turns
- [Memoria: Scalable Agentic Memory for Personalized AI](https://arxiv.org/abs/2512.12686) -- Session-level summarization, weighted knowledge graphs, user modeling
- [Multi-Layered Memory Architectures for LLM Agents](https://arxiv.org/html/2603.29194) -- Working/episodic/semantic memory layers, retention stability
- [Analytics Vidhya: Memory Systems in AI Agents (April 2026)](https://www.analyticsvidhya.com/blog/2026/04/memory-systems-in-ai-agents/) -- Current architecture patterns
- [Spring AI Session API: Event-Sourced Short-Term Memory](https://spring.io/blog/2026/04/15/spring-ai-session-management/) -- Turn-boundary snapping, recursive summarization
- [LLM Chat History Summarization Best Practices (Mem0)](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025) -- Summarization strategies, keep_last_n patterns
- [Oracle: Agent Memory -- Why Your AI Has Amnesia](https://blogs.oracle.com/developers/agent-memory-why-your-ai-has-amnesia-and-how-to-fix-it) -- Four memory types (working, procedural, semantic, episodic)

---
*Feature research for: Persistent Conversation Memory (ClawCode v1.9)*
*Researched: 2026-04-17*
