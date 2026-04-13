# Phase 50: Latency Instrumentation - Research

**Researched:** 2026-04-13
**Domain:** Distributed tracing, SQLite time-series storage, Claude Agent SDK stream events
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Trace Storage & Retention**
- **Location:** New per-agent `traces.db` SQLite file at `~/.clawcode/agents/<name>/traces.db`. Mirrors the existing `usage.db` / `memory.db` isolation pattern.
- **Schema:** Two tables — `traces` (one row per turn: `id`, `agent`, `started_at`, `ended_at`, `total_ms`, `discord_channel_id`, `status`) and `trace_spans` (many rows per turn: `turn_id`, `name`, `started_at`, `duration_ms`, `metadata_json`). Indexed on `(agent, started_at)` and `(turn_id, name)` for percentile queries.
- **Retention mechanism:** New heartbeat check `src/heartbeat/checks/trace-retention.ts` — runs `DELETE FROM traces WHERE started_at < ?` and `DELETE FROM trace_spans WHERE turn_id NOT IN (SELECT id FROM traces)` on each tick. Follows the `attachment-cleanup.ts` precedent (auto-discovered by `src/heartbeat/discovery.ts`).
- **Default retention:** 7 days. Exposed as `perf.traceRetentionDays` in `src/config/schema.ts` config; overridable per agent.

**Instrumentation Mechanism**
- **Span abstraction:** In-house `TraceCollector` class in `src/performance/trace-collector.ts`. API: `startTurn(turnId, agent, channelId) -> Turn`, `turn.startSpan(name, metadata?)`, `span.end()`, `turn.end(status)`. No OpenTelemetry dependency. Passed through DI (`Deps` pattern) to consumers.
- **Hook points:** 4 canonical spans per turn:
  - `receive` — `DiscordBridge.handleMessage` start → session dispatch
  - `context_assemble` — wraps `ContextAssembler.assemble`
  - `first_token` — from `SdkSessionAdapter.sendAndStream` send → first `text_delta` chunk
  - `end_to_end` — from receive start → final Discord message sent
  - `tool_call.<name>` — one span per SDK tool-call event (captured from stream events)
- **First-token detection:** Subscribe to SDK stream event types in `SdkSessionAdapter.sendAndStream`. First `content_block_delta` (text) or `text_delta` chunk marks `first_token`.
- **Turn correlation ID:** Use Discord `message.id` as `turn_id`. Unique, traceable back to the source message, gives free deduplication on retry. For non-Discord-triggered turns (e.g., scheduler-initiated), generate a nanoid with a `scheduler:` prefix.

**CLI Output (`clawcode latency`)**
- **Default output:** Pretty-printed aligned table (segment rows × `p50 | p95 | p99 | count` columns). `--json` flag emits machine-readable output.
- **Time window:** `--since 24h` default. Accepts human duration strings (`1h`, `6h`, `7d`). Parsed via a small duration helper reused by the dashboard endpoint.
- **Scope argument:** Positional `clawcode latency <agent>` for per-agent. `--all` flag for fleet rollup (one row per agent, aggregate percentiles).
- **Units:** Milliseconds everywhere, right-aligned with thousand separators and `ms` suffix. No auto-conversion to seconds.

**Dashboard Panel**
- **Placement:** New "Latency" section inside the existing per-agent card in `src/dashboard/static/app.js`. Same layout language as the Cost panel.
- **Data feed:** New REST endpoint `GET /api/agents/:name/latency?since=24h` added to `src/dashboard/server.ts`. Returns JSON with per-segment p50/p95/p99 and turn count. Polled by the dashboard every 30s. No SSE firehose.
- **Visualization:** Percentile table — rows for `end_to_end / first_token / context_assemble / tool_call`, columns `p50 / p95 / p99 / count`. Sparklines deferred.
- **Time window:** Fixed "last 24h" matching the CLI default. Selector deferred.

### Claude's Discretion
- Exact filename layout within `src/performance/` (collector, store, query helpers).
- Whether the percentile calculation runs in SQL (`PERCENTILE_CONT` emulation via ordered subqueries) or in JS after fetching spans. Prefer SQL when span count is large; JS is fine for small windows — use whichever is cleaner.
- Exact migration/schema-init strategy for `traces.db` — follow the pattern already used for `memory.db` (idempotent `CREATE TABLE IF NOT EXISTS` at construction).
- Test structure and fixtures.

### Deferred Ideas (OUT OF SCOPE)
- SLO targets and CI regression gate — Phase 51.
- Sparklines / histogram views in the dashboard — later.
- Dropdown time-window selector in the dashboard — later.
- Distributed tracing across daemon + subprocess boundaries — not needed, everything is in one process.
- Exporting traces to an external APM system (Jaeger, Honeycomb) — out of scope; local SQLite only.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PERF-01 | Every Discord message → reply cycle logs phase-level timings to a structured trace store | `TraceCollector` DI-injected at `DiscordBridge.handleMessage` (start of `receive`), `ContextAssembler.assemble` (wraps `context_assemble`), `SdkSessionAdapter.sendAndStream` (first_token + tool_call.* + end_to_end) writes to per-agent `traces.db`. Tool call events captured from SDK message stream — either `SDKToolProgressMessage` (`type: 'tool_progress'`) for in-flight timing or via content-block inspection of `SDKAssistantMessage.message.content[]` `BetaToolUseBlock` entries. |
| PERF-02 | Per-agent latency report surfaces p50 / p95 / p99 for end-to-end, first-token, context-assemble, and tool-call segments (CLI + dashboard) | New IPC method `latency` (daemon) reads `traces.db` with SQL percentile emulation via `ROW_NUMBER() OVER (ORDER BY duration_ms)`. Exposed via `clawcode latency <agent>` CLI command (mirrors `costs.ts`) and `GET /api/agents/:name/latency` REST endpoint (mirrors `/api/costs` and `/api/messages/:agent` patterns in `src/dashboard/server.ts`). |
</phase_requirements>

## Summary

