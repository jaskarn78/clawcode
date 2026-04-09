# Roadmap: ClawCode

## Milestones

- :white_check_mark: **v1.0 Core Multi-Agent System** - Phases 1-5 (shipped 2026-04-09)
- :white_check_mark: **v1.1 Advanced Intelligence** - Phases 6-20 (shipped 2026-04-09)
- :construction: **v1.2 Production Hardening & Platform Parity** - Phases 21-30 (in progress)

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

### v1.2 Production Hardening & Platform Parity (In Progress)

**Milestone Goal:** Resolve tech debt, achieve OpenClaw feature parity on key platform capabilities, add subagent-to-Discord-thread spawning, and build a web dashboard.

- [x] **Phase 21: Tech Debt - Code Quality** - Attachment cleanup, logger consistency, silent catch fixes, session-manager split (completed 2026-04-09)
- [x] **Phase 22: Tech Debt - Test & Type Safety** - Test fixture updates, CLI unit tests, SDK v2 type narrowing (completed 2026-04-09)
- [x] **Phase 23: Config Hot-Reload & Audit Trail** - File watching, live config updates, JSONL change log (completed 2026-04-09)
- [x] **Phase 24: Context Health Zones** - Zone classification, alerts, auto-snapshots, status visibility (completed 2026-04-09)
- [x] **Phase 25: Episode Memory** - Discrete event records, structured fields, semantic search, archival (completed 2026-04-09)
- [ ] **Phase 26: Discord Delivery Queue** - Outbound message queuing, retry with backoff, failed delivery log
- [ ] **Phase 27: Subagent Discord Threads** - Auto thread creation on subagent spawn, webhook binding, routing, cleanup
- [ ] **Phase 28: Security & Execution Approval** - Command allowlists, approval flow, channel ACLs, audit logging
- [ ] **Phase 29: Agent Bootstrap** - First-run detection, guided SOUL.md/IDENTITY.md generation
- [ ] **Phase 30: Web Dashboard** - Agent status, memory stats, schedules, health, delivery queue, agent controls

## Phase Details

### Phase 21: Tech Debt - Code Quality
**Goal**: Codebase uses consistent structured logging, handles errors properly, and has clean module boundaries
**Depends on**: Nothing (foundational cleanup)
**Requirements**: DEBT-01, DEBT-02, DEBT-03, DEBT-04
**Success Criteria** (what must be TRUE):
  1. Attachment temp files are cleaned up periodically via the heartbeat system (no stale files accumulate)
  2. Every log statement in the codebase uses the pino structured logger (zero console.log/console.error calls remain)
  3. All catch blocks either log the error with context and propagate it, or handle it explicitly (no silent swallows)
  4. session-manager.ts is split into focused modules each under 400 lines
**Plans**: 2 plans
Plans:
- [ ] 21-01-PLAN.md — Attachment cleanup heartbeat, logger consistency, silent catch fixes (DEBT-01, DEBT-02, DEBT-03)
- [ ] 21-02-PLAN.md — Split session-manager.ts into focused modules (DEBT-04)

### Phase 22: Tech Debt - Test & Type Safety
**Goal**: Test suite runs cleanly without type workarounds and CLI commands have unit test coverage
**Depends on**: Phase 21
**Requirements**: DEBT-05, DEBT-06, DEBT-07
**Success Criteria** (what must be TRUE):
  1. All test fixtures include required fields (reactions, tiers) with no `as unknown as` casts remaining
  2. Every CLI command (schedules, skills, send, threads, webhooks, fork, memory, mcp, usage) has unit tests that verify output formatting and error handling
  3. SDK v2 unstable API usage has explicit TypeScript interfaces replacing `any` types, with documented migration notes
**Plans**: 2 plans
Plans:
- [x] 22-01-PLAN.md — Fix test fixtures, add CLI unit tests (DEBT-05, DEBT-06)
- [ ] 22-02-PLAN.md — SDK v2 type narrowing with migration notes (DEBT-07)

### Phase 23: Config Hot-Reload & Audit Trail
**Goal**: Operators can update agent configuration without restarting the daemon, with a full change history
**Depends on**: Phase 21 (clean module boundaries needed for reload isolation)
**Requirements**: HOTR-01, HOTR-02, HOTR-03, HOTR-04
**Success Criteria** (what must be TRUE):
  1. Editing clawcode.yaml while the daemon is running applies supported changes (channels, skills, schedules, heartbeat) within seconds without restart
  2. Changing non-reloadable fields (model, workspace) logs a clear warning indicating a restart is required
  3. Every config change is recorded in a JSONL audit trail with timestamp, field path, before value, and after value
