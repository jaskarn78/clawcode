# Project Research Summary

**Project:** ClawCode v1.5 — Smart Memory & Model Tiering
**Domain:** Multi-agent AI orchestration — knowledge graph memory, on-demand context loading, model cost tiering
**Researched:** 2026-04-10
**Confidence:** HIGH

## Executive Summary

ClawCode v1.5 adds three interlocking capabilities to an already-functioning multi-agent system: a knowledge graph layer over the flat memory store, on-demand memory retrieval to replace eager context injection, and model cost tiering with haiku as the default. All three features are implementable with zero new dependencies — the existing stack (better-sqlite3, sqlite-vec, @huggingface/transformers, Claude Agent SDK) covers every requirement. The recommended approach leans on SQLite adjacency list tables for the graph (no graphology, no graph database), session-level model switching for tiering (the advisor tool is not yet available through the Agent SDK), and a hybrid hot-tier + on-demand retrieval pattern that keeps the existing working memory system intact while layering graph-augmented search on top.

The fundamental risk in v1.5 is that every new feature is designed to reduce context bloat, but if built naively, each one individually adds overhead that compounds. Graph traversal can fan out and consume more tokens than the hot-tier it replaces. Tiering instructions add 300-500 fixed tokens per turn. Personality compression requires careful extraction or agents lose character. The mitigation is strict token budget accounting from day one: assign explicit budgets (identity 500 tokens, hot memory 2,000 tokens, graph expansion 1,500 tokens, tooling 500 tokens) and measure system prompt size before and after each phase. v1.5 must produce a smaller net system prompt than v1.4, not a larger one.

The build order is non-negotiable due to hard dependencies: knowledge graph schema first (graph traversal code and referential integrity hooks must exist before consolidation or archival is modified), then on-demand loading (requires graph for 1-hop expansion), then model tiering (benefits from compact prompts produced by Phase 2, and haiku viability depends on the reduced context from Phase 2). A pre-Phase 3 haiku compatibility audit — running the full test suite against haiku before switching agents — is mandatory to identify which operations need simplified prompts or automatic escalation.

## Key Findings

### Recommended Stack

v1.5 requires zero new npm packages. The three features map cleanly onto existing dependencies with new SQLite schema additions. The Agent SDK's `Query.setModel()` for mid-session model switching turned out to be the wrong primitive — session-level model creation (new session with context summary injection) is the correct approach because the SDK does not support changing models on an active session.

**Core technologies (new additions only — no new packages):**
- SQLite adjacency list tables (`memory_links`): knowledge graph storage — simple JOINs handle all traversal patterns needed (backlinks, forward links, 2-hop BFS). graphology rejected as overengineering for ~100-500 nodes per agent.
- SQLite FTS5 (built-in to better-sqlite3): keyword search over note content — complements vector similarity for exact-match queries.
- Session-level model routing (`ModelTierRouter`): haiku default with new-session escalation to sonnet/opus — NOT mid-session setModel() which is unsupported by the SDK.
- Extended `UsageTracker` tables (`model_decisions`, `cost_budgets`): per-agent, per-model spend tracking and budget enforcement.

**Critical version note:** Pin `@anthropic-ai/claude-agent-sdk` at exact version (pre-1.0). The advisor tool type (`advisor_20260301`) is a Messages API beta feature not yet available through the Agent SDK — design around session-level switching, not the advisor tool.

### Expected Features

**Must have (table stakes for v1.5):**
- On-demand memory retrieval via `memory_search` MCP tool — replaces eager hot-tier context injection (Mem0 research: 90% token savings, 26% accuracy boost)
- Knowledge graph links (`memory_links` table + auto-link on insert + backlink resolution) — structural relationships between memories
- Haiku as default model — single config schema change, 3x cheaper than sonnet on both input and output
- Model escalation mechanism — `ModelTierRouter` with keyword/error-rate/complexity triggers, creates new sessions at escalated model
- Personality efficient loading — compact identity fingerprint (~200-300 tokens) in system prompt, full SOUL.md as retrievable memory
- Token cost tracking — per-agent, per-model counters, CLI reporting, budget enforcement

**Should have (differentiators):**
- Graph-aware retrieval — 1-hop neighbor expansion after KNN search (configurable, default enabled)
- Advisor tool integration — DEFER until SDK exposes the advisor tool type natively
- Escalation budget controls — per-agent daily/weekly token budgets with Discord alerts at 80%
- Context assembly pipeline — modular composer with per-source token budgets