Phase 50 delivers the observation foundation for v1.7 by inserting a lightweight in-house tracing layer at four canonical hook points on the Discord → reply path and storing spans in per-agent SQLite files. The technical surface is small: ClawCode already has every architectural piece this phase needs — per-agent SQLite stores (`usage.db` precedent), auto-discovered heartbeat checks, DI-injected deps, pino structured logging, Zod config schemas, and a REST+IPC dashboard pattern. The novel work is (a) a `TraceCollector` with per-turn batched writes, (b) wiring it through three existing modules, (c) percentile SQL, and (d) two thin UI layers (CLI + dashboard panel).

The single non-trivial research question is how to capture tool-call spans from the Claude Agent SDK stream. The answer is **the SDK already emits `SDKToolProgressMessage` (type `tool_progress`, with `tool_use_id`, `tool_name`, `elapsed_time_seconds`) and tool_use is visible inside `SDKAssistantMessage.message.content[]` as `BetaToolUseBlock` entries**. Additionally, the SDK supports a `hooks` option (`PreToolUse`, `PostToolUse`) that provides authoritative start/end callbacks with `tool_use_id` correlation — this is the cleanest hook for tool-call timing but requires extending the existing `SdkQueryOptions` type locally. Either approach works; the content-block approach fits the existing stream-consumption pattern and requires zero new SDK surface.

For first-token detection, the current adapter already iterates `msg.type === "assistant"` messages — the first non-empty assistant content marks first-token. A cleaner signal is to enable `includePartialMessages: true` and watch for `SDKPartialAssistantMessage` (`type: 'stream_event'`) with a `content_block_delta` of subtype `text_delta`, but this requires adding a new message type to the local SDK types and consuming a higher-frequency event stream.

**Primary recommendation:** Add a minimal `TraceCollector` with per-turn batched writes (one transaction per turn, not per span). Keep tool-call detection within the existing `for await (const msg of query)` loop by discriminating on `msg.type === 'tool_progress'` and inspecting `SDKAssistantMessage.message.content[]`. Compute percentiles in SQL using `ROW_NUMBER()` emulation (SQLite lacks `PERCENTILE_CONT`). Retention runs as a new heartbeat check that follows `attachment-cleanup.ts` verbatim.

## Standard Stack

### Core
All dependencies already present in `package.json` — no new runtime dependencies required.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 (present) | Trace store backing SQLite | Synchronous API, prepared statements, WAL mode — identical to `usage/tracker.ts` |
| nanoid | 5.1.7 (present) | Non-Discord turn IDs (scheduler, subagent) | Already used for usage events, memory IDs |
| @anthropic-ai/claude-agent-sdk | 0.2.97 (present) | Source of tool_progress / assistant message events | Sole source of truth for `tool_call.*` and `first_token` signals |
| pino | 9.x (present) | Structured logging with `{ agent, turnId }` child logger | Project singleton in `src/shared/logger.ts` |
| zod | 4.3.6 (present) | `perf.traceRetentionDays` config validation | Already the config authority in `src/config/schema.ts` |
| commander | 14.0.3 (present) | `clawcode latency` CLI command | Already the CLI framework; mirror `costs.ts` registration |
| date-fns | 4.1.0 (present) | Retention cutoff calculation (`subDays`) | Already used in `usage/tracker.ts` for `addDays` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.3 (present) | Unit tests for collector, store, percentile math, CLI formatter, retention check | Standard in-repo test framework; `npm test` runs all |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-house `TraceCollector` | `@opentelemetry/api` + SDK | Locked out by CONTEXT.md ("No OpenTelemetry dependency"). Adds ~50KB, span context propagation, vendor-neutral exporters — none of which we need for single-process local traces. |
| SQL percentiles via `ROW_NUMBER()` | JS-side percentile over fetched rows | Per CONTEXT discretion. SQL wins when turn count per agent exceeds ~5K per window (7 days × 14 agents × ~hundreds of turns/day). JS is simpler under ~1K rows. Recommend SQL for consistency regardless of window size. |
| Per-agent `traces.db` | Single shared `traces.db` in `~/.clawcode/manager/` | Locked by CONTEXT — matches `usage.db` / `memory.db` isolation pattern. Prevents cross-agent lock contention under 14+ concurrent writers. |
| SDK `hooks.PreToolUse` / `PostToolUse` callbacks | Content-block inspection of `SDKAssistantMessage` + `SDKToolProgressMessage` | Hooks give authoritative `tool_use_id`-correlated start/end. Content-block approach requires no new SDK surface and fits the existing stream iteration loop. Recommend content-block for minimal surface area; hooks as a future optimization if timing accuracy matters. |
| `includePartialMessages: true` for first-token | First `msg.type === "assistant"` with non-empty text | Partial messages give byte-level `text_delta` events — more precise but noisier stream. The first assistant message is sufficient for p50/p95/p99 granularity (variance at ms-level is negligible vs. first-token itself being ~500-2000ms). |

**Installation:** None required — all dependencies already installed.

**Version verification:** Confirmed all target packages in `package.json` at versions specified in `.planning/codebase/INTEGRATIONS.md` — no bumps needed.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── performance/               # NEW — all Phase 50 new code
│   ├── trace-collector.ts     # TraceCollector class: startTurn/startSpan/end
│   ├── trace-store.ts         # SQLite wrapper: per-agent traces.db (mirrors usage/tracker.ts)
│   ├── percentiles.ts         # SQL percentile helpers + `since` duration parser
│   ├── types.ts               # Turn, Span, LatencyReport types
│   └── __tests__/
│       ├── trace-collector.test.ts
│       ├── trace-store.test.ts
│       └── percentiles.test.ts
├── heartbeat/checks/
│   └── trace-retention.ts     # NEW — auto-discovered retention check
├── cli/commands/
│   └── latency.ts             # NEW — `clawcode latency` command (mirrors costs.ts)
├── dashboard/
│   ├── server.ts              # EDIT — add GET /api/agents/:name/latency route
│   └── static/
│       └── app.js             # EDIT — add Latency panel to per-agent card
├── manager/
│   ├── daemon.ts              # EDIT — construct TraceCollector per agent, wire to Deps, add `latency` IPC route
│   ├── session-adapter.ts     # EDIT — emit first_token, tool_call.<name>, end_to_end spans
│   └── context-assembler.ts   # EDIT — wrap assemble() in context_assemble span
├── discord/
│   └── bridge.ts              # EDIT — start receive span at handleMessage, end at reply send
├── config/
│   └── schema.ts              # EDIT — add perf.traceRetentionDays optional field
└── shared/
    └── types.ts               # EDIT — add perf config to ResolvedAgentConfig if needed
