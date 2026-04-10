# Feature Research: v1.5 Smart Memory & Model Tiering

**Domain:** AI agent knowledge graphs, on-demand context loading, model routing/escalation
**Researched:** 2026-04-10
**Confidence:** MEDIUM-HIGH
**Scope:** NEW features only -- existing memory system (hot/warm/cold tiers, consolidation, decay, dedup, episodes, context health zones) is already shipped in v1.0-v1.4.

## Feature Landscape

### Table Stakes (Must Have for v1.5)

Features that define this milestone. Without these, v1.5 has no reason to exist.

| Feature | Why Expected | Complexity | Dependencies on Existing Code | Notes |
|---------|--------------|------------|-------------------------------|-------|
| On-demand memory retrieval | Current system eagerly loads hot-tier memories into context on session resume. This burns tokens on irrelevant context. Industry standard is JIT loading (GAM, Mem0, xMemory all do this). Mem0 reports 90% token savings with selective retrieval. | MEDIUM | `search.ts` (KNN search), `tier-manager.ts` (hot tier), `context-summary.ts` (resume injection) | Replace eager hot-tier context loading with query-triggered retrieval. Agent calls a tool to search memory when needed. Hot tier still exists for truly critical context (identity, active task state) but shrinks dramatically. |
| Knowledge graph links (wikilinks) | Memory entries are flat records with no explicit relationships. "Project X" and "Project X deadline" and "Project X team lead" exist as independent facts. Obsidian proved `[[backlinks]]` are the minimum viable graph -- users and agents both understand them. | MEDIUM | `store.ts` (SQLite schema), `embedder.ts` (similarity for auto-linking) | New `memory_links` table: `source_id`, `target_id`, `link_type` (explicit/semantic/consolidation). Parse `[[wikilink]]` syntax in memory content to auto-create edges. Backlink resolution on retrieval. Consolidation digests already summarize related memories -- links formalize what consolidation does implicitly. |
| Haiku as default model | Sonnet default burns 10-20x more tokens than necessary for routine agent tasks (acknowledging messages, simple lookups, casual conversation). Haiku 4.5 handles 70-80% of real agent work according to Anthropic's own benchmarks. Config already supports haiku/sonnet/opus per agent. | LOW | `config/schema.ts` (`modelSchema.default("sonnet")`) | Change default from `"sonnet"` to `"haiku"`. Migration note for existing configs. Agents that genuinely need sonnet baseline (e.g., code-heavy agents) override in their agent config. |
| Model escalation mechanism | Agent on haiku cannot handle complex reasoning, code generation, or multi-step planning. Needs a way to upgrade. Two proven patterns exist: (1) confidence-based self-assessment, (2) Anthropic's advisor tool where haiku calls opus for guidance. | HIGH | Haiku default, Claude Agent SDK, agent-manager session lifecycle | Implement the advisor tool pattern (officially supported by Anthropic as of March 2026). Haiku agent calls an `advisor` tool that routes to opus. Opus reviews context, returns guidance, haiku continues. Proven: Sonnet + Opus advisor = 2.7pp gain on SWE-bench, 11.9% cost reduction vs. pure Opus. |
| Personality efficient loading | SOUL.md and IDENTITY.md loaded into system prompt consume ~1500-2500 tokens every turn. With haiku's smaller context window, this matters even more. Need compressed identity that preserves personality without context bloat. | MEDIUM | Per-agent SOUL.md/IDENTITY.md, `context-summary.ts` | Extract core traits into structured "personality fingerprint" (~200-300 tokens): name, tone keywords, behavioral rules, hard boundaries. Full SOUL.md available as retrievable memory for identity-relevant queries. Personality is immutable config; learned preferences are mutable memory. |
| Token cost tracking | Running 14 agents on haiku with occasional opus escalation needs spend visibility. Without tracking, you cannot know if escalation is working or hemorrhaging money. Microsoft, Galileo, and Coralogix all emphasize per-agent token granularity. | MEDIUM | `agent-manager.ts`, per-agent process tracking | Per-agent, per-model token counters in SQLite. Track input/output tokens separately. Expose via CLI (`clawcode costs [agent]`) and existing web dashboard. Tag every usage event with agent ID, model, task type. |

