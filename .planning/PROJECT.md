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
- Extended-thinking effort mapping — `/clawcode-effort <level>` observably controls SDK `Query.setMaxThinkingTokens()`; 7-level schema (off/low/medium/high/xhigh/max/auto); runtime persistence via `effort-state.json` surviving daemon restart; fork quarantine prevents cost-spike from parent runtime override bleeding into fork config; per-skill SKILL.md `effort:` frontmatter override with try/finally revert at turn boundary — v2.2
- Skills library migration — `clawcode migrate openclaw skills {plan,apply,verify}` CLI with secret-scan hard gate (refuses finmentum-crm until MySQL credentials are scrubbed), JSONL ledger-driven idempotency, per-agent linker verification, scope-tag routing (finmentum/personal/fleet), `.learnings` dedup via origin_id, atomic migration report at `.planning/milestones/v2.2-skills-migration-report.md` — v2.2
- MCP tool awareness & reliability — JSON-RPC `initialize` readiness gate (mandatory vs optional classification) prevents agents reaching `status: ready` with misconfigured MCP servers; verbatim JSON-RPC error pass-through (no more phantom "1Password isn't logged in" messages); live tool-status table in cached system prompt prefix; `/clawcode-tools` Discord slash + `clawcode mcp-status` CLI showing per-agent server status — v2.2
- Dual Discord model picker (core) — `/clawcode-model` native `StringSelectMenuBuilder` picker (no-arg) + direct IPC dispatch (arg) replacing LLM-prompt routing; `allowedModels` per-agent allowlist schema; `ModelNotAllowedError` typed error propagated via `IpcError.data`; atomic YAML persistence via `updateAgentModel` (Document-AST, comment-preserving); cache-invalidation `ButtonBuilder` confirmation for mid-conversation swaps — v2.2
- Native CC slash commands — SDK `Query.initializationResult` drives per-agent Discord slash registration with `clawcode-*` prefix; control-plane (setModel/setPermissionMode/setMaxThinkingTokens) vs prompt-channel (TurnDispatcher) dispatch-split; `clawcode-compact`/`clawcode-usage`/`clawcode-model`/`clawcode-effort` duplicates unified onto the native SDK path; static-grep regression pin rejects hardcoded native-command lists; 90-per-guild pre-flight cap — v2.2
- Skills marketplace — `/clawcode-skills-browse` Discord picker running the Phase 84 migration pipeline against one skill at a time (same secret-scan + frontmatter + idempotency gates); `updateAgentSkills` atomic YAML writer mirroring `updateAgentModel`; `/clawcode-skills` installed-list + remove via select-menu; exhaustive 8-outcome discriminated-union renderer — v2.2
- Agent restart greeting — `SessionManager.restartAgent()` fire-and-forget greeting at the line-938 chokepoint via v1.6 webhook identity + `EmbedBuilder`; fresh Haiku summarization <500 chars; pure helper `src/manager/restart-greeting.ts` encapsulating fork/thread/empty/dormant/cool-down skip predicates + crash-vs-clean classifier (`prevConsecutiveFailures > 0`); per-agent in-memory cool-down Map cleared on `stopAgent`; additive-optional `greetOnRestart` + `greetCoolDownMs` schema (reloadable); Phase 83/86 fire-and-forget + `.catch` log-and-swallow canary applied — restart always succeeds even when Discord rejects — v2.2

### Active

- **v2.9 Reliability & Routing** — `deploy_pending` per `v2.9-MILESTONE-AUDIT.md` (2026-05-15). All 7 phases (119, 120, 121, 122, 123, 124, 125) code-complete locally; production visual/soak verification gated on next Ramy-quiet deploy window.
- **v3.0 Architectural Surface Expansion + Operator-Pain Backlog** — PROPOSED 2026-05-15 per `v3.0-ROADMAP.md`. Closes 11-item 999.x backlog accumulated during v2.9 (subagent context isolation, plugin SDK, autonomous skill creation, clawcode-as-MCP-server, usage/status fallbacks, tmux skill, Discord voice, etc.).
- **v3.1 Multi-LLM Runtime + Subscription-Pool Fallback** — PROPOSED 2026-05-15 per `v3.1-ROADMAP.md`. Provider-neutral `LlmRuntimeService` seam triggered by Anthropic's 2026-05-14 Agent SDK credit policy (effective **2026-06-15**). Hard-deadline track: Anthropic API key + failover before 2026-06-15.

