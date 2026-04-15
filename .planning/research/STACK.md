# Stack Research: v1.8 Proactive Agents + Handoffs

**Domain:** External-trigger detection, declarative policy matching, cross-agent typed RPC, durable task lifecycle
**Researched:** 2026-04-13
**Confidence:** HIGH

## Scope

This research covers ONLY new additions required for v1.8. The existing validated stack (TypeScript 6.0, Node.js 22 LTS, @anthropic-ai/claude-agent-sdk 0.2.x, better-sqlite3 12.x, sqlite-vec 0.1.9, @huggingface/transformers 4.x, croner 10.x, execa 9.x, zod 4.x, pino 9.x, discord.js 14.x, @modelcontextprotocol/sdk, chokidar 5.x, nanoid 5.x) is NOT re-evaluated — it is reused wherever possible.

The existing substrate already provides:
- A Unix-socket JSON-RPC 2.0 IPC server with zod-validated request/response schemas (`src/ipc/protocol.ts`)
- A Node-built-in `http.createServer` dashboard (`src/dashboard/server.ts`) — no framework
- An MCP server on stdio (`src/mcp/server.ts`) used for subagent-thread spawning and agent-to-agent messaging
- Per-agent SQLite stores following an established "per-agent `.db` under workspace" pattern
- A `croner`-backed TaskScheduler already running scheduled consolidations and daily summary cron jobs
- A file-inbox cross-agent messaging primitive watched via `chokidar`

The answer below is deliberately minimal: almost every v1.8 capability can be built on top of this substrate with a small, focused dependency footprint.

## Recommended Stack Additions

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **(no new core)** | — | Trigger scheduler / policy engine / RPC transport / task store | All four v1.8 capabilities can be built on top of the existing substrate (croner + better-sqlite3 + the Unix-socket JSON-RPC server + zod). Adding a workflow orchestrator here would fight the Agent SDK's own process lifecycle the same way PM2 would have. See "What NOT to Add" below for the full list of rejected heavyweight options. |
| **@vlasky/zongji** | 0.6.1 (pub 2026-02-13) | MySQL 5.7 / 8.0 binlog change-stream (CDC) | The only actively maintained Zongji fork in 2026 (nevill/, rodrigogs/, manojVivek/ forks last published 2022). `@vlasky/zongji` is the canonical community fork used by PlanetScale tooling and is the upstream for `@powersync/mysql-zongji`. Gives row-level INSERT/UPDATE/DELETE events in real time with zero load on the query layer — polling SELECTs of Finmentum tables would miss deletes, create DB load, and couple the trigger engine to every table schema. Use binlog CDC by default; fall back to polling only when binlog access is not available. |
| **node-ical** | 0.26.0 | ICS feed parser (RFC 5545) | Only used for the ICS-fallback calendar trigger source. 3M+ weekly downloads, zero runtime deps, handles recurring events via RRULE expansion. Included as an optional trigger source for any user whose calendar is exposed as an `.ics` URL rather than Google Calendar API. |
| **googleapis** | 171.x | Google Calendar API client (watch channels + incremental sync) | May already be a transitive need for the google-workspace MCP integration. Google Calendar's `events.watch` push channels expire every 7 days and Google's own docs state notifications are "not 100% reliable" — the robust pattern is push channel + periodic incremental sync via `syncToken`. `googleapis` is the official SDK; using it keeps the OAuth/token path consistent with the existing MCP workspace integration. Only pull in if the Google Calendar MCP does not already expose change notifications to us (verify during Phase 1 of v1.8). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **p-retry** | 8.0.0 | Exponential backoff for cross-agent task retries and webhook delivery | When an agent-to-agent RPC call times out or returns a retryable error, the caller's task record needs bounded retries with jitter. `p-retry` is the smallest well-maintained option (sindresorhus, 10M+ DL/week), ESM-native, uses `retry` under the hood. Prefer this over hand-rolling `setTimeout(exponential)` which always gets jitter wrong. |
| **p-timeout** | 7.0.1 | Hard-deadline enforcement for cross-agent RPC | Each handoff has an agent-configurable timeout (default ~5 min). `p-timeout` wraps a Promise with `AbortController` cancellation so we can propagate cancellation into the callee agent's turn via the SDK's `AbortSignal`. |
| **p-queue** | 9.1.2 | Bounded concurrency per callee agent | A single callee agent can only meaningfully service one handoff at a time (Claude Code sessions are single-threaded). `p-queue` with `concurrency: 1` gives us an ordered per-agent mailbox without Redis/BullMQ. Already used internally by several stack deps. |
| **raw-body** | 3.0.2 | Safe request body buffering for webhook receiver | Node's built-in `http` leaves body handling to you. `raw-body` is the Node ecosystem standard (used by Express, Koa, Fastify internals) with a hard size limit to prevent OOM on malicious webhook payloads. Tiny (~14KB), zero transitive deps. |

