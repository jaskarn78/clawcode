# Pitfalls Research

**Domain:** Smart Memory & Model Tiering for multi-agent Claude Code orchestration (ClawCode v1.5)
**Researched:** 2026-04-10
**Confidence:** HIGH (codebase analysis + domain research + prior milestone learnings)

## Critical Pitfalls

### Pitfall 1: Knowledge Graph Causes Context Explosion Instead of Reducing It

**What goes wrong:**
The whole point of on-demand memory loading is to reduce context bloat. But a naive graph traversal does the opposite. When an agent queries "what do I know about project X?", the graph follows backlinks: project X links to requirements, requirements link to decisions, decisions link to agents, agents link to other projects. The traversal fans out exponentially, pulling in far more context than the flat "top-K search" it replaced. The agent ends up with MORE tokens in context than the current system that just injects hot-tier memories.

**Why it happens:**
Obsidian-style knowledge graphs are designed for human browsing where you follow one link at a time. When an LLM agent traverses the same graph programmatically, it has no inherent stopping criterion. Developers set a depth limit (e.g., 2 hops) but don't account for high-degree hub nodes. A single hub node with 50 edges at depth 1 produces 2,500 nodes at depth 2. The existing memory store has no concept of node degree or graph topology -- it's flat key-value with vector search.

**How to avoid:**
1. Implement a **token budget** for graph traversal, not a depth limit. "Load at most 2,000 tokens of related context" is more useful than "traverse 2 hops." Track token count as you traverse and stop when budget is exhausted.
2. Use **relevance-gated traversal**: at each hop, only follow edges where the linked node's semantic similarity to the original query exceeds a threshold (e.g., cosine distance < 0.3). This prunes irrelevant branches before they fan out.
3. Cap the **fan-out per node** at 5-8 edges max. When a node has more edges, rank by relevance and take only the top ones.
4. Design graph queries to return **summaries of connected clusters**, not full content. "Project X connects to 12 requirements (3 high-priority)" is cheaper than loading all 12 requirement texts.
5. Instrument traversal with token counting from day one. Log how many tokens each graph query produces. Set alerts for queries exceeding 3,000 tokens.

**Warning signs:**
- Graph queries returning more tokens than the current flat top-K search (current: ~10 results * ~200 tokens = ~2,000 tokens)
- Context fill percentage INCREASING after deploying on-demand loading
- Agent performance degrading on tasks that previously worked fine
- "Lost in the middle" effect: agent ignores graph context placed mid-prompt

**Phase to address:**
Phase 1 (Knowledge Graph schema & traversal) -- the traversal budget system must be designed alongside the graph schema, not bolted on after the graph is built.

---

### Pitfall 2: Model Escalation Feedback Loop ("Escalation Spiral")

**What goes wrong:**
Agent runs on haiku. Encounters a moderately complex task. Escalates to sonnet. Sonnet produces a longer, more detailed response that increases context size. Next turn, context is larger, haiku struggles more with the bigger context. Escalates again. Each escalation produces richer output that makes the NEXT turn harder for haiku to handle. The agent never de-escalates back to haiku because the context accumulated during sonnet/opus turns is too complex for haiku to process effectively. Within 10-15 turns, every agent is permanently running on opus. Cost goes from $0.25/M tokens (haiku) to $15/M tokens (opus) -- a 60x increase.

**Why it happens:**
Escalation decisions are based on task complexity, but they don't account for context complexity growth caused by the escalation itself. Sonnet/opus produce more sophisticated outputs, longer chains of reasoning, and more nuanced responses. These become the conversation history that haiku must process on the next turn. The escalation criteria (e.g., "if confidence is low, escalate") trigger more often because haiku's confidence drops when processing opus-quality context. There's no mechanism to compress context back to haiku-friendly complexity after an escalation.

