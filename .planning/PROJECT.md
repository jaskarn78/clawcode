# ClawCode

## What This Is

A multi-agent orchestration system built natively on Claude Code that runs multiple persistent AI agents, each with their own identity, workspace, Discord channel, memory, and skills. Each agent is a full Claude Code session bound to a Discord channel, managed by a central daemon with advanced memory management (knowledge graph, on-demand loading), intelligent model tiering, task scheduling, inter-agent collaboration, and Discord-native features.

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
- Subagent thread skill — skill wrapper for Discord-visible subagent threads — v1.3
- MCP client consumption — per-agent external MCP server config with health checks — v1.3
- Global skill install — workspace skills auto-installed to ~/.claude/skills/ at daemon startup — v1.4
- Standalone agent runner — `clawcode run <agent>` starts single agent without daemon — v1.4
- OpenClaw coexistence — token hard-fail, slash command namespace, dashboard non-fatal, env var interpolation — v1.4
- Knowledge graph — wikilink-based memory linking with backlinks and graph traversal — v1.5
- On-demand memory loading — memory_lookup MCP tool, personality fingerprint, SOUL.md as retrievable memory — v1.5
- Graph intelligence — graph-enriched search with 1-hop neighbors, auto-linker heartbeat — v1.5
- Model tiering — haiku default, fork-based escalation, opus advisor tool, /model command — v1.5
- Cost optimization — per-agent/per-model cost tracking CLI/dashboard, importance scoring, escalation budgets — v1.5
- Context assembly pipeline — per-source token budgets with configurable ceiling — v1.5
- Auto-start agents on daemon boot — no separate IPC start-all call needed — v1.6
- Systemd production integration — correct ExecStart, PATH, EnvironmentFile — v1.6
- Agent-to-agent Discord communication — MCP tool + webhook embeds + bridge routing — v1.6
- Memory auto-linking on save — eager KNN neighbor edges instead of 6h heartbeat — v1.6
- Scheduled memory consolidation — configurable cron via TaskScheduler handler entries — v1.6
- Discord slash commands for control — /clawcode-start, /stop, /restart, /fleet — v1.6
- Webhook auto-provisioning — daemon creates Discord webhooks per agent channel on startup — v1.6
- RAG over documents — text/markdown/PDF ingestion, chunking, KNN search via 4 MCP tools — v1.6
- Phase-level latency instrumentation — per-turn traces with p50/p95/p99 via CLI + dashboard — v1.7
- SLO targets + CI regression gate — documented thresholds, dashboard colors, bench --check-regression — v1.7
- Prompt caching — Anthropic preset+append with two-block context assembly + hot-tier stable_token + per-turn prefix_hash — v1.7
- Context audit + token budget tuning — per-agent audit CLI, per-section budgets, lazy-skill compression, 1500-token resume cap — v1.7
- Streaming + typing indicator — first-token metric, 750ms cadence, ≤500ms typing fire, rate-limit backoff — v1.7
- Tool-call overhead — intra-turn idempotent cache (Turn-scoped, per-skill whitelist), per-tool latency telemetry, ConcurrencyGate foundation — v1.7
- Warm-path optimizations — READ-ONLY SQLite warmup, resident embedding singleton, warm-session reuse, 10s ready-gate — v1.7
- TurnDispatcher foundation — single chokepoint for Discord/scheduler/future-trigger/future-handoff turns with origin-prefixed turnIds and `TurnOrigin` trace metadata (net-zero refactor) — v1.8
- Task Store + State Machine — durable `~/.clawcode/manager/tasks.db` with 15-field task rows, enforced transitions, startup orphan reconciliation, and trigger_state CRUD (LIFE-01/02/04) — v1.8
- ConversationStore schema foundation — per-agent SQLite tables for sessions and turns, JSON provenance fields, `source_turn_ids` lineage column, FTS5 on raw-turn text (CONV-01/02/03) — v1.9
- Capture integration — DiscordBridge auto-persists every turn with instruction-pattern detection flagging high/medium-risk injection attempts (SEC-02) — v1.9
- Session-boundary summarization — SessionSummarizer pipeline compresses ended/crashed sessions via Haiku with 10s timeout + deterministic fallback; writes standard MemoryEntry with `source="conversation"` and `["session-summary", "session:{id}"]` tags (SESS-01/04) — v1.9
- Resume auto-injection — `assembleConversationBrief` helper + dedicated `conversation_context` mutable-suffix section (default 3 recent summaries, 4h gap threshold, 2000-token budget) threaded through `SessionManager.configDeps()` into `buildSessionConfig`; agents auto-receive a structured context brief of prior sessions on restart, with gap-skip short-circuit for brief restarts (SESS-02/03) — v1.9
- Conversation search + deep retrieval — FTS5 virtual table on raw turns + `ConversationStore.searchTurns` with BM25 ranking and escape-safe queries; `searchByScope` pure DI orchestrator merging semantic (session-summary MemoryEntries) + full-text (raw turn) results with decay weighting (tunable half-life), session-summary-prefers-raw-turn dedup, and offset pagination at 10/page hard cap; `memory_lookup` MCP tool extended with backward-compatible `scope` + `page` parameters; `isTrustedChannel` provenance correctly threaded from DiscordBridge → CaptureInput → ConversationStore so default FTS5 trust filter returns real results in production (CONV-01/SEC-01/RETR-01/02/03) — v1.9

