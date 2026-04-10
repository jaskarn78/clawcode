# Stack Research: v1.5 Smart Memory & Model Tiering

**Domain:** On-demand knowledge graph memory, personality retention, model tiering with escalation
**Researched:** 2026-04-10
**Confidence:** HIGH

## Scope

This research covers ONLY new stack additions for v1.5. The existing validated stack (TypeScript, Node.js 22 LTS, better-sqlite3, sqlite-vec, @huggingface/transformers, croner, execa, zod, pino, discord.js 14) is not re-evaluated.

## Recommended Stack Additions

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Pure SQLite (no new dep) | -- | Knowledge graph storage | Backlinks and note links are a simple adjacency list: a `links` table with `(source_id, target_id, link_type, context)` columns. This is a 50-row table pattern, not a graph database problem. SQLite CTEs handle traversal (backlink resolution, 2-hop neighborhood queries). Adding a graph DB or even graphology for this is overengineering. better-sqlite3 already loaded, zero new deps. |
| SQLite FTS5 (built-in) | -- | Full-text search for notes | FTS5 is compiled into better-sqlite3 by default. Enables fast keyword search across note content, complementing vector search. Used for exact-match queries ("find notes mentioning agent-X") that vector similarity handles poorly. |
| `query().setModel()` (Agent SDK) | 0.2.101 | Mid-session model switching | The Claude Agent SDK's `Query` interface exposes `setModel(model?: string)` for changing models mid-session. This is the official mechanism for haiku-default with sonnet/opus escalation. No new dependency -- already using `@anthropic-ai/claude-agent-sdk`. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | -- | -- | All three v1.5 features are implementable with existing dependencies plus SQLite schema additions. See rationale below. |

### New SQLite Tables (Schema Additions)

These extend the existing per-agent `MemoryStore` database:

```sql
-- Knowledge graph: notes as first-class entities
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'note'
    CHECK(note_type IN ('note', 'soul', 'identity', 'skill', 'episode_summary')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Backlinks / forward links between notes
CREATE TABLE IF NOT EXISTS note_links (
  source_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'reference'
    CHECK(link_type IN ('reference', 'extends', 'contradicts', 'supersedes')),
  context TEXT, -- surrounding text where link appears
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id)
);

-- Vector embeddings for notes (reuses same 384-dim as memories)
CREATE VIRTUAL TABLE IF NOT EXISTS vec_notes USING vec0(
  note_id TEXT PRIMARY KEY,
  embedding float[384] distance_metric=cosine
);

-- Model escalation tracking
CREATE TABLE IF NOT EXISTS model_decisions (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  from_model TEXT NOT NULL,
  to_model TEXT NOT NULL,
  reason TEXT NOT NULL,
  trigger_type TEXT NOT NULL
    CHECK(trigger_type IN ('complexity', 'failure', 'explicit', 'cost_ceiling')),
  tokens_before INTEGER DEFAULT 0,
  session_id TEXT NOT NULL
);

-- Cost budget tracking (extends existing usage_events)
CREATE TABLE IF NOT EXISTS cost_budgets (
  agent TEXT PRIMARY KEY,
  daily_limit_usd REAL NOT NULL DEFAULT 1.0,
  weekly_limit_usd REAL NOT NULL DEFAULT 5.0,
  escalation_budget_pct REAL NOT NULL DEFAULT 0.3,
  updated_at TEXT NOT NULL
);
```

### Architecture-Driving Decisions

#### 1. Knowledge Graph in SQLite, Not Graphology

**Decision:** Use SQLite adjacency list tables, not `graphology` (0.26.0).

**Why:** The knowledge graph here is ~dozens to ~hundreds of notes per agent with bidirectional links. This is not a graph algorithm problem (no PageRank, no community detection, no shortest-path needed). It is a structured lookup problem:
- "What notes link to this note?" = `SELECT * FROM note_links WHERE target_id = ?`
- "What does this note link to?" = `SELECT * FROM note_links WHERE source_id = ?`
- "Find all notes within 2 hops" = SQLite recursive CTE (5 lines)
- "Find semantically similar notes" = existing sqlite-vec KNN query

Graphology adds 200KB+ of in-memory graph overhead and requires syncing between SQLite (persistence) and graphology (in-memory). For a system running 14+ agents, that is wasted memory for zero benefit. SQLite CTEs handle the traversal patterns needed here.

**When to reconsider:** If you add graph analytics (community detection, centrality scoring, pathfinding across thousands of nodes). Unlikely for per-agent memory.

#### 2. On-Demand Context Assembly, Not Pre-Stuffed

**Decision:** Replace the current "stuff everything into systemPrompt at boot" pattern with a lazy-load tool.