**How to avoid:**
1. **Mandatory de-escalation after N turns**: After an escalation completes the specific task, force a context summary and return to haiku. Don't let the agent stay on a higher model indefinitely. Design escalation as a SCOPED operation: "use sonnet for THIS task, then return to haiku."
2. **Separate escalation context**: When escalating, fork the conversation. Run the complex task on sonnet/opus in a subagent. Return only the RESULT (not the reasoning chain) to the main haiku context. This prevents context complexity accumulation.
3. **Per-agent cost budgets with hard caps**: Set a daily/hourly token budget per model tier. When the sonnet budget is exhausted, the agent must operate on haiku regardless. Alert on agents that consistently exhaust their sonnet budget.
4. **Escalation cooldown**: After de-escalating, impose a minimum number of turns (e.g., 5) before the agent can re-escalate. This prevents rapid oscillation.
5. **Track escalation frequency per agent**: An agent that escalates >30% of turns likely needs a different default model, better prompts, or a redesigned task.

**Warning signs:**
- Escalation frequency per agent trending upward over time
- Agents spending >50% of turns on sonnet/opus (they should spend <20%)
- Daily cost per agent increasing week-over-week without workload increase
- Context size growing disproportionately during escalated turns
- Agents never de-escalating after an initial escalation

**Phase to address:**
Phase 3 (Model Tiering) -- but the subagent-based escalation pattern (fork, execute, return result) should be designed in Phase 1 so the graph memory system can support it.

---

### Pitfall 3: Graph Memory Stale References and Orphan Nodes

**What goes wrong:**
The existing memory system has consolidation (daily -> weekly -> monthly) and cold archival that DELETES memories from SQLite. When a knowledge graph adds edges between memories, consolidation and archival break graph integrity. Memory A links to Memory B. Memory B gets consolidated into a weekly digest (new Memory C). Memory B is archived and deleted. Memory A now has a dangling edge pointing to a non-existent node. The graph becomes riddled with broken references. Orphan nodes accumulate -- memories with no incoming edges that are effectively invisible to graph traversal but still consume storage and search index space.

**Why it happens:**
The existing consolidation pipeline (`runConsolidation` in `consolidation.ts`) and cold archival (`archiveToCold` in `tier-manager.ts`) delete source memories after processing. They have no concept of graph edges. They don't check whether other memories reference the one being deleted. Adding a graph layer on top of a system designed for flat, independent memory entries creates a fundamental impedance mismatch.

**How to avoid:**
1. **Graph-aware consolidation**: Before consolidating or archiving a memory, check for incoming edges. If other memories reference it, either: (a) redirect edges to the consolidated digest, or (b) preserve a stub node with the ID and a pointer to the digest.
2. **Soft-delete, not hard-delete**: Change archival to mark memories as archived rather than deleting from SQLite. Keep the ID and a minimal stub (title, tags, pointer to cold file) in the graph. Only remove from vec_memories (the vector index) to save search performance.
3. **Edge table with cascading updates**: Store edges in a separate SQLite table (`graph_edges`). When a memory is consolidated, update all edges pointing to it in a single transaction. This is a foreign-key-like pattern but manual because sqlite-vec virtual tables can't have foreign keys.
4. **Scheduled orphan detection**: Run a heartbeat check that finds nodes with zero incoming edges and zero outgoing edges (true orphans). Either connect them to a relevant cluster or flag for cleanup.
5. **Referential integrity check before archive**: Add a pre-archive hook to `TierManager.archiveToCold()` that queries the edge table and handles references before deletion.

**Warning signs:**
- Graph traversal returning "node not found" errors for edge targets
- Increasing count of orphan nodes over time (nodes in `memories` with no entries in `graph_edges`)
- Consolidation creating new digest nodes that are disconnected from the rest of the graph
- Cold archive files referencing graph nodes that no longer exist in SQLite

**Phase to address:**
Phase 1 (Knowledge Graph schema) -- the edge table and referential integrity hooks MUST be designed before any consolidation or archival code is modified. Retrofitting graph integrity onto a running system requires migrating every existing memory.

---

### Pitfall 4: On-Demand Loading Defeats the Hot Tier

