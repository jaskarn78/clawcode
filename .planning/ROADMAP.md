# Roadmap: ClawCode

## Milestones

- :white_check_mark: **v1.0 Core Multi-Agent System** - Phases 1-5 (shipped 2026-04-09)
- :white_check_mark: **v1.1 Advanced Intelligence** - Phases 6-20 (shipped 2026-04-09)
- :white_check_mark: **v1.2 Production Hardening & Platform Parity** - Phases 21-30 (shipped 2026-04-09)
- :white_check_mark: **v1.3 Agent Integrations** - Phases 31-32 (shipped 2026-04-09)
- :white_check_mark: **v1.4 Agent Runtime** - Phases 33-35 (shipped 2026-04-10)
- :white_check_mark: **v1.5 Smart Memory & Model Tiering** - Phases 36-41 (shipped 2026-04-10)
- :white_check_mark: **v1.6 Platform Operations & RAG** - Phases 42-49 (shipped 2026-04-12)
- :white_check_mark: **v1.7 Performance & Latency** - Phases 50-56 (shipped 2026-04-14)
- :white_check_mark: **v1.8 Proactive Agents + Handoffs** - Phases 57-63 (shipped 2026-04-17)
- :hammer_and_wrench: **v1.9 Persistent Conversation Memory** - Phases 64-68 (active, started 2026-04-18)

## Phases

<details>
<summary>v1.0 Core Multi-Agent System (Phases 1-5) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

Phases 1-5 delivered: central config, agent lifecycle, Discord routing, per-agent memory, heartbeat framework.

</details>

<details>
<summary>v1.1 Advanced Intelligence (Phases 6-20) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for full details.

Phases 6-20 delivered: memory consolidation, relevance/dedup, tiered storage, task scheduling, skills registry, agent collaboration, Discord slash commands, attachments, thread bindings, webhook identities, session forking, context summaries, MCP bridge, reaction handling, memory search CLI.

</details>

<details>
<summary>v1.2 Production Hardening & Platform Parity (Phases 21-30) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.2-ROADMAP.md` for full details.

Phases 21-30 delivered: tech debt cleanup, config hot-reload, context health zones, episode memory, delivery queue, subagent Discord threads, security & execution approval, agent bootstrap, web dashboard.

</details>

<details>
<summary>v1.3 Agent Integrations (Phases 31-32) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.3-ROADMAP.md` for full details.

Phases 31-32 delivered: subagent thread skill (Discord-visible subagent work via skill interface), MCP client consumption (per-agent external MCP server config with health checks).

</details>

<details>
<summary>v1.4 Agent Runtime (Phases 33-35) - SHIPPED 2026-04-10</summary>

See `.planning/milestones/v1.4-ROADMAP.md` for full details.

Phases 33-35 delivered: global skill install (workspace skills auto-installed to ~/.claude/skills/), standalone agent runner (`clawcode run <agent>` command), OpenClaw coexistence fixes (token hard-fail, slash command namespace, dashboard non-fatal, env var interpolation).

</details>

<details>
<summary>v1.5 Smart Memory & Model Tiering (Phases 36-41) - SHIPPED 2026-04-10</summary>

See `.planning/milestones/v1.5-ROADMAP.md` for full details.

Phases 36-41 delivered: knowledge graph (wikilinks, backlinks, graph traversal), on-demand memory loading (personality fingerprint, memory_lookup MCP tool), graph intelligence (graph-enriched search, auto-linker heartbeat), model tiering (haiku default, fork-based escalation, opus advisor, /model command), cost optimization (per-agent token tracking, importance scoring, escalation budgets), context assembly pipeline (per-source token budgets).

</details>

<details>
<summary>v1.6 Platform Operations & RAG (Phases 42-49) - SHIPPED 2026-04-12</summary>

See `.planning/milestones/v1.6-ROADMAP.md` for full details.

Phases 42-49 delivered: auto-start agents on daemon boot, systemd production integration, agent-to-agent Discord communication (MCP tool + webhook embeds + bridge routing), memory auto-linking on save, scheduled memory consolidation via TaskScheduler, Discord slash commands for fleet control, webhook auto-provisioning per agent, RAG over documents (text/markdown/PDF ingestion, chunking, sqlite-vec KNN search, 4 MCP tools).

</details>

<details>
<summary>v1.7 Performance & Latency (Phases 50-56) - SHIPPED 2026-04-14</summary>

See `.planning/milestones/v1.7-ROADMAP.md` for full details.

Phases 50-56 delivered: latency instrumentation (per-turn traces + percentile CLI + dashboard), SLO targets + CI regression gate, Anthropic prompt caching (two-block context assembly + per-turn prefix hash), context/token budget tuning (audit CLI + lazy skills + 1500-token resume cap), streaming + typing indicator (first-token metric + 750ms cadence + <=500ms typing fire), tool-call overhead (intra-turn cache + per-tool telemetry + concurrency gate foundation), warm-path optimizations (READ-ONLY SQLite warmup + resident embeddings + warm-session reuse + startup ready-gate).

