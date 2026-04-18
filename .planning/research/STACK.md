# Stack Research: v1.9 Persistent Conversation Memory

**Domain:** Conversation persistence + retrieval for multi-agent orchestration
**Researched:** 2026-04-17
**Confidence:** HIGH

## Scope

This research covers ONLY what is needed for v1.9: conversation turn persistence, session-boundary summarization, auto-inject on resume, and relevance-decay-weighted retrieval. The existing validated stack (TypeScript 6.0, Node.js 22 LTS, better-sqlite3 12.x, sqlite-vec 0.1.9, @huggingface/transformers 4.x, @anthropic-ai/tokenizer 0.0.4, croner 10.x, zod 4.x, pino 9.x, nanoid 5.x, date-fns 4.x, commander 14.x) is NOT re-evaluated.

The existing substrate already provides:
- Per-agent SQLite databases with WAL mode, sqlite-vec loaded, prepared statements (`src/memory/store.ts`)
- Schema migration pattern: savepoint-test or `PRAGMA table_info` detection (`migrateSchema()`, `migrateTierColumn()`, `migrateEpisodeSource()`, `migrateGraphLinks()`)
- MemoryEntry CRUD with embedding storage, dedup, auto-linking, importance scoring
- SemanticSearch with 2x over-fetch, relevance-decay re-ranking, importance weighting (`src/memory/search.ts`)
- EmbeddingService singleton with ~50ms/embed latency (`src/memory/embedder.ts`)
- Context assembler with stable/mutable split, per-section token budgets, resumeSummary slot (`src/manager/context-assembler.ts`)
- Resume summary budget enforcement: configurable cap (default 1500 tokens, floor 500), regeneration loop, hard-truncate fallback (`src/memory/context-summary.ts`)
- Token counting via @anthropic-ai/tokenizer wrapped in `countTokens()` (`src/performance/token-count.ts`)
- SessionLogger writing daily markdown logs (`src/memory/session-log.ts`)
- Consolidation pipeline with LLM summarization callback, prompt builders, digest writing (`src/memory/consolidation.ts`)
- EpisodeStore as a pattern for domain-specific MemoryEntry wrappers (`src/memory/episode-store.ts`)
- TurnDispatcher as the single chokepoint for all agent turns with TurnOrigin metadata (`src/manager/turn-dispatcher.ts`)
- Relevance decay scoring with configurable half-life (`src/memory/decay.ts`, `src/memory/relevance.ts`)
- Hot/warm/cold tier management, knowledge graph auto-linking, memory dedup
- `memory_lookup` MCP tool for on-demand semantic search

## Recommended Stack Additions

### New Dependencies Required

**None.**

v1.9 requires zero new npm dependencies. Every capability is buildable on the existing stack.

### Existing Stack -- What Each Component Does for v1.9

| Technology | Current Version | v1.9 Role | Integration Point |
|------------|----------------|-----------|-------------------|
| better-sqlite3 | ^12.8.0 | New `conversation_turns` + `conversation_sessions` tables in per-agent memory.db | MemoryStore schema migration pattern |
| sqlite-vec | ^0.1.9 | Session summaries stored as MemoryEntries participate in existing vec_memories KNN search | SemanticSearch.search() -- zero changes needed |
| @huggingface/transformers | ^4.0.1 | Embed session summaries on creation | EmbeddingService.embed() -- zero changes needed |
| @anthropic-ai/tokenizer | ^0.0.4 | Per-turn token counting, auto-inject budget enforcement | countTokens() -- zero changes needed |
| date-fns | ^4.1.0 | Session duration, turn timestamps, retention window calculation | differenceInMinutes(), formatISO() -- already available |
| nanoid | ^5.1.7 | IDs for conversation turns and session records | Already used throughout MemoryStore |
| zod | ^4.3.6 | Schema validation for conversation config | Same pattern as memoryConfigSchema |
| pino | ^9 | Structured logging for conversation persistence | shared/logger.ts -- zero changes needed |
| croner | ^10.0.1 | Scheduled retention cleanup of old raw turns | Already used for memory consolidation cron |
| commander | ^14.0.3 | CLI commands for conversation history browsing | Existing CLI framework |

## Architecture-Driving Decisions

### 1. Same Database, New Tables (NOT a Separate Database)

**Decision:** Add `conversation_turns` and `conversation_sessions` tables to the existing per-agent `memory.db` via MemoryStore migration.