### Differentiators (Competitive Advantage)

Features that elevate ClawCode beyond basic implementation. Not required for launch but high value.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| Graph-aware retrieval | When retrieving a memory via KNN search, also pull 1-hop neighbors from knowledge graph. "Tell me about Project X" returns the Project X memory PLUS linked memories (team, deadlines, decisions). Prevents losing structurally related but semantically distant context. | MEDIUM | Knowledge graph links, on-demand retrieval, `search.ts` | Graph traversal query after KNN: expand result set by following links. Configurable depth (1-hop default, 2-hop max). Similar to how Obsidian shows backlinks alongside the current note. |
| Semantic link discovery | Auto-detect relationships between memories without explicit `[[wikilinks]]`. Use existing embedding similarity to suggest "related memories" that haven't been linked. Mirrors Obsidian's "unlinked mentions" feature. | MEDIUM | Knowledge graph links, `embedder.ts`, croner (scheduling) | Periodic background job (croner) finds high-similarity memory pairs without existing links. Creates `suggested` link type. Agent or operator can accept/reject. Leverages existing sqlite-vec KNN infrastructure. |
| Advisor tool integration | Use Anthropic's official advisor pattern: haiku agent calls opus as a tool for hard decisions. Officially supported, battle-tested (March 2026). Better than model-switching because the haiku session stays alive. | HIGH | Model escalation, Claude API advisor tool, Agent SDK | Implement `advisor` as a Claude tool definition. Haiku handles routine work, recognizes when reasoning gets complex, calls advisor. Opus reviews shared context, returns plan/correction, haiku resumes. No session restart needed. |
| Escalation budget controls | Per-agent daily/weekly token budgets for escalated model usage. Prevents a single agent from burning unlimited opus tokens. Graceful degradation when budget exhausted (agent continues on haiku, logs warning). | MEDIUM | Token cost tracking, model escalation | Per-agent config: `escalation: { dailyBudgetTokens, weeklyBudgetTokens, allowedModels }`. Track against token counters. Discord alert via existing heartbeat when approaching 80% of budget. |
| Context assembly pipeline | Modular system that assembles context from multiple sources with token budget awareness. Each source (identity, memories, graph neighbors, task context) gets a token allocation. Prevents any single source from dominating context. | HIGH | On-demand retrieval, personality loading, graph-aware retrieval, token tracking | The "context engineering" pattern from 2025 research (Mem0, GAM). Pipeline: identity fingerprint (200-300 tokens) -> active task context (variable) -> relevant memories (configurable cap) -> graph expansions (remaining budget). Total budget = model context window * configurable fill ratio. |
| Memory importance auto-scoring | New memories get importance scored based on content analysis rather than fixed defaults (currently 0.5). "User's name is John" = high importance. "Weather is nice" = low importance. | LOW | Existing importance field in `MemoryEntry` | Start with lightweight heuristic (entity detection, keyword patterns, question/answer format detection). Can optionally use haiku for scoring if enabled. Rule-based handles 80% of cases -- don't over-engineer. |

### Anti-Features (Do NOT Build)

