# Pitfalls Research

**Domain:** Persistent Conversation Memory added to an existing multi-agent system (ClawCode v1.9)
**Researched:** 2026-04-17
**Confidence:** HIGH (codebase analysis of existing memory subsystem + industry research + production post-mortems)

## Context

ClawCode v1.0-v1.8 already has a sophisticated memory subsystem: per-agent SQLite stores with sqlite-vec KNN search, tiered storage (hot/warm/cold), memory consolidation (daily->weekly->monthly digests), relevance decay, deduplication, knowledge graph with auto-linking, importance scoring, context assembly pipeline with per-section token budgets, and episode-based memory. Session logs exist as daily markdown files with compaction-triggered fact extraction.

v1.9 adds **persistent conversation memory**: every Discord message exchange is stored in per-agent SQLite, sessions are summarized at boundaries, context briefs are injected on resume, and agents can deep-search older conversation history. The pitfalls below are specific to the interaction of this new conversation persistence layer with the *existing* memory infrastructure. Generic agent memory warnings are out of scope.

---

## Critical Pitfalls

### Pitfall 1: Dual-Write Divergence Between Conversation Store and Memory Store

**What goes wrong:**
v1.9 conversation turns must be persisted in a new `conversation_turns` table (or similar), while extracted facts continue to go into the existing `memories` table via compaction. Two parallel persistence paths for the same conversation data creates a divergence risk: the raw turns say one thing, the extracted memories say another, and the consolidation digests say a third. Agents get contradictory context depending on which retrieval path fires.

**Why it happens:**
The existing system already has a dual-persistence pattern: `SessionLogger` writes daily markdown files AND `CompactionManager` extracts facts into `memories` AND `consolidation.ts` summarizes daily logs into weekly/monthly digests. v1.9 adds a *third* representation of the same data (raw conversation turns in SQLite). Each representation is authored at a different time by a different process with different fidelity. When the fact extractor misinterprets a conversation, the memory store has the wrong fact, but the conversation store has the right raw turns -- and the agent doesn't know which to trust.

**How to avoid:**
1. **Single source of truth hierarchy**: raw conversation turns are canonical. Extracted memories are derived. Digests are further derived. When retrieval surfaces a contradiction, the raw turn wins. Encode this in the retrieval ranking: conversation turns with exact timestamps get a trust bonus over extracted memories from the same time window.
2. **Lineage tracking**: every extracted memory must carry a `source_turn_id` (or range of turn IDs) back to the raw conversation it was derived from. When an agent retrieves a fact and doubts it, the MCP tool can fetch the original conversation context.
3. **Atomic extraction transactions**: fact extraction from a conversation batch and the corresponding session-boundary summary must happen in the same SQLite transaction (or at minimum the same process step). Never partially extract -- all facts from a session boundary or none.

**Warning signs:**
- Agent says "last time we discussed X" but the actual conversation was about Y
- Memory search returns a fact that contradicts what the conversation history tool returns for the same time period
- Consolidation digests contain claims not traceable to any conversation turn

**Phase to address:**
Phase 1 (conversation turn storage schema) must include `source_turn_id` foreign key on memories. Phase 2 (session-boundary summarization) must enforce the trust hierarchy.

---

### Pitfall 2: Context Window Budget Starvation from Conversation History Injection

**What goes wrong:**
The existing context assembly pipeline (`context-assembler.ts`) has tightly tuned per-section budgets: identity=1000, soul=2000, skills_header=1500, hot_tier=3000, recent_history=8000, per_turn_summary=500, resume_summary=1500 tokens. Adding conversation history injection ("here's what we discussed recently") competes directly with the `resume_summary` (1500 token) and `per_turn_summary` (500 token) budgets. Even moderate conversation summaries from 3-5 recent sessions easily exceed 1500 tokens, starving other sections or being hard-truncated to uselessness.

**Why it happens:**
The current `enforceSummaryBudget` in `context-summary.ts` hard-truncates at word boundaries when a summary exceeds its budget (after up to 2 regeneration attempts). A conversation history summary spanning multiple sessions contains more information-per-token than the compaction summary it was designed for. The budget was sized for "what was the agent doing when it was compacted" -- not "what happened across the last 5 Discord sessions." The hard-truncate fallback produces summaries that cut off mid-thought, losing the most recent (and most valuable) context.