**Defer to v2+:**
- Full graph visualization UI (DOT format CLI output is sufficient for agents)
- Shared knowledge graph across agents (violates workspace isolation)
- Automatic personality evolution / SOUL.md self-modification (identity drift is a feature-killing bug)
- Complex escalation chains beyond two-tier (haiku default + opus advisor)
- LLM-powered entity extraction on every memory write (doubles token cost per write)

### Architecture Approach

v1.5 adds three new components alongside existing modules without replacing them. The hot tier is NOT removed — it stays as a baseline working memory; on-demand loading layers on top as supplemental graph-augmented search. The existing `buildSessionConfig()` is modified to support compact mode but remains backward-compatible.

**Major new components:**
1. `KnowledgeGraph` (`src/memory/knowledge-graph.ts`) — edge CRUD, BFS traversal with visited-set tracking, auto-link on insert (fire-and-forget, non-blocking), orphan detection
2. `ContextAssembler` (`src/memory/context-assembler.ts`) — compact personality extraction, token-budgeted context composition, backward-compatible `full` mode
3. `ModelTierRouter` (`src/manager/model-tier.ts`) — escalation state machine (base → escalated → cooldown → base), trigger evaluation, new session creation for escalated models
4. `MemorySearchTool` (`src/mcp/tools/memory-search.ts`) — MCP tool exposing graph-augmented search to agents

**Modified existing components:**
- `MemoryStore`: add `memory_links` table migration + link CRUD
- `buildSessionConfig()`: support compact personality mode, remove hot memory injection when on-demand enabled
- `consolidation.ts`: create `derived` links from source memories to digest
- `dedup.ts`: create `supersedes` links on merge + merge edges from both sources
- `UsageTracker`: add `model_decisions` and `cost_budgets` tables, savings calculation

### Critical Pitfalls

1. **Context explosion from graph traversal** — hub nodes fan out exponentially via backlinks, producing more tokens than the hot-tier they replace. Mitigation: token budget cap (not depth limit), relevance-gated traversal at each hop (cosine distance threshold), fan-out cap of 5-8 edges per node, BFS not DFS. Instrument token counting from day one.

2. **Escalation spiral (agents permanently on opus)** — opus responses increase context complexity, making haiku struggle on subsequent turns, triggering further escalation. Mitigation: mandatory de-escalation after N turns, scoped escalation (fork context → run task → return result only), per-agent hourly cost caps with hard enforcement, escalation cooldown (min 5 turns before re-escalating).

3. **Broken graph edges after consolidation/archival** — consolidation deletes source memories; graph edges become dangling references. Mitigation: pre-consolidation hook to redirect edges to the new digest node in the same transaction; soft-delete for archival (keep stub node with ID and pointer); ON DELETE CASCADE on edge table.

4. **On-demand loading defeats the hot tier** — reactive pull model means agents confabulate rather than querying. Pure on-demand is not viable. Mitigation: hybrid — hot tier stays as working memory baseline (identity + active task), on-demand is supplement for deeper recall. Core identity is never on-demand.

5. **v1.5 system prompt larger than v1.4** — each feature adds instructional overhead (tiering instructions, tool definitions, graph usage guidance). Mitigation: token budget accounting as design constraint before writing code; tiering decisions belong in the orchestrator not the agent prompt; merge instruction blocks; measure v1.4 vs v1.5 prompt size — v1.5 must be equal or smaller.

6. **Haiku can't execute existing agent capabilities** — all prompts and tool chains were designed for sonnet. Mitigation: mandatory haiku compatibility audit (full test suite against haiku) before Phase 3 implementation. Gradual rollout: 2-3 low-complexity agents first.

7. **Circular graph references cause infinite traversal** — similarity-based edge creation produces symmetric cycles. Mitigation: visited-set tracking is mandatory in the first traversal implementation (not a retrofit). Edge creation threshold must be stricter than dedup threshold.

## Implications for Roadmap

Research is unanimous on phase ordering — FEATURES.md, ARCHITECTURE.md, and PITFALLS.md independently arrive at the same 4-phase structure. The ordering is driven by hard dependencies.

### Phase 1: Knowledge Graph Foundation

**Rationale:** Everything else depends on this. Graph-aware retrieval (Phase 2) needs the graph to traverse. Referential integrity hooks for consolidation and archival must exist before any subsequent feature modifies memory lifecycle. Token budget design is a constraint that must be established here.

**Delivers:** `memory_links` schema + migration, `KnowledgeGraph` class (link CRUD, BFS traversal with visited-set, fan-out cap, token-budgeted traversal), auto-link on insert, consolidation `derived` links, archival edge cleanup hooks, orphan detection.

**Addresses features:** Knowledge graph links (table stakes), graph-aware retrieval groundwork.