- Shared-workspace runtime support — optional `memoryPath` agent field enables multiple agents (finmentum family) to share one basePath while keeping isolated `memories.db`/inbox/heartbeat/session-state; Zod conflict guard + hot-reload classification — v2.1
- Migration CLI read-side — `clawcode migrate openclaw list` + `plan` with deterministic per-agent diff, zero-write enforcement, JSONL ledger for fleet status — v2.1
- Pre-flight guards — 4 safety invariants (daemon running, secret-shape detection, Discord channel collision, source-tree read-only) refuse `apply` before any write; runtime fs-guard + scanSecrets utility reusable downstream — v2.1
- Config mapping + atomic YAML writer — `soulFile`/`identityFile` file-pointer fields, model-id mapping with `--model-map` override, MCP auto-injection (clawcode + 1password), Document-AST comment preservation with atomic temp+rename — v2.1
- Workspace migration — `fs.cp` with verbatim symlinks + filter (skip venvs) + hash-witness; finmentum 5-agent shared-basePath routing; `.git` preserved; OpenClaw sessions archived read-only under `<workspace>/archive/openclaw-sessions/` with zero ConversationStore replay — v2.1
- Memory translation + re-embedding — workspace markdown (disk-as-truth) parsed by H2, inserted via `MemoryStore.insert()` with `origin_id UNIQUE` idempotency, fresh 384-dim MiniLM embeddings, `.learnings/*.md` tagged `"learning"` — v2.1
- Verify + rollback + resume + fork regression — `verify` with 4 pass/fail checks, per-agent atomic `rollback` with source-tree invariant, idempotent resume via ledger, v1.5 fork-to-Opus regression across Haiku/Sonnet/MiniMax/Gemini primaries with cost visibility — v2.1
- Pilot + cutover + completion — recommended-pilot highlighting in `plan` output, per-agent `cutover` removes OpenClaw Discord bindings via fs-guard allowlist, `complete` generates `.planning/milestones/v2.1-migration-report.md` with cross-agent invariant assertions — v2.1

### Active

## Current Milestone: v2.2 OpenClaw Parity & Polish

**Goal:** Close remaining parity gaps between OpenClaw and ClawCode so agents operate at feature parity for day-to-day use after the v2.1 migration.

**Target features:**
- Skills library migration — audit and port applicable domain skills from `~/.openclaw/skills/` (cognitive-memory, finmentum-crm, power-apps-builder, remotion, tuya-ac, workspace-janitor, self-improving-agent, ...) into ClawCode's skill system with per-agent linker verification
- Extended-thinking effort mapping — `reasoning_effort` level → `MAX_THINKING_TOKENS` control, mirroring OpenClaw's `--effort` flag (source: `openclaw-claude-bridge/src/claude.js`)
- Dual Discord model picker — keep OpenClaw's existing picker alive but make it read from the bound agent's `clawcode.yaml` allowed-model list, AND build a native `/clawcode-model` Discord slash command; per-agent allowed-model list is the source of truth
- Native Claude Code slash commands in Discord — register the full native CC command set (e.g., `/clear`, `/compact`, `/model`, `/memory`, `/agents`, `/mcp`, `/cost`, `/todos`, `/init`, `/permissions`, `/review`, `/security-review`, and whatever else the CC CLI exposes) as per-agent Discord slash commands that route to the bound agent's Claude Code session

