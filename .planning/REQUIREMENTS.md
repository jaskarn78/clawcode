# Requirements: ClawCode v1.1

**Defined:** 2026-04-09
**Core Value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.

## v1.1 Requirements

Requirements for v1.1 milestone. Each maps to roadmap phases.

### Advanced Memory

- [x] **AMEM-01**: Daily session logs automatically consolidated into weekly digest summaries
- [x] **AMEM-02**: Weekly digests automatically consolidated into monthly summaries
- [x] **AMEM-03**: Raw daily logs archived after consolidation (preserved but not in active search)
- [x] **AMEM-04**: Unaccessed memories lose relevance score over time based on configurable decay rate
- [x] **AMEM-05**: Memory search results factor in relevance decay (recent/accessed memories rank higher)
- [x] **AMEM-06**: Semantically similar memories automatically merged into single authoritative entry on write
- [x] **AMEM-07**: Deduplication preserves highest importance score and merges metadata
- [x] **AMEM-08**: Tiered storage -- hot memories loaded into active context, warm searchable in SQLite, cold archived to markdown
- [x] **AMEM-09**: Automatic promotion from cold to warm on search hit, warm to hot on repeated access

### Scheduling

- [x] **SKED-01**: User can define cron-like scheduled tasks per agent in clawcode.yaml
- [x] **SKED-02**: Scheduled tasks execute within the agent's persistent session at the defined interval
- [x] **SKED-03**: Scheduler status queryable via IPC and CLI (`clawcode schedules`)

### Skills Registry

- [x] **SKIL-01**: Central skills registry cataloging all available skills with metadata (name, description, version)
- [x] **SKIL-02**: Per-agent skill assignment configurable in clawcode.yaml
- [x] **SKIL-03**: Agents can discover and list their assigned skills
- [x] **SKIL-04**: Skills are directories with SKILL.md -- existing Claude Code skill format

### Subagent Spawning

- [x] **SAGN-01**: Running agents can spawn subagents via Claude Code's native Agent tool
- [x] **SAGN-02**: Subagent model selection (sonnet/opus/haiku) configurable per spawn

### Cross-Agent Communication

- [x] **XAGT-01**: Agents in the same workspace can send async messages to each other via file-based inbox
- [x] **XAGT-02**: Messages checked on heartbeat interval and delivered to agent session
- [x] **XAGT-03**: Admin agent has read access to all other agent workspaces across the system
- [x] **XAGT-04**: Admin agent can trigger restarts and coordinate cross-agent tasks via IPC

### Discord Slash Commands

- [x] **DCMD-01**: Discord slash commands registered with Discord API on daemon startup from config
- [x] **DCMD-02**: Slash commands map to Claude Code skills/commands with argument passthrough
- [x] **DCMD-03**: Command execution routed to the correct agent based on channel binding
- [x] **DCMD-04**: Command responses sent back to Discord channel
- [x] **DCMD-05**: Configurable command mapping in clawcode.yaml per agent

## Out of Scope

| Feature | Reason |
|---------|--------|
| Synchronous agent-to-agent RPC | Async inbox pattern is simpler and more reliable |
| Shared global memory | Violates workspace isolation; per-agent memory with explicit sharing via admin |
| Visual UI for config/management | YAML config is sufficient; UI deferred to v2+ |
| Multi-platform support (Slack, Telegram) | Discord-only; channel-agnostic architecture for future |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AMEM-01 | Phase 6 | Complete |
| AMEM-02 | Phase 6 | Complete |
| AMEM-03 | Phase 6 | Complete |
| AMEM-04 | Phase 7 | Complete |
| AMEM-05 | Phase 7 | Complete |
| AMEM-06 | Phase 7 | Complete |
| AMEM-07 | Phase 7 | Complete |
| AMEM-08 | Phase 8 | Complete |
| AMEM-09 | Phase 8 | Complete |
| SKED-01 | Phase 9 | Complete |
| SKED-02 | Phase 9 | Complete |
| SKED-03 | Phase 9 | Complete |
| SKIL-01 | Phase 10 | Complete |
| SKIL-02 | Phase 10 | Complete |
| SKIL-03 | Phase 10 | Complete |
| SKIL-04 | Phase 10 | Complete |
| SAGN-01 | Phase 11 | Complete |
| SAGN-02 | Phase 11 | Complete |
| XAGT-01 | Phase 11 | Complete |
| XAGT-02 | Phase 11 | Complete |
| XAGT-03 | Phase 11 | Complete |
| XAGT-04 | Phase 11 | Complete |
| DCMD-01 | Phase 12 | Planned |
| DCMD-02 | Phase 12 | Planned |
| DCMD-03 | Phase 12 | Planned |
| DCMD-04 | Phase 12 | Planned |
| DCMD-05 | Phase 12 | Planned |

**Coverage:**
- v1.1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-04-09*
*Last updated: 2026-04-08 after Phase 12 planning*