**How to avoid:**
1. **Separate conversation context budget**: add a new `conversation_context` section to `MemoryAssemblyBudgets` (alongside the existing 7 sections). Do NOT try to share the `resume_summary` budget. Default to 2000-3000 tokens.
2. **Recency-weighted compression**: the conversation brief for the most recent session gets 60% of the budget, the session before that gets 25%, and older sessions share 15%. This prevents "equal treatment" compression that makes every session summary too shallow to be useful.
3. **Placement in mutable suffix**: conversation context belongs in the mutable suffix (changes every session), not the stable prefix (which is cached for prompt caching). This is consistent with how `resume_summary` and `per_turn_summary` already work.
4. **Budget ceiling audit**: use the existing `clawcode context-audit` CLI (Phase 53) to validate that the new section doesn't push total context assembly past the ceiling. The existing `exceedsCeiling` function defaults to 8000 tokens -- this is almost certainly too low once conversation context is added.

**Warning signs:**
- `resume-summary hard-truncated` warnings appearing in pino logs more frequently after v1.9 ships
- `context_assemble` span metadata showing `resume_summary` tokens consistently at budget cap
- Agents starting sessions with "I don't recall the details of our previous conversation"

**Phase to address:**
Phase 1 must add the new context section to the assembler schema. Phase 2 (session-boundary summarization) must honor the budget. Phase 3 (auto-inject on resume) must wire through the assembler correctly.

---

### Pitfall 3: Storage Bloat from Raw Conversation Turn Persistence

**What goes wrong:**
Every Discord message exchange becomes a row in a per-agent SQLite table. With 14 agents, each handling potentially dozens of messages per day, plus assistant responses that can be 2000+ characters each, the conversation tables grow unboundedly. After 30 days, a moderately active agent accumulates tens of thousands of turns. The sqlite-vec `vec_memories` table is already 384-dim float32 per row (1.5KB raw embedding per memory). If conversation turns also get embeddings for semantic search, storage doubles.

**Why it happens:**
The existing `session_logs` table is metadata only (id, date, file_path, entry_count). The actual session content lives in markdown files that get archived to `memoryDir/archive/YYYY/`. This is space-efficient because markdown compresses well and archives are rarely read. v1.9's conversation turns in SQLite don't benefit from this -- SQLite doesn't compress, and the turns need to be queryable (semantic search), so they can't simply be archived.

**How to avoid:**
1. **Don't embed every turn**: embed *session summaries* and *extracted facts*, not individual conversation turns. Individual turns are retrievable by timestamp range or session ID without vector search. Only use FTS5 (full-text search) for turn-level retrieval when the agent needs the exact conversation.
2. **Tiered conversation storage**: raw turns in SQLite for the last N days (30 default, configurable). Older turns archived to compressed markdown files (reuse the existing `archiveDailyLogs` pattern). Archived turns lose semantic search but remain available for explicit deep-search via the MCP tool.
3. **Truncate assistant responses on storage**: assistant responses often contain verbose reasoning. Store a truncated version (first 500 chars) in the conversation table, with the full response available in the daily session log markdown. The truncated version is enough for context injection; the full response is there for deep-search.
4. **Monitor database size**: add per-agent database size to the existing dashboard (Phase 47) and CLI status output. Alert when any agent's memory.db exceeds 100MB.

**Warning signs:**
- Agent SQLite databases growing by 5MB+ per week
- `vec_memories` table row count growing faster than `memories` table (indicates conversation turns are being embedded unnecessarily)
- Disk usage on `/opt/clawcode` trending up faster than agent count would explain

**Phase to address:**
Phase 1 (turn storage schema) must NOT include embeddings on raw turns. Phase 4 (on-demand deep search) adds FTS5 for turn-level text search. Phase 5 (maintenance) adds archival for old turns.

---

### Pitfall 4: Summarization Quality Collapse at Session Boundaries

**What goes wrong:**
Session-boundary summarization (compacting a full conversation into "key facts, decisions, and user preferences") is the highest-leverage and highest-risk operation in v1.9. A bad summary is worse than no summary -- it injects false context that the agent trusts implicitly. The existing `buildWeeklySummarizationPrompt` asks for structured extraction (Key Facts, Decisions Made, Topics Discussed, Important Context). Applying the same prompt template to a single session's conversation turns produces a different failure mode: sessions are shorter but denser, and the summarizer over-extracts trivial details or under-extracts critical decisions because it has no signal about what matters to the *user*.