```

### Pattern 1: Per-Agent SQLite Store (TraceStore)

**What:** Mirror `src/usage/tracker.ts` structure — `better-sqlite3` in constructor, prepared statements, `Object.freeze` on returned records, idempotent `CREATE TABLE IF NOT EXISTS` schema init.

**When to use:** All per-agent persistent state in ClawCode uses this pattern. No exceptions.

**Example (verbatim pattern from `src/usage/tracker.ts`):**
```typescript
// Source: src/usage/tracker.ts (existing project code — copy this shape)
export class UsageTracker {
  private readonly db: DatabaseType;
  private readonly stmts: PreparedStatements;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    this.initSchema();
    this.stmts = this.prepareStatements();
  }
  // ...
}
```

**For Phase 50, add to TraceStore:**
- `foreign_keys = ON` pragma (so `trace_spans.turn_id → traces.id` CASCADE works on retention cleanup)
- Indices: `CREATE INDEX idx_traces_agent_started ON traces(agent, started_at)` and `CREATE INDEX idx_spans_turn_name ON trace_spans(turn_id, name)`

### Pattern 2: Batched Per-Turn Writes

**What:** Collect all spans in memory during a turn (`Turn` object holds a mutable `spans: Span[]` array). On `turn.end(status)`, open one transaction and write the turn row + all span rows.

**When to use:** Any time write volume is high-frequency (per-message or per-tool-call). SQLite can sustain ~5K-10K transactions/sec on WAL-mode single-process writes, but one-transaction-per-span under bursty tool-heavy turns (10+ tools × 14 agents) would thrash. One-transaction-per-turn caps write amplification.

**Example:**
```typescript
// trace-store.ts — batched write
writeTurn(turn: ReadonlyTurn): void {
  const tx = this.db.transaction((t: ReadonlyTurn) => {
    this.stmts.insertTrace.run(t.id, t.agent, t.startedAt, t.endedAt, t.totalMs, t.channelId, t.status);
    for (const span of t.spans) {
      this.stmts.insertSpan.run(t.id, span.name, span.startedAt, span.durationMs, JSON.stringify(span.metadata));
    }
  });
  tx(turn);
}
```

### Pattern 3: Dependency Injection via `Deps` object

**What:** Constructor takes a typed `Deps` object; daemon constructs and wires dependencies once at startup.

**When to use:** Every cross-module consumer of `TraceCollector`.

**Example (existing project convention from `src/memory/compaction.ts`):**
```typescript
// Source: .planning/codebase/CONVENTIONS.md (existing project convention)
type CompactionDeps = {
  memoryStore: MemoryStore;
  embedder: EmbeddingService;
  sessionLogger: SessionLogger;
  threshold: number;
  logger: Logger;
};
```

**For Phase 50:** Add `traceCollector?: TraceCollector` to `DiscordBridge` config, `ContextAssembler` deps, and `SdkSessionAdapter` session options. Keep it OPTIONAL with null-safe calls so mock adapters and tests don't need to wire it.

### Pattern 4: SQL Percentile Emulation (SQLite lacks PERCENTILE_CONT)

**What:** Use `ROW_NUMBER()` window function to rank rows by `duration_ms`, then index into the correct percentile position.

**When to use:** Percentile queries over trace_spans, per segment.

**Example:**
```sql
-- percentiles for a single span name
WITH ranked AS (
  SELECT duration_ms,
    ROW_NUMBER() OVER (ORDER BY duration_ms) AS rn,
    COUNT(*) OVER () AS total
  FROM trace_spans s
  JOIN traces t ON t.id = s.turn_id
  WHERE t.agent = ? AND t.started_at >= ? AND s.name = ?
)
SELECT
  MIN(CASE WHEN rn >= CEIL(total * 0.50) THEN duration_ms END) AS p50,
  MIN(CASE WHEN rn >= CEIL(total * 0.95) THEN duration_ms END) AS p95,
  MIN(CASE WHEN rn >= CEIL(total * 0.99) THEN duration_ms END) AS p99,
  total AS count
