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

### Validated (v1.3)

- Subagent thread skill — skill wrapper for Discord-visible subagent threads — v1.3
- MCP client consumption — per-agent external MCP server config with health checks — v1.3

### Validated (v1.4)

- Global skill install — workspace skills auto-installed to ~/.claude/skills/ at daemon startup — v1.4
- Standalone agent runner — `clawcode run <agent>` starts single agent without daemon — v1.4
- OpenClaw coexistence — token hard-fail, slash command namespace, dashboard non-fatal, env var interpolation — v1.4

### Active

(Requirements defined in REQUIREMENTS.md for v1.5)

## Current Milestone: v1.5 Smart Memory & Model Tiering

**Goal:** Reduce context bloat by loading memory/personality on-demand (Obsidian-style knowledge graph), and default agents to haiku with intelligent escalation to sonnet/opus.

**Target features:**
- On-demand memory loading — agents pull relevant context when needed instead of stuffing everything into the prompt
- Knowledge graph structure — Obsidian-like linked notes with backlinks and semantic connections
- Personality retention — agent identity/soul loaded efficiently without burning context
- Model tiering — haiku as default model for all agents
- Smart escalation — agents detect when a task needs sonnet or opus and upgrade automatically
- Cost optimization — track and minimize token spend across the agent fleet

### Validated (v1.2)

- Subagent spawning auto-creates Discord subthreads with webhook identity — v1.2
- Discord delivery queue with retry and failed message logging — v1.2
- Context health zones (green/yellow/orange/red alerts with auto-snapshot) — v1.2
- Episode-based memory (discrete event records alongside session logs) — v1.2
- Config hot-reload without daemon restart — v1.2
- Web dashboard for system management — v1.2
- Execution approval system (per-agent command allowlists) — v1.2
- Config audit trail (JSONL log of changes) — v1.2
- Agent bootstrap/first-run system — v1.2
- Per-agent SECURITY.md channel ACLs — v1.2
- Tech debt: attachment cleanup, logger consistency, session-manager splitting, test fixes — v1.2

### Out of Scope

- claude-runner bridge — was an OpenClaw workaround, not needed here
- Gateway/routing layer — Claude Code processes handle Discord directly via the existing plugin
- WhatsApp/Telegram/other channel support — Discord only for now
- Custom model providers (Ollama, OpenRouter, etc.) — using Claude Code's native model selection
- Voice/TTS integration — not in scope
- Synchronous agent-to-agent RPC — async inbox pattern is simpler and more reliable
- Shared global memory — violates workspace isolation; per-agent memory with explicit sharing via admin
- Visual UI for config/management — YAML config is sufficient; UI deferred

## Current State

**Latest shipped milestone:** v1.4 Agent Runtime (shipped 2026-04-10)

v1.0-v1.4 delivered 35 phases across 5 milestones: core multi-agent system, advanced intelligence, production hardening, agent integrations, and agent runtime.

**Current milestone:** v1.5 Smart Memory & Model Tiering — Phase 39 complete (Model Tiering: haiku default, fork-based escalation, opus advisor, /model command)

## Context

ClawCode is a ground-up reimplementation of OpenClaw's multi-agent capabilities directly within Claude Code. Shipped v1.0-v1.4 with 35 phases across 5 milestones, covering 150+ TypeScript files.

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
- ~~DATT-06: No periodic cleanup for downloaded attachment temp files~~ — resolved (heartbeat check exists at src/heartbeat/checks/attachment-cleanup.ts)
- ~~Some test fixtures have stale type definitions~~ — resolved (260409-whx: fixed all 23 files, zero tsc errors)
- 12 of 15 v1.1 phases missing formal VERIFICATION.md artifacts (docs only)
- Phases 14-20 requirement IDs not tracked in REQUIREMENTS.md (docs only)

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
*Last updated: 2026-04-10 after Phase 39 completion*
