# Requirements: ClawCode

**Defined:** 2026-04-08
**Core Value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace — communicating naturally through Discord channels without manual orchestration overhead.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Agent Manager

- [x] **MGMT-01**: Central YAML config file defining all agents, their workspaces, channels, models, and skills
- [x] **MGMT-02**: User can start an individual agent by name via CLI command
- [x] **MGMT-03**: User can stop an individual agent by name via CLI command
- [x] **MGMT-04**: User can restart an individual agent by name via CLI command
- [x] **MGMT-05**: User can boot all configured agents with a single command
- [x] **MGMT-06**: Manager detects agent process crashes and auto-restarts with exponential backoff
- [x] **MGMT-07**: Manager maintains a PID registry tracking all running agent processes
- [x] **MGMT-08**: Manager prevents and cleans up zombie processes on shutdown

### Workspace & Identity

- [x] **WKSP-01**: Each agent gets its own isolated workspace directory on creation
- [x] **WKSP-02**: Each agent workspace contains a SOUL.md file defining behavioral philosophy
- [x] **WKSP-03**: Each agent workspace contains an IDENTITY.md file defining name, avatar, and tone
- [x] **WKSP-04**: Agent workspaces are isolated — no cross-contamination of state or memory between agents

### Discord Integration

- [ ] **DISC-01**: Config maps Discord channel IDs to agent IDs for message routing
- [ ] **DISC-02**: Incoming Discord messages route to the correct agent based on channel binding
- [ ] **DISC-03**: Agent responses are delivered back to the originating Discord channel
- [ ] **DISC-04**: Centralized rate limiter prevents exceeding Discord's per-token rate limits across all agents

### Memory

- [ ] **MEM-01**: Each agent has its own SQLite database for persistent memory storage
- [ ] **MEM-02**: Agent conversations are flushed to daily markdown session logs
- [ ] **MEM-03**: Auto-compaction triggers at a configurable context fill threshold
- [ ] **MEM-04**: Memory flush occurs before compaction to preserve context snapshot
- [ ] **MEM-05**: Semantic search across agent memories via sqlite-vec and local embeddings
- [ ] **MEM-06**: Memory entries include metadata (timestamp, source, access count, importance)

### Heartbeat

- [ ] **HRTB-01**: Extensible heartbeat framework that runs checks on a configurable interval
- [ ] **HRTB-02**: Context fill percentage monitoring as the first built-in heartbeat check
- [ ] **HRTB-03**: Heartbeat checks are pluggable — new checks can be added without modifying core code

## v1.x Requirements

Deferred to after core is stable. Tracked but not in current roadmap.

### Advanced Memory

- **AMEM-01**: Auto-consolidation of daily logs into weekly digests
- **AMEM-02**: Auto-consolidation of weekly digests into monthly digests
- **AMEM-03**: Relevance decay — unaccessed memories lose priority score over time
- **AMEM-04**: Deduplication — semantically similar memories merged into single authoritative entries
- **AMEM-05**: Tiered storage — hot (active context), warm (searchable SQLite), cold (archived markdown)

### Scheduling & Skills

- **SKED-01**: Cron/scheduler for periodic tasks within persistent agent sessions
- **SKIL-01**: Skills registry cataloging available skills with metadata
- **SKIL-02**: Per-agent skill assignment configurable in central config
- **SKIL-03**: Skill discovery — agents can browse and search available skills
- **SAGN-01**: Subagent spawning with explicit model selection (sonnet/opus/haiku)

### Multi-Agent

- **XAGT-01**: Cross-agent async communication via file-based inbox system
- **XAGT-02**: Agents in same workspace can message each other directly
- **ADMN-01**: Admin agent with read access to all other agent workspaces
- **ADMN-02**: Admin agent can trigger restarts and coordinate cross-agent tasks

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-provider model support (Ollama, OpenRouter) | ClawCode's value is native Claude Code integration; supporting other providers re-introduces gateway complexity |
| Real-time streaming between agents | Creates tight coupling; async message passing is simpler and more reliable |
| WhatsApp/Telegram/Slack support | Discord-only for v1; architecture should be channel-agnostic internally for future expansion |
| Visual workflow builder / no-code UI | Premature abstraction; config schema still evolving. YAML config is sufficient |
| Agent-to-agent synchronous RPC | Synchronous calls between LLM processes are inherently unreliable; async inbox pattern instead |
| Shared global memory | Violates workspace isolation; creates race conditions. Per-agent memory with explicit sharing via admin agent |
| Voice/TTS integration | Orthogonal to core orchestration; can be added as a skill later |
| Auto-scaling / dynamic agent spawning | Over-engineering for target scale (14-30 agents); fixed pool from config is sufficient |
| claude-runner bridge | OpenClaw workaround; not needed with native Claude Code processes |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MGMT-01 | Phase 1 | Complete |
| MGMT-02 | Phase 2 | Complete |
| MGMT-03 | Phase 2 | Complete |
| MGMT-04 | Phase 2 | Complete |
| MGMT-05 | Phase 2 | Complete |
| MGMT-06 | Phase 2 | Complete |
| MGMT-07 | Phase 2 | Complete |
| MGMT-08 | Phase 2 | Complete |
| WKSP-01 | Phase 1 | Complete |
| WKSP-02 | Phase 1 | Complete |
| WKSP-03 | Phase 1 | Complete |
| WKSP-04 | Phase 1 | Complete |
| DISC-01 | Phase 3 | Pending |
| DISC-02 | Phase 3 | Pending |
| DISC-03 | Phase 3 | Pending |
| DISC-04 | Phase 3 | Pending |
| MEM-01 | Phase 4 | Pending |
| MEM-02 | Phase 4 | Pending |
| MEM-03 | Phase 4 | Pending |
| MEM-04 | Phase 4 | Pending |
| MEM-05 | Phase 4 | Pending |
| MEM-06 | Phase 4 | Pending |
| HRTB-01 | Phase 5 | Pending |
| HRTB-02 | Phase 5 | Pending |
| HRTB-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-04-08*
*Last updated: 2026-04-08 after roadmap creation*