FROM ranked;
```

Better-sqlite3 supports window functions (SQLite 3.25+; all current Node builds ship 3.44+). Verified: `better-sqlite3@12.8.0` ships with SQLite 3.45+.

**Tool-call aggregate:** For the `tool_call` segment, use `WHERE s.name LIKE 'tool_call.%'` so one row emerges for the aggregate across all tool types. Store per-tool-type breakdown as a separate query later (Phase 55 dependency).

### Pattern 5: Auto-Discovered Heartbeat Check

**What:** Drop a file in `src/heartbeat/checks/` that default-exports a `CheckModule` — `src/heartbeat/discovery.ts` auto-loads it. Zero registration code needed.

**Example (copy from `src/heartbeat/checks/attachment-cleanup.ts`):**
```typescript
// Source: src/heartbeat/checks/attachment-cleanup.ts (verbatim pattern)
const traceRetentionCheck: CheckModule = {
  name: "trace-retention",
  async execute(context): Promise<CheckResult> {
    const { agentName, sessionManager } = context;
    const agentConfig = sessionManager.getAgentConfig(agentName);
    if (!agentConfig) return { status: "healthy", message: "No config available" };
    // ... delete expired traces, return CheckResult
  },
};
export default traceRetentionCheck;
```

### Pattern 6: REST Endpoint on Dashboard Server

**What:** Dashboard uses raw `node:http` (no Express). Each route is a guard clause in `handleRequest`, dispatches via IPC to daemon.

**Example (from `src/dashboard/server.ts`):**
```typescript
// Source: src/dashboard/server.ts (existing pattern)
// New endpoint — add after /api/messages/:agent block (line ~167)
if (
  method === "GET" &&
  segments.length === 4 &&
  segments[0] === "api" &&
  segments[1] === "agents" &&
  segments[3] === "latency"
) {
  const agentName = decodeURIComponent(segments[2]!);
  const since = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("since") ?? "24h";
  try {
    const data = await sendIpcRequest(socketPath, "latency", { agent: agentName, since });
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : "unknown" });
  }
  return;
}
```

### Anti-Patterns to Avoid

- **One SQLite transaction per span.** Fragments writes, thrashes WAL. Always batch at `turn.end()`.
- **Storing full prompt bodies in `metadata_json`.** CONTEXT.md explicit: small payloads only (tool name, content length, model). Violating this bloats `traces.db` to GB-scale under 7-day retention and makes retention cleanup a scanning nightmare.
- **Synchronous `fetch`/IPC in the TraceCollector hot path.** `startSpan` / `span.end()` must be pure in-memory mutations. Only the `turn.end(status)` commit touches disk.
- **Holding a trace handle across sessions (resume/restart).** Turns are per-message. If the agent crashes mid-turn, the unfinished turn is lost — that's acceptable (traces are observational, not transactional).
- **Treating `msg.content` as a string.** The current `SdkSessionAdapter` uses a narrowed local type — the real SDK's `SDKAssistantMessage.message.content` is `BetaContentBlock[]`. When inspecting for `tool_use` blocks, iterate the array and check `block.type === 'tool_use'`.
- **Not flushing on daemon shutdown.** Keep the current-turn buffer in memory, but register a `SIGTERM` handler that flushes in-flight turns to the store before exit. Otherwise a graceful restart loses ~30s of traces.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Distributed span context propagation | Custom context carriers, baggage headers | Not needed — single process | The entire Phase 50 surface is in-daemon. Turn ID is enough. Deferred items explicitly exclude cross-process tracing. |
| Percentile calculation | Custom sort + indexing | SQL `ROW_NUMBER() OVER (ORDER BY duration_ms)` | SQLite window functions are battle-tested. Hand-rolled JS percentiles are off-by-one-prone (linear vs. nearest-rank vs. continuous interpolation — pick once and stick with it). |
| Duration string parser (`24h`, `7d`) | Custom regex | `ms` npm package — OR small 10-line helper | Zero-dep helper is fine here: `^(\d+)(h|d|m|s)$` → milliseconds. Already a precedent in the project to avoid tiny deps. |
| SQLite schema migration | Custom migration runner | Idempotent `CREATE TABLE IF NOT EXISTS` (project convention) | Project precedent in every per-agent store (`memory.db`, `usage.db`). No phase has used a real migration runner yet. |
| Tool-call span capture | Instrumenting individual MCP tool handlers | SDK `SDKToolProgressMessage` + content-block inspection | SDK gives us timing for free. Instrumenting handlers requires touching every MCP tool — out of scope and fragile. |
| Percentile aggregation across agents (`--all` flag) | Daemon computes cross-agent rollup | Each agent's trace_store returns its own percentiles; aggregate in the CLI/IPC layer | Keeps per-agent stores truly isolated; CLI aggregates for presentation. |

**Key insight:** Everything for Phase 50 already exists in the codebase as a precedent — this phase is largely a mechanical copy-and-adapt of `usage/tracker.ts`, `cli/commands/costs.ts`, and `heartbeat/checks/attachment-cleanup.ts`. The only genuinely new design is the span batching protocol, which is ~40 lines.

## Common Pitfalls

### Pitfall 1: Turn ID Collisions Across Daemon Restarts

**What goes wrong:** Discord `message.id` is a snowflake unique across all Discord channels at write time, but if the daemon processes the same message twice (restart mid-flight, Discord redelivery), two turn rows appear with duplicate primary keys.

**Why it happens:** Discord gateway resends on reconnect; daemon restart without message ACK.

**How to avoid:** Use `INSERT OR REPLACE INTO traces` on turn commit, keyed on `id`. First committed wins metadata; overwrite preserves the more-complete record. Alternative: `INSERT OR IGNORE` — discards late/duplicate records.

**Warning signs:** `SqliteError: UNIQUE constraint failed` in logs under restart conditions.

### Pitfall 2: sendAndCollect / sendAndStream Divergence

**What goes wrong:** Phase instrumentation added to `sendAndStream` only (Discord path) misses non-Discord turns — scheduled prompts go through `sendToAgent` → `sendAndCollect`, which has a separate iteration loop in `session-adapter.ts`.

**Why it happens:** Three entry points into session adapter (`send`, `sendAndCollect`, `sendAndStream`), each with its own `for await (const msg of q)` loop. Easy to instrument one and miss the others.

**How to avoid:** Extract a single internal method (e.g., `iterateQuery(prompt, onAssistant, onResult)`) and call it from all three send variants. Instrument in the shared method. Alternatively, explicitly wrap all three call sites — tests must assert tracing fires on all three.

**Warning signs:** Dashboard shows zero data for scheduler-initiated agents (cron-only agents) while Discord-facing agents report fine.

### Pitfall 3: First-Token Measurement Includes Session-Resume Overhead

**What goes wrong:** Each `sendAndStream` call creates a fresh `query()` with `resume: sessionId`. The first assistant message is emitted after session resume, context replay, and prompt caching — not after the model starts generating. p50 first-token is inflated by ~200-500ms of SDK overhead.

**Why it happens:** The SDK per-turn-query pattern (documented in `sdk-types.ts`) requires session resumption before each turn.

**How to avoid:** Be explicit in docs: `first_token` is "time from send dispatch to first assistant chunk" — inclusive of SDK resume latency. This is actually desirable because it matches user-perceived latency. If Phase 54 (STREAM-01) wants pure model-time, add a second `model_first_token` span that starts after the first SDK `system/init` message.

**Warning signs:** first_token p50 significantly higher than Anthropic SDK benchmarks suggest it should be.

### Pitfall 4: Retention Deletes Active Turn Mid-Write

**What goes wrong:** The retention heartbeat fires during a high-traffic turn; its `DELETE FROM trace_spans WHERE turn_id NOT IN (SELECT id FROM traces)` finds no parent row for spans belonging to a turn that hasn't committed yet, and deletes them before `turn.end()` writes the parent.

**Why it happens:** The CONTEXT cleanup query assumes orphaned spans = retention-expired. It conflates "no parent" with "expired."

**How to avoid:** Restructure retention as a single transaction: (1) `DELETE FROM traces WHERE started_at < ?` — the parent rows. (2) Rely on `ON DELETE CASCADE` foreign key with `PRAGMA foreign_keys = ON` to drop child spans. Remove the orphan-cleanup DELETE entirely. If foreign keys aren't feasible, alternative: only delete spans where `turn_id IN (SELECT id FROM traces WHERE started_at < ?)` — never based on missing parent.

**Warning signs:** In-flight spans sporadically missing from completed turns.

### Pitfall 5: Write Amplification on Tool-Heavy Turns

**What goes wrong:** A single turn fires 20+ MCP tool calls (e.g., knowledge graph traversal). Each generates a `tool_call.<name>` span. If writes are per-span, 20 transactions fire in rapid succession under 14-agent concurrent load → WAL contention, SQLite write blocking, visible latency spike *caused by the instrumentation*.

**Why it happens:** Easy to make `span.end()` trigger a DB write.

**How to avoid:** Turn buffer collects all spans in memory; only `turn.end(status)` writes. One transaction per turn. Cap metadata JSON size (explicit `metadata_json` length check — skip or truncate if > 1KB per span).

**Warning signs:** `end_to_end` p95 increases by 50ms+ after Phase 50 deploy; SQLite `busy_timeout` warnings in logs.

### Pitfall 6: Subagent Spawn Creates Nested Turns

**What goes wrong:** `SDKAssistantMessage.parent_tool_use_id` is non-null for subagent responses. If subagent-generated assistant messages are treated as parent-turn `first_token` events, the wrong timestamp is recorded.

**Why it happens:** SDK re-emits assistant messages from subagents up to the parent query stream.

**How to avoid:** In the stream handler, check `msg.parent_tool_use_id === null` before marking `first_token`. Subagent messages have a non-null parent. Record subagent spans separately under `subagent.<name>` segment, or skip for now (deferred per scope).

**Warning signs:** first_token values suspiciously small (< 100ms) on agents that use subagent threads.

### Pitfall 7: better-sqlite3 Loaded Synchronously Blocks Event Loop

**What goes wrong:** Per-agent trace-store init at daemon startup opens 14+ SQLite handles synchronously. If called from a chain that includes other sync IO, startup latency grows. If retention runs synchronously in the heartbeat while a turn is being written, event-loop blocking is visible.

**Why it happens:** better-sqlite3 is intentionally sync.

**How to avoid:** Lazy-construct the trace-store on first span write, not at agent start. Retention DELETE is a single statement — measure it; expect sub-ms for a 7-day window under ~10K rows. If retention crosses 10ms threshold, batch the delete (`LIMIT 1000` in a loop).

**Warning signs:** Heartbeat tick duration > 100ms; agent startup time regression.

## Runtime State Inventory

**Not applicable.** This is a greenfield phase — no rename, refactor, or migration. No existing string rename, no cached OS/DB state to update. Skipping inventory per research protocol.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 LTS | Runtime | — | — | — (unchanged) |
| better-sqlite3 | TraceStore | ✓ | 12.8.0 | — |
| SQLite window functions (`ROW_NUMBER()`) | Percentile query | ✓ | SQLite 3.45+ (bundled w/ better-sqlite3 12.x) | — |
| @anthropic-ai/claude-agent-sdk | Stream events | ✓ | 0.2.97 | — |
| nanoid | Non-Discord turn IDs | ✓ | 5.1.7 | — |
| pino | Structured logging | ✓ | 9.x | — |
| commander | CLI command | ✓ | 14.0.3 | — |
| vitest | Tests | ✓ | 4.1.3 | — |
| date-fns | Retention cutoff | ✓ | 4.1.0 | — |
| zod v4 | Config validation | ✓ | 4.3.6 | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None — all tooling present in the working repo.

## Code Examples

### Start a turn + span (TraceCollector)
```typescript
// Source: new src/performance/trace-collector.ts (this phase)
import { nanoid } from "nanoid";