**Plans**: 2 plans
Plans:
- [x] 23-01-PLAN.md — Config watcher, field-level differ, JSONL audit trail (HOTR-01, HOTR-03, HOTR-04)
- [ ] 23-02-PLAN.md — Hot-reload application to running subsystems (HOTR-02)

### Phase 24: Context Health Zones
**Goal**: Operators and agents have visibility into context window utilization with automatic protective actions
**Depends on**: Phase 21 (logger consistency for alerts)
**Requirements**: CTXH-01, CTXH-02, CTXH-03, CTXH-04
**Success Criteria** (what must be TRUE):
  1. Agent context fill level is classified into green/yellow/orange/red zones with configurable thresholds
  2. Zone transitions trigger log entries and optional Discord notifications to a configured channel
  3. Entering yellow or higher zone automatically saves a context snapshot to the agent's memory store
  4. Context health zone is visible via IPC status query, CLI agent status, and dashboard (when built)
**Plans**: 2 plans
Plans:
- [x] 24-01-PLAN.md — Zone types, classifier, config schema, heartbeat check upgrade (CTXH-01, CTXH-03)
- [ ] 24-02-PLAN.md — Zone alerts, IPC status, CLI zone column, Discord notifications (CTXH-02, CTXH-04)

### Phase 25: Episode Memory
**Goal**: Agents can record and retrieve significant discrete events as first-class memory objects
**Depends on**: Phase 21 (clean module boundaries)
**Requirements**: EPSD-01, EPSD-02, EPSD-03, EPSD-04
**Success Criteria** (what must be TRUE):
  1. Agents can store episode records with title, summary, importance, tags, and timestamp alongside regular session logs
  2. Episodes appear in semantic search results when relevant queries are made (searched alongside regular memories)
  3. Episodes can be archived on a monthly cycle following the same pattern as the consolidation pipeline
**Plans**: 2 plans
Plans:
- [x] 25-01-PLAN.md — Episode types, schema migration, store, search integration (EPSD-01, EPSD-02, EPSD-03)
- [x] 25-02-PLAN.md — Episode archival pipeline and CLI integration (EPSD-04)

### Phase 26: Discord Delivery Queue
**Goal**: Outbound Discord messages are reliably delivered with retry logic and failure visibility
**Depends on**: Phase 21 (logger consistency for delivery logging)
**Requirements**: DQUE-01, DQUE-02, DQUE-03, DQUE-04
**Success Criteria** (what must be TRUE):
  1. All outbound Discord messages pass through a delivery queue that persists them before attempting delivery
  2. Failed deliveries are retried with exponential backoff up to 3 attempts before being marked as permanently failed
  3. Permanently failed messages are logged to a persistent failed-delivery log with error context and original message content
  4. Delivery queue status (pending count, retry count, failed count) is queryable via IPC and visible in CLI
**Plans**: 2 plans
Plans:
- [ ] 26-01-PLAN.md — Delivery queue types, SQLite persistence, exponential backoff retry (DQUE-01, DQUE-02, DQUE-03)
- [ ] 26-02-PLAN.md — Bridge integration, IPC status method, CLI command (DQUE-01, DQUE-04)

### Phase 27: Subagent Discord Threads
**Goal**: Subagent conversations automatically surface in Discord as dedicated threads with proper identity
**Depends on**: Phase 26 (delivery queue for reliable thread message routing)
**Requirements**: SATH-01, SATH-02, SATH-03, SATH-04
**Success Criteria** (what must be TRUE):
  1. Spawning a subagent automatically creates a Discord thread in the parent agent's bound channel
  2. The subagent session is bound to the thread with its own webhook identity (display name and avatar)
  3. All subagent messages route through the thread, not the parent channel
  4. When the subagent completes, the thread binding is cleaned up while the thread itself remains for history
**Plans**: 2 plans
Plans:
- [ ] 21-01-PLAN.md — Attachment cleanup heartbeat, logger consistency, silent catch fixes (DEBT-01, DEBT-02, DEBT-03)
- [ ] 21-02-PLAN.md — Split session-manager.ts into focused modules (DEBT-04)

