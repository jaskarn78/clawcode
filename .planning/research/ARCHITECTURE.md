# Architecture: Smart Memory & Model Tiering (v1.5)

**Domain:** On-demand memory loading, knowledge graph, personality context assembly, model tiering
**Researched:** 2026-04-10
**Confidence:** HIGH (existing codebase well-understood), MEDIUM (advisor tool is beta)

## Existing Architecture Recap

```
                          clawcode.yaml
                               |
                     ┌─────────▼──────────┐
                     │     Daemon          │
                     │  (SessionManager)   │
                     │  (ConfigWatcher)    │
                     │  (HeartbeatRunner)  │
                     └──┬───┬───┬───┬─────┘
                        │   │   │   │
                IPC (Unix Socket)
                        │   │   │   │
              ┌─────────┘   │   │   └──────────┐
              ▼             ▼   ▼              ▼
         ┌─────────┐  ┌─────────┐  ...  ┌─────────┐
         │ Agent A  │  │ Agent B │       │ Agent N │
         │ (Claude  │  │ (Claude │       │ (Claude │
         │  Code    │  │  Code   │       │  Code   │
         │  Session)│  │  Session)│      │  Session)│
         └────┬─────┘  └────┬────┘      └────┬────┘
              │              │                │
         ┌────▼─────┐  ┌────▼────┐      ┌────▼────┐
         │ SQLite   │  │ SQLite  │      │ SQLite  │
         │ Memory   │  │ Memory  │      │ Memory  │
         │ + vec    │  │ + vec   │      │ + vec   │
         └──────────┘  └─────────┘      └─────────┘
```

**Key Integration Points (what v1.5 touches):**

1. **`buildSessionConfig()`** in `src/manager/session-config.ts` -- assembles the system prompt by reading SOUL.md, IDENTITY.md, hot memories, skills, admin info, context summary. This is the personality + memory injection point.

2. **`TierManager`** in `src/memory/tier-manager.ts` -- manages hot/warm/cold transitions. Hot memories get injected into system prompt via `getHotMemories()`.

3. **`SemanticSearch`** in `src/memory/search.ts` -- KNN search over vec_memories, re-ranked by decay. Currently only searched explicitly, not wired to on-demand retrieval.

4. **`MemoryStore`** in `src/memory/store.ts` -- SQLite schema: `memories` table (id, content, source, importance, access_count, tags, timestamps, tier) + `vec_memories` virtual table (384-dim float32 cosine).

5. **`SdkSessionAdapter`** in `src/manager/session-adapter.ts` -- creates Claude SDK sessions with `model`, `systemPrompt`, `permissionMode`. Currently uses a fixed model per agent from config.

6. **`UsageTracker`** in `src/usage/tracker.ts` -- records per-interaction token/cost/model data.

---

## New Architecture: Three Feature Domains

### Feature 1: Knowledge Graph (Obsidian-style Links Between Memories)

**Problem:** Memories are flat rows with tags but no structural relationships. Searching retrieves individual memories without context about how they relate.

**Solution:** Add a `memory_links` table for directional edges between memories, enabling backlink traversal and graph-aware retrieval.

#### New Schema

```sql
-- Add to MemoryStore.initSchema() via migration
CREATE TABLE IF NOT EXISTS memory_links (
  source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK(link_type IN ('related', 'derived', 'supersedes', 'context')),
  strength REAL NOT NULL DEFAULT 1.0 CHECK(strength >= 0.0 AND strength <= 1.0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_memory_links_target 
  ON memory_links(target_id);
```

**Link types:**
- `related` -- topically connected memories (auto-detected via embedding similarity at insert time)
- `derived` -- consolidation output links back to source memories
- `supersedes` -- dedup merge: new memory replaces old (existing dedup flow can populate this)
- `context` -- episode links to relevant facts that were active during that episode

#### New Component: `KnowledgeGraph`