export class TraceCollector {
  constructor(
    private readonly store: TraceStore,
    private readonly log: Logger,
  ) {}

  startTurn(turnId: string, agent: string, channelId: string | null): Turn {
    return new Turn(turnId, agent, channelId, this.store, this.log);
  }
}

class Turn {
  private readonly spans: SpanRecord[] = [];
  private readonly startedAt = Date.now();
  constructor(
    private readonly id: string,
    private readonly agent: string,
    private readonly channelId: string | null,
    private readonly store: TraceStore,
    private readonly log: Logger,
  ) {}

  startSpan(name: string, metadata?: Record<string, unknown>): Span {
    return new Span(name, metadata, (rec) => { this.spans.push(rec); });
  }

  end(status: "success" | "error"): void {
    this.store.writeTurn(Object.freeze({
      id: this.id,
      agent: this.agent,
      channelId: this.channelId,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      totalMs: Date.now() - this.startedAt,
      status,
      spans: Object.freeze([...this.spans]),
    }));
  }
}
```

### Discord receive-span hook
```typescript
// Source: edit to src/discord/bridge.ts (around line 276)
private async handleMessage(message: Message): Promise<void> {
  const turn = this.traceCollector?.startTurn(message.id, /*agent*/ "?", message.channelId);
  const receive = turn?.startSpan("receive", { channel: message.channelId });
  try {
    // ... existing body ...
    receive?.end();
    // After streamAndPostResponse completes:
  } finally {
    turn?.end(/* status based on try/catch outcome */);
  }
}
```

### First-token + tool-call capture in session-adapter
```typescript
// Source: edit to src/manager/session-adapter.ts sendAndStream (around line 430)
async sendAndStream(message, onChunk, turn?: Turn): Promise<string> {
  const e2e = turn?.startSpan("end_to_end");
  const firstToken = turn?.startSpan("first_token");
  let firstTokenEnded = false;
  const activeTools = new Map<string, Span>();

  try {
    const q = sdk.query({ prompt: message, options: turnOptions() });
    for await (const msg of q) {
      // Filter out subagent-generated messages (parent_tool_use_id != null)
      if (msg.type === "assistant" && (msg as any).parent_tool_use_id === null) {
        // Inspect content blocks for tool_use starts
        const blocks = (msg as any).message?.content ?? [];
        for (const block of blocks) {
          if (block.type === "text" && !firstTokenEnded) {
            firstToken?.end();
            firstTokenEnded = true;
          }
          if (block.type === "tool_use") {
            const span = turn?.startSpan(`tool_call.${block.name}`, { tool_use_id: block.id });
            if (span) activeTools.set(block.id, span);
          }
        }
      }
      // SDK tool_progress messages give in-flight timing
      if (msg.type === "tool_progress") {
        const existing = activeTools.get(msg.tool_use_id);
        if (!existing) {
          const span = turn?.startSpan(`tool_call.${msg.tool_name}`, { tool_use_id: msg.tool_use_id });
          if (span) activeTools.set(msg.tool_use_id, span);
        }
      }
      // user messages with tool_use_result end the tool span
      if (msg.type === "user" && (msg as any).tool_use_result !== undefined) {
        const parent = (msg as any).parent_tool_use_id;
        const span = activeTools.get(parent);
        span?.end();
        activeTools.delete(parent);
      }
      if (msg.type === "result") {
        // ... existing usage extraction
        break;
      }
    }
    e2e?.end();
    return /* collected text */;
  } catch (err) {
    e2e?.end();
    throw err;
  }
}
```

### Percentile SQL query
```typescript
// Source: new src/performance/percentiles.ts (this phase)
const PERCENTILE_SQL = `
WITH ranked AS (
  SELECT s.duration_ms,
    ROW_NUMBER() OVER (ORDER BY s.duration_ms) AS rn,
    COUNT(*) OVER () AS total
  FROM trace_spans s
  JOIN traces t ON t.id = s.turn_id
  WHERE t.agent = @agent
    AND t.started_at >= @since
    AND (@span_name = 'tool_call' AND s.name LIKE 'tool_call.%'
         OR s.name = @span_name)
)
SELECT
  CAST(MIN(CASE WHEN rn >= CAST(total * 0.50 AS INTEGER) + 1 THEN duration_ms END) AS INTEGER) AS p50,
  CAST(MIN(CASE WHEN rn >= CAST(total * 0.95 AS INTEGER) + 1 THEN duration_ms END) AS INTEGER) AS p95,
  CAST(MIN(CASE WHEN rn >= CAST(total * 0.99 AS INTEGER) + 1 THEN duration_ms END) AS INTEGER) AS p99,
  total AS count
FROM ranked;
`;
```

### Retention heartbeat check
```typescript
// Source: new src/heartbeat/checks/trace-retention.ts (this phase)
import { subDays } from "date-fns";
import type { CheckModule, CheckResult } from "../types.js";