### Schema-Only Additions (No New Dependencies)

The task lifecycle store extends the existing per-daemon SQLite pattern. New file: `~/.clawcode/state/tasks.db` (daemon-scoped, NOT per-agent — tasks cross agent boundaries by definition).

```sql
-- Cross-agent handoff / task lifecycle
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,                -- nanoid
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  source TEXT NOT NULL,               -- 'trigger:<name>' | 'agent:<id>' | 'user:<channel>'
  from_agent TEXT,                    -- NULL when source is trigger/user
  to_agent TEXT NOT NULL,
  task_type TEXT NOT NULL,            -- 'handoff' | 'triggered'
  schema_name TEXT,                   -- named typed-RPC contract (e.g. 'research.deep-dive')
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN
    ('queued','dispatched','in_progress','completed','failed','cancelled','timeout')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL DEFAULT 300000,
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  completed_at TEXT,
  result_json TEXT,                   -- populated on success
  error_json TEXT                     -- populated on failure/timeout
);

CREATE INDEX IF NOT EXISTS idx_tasks_to_agent_status ON tasks(to_agent, status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);

-- Durable trigger state (sync tokens, last-seen binlog position, etc.)
CREATE TABLE IF NOT EXISTS trigger_state (
  trigger_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'mysql_binlog' | 'gcal_watch' | 'ics_poll' | 'webhook' | 'inbox_watch' | 'scheduled'
  cursor_json TEXT NOT NULL,          -- e.g. { log_file, log_pos } or { sync_token, channel_id, expires_at }
  last_tick_at TEXT NOT NULL,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);
```

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **(existing: vitest, tsx, tsup, typescript)** | Unchanged | v1.8 adds no new dev tooling. Fake-timers in vitest already handle cron-scheduled trigger tests. |
| **docker-compose (dev only)** | MySQL 8 + binlog enabled for CDC integration tests | Not a runtime dep — needed in `docker-compose.test.yml` to spin up a MySQL with `binlog_format=ROW` for zongji integration tests. Can alternatively use a shared dev MySQL, but containerised is reproducible. |

## Installation

```bash
# Core runtime additions
npm install @vlasky/zongji@^0.6.1 node-ical@^0.26.0

# Optional — only if Google Calendar MCP does not already surface push notifications
npm install googleapis@^171.0.0

# Supporting
npm install p-retry@^8.0.0 p-timeout@^7.0.1 p-queue@^9.1.2 raw-body@^3.0.2
```

No new dev dependencies.

## Integration Points with Existing Substrate