**What goes wrong:**
The current system has a carefully designed hot tier (max 20 memories, promoted by access frequency, demoted after 7 days of inactivity). On-demand loading bypasses this entirely. Instead of injecting hot-tier memories into every prompt, the agent queries the graph "when needed." But "when needed" means the agent has to RECOGNIZE it needs context, formulate a query, wait for results, and incorporate them. For routine tasks where the hot tier would have already had the answer in context, on-demand loading adds latency and cognitive overhead. Worse: the agent might not realize it needs context at all, producing lower-quality responses than the system it replaced.

**Why it happens:**
Hot-tier injection is proactive (push model) -- context is always available. On-demand loading is reactive (pull model) -- context must be explicitly requested. LLMs don't reliably know when they're missing information. They confabulate rather than admitting ignorance and querying memory. The existing hot tier budget of 20 memories was calibrated to fit within ~4,000 tokens of context. Removing this proactive injection means the agent loses its "working memory."

**How to avoid:**
1. **Hybrid approach**: Keep hot-tier injection as a baseline. Layer on-demand loading as a SUPPLEMENT for deeper queries, not a replacement. The hot tier provides working memory; the graph provides long-term recall.
2. **Core identity is NEVER on-demand**: Agent identity (SOUL.md, IDENTITY.md), current task state, and active commitments must always be in the initial context. These are not candidates for on-demand loading.
3. **Smart prefetch**: When a message arrives, run a quick semantic search against the graph BEFORE the agent processes it. Inject the top results alongside the hot tier. This gives the agent proactive context without stuffing the full hot tier.
4. **Monitor retrieval-before-answer rate**: Track how often the agent uses the graph query tool vs. answering directly. If it rarely queries the graph, the on-demand system is providing no value (and the hot tier was sufficient). If it queries on every turn, the overhead is too high.
5. **Fallback to hot tier**: If graph queries are slow or failing, fall back to the existing hot-tier injection pattern. The current system works -- don't break it.

**Warning signs:**
- Agent response quality decreasing for routine queries that previously worked well
- Agent never using the graph query tool (tool call rate near zero)
- Agent ALWAYS using the graph query tool (unnecessary overhead on simple queries)
- Response latency increasing due to graph query round-trips
- Agent confabulating facts that exist in the graph but were never queried

**Phase to address:**
Phase 2 (On-Demand Loading) -- but the decision to use hybrid (hot tier + on-demand) rather than pure on-demand must be made in Phase 1 during architecture.

---

### Pitfall 5: Personality Tokens Compete with Memory Tokens in Reduced Budget

**What goes wrong:**
v1.5's goal is reducing context bloat. The natural approach is to shrink the prompt by loading less upfront. But SOUL.md + IDENTITY.md + skills + system instructions are non-negotiable -- they define what the agent IS. If you reduce the memory budget to make room for on-demand loading infrastructure (graph query tool definitions, retrieval instructions, escalation rules), you're actually INCREASING the fixed overhead while reducing the useful memory budget. The agent ends up with less working memory than before, but with more infrastructure tokens.

**Why it happens:**
Model tiering adds new instructions to every prompt: "you are currently running on haiku; if you need to escalate, use tool X; your cost budget is Y." Knowledge graph adds tool definitions for graph queries, traversal instructions, result formatting rules. Personality retention adds identity re-anchoring text. Each v1.5 feature adds 200-500 tokens of instructional overhead. With 14 agents, this is invisible per-agent but collectively represents a significant portion of each agent's context budget.

