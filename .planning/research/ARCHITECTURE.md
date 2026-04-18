# Architecture: Persistent Conversation Memory Integration

**Domain:** Conversation memory for multi-agent orchestration
**Researched:** 2026-04-17
**Confidence:** HIGH (based on deep reading of existing codebase)

---

## Existing Architecture Snapshot

### Components That Touch Conversation Flow

```
Discord User
     |
     v
DiscordBridge.handleMessage()
     |  formats message via formatDiscordMessage()
     |  opens Turn + receive span (Phase 50)
     |  fires typing indicator (Phase 54)
     v
TurnDispatcher.dispatchStream()
     |  attaches TurnOrigin (discord:<snowflake>)
     |  caller-owned Turn lifecycle
     v
SessionManager.streamFromAgent()
     |  delegates to SessionHandle.sendAndStream()
     v
Claude Code SDK (agent session)
     |  returns response text + streaming chunks
     v
DiscordBridge.streamAndPostResponse()
     |  posts to Discord via webhook/channel.send
     |  ends Turn (success/error)
```

### Per-Agent SQLite Databases (Existing)

| Database | Location | Purpose |
|----------|----------|---------|
| `memories.db` | `<workspace>/memory/` | Knowledge entries + vec_memories + session_logs + memory_links |
| `usage.db` | `<workspace>/memory/` | Token/cost tracking |
| `traces.db` | `<workspace>/` | Per-turn latency spans |
| `tasks.db` | `~/.clawcode/manager/` | Shared task store (cross-agent) |

### Existing Memory Pipeline

```
MemoryStore (memories.db)
  - memories table: id, content, source, importance, tags, tier, timestamps
  - vec_memories: 384-dim float32 embeddings (sqlite-vec)
  - session_logs: date, file_path, entry_count
  - memory_links: adjacency list for knowledge graph

SessionLogger -> daily markdown files (<workspace>/memory/YYYY-MM-DD.md)
CompactionManager -> flush conversation + extract facts + embed + insert
ConsolidationManager -> weekly/monthly digests from daily logs
TierManager -> hot/warm/cold tier lifecycle
EpisodeStore -> discrete events as memory entries (source="episode")
```

### Context Assembly Pipeline (session-config.ts + context-assembler.ts)

```
buildSessionConfig()
  |
  +--> reads SOUL.md, IDENTITY.md, fingerprint
  +--> hot memories from TierManager (top 3)
  +--> skills header (lazy compression)
  +--> tool definitions (MCP, admin, subagent)
  +--> discord bindings
  +--> context summary from context-summary.md (budget-enforced)
  |
  v
assembleContext()
  |
  +--> stablePrefix (cached via SDK preset.append):
  |      identity + soul + hot memories (stable) + tools + graph context
  |
  +--> mutableSuffix (per-turn, outside cache):
  |      discord bindings + per-turn summary + resume summary
  |
  v
AgentSessionConfig { systemPrompt, mutableSuffix, hotStableToken }
```

---

## The Gap: What Conversation Memory Needs

The existing system has building blocks but they do NOT form a conversation memory pipeline:

1. **SessionLogger** writes daily markdown files but there is NO mechanism to capture every Discord turn as a structured SQLite row. The markdown files are human-readable logs, not a query-ready store.

2. **CompactionManager** extracts facts from conversation when context fills up. This is reactive (triggered by context fill threshold), not proactive. It creates `source="conversation"` memories but loses the turn structure.

3. **Context summary** is a single file (`context-summary.md`) overwritten on each compaction. It is injected on session restart but has no session history depth -- just the latest compaction.

4. **There is NO conversation turn table.** The `session_logs` table tracks daily markdown files, not individual turns. There is no `conversation_turns` table with user/assistant pairs, session boundaries, or turn-level embeddings.

5. **There is NO session-boundary summarization.** When a session stops/crashes, nothing summarizes "what happened this session." The `context-summary.md` is from the last compaction event, which may not align with session boundaries.

6. **The `memory_lookup` MCP tool** searches the knowledge store (semantic KNN over `vec_memories`), but has no awareness of conversation history. An agent cannot search "what did the user say about X last week."

---

## Recommended Architecture

### New Component: ConversationStore

