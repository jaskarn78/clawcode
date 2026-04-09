# Roadmap: ClawCode

## Overview

ClawCode delivers a multi-agent orchestration system in five phases, building from configuration and workspace scaffolding through agent process management, Discord integration, persistent memory, and health monitoring. Each phase delivers a complete, verifiable capability layer. By Phase 3, agents are live in Discord. By Phase 5, the system is self-monitoring and production-ready.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Workspaces** - Central config and per-agent workspace scaffolding with identity files
- [ ] **Phase 2: Agent Lifecycle** - Start, stop, restart, boot-all, crash recovery, and process tracking
- [ ] **Phase 3: Discord Integration** - Channel-to-agent routing with rate limiting
- [ ] **Phase 4: Memory System** - Per-agent SQLite memory, session logs, semantic search, and auto-compaction
- [ ] **Phase 5: Heartbeat & Monitoring** - Extensible health check framework with context fill monitoring

## Phase Details

### Phase 1: Foundation & Workspaces
**Goal**: User can define agents in a central config and each agent gets an isolated workspace with identity files
**Depends on**: Nothing (first phase)
**Requirements**: MGMT-01, WKSP-01, WKSP-02, WKSP-03, WKSP-04
**Success Criteria** (what must be TRUE):
  1. User can write a YAML config file defining agents with name, workspace path, channel bindings, model, and skills
  2. Running a setup command creates isolated workspace directories for each configured agent
  3. Each agent workspace contains a SOUL.md and IDENTITY.md populated from config or defaults
  4. Agent workspaces are fully isolated -- no shared state, files, or database connections between them
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Project scaffolding, config schema, loader with defaults merging
- [x] 01-02-PLAN.md — Workspace creation, identity files, CLI entry point

### Phase 2: Agent Lifecycle
**Goal**: User can manage agent processes individually and collectively, with automatic crash recovery
**Depends on**: Phase 1
**Requirements**: MGMT-02, MGMT-03, MGMT-04, MGMT-05, MGMT-06, MGMT-07, MGMT-08
**Success Criteria** (what must be TRUE):
  1. User can start, stop, and restart individual agents by name from the CLI
  2. User can boot all configured agents with a single command and see them running
  3. When an agent process crashes, the manager detects it and restarts it with exponential backoff
  4. A PID registry tracks all running agent processes and is queryable
  5. On manager shutdown, all agent processes terminate cleanly with no zombies left behind
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Foundation types, registry, backoff, session adapter, IPC protocol
- [x] 02-02-PLAN.md — Session manager, daemon, IPC server/client
- [x] 02-03-PLAN.md — CLI commands (start, stop, restart, start-all, status) and wiring

### Phase 3: Discord Integration
**Goal**: Messages in Discord channels route to the correct agent and responses come back
**Depends on**: Phase 2
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04
**Success Criteria** (what must be TRUE):
  1. Config maps Discord channel IDs to agents, and the system enforces these bindings at startup
  2. A message sent in a bound Discord channel is received and processed by the correct agent
  3. The agent's response appears in the same Discord channel the message came from
  4. Under sustained message volume from multiple channels, no agent exceeds Discord rate limits
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md — Discord types, routing table, and rate limiter modules with tests
- [x] 03-02-PLAN.md — Daemon/session integration, IPC extension, CLI routes command

### Phase 4: Memory System
**Goal**: Agents have persistent memory that survives restarts, supports search, and manages context window pressure
**Depends on**: Phase 2
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06
**Success Criteria** (what must be TRUE):
  1. Each agent stores and retrieves memories from its own SQLite database, isolated from other agents
  2. Agent conversations are automatically flushed to daily markdown session logs
  3. When context fill exceeds the configured threshold, auto-compaction triggers after flushing a context snapshot
  4. User can semantically search an agent's memories and get relevant results ranked by similarity
  5. Memory entries carry metadata (timestamp, source, access count, importance) that is queryable
**Plans**: 2 plans

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: Heartbeat & Monitoring
**Goal**: The system continuously monitors agent health and catches problems before they cause failures
**Depends on**: Phase 2, Phase 4
**Requirements**: HRTB-01, HRTB-02, HRTB-03
**Success Criteria** (what must be TRUE):
  1. A heartbeat framework runs checks on each agent at a configurable interval
  2. Context fill percentage is reported as a built-in heartbeat check and triggers warnings at threshold
  3. New heartbeat checks can be added by dropping a check module into the plugin directory without modifying core code
**Plans**: 2 plans

Plans:
- [ ] 05-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Workspaces | 2/2 | Complete | 2026-04-08 |
| 2. Agent Lifecycle | 0/3 | Planning complete | - |
| 3. Discord Integration | 0/2 | Not started | - |
| 4. Memory System | 0/2 | Not started | - |
| 5. Heartbeat & Monitoring | 0/1 | Not started | - |
