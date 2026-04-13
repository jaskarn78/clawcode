# Phase 50: Latency Instrumentation - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning
**Mode:** Smart discuss — all 4 grey areas accepted as recommended

<domain>
## Phase Boundary

Operators can see exactly where time is spent in every Discord message → reply cycle. This phase delivers the measurement foundation for v1.7: structured per-turn traces with phase-level spans, CLI percentile reports, a dashboard latency panel, and persistent trace storage across daemon restarts.

Scope lines:
- IN: Trace capture at known hook points (receive, context assemble, first token, tool call, end-to-end), per-agent SQLite trace store, `clawcode latency` CLI, dashboard panel, retention heartbeat check.
- OUT: SLO targets (Phase 51), CI regression gate (Phase 51), any optimization (Phases 52-56). This phase only observes; it does not change the hot path beyond recording spans.

</domain>

<decisions>
## Implementation Decisions

### Trace Storage & Retention
- **Location:** New per-agent `traces.db` SQLite file at `~/.clawcode/agents/<name>/traces.db`. Mirrors the existing `usage.db` / `memory.db` isolation pattern.
- **Schema:** Two tables — `traces` (one row per turn: `id`, `agent`, `started_at`, `ended_at`, `total_ms`, `discord_channel_id`, `status`) and `trace_spans` (many rows per turn: `turn_id`, `name`, `started_at`, `duration_ms`, `metadata_json`). Indexed on `(agent, started_at)` and `(turn_id, name)` for percentile queries.
- **Retention mechanism:** New heartbeat check `src/heartbeat/checks/trace-retention.ts` — runs `DELETE FROM traces WHERE started_at < ?`. Child rows in `trace_spans` are removed automatically via `PRAGMA foreign_keys = ON` + `ON DELETE CASCADE` on the `trace_spans.turn_id → traces(id)` foreign key. Follows the `attachment-cleanup.ts` precedent (auto-discovered by `src/heartbeat/discovery.ts`).
  - *Addendum (2026-04-13, research-driven):* An earlier draft used a two-query cleanup (`DELETE FROM traces ... AND DELETE FROM trace_spans WHERE turn_id NOT IN (SELECT id FROM traces)`). Research Pitfall 4 flagged that the orphan-span query races with in-flight turns under 14-agent concurrency. CASCADE deletion makes retention atomic at the parent level and eliminates the race. Accepted.
- **Default retention:** 7 days. Exposed as `perf.traceRetentionDays` in `src/config/schema.ts` config; overridable per agent.

### Instrumentation Mechanism
- **Span abstraction:** In-house `TraceCollector` class in `src/performance/trace-collector.ts`. API: `startTurn(turnId, agent, channelId) -> Turn`, `turn.startSpan(name, metadata?)`, `span.end()`, `turn.end(status)`. No OpenTelemetry dependency. Passed through DI (`Deps` pattern) to consumers.
- **Hook points:** 4 canonical spans per turn:
  - `receive` — `DiscordBridge.handleMessage` start → session dispatch
  - `context_assemble` — wraps `ContextAssembler.assemble`
  - `first_token` — from `SdkSessionAdapter.sendAndStream` send → first `text_delta` chunk
  - `end_to_end` — from receive start → final Discord message sent
  - `tool_call.<name>` — one span per SDK tool-call event (captured from stream events)
- **First-token detection:** Subscribe to SDK stream event types in `SdkSessionAdapter.sendAndStream`. First `content_block_delta` (text) or `text_delta` chunk marks `first_token`.
- **Turn correlation ID:** Use Discord `message.id` as `turn_id`. Unique, traceable back to the source message, gives free deduplication on retry. For non-Discord-triggered turns (e.g., scheduler-initiated), generate a nanoid with a `scheduler:` prefix.

### CLI Output (`clawcode latency`)
- **Default output:** Pretty-printed aligned table (segment rows × `p50 | p95 | p99 | count` columns). `--json` flag emits machine-readable output.
- **Time window:** `--since 24h` default. Accepts human duration strings (`1h`, `6h`, `7d`). Parsed via a small duration helper reused by the dashboard endpoint.
- **Scope argument:** Positional `clawcode latency <agent>` for per-agent. `--all` flag for fleet rollup (one row per agent, aggregate percentiles).
- **Units:** Milliseconds everywhere, right-aligned with thousand separators and `ms` suffix. No auto-conversion to seconds.

