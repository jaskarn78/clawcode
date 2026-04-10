# Requirements: ClawCode v1.5 — Smart Memory & Model Tiering

**Milestone:** v1.5
**Created:** 2026-04-10
**Status:** Active

## v1.5 Requirements

### Knowledge Graph (GRAPH)

- [x] **GRAPH-01**: Agent memories support `[[wikilink]]` syntax that creates explicit links between memory entries
- [x] **GRAPH-02**: Agent can query backlinks for any memory entry (what links to this?)
- [x] **GRAPH-03**: Memory search results include 1-hop graph neighbors for richer context retrieval
- [x] **GRAPH-04**: Background job auto-discovers and suggests links between semantically similar unlinked memories

### On-Demand Loading (LOAD)

- [x] **LOAD-01**: Agent retrieves memories via a `memory_lookup` tool call instead of eager hot-tier context stuffing
- [x] **LOAD-02**: Agent identity is loaded as a compressed personality fingerprint (~200-300 tokens) with full SOUL.md available as retrievable memory
- [ ] **LOAD-03**: Context assembly pipeline composes identity, memories, graph results, and tools with per-source token budgets

### Model Tiering (TIER)

- [x] **TIER-01**: Default agent model is haiku instead of sonnet
- [x] **TIER-02**: Agent can escalate to a more capable model (sonnet/opus) when task complexity exceeds haiku's capability
- [x] **TIER-03**: Agent can call opus as an advisor tool for hard decisions without switching sessions
- [ ] **TIER-04**: Per-agent escalation budgets enforce daily/weekly token limits for upgraded models with Discord alerts
- [x] **TIER-05**: Discord slash command allows operator to set/change default model for an agent

### Cost Optimization (COST)

- [ ] **COST-01**: Per-agent, per-model token usage is tracked in SQLite and viewable via CLI and dashboard
- [ ] **COST-02**: New memories receive automatic importance scoring based on content heuristics

## Future Requirements

(Deferred from v1.5 scoping — none)

## Out of Scope

- Full graph visualization UI — use CLI DOT output + Graphviz instead
- Real-time model switching mid-turn — not possible with Claude Code sessions
- Shared knowledge graph across agents — violates workspace isolation
- Automatic personality evolution — identity drift is a feature-killing bug
- Vector re-embedding on model upgrade — current 384-dim is sufficient
- Complex escalation chains (haiku->sonnet->opus->sonnet) — two-tier only (haiku + advisor)
- LLM-powered entity/relation extraction — doubles token cost on writes

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| GRAPH-01 | Phase 36 | Complete |
| GRAPH-02 | Phase 36 | Complete |
| GRAPH-03 | Phase 38 | Complete |
| GRAPH-04 | Phase 38 | Complete |
| LOAD-01 | Phase 37 | Complete |
| LOAD-02 | Phase 37 | Complete |
| LOAD-03 | Phase 41 | Pending |
| TIER-01 | Phase 39 | Complete |
| TIER-02 | Phase 39 | Complete |
| TIER-03 | Phase 39 | Complete |
| TIER-04 | Phase 40 | Pending |
| TIER-05 | Phase 39 | Complete |
| COST-01 | Phase 40 | Pending |
| COST-02 | Phase 40 | Pending |

---
*14 requirements | 4 categories | Created 2026-04-10*
