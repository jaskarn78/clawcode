# Phase 37: On-Demand Memory Loading - Research

**Researched:** 2026-04-10
**Domain:** MCP tool registration, system prompt reduction, memory retrieval
**Confidence:** HIGH

## Summary

This phase adds a `memory_lookup` MCP tool that agents invoke mid-conversation to search their memory store, and replaces full SOUL.md injection with a compact personality fingerprint (~200-300 tokens). The existing infrastructure is well-suited: `SemanticSearch` already handles KNN queries, the MCP server already delegates to the daemon via IPC, and `buildSessionConfig` is the single point where system prompts are assembled.

The key architectural decision is that `memory_lookup` follows the existing IPC pattern (MCP tool -> daemon handler -> agent's MemoryStore/SemanticSearch). The agent name must be passed as context so the daemon knows which memory store to query. The fingerprint is a static extraction from SOUL.md at startup -- no LLM needed.

**Primary recommendation:** Add `memory_lookup` as an IPC-backed MCP tool, create a `src/memory/fingerprint.ts` module for SOUL.md condensation, and refactor `buildSessionConfig` to inject fingerprint + top-3 hot memories instead of full SOUL.md.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Tool accepts `query` (string) + optional `limit` (int, default 5) -- matches existing SemanticSearch KNN pattern
- Returns array of `{id, content, relevance_score, tags, created_at}` -- enough for agent to decide what's useful
- Does NOT include graph neighbors -- Phase 38 adds graph-enriched retrieval (GRAPH-03)
- Registered as MCP tool via existing MCP server (`src/mcp/server.ts`) -- agents already consume MCP tools
- Static extraction at agent startup -- parse SOUL.md headings, extract key traits, condense to bullet list (~200-300 tokens)
- Fingerprint includes: name, emoji, core personality traits (3-5), communication style, key constraints
- Full SOUL.md stored as a memory entry in agent's MemoryStore with tag `soul` and `importance: 1.0` -- retrievable via `memory_lookup`
- Agent decides when to pull full SOUL.md -- fingerprint includes instruction "Use memory_lookup for deeper identity context when needed"
- Hybrid approach -- keep hot memories in prompt but reduce count (top 3 instead of all), add memory_lookup for the rest
- Refactor `buildSessionConfig` to inject only fingerprint + top-N hot memories. Hot tier still exists but is smaller
- Global rollout -- all agents get memory_lookup tool and fingerprint

### Claude's Discretion
- Fingerprint extraction algorithm (heading parsing, trait condensation)
- How agent name is passed to memory_lookup (IPC context vs explicit parameter)
- Whether fingerprint is cached in memory or regenerated per session start

### Deferred Ideas (OUT OF SCOPE)
- Graph-enriched retrieval (Phase 38, GRAPH-03)
- Context assembly pipeline with per-source token budgets (Phase 41, LOAD-03)
- Dynamic fingerprint that evolves with agent experience
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOAD-01 | Agent retrieves memories via a `memory_lookup` tool call instead of eager hot-tier context stuffing | MCP tool registration via `createMcpServer()`, IPC delegation to daemon, SemanticSearch.search() for KNN queries |
| LOAD-02 | Agent identity is loaded as a compressed personality fingerprint (~200-300 tokens) with full SOUL.md available as retrievable memory | SOUL.md parsing in `buildSessionConfig`, MemoryStore.insert() for storing SOUL.md as memory entry, fingerprint module |
</phase_requirements>

## Architecture Patterns

### Recommended Project Structure
```
src/
├── mcp/
│   └── server.ts          # Add memory_lookup tool definition
├── memory/
│   ├── fingerprint.ts     # NEW: SOUL.md -> compact fingerprint extraction
│   ├── search.ts          # Existing SemanticSearch (unchanged)
│   ├── store.ts           # Existing MemoryStore (unchanged)
│   └── tier-manager.ts    # getHotMemories() used for top-N
├── manager/
│   ├── session-config.ts  # Refactor: fingerprint + top-3 hot instead of full SOUL.md
│   ├── session-memory.ts  # Store SOUL.md as memory entry during initMemory()
│   └── daemon.ts          # Add "memory-lookup" IPC handler
└── shared/
    └── types.ts           # Any new type additions
```

### Pattern 1: MCP Tool via IPC Delegation
**What:** MCP tools delegate to daemon via Unix socket IPC. Daemon has access to per-agent resources.
**When to use:** Any tool that needs access to agent-specific state (memory stores, config).
**Example:**
```typescript
// In src/mcp/server.ts — follows existing pattern exactly
server.tool(
  "memory_lookup",
  "Search your memory for relevant context, past decisions, and knowledge",
  {
    query: z.string().describe("What to search for in memory"),
    limit: z.number().int().min(1).max(20).default(5).describe("Max results to return"),
    agent: z.string().describe("Agent name (auto-populated by system)"),
  },
  async ({ query, agent, limit }) => {
    const result = await sendIpcRequest(SOCKET_PATH, "memory-lookup", {
      agent,
      query,
      limit,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);
```

### Pattern 2: Fingerprint Extraction (Static, No LLM)
**What:** Parse SOUL.md markdown structure to extract a condensed identity summary.
**When to use:** At agent startup, once per session.
**Example:**
```typescript
// src/memory/fingerprint.ts
export type PersonalityFingerprint = {
  readonly name: string;
  readonly emoji: string;
  readonly traits: readonly string[];
  readonly style: string;
  readonly constraints: readonly string[];
  readonly instruction: string; // "Use memory_lookup for deeper identity context"
};

export function extractFingerprint(soulContent: string): PersonalityFingerprint {
  // Parse markdown headings and bullet points
  // Extract name/emoji from first heading or identity section
  // Pull 3-5 core traits from personality/soul sections
  // Condense communication style
  // Return frozen object
}

export function formatFingerprint(fp: PersonalityFingerprint): string {
  // Format as compact bullet list for system prompt injection
  // Target: 200-300 tokens
}
```

### Pattern 3: Daemon IPC Handler
**What:** Daemon handles IPC requests by routing to the correct agent's memory subsystem.
**When to use:** When MCP tools need per-agent state from the daemon process.
**Example:**
```typescript
// In daemon.ts IPC handler switch
case "memory-lookup": {
  const { agent, query, limit } = payload;
  const store = memoryManager.memoryStores.get(agent);
  const embedder = memoryManager.embedder;
  if (!store) throw new Error(`Agent ${agent} not found`);
  
  const embedding = await embedder.embed(query);
  const search = new SemanticSearch(store.getDatabase());
  const results = search.search(embedding, limit);
  
  return {
    results: results.map(r => ({
      id: r.id,
      content: r.content,
      relevance_score: r.combinedScore,
      tags: r.tags,
      created_at: r.createdAt,
    })),
  };
}
```

### Anti-Patterns to Avoid
- **Embedding in the MCP server process:** The MCP server runs as stdio subprocess. It cannot hold memory stores. Always delegate via IPC.
- **LLM-based fingerprint generation:** Do NOT call an LLM to summarize SOUL.md. Static markdown parsing is sufficient and deterministic.
- **Removing hot tier entirely:** The v1.5 decision explicitly states hybrid loading. Pure on-demand causes confabulation. Keep top-3.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search | Custom cosine similarity | SemanticSearch class (existing) | Already handles KNN, over-fetch, re-ranking, access tracking |
| Text embedding | Custom embedding logic | EmbeddingService (existing) | Already manages model lifecycle, warmup, truncation |
| Markdown heading parsing | Complex AST parser | Simple regex on `#` headings + `-` bullets | SOUL.md follows predictable structure; no need for remark/unified |
| IPC communication | Custom socket protocol | `sendIpcRequest` (existing) | Battle-tested IPC client already used by all MCP tools |

## Common Pitfalls

### Pitfall 1: Agent Name Not Available in MCP Context
**What goes wrong:** The MCP server doesn't inherently know which agent is calling. If agent name isn't passed, daemon can't route to correct memory store.
**Why it happens:** MCP tools are generic; agent identity is session-level context.
**How to avoid:** Either: (a) pass agent name as explicit tool parameter with description noting it's auto-populated, or (b) the daemon-spawned MCP server per-agent knows its agent context. Current architecture uses a single MCP server, so option (a) is correct. The system prompt should tell the agent its name and instruct it to pass it.
**Warning signs:** "Agent not found" errors from daemon IPC handler.

### Pitfall 2: Embedding Latency in Synchronous MCP Call
**What goes wrong:** `memory_lookup` must embed the query text (~50ms) before KNN search. If the embedding service isn't warmed up, first call takes seconds (model download).
**Why it happens:** MCP tool calls are synchronous from the agent's perspective.
**How to avoid:** EmbeddingService is already warmed at daemon startup (`warmupEmbeddings()`). The daemon handler uses the shared embedder instance. No cold start issue.
**Warning signs:** First memory_lookup call timing out.

### Pitfall 3: SOUL.md Memory Entry Created Multiple Times
**What goes wrong:** If initMemory() stores SOUL.md every session start, duplicates accumulate.
**Why it happens:** No idempotency check on insert.
**How to avoid:** Check if a memory with tag `soul` already exists before inserting. Use `skipDedup: false` (default) -- but better to do an explicit tag-based lookup first since dedup uses semantic similarity which may false-positive on similar but different soul content.
**Warning signs:** Multiple `soul`-tagged entries in memory store.

### Pitfall 4: Fingerprint Token Count Exceeds Budget
**What goes wrong:** Fingerprint extraction pulls too much content, defeating the purpose.
**Why it happens:** SOUL.md varies in length across agents.
**How to avoid:** Hard cap the fingerprint output. Count bullet points, truncate traits to 5 max, style to 1 sentence. Validate with a token estimate (1 token ~= 4 chars, so 300 tokens ~= 1200 chars).
**Warning signs:** System prompt size doesn't meaningfully decrease.

### Pitfall 5: Hot Tier Count Mismatch After Refactor
**What goes wrong:** `getHotMemories()` returns all hot-tier entries (could be many), but we want top-3.
**Why it happens:** The tier system promotes up to `hotBudget` entries (default varies).
**How to avoid:** In `buildSessionConfig`, slice `getHotMemories()` to top 3 by importance. Don't change the tier manager's hotBudget -- that controls promotion/demotion logic. The config change is purely at the prompt injection point.
**Warning signs:** More than 3 memories appearing in system prompt.

## Code Examples

### Memory Lookup Tool Response Format
```typescript
// What the agent sees when calling memory_lookup
{
  results: [
    {
      id: "mem_abc123",
      content: "User prefers TypeScript strict mode and immutable patterns",
      relevance_score: 0.87,
      tags: ["preference", "coding"],
      created_at: "2026-04-08T10:30:00Z",
    },
    // ... up to `limit` results
  ]
}
```

### Fingerprint in System Prompt
```markdown
## Identity
- **Name:** Clawdy 💠
- **Core traits:** Competent, dry wit, resourceful, opinionated, never sycophantic
- **Style:** Direct and concise. Has opinions. Earns trust through competence.
- **Constraints:** Always read clawcode.yaml identity. Be genuinely helpful.
- Use `memory_lookup` tool for deeper identity context when needed.
```

### buildSessionConfig Refactored (Key Section)
```typescript
// Instead of injecting full SOUL.md:
// OLD: systemPrompt += config.soul + "\n\n";
// NEW:
const fingerprint = extractFingerprint(config.soul ?? soulContent);
systemPrompt += formatFingerprint(fingerprint) + "\n\n";

// Instead of all hot memories:
// OLD: hotMemories.map(mem => `- ${mem.content}`).join("\n");
// NEW:
const topN = hotMemories.slice(0, 3);
systemPrompt += topN.map(mem => `- ${mem.content}`).join("\n");
```

### SOUL.md Storage at Init
```typescript
// In session-memory.ts initMemory() or session-manager.ts startup
const soulContent = await readFile(join(config.workspace, "SOUL.md"), "utf-8");
const existingSoul = store.findByTag("soul");
if (!existingSoul || existingSoul.length === 0) {
  const embedding = await embedder.embed(soulContent);
  store.insert({
    content: soulContent,
    source: "system",
    importance: 1.0,
    tags: ["soul", "identity"],
    skipDedup: true, // Soul content is intentionally stored as-is
  }, embedding);
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose src/memory/__tests__/` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOAD-01 | memory_lookup tool returns search results via IPC | unit | `npx vitest run src/mcp/__tests__/memory-lookup.test.ts -t "memory_lookup"` | No - Wave 0 |
| LOAD-01 | Daemon handler routes to correct agent memory store | unit | `npx vitest run src/manager/__tests__/memory-lookup-handler.test.ts` | No - Wave 0 |
| LOAD-02 | Fingerprint extraction produces 200-300 token output | unit | `npx vitest run src/memory/__tests__/fingerprint.test.ts` | No - Wave 0 |
| LOAD-02 | SOUL.md stored as memory entry with importance 1.0 | unit | `npx vitest run src/memory/__tests__/soul-storage.test.ts` | No - Wave 0 |
| LOAD-02 | buildSessionConfig uses fingerprint instead of full SOUL.md | unit | `npx vitest run src/manager/__tests__/session-config.test.ts -t "fingerprint"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose src/memory/__tests__/ src/mcp/__tests__/`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/memory/__tests__/fingerprint.test.ts` -- covers LOAD-02 fingerprint extraction
- [ ] `src/mcp/__tests__/memory-lookup.test.ts` -- covers LOAD-01 tool registration and response format
- [ ] `src/manager/__tests__/memory-lookup-handler.test.ts` -- covers LOAD-01 daemon handler routing
- [ ] `src/memory/__tests__/soul-storage.test.ts` -- covers LOAD-02 SOUL.md storage idempotency
- [ ] `src/manager/__tests__/session-config.test.ts` updates -- covers LOAD-02 fingerprint injection + top-3 hot

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/mcp/server.ts` -- MCP tool registration pattern, IPC delegation
- Existing codebase: `src/memory/search.ts` -- SemanticSearch KNN implementation
- Existing codebase: `src/manager/session-config.ts` -- Current system prompt assembly
- Existing codebase: `src/memory/tier-manager.ts` -- getHotMemories() API
- Existing codebase: `src/manager/session-memory.ts` -- AgentMemoryManager initialization flow

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions -- User-specified tool interface, fingerprint spec, hybrid loading strategy

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies needed, all existing infrastructure
- Architecture: HIGH - follows established MCP -> IPC -> daemon pattern exactly
- Pitfalls: HIGH - identified from direct code analysis of existing patterns

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable -- internal architecture, no external dependencies)