Features that seem appealing but create problems for ClawCode's architecture.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full graph visualization UI | "Show me the knowledge graph like Obsidian's graph view" | Engineering cost is enormous for marginal value. Agents don't need visualization. Obsidian's graph view is famously pretty but rarely actionable for knowledge retrieval. | CLI: `clawcode memory graph <agent>` outputs DOT format. Pipe to Graphviz for visuals. Add to web dashboard later as a low-priority enhancement. |
| Real-time model switching mid-turn | "Agent should switch from haiku to sonnet mid-response" | Claude Code sessions are bound to a model. Cannot change mid-turn without killing session and losing context. | Advisor tool (call opus as sub-tool within same turn) or escalate on NEXT session based on self-assessment. |
| Shared knowledge graph across agents | "All agents should share one knowledge graph" | Violates workspace isolation (key design decision since v1.0). Concurrent SQLite writes from 14 agents. Link semantics differ per agent domain. | Admin agent copies/links memories between stores via existing cross-agent IPC. Explicit, auditable, no concurrent write issues. |
| Automatic personality evolution | "Agent should update SOUL.md based on interactions" | Identity drift is a feature-killing bug. Users expect consistent personality. Uncontrolled self-modification leads to unpredictable behavior and impossible debugging. | Track "learned preferences" in memory (mutable). Personality stays in SOUL.md (immutable config). Clear separation. |
| Vector re-embedding on model upgrade | "Switch to a better embedding model and re-embed everything" | Current 384-dim all-MiniLM-L6-v2 is sufficient for memory search. Re-embedding is expensive and requires schema migration (dimension change). | Keep current embedding model. If quality proves insufficient (evidence needed), add a second vec table with new embeddings alongside existing ones. |
| Complex escalation chains (haiku -> sonnet -> opus -> sonnet -> haiku) | "Model should bounce between tiers based on sub-task complexity" | Each model switch adds session management complexity. Debugging becomes nightmarish. Context may be lost at each transition. | Two-tier only: haiku default + opus advisor tool. For agents that consistently need more than haiku, set sonnet as their base model in config. Simple, predictable. |
| LLM-powered link extraction (entity/relation extraction) | "Use Claude to automatically extract entities and relationships from every memory" | Doubles token cost on every memory write. Extraction quality varies. Creates a dependency on model availability for basic memory operations. | Wikilinks (explicit, user/agent-authored) + embedding similarity (implicit, automatic). Two complementary signals without LLM cost on every write. |

## Feature Dependencies

```
[Haiku Default]
    |
    v
[Model Escalation Mechanism]
    |                   \
    v                    v
[Advisor Tool]    [Token Cost Tracking]
                        |
                        v
                  [Escalation Budget Controls]

[Knowledge Graph Links]
    |           \
    v            v
[Graph-Aware    [Semantic Link
 Retrieval]      Discovery]

[On-Demand Memory Retrieval]
    |
    +---> [Personality Efficient Loading]
    |
    v
[Context Assembly Pipeline]
    ^           ^           ^
    |           |           |
[Personality] [Graph-Aware] [Token Tracking]
```

### Dependency Notes

- **Haiku default is prerequisite for everything model-related:** No point building escalation if agents are already on sonnet. Flip the default first, then build escape hatches.
- **Token cost tracking is cross-cutting:** Needed by escalation budgets AND context assembly (token budget awareness). Build early alongside haiku default.
- **Knowledge graph links must exist before graph-aware retrieval:** Cannot traverse a graph that doesn't exist. Schema + wikilink parsing first, retrieval second.
- **On-demand retrieval is prerequisite for context assembly:** The assembly pipeline composes multiple on-demand sources. Build individual retrieval first, then the compositor.
- **Semantic link discovery is independent enhancement:** Background job that enriches the graph. Does not block any other feature. Add anytime after graph links exist.
- **Advisor tool requires escalation mechanism:** The advisor pattern is a specific escalation strategy. Build the generic escalation hooks first (self-assessment output, escalation trigger), then implement advisor as one strategy.

## MVP Definition

### Phase 1: Foundation (Build First)

- [ ] **Haiku default model** -- Config schema change + migration guidance. Lowest effort, highest immediate cost savings. Touches: `config/schema.ts`.
- [ ] **Token cost tracking** -- Per-agent, per-model counters in SQLite. CLI `clawcode costs`. Foundation for all escalation features. New module alongside existing memory.
- [ ] **Knowledge graph links table** -- `memory_links` schema, wikilink parsing in memory content, backlink queries, link CRUD. Foundation for graph retrieval. Touches: `memory/store.ts`.

### Phase 2: Smart Loading (Build Second)

- [ ] **On-demand memory retrieval** -- Replace eager hot-tier context stuffing with tool-based retrieval. Agent searches memory when needed. Hot tier shrinks to identity + active task only. Touches: `context-summary.ts`, `tier-manager.ts`.
- [ ] **Personality efficient loading** -- Compressed identity fingerprint (~200-300 tokens) for system prompt. Full SOUL.md as retrievable memory. Touches: session resume flow.
- [ ] **Graph-aware retrieval** -- 1-hop neighbor expansion on KNN search results. Touches: `search.ts`.

### Phase 3: Model Intelligence (Build Third)