**How to avoid:**
1. **Token budget accounting**: Before implementing, calculate the total fixed token cost of all v1.5 additions. If the new fixed overhead exceeds 1,500 tokens, it's too much -- optimize the instructions.
2. **Merge, don't layer**: Instead of adding separate instruction blocks for graph, tiering, and personality, merge them into a single concise system block. "You are [identity]. Query [tool] for context. You're on [model], escalate via [tool]" -- one paragraph, not three sections.
3. **Move tiering logic out of the prompt**: The agent doesn't need to know about model tiering. The ORCHESTRATOR (Agent Manager) makes escalation decisions based on signals from the agent, not instructions TO the agent. This removes ~300 tokens of tiering instructions from every prompt.
4. **Compress SOUL.md**: Current identity files may be verbose. Distill personality to 3-5 behavioral rules, not narrative descriptions. "Terse. Technical. Never say 'certainly'. Max 3 sentences unless asked for more." is more effective and cheaper than a paragraph of personality description.
5. **Measure before/after context overhead**: Compare the fixed prompt size (before any user message) for v1.4 vs v1.5. If v1.5 is larger, the optimization failed.

**Warning signs:**
- System prompt token count increasing between v1.4 and v1.5
- Less room for actual memory/context than in v1.4
- Agents hitting compaction thresholds sooner than in v1.4
- Identity instructions being truncated or omitted to fit budget

**Phase to address:**
Phase 1 (Architecture) -- token budget allocation must be a design constraint, not an afterthought. Assign budgets: identity (500 tokens), hot memory (2,000 tokens), graph results (1,500 tokens), tools (500 tokens), user message (remaining).

---

### Pitfall 6: Haiku Can't Execute Existing Agent Capabilities

**What goes wrong:**
The system was built and tested with sonnet as the default model. All agent skills, tool usage patterns, consolidation prompts, and memory extraction logic were written assuming sonnet-level reasoning. Switching to haiku as the default breaks these capabilities: haiku fails to follow multi-step tool sequences, produces poor-quality memory extractions, writes lower-quality consolidation summaries, and struggles with the complex system prompts that define agent behavior. Agents appear degraded across the board.

**Why it happens:**
Haiku is a smaller, faster, cheaper model optimized for simple tasks. The existing codebase has implicit assumptions about model capability baked into prompt complexity, tool chain depth, and expected output quality. Nobody tested whether haiku can actually handle the workload because the system was always running on sonnet. The gap between "haiku can respond to messages" and "haiku can orchestrate memory consolidation, graph traversal, identity maintenance, and inter-agent communication" is enormous.

**How to avoid:**
1. **Haiku compatibility audit**: Before switching any agent to haiku, run the full test suite with haiku as the model. Identify which operations fail or degrade.
2. **Tiered task design**: Classify all agent operations by required model capability. Simple message responses: haiku. Memory consolidation: sonnet. Complex reasoning: opus. Design the system so haiku agents can offload capability-requiring tasks to appropriate model tiers automatically.
3. **Simplify prompts for haiku**: Create haiku-optimized versions of system prompts, consolidation instructions, and memory extraction templates. Shorter, more explicit, less nuanced. Not one-size-fits-all prompts.
4. **Gradual rollout**: Don't switch all 14 agents to haiku at once. Start with 2-3 low-complexity agents (e.g., agents that mostly relay information or handle simple Q&A). Monitor quality metrics before expanding.
5. **Quality gates**: Implement output quality checks (response length, tool usage success rate, user satisfaction signals) that trigger automatic escalation when haiku underperforms.

**Warning signs:**
- Tool call failure rates increasing after model switch
- Memory extraction quality declining (fewer facts extracted, more noise)
- Consolidation summaries becoming vague or missing key details
- Agent skill execution failing on tasks that worked with sonnet
- Users noticing response quality degradation

**Phase to address:**
Phase 3 (Model Tiering) -- but the haiku compatibility audit must happen BEFORE implementation, not during rollout. Run the audit as a pre-Phase 3 spike.

---

### Pitfall 7: Graph Edges Encoded in Memory Content Create Parsing Fragility

**What goes wrong:**
The simplest way to add graph structure is to embed links directly in memory content: "Project X (see also: [[requirement-A]], [[decision-B]])" -- Obsidian-style wikilinks inside the content field. This makes the graph structure dependent on text parsing. Content updates, consolidation rewrites, or even minor formatting changes break the links. The graph becomes silently corrupt -- edges appear to exist in the content but don't resolve because the target ID changed or the content was rewritten.

