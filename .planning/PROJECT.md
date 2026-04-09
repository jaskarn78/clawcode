# ClawCode

## What This Is

A multi-agent orchestration system built natively on Claude Code that runs multiple persistent AI agents, each with their own identity, workspace, Discord channel, memory, and skills. Each agent is a full Claude Code session bound to a Discord channel, managed by a central daemon with advanced memory management, task scheduling, inter-agent collaboration, and Discord-native features.

## Core Value

Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace — communicating naturally through Discord channels without manual orchestration overhead.

## Requirements

### Validated

- Central config system defining all agents, their workspaces, channels, models, skills — v1.0
- Per-agent workspace directories with SOUL.md, IDENTITY.md, and agent-specific config — v1.0
- Agent Manager that can start/stop/restart individual agents and boot all from config — v1.0
- Discord channel routing — each agent bound to specific channel(s), messages routed accordingly — v1.0
- Centralized rate limiter prevents exceeding Discord's per-token rate limits across all agents — v1.0
- Intelligent memory system — structured markdown + SQLite semantic search, per-agent — v1.0
- Auto-compaction at configurable context fill threshold — v1.0
- Extensible heartbeat framework — periodic check system, context fill monitoring — v1.0
- Memory auto-consolidation — daily logs summarized into weekly/monthly digests, raw archived — v1.1
- Memory relevance decay — unaccessed memories lose priority over time — v1.1
- Memory deduplication — repeated facts merged into single authoritative entries — v1.1
- Tiered memory storage — hot (active context), warm (searchable), cold (archived) — v1.1
- Cron/scheduler — run tasks on schedule within persistent agent sessions — v1.1
- Skills registry — extend Claude Code's skill system with better discovery and per-agent assignment — v1.1
- Subagent spawning via Claude Code's native Agent tool with model selection — v1.1
- Cross-agent communication — agents in same workspace can message each other — v1.1
- Admin agent with access to all other agents across workspaces — v1.1
- Discord slash commands — auto-registered, routed to agents, configurable per-agent — v1.1
- Discord attachments — download, multimodal image support, file sending — v1.1
- Discord thread bindings — auto-session per thread, idle cleanup — v1.1
- Webhook agent identities — per-agent display name and avatar via webhooks — v1.1
- Session forking — branch agent context into independent sessions — v1.1
- Context summary on resume — structured summary injection on session restart — v1.1
- MCP bridge — expose ClawCode tools to external Claude Code sessions — v1.1
- Discord reaction handling — forward emoji reactions to bound agents — v1.1
- Memory search CLI — semantic search and browsing of agent memory stores — v1.1

### Active

- [ ] Subagent spawning auto-creates Discord subthreads with webhook identity
- [ ] Discord delivery queue with retry and failed message logging
- [ ] Context health zones (green/yellow/orange/red alerts with auto-snapshot)
- [ ] Episode-based memory (discrete event records alongside session logs)
- [ ] Config hot-reload without daemon restart
- [ ] Web dashboard for system management (agents, memory, schedules, health, config)
- [ ] Execution approval system (per-agent command allowlists)
- [ ] Config audit trail (JSONL log of changes)
- [ ] Agent bootstrap/first-run BOOTSTRAP.md system
- [ ] Per-agent SECURITY.md channel ACLs
- [ ] Tech debt: attachment cleanup, logger consistency, session-manager splitting, test fixes

### Out of Scope

- claude-runner bridge — was an OpenClaw workaround, not needed here
- Gateway/routing layer — Claude Code processes handle Discord directly via the existing plugin
- WhatsApp/Telegram/other channel support — Discord only for now
- Custom model providers (Ollama, OpenRouter, etc.) — using Claude Code's native model selection
- Voice/TTS integration — not in scope
- Synchronous agent-to-agent RPC — async inbox pattern is simpler and more reliable
- Shared global memory — violates workspace isolation; per-agent memory with explicit sharing via admin
- Visual UI for config/management — YAML config is sufficient; UI deferred

## Current Milestone: v1.2 Production Hardening & Platform Parity