</details>

<details>
<summary>v1.8 Proactive Agents + Handoffs (Phases 57-63) - SHIPPED 2026-04-17</summary>

See `.planning/milestones/v1.8-ROADMAP.md` for full details.

Phases 57-63 delivered: TurnDispatcher foundation (single chokepoint for all turn sources), task store + state machine (durable tasks.db with 15-field rows + enforced transitions), cross-agent RPC handoffs (delegate_task MCP + async-ticket semantics + schema validation + cycle detection), trigger engine (3-layer dedup + policy evaluator + watermark replay + SchedulerSource migration), additional trigger sources (MySQL/webhook/inbox/calendar), policy layer + dry-run (YAML DSL + hot-reload + audit trail), observability surfaces (CLIs + dashboard task graph + cross-agent trace chain walker).

</details>

### v1.9 Persistent Conversation Memory (Phases 64-68) - ACTIVE

**Goal:** Agents remember what happened in prior sessions -- Discord conversations are stored, summarized into retrievable facts, and automatically injected on restart so agents never wake up to a blank slate.

- [x] **Phase 64: ConversationStore + Schema Foundation** - SQLite tables, session lifecycle records, memory lineage tracking, and provenance fields in per-agent memories.db (completed 2026-04-18)
- [ ] **Phase 65: Capture Integration** - Wire turn recording into the Discord path with instruction-pattern detection on storage
- [ ] **Phase 66: Session-Boundary Summarization** - LLM-generated session summaries stored as MemoryEntry objects at session end/crash
- [ ] **Phase 67: Resume Auto-Injection** - Structured context brief from recent session summaries injected on agent restart with adaptive gap detection
- [ ] **Phase 68: Conversation Search + Deep Retrieval** - On-demand semantic + full-text search over conversation history via enhanced MCP tool with pagination

## Phase Details

### Phase 64: ConversationStore + Schema Foundation

**Goal**: Every Discord conversation turn has a durable, queryable home in per-agent SQLite with session grouping, provenance tracking, and lineage links from extracted memories back to their source turns

**Depends on**: Nothing (first v1.9 phase -- data foundation everything else builds on)

**Requirements**: CONV-01, CONV-02, CONV-03, SEC-01

**Success Criteria** (what must be TRUE):
  1. A user message + agent response exchanged in Discord produces two rows in the agent's `conversation_turns` table with timestamps, channel_id, discord_user_id, role, and content -- queryable via `sqlite3 memories.db "SELECT * FROM conversation_turns ORDER BY created_at DESC LIMIT 4"`
  2. Every agent session (start through stop or crash) is tracked as an explicit `conversation_sessions` row with id, started_at, ended_at, turn_count, and status -- turns are grouped by session_id so "what happened last session" is a single WHERE clause
  3. When a memory is extracted from conversation turns, the resulting MemoryEntry carries a `source_turn_ids` field linking it back to the specific conversation turns it was derived from -- lineage is verifiable by JOINing memories to conversation_turns
  4. Every stored conversation turn includes `discord_user_id`, `channel_id`, and `is_trusted_channel` provenance fields -- a turn from an untrusted channel is distinguishable from a trusted one without any post-hoc analysis

**Plans:** 2/2 plans complete

Plans:
- [x] 64-01-PLAN.md -- Types, Zod schemas, and SQLite migration methods (conversation_sessions, conversation_turns, source_turn_ids)
- [x] 64-02-PLAN.md -- ConversationStore class implementation, unit tests, and AgentMemoryManager wiring

### Phase 65: Capture Integration

**Goal**: Every Discord message exchange is automatically recorded in the ConversationStore as it happens, with instruction-pattern detection flagging potential injection attempts before they enter the persistent record

**Depends on**: Phase 64 (ConversationStore schema must exist to write into)

**Requirements**: SEC-02

**Success Criteria** (what must be TRUE):
  1. After an agent responds to a Discord message, both the user message and assistant response appear as rows in `conversation_turns` within the same transaction -- the capture is fire-and-forget (never blocks Discord response delivery) and a capture failure is logged but does not affect the user's experience
  2. A Discord message containing instruction-like patterns ("remember that you must always...", "from now on ignore...", "for future reference execute...") is flagged with a `potentially_directive` marker on the stored turn row before it enters the persistent record -- the flag is visible in the raw data and available to downstream summarization
  3. Session lifecycle events (agent start, agent stop, agent crash) are recorded as session boundary transitions in `conversation_sessions` -- the capture integration calls ConversationStore.startSession() on agent boot and endSession() on stop/crash

**Plans:** 2 plans

Plans:
- [ ] 65-01-PLAN.md -- Instruction detector (SEC-02), schema extension (instruction_flags column), capture helper module with tests
- [ ] 65-02-PLAN.md -- SessionManager lifecycle wiring (start/stop/crash sessions) and DiscordBridge capture integration