**Why it happens:**
Obsidian works this way because humans maintain the links. In an automated system, memories are created by LLM extraction, modified by consolidation, and archived by tier management. No human is maintaining link integrity. The LLM that creates a memory might format a link as `[[requirement-A]]`, but the consolidation LLM might rewrite it as "the requirement about authentication" -- silently destroying the link.

**How to avoid:**
1. **Separate edge storage**: Store graph edges in a dedicated `graph_edges` table, NOT embedded in content. Schema: `(source_id TEXT, target_id TEXT, edge_type TEXT, weight REAL, created_at TEXT)`. Edges are structural data, not content data.
2. **Content is content, links are links**: The `memories.content` column contains only the memory text. Graph relationships are stored exclusively in `graph_edges`. This separation survives consolidation, archival, and content rewrites.
3. **Automated edge extraction**: When a new memory is created, use semantic similarity to find related memories and create edges automatically. Don't rely on the LLM to generate link syntax.
4. **Bidirectional edges by default**: When creating an edge A->B, also create B->A (or use a flag for directionality). This ensures backlink traversal works without scanning all edges.
5. **Edge validation on read**: When traversing the graph, verify that both source and target nodes exist before returning the edge. Skip broken edges and log them for cleanup.

**Warning signs:**
- Memory content containing `[[...]]` syntax (links should not be in content)
- Consolidation changing or removing linked references in memory text
- Graph traversal producing different results before and after consolidation
- Regex-based link parsing breaking on edge cases (nested brackets, special characters)

**Phase to address:**
Phase 1 (Knowledge Graph schema) -- the edge storage design must be decided before any graph code is written. This is a schema-level decision that's extremely expensive to change later.

---

### Pitfall 8: Circular References in Auto-Linked Graph Cause Infinite Traversal

**What goes wrong:**
Automated edge creation (based on semantic similarity) naturally produces cycles: Memory A is related to Memory B, B is related to C, C is related to A. When an agent queries "what's related to A?", the traversal visits A -> B -> C -> A -> B -> C -> ... until hitting a depth limit. Even with depth limits, circular paths waste traversal budget visiting the same nodes repeatedly. The token budget fills up with redundant content from the same cluster of memories.