```
src/memory/knowledge-graph.ts
```

**Responsibilities:**
- `link(sourceId, targetId, linkType, strength)` -- create a directional edge
- `getLinks(memoryId, direction: 'outgoing' | 'incoming' | 'both')` -- traverse
- `getNeighborhood(memoryId, depth: number)` -- BFS to N hops, returns subgraph
- `autoLink(newMemoryId, embedding)` -- on insert, find top-K similar existing memories and create `related` links if similarity > threshold
- `getBacklinks(memoryId)` -- all memories that link TO this one

**Integration with existing code:**
- `MemoryStore.insert()` calls `KnowledgeGraph.autoLink()` after successful insert
- `consolidation.ts` `writeWeeklyDigest()` creates `derived` links from source daily memories to the digest memory
- `dedup.ts` `mergeMemory()` creates `supersedes` link from merged entry to the surviving entry
- `SemanticSearch.search()` optionally expands results with 1-hop neighbors (configurable)

#### Data Flow Change

```
BEFORE: insert -> dedup check -> embed -> SQLite insert
AFTER:  insert -> dedup check -> embed -> SQLite insert -> autoLink (async, non-blocking)
```

The autoLink step runs after the insert transaction completes. It queries vec_memories for similar entries (reusing the existing KNN infrastructure) and creates `related` links. This is fire-and-forget -- link creation failure should not block memory insertion.

---

### Feature 2: On-Demand Memory Loading & Personality Context Assembly

**Problem:** `buildSessionConfig()` stuffs everything into the system prompt at session creation: SOUL.md, IDENTITY.md, all hot memories, all skills, admin info, context summary. This burns context on startup and never refreshes.

**Solution:** Split context assembly into two layers:

1. **Minimal Boot Prompt** -- identity only (compact personality summary)
2. **On-Demand Retrieval** -- memories loaded per-turn via MCP tool or system prompt refresh

#### Component: `ContextAssembler`

```
src/memory/context-assembler.ts
```

**Responsibilities:**
- `assembleBootPrompt(config)` -- minimal identity (SOUL.md first paragraph + agent name + channel bindings). Target: <500 tokens.
- `assembleOnDemandContext(query, agentName)` -- given a user message, retrieve relevant memories + their graph neighbors, format as context block.
- `assembleFull(config, deps)` -- backward-compatible full assembly (for agents that opt out of on-demand mode).

#### Personality Retention Strategy

The existing `buildSessionConfig()` reads the full SOUL.md + IDENTITY.md. For haiku-default agents, this is wasteful -- haiku has a smaller effective context window and personality text competes with task context.

**Approach: Tiered Personality Loading**

```
config.memory.personalityMode: "full" | "compact" | "on-demand"
```

- **`full`** (default, backward-compatible): Current behavior. Entire SOUL.md + IDENTITY.md in system prompt.
- **`compact`**: First 2-3 paragraphs of SOUL.md + IDENTITY.md summary. ~200-300 tokens. Good for haiku.
- **`on-demand`**: Boot with agent name + one-line role only. Full personality loaded via tool when agent needs to "check identity."

For v1.5, implement `compact` and keep `full` as fallback. `on-demand` is experimental and deferred.

#### Memory Retrieval MCP Tool

Instead of hot-memory injection at boot, expose a `memory_search` MCP tool that agents can invoke per-turn.

```
src/mcp/tools/memory-search.ts
```

**Tool definition:**
```typescript
{
  name: "memory_search",
  description: "Search your memory for relevant context. Use when you need to recall past conversations, decisions, or facts.",
  inputSchema: {
    query: { type: "string", description: "What to search for" },
    includeGraph: { type: "boolean", description: "Include linked memories", default: true },
    maxResults: { type: "number", description: "Max results", default: 5 }
  }
}
```