### Out of Scope (revised 2026-05-15)

- claude-runner bridge — was an OpenClaw workaround, not needed here
- Gateway/routing layer — Claude Code processes handle Discord directly via the existing plugin
- WhatsApp/Telegram/other channel support — Discord only for now
- ~~Custom model providers (Ollama, OpenRouter, etc.) — using Claude Code's native model selection~~ **— REVISED:** v3.1 introduces provider-neutral `LlmRuntimeService` seam supporting Anthropic API key, OpenAI Codex, OpenRouter (+ probe-gated interactive Claude Code CLI). Local models (Ollama, llama.cpp) remain out of scope pending small-model tool-call reliability improvements.
- Voice/TTS integration — ~~not in scope~~ **— REVISED:** v3.0 includes 999.56 Discord voice channel support port from OpenClaw.
- Synchronous agent-to-agent RPC — async inbox pattern is simpler and more reliable
- Shared global memory — violates workspace isolation; per-agent memory with explicit sharing via admin
- Full graph visualization UI — use CLI DOT output + Graphviz instead
- Real-time model switching mid-turn — not possible with Claude Code sessions
- Shared knowledge graph across agents — violates workspace isolation
- Automatic personality evolution — identity drift is a feature-killing bug
- LLM-powered entity/relation extraction — doubles token cost on writes
- Header spoofing against Anthropic — permanently off the table per v3.1 BACKLOG research
- Browser automation against claude.ai — permanently off the table per v3.1 BACKLOG research

## Current Milestone: v2.9 Reliability & Routing (deploy_pending) / v3.0 (proposed) / v3.1 (proposed)

**Goal:** Close the operator-pain gaps in cross-agent message delivery, post-Phase-116 dashboard observability, subagent UX, and MCP lifecycle verification — formally retiring the v2.8 backlog and surfacing post-Phase-116 dashboard regressions as a first-class theme.

**Target features:**
- **MG-A · A2A + Subagent-Relay Delivery Reliability** — fix `post_to_agent` no-webhook fallback (999.44), queue-state icon coherence (999.45), and heartbeat-routing leak into operator channel (999.48); re-validates the Phase 999.12 deploy.
- **MG-D · Dashboard Backend Observability Cleanup (post-116)** — benchmarks empty-rows + null-percentile rendering (999.49), split-latency producer regression + tool-latency-audit CLI Invalid Request (999.7 follow-ups B/C); shared root in `trace_spans` / `tool_latency` surface.
- **MG-B · Subagent UX Completion + Chunk-Boundary** — premature-completion gate (999.36-02) + chunk-boundary off-by-3 (999.36-03); same file, sequenced waves.
- **MG-C · MCP Lifecycle Verification Soak** — execute the four pre-written Wave-2/4 plans for 999.6 / 999.14 / 999.15 to formally close in-production code.
- **Discord Table Auto-Transform** — wrap markdown tables in code blocks at the daemon's output formatter; single-place hook obsoleting per-agent `feedback_no_wide_tables_discord.md` workarounds (999.46).
- **Subagent Delegate Routing + `/research` commands** — route delegated threads to delegate's channel + memory consolidation, then `/research` and `/research-search` slash commands on top (999.19 + 999.20).

**Key context:** Closes v2.8 "Performance + Reliability" — most of its planned scope already shipped (Phases 110, 113, 114, 115, 116) or was triaged out via the cleanup commit `2a9fca8`. Detailed triage in `.planning/BACKLOG-CONSOLIDATED.md` (5 merge groups + 5 standalone + 5 pending-verify, from 33 candidate 999.x dirs).

## Current State