**Current problem (session-config.ts lines 112-120):** Hot memories are injected into `systemPrompt` at session start. SOUL.md and IDENTITY.md are read and concatenated. This burns context tokens permanently regardless of whether the agent needs them for a given message.

**New pattern:** Provide a `memory_lookup` tool that agents call on-demand:
- Agent receives a message
- Agent decides what context it needs
- Agent calls `memory_lookup` with a query
- Tool returns relevant notes, linked notes (1-hop backlinks), and personality snippets
- Only the relevant context enters the conversation

This is the Obsidian pattern: notes are not loaded until you navigate to them. Backlinks surface related context without loading everything.

**Personality retention:** SOUL.md and IDENTITY.md become notes in the knowledge graph with `note_type = 'soul'` and `note_type = 'identity'`. A compact 2-3 line personality summary stays in systemPrompt. The full soul/identity is available on-demand via the tool.

#### 3. Model Tiering via Agent SDK `setModel()`

**Decision:** Use the Agent SDK's built-in `Query.setModel()` for runtime model switching.

**How it works:** The `query()` function returns a `Query` object (async generator) with a `setModel(model?: string)` method. Calling it mid-session changes the model for subsequent turns without breaking conversation history.

**Escalation triggers (implemented in the session manager, not a new library):**
1. **Complexity detection:** Message length > threshold, code generation requests, multi-step reasoning keywords
2. **Failure recovery:** If haiku produces an error or low-quality response, retry with sonnet
3. **Explicit request:** User says "use opus for this" or agent config specifies escalation rules
4. **Cost ceiling:** Track spend per agent per day, refuse escalation if budget exceeded

**Default model change:** Update `defaultsSchema` from `model: "sonnet"` to `model: "haiku"` in config/schema.ts. Per-agent overrides remain supported.

#### 4. Cost Tracking Extends Existing UsageTracker

**Decision:** Extend the existing `UsageTracker` (src/usage/tracker.ts) with per-model breakdowns and budget enforcement. No new dependency needed.

**Additions:**
- `getModelBreakdown(agent, dateRange)` -- aggregate by model for cost analysis
- `checkBudget(agent)` -- returns remaining daily/weekly budget
- `wouldExceedBudget(agent, estimatedTokens, targetModel)` -- pre-flight check before escalation

**Pricing constants (April 2026):**

| Model | Input $/MTok | Output $/MTok |
|-------|-------------|---------------|
| Claude Haiku 4.5 | $1.00 | $5.00 |
| Claude Sonnet 4.6 | $3.00 | $15.00 |
| Claude Opus 4.6 | $5.00 | $25.00 |

Haiku is 3x cheaper than Sonnet on input and 3x cheaper on output. Sonnet-to-Opus is a further ~1.7x. The savings from defaulting to haiku across 14 agents are significant.

## Installation