| v1.8 Capability | Existing Code to Extend | How |
|-----------------|------------------------|-----|
| Trigger engine scheduling loop | `src/manager/daemon.ts` + `TaskScheduler` (croner) | Register trigger sources as long-lived services started by the daemon lifecycle. Polling-based triggers (ICS, gcal sync-token sweep, polling CDC fallback) register as `croner` jobs. Stream-based triggers (zongji binlog, webhook HTTP, chokidar inbox) register as background listeners with their own backoff/restart supervision. |
| Policy layer | `src/config/schema.ts` (zod) + config hot-reload (v1.2) | Declare trigger→agent matching rules in `clawcode.yaml` under a `triggers:` key, validated with zod. Hot-reload already watches the config; reuse that mechanism so policy changes don't require daemon restart. |
| Webhook receiver | `src/dashboard/server.ts` (Node built-in http) | Add `/webhook/:triggerId` routes to the same http server. It already supports routing by path segment and JSON body handling — just add `raw-body` for size-bounded parsing and HMAC verification middleware. Zero new listeners, zero new ports. |
| Cross-agent RPC transport | `src/ipc/protocol.ts` + `src/ipc/server.ts` (Unix-socket JSON-RPC) | Add new IPC methods: `task-create`, `task-status`, `task-cancel`, `task-list`. Agents call these as **MCP tools** (exposed via `src/mcp/server.ts`) that proxy into the daemon IPC. The daemon is the single arbiter of task state — agents never talk to each other directly, avoiding the distributed-consensus problem entirely. |
| Timeout + cancellation | Agent SDK `AbortSignal` + `p-timeout` | `p-timeout` produces an `AbortController`; wire its signal into the SDK's `query({ abortController })` for the callee's turn. On cancellation, the daemon marks the task `cancelled` and the callee's current tool call is interrupted at the next safe point. |
| Task lifecycle store | New daemon-scoped `tasks.db` using better-sqlite3 | Same `new Database(path)` + synchronous prepared-statement pattern used by every other store. A single writer (the daemon) eliminates the concurrency concerns that would otherwise push us toward a real queue. Enable WAL mode for dashboard read concurrency. |
| Dashboard task graph | `src/dashboard/server.ts` + SSE (v1.2) | New endpoint `/api/tasks` + SSE channel `tasks:changed`. The existing SSE manager can broadcast task-state transitions. Front-end renders the parent→child task DAG. |
| CLI surface | `src/cli/commands/*` via commander | Add `clawcode tasks list|show|cancel` commands that call the new IPC methods. Same pattern as `clawcode status`, `clawcode schedules`, `clawcode memory search`. |

## Trigger Source Decision Matrix