### Phase 28: Security & Execution Approval
**Goal**: Agents operate within defined security boundaries with auditable command approval and channel access control
**Depends on**: Phase 23 (config system for allowlist definitions, audit trail pattern)
**Requirements**: EXEC-01, EXEC-02, EXEC-03, EXEC-04, SECR-01, SECR-02, SECR-03
**Success Criteria** (what must be TRUE):
  1. Per-agent command allowlists are configurable in clawcode.yaml with pattern-based matching
  2. Commands not on the allowlist require explicit approval via IPC or Discord reaction before execution
  3. Approval decisions can be persisted as "allow-always" rules for specific command patterns
  4. All approval and denial decisions are recorded in an audit log with timestamp, agent, command, and decision
  5. Per-agent SECURITY.md files define channel ACLs, and messages from unauthorized users are silently ignored with a log entry
**Plans**: 2 plans
Plans:
- [ ] 21-01-PLAN.md — Attachment cleanup heartbeat, logger consistency, silent catch fixes (DEBT-01, DEBT-02, DEBT-03)
- [ ] 21-02-PLAN.md — Split session-manager.ts into focused modules (DEBT-04)

### Phase 29: Agent Bootstrap
**Goal**: New agents get a guided first-run experience that establishes their identity and personality
**Depends on**: Phase 28 (security config patterns established)
**Requirements**: BOOT-01, BOOT-02, BOOT-03
**Success Criteria** (what must be TRUE):
  1. An agent starting without a SOUL.md receives a first-run bootstrap walkthrough
  2. Bootstrap generates SOUL.md and IDENTITY.md from guided prompts covering personality, role, and behavior
  3. Bootstrap runs exactly once per agent (completion flag persisted in agent workspace prevents re-triggering)
**Plans**: 2 plans
Plans:
- [ ] 21-01-PLAN.md — Attachment cleanup heartbeat, logger consistency, silent catch fixes (DEBT-01, DEBT-02, DEBT-03)
- [ ] 21-02-PLAN.md — Split session-manager.ts into focused modules (DEBT-04)

### Phase 30: Web Dashboard
**Goal**: Operators can monitor and control the entire ClawCode system through a web interface
**Depends on**: Phases 24, 25, 26 (needs context health, episodes, delivery queue data to display)
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08
**Success Criteria** (what must be TRUE):
  1. A web server starts on a configurable port and serves a dashboard UI
  2. Dashboard shows real-time agent status including running/stopped/error state, uptime, model, and bound channels
  3. Dashboard displays memory statistics per agent (entry count, tier distribution, last consolidation time)
  4. Dashboard shows scheduled tasks with next run time, last execution status, and error history
  5. Dashboard shows context health zones, delivery queue status, failed message log, and recent Discord message activity per agent
**Plans**: 2 plans
Plans:
- [ ] 21-01-PLAN.md — Attachment cleanup heartbeat, logger consistency, silent catch fixes (DEBT-01, DEBT-02, DEBT-03)
- [ ] 21-02-PLAN.md — Split session-manager.ts into focused modules (DEBT-04)
**UI hint**: yes

## Progress

**Execution Order:** Phases execute in numeric order: 21 through 30.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-5 | v1.0 | - | Complete | 2026-04-09 |
| 6-20 | v1.1 | - | Complete | 2026-04-09 |
| 21. Tech Debt - Code Quality | v1.2 | 0/2 | Complete    | 2026-04-09 |
| 22. Tech Debt - Test & Type Safety | v1.2 | 1/2 | Complete    | 2026-04-09 |
| 23. Config Hot-Reload & Audit Trail | v1.2 | 1/2 | Complete    | 2026-04-09 |
| 24. Context Health Zones | v1.2 | 1/2 | Complete    | 2026-04-09 |
| 25. Episode Memory | v1.2 | 2/2 | Complete    | 2026-04-09 |
| 26. Discord Delivery Queue | v1.2 | 0/2 | Planned     | - |
| 27. Subagent Discord Threads | v1.2 | 0/? | Not started | - |
| 28. Security & Execution Approval | v1.2 | 0/? | Not started | - |
| 29. Agent Bootstrap | v1.2 | 0/? | Not started | - |
| 30. Web Dashboard | v1.2 | 0/? | Not started | - |