**Why it happens:**
Weekly/monthly consolidation operates on already-summarized content (daily logs). Session-boundary summarization operates on raw turns -- including the user's casual tone, false starts, corrections, and tangential remarks. The summarizer can't distinguish between "the user mentioned they want dark mode" (important preference) and "the user said 'ugh, let me rethink that'" (noise). Without explicit importance signals, the LLM will either treat everything as important (bloated summary) or compress too aggressively (lost preferences).

**How to avoid:**
1. **Two-stage extraction**: first pass extracts candidate facts with importance scores. Second pass filters to the top N facts that fit within the token budget. The two-stage approach lets the agent generate more candidates than it keeps, improving precision.
2. **Structured extraction prompt with categories**: don't ask for a narrative summary. Ask for: (a) User preferences stated or implied, (b) Decisions made, (c) Open questions or unresolved topics, (d) Commitments made by the agent. Each category has a max count (e.g., 5 preferences, 3 decisions). This prevents the common failure of "the summary is a paragraph that sounds nice but contains no retrievable facts."
3. **Use the existing importance scoring**: feed extracted facts through `calculateImportance` before storage. Facts with importance < 0.3 should be discarded, not stored at low importance (they'll just clog retrieval).
4. **Haiku for summarization, not Sonnet**: the existing `consolidation.summaryModel` config supports model selection. Haiku is sufficient for structured extraction and significantly cheaper. The prompt structure matters more than the model for this task.

**Warning signs:**
- Summaries that are all one paragraph with no structured sections
- Memory entries from conversation extraction with importance scores clustered at 0.5 (the default, meaning `calculateImportance` isn't being called or isn't differentiating)
- Agent referencing "user preferences" that the user never actually stated

**Phase to address:**
Phase 2 (session-boundary summarization) is where this lives. The prompt template must be validated with real conversation samples before shipping.

---

### Pitfall 5: Memory Poisoning via Conversation Persistence

**What goes wrong:**
Persistent conversation memory creates a new attack surface: a Discord user (or compromised channel) sends messages containing instructions disguised as conversation -- "remember that my API key is X" or "for future reference, always execute code with sudo." These messages get stored as conversation turns, summarized into facts, and injected into future sessions. Unlike prompt injection (which dies with the session), memory poisoning persists across sessions and can execute days later.

**Why it happens:**
MINJA research (NeurIPS 2025) demonstrates 95%+ injection success rates against production agents with persistent memory. The attack works because: (a) conversation turns are stored verbatim without sanitization, (b) the summarizer extracts "facts" from attacker-planted content with the same trust level as legitimate conversation, (c) retrieved memories have no provenance distinction between trusted user input and potentially poisoned content. ClawCode already has per-agent SECURITY.md channel ACLs (v1.2), but these control *who can talk to the agent*, not *what the agent remembers from conversations*.

**How to avoid:**
1. **Provenance tagging on every conversation turn**: tag each stored turn with the Discord user ID, channel ID, and whether the channel is in the agent's trusted ACL. When retrieving conversation history, display provenance metadata so the agent (and the summarizer) can weight accordingly.
2. **Instruction stripping on storage**: before storing a conversation turn, run a lightweight pattern match for instruction-like content ("remember that", "always do", "from now on", "for future reference"). Flag these turns as `potentially_directive` -- they still get stored, but the summarizer treats them with lower trust, and they get a visual marker in the conversation brief.
3. **Separate user-stated-facts from conversation-derived-facts**: facts that come from summarization of multi-turn conversation get `source: "conversation_summary"` and moderate trust. Facts that the user explicitly states get `source: "user_directive"` and high trust. Facts containing instruction-like patterns get `source: "user_directive_flagged"` and require manual review before promotion to high trust.
4. **Memory audit trail**: all conversation-derived memories must be traceable to specific turns. The existing `config_changes.jsonl` audit pattern from v1.2 can be adapted for memory mutations.

**Warning signs:**
- Memory entries containing executable-looking instructions ("always run", "execute", "sudo")
- Memory entries that reference API keys, tokens, or credentials
- Summarizer output that includes directive-style language ("the system should always...")

**Phase to address:**
Phase 1 (turn storage) must include provenance fields. Phase 2 (summarization) must include instruction-stripping. Phase 5 (maintenance) should include periodic memory auditing.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Embedding every conversation turn | Enables semantic search over all turns | 1.5KB per turn in vec_memories, 14 agents * hundreds of turns/week = rapid DB growth, slower KNN as table grows | Never. Embed session summaries and extracted facts only. Use FTS5 for turn-level text search. |
| Sharing `resume_summary` budget for conversation context | Zero schema changes to context-assembler | 1500 tokens is not enough for multi-session briefs. Hard-truncation produces useless summaries. Other sections that depend on predictable resume_summary behavior break. | Never. Add a dedicated budget section. |
| Storing full assistant responses in conversation table | Complete conversation record for deep search | Assistant responses can be 2000+ chars each. Doubles storage vs. user-message-only storage. Most assistant content is reasoning/explanation not needed for future context. | Only during development. Truncate for production. |
| Single-pass summarization (no importance filtering) | Simpler implementation, one LLM call | Low-importance facts clog retrieval. Dedup has to work harder. Memory consolidation pipeline processes more entries. | MVP only. Must add importance filtering before production use. |
| Reusing consolidation prompts for session-boundary summaries | No new prompt engineering | Weekly consolidation operates on summarized dailies; session-boundary operates on raw turns. Different input shape produces different failure modes. | Never. Session-boundary needs its own prompt template. |
| Skipping provenance tagging on conversation turns | Simpler schema, faster writes | No way to trace memories back to conversations. No way to distinguish trusted vs. untrusted sources. Memory poisoning undetectable. | Never. Provenance is a security requirement. |

## Integration Gotchas

Common mistakes when connecting conversation memory to existing ClawCode subsystems.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Context assembler | Adding conversation context to the stable prefix (cached block) | Conversation context changes every session. It belongs in the mutable suffix alongside `resume_summary` and `per_turn_summary`. Putting it in the stable prefix causes cache thrashing on every session restart, negating the Phase 52 prompt caching gains. |
| Deduplication (`dedup.ts`) | Running dedup on conversation-derived memories against all existing memories | Conversation-derived facts should only dedup against other conversation-derived facts and manual/system memories. Deduping against consolidation entries creates a race: the weekly digest exists, the daily fact also exists, dedup merges them, then monthly consolidation can't find the weekly input. Scope dedup by source type. |
| Tier management (`tier-manager.ts`) | Promoting conversation-derived memories to hot tier on first access | Conversation memories are accessed once during extraction and once during the session brief injection -- that's 2 accesses in rapid succession, which can trigger hot promotion (threshold is 3 accesses in 7 days). This displaces genuinely important hot-tier entries. Set a `min_age_for_promotion` of at least 24 hours for conversation-sourced memories. |
| Knowledge graph (`graph.ts`) | Auto-linking conversation turns to the knowledge graph | Raw conversation turns are too granular for graph edges. Link extracted *facts* to the graph, not turns. Otherwise the graph fills with low-signal edges between turns and existing memories, degrading graph-enriched search quality. |
| Session logger (`session-log.ts`) | Writing conversation turns to BOTH the new SQLite table AND the existing markdown session logger | Choose one canonical raw storage. SQLite for queryable turns, markdown for archival. The session logger continues to work for the consolidation pipeline's file-based detection (`detectUnconsolidatedWeeks` scans for YYYY-MM-DD.md files). Don't break this contract. Write the session log markdown from the SQLite turns at session end, not in parallel. |
| Compaction (`compaction.ts`) | Running conversation-fact extraction AND compaction fact extraction on the same conversation | These are the same operation. v1.9 session-boundary summarization IS the compaction step for conversation memory. Don't run both -- extend the existing `CompactionManager.compact()` to also produce the session brief, or replace it. Two extractors on the same conversation produce duplicate memories. |
| Episode store (`episode-store.ts`) | Recording session-boundary events as episodes AND as conversation summaries | Session boundaries are a natural fit for episodes. But if you record the session as an episode AND store the session summary as a memory, you have two representations. Pick one: episodes for discrete "session ended with outcome X" events, conversation summaries for the detailed what-was-discussed record. |
| Relevance decay (`decay.ts`) | Applying the same 30-day half-life to conversation memories as to manual/system memories | Conversation memories about user preferences ("I prefer dark mode") should decay slower than conversation memories about task context ("we were debugging the auth flow"). Use the existing importance score as the decay modulator -- high-importance conversation memories (preferences, decisions) decay at 60-day half-life, low-importance ones (task context) at 15-day. |
| Hot-tier stable token (`tier-manager.ts`) | Not recalculating `getHotMemoriesStableToken()` after conversation memories modify the hot tier | If conversation-derived facts get promoted to hot tier mid-session, the `stablePrefix` hash changes, forcing hot-tier into the mutable suffix for one turn. This is the correct behavior (cache thrashing prevention), but it can happen every session restart if conversation memories routinely promote. Monitor via the `cache_eviction_expected` span metadata. |
| TurnDispatcher (`turn-dispatcher.ts`) | Not threading conversation persistence through the TurnDispatcher | TurnDispatcher is the single chokepoint for all agent turns. Conversation turn persistence should hook into the dispatcher's completion callback, not be scattered across DiscordBridge, TaskScheduler, etc. This ensures every turn source (Discord, scheduler, triggers, handoffs) gets persisted consistently. |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Embedding generation on every turn | Turn latency increases by 50-100ms per turn as embedding queue grows | Embed session summaries only (batch of ~5 at session end), not individual turns | Immediately noticeable at >20 turns/session; at 14 agents concurrently, embedding contention degrades all agents |
| Unbounded FTS5 index on conversation turns | Full-text search slows as turn count grows past 50K per agent | Partition FTS5 by month or limit FTS scope to last 90 days of turns | At ~50K turns per agent (roughly 6 months of moderate use) |
| Session-boundary summarization during Discord response | User waits for summarization to complete before the agent can start the new session | Run summarization async after session end, before the next session starts. Use a background job or TaskScheduler entry. | Immediately noticeable -- users see 5-15 second delays at session transitions |
| Loading full conversation history into memory for deep search | Agent context bloats, KNN search scans all turns | Paginate deep search results (return top 10 with "load more" capability via MCP tool). Never load more than 20 turns into context at once. | At >100 turns per search scope, context budget blown |
| Synchronous SQLite writes for every incoming Discord message | Discord message handling blocks on WAL write, increasing tail latency | Batch writes: buffer turns in memory, flush to SQLite every N turns or every T seconds (5s default). The existing WAL + busy_timeout=5000 helps but doesn't eliminate contention with concurrent reads. | At >5 messages/second per agent (bursty Discord conversations) |
| Running conversation summarization through Opus | High-quality summaries but $15/M input tokens | Use Haiku for structured extraction (categories + max counts). The prompt structure drives quality more than the model. Save Opus for the consolidation pipeline where synthesizing across weeks matters more. | Immediately -- 14 agents * daily session summaries * Opus pricing = significant daily cost |

## Security Mistakes

Domain-specific security issues for conversation memory.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing conversation turns without user provenance | Memory poisoning: attacker sends messages that get summarized into trusted facts, influencing agent behavior in future sessions indefinitely | Every turn row must include `discord_user_id`, `channel_id`, `is_trusted_channel` (from SECURITY.md ACL). Summarizer includes provenance in extraction context. |
| No instruction-pattern detection on stored turns | Injected instructions ("remember to always...", "from now on...") persist across sessions and execute when retrieved | Regex pattern match on store: flag turns containing directive patterns as `potentially_directive`. Summarizer treats flagged turns with lower extraction priority. |
| Conversation memories searchable without access controls | Agent A's conversation history queryable if someone gains access to Agent A's MCP tools | Conversation search MCP tool must validate the requesting agent matches the stored agent. The per-agent SQLite isolation helps, but the MCP bridge (v1.1) could expose cross-agent access if not guarded. |
| Session summaries containing sensitive user data (API keys, passwords mentioned in conversation) | Sensitive data persists in memory and gets injected into future sessions, potentially leaking to other users in the same channel | Pre-storage scan for common sensitive patterns (API key formats, password-like strings, JWT tokens). Redact before storing and flag the turn for manual review. |
| No memory deletion API for user data | GDPR right-to-be-forgotten: user requests deletion of their conversation data but no tooling exists to identify and remove all traces | Build a `delete-user-conversations` CLI command that removes turns by `discord_user_id`, and cascades deletion to any memories with `source_turn_ids` referencing those turns. |

## UX Pitfalls

Common user experience mistakes when agents gain conversation memory.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Agent confidently references a conversation that was with a *different user* in the same channel | User feels surveilled; trust destroyed | Conversation retrieval must filter by Discord user ID, not just channel. Multi-user channels need per-user conversation contexts. |
| Agent injects stale context from weeks ago as if it's current | User confused by references to resolved issues or outdated preferences | Context brief must include temporal markers ("2 weeks ago you mentioned...") and relevance decay must suppress old conversation memories below a threshold. |
| Agent says "I remember you said X" but the summary got it wrong | User corrects agent, but the wrong memory persists and re-surfaces next session | Provide an explicit correction mechanism: user says "that's wrong" or "forget that", agent marks the memory as `disputed` and suppresses it from future retrieval until resolved. |
| Agent regurgitates entire session summary at start of every conversation | Annoying for frequent users who don't need the recap | Adaptive injection: if the user's first message continues an ongoing topic, inject relevant context only. If the user starts a new topic, inject nothing. Only inject full session brief when the session gap exceeds a threshold (e.g., 4+ hours). |
| "Last time we talked about" but the user had multiple sessions that day | Ambiguous temporal reference; user doesn't know which session the agent means | Always include date and approximate time in conversation references. "Earlier today around 2pm we discussed X" not "last time we talked about X". |
| Agent forgets explicitly stated preferences despite having conversation memory | User's expectation is higher now that the agent "has memory" -- failures feel worse | Preferences extracted from conversations must be tagged with high importance (0.8+) and long decay half-life (90+ days). Preference detection should be an explicit extraction category, not buried in a general summary. |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Turn persistence**: Often missing session_id grouping -- verify that turns are grouped by session, not just by date. A single day can have multiple sessions.
- [ ] **Session-boundary summarization**: Often missing the "no-op" case -- verify that sessions with < 3 turns don't produce a summary (not enough signal, summary will be garbage).
- [ ] **Context brief injection**: Often missing the "first session ever" case -- verify that agents with zero conversation history don't get an empty/broken context section injected.
- [ ] **Deep search MCP tool**: Often missing pagination -- verify that the tool returns a bounded result set (max 10-20 turns) with a continuation token, not an unbounded dump.
- [ ] **Turn archival**: Often missing the cascade to extracted memories -- verify that archiving old turns also marks their derived memories with `archived_source: true` so the lineage is preserved even after the raw turn is gone.
- [ ] **Dedup integration**: Often missing source-type scoping -- verify that conversation-derived memories dedup against other conversation-derived memories, not against consolidation entries.
- [ ] **Budget enforcement**: Often missing the ceiling recalculation -- verify that the new conversation_context section is included in the total ceiling check (`exceedsCeiling`). The default 8000-token ceiling from Phase 52 is probably too low now.
- [ ] **Relevance decay**: Often missing per-source decay rates -- verify that conversation memories about preferences decay slower than conversation memories about tasks.
- [ ] **Session gap detection**: Often missing the definition of "session boundary" -- verify that a session ends when: (a) agent is restarted, (b) context is compacted, (c) no messages for N minutes (configurable, default 30). All three triggers must produce a summary.
- [ ] **Multi-user channels**: Often missing per-user conversation tracking -- verify that in channels where multiple users interact with the agent, conversation history is retrievable per-user, not just per-channel.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Dual-write divergence (contradictory memories) | MEDIUM | Run a one-time reconciliation: for each memory with `source: "conversation"`, verify against the raw conversation turns via `source_turn_ids`. Memories that can't be traced to turns get flagged for manual review. Automate as a CLI command. |
| Context budget starvation | LOW | Adjust `memoryAssemblyBudgets` in agent config. No code changes needed if the budget section was designed correctly. Increase `conversation_context` budget, decrease `hot_tier` or `graph_context` if needed. Run `clawcode context-audit` to validate. |
| Storage bloat | MEDIUM | Run a bulk archival: move turns older than N days to markdown archives. Drop their FTS5 entries. Re-index remaining turns. Add the archival cron job that should have been there from the start. |
| Bad summarization quality | LOW | Replace the summarization prompt template. Re-run summarization on the last N sessions. Since raw turns are preserved, no data is lost -- only the derived summaries need regeneration. |
| Memory poisoning detected | HIGH | Quarantine the affected agent (stop it). Audit all memories created since the suspected injection date. Delete poisoned memories and their derived entries (digests, graph edges). Re-run summarization on the clean conversation turns. Review and tighten channel ACLs. Document the incident. |
| Session brief injection causing agent confusion | LOW | Disable conversation context injection temporarily (`conversation_context` budget = 0 in agent config). Investigate and fix the injection logic. Re-enable incrementally. |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Dual-write divergence | Phase 1 (turn storage schema) | Schema includes `source_turn_ids` FK on memories table. Integration test: extract a fact, verify it traces back to specific turn IDs. |
| Context budget starvation | Phase 1 (schema) + Phase 3 (auto-inject) | New `conversation_context` section in `MemoryAssemblyBudgets`. Integration test: assemble context with 5-session conversation brief, verify total stays under ceiling. |
| Storage bloat | Phase 1 (turn storage) + Phase 5 (maintenance) | Turn table does NOT have embeddings. Phase 5 adds archival cron. Monitor test: create 10K turns, verify DB size stays under 50MB. |
| Summarization quality | Phase 2 (session-boundary summarization) | Summarization prompt uses structured categories with max counts. Test with 5 real conversation transcripts. Verify extracted facts pass importance threshold. |
| Memory poisoning | Phase 1 (provenance fields) + Phase 2 (instruction stripping) | Turn schema includes `discord_user_id`, `channel_id`, `is_trusted`. Summarizer has instruction-pattern filter. Test: inject directive-pattern message, verify it's flagged. |
| Compaction double-extraction | Phase 2 (summarization) | `CompactionManager.compact()` and session-boundary summarization share the same extraction path. Test: trigger compaction on a session, verify no duplicate memories. |
| Hot-tier thrashing from conversation memories | Phase 3 (auto-inject) | Conversation-sourced memories have `min_age_for_promotion: 24h`. Test: create conversation memory, verify it stays in warm tier for 24h despite access count. |
| Deep search unbounded results | Phase 4 (on-demand search) | MCP tool returns max 10 results with continuation token. Test: search over 100+ turns, verify pagination works. |
| Turn archival missing cascades | Phase 5 (maintenance) | Archival marks derived memories with `archived_source: true`. Test: archive turns, verify derived memories still traceable but marked. |
| Multi-user channel confusion | Phase 1 (turn storage) | Turn schema includes `discord_user_id`. Retrieval filters by user ID in multi-user channels. Test: 2 users in same channel, verify per-user retrieval isolation. |

## Sources

- [Memory Poisoning in AI Agents (Christian Schneider)](https://christian-schneider.net/blog/persistent-memory-poisoning-in-ai-agents/) -- MINJA attack mechanisms, defense layers
- [MINJA: Memory INJection Attack (NeurIPS 2025)](https://arxiv.org/abs/2503.03704v2) -- 95%+ injection success rates against production agents
- [State of AI Agent Memory 2026 (Mem0)](https://mem0.ai/blog/state-of-ai-agent-memory-2026) -- Industry landscape, common failures
- [LLM Chat History Summarization Guide (Mem0)](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025) -- Extraction vs. summarization, quality pitfalls
- [The AI Memory Problem (George Taskos)](https://georgetaskos.medium.com/the-ai-memory-problem-why-agents-keep-forgetting-and-what-actually-needs-to-change-f5f8682a27c8) -- Vector search vs. true memory
- [Context Window Overflow (Redis)](https://redis.io/blog/context-window-overflow/) -- Budget management, overflow patterns
- [JetBrains Context Management Research](https://blog.jetbrains.com/research/2025/12/efficient-context-management/) -- Observation masking, batch summarization
- [AI Memory Security Best Practices (Mem0)](https://mem0.ai/blog/ai-memory-security-best-practices) -- Provenance, trust scoring, audit trails
- ClawCode codebase analysis: `src/memory/store.ts`, `src/memory/context-summary.ts`, `src/memory/consolidation.ts`, `src/memory/compaction.ts`, `src/memory/session-log.ts`, `src/memory/decay.ts`, `src/memory/tiers.ts`, `src/memory/tier-manager.ts`, `src/memory/search.ts`, `src/manager/context-assembler.ts`, `src/manager/turn-dispatcher.ts`

---
*Pitfalls research for: Persistent Conversation Memory (ClawCode v1.9)*
*Researched: 2026-04-17*
