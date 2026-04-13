# Requirements — v1.7 Performance & Latency

**Status:** Active
**Started:** 2026-04-13
**Phases:** 50-56 (7 phases)

## Milestone Goal

Reduce end-to-end latency from Discord message arrival to agent reply across the ClawCode fleet. Shrink the per-turn payload, exploit Anthropic prompt caching, eliminate avoidable tool-call overhead, keep the warm path warm, and gate regressions with concrete SLOs.

## v1.7 Requirements

### Instrumentation & SLOs (PERF)

- [ ] **PERF-01**: Every Discord message → reply cycle logs phase-level timings (receive, context assemble, first token, each tool call, final send) to a structured trace store
- [ ] **PERF-02**: Per-agent latency report surfaces p50 / p95 / p99 for end-to-end, first-token, context-assemble, and tool-call segments (CLI + dashboard)
- [ ] **PERF-03**: Concrete SLO targets documented per surface (e.g., first-token p50 ≤ 2s, end-to-end p95 ≤ 6s) and displayed on the dashboard
- [ ] **PERF-04**: CI benchmark harness runs a fixed prompt set and fails the build when p95 regresses beyond a configurable threshold

### Prompt Caching (CACHE)

- [ ] **CACHE-01**: Anthropic `cache_control` markers applied to the stable system prompt prefix (identity, soul, skills header)
- [ ] **CACHE-02**: Memory hot-tier and skills/tool definitions included in the cached prefix when stable across turns; mutable sections placed after the cache boundary
- [ ] **CACHE-03**: Per-agent cache hit-rate telemetry (cached input tokens / total input tokens) surfaced in the dashboard and daily summary
- [ ] **CACHE-04**: Cache invalidation is correct — changing identity, soul, hot-tier memory, or skill set evicts stale prefixes and is observable in telemetry

### Context / Token Budget Tuning (CTX)

- [ ] **CTX-01**: Per-agent context audit report — current average and p95 payload size by section (identity, memory, skills, history, summary) documented in a reproducible script
- [ ] **CTX-02**: Default memory assembly budgets tightened based on audit findings without a measurable response-quality regression (validated via regression prompt set)
- [ ] **CTX-03**: Skills and MCP tool definitions load lazily or compress when not referenced in recent turns (configurable per agent)
- [ ] **CTX-04**: Session-resume summary payload size reduced (strict upper bound on token cost per resume)

### Streaming (STREAM)

- [ ] **STREAM-01**: First-token latency measured as a first-class metric (separate from end-to-end) and reported per agent
- [ ] **STREAM-02**: Discord streaming delivery uses tighter chunk cadence (smaller batches, lower debounce) so users see tokens sooner without rate-limit regressions
- [ ] **STREAM-03**: Typing indicator fires within 500ms of message arrival, before any LLM work starts

### Tool-Call Overhead (TOOL)

- [ ] **TOOL-01**: Independent tool calls within a single turn execute in parallel (identify and remove current serialization points)
- [ ] **TOOL-02**: Idempotent tool results (e.g., repeated `memory_lookup` with identical args, repeated `search_documents`) are cached within a turn
- [ ] **TOOL-03**: Per-tool round-trip timing logged and visible in the dashboard so slow tools are attributable

### Warm-Path Optimizations (WARM)

- [ ] **WARM-01**: SQLite prepared statements and sqlite-vec handles warmed at agent start — no first-query penalty on the hot path
- [ ] **WARM-02**: Embedding model stays resident across turns — no cold-start on `memory_lookup` after idle periods
- [ ] **WARM-03**: Session / thread keep-alive prevents full re-init between consecutive Discord messages in the same thread
- [ ] **WARM-04**: Startup health check verifies warm-path readiness (SQLite, embeddings, session ready) before marking the agent "ready" in `/clawcode-fleet`

## Future Requirements

- Speculative decoding / multi-model racing (only if Anthropic exposes the primitive)
- Disk-backed KV cache persistence across daemon restarts
- Cross-agent prompt prefix sharing (requires identity model rework)

## Out of Scope

- Switching away from Claude model family — stack decision is locked
- Replacing sqlite-vec with an external vector DB — too much surgery for the latency win
- Custom proxy in front of Anthropic API — adds a hop, contradicts the goal
- Response-quality improvements unrelated to latency (separate milestone)
- Voice/real-time audio latency — not in scope for v1.7

## Requirements Traceability

| ID | Description | Phase | Status |
|----|-------------|-------|--------|
| PERF-01 | Phase-level latency tracing per turn | Phase 50 | [ ] |
| PERF-02 | p50/p95/p99 latency report per agent | Phase 50 | [ ] |
| PERF-03 | SLO targets documented and surfaced | Phase 51 | [ ] |
| PERF-04 | CI regression gate on p95 | Phase 51 | [ ] |
| CACHE-01 | cache_control on stable system prefix | Phase 52 | [ ] |
| CACHE-02 | Hot-tier + skills inside cached prefix | Phase 52 | [ ] |
| CACHE-03 | Per-agent cache hit-rate telemetry | Phase 52 | [ ] |
| CACHE-04 | Correct cache invalidation on prefix change | Phase 52 | [ ] |
| CTX-01 | Per-agent context size audit script | Phase 53 | [ ] |
| CTX-02 | Tightened memory assembly budgets | Phase 53 | [ ] |
| CTX-03 | Lazy/compressed skills & tool defs | Phase 53 | [ ] |
| CTX-04 | Reduced session-resume summary payload | Phase 53 | [ ] |
| STREAM-01 | First-token latency as a first-class metric | Phase 54 | [ ] |
| STREAM-02 | Tighter Discord streaming cadence | Phase 54 | [ ] |
| STREAM-03 | Typing indicator ≤ 500ms | Phase 54 | [ ] |
| TOOL-01 | Parallel independent tool calls per turn | Phase 55 | [ ] |
| TOOL-02 | Intra-turn idempotent tool-result cache | Phase 55 | [ ] |
| TOOL-03 | Per-tool round-trip timing | Phase 55 | [ ] |
| WARM-01 | SQLite / sqlite-vec warmup at agent start | Phase 56 | [ ] |
| WARM-02 | Resident embedding model | Phase 56 | [ ] |
| WARM-03 | Session / thread keep-alive | Phase 56 | [ ] |
| WARM-04 | Warm-path readiness in startup health check | Phase 56 | [ ] |

**Total:** 22 requirements — all mapped to phases 50-56.
