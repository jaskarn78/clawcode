# Roadmap: ClawCode

## Milestones

- :white_check_mark: **v1.0 Core Multi-Agent System** - Phases 1-5 (shipped 2026-04-09)
- :construction: **v1.1 Advanced Intelligence** - Phases 6-11 (in progress)

## Phases

<details>
<summary>v1.0 Core Multi-Agent System (Phases 1-5) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

Phases 1-5 delivered: central config, agent lifecycle, Discord routing, per-agent memory, heartbeat framework.

</details>

### v1.1 Advanced Intelligence (In Progress)

**Milestone Goal:** Make agents smarter over time with self-maintaining memory, operational scheduling, skill discovery, and inter-agent collaboration.

**Phase Numbering:**
- Integer phases (6, 7, 8...): Planned milestone work
- Decimal phases (7.1, 7.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 6: Memory Consolidation Pipeline** - Daily logs roll up into weekly and monthly digests with raw archival
- [ ] **Phase 7: Memory Relevance & Deduplication** - Memories decay over time and duplicates merge automatically
- [ ] **Phase 8: Tiered Memory Storage** - Hot/warm/cold memory tiers with automatic promotion on access
- [ ] **Phase 9: Task Scheduling** - Cron-like scheduled tasks per agent within persistent sessions
- [ ] **Phase 10: Skills Registry** - Central skill catalog with per-agent assignment and discovery
- [ ] **Phase 11: Agent Collaboration** - Subagent spawning, async messaging between agents, and admin cross-workspace access

## Phase Details

### Phase 6: Memory Consolidation Pipeline
**Goal**: Agent memory self-organizes over time -- daily noise becomes structured knowledge without manual intervention
**Depends on**: Phase 5 (heartbeat framework provides scheduling hooks for consolidation triggers)
**Requirements**: AMEM-01, AMEM-02, AMEM-03
**Success Criteria** (what must be TRUE):
  1. After 7 days of daily session logs, a weekly digest summary exists that captures key facts from those days
  2. After 4 weekly digests accumulate, a monthly summary exists that synthesizes the month
  3. Raw daily logs from consolidated periods are archived (still on disk) but no longer appear in standard memory search results
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md — Schema, types, config extension, and SessionManager accessors
- [x] 06-02-PLAN.md — Core consolidation logic (detect, summarize, store, archive)
- [x] 06-03-PLAN.md — Heartbeat check module and integration wiring

### Phase 7: Memory Relevance & Deduplication
**Goal**: Memory search surfaces what matters -- recent and frequently accessed memories rank higher, and redundant entries collapse into single authoritative facts
**Depends on**: Phase 6 (consolidation creates the digest structures that relevance scoring operates on)
**Requirements**: AMEM-04, AMEM-05, AMEM-06, AMEM-07
**Success Criteria** (what must be TRUE):
  1. A memory not accessed for a configurable period has a measurably lower relevance score than a recently accessed memory with similar content
  2. Memory search results are ordered factoring in relevance decay -- not just semantic similarity
  3. When a new memory is stored that semantically duplicates an existing entry, only one entry remains (merged) rather than two
  4. The merged entry preserves the higher importance score and combines metadata from both sources
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md — Config schema, decay scoring, and relevance ranking functions
- [x] 07-02-PLAN.md — Deduplication check and merge logic
- [x] 07-03-PLAN.md — Integration wiring into SemanticSearch and MemoryStore

### Phase 8: Tiered Memory Storage
**Goal**: Agents operate with the right memories at the right speed -- hot memories are instantly available in context, warm memories are a search away, cold memories are archived until needed
**Depends on**: Phase 7 (relevance scores determine tier placement; deduplication prevents tier pollution)
**Requirements**: AMEM-08, AMEM-09
**Success Criteria** (what must be TRUE):
  1. Agent's active context contains only hot-tier memories (most relevant/recent), not the entire memory store
  2. Warm-tier memories are retrievable via SQLite semantic search but not loaded into context by default
  3. Cold-tier memories exist as archived markdown files, excluded from search until promoted
  4. A search hit on a cold memory promotes it to warm; repeated access of a warm memory promotes it to hot
**Plans**: 2 plans

Plans:
- [ ] 08-01-PLAN.md --- Types, schema, pure tier functions, SQLite migration� Types, schema, pure tier functions, SQLite migration
- [ ] 08-02-PLAN.md --- TierManager, cold archival, hot injection, integration wiring� TierManager, cold archival, hot injection, integration wiring

### Phase 9: Task Scheduling
**Goal**: Agents can perform recurring work autonomously -- maintenance tasks, checks, and routines run on schedule without human triggering
**Depends on**: Phase 5 (heartbeat framework provides the execution loop; no dependency on memory phases)
**Requirements**: SKED-01, SKED-02, SKED-03
**Success Criteria** (what must be TRUE):
  1. User can define a cron-expression scheduled task in clawcode.yaml and the agent executes it at the defined interval
  2. Scheduled tasks run within the agent's existing persistent session (not a separate process)
  3. Running `clawcode schedules` shows all scheduled tasks, their next run time, and last execution status
**Plans**: 3 plans

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD
- [ ] 09-03: TBD

### Phase 10: Skills Registry
**Goal**: Agents know what they can do -- skills are cataloged centrally, assigned per-agent, and discoverable at runtime
**Depends on**: Phase 5 (no dependency on memory or scheduling phases)
**Requirements**: SKIL-01, SKIL-02, SKIL-03, SKIL-04
**Success Criteria** (what must be TRUE):
  1. A central registry exists listing all available skills with name, description, and version metadata
  2. clawcode.yaml supports per-agent skill assignment and the agent only sees its assigned skills
  3. An agent can list its own skills at runtime and access their SKILL.md documentation
  4. Skills follow the existing Claude Code directory-with-SKILL.md format (no new format invented)
**Plans**: 3 plans

Plans:
- [ ] 10-01: TBD
- [ ] 10-02: TBD
- [ ] 10-03: TBD

### Phase 11: Agent Collaboration
**Goal**: Agents work together -- they can spawn helpers, exchange messages asynchronously, and the admin agent can oversee and coordinate across the entire system
**Depends on**: Phase 9 (heartbeat-based message checking uses the scheduling/heartbeat loop), Phase 10 (skills inform subagent capabilities)
**Requirements**: SAGN-01, SAGN-02, XAGT-01, XAGT-02, XAGT-03, XAGT-04
**Success Criteria** (what must be TRUE):
  1. A running agent can spawn a subagent using Claude Code's Agent tool with a specified model (sonnet/opus/haiku)
  2. Agent A can send a message to Agent B's inbox and Agent B receives it on next heartbeat cycle
  3. The admin agent can read files in any other agent's workspace regardless of workspace isolation
  4. The admin agent can trigger agent restarts and coordinate cross-agent tasks via IPC commands
  5. Subagent spawning and async messaging are independent -- agents that never spawn subagents can still message each other
**Plans**: 3 plans

Plans:
- [ ] 11-01: TBD
- [ ] 11-02: TBD
- [ ] 11-03: TBD
- [ ] 11-04: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 6 -> 7 -> 8 -> 9 -> 10 -> 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 6. Memory Consolidation Pipeline | v1.1 | 0/3 | Not started | - |
| 7. Memory Relevance & Deduplication | v1.1 | 0/3 | Not started | - |
| 8. Tiered Memory Storage | v1.1 | 0/2 | Not started | - |
| 9. Task Scheduling | v1.1 | 0/3 | Not started | - |
| 10. Skills Registry | v1.1 | 0/3 | Not started | - |
| 11. Agent Collaboration | v1.1 | 0/4 | Not started | - |