const traceRetentionCheck: CheckModule = {
  name: "trace-retention",
  async execute(context): Promise<CheckResult> {
    const { agentName, sessionManager } = context;
    const agentConfig = sessionManager.getAgentConfig(agentName);
    if (!agentConfig) return { status: "healthy", message: "No config" };

    const retentionDays = agentConfig.perf?.traceRetentionDays ?? 7;
    const cutoff = subDays(new Date(), retentionDays).toISOString();
    // Assume traceStore is reachable via sessionManager or DI
    const store = sessionManager.getTraceStore(agentName);
    if (!store) return { status: "healthy", message: "No trace store" };

    const deleted = store.pruneOlderThan(cutoff);
    return {
      status: "healthy",
      message: deleted > 0 ? `Pruned ${deleted} expired turn(s)` : "No expired traces",
      metadata: { deleted, cutoff },
    };
  },
};
export default traceRetentionCheck;
```

### CLI command registration
```typescript
// Source: new src/cli/commands/latency.ts (mirrors costs.ts)
import type { Command } from "commander";
import { sendIpcRequest } from "../../ipc/client.js";
import { SOCKET_PATH } from "../../manager/daemon.js";

export function registerLatencyCommand(program: Command): void {
  program
    .command("latency [agent]")
    .description("Show per-agent latency percentiles (p50/p95/p99)")
    .option("--since <duration>", "Time window (1h, 6h, 24h, 7d)", "24h")
    .option("--all", "Aggregate across all agents")
    .option("--json", "Emit JSON instead of table")
    .action(async (agent, opts) => {
      const result = await sendIpcRequest(SOCKET_PATH, "latency", {
        agent: opts.all ? undefined : agent,
        all: opts.all === true,
        since: opts.since,
      });
      if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
      console.log(formatLatencyTable(result));
    });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `sqlite-vss` vector extension | `sqlite-vec` | 2024 | N/A for this phase — but sqlite-vec is loaded in the memory store and coexists fine with non-vec tables in `traces.db`. |
| `unstable_v2_createSession` | `query()` API with `resume` | Phase pre-50 (already migrated) | First-token and tool-call hooks must use `query()` stream iteration — confirmed in `src/manager/session-adapter.ts`. |
| `@xenova/transformers` v2 | `@huggingface/transformers` v4 | N/A | No bearing on this phase. |
| Custom percentile math in JS | SQLite `ROW_NUMBER()` window functions | SQLite 3.25 (2018) | better-sqlite3 12.x ships SQLite ≥ 3.45, so window functions are freely usable. |

**Deprecated/outdated:**
- Do not reach for `@opentelemetry/api` or `@opentelemetry/sdk-node` — explicitly excluded by CONTEXT.md ("No OpenTelemetry dependency"), and unnecessary for a single-process local trace store.
- Do not use the SDK's `includePartialMessages: true` for first-token detection unless sub-ms accuracy becomes critical — the first `assistant` message is sufficient and the loop is already processing it.

## Open Questions

1. **Should `first_token` include SDK session-resume overhead?**
   - What we know: Per-turn-query + `resume: sessionId` adds ~200-500ms before the first model token. Current design measures from send dispatch (inclusive).
   - What's unclear: Phase 54 (STREAM-01) may want pure model first-token for SLO targets.
   - Recommendation: Ship inclusive-measurement in Phase 50. Phase 54 can add a second `model_first_token` span if needed; the trace schema is flexible.

2. **`--all` fleet rollup: true percentiles vs. average of per-agent percentiles?**
   - What we know: CONTEXT says "aggregate percentiles" for `--all`. True p95 across fleet requires fetching all underlying spans across all agent DBs and ranking jointly.
   - What's unclear: Whether "aggregate" means median-of-medians or true cross-fleet percentile.
   - Recommendation: True percentiles. Implementation: daemon IPC method loops agent DBs, `UNION ALL`s rows via `ATTACH DATABASE`, then runs one percentile query. SQLite supports ATTACH up to 10 by default (configurable higher). For 14+ agents, process in batches and merge span arrays in JS as a fallback.

3. **How to capture non-Discord turns (scheduler, subagent spawn, inbox check)?**
   - What we know: Scheduler calls `sendToAgent` → `sendAndCollect`. Inbox heartbeat check forwards filesystem messages through the same path. Subagent spawning goes through `SubagentThreadSpawner` and ultimately hits a session.
   - What's unclear: Exact call site for `traceCollector.startTurn()` in non-Discord paths.
   - Recommendation: Wrap at `SessionManager.sendToAgent` / `streamFromAgent` if no turn was already started upstream. Use `turn_id = "scheduler:<nanoid>"` or `"subagent:<parent_id>"` prefix. This catches every entry point without touching each caller.

4. **Should retention be keyed per-agent or global?**
   - What we know: `perf.traceRetentionDays` is per-agent per CONTEXT. Heartbeat runs per-agent.
   - What's unclear: Nothing — CONTEXT is explicit.
   - Recommendation: Confirmed per-agent. Default 7 days. No action needed.

5. **Index strategy for large retention windows.**
   - What we know: CONTEXT specifies `(agent, started_at)` and `(turn_id, name)` indices.
   - What's unclear: Whether a covering index on `trace_spans(duration_ms, name)` helps percentile queries at high volume.
   - Recommendation: Ship with the two specified indices. Add an EXPLAIN QUERY PLAN test; add covering index only if p95 query latency exceeds ~50ms in practice.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/performance` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PERF-01 | `TraceCollector.startTurn → startSpan → end` writes turn + spans to SQLite in one transaction | unit | `npx vitest run src/performance/__tests__/trace-collector.test.ts` | ❌ Wave 0 |
| PERF-01 | Discord receive-span captured at `DiscordBridge.handleMessage` | unit | `npx vitest run src/discord/__tests__/bridge.test.ts -t "receive span"` | ❌ Wave 0 (extend existing bridge.test.ts) |
| PERF-01 | `context_assemble` span wraps `ContextAssembler.assemble` | unit | `npx vitest run src/manager/__tests__/context-assembler.test.ts -t "tracing"` | ❌ Wave 0 |
| PERF-01 | `first_token` span ends on first assistant text block | unit | `npx vitest run src/manager/__tests__/session-adapter.test.ts -t "first_token"` | ❌ Wave 0 |
| PERF-01 | `tool_call.<name>` span captured from content blocks + `tool_progress` messages | unit | `npx vitest run src/manager/__tests__/session-adapter.test.ts -t "tool_call"` | ❌ Wave 0 |
| PERF-01 | `end_to_end` span measures from receive → reply send | integration | `npx vitest run src/discord/__tests__/bridge.test.ts -t "end_to_end"` | ❌ Wave 0 |
| PERF-01 | Subagent messages (`parent_tool_use_id != null`) do NOT trigger parent `first_token` | unit | `npx vitest run src/manager/__tests__/session-adapter.test.ts -t "subagent"` | ❌ Wave 0 |
| PERF-01 | Scheduler-initiated turn gets `scheduler:` prefixed turn_id | unit | `npx vitest run src/scheduler/__tests__/scheduler.test.ts -t "trace"` | ❌ Wave 0 |
| PERF-01 | Traces persist across daemon restart (schema file still there) | integration | `npx vitest run src/performance/__tests__/trace-store.test.ts -t "persists"` | ❌ Wave 0 |
| PERF-01 | Retention heartbeat deletes turns older than `traceRetentionDays` | unit | `npx vitest run src/heartbeat/checks/__tests__/trace-retention.test.ts` | ❌ Wave 0 |
| PERF-01 | Retention uses `ON DELETE CASCADE` to remove child spans | unit | `npx vitest run src/performance/__tests__/trace-store.test.ts -t "cascade"` | ❌ Wave 0 |
| PERF-02 | Percentile SQL returns p50/p95/p99/count for each canonical segment | unit | `npx vitest run src/performance/__tests__/percentiles.test.ts` | ❌ Wave 0 |
| PERF-02 | `clawcode latency <agent>` prints table with all four segments | unit | `npx vitest run src/cli/commands/__tests__/latency.test.ts` | ❌ Wave 0 |
| PERF-02 | `clawcode latency --json` emits machine-readable JSON | unit | `npx vitest run src/cli/commands/__tests__/latency.test.ts -t "json"` | ❌ Wave 0 |
| PERF-02 | `clawcode latency --all` aggregates across agents | unit | `npx vitest run src/cli/commands/__tests__/latency.test.ts -t "all"` | ❌ Wave 0 |
| PERF-02 | `--since` accepts `1h` / `6h` / `24h` / `7d` | unit | `npx vitest run src/performance/__tests__/percentiles.test.ts -t "since parser"` | ❌ Wave 0 |
| PERF-02 | `GET /api/agents/:name/latency` returns same shape as CLI `--json` | integration | `npx vitest run src/dashboard/__tests__/server.test.ts -t "latency"` | ❌ Wave 0 |
| PERF-02 | Dashboard panel renders percentile table | manual-only | N/A — browser smoke check after merge (pattern matches existing Cost panel, manual acceptance) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/performance` (new subsystem tests, fast)
- **Per wave merge:** `npm test` (full suite — catches regressions in bridge.ts, session-adapter.ts, context-assembler.ts)
- **Phase gate:** `npm test` green + manual browser check of dashboard latency panel before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/performance/__tests__/trace-collector.test.ts` — collector unit tests
- [ ] `src/performance/__tests__/trace-store.test.ts` — store + retention tests
- [ ] `src/performance/__tests__/percentiles.test.ts` — SQL percentile math + since-string parser
- [ ] `src/cli/commands/__tests__/latency.test.ts` — CLI formatter tests (follow `costs.test.ts`)
- [ ] `src/heartbeat/checks/__tests__/trace-retention.test.ts` — retention check unit test
- [ ] Extensions to existing `src/discord/__tests__/bridge.test.ts`, `src/manager/__tests__/session-adapter.test.ts`, `src/manager/__tests__/context-assembler.test.ts` for span capture assertions
- [ ] Framework install: none — vitest already present

## Project Constraints (from CLAUDE.md)

Captured so the planner can verify compliance:

- **Identity:** Every response must include the `💠` emoji (Clawdy identity). Applies to agent responses, not to tool output — but if tests produce human-facing output (e.g., CLI text), keep this in mind for message templates.
- **Stack:** TypeScript 6.0.2, Node.js 22 LTS, ESM-only (`"type": "module"`). All imports use `.js` extension.
- **Databases:** `better-sqlite3` 12.8.0 with WAL mode, `busy_timeout = 5000`, `synchronous = NORMAL` pragmas. Prepared statements in constructor.
- **Config:** Zod v4 (`import { z } from "zod/v4"`). Derive TS types via `z.infer<typeof schema>`.
- **Immutability (global rule):** Never mutate. Always create new objects. `Object.freeze` returned records. `readonly` on all type properties.
- **File size:** 200–400 lines typical, 800 max. Split if a module grows — e.g., split `trace-collector.ts` from `trace-store.ts`.
- **Error handling (global rule):** Custom error classes extending Error; set `this.name`; never silently swallow.
- **Logging:** pino singleton from `src/shared/logger.ts`; use `.child({ agent, turnId })` for correlation.
- **Security (global rule):** No hardcoded secrets; validate all inputs; no sensitive data in logs or in `metadata_json`. Explicitly: no prompt bodies, no message contents in trace metadata.
- **Git workflow (global rule):** Commit type prefix required (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`).
- **GSD workflow (project rule):** Direct Edit/Write permitted only inside a GSD command — this phase runs inside `/gsd:execute-phase`.