### Phase 66: Session-Boundary Summarization

**Goal**: When a session ends, raw conversation turns are compressed into a structured summary of preferences, decisions, open threads, and commitments -- stored as a standard MemoryEntry that automatically participates in search, decay, tier management, and knowledge graph linking

**Depends on**: Phase 65 (ConversationStore must have captured turns to summarize)

**Requirements**: SESS-01, SESS-04

**Success Criteria** (what must be TRUE):
  1. When an agent session ends (stop or crash), a haiku LLM call from the daemon compresses that session's conversation turns into a structured summary with explicit categories (user preferences, decisions made, open threads, commitments) -- the summary is generated within 10 seconds or falls back to raw-turn extraction
  2. The generated session summary is stored as a standard MemoryEntry with `source="conversation"` and tags `["session-summary", "session:{id}"]` -- it automatically appears in semantic search results, receives relevance decay scoring, flows through hot/warm/cold tier management, and gets auto-linked by the knowledge graph linker without any special-case code
  3. Sessions with fewer than 3 turns produce no summary (insufficient signal) -- a session where the agent just said hello and crashed does not generate a garbage summary that pollutes the memory store

**Plans**: TBD

### Phase 67: Resume Auto-Injection

**Goal**: An agent waking up after a gap receives a structured context brief of recent sessions so it can naturally reference prior conversations without the user repeating themselves

**Depends on**: Phase 66 (session summaries must exist in MemoryStore to assemble the brief)

**Requirements**: SESS-02, SESS-03

**Success Criteria** (what must be TRUE):
  1. When an agent resumes after a session gap, the last N recent session summaries (default 3, configurable via `conversation.resumeSessionCount`) are assembled into a structured context brief and injected into the agent's prompt via the context assembly pipeline -- the brief fits within a dedicated conversation_context budget (2000-3000 tokens) without starving identity, skills, or hot-tier memory sections
  2. When the session gap is shorter than the configured threshold (default 4 hours), auto-injection is skipped entirely -- a brief agent restart (crash recovery, config reload) does not inject redundant context that wastes token budget
  3. An agent with zero conversation history (first session ever, or no prior summaries) starts normally with no empty or broken context section injected -- the conversation brief gracefully produces nothing rather than an empty heading or placeholder text

**Plans**: TBD

### Phase 68: Conversation Search + Deep Retrieval

**Goal**: Agents can search older conversation history on demand when the auto-injected brief is insufficient -- via semantic search over session summaries and full-text search over raw turns, with paginated, time-decay-weighted results

**Depends on**: Phase 64 (conversation_turns table for FTS5), Phase 66 (session summaries with embeddings for semantic search)

**Requirements**: RETR-01, RETR-02, RETR-03

**Success Criteria** (what must be TRUE):
  1. An agent calling `memory_lookup` with `scope="conversations"` (or `scope="all"`) receives results from conversation session summaries alongside regular knowledge memories -- the scope parameter is backward-compatible (existing callers that omit it get the same results as before)
  2. Raw conversation turn text is searchable via FTS5 full-text search for precise keyword recall -- an agent searching for "the exact API endpoint we discussed" finds the specific turn containing that phrase even when semantic search surfaces tangentially related results instead
  3. Search results are paginated (max 10 per page) with time-decay weighting so recent conversations rank higher than old ones given similar semantic relevance -- an agent searching "deployment" sees last week's deployment discussion before last month's, and can request additional pages if the first page does not contain what it needs

**Plans**: TBD

## Progress

**Status:** v1.8 Proactive Agents + Handoffs shipped 2026-04-17. v1.9 Persistent Conversation Memory active (roadmap ready 2026-04-18).

| Milestone | Phases | Status | Completed |
|-----------|--------|--------|-----------|
| v1.0 | 1-5 | Complete | 2026-04-09 |
| v1.1 | 6-20 | Complete | 2026-04-09 |
| v1.2 | 21-30 | Complete | 2026-04-09 |
| v1.3 | 31-32 | Complete | 2026-04-09 |
| v1.4 | 33-35 | Complete | 2026-04-10 |
| v1.5 | 36-41 | Complete | 2026-04-10 |
| v1.6 | 42-49 | Complete | 2026-04-12 |
| v1.7 | 50-56 | Complete | 2026-04-14 |
| v1.8 | 57-63 | Complete | 2026-04-17 |
| v1.9 | 64-68 | Active -- planning Phase 65 | -- |

### v1.9 Phase Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 64. ConversationStore + Schema Foundation | 2/2 | Complete    | 2026-04-18 |
| 65. Capture Integration | 0/2 | Planned | - |
| 66. Session-Boundary Summarization | 0/TBD | Not started | - |
| 67. Resume Auto-Injection | 0/TBD | Not started | - |
| 68. Conversation Search + Deep Retrieval | 0/TBD | Not started | - |