**Why:** MemoryStore is the single database owner per agent. It already handles WAL mode, busy_timeout, sqlite-vec extension loading, and schema migrations. Adding tables here:
- Maintains single-writer simplicity (no cross-db WAL contention with 14+ agents)
- Enables JOIN queries between conversation turns and memory entries (e.g., "find memories created during session X")
- Follows the established migration pattern exactly (see `migrateGraphLinks()` as the closest prior art)
- Keeps per-agent backup/restore atomic

**NOT a separate `conversations.db`** because cross-db JOINs in SQLite require ATTACH which complicates prepared statements, and two databases per agent doubles WAL contention risk.

### 2. Session Summaries as MemoryEntries (NOT a Separate Retrieval System)

**Decision:** Session-boundary summaries are stored as standard `MemoryEntry` objects with `source="conversation"` and tagged `["session-summary", "session:{id}"]`.

**Why:** This is the exact pattern used by:
- `EpisodeStore`: source="episode", tagged ["episode"]
- Consolidation pipeline: source="consolidation", tagged ["weekly-digest", weekStr]

By storing session summaries as MemoryEntries, they automatically:
- Participate in semantic search via `SemanticSearch.search()` -- zero search changes
- Get relevance decay scoring via `calculateRelevanceScore()` -- zero decay changes
- Get importance-based ranking via `scoreAndRank()` -- zero ranking changes
- Flow through hot/warm/cold tier system -- zero tier changes
- Appear in `memory_lookup` MCP tool results -- zero MCP changes
- Get auto-linked by the knowledge graph auto-linker -- zero graph changes
- Get dedup-checked against similar existing memories -- zero dedup changes

Zero new retrieval infrastructure needed.

### 3. Auto-Inject via Context Assembler's resumeSummary Slot (NOT a New Pipeline Section)

**Decision:** Auto-inject on resume extends the existing `ContextSources.resumeSummary` path in `context-assembler.ts`.

**Why:** The context assembler already has:
- A `resumeSummary` field that lands in the mutable suffix (uncached, per-turn)
- Budget enforcement via `enforceSummaryBudget()` with configurable token cap (default 1500, floor 500)
- Per-section token counting for audit (`section_tokens.resume_summary`)
- The stable/mutable split for prompt caching compatibility

The auto-inject enhancement loads N most recent session summaries, formats them into a structured brief, and feeds the result into `resumeSummary`. Adding a new section would change `SectionTokenCounts`, `ContextSources`, `SectionName`, `MemoryAssemblyBudgets`, and `DEFAULT_PHASE53_BUDGETS` -- cascading through 20+ files. Reusing `resumeSummary` avoids this entirely.

### 4. Turn Recording via TurnDispatcher Post-Dispatch Hook (NOT Discord Bridge)

**Decision:** Conversation turn recording hooks into TurnDispatcher's `dispatch()`/`dispatchStream()` return path.

**Why:** TurnDispatcher (v1.8) is "the single chokepoint for every agent-turn initiation." Every Discord message, scheduler invocation, and handoff flows through it. Recording turns here:
- Captures ALL turn sources (Discord, scheduler, handoff) in one place
- Has access to `origin.rootTurnId`, `origin` type, agent name, and channel ID via `DispatchOptions`
- Has access to both the input message and the response string (the return value)
- Avoids scattering persistence logic across Discord bridge, scheduler bridge, and handoff receiver
- The `TurnOrigin` type already carries source metadata for attributing turns

### 5. Raw Turns WITHOUT Per-Turn Embedding (Embed Only Session Summaries)

**Decision:** Store raw conversation turns as text without computing embeddings. Only session summaries get embedded.

**Why:**
- 14 agents x ~50 turns/session x ~50ms/embed = 35 seconds of embedding compute per full session per agent -- unacceptable latency per message
- Individual turns are low-signal for semantic search ("hi", "thanks", "yes do that")
- Session summaries distill turns into high-signal searchable facts -- this is where embedding adds value
- Raw turns remain queryable via SQL (WHERE content LIKE ? or exact session_id lookup) for precise recall
- If full-text search over raw turns proves necessary: SQLite's built-in FTS5 requires zero new dependencies (compiled into better-sqlite3's bundled SQLite). Add as a v1.9.1 enhancement if SQL LIKE proves insufficient.

### 6. LLM Summarization via Existing Callback Pattern

**Decision:** Reuse the consolidation pipeline's `summarize: (prompt: string) => Promise<string>` callback pattern for session-boundary summarization.

**Why:** The consolidation pipeline (`consolidation.ts`) already:
- Accepts a `summarize` callback injected by the caller (pure dependency injection)
- Uses it for weekly/monthly digest generation
- Has prompt-building helpers (`buildWeeklySummarizationPrompt`, `buildMonthlySummarizationPrompt`)
- Handles truncation of long inputs (`MAX_PROMPT_CHARS = 30000`)