## Sources

### Primary (HIGH confidence)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — Verified `SDKAssistantMessage.message: BetaMessage`, `SDKToolProgressMessage { type: 'tool_progress', tool_use_id, tool_name, elapsed_time_seconds }`, `SDKPartialAssistantMessage { type: 'stream_event', event: BetaRawMessageStreamEvent }`, `hooks.PreToolUse / PostToolUse` callback shape, `includePartialMessages` option.
- `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts` — Verified `BetaContentBlock = BetaTextBlock | BetaToolUseBlock | ...`, `BetaToolUseBlock { id, input, name, type: 'tool_use' }`.
- `src/usage/tracker.ts` — Per-agent SQLite pattern to mirror verbatim.
- `src/cli/commands/costs.ts` — CLI command template.
- `src/heartbeat/checks/attachment-cleanup.ts` — Auto-discovered heartbeat check template.
- `src/heartbeat/discovery.ts` — Auto-discovery mechanism (no registration code needed).
- `src/dashboard/server.ts` — REST endpoint pattern (node:http, IPC passthrough).
- `src/manager/session-adapter.ts` — Current stream iteration loop; hook point for first_token + tool_call.
- `src/discord/bridge.ts` — `handleMessage` entry; hook point for `receive` + `end_to_end`.
- `.planning/codebase/CONVENTIONS.md` — Project coding conventions (readonly, Object.freeze, Deps pattern, error classes).
- `.planning/codebase/INTEGRATIONS.md` — Stack versions.
- `.planning/codebase/STRUCTURE.md` — Project layout.

