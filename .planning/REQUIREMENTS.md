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

- [ ] **SKED-01**: User can define cron-like scheduled tasks per agent in clawcode.yaml
- [ ] **SKED-02**: Scheduled tasks execute within the agent's persistent session at the defined interval
- [ ] **SKED-03**: Scheduler status queryable via IPC and CLI (`clawcode schedules`)

### Skills Registry

- [ ] **SKIL-01**: Central skills registry cataloging all available skills with metadata (name, description, version)
- [ ] **SKIL-02**: Per-agent skill assignment configurable in clawcode.yaml
- [ ] **SKIL-03**: Agents can discover and list their assigned skills
- [ ] **SKIL-04**: Skills are directories with SKILL.md -- existing Claude Code skill format

### Subagent Spawning

- [ ] **SAGN-01**: Running agents can spawn subagents via Claude Code's native Agent tool
- [ ] **SAGN-02**: Subagent model selection (sonnet/opus/haiku) configurable per spawn

### Cross-Agent Communication

- [ ] **XAGT-01**: Agents in the same workspace can send async messages to each other via file-based inbox
- [ ] **XAGT-02**: Messages checked on heartbeat interval and delivered to agent session
- [ ] **XAGT-03**: Admin agent has read access to all other agent workspaces across the system
- [ ] **XAGT-04**: Admin agent can trigger restarts and coordinate cross-agent tasks via IPC

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
| SKED-01 | Phase 9 | Pending |
| SKED-02 | Phase 9 | Pending |
| SKED-03 | Phase 9 | Pending |
| SKIL-01 | Phase 10 | Pending |
| SKIL-02 | Phase 10 | Pending |
| SKIL-03 | Phase 10 | Pending |
| SKIL-04 | Phase 10 | Pending |
| SAGN-01 | Phase 11 | Pending |
| SAGN-02 | Phase 11 | Pending |
| XAGT-01 | Phase 11 | Pending |
| XAGT-02 | Phase 11 | Pending |
| XAGT-03 | Phase 11 | Pending |
| XAGT-04 | Phase 11 | Pending |

**Coverage:**
- v1.1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-04-09*
*Last updated: 2026-04-09 after v1.1 roadmap creation*