**Goal:** Resolve tech debt, achieve OpenClaw feature parity on key platform capabilities, add subagent-to-Discord-thread spawning, and build a web dashboard.

**Target features:**
- Tech debt cleanup (attachment cleanup, logger consistency, session-manager splitting, test fixtures, CLI tests, SDK v2 types)
- Subagent spawning auto-creates Discord subthreads with webhook identity
- Discord delivery queue with retry and failed message logging
- Context health zones (green/yellow/orange/red alerts with auto-snapshot)
- Episode-based memory (discrete event records alongside session logs)
- Config hot-reload without daemon restart
- Web dashboard (agent status, memory stats, schedules, health monitoring, config management)
- Execution approval system (per-agent command allowlists)
- Config audit trail (JSONL log of changes)
- Agent bootstrap/first-run BOOTSTRAP.md system
- Per-agent SECURITY.md channel ACLs

## Context

ClawCode is a ground-up reimplementation of OpenClaw's multi-agent capabilities directly within Claude Code. Shipped v1.0 (core infrastructure) and v1.1 (advanced intelligence) with 20 phases, 40+ plans, covering 136 TypeScript files and ~20,700 LOC.

**Tech stack:** TypeScript, Node.js 22 LTS, better-sqlite3, sqlite-vec, @huggingface/transformers, croner, execa, discord.js 14, zod 4, pino, @modelcontextprotocol/sdk.

**Current state:** Fully functional multi-agent system with:
- Self-maintaining memory (consolidation, decay, dedup, tiered hot/warm/cold)
- Task scheduling (croner-based cron within persistent sessions)
- Skills registry with per-agent assignment
- Inter-agent collaboration (async messaging, subagent spawning, admin oversight)
- Rich Discord integration (slash commands, attachments, threads, reactions, webhooks)
- Session management (forking, context summaries on resume)
- MCP bridge for external tool access
- CLI tooling (status, schedules, skills, threads, webhooks, fork, memory search)

**Known tech debt:**
- DATT-06: No periodic cleanup for downloaded attachment temp files
- Some test fixtures have stale type definitions (missing reactions/tiers fields)
- 12 of 15 v1.1 phases missing formal VERIFICATION.md artifacts
- Phases 14-20 requirement IDs not tracked in REQUIREMENTS.md

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| No gateway layer | Claude Code processes talk directly to Discord via plugin — simpler architecture | Good — eliminates entire middleware layer |
| SQLite + markdown for memory | Proven pattern from OpenClaw, SQLite for search, markdown for human readability | Good — sqlite-vec handles KNN search efficiently |
| Per-agent Claude Code processes | True isolation, each agent has full Claude Code capabilities | Good — crash isolation, independent context |
| Manager process for orchestration | Central control without coupling agents together | Good — daemon manages all lifecycle |
| Admin agent pattern | One privileged agent can reach all others for cross-workspace coordination | Good — enables system-level tasks |
| Local embeddings via @huggingface/transformers | Zero cost, zero network dependency, 384-dim is sufficient for memory search | Good — ~50ms per embedding, no API keys |
| File-based inbox for cross-agent messaging | Simple, reliable, works with heartbeat pattern | Good — no message broker needed |
| Webhook-based agent identities | Per-agent display names/avatars in Discord without sharing bot token | Good — clean separation per agent |
| Cold archive as markdown + base64 embedding | Human-readable archives that can be re-warmed without re-embedding from scratch | Good — lossless cold storage |

## Constraints

- **Runtime**: Claude Code CLI sessions — each agent is a persistent Claude Code process
- **Discord**: Uses existing Claude Code Discord plugin for channel communication
- **Models**: Limited to Claude model family (sonnet, opus, haiku) via Claude Code's native model selection
- **Embeddings**: Local ONNX inference via @huggingface/transformers (all-MiniLM-L6-v2, 384-dim)
- **Concurrency**: Multiple Claude Code processes running simultaneously — managed by daemon

---
*Last updated: 2026-04-09 after v1.2 milestone started*