A new SQLite table in the existing `memories.db` database (per-agent, shares the same `better-sqlite3` connection).

```sql
CREATE TABLE conversation_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  channel_id TEXT,
  discord_message_id TEXT,
  token_count INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, turn_index, role)
);

CREATE INDEX idx_turns_session ON conversation_turns(session_id, turn_index);
CREATE INDEX idx_turns_created ON conversation_turns(created_at);
CREATE INDEX idx_turns_channel ON conversation_turns(channel_id);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_turns USING vec0(
  turn_id TEXT PRIMARY KEY,
  embedding float[384] distance_metric=cosine
);
```

**Why in memories.db, not a new DB:** The existing `MemoryStore` opens `memories.db` and the warmup path primes it. Adding a table avoids a new file handle, a new warm-path entry, and cross-DB join pain. The `memories.db` WAL-mode connection is already configured with `busy_timeout = 5000`.

### New Component: SessionSummarizer

Generates structured summaries at session boundaries (stop, crash, restart).

```
SessionManager.stopAgent() / crash handler
     |
     v
SessionSummarizer.summarizeSession(agentName, sessionId)
     |  reads conversation_turns WHERE session_id = ?
     |  builds summary prompt (key facts, decisions, preferences, open threads)
     |  calls haiku via SDK --print mode
     |  writes summary as memory entry (source="conversation", importance=0.8)
     |  also saves to context-summary.md for resume injection
     v
MemoryStore.insert({ source: "conversation", tags: ["session-summary", sessionId] })
```

**Who summarizes?** The daemon, NOT the agent. Use a lightweight haiku call via the SDK's `--print` mode. This is the same pattern as `ConsolidationDeps.summarize`.

### New Component: ConversationSearcher

Extends semantic search to cover conversation turns alongside knowledge memories.

```
memory_lookup MCP tool (enhanced)
     |  existing: searches vec_memories
     |  new: also searches vec_turns when scope includes conversations
     v
ConversationSearcher.searchTurns(query, agentName, options)
     |  KNN over vec_turns
     |  returns turn + surrounding context (prev/next turns)
     v
Formatted conversation snippets with timestamps and session context
```

---

## Complete Data Flow: Capture -> Store -> Summarize -> Retrieve -> Inject

### 1. Capture (Real-Time, Non-Blocking)

```
Discord message arrives
  -> DiscordBridge.handleMessage()
  -> TurnDispatcher.dispatchStream()
  -> response from Claude Code SDK
  -> DiscordBridge posts response to Discord
  -> CAPTURE: ConversationStore.recordTurnPair(userMsg, assistantMsg)
       |  inserts into conversation_turns (2 rows)
       |  queues embedding generation (background)
       |  updates turn_index counter for this session
```

**When:** Immediately after response posted to Discord. Fire-and-forget.
**What:** Both user message and assistant response as separate rows.
**Where:** `memories.db` conversation_turns table.

### 2. Embed (Background, Async)

```
ConversationStore.recordTurnPair() completes synchronous insert
  -> schedules embedding via setImmediate / microtask
  -> EmbeddingService.embed("User: {msg}\nAssistant: {response}")
  -> on success: INSERT INTO vec_turns
  -> on failure: log warning (non-fatal, retry on next heartbeat)
```

**Strategy:** Embed the PAIR as one text blob with the assistant turn's ID. Most retrieval queries target topics, not individual speakers.

### 3. Summarize (Session Boundary)

```
SessionManager.stopAgent() OR crash handler fires
  -> ConversationStore.getTurnsForSession(sessionId)
  -> if turns.length > 0:
     -> SessionSummarizer.generateSummary(turns)
        |  builds structured prompt
        |  calls haiku via SDK --print (10s timeout)
        |  outputs: key_facts, decisions, user_preferences, open_threads
     -> MemoryStore.insert(summary, source="conversation",
                           tags=["session-summary", sessionId],
                           importance=0.8)
     -> saveSummary() to context-summary.md (overwrite)
  -> on failure: save raw last-5 turns as fallback summary
```

**Model:** haiku for cost efficiency (~500 tokens output for a 20-turn conversation).
**Timeout:** 10s hard limit. Fallback to raw-turn text extraction on timeout.

### 4. Retrieve (On-Demand, Via MCP Tool)