**Avoids pitfalls:** Context explosion (token budget + relevance gating designed here), stale graph edges (referential integrity hooks), circular traversal (visited-set tracking), links-in-content anti-pattern (separate edge table enforced from day one).

### Phase 2: On-Demand Memory Loading

**Rationale:** Depends on Phase 1 for graph expansion. Reduces context bloat before the haiku switch — haiku performs better with compact prompts. Personality efficient loading belongs here because it is part of the context assembly problem, not the model selection problem.

**Delivers:** `ContextAssembler` with compact personality mode, `memory_search` MCP tool (graph-augmented search), modified `buildSessionConfig()` for compact mode, config schema additions (`personalityMode`, `onDemandSearch`), hybrid hot-tier + on-demand design.

**Addresses features:** On-demand memory retrieval (table stakes), personality efficient loading (table stakes), graph-aware retrieval (differentiator).

**Avoids pitfalls:** On-demand defeating hot tier (hybrid approach), personality tokens competing with memory tokens (compact fingerprint + token budget accounting).

### Phase 3: Model Tiering

**Rationale:** Requires compact prompts from Phase 2 to make haiku viable. Requires a pre-phase haiku compatibility audit as a mandatory spike before implementation begins.

**Delivers:** Haiku as default model (config change), `ModelTierRouter` (escalation state machine, session creation for escalated models, de-escalation and cooldown), escalation triggers (keyword, error-rate, complexity, explicit command), extended `UsageTracker` (model breakdowns, budget enforcement, savings calculation), per-agent cost budgets with Discord alerts, CLI `clawcode costs [agent]`.

**Addresses features:** Haiku default (table stakes), model escalation mechanism (table stakes), token cost tracking (table stakes), escalation budget controls (differentiator).

**Avoids pitfalls:** Escalation spiral (mandatory de-escalation, scoped escalation, cost caps), haiku capability gap (pre-phase audit), escalation logic in prompt (orchestrator owns escalation decisions).

### Phase 4: Integration and Cost Optimization

**Rationale:** Wire all three features together, add monitoring, validate net prompt size is smaller than v1.4.

**Delivers:** Context assembly pipeline (modular composer with per-source token budgets), semantic link discovery (background croner job), memory importance auto-scoring (heuristic-based), dashboard cost savings visualization, CLI `clawcode memory graph <agent>` (DOT format), heartbeat checks for escalation budget monitoring.

**Addresses features:** Context assembly pipeline (differentiator), semantic link discovery (differentiator), memory importance auto-scoring (differentiator).

**Avoids pitfalls:** System prompt net growth (final measurement gate — must verify v1.5 prompt is smaller than v1.4).

### Phase Ordering Rationale

- Graph schema before on-demand loading because graph-augmented search is a core capability of the memory_search tool
- On-demand loading before model tiering because compact prompts directly improve haiku viability
- Haiku compatibility audit sits at the Phase 2/Phase 3 boundary — treat it as a gate, not a Phase 3 task
- Referential integrity (edge cleanup in consolidation/archival) must be Phase 1, not a later "nice to have"
- Integration last because it composes all three features and requires them running to validate

### Research Flags

Phases needing deeper research during planning:
- **Phase 3 (pre-implementation spike):** Haiku compatibility audit — empirical measurement against the actual codebase, cannot be substituted with upfront research.
- **Phase 3:** Context summary injection design for escalated sessions — no established pattern in the codebase, needs prototyping.

Phases with standard patterns (skip research-phase):
- **Phase 1:** SQLite adjacency list pattern is well-documented; BFS with visited sets is standard graph algorithms.
- **Phase 2:** MCP tool registration follows existing patterns in `src/mcp/server.ts`.
- **Phase 4:** Semantic link discovery reuses existing sqlite-vec KNN and croner scheduling already in use.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies — all features verified against existing packages. Agent SDK advisor tool gap is a known constraint, not a research gap. SQLite FTS5 and recursive CTEs verified as built into better-sqlite3. |
| Features | MEDIUM-HIGH | Table stakes features are clear and consensus across research. Advisor tool (differentiator) deferred due to SDK constraint. Haiku benchmark data (70-80% of tasks) is from Anthropic third-party reports, MEDIUM confidence. |
| Architecture | HIGH | Existing codebase well-understood. Integration points identified precisely (file names, line references). Advisor tool anti-pattern (mid-session setModel not in SDK) confirmed. Session-level escalation is the correct approach. |
| Pitfalls | HIGH | 8 critical pitfalls identified with specific prevention steps, verification checklists, and phase-to-pitfall mapping. Most derive from codebase analysis + domain research cross-validation. |

**Overall confidence:** HIGH

### Gaps to Address