**Flow:**
```
User message arrives
  -> Agent receives message
  -> Agent decides if memory lookup needed (LLM judgment)
  -> Agent calls memory_search tool
  -> Tool: embed query -> KNN search -> expand with graph neighbors -> format
  -> Agent receives context, incorporates into response
```

**Integration:** The existing MCP bridge (`src/mcp/server.ts`) already exposes tools. Add `memory_search` as a new tool handler.

#### Modified `buildSessionConfig()` Flow

```
BEFORE:
  SOUL.md + IDENTITY.md + Discord + Context Summary + Hot Memories + Skills + Admin + Subagent

AFTER (compact mode):
  Compact Identity (first section of SOUL.md) + Discord + Skills Summary (names only)
  + "You have a memory_search tool. Use it when you need to recall context."
  + Context Summary (if resuming)
```

Hot memories are NO LONGER injected into the system prompt. They're available via `memory_search` with a boost factor so they rank higher in search results.

---

### Feature 3: Model Tiering (Haiku Default + Advisor Escalation)

**Problem:** Every agent runs at its configured model (often sonnet/opus) regardless of task complexity. Most messages are simple and could be handled by haiku at 1/60th the cost.

**Solution:** Default all agents to haiku, with Anthropic's new advisor tool for automatic escalation to opus when needed.

#### Anthropic Advisor Tool Integration

Anthropic released the advisor tool in beta (April 2026). It's a first-class tool type in the Messages API:

```json
{
  "type": "advisor_20260301",
  "name": "advisor",
  "model": "claude-opus-4-6",
  "max_uses": 3
}
```

The executor model (haiku/sonnet) runs the task. When it hits a decision it cannot resolve, it automatically calls the advisor (opus), which reviews context and returns guidance. Advisor tokens bill at opus rates, executor tokens at haiku/sonnet rates.

**Critical constraint:** The Claude Agent SDK's `query()` API currently exposes `model` in options but does NOT expose a `tools` array for passing the advisor tool definition. The advisor tool is a Messages API feature, not a Claude Code/Agent SDK feature yet.

**Implication:** We cannot use the advisor tool through the Agent SDK directly. We need a different approach.

#### Practical Model Tiering Architecture

Since the advisor tool is not available through the Agent SDK, implement model tiering as a **session-level model switch**:

```
src/manager/model-tier.ts
```

**Component: `ModelTierRouter`**

```typescript
type TierConfig = {
  defaultModel: "haiku";
  escalationModel: "sonnet";
  advisorModel: "opus";
  escalationTriggers: EscalationTrigger[];
  maxEscalationsPerSession: number;
  cooldownMinutes: number;
};

type EscalationTrigger =
  | { type: "keyword"; patterns: string[] }      // "debug", "architect", "review"
  | { type: "error_rate"; threshold: number }     // consecutive errors
  | { type: "complexity"; tokenThreshold: number } // long messages
  | { type: "explicit"; command: string }          // "/escalate"
  | { type: "cost_budget"; maxUsdPerHour: number } // budget-based
```

**Escalation flow:**

```
Message arrives for Agent A (running haiku)
  -> ModelTierRouter.evaluate(message, agentState)
  -> If trigger matches:
     -> Create new session with escalated model (sonnet or opus)
     -> Inject context summary from current session
     -> Route this message to the escalated session
     -> After response, optionally de-escalate back to haiku
  -> If no trigger:
     -> Route to current haiku session normally
```

**Key design decision:** Escalation creates a NEW session with the higher model, not a model swap mid-session. The Agent SDK does not support changing models mid-session. The escalated session gets the same system prompt + a context summary of the current conversation.

#### Integration with SessionAdapter

```
BEFORE:
  SessionAdapter.createSession(config)  // config.model is fixed

AFTER:
  ModelTierRouter wraps SessionAdapter
  ModelTierRouter.routeMessage(agentName, message)
    -> checks escalation triggers
    -> either sends to existing session OR creates escalated session
    -> tracks escalation state per agent
```

**Modified `AgentSessionConfig`:**

