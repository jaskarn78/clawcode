# ClawCode

## What This Is

A multi-agent orchestration system built natively on Claude Code that runs multiple persistent AI agents, each with their own identity, workspace, Discord channel, memory, and skills. It replaces OpenClaw's gateway architecture with direct Claude Code processes — no middleman, no bridge workarounds. Each agent is a full Claude Code session bound to a Discord channel, managed by a central agent manager.

## Core Value

Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace — communicating naturally through Discord channels without manual orchestration overhead.

## Requirements

### Validated

- Central config system defining all agents, their workspaces, channels, models, skills — Validated in Phase 1
- Per-agent workspace directories with SOUL.md, IDENTITY.md, and agent-specific config — Validated in Phase 1
- Agent Manager that can start/stop/restart individual agents and boot all from config — Validated in Phase 2
- Discord channel routing — each agent bound to specific channel(s), messages routed accordingly — Validated in Phase 3
- Centralized rate limiter prevents exceeding Discord's per-token rate limits across all agents — Validated in Phase 3
- Intelligent memory system — structured markdown + SQLite semantic search, per-agent — Validated in Phase 4
- Auto-compaction at configurable context fill threshold — Validated in Phase 4

### Active
- [ ] Memory auto-consolidation — daily logs summarized into weekly/monthly digests, raw archived
- [ ] Memory relevance decay — unaccessed memories lose priority over time
- [ ] Memory deduplication — repeated facts merged into single authoritative entries
- [ ] Tiered memory storage — hot (active context), warm (searchable), cold (archived)
- [ ] Memory flush to daily markdown logs with context snapshots
- [ ] Extensible heartbeat framework — periodic check system, empty initially, add checks later
- [ ] Cron/scheduler — run tasks on schedule within persistent agent sessions
- [ ] Skills registry — extend Claude Code's skill system with better discovery and per-agent assignment
- [ ] Subagent spawning via Claude Code's native Agent tool with model selection (sonnet/opus)
- [ ] Cross-agent communication — agents in same workspace can message each other
- [ ] Admin agent with access to all other agents across workspaces
- [ ] Central config system defining all agents, their workspaces, channels, models, skills

### Out of Scope

- claude-runner bridge — was an OpenClaw workaround, not needed here
- Gateway/routing layer — Claude Code processes handle Discord directly via the existing plugin
- WhatsApp/Telegram/other channel support — Discord only for v1
- Custom model providers (Ollama, OpenRouter, etc.) — using Claude Code's native model selection
- Voice/TTS integration — not in scope for v1

## Context

This project is a ground-up reimplementation of OpenClaw's multi-agent capabilities directly within Claude Code. The user currently runs OpenClaw (v2026.4.5) which acts as a gateway connecting 22+ messaging channels to 14 named AI agents. The key insight is that Claude Code already has most of the primitives needed (agents, MCP servers, Discord plugin, memory files, skills) — what's missing is the orchestration layer that ties them together into a cohesive multi-agent system.

The existing OpenClaw installation at `~/.openclaw/` serves as the reference implementation. Key patterns to carry forward:
- Workspace isolation (per-agent directories with identity/personality files)
- SQLite-backed memory with semantic search
- Heartbeat-driven context monitoring and auto-compaction
- Cron scheduling within persistent sessions
- Thread-to-agent binding in Discord

The Discord plugin (`plugin:discord:discord`) is already functional — this project builds on top of it rather than replacing it.

## Constraints

- **Runtime**: Claude Code CLI sessions — each agent is a persistent Claude Code process
- **Discord**: Uses existing Claude Code Discord plugin for channel communication
- **Models**: Limited to Claude model family (sonnet, opus, haiku) via Claude Code's native model selection
- **Memory search**: Need to evaluate embedding providers for semantic search (could use Claude itself, or a lightweight local solution)
- **Concurrency**: Multiple Claude Code processes running simultaneously — need to manage system resources

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| No gateway layer | Claude Code processes talk directly to Discord via plugin — simpler architecture | -- Pending |
| SQLite + markdown for memory | Proven pattern from OpenClaw, SQLite for search, markdown for human readability | -- Pending |
| Per-agent Claude Code processes | True isolation, each agent has full Claude Code capabilities | -- Pending |
| Manager process for orchestration | Central control without coupling agents together | -- Pending |
| Admin agent pattern | One privileged agent can reach all others for cross-workspace coordination | -- Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-09 after Phase 4 completion*