- **Haiku empirical viability**: Research says haiku handles 70-80% of agent tasks, but ClawCode agents run complex multi-step tool sequences, memory consolidation LLM calls, and identity-sensitive conversations. The actual haiku viability percentage for this specific workload is unknown until the compatibility audit. Plan for the audit to reveal that consolidation and memory extraction prompts need haiku-specific rewrites.

- **Advisor tool SDK timeline**: The Anthropic advisor tool (`advisor_20260301`) is a Messages API beta feature not exposed through the Claude Agent SDK. No public timeline for availability. The architecture correctly designs around this constraint, but the escalation architecture should include a clear extension point for when the advisor tool becomes available.

- **Context summary injection for escalated sessions**: When creating an escalated session, the system must inject a context summary of the current conversation. Quality of this summary determines whether escalated sessions operate effectively. Non-trivial design problem with no established pattern in the codebase — needs prototyping in Phase 3.

- **Edge auto-link threshold calibration**: The similarity threshold for auto-creating graph edges (proposed cosine distance < 0.15) has not been validated against the actual memory corpus. Too strict = sparse graph. Too loose = dense cycles and noisy traversal. Needs empirical calibration against real agent memory stores in Phase 1.

## Sources

### Primary (HIGH confidence)
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — Query interface, session management, model options
- [Claude API Pricing](https://platform.claude.com/docs/en/about-claude/pricing) — haiku $1/$5, sonnet $3/$15, opus $5/$25 per MTok (April 2026)
- [Mem0 Research (arXiv 2504.19413)](https://arxiv.org/abs/2504.19413) — 26% accuracy boost, 91% lower latency, 90% token savings with selective retrieval
- [Memory in the Age of AI Agents (arXiv 2512.13564)](https://arxiv.org/abs/2512.13564) — memory taxonomy for agent systems
- [SQLite FTS5 Documentation](https://www.sqlite.org/fts5.html) — full-text search built into better-sqlite3
- [AI Agent Cost Tracking (Microsoft)](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/tracking-every-token-granular-cost-and-usage-metrics-for-microsoft-foundry-agent/4503143) — per-agent token telemetry patterns
- [Tiered Model Routing (FreeCodeCamp)](https://www.freecodecamp.org/news/how-to-build-a-cost-efficient-ai-agent-with-tiered-model-routing) — complexity classification implementation
- ClawCode codebase: `src/memory/`, `src/manager/session-config.ts`, `src/manager/session-adapter.ts`, `src/usage/tracker.ts`

### Secondary (MEDIUM confidence)
- [Anthropic Advisor Strategy (MindStudio)](https://www.mindstudio.ai/blog/anthropic-advisor-strategy-cut-ai-agent-costs) — Sonnet + Opus advisor: 2.7pp SWE-bench gain, 11.9% cost reduction
- [Claude Haiku 4.5 Multi-Agent (Caylent)](https://caylent.com/blog/claude-haiku-4-5-deep-dive-cost-capabilities-and-the-multi-agent-opportunity) — Haiku handles 70-80% of agent tasks
- [GAM Dual-Agent Memory (VentureBeat)](https://venturebeat.com/ai/gam-takes-aim-at-context-rot-a-dual-agent-memory-architecture-that) — JIT memory pipeline architecture
- [Context Engineering Guide (Mem0)](https://mem0.ai/blog/context-engineering-ai-agents-guide) — modular context assembly patterns
- [Obsidian Internal Links (DeepWiki)](https://deepwiki.com/obsidianmd/obsidian-help/4.2-internal-links-and-graph-view) — wikilink format, backlink resolution patterns
- [Knowledge Graph for Obsidian (GitHub)](https://github.com/obra/knowledge-graph) — SQLite + sqlite-vec graph implementation reference
- [Zep Temporal Knowledge Graph (arXiv 2501.13956)](https://arxiv.org/abs/2501.13956) — fact invalidation, temporal edges in agent memory
- [Building AI Agents with Knowledge Graph Memory](https://medium.com/@saeedhajebi/building-ai-agents-with-knowledge-graph-memory-a-comprehensive-guide-to-graphiti-3b77e6084dec) — edge management patterns

### Tertiary (LOW confidence — needs validation)
- [Anthropic Advisor Tool Launch](https://gadgetbond.com/anthropic-claude-opus-sonnet-haiku-advisor-tool/) — advisor tool beta details (third-party reporting on official feature)
- [Karpathy LLM Wiki Pattern](https://a2a-mcp.org/blog/andrej-karpathy-llm-knowledge-bases-obsidian-wiki) — LLM-compiled wiki with indexes

---
*Research completed: 2026-04-10*
*Ready for roadmap: yes*