```typescript
type AgentSessionConfig = {
  // ... existing fields
  readonly tierConfig?: {
    readonly defaultModel: "haiku" | "sonnet" | "opus";
    readonly escalationModel: "sonnet" | "opus";
    readonly triggers: readonly EscalationTrigger[];
    readonly maxEscalationsPerSession: number;
  };
};
```

#### Usage Tracking Integration

The existing `UsageTracker` already records model per interaction. Add:
- `cost_saved_usd` field: difference between what this interaction would have cost at the original model vs what it actually cost
- Aggregate: `total_savings` across the fleet
- Dashboard: cost comparison chart (haiku vs previous model spend)

---

## Component Boundaries

| Component | File | Responsibility | Communicates With |
|-----------|------|----------------|-------------------|
| KnowledgeGraph | `src/memory/knowledge-graph.ts` | Link CRUD, traversal, auto-linking | MemoryStore, SemanticSearch |
| ContextAssembler | `src/memory/context-assembler.ts` | Boot prompt + on-demand context building | TierManager, KnowledgeGraph, SemanticSearch |
| ModelTierRouter | `src/manager/model-tier.ts` | Escalation decisions, session routing | SessionAdapter, UsageTracker |
| MemorySearchTool | `src/mcp/tools/memory-search.ts` | MCP tool for agent-initiated memory search | SemanticSearch, KnowledgeGraph |
| TierConfig schema | `src/memory/schema.ts` (extend) | Validation for new config fields | zod |

**Modified existing components:**

| Component | Change |
|-----------|--------|
| `MemoryStore` | Add `memory_links` table migration, link CRUD methods |
| `buildSessionConfig()` | Support `compact` personality mode, remove hot memory injection when on-demand enabled |
| `SdkSessionAdapter` | No change (ModelTierRouter wraps it) |
| `consolidation.ts` | Create `derived` links when writing digests |
| `dedup.ts` | Create `supersedes` links on merge |
| `SemanticSearch` | Optional graph expansion parameter |
| `ResolvedAgentConfig` | Add `personalityMode` and `tierConfig` fields |
| `UsageTracker` | Add savings tracking |

---

## Data Flow: Complete Message Lifecycle (v1.5)

```
1. Discord message arrives
2. Router identifies bound agent
3. ModelTierRouter.evaluate(message, agentState)
   ├── No escalation needed -> use current haiku session
   └── Escalation triggered -> create sonnet/opus session with context
4. Message sent to agent session via SessionAdapter
5. Agent processes message:
   a. Agent reads compact system prompt (identity + channel binding)
   b. Agent decides if memory search needed
   c. If yes: calls memory_search MCP tool
      -> SemanticSearch.search(embed(query))
      -> KnowledgeGraph.getNeighborhood(resultIds, depth=1)
      -> Format and return context
   d. Agent generates response with retrieved context
6. Response delivered to Discord
7. UsageTracker.record(event) with model, tokens, cost, savings
8. If escalated session: de-escalation check for next message
```

---

## Patterns to Follow

### Pattern 1: Graph-Augmented Retrieval
**What:** After KNN search returns top-K memories, expand each result by traversing 1-hop graph neighbors. De-duplicate and re-rank the combined set.
**When:** Agent calls `memory_search` with `includeGraph: true`
**Why:** Retrieves contextually related memories that may not match the query embedding directly but are structurally linked.

```typescript
function graphAugmentedSearch(
  query: Float32Array,
  search: SemanticSearch,
  graph: KnowledgeGraph,
  topK: number,
): readonly RankedSearchResult[] {
  const directResults = search.search(query, topK);
  const neighborIds = new Set<string>();
  
  for (const result of directResults) {
    const neighbors = graph.getLinks(result.id, 'both');
    for (const link of neighbors) {
      neighborIds.add(link.source_id === result.id ? link.target_id : link.source_id);
    }
  }
  
  // Fetch neighbor entries, remove duplicates, re-rank
  // Neighbors get a score penalty (e.g., 0.8x) since they're indirect matches
  // ...
}
```