- [ ] **Model escalation mechanism** -- Self-assessment output field on agent responses, escalation trigger logic, advisor tool definition. Touches: agent lifecycle, SDK integration.
- [ ] **Advisor tool integration** -- Opus advisor callable from haiku/sonnet agents via Claude API advisor tool. Touches: tool definitions, agent config.
- [ ] **Escalation budget controls** -- Per-agent token budgets, budget monitoring heartbeat check, Discord alerts. Touches: config schema, heartbeat.

### Phase 4: Polish (Build Last)

- [ ] **Context assembly pipeline** -- Modular context builder composing identity + memories + graph + task with per-source token budgets.
- [ ] **Semantic link discovery** -- Background croner job for auto-suggesting memory links based on embedding similarity.
- [ ] **Memory importance auto-scoring** -- Heuristic-based importance on memory creation. Enhancement to existing flow.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Phase |
|---------|------------|---------------------|----------|-------|
| Haiku default model | HIGH | LOW | P1 | 1 |
| Token cost tracking | HIGH | MEDIUM | P1 | 1 |
| Knowledge graph links | HIGH | MEDIUM | P1 | 1 |
| On-demand memory retrieval | HIGH | MEDIUM | P1 | 2 |
| Personality efficient loading | MEDIUM | MEDIUM | P2 | 2 |
| Graph-aware retrieval | MEDIUM | MEDIUM | P2 | 2 |
| Model escalation mechanism | HIGH | HIGH | P1 | 3 |
| Advisor tool integration | HIGH | HIGH | P2 | 3 |
| Escalation budget controls | MEDIUM | MEDIUM | P2 | 3 |
| Context assembly pipeline | MEDIUM | HIGH | P3 | 4 |
| Semantic link discovery | LOW | MEDIUM | P3 | 4 |
| Memory importance auto-scoring | LOW | LOW | P3 | 4 |

## Competitor/Prior Art Analysis

| Feature | Obsidian | Mem0 | GAM (Research) | Anthropic Advisor | ClawCode Approach |
|---------|----------|------|----------------|-------------------|-------------------|
| Knowledge links | `[[wikilinks]]`, backlinks, graph view, unlinked mentions | Entity graph extraction via LLM | Full lossless record, no explicit graph | N/A | Wikilinks in memory content + SQLite link table. Simpler than entity extraction, more explicit than pure semantic. Add semantic suggestions as enhancement. |
| On-demand loading | Manual (user navigates) | Automatic relevance scoring, 26% accuracy boost, 90% token savings | JIT memory pipeline, task-specific assembly | N/A | Tool-based retrieval. Agent explicitly searches. Hot tier shrinks to identity + active task. Hybrid: minimal pre-load + on-demand expansion. |
| Model tiering | N/A | N/A | N/A | Advisor tool: executor (haiku/sonnet) + advisor (opus). 2.7pp SWE-bench gain, 11.9% cost reduction. | Adopt advisor pattern directly. Haiku default, opus advisor tool. Per-agent override to sonnet baseline where needed. |
| Identity/personality | N/A | User preferences as memory | N/A | N/A | Compressed fingerprint in system prompt (~200-300 tokens). Full SOUL.md as retrievable memory. Personality = immutable config, preferences = mutable memory. |
| Cost tracking | N/A | API usage dashboard | N/A | Token counting in API responses | Per-agent SQLite counters. Per-model breakdown. CLI + dashboard reporting. Budget alerts via Discord heartbeat. |
| Context assembly | N/A | Dynamic extraction + consolidation | JIT task-specific assembly | N/A | Modular pipeline with per-source token budgets. Identity -> task -> memories -> graph. Budget-aware composition. |

## Integration Points with Existing System