| Source | Detection Mechanism | Rationale |
|--------|--------------------|-----------|
| **MySQL DB state (Finmentum)** | `@vlasky/zongji` binlog (`binlog_format=ROW`) with ROTATE/XID event-based checkpoint persisted to `trigger_state.cursor_json` | Row-level changes with zero query-layer load, catches DELETEs (polling can't), server-side filter by schema/table. Fall back to polling SELECT only when binlog access is unavailable. |
| **Calendar (Google)** | `events.watch` push channel (7-day TTL, auto-renew) + hourly `events.list(syncToken)` incremental sweep | Google's own docs classify push as "not 100% reliable"; pairing with a periodic sync-token poll is the canonical pattern. Channel renewal runs as a croner job. |
| **Calendar (ICS)** | `croner`-scheduled poll of the ICS URL, `node-ical` parse, diff against last snapshot hashed on `(uid, sequence, dtstart)` | For any user whose calendar isn't Google-hosted. Every 5-15 min is fine — ICS is cache-friendly. |
| **Inbox arrivals** | `chokidar` watch of `<agent>/inbox/` (existing primitive) | Already used for cross-agent messaging. Extends cleanly to "external inbox" semantics for email-bridge or file-drop triggers. |
| **Webhook hits** | New `/webhook/:triggerId` route on the existing dashboard `http.Server` | Already have the listener, just add routes. HMAC-SHA256 signature verification for inbound security. |
| **Scheduled observations** | `croner` job → synthesises a trigger event | Already available. Example: "every weekday 09:00, fire `daily-standup` trigger to admin agent." |

## Cross-Agent RPC Design Rationale

**Contract:** Every named handoff has a zod schema (`schema_name` in the `tasks` table) registered at daemon startup. Caller's payload is validated before dispatch; callee's result is validated before being written to `result_json`. Same mechanism as our IPC request/response validation — just extended to a typed-task catalogue.

**Transport:** The daemon's existing Unix-socket JSON-RPC server is the single choke point. Callers invoke a `task-create` MCP tool. The daemon:
1. Validates payload against `schema_name`.
2. Inserts a `queued` row into `tasks`.
3. Either (a) posts a `task-dispatch` notification to the callee agent's Claude Code session via the existing message-injection pathway, or (b) waits for the callee to long-poll via `task-claim` (for agents that prefer pull over push).
4. When the callee finishes, it calls `task-complete` with a result payload.
5. The original caller either awaited the promise or fire-and-forgot — in both cases the dashboard + CLI reflect the state transition.

**Why not synchronous RPC:** PROJECT.md's "Out of Scope" list explicitly rejects "Synchronous agent-to-agent RPC — async inbox pattern is simpler and more reliable." The task store IS the durable inbox. The caller's promise-await is a thin convenience layer over an async store, not a synchronous wire protocol.

**Cancellation path:** Caller issues `task-cancel(id)`. Daemon flips status to `cancelled`, fires the callee's `AbortSignal` (propagated through the SDK's `query({ abortController })`), and records the cancellation in the audit trail. If the callee is between tool calls, cancellation lands cleanly; if mid-tool, the tool completes and the next loop iteration sees the aborted state.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Extend existing croner + `Unix-socket JSON-RPC` + `tasks.db` | **BullMQ** (Redis-backed job queue) | Only if ClawCode grows to multiple daemon hosts that need a shared queue. Single-host, single-daemon doesn't justify the Redis operational dependency. BullMQ also fights the Agent SDK's own process lifecycle (it wants to own worker processes). |
| Extend existing croner + `tasks.db` | **Trigger.dev v4** (self-hosted) | If v2.0+ grows to dozens of triggers with complex multi-step workflows and we need a visual DAG editor. Adds Docker/Postgres/Redis as ops deps. At v1.8 scale this is overkill by about two orders of magnitude. |
| Extend existing croner + `tasks.db` | **Inngest** (self-hosted) | If event-driven fan-out with step-function semantics becomes core. Requires running the Inngest dev server / dedicated infra. For in-process, single-daemon orchestration it's overkill. |
| Extend existing croner + `tasks.db` | **Temporal.io** | If we ever need true distributed durable execution with weeks-long workflows and polyglot workers. Requires PostgreSQL/Cassandra + Elasticsearch + multiple server processes. Never appropriate for a single-host multi-agent daemon. |
| `@vlasky/zongji` (binlog CDC) | **Polling SELECT** with `updated_at > last_tick` | Fallback when MySQL binlog access isn't available (shared hosting, managed DB without replication user). Misses DELETEs, adds query load, requires a reliable `updated_at` column — only use when forced. |
| `@vlasky/zongji` | **`@powersync/mysql-zongji`** | Also actively maintained (last pub 2025-12). Pick this one if you already use PowerSync or need their specific MySQL 8.0 auth plugin enhancements. Functionally very close to `@vlasky/zongji`; pick one and stick with it. |
| `@vlasky/zongji` | **Database-level TRIGGER + outbox table** polled by ClawCode | Traditional "outbox pattern." Use if binlog is unavailable AND you can modify the target schema to add triggers + an outbox table. Gives near-zero-poll semantics via short poll. More intrusive than binlog; needs schema changes in Finmentum. |
| Extend existing dashboard `http.Server` for webhooks | Stand up a separate `fastify` or `hono` HTTP server for webhook ingest | Only if webhook volume exceeds ~100 req/s sustained and the dashboard HTTP server becomes a latency bottleneck. At that point split the listener; not before. |
| Node built-in `http` + `raw-body` | **Fastify** / **Hono** / **Express** for the webhook receiver | These frameworks are for apps with rich routing trees. We have ~5 routes. Adding a framework trades a 14KB dep for a 200KB+ dep plus the cognitive cost of another abstraction layer atop Node's http module. Revisit when we have 30+ routes. |
| Daemon-local `tasks.db` (SQLite WAL) | **PostgreSQL** (listen/notify for task dispatch) | If we ever need multiple daemons sharing task state. Same reasoning as BullMQ: single-daemon architecture doesn't justify it. |
| Daemon arbitrates all cross-agent RPC via its existing socket | Direct agent-to-agent Unix sockets or named pipes | Creates an N*N connection mesh, duplicates security policy, and sidesteps the central audit trail. Centralisation through the daemon is exactly the property that enables durable task lifecycle + audit log + policy enforcement. |
| `p-retry` + `p-timeout` + `p-queue` (in-process primitives) | Rolling your own with `setTimeout` | The three `p-*` libs are ~8KB combined, zero-dep (or single transitive), covered by sindresorhus's maintenance. Custom timers always get jitter, AbortSignal wiring, and unhandled-rejection cleanup wrong on the first three attempts. |

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **BullMQ** / **bee-queue** / **bullmq-pro** | Redis-backed distributed job queue. Adds a new long-running service (Redis) to a system that explicitly runs on a single host with per-agent SQLite. Operational complexity you'd pay for at every deploy. | `tasks.db` + `p-queue` (per-callee concurrency=1) |
| **Temporal.io** | Enterprise-grade durable execution engine. Requires PostgreSQL/Cassandra + Elasticsearch + multiple server processes. Designed for week-long cross-service workflows in polyglot shops. Orders of magnitude over-engineered for in-process agent handoffs. | Daemon-local `tasks.db` + zod contracts |
| **Trigger.dev v4** (self-hosted) | A whole separate self-hostable service with its own Docker stack, Postgres, Redis, worker pool, and deploy pipeline. Worth it at 50+ workflows, not at 5-10. Also: it wants to own worker processes — would fight the Agent SDK. | croner for schedulable triggers, zongji/Google watch for event triggers |
| **Inngest** (self-hosted) | Strong for event-driven step functions, but requires the Inngest dev-server infrastructure and encourages a specific programming model that doesn't map to persistent Claude Code sessions. | Daemon-local trigger dispatcher with zod-validated events |
| **Agenda** / **Bree** / **node-schedule** | All overlap with what croner already gives us. Adding a second scheduler bifurcates job surface area. | croner (already in stack) |
| **PM2** (as a workflow controller) | Still correct to reject for the same reason as v1.0: it fights the Agent SDK's process lifecycle. The trigger engine isn't a reason to reconsider. | Agent SDK + execa (already in stack) |
| **RabbitMQ / NATS / Kafka** | Durable message brokers for cross-service eventing. We have one service (the daemon). | Daemon-local `tasks.db` |
| **GraphQL Subscriptions / tRPC** | Fancy RPC layers that would compete with the existing JSON-RPC over Unix socket. We already have zod-validated typed RPC — that's literally what we want. | Extend `IPC_METHODS` with task-* methods |
| **Raw `child_process` IPC between agent processes** | Creates an N*N connection mesh, sidesteps the audit trail, and duplicates cancellation/timeout logic. | Daemon-arbitrated handoffs via existing IPC socket |
| **`@rodrigogs/mysql-events`** / **`nevill/zongji`** / **`rodrigogs/zongji`** / **`manojVivek/zongji`** / **`mysql-binlog-emitter`** | All last published in 2022 or earlier. Do not use for new production code in 2026 — no MySQL 8.0 `caching_sha2_password` support or it's bolted on with patches. | `@vlasky/zongji` (0.6.1, pub 2026-02-13) or `@powersync/mysql-zongji` (0.6.0, pub 2025-12) |
| **Polling SELECT on `updated_at`** (as primary strategy) | Cannot detect DELETEs, creates recurring query-layer load, fragile if the target schema lacks a reliable `updated_at`, requires per-table awareness. | Binlog CDC (`@vlasky/zongji`); polling only as last-resort fallback |
| **Only** Google Calendar push watch (no incremental sync) | Google's own docs: "notifications are not 100% reliable; a small percentage will be dropped under normal operating conditions." Channels also expire every 7 days. | Push watch **plus** periodic `events.list(syncToken)` sweep |
| **`chokidar@3`** for new code | Still works, but v5 is current. Would backfill a dep version on new code. | `chokidar@^5` (already in package.json) |
| **`zod@3`** schemas for new contracts | Existing code is already on zod 4. Mixing would bifurcate the validation layer. | `zod@^4.3.6` (already in package.json) |
| **Custom AbortController propagation** into the Agent SDK | The SDK already accepts `abortController`. Re-inventing it would bypass the SDK's own cleanup. | `p-timeout` → `AbortController` → `query({ abortController })` |
| **A second HTTP server just for webhooks** | Already running `http.createServer` for the dashboard. Adding a second listener means another port to manage, document, firewall, and test. | Extend the existing `src/dashboard/server.ts` router |