Session-end summarization follows the identical pattern: collect turns, build a summarization prompt, call the injected summarizer, store the result. The summarizer implementation (which model, how to invoke) is the caller's concern, keeping the persistence module pure.

## Schema Design

### conversation_sessions Table

```sql
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  summary_memory_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'ended', 'summarized')),
  FOREIGN KEY (summary_memory_id) REFERENCES memories(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_agent
  ON conversation_sessions(agent_name);
CREATE INDEX IF NOT EXISTS idx_sessions_status
  ON conversation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started
  ON conversation_sessions(started_at);
```

### conversation_turns Table

```sql
CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  channel_id TEXT,
  origin TEXT,
  token_count INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES conversation_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_turns_session
  ON conversation_turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_created
  ON conversation_turns(created_at);
```

### Config Schema Addition

```typescript
export const conversationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  autoSummarize: z.boolean().default(true),
  summaryModel: z.enum(["sonnet", "opus", "haiku"]).default("haiku"),
  resumeSessionCount: z.number().int().min(1).max(10).default(3),
  resumeTokenBudget: z.number().int().min(500).max(4000).default(1500),
  turnRetentionDays: z.number().int().min(7).default(90),
  summaryImportance: z.number().min(0.1).max(1).default(0.75),
});
```

### New MemorySource Value

The existing `memorySourceSchema` already includes `"conversation"` -- no CHECK constraint migration needed. Session summaries use `source: "conversation"` with tags to distinguish them from other conversation-sourced memories.

## New Files (Following Existing Patterns)