| Existing Component | How v1.5 Features Connect | Risk Level |
|-------------------|--------------------------|------------|
| `memory/store.ts` | New `memory_links` table, link CRUD methods. Additive schema change. | LOW -- new table, no existing table changes |
| `memory/search.ts` | Graph-aware expansion after KNN results. Wraps existing search with link traversal. | LOW -- extends, doesn't modify |
| `memory/tier-manager.ts` | On-demand retrieval changes how hot tier feeds context. Hot tier shrinks but still exists. | MEDIUM -- behavioral change to existing flow |
| `memory/context-summary.ts` | Refactored to use context assembly pipeline. Most impacted existing file. | HIGH -- significant refactor of resume behavior |
| `memory/schema.ts` | New config sections: `knowledgeGraph`, `modelTiering`, `costTracking` | LOW -- additive schema additions |
| `memory/consolidation.ts` | Consolidation digests gain wikilinks to source memories. Minor enhancement. | LOW -- additive |
| `memory/embedder.ts` | Reused as-is for semantic link discovery. No changes needed. | NONE |
| `config/schema.ts` | Default model change haiku. New escalation config fields. | LOW -- default change + additive fields |
| `agent-manager.ts` | Token tracking hooks, escalation lifecycle. Needs callback/event system for token counting. | MEDIUM -- new capability wired into existing lifecycle |
| `heartbeat/` | New checks: escalation budget monitoring, cost alerting. Uses existing extensible check framework. | LOW -- new checks, framework already supports this |

## Sources

- [Anthropic Advisor Tool Launch](https://gadgetbond.com/anthropic-claude-opus-sonnet-haiku-advisor-tool/) -- Official advisor pattern, March 2026. MEDIUM confidence (third-party reporting on official feature).
- [Anthropic Advisor Strategy Guide (MindStudio)](https://www.mindstudio.ai/blog/anthropic-advisor-strategy-cut-ai-agent-costs) -- Sonnet + Opus advisor: 2.7pp SWE-bench gain, 11.9% cost reduction. MEDIUM confidence.
- [Tiered Model Routing (FreeCodeCamp)](https://www.freecodecamp.org/news/how-to-build-a-cost-efficient-ai-agent-with-tiered-model-routing) -- Cost curve implementation: deterministic -> haiku -> sonnet. HIGH confidence (tutorial with code).
- [GAM Dual-Agent Memory (VentureBeat)](https://venturebeat.com/ai/gam-takes-aim-at-context-rot-a-dual-agent-memory-architecture-that) -- JIT memory pipeline, context rot problem. MEDIUM confidence.
- [Mem0 Research (arXiv 2504.19413)](https://arxiv.org/abs/2504.19413) -- 26% accuracy boost, 91% lower latency, 90% token savings. HIGH confidence (peer-reviewed).
- [Memory in the Age of AI Agents (arXiv 2512.13564)](https://arxiv.org/abs/2512.13564) -- Taxonomy: factual, experiential, working memory. HIGH confidence.
- [Context Engineering Guide (Mem0)](https://mem0.ai/blog/context-engineering-ai-agents-guide) -- Modular context assembly, selective loading patterns. MEDIUM confidence.
- [Obsidian Internal Links (DeepWiki)](https://deepwiki.com/obsidianmd/obsidian-help/4.2-internal-links-and-graph-view) -- Wikilink format, metadata cache, backlink resolution. HIGH confidence.
- [Karpathy LLM Wiki Pattern](https://a2a-mcp.org/blog/andrej-karpathy-llm-knowledge-bases-obsidian-wiki) -- LLM-compiled wiki with indexes, ~400K word scale. MEDIUM confidence.
- [Claude Haiku 4.5 Multi-Agent (Caylent)](https://caylent.com/blog/claude-haiku-4-5-deep-dive-cost-capabilities-and-the-multi-agent-opportunity) -- Haiku for 70-80% of agent tasks. MEDIUM confidence.
- [Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) -- Official model specs and pricing. HIGH confidence.
- [xMemory Token Reduction (VentureBeat)](https://venturebeat.com/orchestration/how-xmemory-cuts-token-costs-and-context-bloat-in-ai-agents) -- Context bloat reduction. MEDIUM confidence.
- [AI Agent Cost Optimization (Zylos)](https://zylos.ai/research/2026-02-19-ai-agent-cost-optimization-token-economics) -- Per-agent token tagging, budget allocation. MEDIUM confidence.
- [AI Agent Cost Tracking (Microsoft)](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/tracking-every-token-granular-cost-and-usage-metrics-for-microsoft-foundry-agent/4503143) -- Granular token telemetry patterns. HIGH confidence.

---
*Feature research for: ClawCode v1.5 Smart Memory & Model Tiering*
*Researched: 2026-04-10*