```
Agent calls memory_lookup(query, agent, scope="conversations")
  -> IPC to daemon handler
  -> ConversationSearcher.searchTurns(query, agentName, limit)
     |  EmbeddingService.embed(query)
     |  KNN over vec_turns (top K)
     |  for each hit: load surrounding turns (+-2 turns context window)
     |  format as conversation snippets with timestamps
  -> return formatted results to agent
```

**When:** Agent self-directs when it needs historical context.
**Format:** Each result includes conversation snippet, session date, similarity score.

### 5. Inject (Session Resume, Automatic)

```
SessionManager.startAgent() / reconcileRegistry()
  -> buildSessionConfig(config, deps)
     |
     +--> MemoryStore.findByTag("session-summary")
     |      ordered by created_at DESC, limited to 3
     |      renders as structured "## Recent Sessions" section
     |
     +--> flows into contextSummaryStr / resumeSummary slot
     |
     v
  assembleContext() -> mutableSuffix includes session history
```

**Budget:** Fits within existing `resume_summary` budget (1500 tokens default). 3 summaries at ~200 tokens each = ~600 tokens.
**No new context section needed.** Uses existing `resumeSummary` slot.

---

## Component Boundary Map

| Component | Responsibility | Communicates With | Status |
|-----------|---------------|-------------------|--------|
| `ConversationStore` | Turn CRUD, embedding queue, session indexing | MemoryStore (shares DB), EmbeddingService | **NEW** |
| `SessionSummarizer` | Session-boundary summaries via haiku | ConversationStore, MemoryStore, SDK --print | **NEW** |
| `ConversationSearcher` | KNN search over conversation turns | ConversationStore, EmbeddingService | **NEW** |
| `DiscordBridge` | Capture point: records turn pairs after response | ConversationStore | **MODIFIED** (~5 lines) |
| `SessionManager` | Triggers summarization on stop/crash | SessionSummarizer | **MODIFIED** (~10 lines) |
| `AgentMemoryManager` | Init/cleanup ConversationStore per agent | ConversationStore | **MODIFIED** (~15 lines) |
| `buildSessionConfig` | Loads session summaries for injection | MemoryStore (findByTag) | **MODIFIED** (~20 lines) |
| `MCP server` | Enhanced memory_lookup with scope param | ConversationSearcher, IPC | **MODIFIED** (~30 lines) |

---

## Integration Points (Detailed)

### 1. DiscordBridge (src/discord/bridge.ts)

**Hook point:** End of `streamAndPostResponse()`, after `turn?.end("success")` on line 625.

Insert fire-and-forget capture of both user message and assistant response. The `sessionName` is already in scope. The `sessionId` comes from the registry entry or the SessionHandle.

**Risk:** LOW. Fire-and-forget. Failure logged, never thrown. Does not touch the Discord response path.

### 2. SessionManager (src/manager/session-manager.ts)

**Hook point:** `stopAgent()` before `handle.close()` (line ~425), and inside the `handle.onError` crash callback (line ~260).

Call `SessionSummarizer.summarizeSession()` with a 10s timeout. On failure, log warning and continue -- session stop MUST NOT be blocked by summarization failure.

**Risk:** MEDIUM. External haiku call could timeout. Hard timeout + fallback mitigates this.

### 3. AgentMemoryManager (src/manager/session-memory.ts)

**Hook point:** `initMemory()` after `this.memoryStores.set(name, store)` (line ~57).

Create ConversationStore using same DB connection (`store.getDatabase()`). Add to new `conversationStores` Map. Add cleanup in `cleanupMemory()`.

**Risk:** LOW. Same DB connection. Schema migration is idempotent (CREATE TABLE IF NOT EXISTS).

### 4. Context Assembly (src/manager/session-config.ts)

**Hook point:** After loading context summary (line ~274), before assembleContext call.

Load recent `session-summary` tagged memories from the existing MemoryStore. Format as a structured brief. Inject via the existing `resumeSummary` / `contextSummary` slot.

**Risk:** LOW. Uses existing MemoryStore.findByTag(). Budget enforcement is already in place.

### 5. MCP Server (src/mcp/server.ts)

**Hook point:** `memory_lookup` tool handler (line ~419).

