# Phase 61: Additional Trigger Sources - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Four real-world trigger source adapters register against the Phase 60 TriggerEngine: MySQL row-change polling, webhook HTTP endpoint, chokidar-based inbox file watching, and Google Calendar event polling via MCP. Each implements the TriggerSource interface, uses the engine's dedup→policy→dispatch pipeline, and persists watermarks in trigger_state.

</domain>

<decisions>
## Implementation Decisions

### MySQL DB-Change Source (TRIG-02)
- Polling with `SELECT ... WHERE id > ?` — configurable poll interval (default 30s). No binlog/replication dependency. Avoids the @vlasky/zongji operational burden.
- Committed-read isolation — secondary confirmation query after watermark advance to handle ROLLBACKed rows. If row disappears on re-query, watermark stays at old value.
- mysql2/promise pool — single shared connection pool in the daemon (pool size 2), passed to MysqlSource. Graceful close on shutdown.
- New dependency: `mysql2` (npm) — standard MySQL driver, already used by Finmentum's MCP server.

### Webhook Source (TRIG-03)
- New route on existing dashboard HTTP server — `/webhook/<triggerId>` handled in `src/dashboard/server.ts`. No new port, no new process.
- HMAC verification via `crypto.timingSafeEqual` + `crypto.createHmac('sha256', secret)` — per-source secrets stored in clawcode.yaml trigger config. Verify before parsing body. 401 (missing sig), 403 (invalid sig). Max body 64KB.

### Inbox Source (TRIG-04)
- chokidar 4.x (already in package.json) — `watch(inboxDir, { awaitWriteFinish: { stabilityThreshold: 500 } })`. On 'add' event, read file, ingest through TriggerEngine, move to processed/.
- InboxSource REPLACES the existing heartbeat inbox check as primary delivery path. The existing `src/heartbeat/checks/inbox.ts` becomes a reconciler/fallback (belt-and-suspenders) — not the primary path.

### Calendar Source (TRIG-05)
- Poll via `google-workspace` MCP tool — CalendarSource calls existing MCP server's `events.list` with `syncToken` for incremental updates. No new Google API dependency. Poll interval configurable (default 5min).
- Once-per-event firing via fired event ID tracking in trigger_state cursor_blob — CalendarSource maintains a Set of event IDs already fired. On each poll, compute `now + offset` window, fire for events in window not in Set. Persist Set as JSON in cursor_blob.
- Push channel renewal via croner cron job inside CalendarSource — schedule renewal every 6 days (channels expire after 7). If push fails, fall back to polling. Logged as info-level.

### Cross-Cutting Config
- Per-source config blocks in clawcode.yaml under `triggers:` — each source type has a typed section (mysql, webhook, inbox, calendar) with Zod validation at daemon start. Sources enabled/disabled per-agent.

### Claude's Discretion
- Internal file organization under src/triggers/sources/ (new subdirectory) — e.g. mysql-source.ts, webhook-source.ts, inbox-source.ts, calendar-source.ts — or flat under src/triggers/.
- mysql2 pool configuration details beyond pool size 2.
- chokidar watcher options beyond awaitWriteFinish.
- Exact calendar MCP tool call shape (depends on google-workspace MCP server API).
- Test layout and mocking strategy for external dependencies (mysql2, chokidar, MCP).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/triggers/engine.ts` — TriggerEngine with ingest(), replayMissed(), TriggerSource interface registration
- `src/triggers/types.ts` — TriggerSource interface with start/stop/sourceId/poll methods
- `src/triggers/scheduler-source.ts` — Reference implementation of a TriggerSource adapter
- `src/heartbeat/checks/inbox.ts` — Existing inbox heartbeat check (to be demoted to fallback)
- `src/collaboration/inbox.ts` — readMessages(), markProcessed() utilities
- `src/dashboard/server.ts` — Dashboard HTTP server (webhook route target)
- `src/config/watcher.ts` — Existing chokidar usage pattern in the codebase

### Established Patterns
- TriggerSource interface: start(), stop(), sourceId, poll?(since) — from Phase 60
- Watermark persistence via TaskStore.upsertTriggerState() / getTriggerState()
- Daemon boot sequence with numbered steps
- Zod schemas for all config and persistent shapes
- HeartbeatRunner CheckModule pattern for periodic checks

### Integration Points
- TriggerEngine.registerSource() — register each new source
- TaskStore.upsertTriggerState() — persist watermarks per source
- dashboard/server.ts — add /webhook/<triggerId> route handler
- clawcode.yaml — new triggers config section
- config/schema.ts — Zod schemas for trigger source configs
- daemon.ts — create source instances, register with engine

</code_context>

<specifics>
## Specific Ideas

- The Finmentum `pipeline_clients` table is the primary MySQL polling target. Config should allow specifying table, id column, and optional WHERE filter.
- Inbox InboxSource should maintain backward compatibility — files written by existing collaboration/inbox.ts still work.
- Calendar offset is configurable per-trigger (default 15 minutes before event start).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
