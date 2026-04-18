# Requirements — v1.9 Persistent Conversation Memory

**Status:** Active
**Started:** 2026-04-18
**Phases:** TBD — roadmap pending

## Milestone Goal

Agents remember what happened in prior sessions. Discord conversations are stored, summarized into retrievable facts, and automatically injected on restart so agents never wake up to a blank slate.

Build on the v1.0-v1.8 substrate (MemoryStore, sqlite-vec, embeddings, consolidation, decay, context assembly pipeline, TurnDispatcher, SessionManager, DiscordBridge). Zero new npm dependencies.

## v1.9 Requirements

### Conversation Persistence (CONV)

- [ ] **CONV-01**: Every Discord message exchange (user message + agent response) is stored as a structured turn pair in per-agent SQLite with timestamps, channel_id, and discord_user_id provenance
- [ ] **CONV-02**: Session boundaries (start, end, crash) are tracked as explicit lifecycle records with session_id grouping turns into coherent conversations
- [ ] **CONV-03**: Extracted memories carry source_turn_ids linking them back to the conversation turns they came from (lineage tracking for dual-write integrity)

### Session Intelligence (SESS)

- [ ] **SESS-01**: On session end or restart, raw conversation turns are compressed into a structured summary (preferences, decisions, open threads, commitments) via haiku LLM call from the daemon
- [ ] **SESS-02**: On agent resume, a structured context brief from the last N recent session summaries is automatically injected into the agent's prompt via a dedicated conversation_context budget section (2000-3000 tokens)
- [ ] **SESS-03**: Auto-injection is skipped when the session gap is short (< 4 hours configurable) to avoid redundant context when the agent was only briefly restarted
- [ ] **SESS-04**: Session summaries are stored as standard MemoryEntry objects (source="conversation") so they automatically participate in semantic search, relevance decay, tier management, and knowledge graph auto-linking

### Deep Retrieval (RETR)

- [ ] **RETR-01**: Agent can search conversation history on demand via an enhanced memory_lookup MCP tool with a scope parameter (backward-compatible with existing callers)
- [ ] **RETR-02**: Raw conversation turn text is searchable via FTS5 full-text search for precise keyword recall when semantic search is insufficient
- [ ] **RETR-03**: Search results are paginated (max 10 per page) and time-decay-weighted so recent conversations rank higher than old ones

### Security (SEC)

- [ ] **SEC-01**: Every stored conversation turn includes provenance fields (discord_user_id, channel_id, is_trusted_channel) to prevent memory poisoning from untrusted sources
- [ ] **SEC-02**: Instruction-pattern detection runs on turn content before storage to flag potential injection attempts in persisted conversation data

## Future Requirements

### Fact Extraction (v1.9.x)

- **FACT-01**: Structured fact extraction from conversation turns at session boundaries, feeding the knowledge graph
- **FACT-02**: User preference tracking with elevated importance and long decay half-life

### Advanced Features (v2+)

- **ADV-01**: Conversation topic threading — group related turns across sessions by topic
- **ADV-02**: Proactive context surfacing — agent preemptively retrieves relevant conversation history mid-turn
- **ADV-03**: Cross-agent conversation handoff context — when Agent A delegates to Agent B, relevant conversation context transfers

## Out of Scope

| Feature | Reason |
|---------|--------|
| Per-turn embedding | Storage bloat (~1.5KB/embedding * 14 agents * 100s of daily turns); embed session summaries only |
| Shared conversation memory across agents | Violates workspace isolation; per-agent memory is a core architectural principle |
| Real-time conversation streaming to external systems | Adds complexity with no clear user value for v1.9 |
| Voice/audio conversation persistence | Discord plugin handles text only |
| Conversation topic threading | HIGH complexity; session summaries provide sufficient grouping for v1.9 |

## Traceability

| Requirement | Description | Phase | Status |
|-------------|-------------|-------|--------|
| CONV-01 | Turn storage with provenance | TBD | [ ] |
| CONV-02 | Session boundary tracking | TBD | [ ] |
| CONV-03 | Memory lineage tracking | TBD | [ ] |
| SESS-01 | Session-end summarization | TBD | [ ] |
| SESS-02 | Auto-inject on resume | TBD | [ ] |
| SESS-03 | Adaptive injection threshold | TBD | [ ] |
| SESS-04 | Summaries as MemoryEntries | TBD | [ ] |
| RETR-01 | Conversation search MCP tool | TBD | [ ] |
| RETR-02 | FTS5 full-text search | TBD | [ ] |
| RETR-03 | Paginated decay-weighted results | TBD | [ ] |
| SEC-01 | Provenance fields on stored turns | TBD | [ ] |
| SEC-02 | Instruction-pattern detection | TBD | [ ] |

**Coverage:**
- v1.9 requirements: 12 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 12

### Phase Coverage

| Phase | Requirements | Count |
|-------|-------------|-------|
| TBD | All | 12 |

---
*Requirements defined: 2026-04-18*
*Last updated: 2026-04-18 after milestone v1.9 start*