### Out of Scope

- claude-runner bridge — was an OpenClaw workaround, not needed here
- Gateway/routing layer — Claude Code processes handle Discord directly via the existing plugin
- WhatsApp/Telegram/other channel support — Discord only for now
- Custom model providers (Ollama, OpenRouter, etc.) — using Claude Code's native model selection
- Voice/TTS integration — not in scope
- Synchronous agent-to-agent RPC — async inbox pattern is simpler and more reliable
- Shared global memory — violates workspace isolation; per-agent memory with explicit sharing via admin
- Full graph visualization UI — use CLI DOT output + Graphviz instead
- Real-time model switching mid-turn — not possible with Claude Code sessions
- Shared knowledge graph across agents — violates workspace isolation
- Automatic personality evolution — identity drift is a feature-killing bug
- LLM-powered entity/relation extraction — doubles token cost on writes

## Current State

**Latest shipped milestone:** v2.1 OpenClaw Agent Migration (shipped 2026-04-21)

v1.0-v2.1 delivered 83 phases across 12 milestones: core multi-agent system, advanced intelligence, production hardening, agent integrations, agent runtime, smart memory with model tiering, platform operations + RAG, end-to-end performance + latency optimizations, proactive agents with cross-agent handoffs, persistent conversation memory with auto-injection, OpenAI-compatible endpoint + browser/search/image MCPs, and one-shot OpenClaw-to-ClawCode migration toolchain (15-agent fleet port with zero source modification, deterministic dry-run, atomic per-agent apply/verify/rollback, fork-to-Opus preserved).

## Context

ClawCode is a ground-up reimplementation of OpenClaw's multi-agent capabilities directly within Claude Code. Shipped v1.0-v1.7 with 56 phases across 8 milestones, covering 180+ TypeScript files.

**Tech stack:** TypeScript, Node.js 22 LTS, better-sqlite3, sqlite-vec, @huggingface/transformers, croner, execa, discord.js 14, zod 4, pino, @modelcontextprotocol/sdk.

**Current state:** Fully functional multi-agent system with:
- Knowledge graph memory (wikilink edges, backlinks, graph-enriched search, auto-linker)
- On-demand memory loading (memory_lookup MCP tool, personality fingerprint, context assembly pipeline)
- Intelligent model tiering (haiku default, fork-based escalation, opus advisor, cost tracking)
- Self-maintaining memory (consolidation, decay, dedup, tiered hot/warm/cold, importance scoring)
- Task scheduling (croner-based cron within persistent sessions)
- Skills registry with per-agent assignment
- Inter-agent collaboration (async messaging, subagent spawning, admin oversight)
- Rich Discord integration (slash commands, attachments, threads, reactions, webhooks, budget alerts)
- Session management (forking, context summaries on resume, escalation monitoring)
- MCP bridge for external tool access
- CLI tooling (status, schedules, skills, threads, webhooks, fork, memory search, costs)
- Web dashboard with SSE live updates and cost visibility

**Known tech debt:**
- 12 of 15 v1.1 phases missing formal VERIFICATION.md artifacts (docs only)
- cosineSimilarity duplicated in graph-search.ts and similarity.ts
- /model slash command uses indirect claudeCommand routing through agent LLM

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
| Knowledge graph as SQLite adjacency list | Zero new dependencies, standard relational graph modeling, CASCADE cleanup | Good — efficient backlink queries |
| Fork-based model escalation | Stateless harness swapping per managed agents pattern, ephemeral escalated sessions | Good — no permanent model drift |
| Hybrid hot-tier + on-demand loading | Pure on-demand causes confabulation, hybrid keeps critical context in prompt | Good — balanced context efficiency |
| Context assembly pipeline | Per-source token budgets prevent any single source from starving others | Good — deterministic, configurable |

## Constraints

- **Runtime**: Claude Code CLI sessions — each agent is a persistent Claude Code process
- **Discord**: Uses existing Claude Code Discord plugin for channel communication
- **Models**: Limited to Claude model family (sonnet, opus, haiku) via Claude Code's native model selection
- **Embeddings**: Local ONNX inference via @huggingface/transformers (all-MiniLM-L6-v2, 384-dim)
- **Concurrency**: Multiple Claude Code processes running simultaneously — managed by daemon

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-21 — v2.2 OpenClaw Parity & Polish milestone opened*