## Stack Patterns by Variant

**If DB binlog access is unavailable (managed MySQL without replication user):**
- Fall back to polling SELECT with `updated_at > :lastCursor` LIMIT N ORDER BY updated_at
- Accept the DELETE-invisibility tradeoff OR add an application-side soft-delete tombstone column
- Poll interval 30-60s; use the `trigger_state` table to persist the cursor across daemon restarts

**If trigger volume exceeds ~10 events/second sustained:**
- Add a staging queue inside `tasks.db` (`trigger_events` table with `claimed_at` column) so the dispatcher can batch
- Still no external dependencies — SQLite handles this comfortably up to hundreds of writes/second in WAL mode
- Re-evaluate only past 1000 events/second

**If a single callee agent becomes a bottleneck:**
- Raise `p-queue` concurrency from 1 — but this only works if the callee agent uses subagent-thread spawning for parallelism (Claude Code main session is single-threaded)
- More often the right answer is "route the trigger to a different agent" via the policy layer

**If v2.0 scales to multiple daemon hosts (deliberately out-of-scope for v1.8):**
- Promote `tasks.db` to PostgreSQL with `LISTEN/NOTIFY` for cross-daemon dispatch
- Re-evaluate Temporal/Inngest at that point — they become appropriate when distributed durability actually matters

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@vlasky/zongji@0.6.1` | MySQL 5.7, MySQL 8.0, MariaDB 10.x | Requires `binlog_format=ROW`, a replication user with `REPLICATION SLAVE, REPLICATION CLIENT` privileges, and `server_id` set. Handles `caching_sha2_password` (MySQL 8.0 default). |
| `@vlasky/zongji@0.6.1` | `mysql2@3.22.0` | zongji uses its own underlying connection handling — no direct compat requirement with `mysql2`, but if we reuse a `mysql2` pool for polling fallback, they coexist fine. |
| `googleapis@171` | Node.js 22 LTS | Official SDK; no issues. Calendar push channels require an HTTPS receiving URL (production LB must terminate TLS). |
| `node-ical@0.26.0` | Node.js 22 LTS | Pure JS, zero native deps. Parses RFC 5545. Note: recurring-event expansion is timezone-aware but relies on `vtimezone` blocks being present in the feed. |
| `p-retry@8`, `p-timeout@7`, `p-queue@9` | Node.js 22 LTS | All ESM-only. Project is already `"type": "module"` — no friction. |
| `raw-body@3` | Node.js 22 LTS | Unchanged API since v2. Used internally by Express 5 — battle-tested. |
| `better-sqlite3@12.x` | New `tasks.db` file | Same driver as existing memory stores. Enable WAL for dashboard read concurrency (`PRAGMA journal_mode=WAL`). |
| `@modelcontextprotocol/sdk` (existing) | New `task-*` MCP tools | MCP tool definitions are static JSON-schema — register them at server init. Already doing this for `memory_lookup`, `spawn-subagent-thread`, etc. |
| `@anthropic-ai/claude-agent-sdk@0.2.x` (existing) | Cancellation via AbortController | SDK's `query()` already accepts an `abortController` option. Verified against 0.2.97 (current installed version). |

## Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Binlog connection drops silently** | Supervise the zongji connection with exponential backoff reconnect; persist last-seen `log_file, log_pos` in `trigger_state.cursor_json`; emit a health metric consumed by the dashboard. |
| **Google Calendar push channel expires (7-day TTL) without renewal** | Run a croner job every 6 days to renew active watch channels; on renewal failure, fall back to periodic incremental sync via `syncToken` until the watch is re-established. |
| **Webhook receiver hit by unverified/spoofed requests** | Require per-trigger HMAC-SHA256 secret; reject requests without valid signature. `raw-body` must capture the exact bytes signed — do not re-serialise after parsing. |
| **Cross-agent task cycle (A delegates to B delegates to A)** | Track `parent_task_id` chain; reject new task creation if the chain length exceeds N (configurable, default 5) OR if the same `(from_agent, to_agent, schema_name)` tuple appears twice in the ancestor chain. |
| **Callee agent deadlocks mid-task** | `p-timeout` fires `AbortSignal`; daemon marks task `timeout`; next caller retry (within `max_attempts`) goes to the next available agent if the policy allows, else surfaces failure via dashboard + Discord. |
| **`tasks.db` grows unbounded** | Add a retention policy: move `completed`, `failed`, `cancelled`, `timeout` rows older than 30 days to `tasks_archive.db` (same schema). Already proven pattern from memory cold-archive. |

## Sources

- [@vlasky/zongji on npm](https://www.npmjs.com/package/@vlasky/zongji) — 0.6.1, published 2026-02-13 — HIGH (primary maintained fork)
- [@powersync/mysql-zongji on npm](https://www.npmjs.com/package/@powersync/mysql-zongji) — 0.6.0, published 2025-12-04 — HIGH (alternative fork)
- [PowerSync MySQL Zongji GitHub](https://github.com/powersync-ja/powersync-mysql-zongji) — MySQL 8.0 `caching_sha2_password` support details — HIGH
- [DataCater MySQL CDC guide](https://datacater.io/blog/2021-08-25/mysql-cdc-complete-guide.html) — binlog vs polling tradeoffs — MEDIUM
- [Percona MySQL CDC article](https://www.percona.com/blog/2016/09/13/mysql-cdc-streaming-binary-logs-and-asynchronous-triggers/) — binlog CDC rationale — MEDIUM (older but still canonical)
- [Google Calendar API — Push notifications docs](https://developers.google.com/workspace/calendar/api/guides/push) — "not 100% reliable; channels expire"; sync-token pattern — HIGH (official)
- [Nango — Real-time Google Calendar integration](https://www.nango.dev/blog/how-to-build-a-real-time-google-calendar-api-integration) — production webhook + incremental sync pattern — MEDIUM
- [Loris — Google Calendar webhook synchronization](https://lorisleiva.com/google-calendar-integration/webhook-synchronizations) — 7-day channel renewal lifecycle — MEDIUM
- [googleapis on npm](https://www.npmjs.com/package/googleapis) — 171.4.0 — HIGH (official SDK)
- [node-ical on npm](https://www.npmjs.com/package/node-ical) — 0.26.0 — HIGH
- [p-retry on npm](https://www.npmjs.com/package/p-retry) — 8.0.0 — HIGH (sindresorhus)
- [p-timeout on npm](https://www.npmjs.com/package/p-timeout) — 7.0.1 — HIGH (sindresorhus)
- [p-queue on npm](https://www.npmjs.com/package/p-queue) — 9.1.2 — HIGH (sindresorhus)
- [raw-body on npm](https://www.npmjs.com/package/raw-body) — 3.0.2 — HIGH (used internally by Express/Koa)
- [Trigger.dev vs Inngest vs Temporal (2026)](https://trybuildpilot.com/610-trigger-dev-vs-inngest-vs-temporal-2026) — when each is overkill — MEDIUM
- [Akka — Inngest vs Temporal comparison](https://akka.io/blog/inngest-vs-temporal) — infra requirements — MEDIUM
- [Medium — The Ultimate Guide to TypeScript Orchestration](https://medium.com/@matthieumordrel/the-ultimate-guide-to-typescript-orchestration-temporal-vs-trigger-dev-vs-inngest-and-beyond-29e1147c8f2d) — framework positioning — LOW
- [node-persistent-queue on npm](https://www.npmjs.com/package/node-persistent-queue) — SQLite-backed queue prior art — LOW (reference only; we're building a purpose-built task store)
- npm registry version lookups — all versions verified via `npm view` on 2026-04-13
- Existing codebase: `src/ipc/protocol.ts`, `src/dashboard/server.ts`, `src/mcp/server.ts`, `src/manager/daemon.ts`, `package.json` — HIGH (source of truth for substrate)

---
*Stack research for: v1.8 Proactive Agents + Handoffs*
*Researched: 2026-04-13*