**Latest shipped milestone:** v2.7 Operator Self-Serve + Production Hardening (Phases 100-108, shipped 2026-05-01)
**In-flight (closing as v2.9 opens):** v2.8 Performance + Reliability — most scope shipped or absorbed; remainder consolidated into v2.9.
**Previous active milestone reference:** v2.2 OpenClaw Parity & Polish (shipped 2026-04-23)

v1.0-v2.2 delivered 90 phases across 13 milestones: core multi-agent system, advanced intelligence, production hardening, agent integrations, agent runtime, smart memory with model tiering, platform operations + RAG, end-to-end performance + latency optimizations, proactive agents with cross-agent handoffs, persistent conversation memory with auto-injection, OpenAI-compatible endpoint + browser/search/image MCPs, one-shot OpenClaw-to-ClawCode migration toolchain, and v2.2 parity polish (effort mapping, skills migration, MCP reliability, dual model picker, native CC slash commands, skills marketplace, restart greeting). Zero new npm dependencies added in v2.2 — entire milestone built on the existing stack.

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
- Phase 89 has 2 pending operator UAT items (live Discord greeting smoke test + dormancy skip smoke test) — tracked in `.planning/phases/89-.../89-HUMAN-UAT.md`; run `/gsd:verify-work 89` after operator validation
- DeliveryQueue schema is text-only (v1.2) — Phase 89 greetings bypass it via direct `webhookManager.sendAsAgent`. Future phase could extend DeliveryQueue to carry structured embeds (documented in Plan 89-02 verification)
- v2.2 phases have test strategy + UAT items inline in RESEARCH/SUMMARY/VERIFICATION artifacts rather than separate VALIDATION.md files — not blocking, but `/gsd:validate-phase N` can generate retroactive Nyquist matrices if needed

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
| SDK mid-session mutation canary blueprint (v2.2) | Phase 83 validated `q.setMaxThinkingTokens`/`setModel`/`setPermissionMode` concurrency against the single captured driverIter handle with synchronous caller + fire-and-forget + `.catch` log-and-swallow | ✓ Good — Phase 86 setModel, Phase 87 setPermissionMode, Phase 89 restart greeting all followed the pattern verbatim; 5-test spy harness shared across all four |
| Additive-optional schema extension precedent (v2.2) | Phase 83 (`effort`), Phase 86 (`allowedModels`), Phase 89 (`greetOnRestart` + `greetCoolDownMs`) all extend config schema with `.optional()` at agent level + `.default(X)` at defaults level; loader resolver falls back; RELOADABLE_FIELDS explicit | ✓ Good — v2.1 migrated 15-agent fleet parses unchanged after all 5 additive fields stack |
| Pure-function DI composition (v2.2) | Phase 85 `performMcpReadinessHandshake` + Phase 89 `sendRestartGreeting` are pure modules with all I/O DI'd through a Deps struct | ✓ Good — 100% unit-testable without SessionManager/WebhookManager/ConversationStore/Discord running |
| Atomic YAML writer convention (v2.1 → v2.2) | Phase 86 `updateAgentModel` + Phase 88 `updateAgentSkills` share the parseDocument AST + temp+rename + secret-guard pattern | ✓ Good — comments preserved, secret-guard gate blocks accidental credential writes, two consumers proven |
| DeliveryQueue bypass for greetings (v2.2) | v1.2 DeliveryQueue is text-only — Phase 89 greetings go direct via webhookManager.sendAsAgent | — Pending revisit — future phase could extend DeliveryQueue to carry embeds; documented in Plan 89-02 |
| Restart greeting = active Discord (v2.2) | Distinct from v1.9 `assembleConversationBrief` which is a passive prompt injection. Greeting emits ONLY on explicit `SessionManager.restartAgent()`; startAgent/startAll/performRestart silent by construction (not by runtime flag) | ✓ Good — D-01 literal reading enforced by code structure, not a feature flag |

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
*Last updated: 2026-05-13 — v2.9 Reliability & Routing milestone opened; v2.8 closed via consolidation (see `.planning/BACKLOG-CONSOLIDATED.md`)*