### Pattern 2: Escalation State Machine
**What:** Per-agent state tracking for model tier transitions
**When:** Every message routed through ModelTierRouter

```
STATES: base -> escalated -> cooldown -> base
TRANSITIONS:
  base -> escalated: trigger matched
  escalated -> cooldown: response delivered + no more triggers
  cooldown -> base: cooldown period elapsed
  escalated -> escalated: another trigger during escalated state (reset cooldown)
```

### Pattern 3: Compact Personality Templates
**What:** Extract a compact identity from SOUL.md/IDENTITY.md programmatically
**When:** Agent configured with `personalityMode: "compact"`

```typescript
function compactPersonality(soulMd: string, identityMd: string): string {
  // Take first heading + first paragraph from SOUL.md
  // Take full IDENTITY.md (usually short)
  // Append: "For detailed personality guidance, search your memory for 'identity' or 'soul'"
  const soulLines = soulMd.split('\n');
  const firstSection = extractFirstSection(soulLines); // Up to second H1/H2
  return `${firstSection}\n\n${identityMd}`.trim();
}
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Model Swap Mid-Session
**What:** Attempting to change the model of an active Agent SDK session
**Why bad:** The SDK creates a session with a fixed model. There is no `setModel()` method. Attempting to resume with a different model is undefined behavior.
**Instead:** Create a new session with the escalated model. Inject a context summary from the previous session.

### Anti-Pattern 2: Graph Traversal Without Depth Limits
**What:** Unbounded BFS/DFS on the knowledge graph
**Why bad:** Memory graphs grow organically. Auto-linking creates O(K) edges per insert. After 10K memories with K=3 links each, unbounded traversal can pull thousands of nodes.
**Instead:** Always cap depth (default 1, max 2). Cap total results from graph expansion (e.g., 20 neighbors max).

### Anti-Pattern 3: Eager Graph Population
**What:** Running auto-link on all existing memories when the feature is first deployed
**Why bad:** N memories * K nearest neighbors = O(N*K) link insertions on a potentially large database. Blocks the event loop.
**Instead:** Auto-link only on new inserts going forward. Optionally run a background migration job during idle periods (via heartbeat).

### Anti-Pattern 4: Hot Memory Injection AND On-Demand Search
**What:** Keeping hot memories in the system prompt while also having memory_search available
**Why bad:** Doubles context usage for the same information. Agent may get confused by duplicate context from different sources.
**Instead:** When on-demand mode is enabled, remove hot memory injection from buildSessionConfig(). Hot memories should still be boosted in search results via their access_count and tier status.

---

## Scalability Considerations

| Concern | At 14 agents | At 50 agents | At 200 agents |
|---------|-------------|-------------|---------------|
| Memory links table | ~1K links/agent, negligible | Index on target_id handles it | Consider partitioning by agent |
| Auto-link on insert | ~50ms (3 KNN queries) | Same (per-agent SQLite) | Same (isolated DBs) |
| Compact personality | Reduces prompt by ~500-1500 tokens/agent | 25K-75K tokens saved across fleet | Significant cost reduction |
| Model tiering (haiku default) | ~60x cost reduction per message for simple tasks | Fleet-wide savings compound | Major operational cost difference |
| Graph-augmented search | <100ms with depth=1 | Same (per-agent) | Same (per-agent) |

---

## Suggested Build Order

The three features have clear dependency relationships:

```
Phase 1: Knowledge Graph (no dependencies on other v1.5 features)
  └── memory_links table + KnowledgeGraph class + auto-link on insert
  └── Modify consolidation to create derived links
  └── Modify dedup to create supersedes links