| New File | Pattern From | Purpose |
|----------|-------------|---------|
| `src/memory/conversation-store.ts` | `episode-store.ts` | ConversationStore class: session CRUD, turn recording, session listing, turn retrieval |
| `src/memory/conversation-summarizer.ts` | `consolidation.ts` | Prompt builder for session-end summarization, summary-to-MemoryEntry pipeline |
| `src/memory/conversation-resume.ts` | `context-summary.ts` | Load N recent session summaries, format as structured brief, enforce token budget |

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Same memory.db, new tables | Separate conversations.db per agent | Never. Cross-db JOINs need ATTACH; two dbs per agent doubles WAL contention. |
| Raw turns without embedding | Embed every turn individually | Only if per-turn semantic search is mandatory. Adds ~50ms latency per message per agent. Unlikely to be needed -- session summaries cover this. |
| MemoryEntry for session summaries | Separate summary table with own vector index | Never. Duplicates search, decay, tier management. The whole point of unified MemoryEntry is unified retrieval. |
| SQL LIKE for raw turn search | FTS5 virtual table | Consider FTS5 if LIKE queries over raw turns are too slow at >100K turns per agent. FTS5 is built into SQLite, zero new deps. Add as v1.9.1 if needed. |
| LLM summarization callback | Rule-based extractive summarization | Never for quality. LLM captures nuance, decisions, preferences. Rule-based misses context. |
| Context assembler resumeSummary | New context pipeline section | Never. New section changes SectionTokenCounts, ContextSources, SectionName, MemoryAssemblyBudgets, DEFAULT_PHASE53_BUDGETS -- cascades through 20+ files. |
| TurnDispatcher hook | Discord bridge hook | Never. TurnDispatcher is the single chokepoint (v1.8). Discord bridge hook would miss scheduler and handoff turns. |
| Haiku for session summarization | Sonnet/Opus for session summarization | Use sonnet only if haiku summaries consistently miss important context. Haiku is 10x cheaper and session summarization is a structured extraction task well within haiku's capability. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Redis for turn buffering | SQLite INSERT is <1ms synchronous. No need to buffer in-memory then flush. | Direct better-sqlite3 INSERT in TurnDispatcher return path |
| LangChain memory abstractions | Massive dependency (300+ transitive deps) for what is 2 SQL tables and a summarization prompt. Fights the existing MemoryStore pattern. | Custom ConversationStore following EpisodeStore's pattern (~100 lines) |
| Separate embedding model for conversations | One embedding model is sufficient. MiniLM-L6-v2 at 384-dim handles both general memory and session summaries. | Same EmbeddingService singleton |
| ChromaDB / Pinecone / Weaviate | External vector DB is overkill for per-agent conversation history at this scale. | sqlite-vec (already loaded in each agent's db) |
| OpenAI / Voyage / Cohere embeddings for summaries | Adds cost, latency, network dependency. Local embeddings at ~50ms/call are fine for 1 embed per session. | @huggingface/transformers (already loaded) |
| Custom token counter | @anthropic-ai/tokenizer is already wrapped in countTokens(). chars/4 approximation is unreliable for budget enforcement. | Existing countTokens() from performance/token-count.ts |
| Markdown files for conversation history | SessionLogger already writes daily markdown logs. A second markdown system creates confusion and duplicates data. SQLite is the right choice for structured, queryable conversation data. | SQLite conversation_turns table |
| Prisma / Drizzle ORM | ORM overhead for what are simple INSERTs and SELECTs with prepared statements. | Raw better-sqlite3 prepared statements (established pattern) |
| A new MCP tool for conversation search | Session summaries are MemoryEntries. The existing memory_lookup MCP tool already searches MemoryEntries by semantic similarity. | Existing memory_lookup MCP tool |

## Stack Patterns by Variant

**If agent has high conversation volume (>100 turns/day):**
- Enable FTS5 virtual table over conversation_turns for efficient full-text search
- Batch turn INSERTs (accumulate in-memory buffer, flush every 10 turns or 30 seconds)
- Run turn retention cleanup as a weekly croner job instead of daily
- FTS5 is zero-dependency (compiled into better-sqlite3's bundled SQLite)

**If agent is primarily scheduled/automated (few Discord conversations):**
- Set `conversationConfig.autoSummarize: false`
- Scheduler-originated turns are still recorded (for audit trail and observability)
- Resume auto-inject pulls from existing memory system only (no conversation brief)

**If agent needs cross-session topic threading:**
- Tag session summaries with extracted topic tags (reuse importance.ts entity detection)
- Link session summary MemoryEntries via knowledge graph wikilinks (`[[session:{id}]]`)
- Auto-linker heartbeat discovers similarity edges between session summaries automatically

**If session summaries prove too lossy (rare conversations with high-value details):**
- Increase `summaryImportance` to 0.9 so summaries decay slower
- Add a `preserveVerbatim` flag that stores select turns as individual MemoryEntries (with embedding)
- Keep this as a v1.9.1 enhancement -- do not over-engineer on the first pass

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| better-sqlite3@12.8.0 | FTS5 virtual tables | FTS5 is built into the SQLite amalgamation that better-sqlite3 bundles. No separate extension needed. Enabled by default. |
| better-sqlite3@12.8.0 | New conversation_* tables alongside existing memories + vec_memories | Same db, same WAL, same busy_timeout. Validated pattern (memory_links table added in v1.5). |
| @anthropic-ai/tokenizer@0.0.4 | Per-turn token counting | Already wrapped in countTokens(). Deterministic, same BPE tokenizer as Claude. |
| date-fns@4.1.0 | Session duration, retention window | differenceInMinutes(), subDays(), isAfter() all available. Already used in consolidation. |
| zod@4.3.6 | conversationConfigSchema | Same validation pattern as memoryConfigSchema, decayConfigSchema, etc. |
| croner@10.0.1 | Turn retention cleanup cron | Same scheduler used for memory consolidation. Add another handler entry. |

## Integration Points with Existing Memory System

### Where v1.9 Plugs In

| Existing File | What v1.9 Adds | How |
|---------------|----------------|-----|
| `src/memory/store.ts` | conversation_turns + conversation_sessions tables | New migration method `migrateConversationTables()` following `migrateGraphLinks()` pattern. Called in constructor chain. |
| `src/memory/schema.ts` | conversationConfigSchema | New Zod schema export. Added to memoryConfigSchema as optional `conversation` field. |
| `src/memory/types.ts` | ConversationTurn, ConversationSession, ConversationConfig types | New type exports alongside existing MemoryEntry, EpisodeInput. |
| `src/manager/turn-dispatcher.ts` | Post-dispatch turn recording | After sendToAgent()/streamFromAgent() returns, call ConversationStore.recordTurn() with input + output. Non-fatal: catch and log errors so persistence failures never block message delivery. |
| `src/manager/context-assembler.ts` | Enhanced resumeSummary source | No changes to assembler code. The caller (session-config) loads conversation brief via new `loadConversationBrief()` and passes it as `resumeSummary`. |
| `src/memory/context-summary.ts` | loadConversationBrief() helper | New function alongside existing loadLatestSummary(). Loads N recent session summaries, formats as structured brief, calls enforceSummaryBudget(). |

### Modules That Need Zero Changes

| Module | Why No Changes |
|--------|---------------|
| `src/memory/search.ts` | Session summaries are MemoryEntries -- already searchable via SemanticSearch |
| `src/memory/relevance.ts` | Decay scoring applies to session summaries via their accessed_at field |
| `src/memory/decay.ts` | Half-life decay formula works on any MemoryEntry |
| `src/memory/embedder.ts` | Same EmbeddingService.embed() call for session summaries |
| `src/memory/dedup.ts` | Dedup checking runs on session summary insert automatically |
| `src/memory/similarity.ts` | Auto-linking runs on session summary insert automatically |
| `src/memory/graph.ts` | Wikilink extraction works on session summary content |
| `src/memory/tiers.ts` | Tier promotion/demotion applies to session summaries |
| `src/memory/tier-manager.ts` | Tier sweeps include session summaries |
| `src/memory/importance.ts` | Importance scoring applies (though we override with summaryImportance config) |

## What Already Exists (DO NOT Rebuild)

| Capability | Existing Location | v1.9 Relationship |
|------------|-------------------|-------------------|
| Per-agent SQLite with WAL + sqlite-vec | memory/store.ts | Schema host |
| Relevance decay scoring | memory/decay.ts + memory/relevance.ts | Session summaries scored identically |
| Semantic search with re-ranking | memory/search.ts | Deep search over session summaries |
| Hot/warm/cold tier management | memory/tiers.ts + memory/tier-manager.ts | Session summaries flow through tiers |
| Memory deduplication | memory/dedup.ts | Prevents duplicate session summaries |
| Knowledge graph auto-linking | memory/similarity.ts + memory/graph.ts | Links session summaries to related memories |
| Context assembly with budget enforcement | manager/context-assembler.ts | Auto-inject lands in resumeSummary slot |
| Resume summary budget enforcer | memory/context-summary.ts | Enforces token cap on conversation brief |
| Token counting | performance/token-count.ts | Per-turn and per-brief measurement |
| Consolidation pipeline | memory/consolidation.ts | Pattern for LLM summarization callback |
| Episode store | memory/episode-store.ts | Pattern for domain-specific MemoryEntry wrappers |
| Importance scoring | memory/importance.ts | Auto-scores session summaries on insert |
| Memory lookup MCP tool | mcp/ | Session summaries searchable via existing tool |
| TurnDispatcher chokepoint | manager/turn-dispatcher.ts | Hook point for recording turns |
| SessionLogger | memory/session-log.ts | Continues writing markdown daily logs (complementary, not replaced) |

## Sources

- Codebase analysis: `src/memory/store.ts` -- schema, migration pattern, MemoryStore class, prepared statements (Confidence: HIGH)
- Codebase analysis: `src/memory/episode-store.ts` -- domain-specific MemoryEntry wrapper pattern (Confidence: HIGH)
- Codebase analysis: `src/memory/consolidation.ts` -- LLM summarization callback, prompt building, digest pipeline (Confidence: HIGH)
- Codebase analysis: `src/manager/context-assembler.ts` -- resumeSummary slot, budget enforcement, SectionTokenCounts shape (Confidence: HIGH)
- Codebase analysis: `src/memory/context-summary.ts` -- enforceSummaryBudget(), loadLatestSummary(), DEFAULT_RESUME_SUMMARY_BUDGET (Confidence: HIGH)
- Codebase analysis: `src/manager/turn-dispatcher.ts` -- single chokepoint, TurnOrigin, DispatchOptions (Confidence: HIGH)
- Codebase analysis: `src/memory/search.ts` -- SemanticSearch, relevance-decay re-ranking, importance weighting (Confidence: HIGH)
- Codebase analysis: `src/memory/relevance.ts` -- scoreAndRank(), distanceToSimilarity() (Confidence: HIGH)
- Codebase analysis: `src/memory/decay.ts` -- calculateRelevanceScore(), half-life exponential decay (Confidence: HIGH)
- Codebase analysis: `src/memory/embedder.ts` -- EmbeddingService singleton, ~50ms/embed, 384-dim (Confidence: HIGH)
- Codebase analysis: `src/memory/types.ts` -- MemoryEntry, MemorySource includes "conversation" (Confidence: HIGH)
- Codebase analysis: `src/memory/schema.ts` -- memorySourceSchema includes "conversation", Zod patterns (Confidence: HIGH)
- Codebase analysis: `src/memory/session-log.ts` -- SessionLogger markdown pattern (Confidence: HIGH)
- Codebase analysis: `package.json` -- all dependency versions verified (Confidence: HIGH)
- SQLite documentation: FTS5 compiled into amalgamation, available in better-sqlite3 by default (Confidence: HIGH)

---
*Stack research for: v1.9 Persistent Conversation Memory*
*Researched: 2026-04-17*