### Dashboard Panel
- **Placement:** New "Latency" section inside the existing per-agent card in `src/dashboard/static/app.js`. Same layout language as the Cost panel.
- **Data feed:** New REST endpoint `GET /api/agents/:name/latency?since=24h` added to `src/dashboard/server.ts`. Returns JSON with per-segment p50/p95/p99 and turn count. Polled by the dashboard every 30s. No SSE firehose (keeps the SSE channel focused on status changes).
- **Visualization:** Percentile table — rows for `end_to_end / first_token / context_assemble / tool_call`, columns `p50 / p95 / p99 / count`. Sparklines deferred.
- **Time window:** Fixed "last 24h" matching the CLI default. Selector deferred.

### Claude's Discretion
- Exact filename layout within `src/performance/` (collector, store, query helpers).
- Whether the percentile calculation runs in SQL (`PERCENTILE_CONT` emulation via ordered subqueries) or in JS after fetching spans. Prefer SQL when span count is large; JS is fine for small windows — use whichever is cleaner.
- Exact migration/schema-init strategy for `traces.db` — follow the pattern already used for `memory.db` (idempotent `CREATE TABLE IF NOT EXISTS` at construction).
- Test structure and fixtures.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/shared/logger.ts` — pino singleton; use child loggers with `{ agent, turnId }` for trace correlation.
- `src/heartbeat/discovery.ts` — auto-loads new checks from `src/heartbeat/checks/`. Drop `trace-retention.ts` in that dir and it wires itself up.
- `src/config/schema.ts` — Zod schema defining `AgentConfig`. Add `perf` sub-object (`traceRetentionDays` optional).
- `src/usage/tracker.ts` — precedent for per-agent SQLite file with prepared statements and `Object.freeze` return pattern. Mirror its structure in the trace store.
- `src/dashboard/server.ts` — existing REST pattern (`/api/agents/:name/...`); follow it for the new `/latency` endpoint.
- `src/dashboard/static/app.js` — existing per-agent card and Cost panel; add the Latency section adjacent.
- `src/cli/commands/costs.ts` — model for the new `latency.ts` CLI command (flag shape, output format, `--json`, time window).

### Established Patterns
- **Per-agent SQLite file** with prepared statements in constructor; return `Object.freeze`d readonly records.
- **Dependency injection** via `Deps` object (see `CompactionDeps`) — `TraceCollector` will be injected into `DiscordBridge`, `SdkSessionAdapter`, `ContextAssembler`.
- **ESM `.js` extension** on all relative imports.
- **Zod schema** for config surface, `z.infer` for TS types.
- **`readonly`** on every type property; `Object.freeze` on returned records.
- **Heartbeat checks** live in `src/heartbeat/checks/` and auto-register.

### Integration Points
- `DiscordBridge.handleMessage` in `src/discord/bridge.ts` — start `receive` span, carry `turnId` through to the session call.
- `ContextAssembler` in `src/manager/context-assembler.ts` — wrap `.assemble` in `context_assemble` span.
- `SdkSessionAdapter.sendAndStream` in `src/manager/session-adapter.ts` — emit `first_token` span on first content chunk, `tool_call.<name>` on tool-use events, `end_to_end` on completion.
- `src/dashboard/server.ts` — add `/api/agents/:name/latency` route.
- `src/cli/index.ts` — register new `latency` command from `src/cli/commands/latency.ts`.
- `src/manager/daemon.ts` — construct `TraceCollector` per agent in `startDaemon`, pass through to session adapter and bridge.
- `src/heartbeat/checks/` — add `trace-retention.ts`.

</code_context>

<specifics>
## Specific Ideas

- **p50/p95/p99 rendering:** the CLI `clawcode latency` and the dashboard panel must agree on segment names and order, so future SLO targets (Phase 51) can point at a canonical name. Canonical segments: `end_to_end`, `first_token`, `context_assemble`, `tool_call` (aggregate across all tool spans for a turn).
- **Metadata JSON:** `trace_spans.metadata_json` is small-payload only (tool name, content length, model). No full prompt bodies. Schema docstring must say so.
- **Trace flush:** writes are batched per-turn at `turn.end()` — one transaction per turn, not one transaction per span. Keeps SQLite write load bounded under bursty message traffic.
- **Non-Discord turns:** scheduler/subagent-triggered turns still get traced, with `turnId` prefixed `scheduler:` or `subagent:` so they can be filtered or excluded from user-latency percentiles.

</specifics>

<deferred>
## Deferred Ideas

- SLO targets and CI regression gate — Phase 51.
- Sparklines / histogram views in the dashboard — later.
- Dropdown time-window selector in the dashboard — later.
- Distributed tracing across daemon + subprocess boundaries — not needed, everything is in one process.
- Exporting traces to an external APM system (Jaeger, Honeycomb) — out of scope; local SQLite only.

</deferred>
