# Requirements: ClawCode v1.2

**Defined:** 2026-04-09
**Core Value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.

## v1.2 Requirements

Requirements for v1.2 milestone. Each maps to roadmap phases.

### Tech Debt

- [ ] **DEBT-01**: Attachment temp file cleanup runs periodically via heartbeat check (cleanupAttachments wired)
- [ ] **DEBT-02**: All console.error/console.log calls replaced with structured pino logger
- [ ] **DEBT-03**: Silent error catches (10+ locations) replaced with proper logging and error propagation
- [ ] **DEBT-04**: session-manager.ts split into focused modules under 400 lines each
- [ ] **DEBT-05**: Test fixtures updated with all required fields (reactions, tiers) — no more `as unknown as` casts
- [ ] **DEBT-06**: CLI commands have unit tests (schedules, skills, send, threads, webhooks, fork, memory, mcp, usage)
- [ ] **DEBT-07**: SDK v2 unstable API types narrowed from `any` to explicit interfaces with documented migration path

### Subagent Discord Threads

- [ ] **SATH-01**: When an agent spawns a subagent, a Discord thread is automatically created in the agent's bound channel
- [ ] **SATH-02**: The subagent session is bound to the created thread with its own webhook identity
- [ ] **SATH-03**: Subagent messages route through the Discord thread (not the parent channel)
- [ ] **SATH-04**: When the subagent completes, the thread binding is cleaned up (thread remains for history)

### Discord Delivery Queue

- [ ] **DQUE-01**: Outbound Discord messages are enqueued before delivery with retry on failure
- [ ] **DQUE-02**: Failed messages are logged to a persistent failed-delivery log with error context
- [ ] **DQUE-03**: Delivery queue retries failed messages with exponential backoff (max 3 retries)
- [ ] **DQUE-04**: Delivery queue status is queryable via IPC and visible in CLI/dashboard

### Context Health

- [ ] **CTXH-01**: Context fill level is categorized into zones: green (0-50%), yellow (50-70%), orange (70-85%), red (85%+)
- [ ] **CTXH-02**: Zone transitions trigger configurable alerts (logged + optional Discord notification)
- [ ] **CTXH-03**: Entering yellow+ zone automatically saves a context snapshot to agent memory
- [ ] **CTXH-04**: Context health zone is visible in agent status via IPC, CLI, and dashboard

### Episode Memory

- [ ] **EPSD-01**: Agents can store discrete episode records (significant events with metadata) alongside session logs
- [ ] **EPSD-02**: Episodes have structured fields: title, summary, importance, tags, timestamp
- [ ] **EPSD-03**: Episodes are searchable via semantic search alongside regular memories
- [ ] **EPSD-04**: Episodes can be archived monthly (similar to consolidation pipeline pattern)

### Config Hot-Reload

- [ ] **HOTR-01**: Daemon watches clawcode.yaml for changes and applies config updates without restart
- [ ] **HOTR-02**: Hot-reloadable config fields: agent channels, skills, schedules, heartbeat settings
- [ ] **HOTR-03**: Non-reloadable fields (model, workspace) log a warning suggesting restart
- [ ] **HOTR-04**: Config changes are logged to JSONL audit trail with before/after diff

### Execution Approval

- [ ] **EXEC-01**: Per-agent command allowlists configurable in clawcode.yaml (pattern-based)
- [ ] **EXEC-02**: Commands not on allowlist require approval via IPC or Discord reaction
- [ ] **EXEC-03**: Approval decisions can be persisted as "allow-always" for specific command patterns
- [ ] **EXEC-04**: Approval audit log records all approved/denied execution requests

### Agent Bootstrap

- [ ] **BOOT-01**: New agents without a SOUL.md get a first-run bootstrap walkthrough
- [ ] **BOOT-02**: Bootstrap generates SOUL.md, IDENTITY.md from guided prompts
- [ ] **BOOT-03**: Bootstrap is triggered once on first agent start (flag persisted in agent workspace)

### Security & Access Control

- [ ] **SECR-01**: Per-agent SECURITY.md defines channel access control lists (who can message this agent)
- [ ] **SECR-02**: Messages from unauthorized users in bound channels are ignored with a log entry
- [ ] **SECR-03**: Admin agent can update SECURITY.md for any agent via IPC command

### Web Dashboard

- [ ] **DASH-01**: Web server serves a dashboard UI accessible on a configurable port
- [ ] **DASH-02**: Dashboard displays real-time agent status (running/stopped/error, uptime, model, channels)
- [ ] **DASH-03**: Dashboard shows memory statistics per agent (entry count, tier distribution, last consolidation)
- [ ] **DASH-04**: Dashboard shows scheduled tasks with next run time, last status, and error history
- [ ] **DASH-05**: Dashboard shows health monitoring (context fill zones, heartbeat check results, system metrics)
- [ ] **DASH-06**: Dashboard shows recent Discord message activity (last N messages per agent with timestamps)
- [ ] **DASH-07**: Dashboard allows starting/stopping/restarting agents via UI controls
- [ ] **DASH-08**: Dashboard shows delivery queue status and failed message log

## Future Requirements

Deferred to later milestones.

### Multi-Provider LLM Support
- **MLLM-01**: Support multiple LLM providers beyond Claude (OpenAI, Gemini, Ollama)
- **MLLM-02**: Per-agent model provider configuration with fallback chains

### Browser Automation
- **BROW-01**: Chrome CDP integration for web scraping and automation
- **BROW-02**: Per-agent browser profile isolation

### Device Pairing
- **PAIR-01**: Multi-device authentication with EdDSA keypairs
- **PAIR-02**: Scope-based access control per device

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-LLM providers | Claude Code only supports Claude family — by design |
| Browser automation | Complex scope, domain-specific, defer |
| Device pairing | N/A for CLI-based system |
| CRM/database integration | Domain-specific (Finmentum), not platform |
| Nextcloud file sync | Domain-specific, not platform |
| Instagram scraping | Domain-specific workflow, not platform |
| Mobile app | CLI + web dashboard sufficient |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| (populated during roadmap creation) | | |

**Coverage:**
- v1.2 requirements: 43 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 43

---
*Requirements defined: 2026-04-09*
*Last updated: 2026-04-09 after initial definition*