Phase 2: On-Demand Memory Loading (depends on Phase 1 for graph expansion)
  └── ContextAssembler with compact personality mode
  └── memory_search MCP tool (uses KnowledgeGraph for graph expansion)
  └── Modified buildSessionConfig() for compact mode
  └── Config schema extensions (personalityMode)

Phase 3: Model Tiering (independent, but benefits from Phase 2's compact prompts)
  └── ModelTierRouter with escalation triggers
  └── Session creation/teardown for escalated models
  └── Config schema extensions (tierConfig)
  └── Usage tracking enhancements (savings calculation)

Phase 4: Integration & Cost Optimization
  └── Wire all three features together
  └── Dashboard: cost savings visualization
  └── CLI: memory graph inspection commands
  └── Heartbeat: background graph maintenance
```

**Phase ordering rationale:**
- Phase 1 is foundational -- the graph structure is needed by Phase 2's graph-augmented search
- Phase 2 reduces context bloat, making Phase 3's haiku-default more viable (haiku works better with less context noise)
- Phase 3 can technically be built in parallel with Phase 2, but the compact prompts from Phase 2 make haiku perform better
- Phase 4 is integration glue that connects everything

---

## Config Schema Changes

```yaml
# clawcode.yaml additions per agent
agents:
  - name: my-agent
    model: haiku  # Now the default for all agents
    memory:
      personalityMode: compact  # NEW: full | compact | on-demand
      graph:                    # NEW
        enabled: true
        autoLinkThreshold: 0.75  # similarity threshold for auto-linking
        autoLinkTopK: 3          # max links per new memory
        maxTraversalDepth: 1     # max hops in graph expansion
      onDemandSearch: true       # NEW: enable memory_search MCP tool
    tier:                        # NEW
      defaultModel: haiku
      escalationModel: sonnet
      advisorModel: opus         # reserved for when advisor tool hits SDK
      triggers:
        - type: keyword
          patterns: ["debug", "architect", "review", "complex"]
        - type: error_rate
          threshold: 3
        - type: explicit
          command: "/think-harder"
      maxEscalationsPerSession: 5
      cooldownMinutes: 10
```

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Advisor tool never reaches Agent SDK | Model tiering works without it (session-level switching) | MEDIUM | Session-level switching is the primary approach; advisor is future enhancement |
| Auto-link creates too many edges | Graph noise, slow traversal | LOW | Configurable threshold + topK cap per insert |
| Compact personality loses agent character | Agents feel generic | MEDIUM | Careful first-section extraction; test with each agent's SOUL.md |
| Haiku too weak for complex tasks | Poor quality responses | LOW | Escalation triggers catch this; keyword + error_rate triggers are safety nets |
| Session churn from escalation | Latency spikes, lost context | MEDIUM | Context summary injection + cooldown period prevents thrashing |

## Sources

- [Anthropic Advisor Strategy](https://www.buildfastwithai.com/blogs/anthropic-advisor-strategy-claude-api) -- advisor tool API details, beta header
- [Tiered Model Routing Guide](https://www.freecodecamp.org/news/how-to-build-a-cost-efficient-ai-agent-with-tiered-model-routing) -- complexity classification patterns
- [Claude AI Models Compared 2026](https://ai-herald.com/claude-ai-models-compared-opus-4-6-sonnet-4-5-haiku-4-5-and-more-complete-guide-for-2026/) -- pricing, context windows
- [Knowledge Graph Tools (Obsidian)](https://github.com/obra/knowledge-graph) -- SQLite + sqlite-vec graph implementation reference
- [Context Engineering Guide](https://blog.supermemory.ai/what-is-context-engineering-complete-guide/) -- on-demand context loading patterns
- [Memory for AI Agents](https://thenewstack.io/memory-for-ai-agents-a-new-paradigm-of-context-engineering/) -- JIT memory retrieval architecture
- Existing codebase: `src/memory/`, `src/manager/session-config.ts`, `src/manager/session-adapter.ts`, `src/usage/tracker.ts`