```bash
# No new packages needed for v1.5
# All features build on existing dependencies:
#   - better-sqlite3 (graph tables, FTS5)
#   - sqlite-vec (note embeddings)
#   - @huggingface/transformers (embedding generation)
#   - @anthropic-ai/claude-agent-sdk (setModel())
#   - zod (new config schemas)
#   - nanoid (IDs for notes, links, decisions)
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| SQLite adjacency list | graphology 0.26.0 | If you need in-memory graph algorithms (PageRank, community detection, centrality). Not needed for backlink resolution. |
| SQLite adjacency list | Neo4j / FalkorDB | If graph grows beyond ~100K nodes per agent with complex traversal patterns. Absurd for per-agent note graphs of ~100-500 nodes. |
| SQLite FTS5 | Elasticsearch / MeiliSearch | If full-text search needs faceting, fuzzy matching, or search-as-you-type UI. FTS5 covers the keyword search use case here. |
| Agent SDK `setModel()` | Separate Claude API client | If you need to call Claude outside of Claude Code sessions (e.g., background batch jobs). For live agent sessions, the SDK method is correct. |
| Extend UsageTracker | Separate cost tracking service | If you need real-time cost dashboards across multiple deployments. Single-machine, single-daemon -- SQLite is fine. |
| On-demand tool | RAG pipeline (LangChain) | Never. The agent IS the LLM. It calls a tool to fetch context. That is RAG without the framework overhead. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| graphology | Adds 200KB+ in-memory overhead per agent for graph operations you do not need. Backlink queries are simple SQL JOINs. | SQLite `note_links` table + recursive CTEs |
| Neo4j / ArangoDB / FalkorDB | Network graph databases for a problem that is ~100 nodes per agent. Operational overhead of running a graph DB server is absurd here. | SQLite adjacency list |
| LangChain / LlamaIndex | Wrapping an agent framework inside another agent framework to do what a SQLite query + tool definition achieves. | Direct SQLite queries exposed as Claude Code tools |
| Separate embedding model for notes | You already have all-MiniLM-L6-v2 loaded for memories. Notes use the same 384-dim embeddings. No second model needed. | Existing @huggingface/transformers pipeline |
| Redis for cost tracking | In-memory cache for data that needs persistence (budgets, spend history). SQLite already handles this. | Extend UsageTracker with budget columns |
| graphology-communities-louvain | Community detection on a per-agent note graph of ~100 nodes is meaningless. | Nothing -- you do not need community detection |

## Stack Patterns by Variant

**If an agent has a large memory corpus (>10K memories):**
- The knowledge graph `notes` table remains small (notes are summaries/references, not raw memories)
- Memories continue in the existing `memories` table with sqlite-vec
- Notes link TO memories via `note_links` with `link_type = 'reference'`
- This keeps graph traversal fast even with large memory stores

**If cost tracking needs real-time enforcement:**
- Add a `CostGuard` middleware that wraps `query()` calls
- Before each turn: `wouldExceedBudget()` check
- If over budget: force model downgrade or queue the message
- Log all decisions to `model_decisions` table for analysis

**If personality context is too large for on-demand loading:**
- Split SOUL.md into a compact summary (always in systemPrompt, ~200 tokens)
- Full personality details as notes in the knowledge graph
- Agent can `memory_lookup("my personality traits for humor")` when relevant
- This pattern is proven by Obsidian: atomic notes > monolithic documents

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| better-sqlite3@12.8.0 | FTS5 | FTS5 is compiled in by default. No additional native module needed. Verify with `db.exec("CREATE VIRTUAL TABLE test_fts USING fts5(content)")`. |
| better-sqlite3@12.8.0 | SQLite recursive CTEs | CTEs have been in SQLite since 3.8.3 (2014). better-sqlite3 bundles SQLite 3.47+. Zero compatibility risk. |
| @anthropic-ai/claude-agent-sdk@0.2.101 | `Query.setModel()` | Available in current SDK version. The `query()` return type exposes `setModel(model?: string)`. Pin exact version -- SDK is pre-1.0. |
| sqlite-vec@0.1.9 | `vec_notes` table | Same vec0 format as existing `vec_memories`. Multiple vec0 virtual tables in one database work fine. |
| @huggingface/transformers@4.0.1 | Note embeddings | Same model (all-MiniLM-L6-v2) produces 384-dim vectors for both memories and notes. One pipeline instance, two consumers. |

## Key Integration Points with Existing Code

### MemoryStore (src/memory/store.ts)
- Add `notes`, `note_links`, `vec_notes` tables in `initSchema()`
- Add prepared statements for note CRUD and link management
- Reuse existing `getDatabase()` for `SemanticSearch` on notes

### SessionConfig (src/manager/session-config.ts)
- Reduce systemPrompt to compact personality summary (~200 tokens)
- Remove hot memory injection from boot (lines 112-120)
- Add `memory_lookup` tool definition to agent's available tools

### UsageTracker (src/usage/tracker.ts)
- Add `model_decisions` and `cost_budgets` tables
- Add `getModelBreakdown()`, `checkBudget()`, `wouldExceedBudget()` methods
- Add per-model aggregation to existing prepared statements

### Config Schema (src/config/schema.ts)
- Change `defaultsSchema.model` default from `"sonnet"` to `"haiku"`
- Add `escalation` config to agent schema: `{ enabled, maxModel, triggers, budget }`
- Add `costBudget` config to defaults: `{ dailyLimitUsd, weeklyLimitUsd, escalationBudgetPct }`

### AgentSessionConfig (src/manager/types.ts)
- Add optional `escalationConfig` field
- Model field remains the default/starting model
- Runtime model changes happen via SDK `setModel()`, not config changes

## Sources

- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- `Query.setModel()` method, session management
- [Claude Agent SDK Sessions](https://platform.claude.com/docs/en/agent-sdk/sessions) -- session lifecycle, model switching
- [Claude API Pricing](https://platform.claude.com/docs/en/about-claude/pricing) -- haiku $1/$5, sonnet $3/$15, opus $5/$25 per MTok
- [simple-graph (GitHub)](https://github.com/dpapathanasiou/simple-graph) -- SQLite adjacency list pattern reference
- [graphology (npm)](https://www.npmjs.com/package/graphology) -- v0.26.0, evaluated and rejected for this use case
- [obra/knowledge-graph (GitHub)](https://github.com/obra/knowledge-graph) -- Obsidian vault as knowledge graph, SQLite + sqlite-vec + FTS5 pattern
- [SQLite FTS5 Documentation](https://www.sqlite.org/fts5.html) -- full-text search extension, built into better-sqlite3
- npm registry -- all versions verified via `npm view` on 2026-04-10

---
*Stack research for: v1.5 Smart Memory & Model Tiering*
*Researched: 2026-04-10*