Add optional `scope` parameter: `"all"` (default, backward-compatible), `"conversations"`, `"knowledge"`. Route to ConversationSearcher when scope includes conversations. Add corresponding IPC handler in daemon.

**Risk:** LOW. New parameter has a backward-compatible default.

### 6. TurnDispatcher -- NO CHANGES

TurnDispatcher is a pure routing chokepoint. Capture happens AFTER the turn completes, in the caller (DiscordBridge). No modification needed.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Capturing Inside TurnDispatcher
**Why bad:** TurnDispatcher handles ALL turn sources (Discord, scheduler, handoffs). Scheduler and handoff turns are system interactions, not user conversations.
**Instead:** Capture in DiscordBridge only.

### Anti-Pattern 2: Synchronous Embedding on Capture
**Why bad:** Embedding takes ~50ms. With 14 concurrent agents, this adds latency to every Discord response.
**Instead:** Insert turn row immediately (no embedding), queue embedding as background work.

### Anti-Pattern 3: New SQLite Database for Conversations
**Why bad:** Adds file handle, warm-path entry, lifecycle manager overhead.
**Instead:** Add tables to existing `memories.db` via schema migration.

### Anti-Pattern 4: Using the Agent to Summarize Its Own Session
**Why bad:** The session is ending (possibly crashing). Adding a turn to a dying session is a race condition.
**Instead:** Use a separate haiku `--print` call from the daemon process.

### Anti-Pattern 5: Storing Summaries in Hot Tier
**Why bad:** Hot tier has a budget of 20 entries. Session summaries are verbose. They starve knowledge memories.
**Instead:** Keep summaries in warm tier. They flow into the prompt via `resumeSummary` slot (budget-controlled).

---

## Suggested Build Order

### Phase 1: ConversationStore + Schema
**Dependencies:** MemoryStore (existing), EmbeddingService (existing)
**Deliverables:** `src/memory/conversation-store.ts`, schema migration, CRUD methods, unit tests.
**Why first:** Everything downstream needs a place to write turns.

### Phase 2: Capture Integration (DiscordBridge)
**Dependencies:** ConversationStore (Phase 1)
**Deliverables:** Wire into AgentMemoryManager, add capture in DiscordBridge, background embedding.
**Why second:** Start filling the store. Everything else needs data.

### Phase 3: Session Summarization
**Dependencies:** ConversationStore with data (Phase 2), SDK haiku access
**Deliverables:** `src/memory/session-summarizer.ts`, hook into stop/crash, fallback logic, tagged memory entries.
**Why third:** Summarization needs captured turns.

### Phase 4: Resume Injection
**Dependencies:** Session summaries in MemoryStore (Phase 3)
**Deliverables:** Modified buildSessionConfig, structured context brief, budget compliance.
**Why fourth:** Once summaries exist, inject them. Agents start "remembering."

### Phase 5: Conversation Search (Deep Retrieval)
**Dependencies:** ConversationStore with embeddings (Phase 1+2)
**Deliverables:** `src/memory/conversation-searcher.ts`, enhanced memory_lookup, IPC handler.
**Why last:** On-demand escape hatch. Lower priority than the core capture-summarize-inject loop.

---

## Scalability Considerations

| Concern | 100 turns/day | 1K turns/day | 10K turns/day |
|---------|---------------|--------------|---------------|
| Storage | ~100KB/agent/day | ~1MB/agent/day | ~10MB/agent/day |
| Embedding cost | ~5s/agent/day (local) | ~50s/agent/day | Batch + throttle |
| KNN search | Brute-force fine (<100K) | Still fine | vec0 IVF index |
| Session summaries | 1-3 per day | 3-10 per day | Daily digest |
| Resume injection | 3 summaries, ~600 tokens | Same (capped) | Same (capped) |

**Retention:** 90-day default. Older turns get content tombstoned while embeddings remain for search. Mirrors the existing cold-tier archive pattern.

---

## Sources

- Codebase analysis: all source files in `src/` directory
- Existing patterns: MemoryStore, EpisodeStore, ConsolidationManager, CompactionManager
- Context assembly: context-assembler.ts, session-config.ts
- Turn lifecycle: turn-dispatcher.ts, bridge.ts, session-manager.ts
- Memory types and schemas: types.ts, schema.ts