**Why it happens:**
Semantic similarity is symmetric: if A is similar to B, B is similar to A. Any similarity-based edge creation will produce dense clusters with many internal cycles. This is fine for human-browsed knowledge bases (you can see you've been to this page before) but catastrophic for programmatic traversal that doesn't track visited nodes.

**How to avoid:**
1. **Visited-set tracking**: Every graph traversal MUST maintain a set of visited node IDs. Never visit the same node twice in a single traversal. This is basic graph algorithms but easy to miss in an async traversal pipeline.
2. **BFS, not DFS**: Use breadth-first traversal so that closer nodes are visited first. DFS can follow a deep cycle before visiting shallow but more relevant neighbors.
3. **Deduplicate results**: After traversal, deduplicate by node ID before returning results to the agent. Even if the traversal visits a node via multiple paths, it should appear once in the output.
4. **Edge weight pruning**: Don't create edges for every semantically similar pair. Only create edges above a high similarity threshold (e.g., cosine distance < 0.15, stricter than the existing dedup threshold of 0.85 similarity). Fewer edges = fewer cycles = more efficient traversal.
5. **Community detection**: Periodically run connected-component or community detection on the graph. Represent dense clusters as a single "topic node" with a summary, rather than traversing every node in the cluster.

**Warning signs:**
- Graph traversal returning duplicate memories (same content, different paths)
- Traversal taking >200ms (should be <50ms for a well-pruned graph)
- Token budget exhausted by a single cluster of related memories
- Same ~5 memories appearing in results for every query (hub-node dominance)

**Phase to address:**
Phase 1 (Knowledge Graph traversal) -- visited-set tracking must be in the first implementation of graph traversal, not added after finding infinite loops in production.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Embedding links in content (`[[...]]` syntax) | Quick to implement, familiar to Obsidian users | Parsing fragility, broken by consolidation, no referential integrity | Never for an automated system -- always use a separate edge table |
| All escalation logic in the prompt | Simple implementation, agent makes its own decisions | Token overhead in every prompt, inconsistent escalation behavior, no centralized control | Never -- escalation logic belongs in the orchestrator, not the agent prompt |
| Single escalation threshold for all agents | Uniform behavior, simpler config | High-complexity agents escalate too rarely, simple agents escalate too often | Early MVP only; per-agent thresholds needed within the first sprint |
| No de-escalation mechanism | Simpler code, avoid context summary complexity | Agents permanently stuck on expensive models after first escalation | Never -- this is the #1 cause of runaway costs |
| Graph edges without edge types | Simpler schema, faster to build | All relationships are "related to" -- no way to distinguish "requires", "contradicts", "supersedes" | MVP only; add edge types before consolidation integration |
| Hot tier injection AND on-demand loading without budget coordination | Both systems work independently | Context double-loads information, increasing bloat instead of reducing it | Never -- they must share a token budget |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Graph edges + existing consolidation pipeline | Consolidation deletes source memories, breaking edge references | Add pre-consolidation hook to redirect edges to the new digest node; update `graph_edges` in the same transaction |
| Graph edges + existing cold archival | `TierManager.archiveToCold()` calls `store.delete()` which orphans all edges | Add edge cleanup to `archiveToCold()`: either redirect edges to a stub node or cascade-delete edges |
| Model tiering + existing `summaryModel` config | Consolidation already has a `summaryModel` field in schema; tiering may conflict | Use the consolidation `summaryModel` as the MINIMUM model for consolidation tasks; tiering escalation should not downgrade consolidation below this |
| On-demand loading + existing `SemanticSearch.search()` | Graph queries and flat semantic search return overlapping results | Deduplicate: if graph traversal already returned a memory, exclude it from semantic search results. Or unify into a single retrieval pipeline. |
| Model tiering + existing context health zones | Zone thresholds calibrated for sonnet context window; haiku may have different effective limits | Recalibrate zone thresholds per model: haiku degrades at lower fill % than sonnet (research shows effective context is far below advertised) |
| Knowledge graph + existing deduplication | Dedup merges near-duplicate memories but doesn't merge their graph edges | When `dedup.mergeMemory()` runs, also merge edges from both source memories onto the surviving memory |
| On-demand loading + existing compaction workflow | Compaction extracts memories and embeds them; graph edges for these new memories are never created | Add post-compaction hook to create graph edges for newly extracted memories based on semantic similarity to existing graph nodes |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Graph traversal with no fan-out limit on hub nodes | Single query returns 50+ memories, consuming entire token budget | Cap fan-out at 5-8 edges per node during traversal; rank by relevance | When any node has >20 edges (likely after 2-3 weeks of automated edge creation) |
| Model escalation on every tool-use turn | Cost 60x higher than baseline; agents never return to haiku | Escalate only for multi-step reasoning, not single tool calls; implement cooldown | Immediately upon deploying tiering without escalation criteria refinement |
| Embedding every graph edge for similarity scoring | ~50ms per embedding * 100 edges per node = 5 seconds per graph operation | Pre-compute and cache edge relevance scores; only re-embed on content change | When graph exceeds ~1,000 edges per agent |
| Full graph scan for orphan detection | O(V+E) scan on every heartbeat cycle; blocks other heartbeat checks | Run orphan detection as a separate low-priority scheduled task, not in the heartbeat | When graph exceeds ~5,000 nodes per agent |
| sqlite-vec KNN search on growing graph_edges table | Edge lookups slow as table grows; not indexed for source/target lookups | Add indexes on `graph_edges(source_id)` and `graph_edges(target_id)`; these are regular B-tree queries, not vector queries | When edge count exceeds ~10,000 per agent |
| Context window wasted on model tiering metadata | Agent prompt grows by 300-500 tokens for tiering instructions per turn | Move tiering decisions to the orchestrator; agent doesn't need to know its model tier | Immediately -- every token of tiering instruction is a token not available for actual work |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Graph traversal crosses agent boundaries | Agent A queries graph and sees Agent B's memories via shared edge | Graph edges MUST be per-agent; no cross-agent edges unless explicitly created by admin. Enforce agent_id scoping on all graph queries. |
| Model escalation used to bypass execution approval | Agent escalates to opus to execute a tool that was restricted on haiku's allowlist | Execution approval is model-independent. The allowlist applies to the AGENT, not the model tier. Verify this invariant. |
| Cost budget bypass via rapid escalation | Compromised or buggy agent escalates to opus on every turn, exhausting API budget | Hard per-agent cost caps enforced at the orchestrator level. Rate-limit escalation requests (max 5 per hour). |
| Graph contains sensitive memories accessible via traversal | Agent retrieves a memory via graph that it wouldn't have found via direct search (different query terms, but connected via edge) | Graph traversal must respect the same access controls as direct memory search. No "graph backdoor" to restricted content. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Agent quality visibly drops after model downgrade | Users in Discord notice dumber responses and lose trust in the agent | Transparent indicator is worse (users will always prefer the expensive model). Instead, ensure haiku responses are GOOD ENOUGH that the switch is invisible. If they're not, haiku isn't viable for that agent. |
| Graph queries add visible latency to responses | Users see 2-3 second delays before agent responds, vs. instant responses before | Prefetch graph results during message processing, not during response generation. Use "typing" indicator during prefetch. |
| Agent forgets context that existed in v1.4 hot tier | Users who relied on agents "remembering" things without being asked see regressions | Keep hybrid approach: hot tier for recent working memory, graph for deeper recall. Don't remove a working feature. |
| Escalation visible to users (model name in response) | Users game the system to trigger opus responses for trivial queries | Never expose the current model to users. Escalation is an internal optimization, not a user-facing feature. |

## "Looks Done But Isn't" Checklist

- [ ] **Graph traversal:** Does it handle cycles? Test with A->B->C->A and verify no infinite loops or duplicate results.
- [ ] **Edge table:** Does it survive consolidation? Run consolidation with edges pointing to consolidated memories and verify edges redirect correctly.
- [ ] **Model de-escalation:** Does the agent actually return to haiku after an escalation completes? Test with a sequence: simple, complex, simple, simple. Verify model on each turn.
- [ ] **Token budget:** Is the total v1.5 system prompt SMALLER than v1.4? Measure both. If v1.5 is larger, the optimization failed.
- [ ] **Cold archival:** Does `archiveToCold()` clean up graph edges? Archive a memory with 5 incoming edges and verify no dangling references.
- [ ] **Orphan detection:** Does the scheduled check find AND handle orphans? Create 10 orphan nodes and verify they're either connected or flagged.
- [ ] **Cost tracking:** Are per-agent model tier usage percentages being logged? Verify you can answer "what % of Agent X's turns used sonnet this week?"
- [ ] **Hot tier + on-demand:** Do they deduplicate? Inject a memory into both hot tier and graph. Verify it appears once in the agent's context, not twice.
- [ ] **Haiku compatibility:** Can haiku actually use the graph query tool effectively? Test with haiku and verify it formulates useful queries, not garbage.
- [ ] **Escalation criteria:** Are they specific enough? "Task is complex" is too vague. "Tool call returned >5,000 tokens AND requires multi-step reasoning" is actionable.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Context explosion from graph traversal | LOW | Reduce fan-out cap; increase similarity threshold for edge creation; re-tune token budget |
| Escalation spiral (agents stuck on opus) | MEDIUM | Force de-escalation for all agents; clear context with session restart; implement mandatory cooldowns before re-deploying |
| Broken graph edges after consolidation | HIGH | Full graph integrity scan; identify all dangling edges; either delete or redirect; requires downtime per agent |
| Haiku can't handle agent workload | MEDIUM | Revert to sonnet as default; redesign prompts for haiku; re-test before retry; may require per-agent model assignment |
| Orphan node accumulation | LOW | Run orphan detection scan; batch-connect or batch-delete orphans; schedule recurring cleanup |
| Circular references causing slow traversal | LOW | Add visited-set tracking to traversal; prune low-weight edges; rebuild edge index with higher similarity threshold |
| Token budget exceeded by v1.5 overhead | MEDIUM | Audit every token of system prompt; compress identity files; move tiering logic to orchestrator; merge instruction blocks |
| Hot tier disabled by on-demand migration | LOW | Re-enable hot tier injection alongside graph queries; dedup overlap; hybrid approach is the safe path |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Context explosion from graph traversal | Phase 1: Graph Schema & Traversal | Measure tokens returned by graph queries; must be < 2,000 tokens average |
| Escalation spiral | Phase 3: Model Tiering | Run 50-turn simulation; verify haiku usage > 70% of turns |
| Stale/broken graph edges | Phase 1: Graph Schema | Run consolidation + archival cycle; verify zero dangling edges |
| On-demand defeats hot tier | Phase 2: On-Demand Loading | Compare response quality v1.4 vs v1.5 on 20 representative queries |
| Personality token competition | Phase 1: Architecture | Measure system prompt size v1.4 vs v1.5; v1.5 must be equal or smaller |
| Haiku capability gap | Phase 3: Model Tiering (pre-implementation spike) | Run full test suite with haiku; document which operations degrade |
| Links in content vs. edge table | Phase 1: Graph Schema | Code review: zero `[[...]]` patterns in memory content; all edges in `graph_edges` table |
| Circular graph traversal | Phase 1: Graph Traversal | Test with 100-node graph containing 5+ cycles; verify O(V) traversal, not O(V*cycles) |

## Sources

- [Solving Context Window Overflow in AI Agents](https://arxiv.org/html/2511.22729v1) -- tool output accumulation, context management strategies
- [Context Engineering for AI Agents](https://weaviate.io/blog/context-engineering) -- retrieval precision, lost-in-the-middle effect
- [AI Cost Controls: Budgets, Throttling & Model Tiering](https://www.clarifai.com/blog/ai-cost-controls) -- escalation patterns, cost cap strategies
- [Agentic AI Cost Management](https://konghq.com/blog/enterprise/ai-cost-management-stopping-margin-erosion) -- model routing, waterfall approach
- [LLM Orchestration Patterns That Actually Work](https://agentika.uk/blog/llm-orchestration-patterns) -- anti-patterns in agent orchestration
- [Building AI Agents with Knowledge Graph Memory (Graphiti)](https://medium.com/@saeedhajebi/building-ai-agents-with-knowledge-graph-memory-a-comprehensive-guide-to-graphiti-3b77e6084dec) -- temporal knowledge graphs, edge management
- [Zep: Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956) -- fact invalidation, temporal edges
- [Knowledge Graph for Obsidian (GitHub)](https://github.com/obra/knowledge-graph) -- SQLite + sqlite-vec graph implementation, orphan detection
- [LLM Context Window Limitations 2026](https://atlan.com/know/llm-context-window-limitations/) -- effective context vs advertised, performance degradation
- [Maximum Effective Context Window Research](https://www.oajaiml.com/uploads/archivepdf/643561268.pdf) -- accuracy degradation at fill percentages far below advertised limits
- ClawCode codebase analysis: `src/memory/store.ts`, `src/memory/tier-manager.ts`, `src/memory/consolidation.ts`, `src/memory/search.ts`, `src/heartbeat/context-zones.ts`

---
*Pitfalls research for: ClawCode v1.5 Smart Memory & Model Tiering*
*Researched: 2026-04-10*