### Secondary (MEDIUM confidence)
- SQLite documentation on window functions (SQLite 3.25+) — supported in better-sqlite3 12.x (bundled SQLite 3.45+). Verified via dependency version.
- better-sqlite3 WAL-mode write performance characteristics — commonly quoted ~5K-10K single-process transactions/sec; treat as guideline, not contract, for overhead budgeting.

### Tertiary (LOW confidence)
- Exact `parent_tool_use_id` semantics for subagent-emitted assistant messages — inferred from SDK type definitions; runtime behavior should be confirmed by an integration test. Flag for validation in Wave 0.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies present in `package.json`; versions verified.
- Architecture: HIGH — every pattern has an existing in-repo precedent (`usage/tracker.ts`, `cli/commands/costs.ts`, `heartbeat/checks/attachment-cleanup.ts`, `dashboard/server.ts`).
- SDK stream event shapes: HIGH — read directly from installed SDK type definitions.
- Tool-call span mechanics: MEDIUM — two viable approaches (content-block inspection vs. `hooks.PreToolUse`). Content-block approach recommended; `hooks` approach documented as fallback if timing precision demands it.
- Non-Discord turn capture point: MEDIUM — `SessionManager.sendToAgent` / `streamFromAgent` is the recommended unified entry, but integration with scheduler and subagent paths should be validated against existing call sites during planning.
- Percentile SQL: HIGH — standard `ROW_NUMBER()` window function pattern, SQLite-compatible.
- Subagent filtering (`parent_tool_use_id`): MEDIUM — from type definitions; needs runtime validation test.

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (30 days — stable stack, no fast-moving surface)
