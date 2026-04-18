# Phase 61: Additional Trigger Sources - Research

**Researched:** 2026-04-17
**Domain:** TriggerSource adapters — MySQL polling, webhook HTTP, filesystem inbox, Google Calendar
**Confidence:** HIGH

## Summary

Phase 61 adds four TriggerSource adapters that plug into the Phase 60 TriggerEngine. Each implements the `TriggerSource` interface (`sourceId`, `start()`, `stop()`, optional `poll(since)`) and calls `engine.ingest(event)` to push TriggerEvents through the existing 3-layer dedup, policy evaluation, and TurnDispatcher dispatch pipeline. The engine contract, watermark persistence via `TaskStore.upsertTriggerState()`, and causation_id propagation are already proven in Phase 60.

The primary complexity is adapter-specific: mysql2 connection pool lifecycle and committed-read confirmation, HMAC signature verification on raw HTTP bodies before JSON parse, chokidar 5.x file watcher lifecycle with awaitWriteFinish, and Google Calendar polling via the MCP SDK client calling the existing google-workspace MCP server's `calendar_list_events` tool. mysql2 is the only new npm dependency. chokidar 5.x and the MCP SDK are already in node_modules. All four sources share the daemon wiring pattern established by SchedulerSource in Phase 60 Plan 03.

**Primary recommendation:** Build each source as a self-contained class in `src/triggers/sources/` following the SchedulerSource reference pattern, wire all four into daemon.ts after the existing SchedulerSource registration block, and extend `DashboardServerConfig` (or add a separate webhook handler injection point) for the webhook route.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- MySQL DB-Change Source (TRIG-02): Polling with `SELECT ... WHERE id > ?`, configurable poll interval (default 30s). No binlog/replication dependency. Committed-read isolation with secondary confirmation query. mysql2/promise pool (pool size 2), passed to MysqlSource. Graceful close on shutdown.
- Webhook Source (TRIG-03): New route on existing dashboard HTTP server at `/webhook/<triggerId>`. No new port or process. HMAC verification via `crypto.timingSafeEqual` + `crypto.createHmac('sha256', secret)`. Per-source secrets in clawcode.yaml. 401 (missing sig), 403 (invalid sig). Max body 64KB.
- Inbox Source (TRIG-04): chokidar 4.x (project has 5.x which is API-compatible) with `awaitWriteFinish: { stabilityThreshold: 500 }`. On 'add' event, read file, ingest through TriggerEngine, move to processed/. InboxSource REPLACES existing heartbeat inbox check as primary delivery path; existing heartbeat becomes reconciler/fallback.
- Calendar Source (TRIG-05): Poll via google-workspace MCP tool's `calendar_list_events` with time-window polling. Once-per-event firing via fired event ID tracking in trigger_state cursor_blob (JSON Set). Poll interval configurable (default 5min). Push channel renewal via croner cron job (every 6 days).
- Cross-cutting: Per-source config blocks in clawcode.yaml under `triggers:` with Zod validation at daemon start. Sources enabled/disabled per-agent.

### Claude's Discretion
- Internal file organization under src/triggers/sources/ (new subdirectory) vs flat under src/triggers/.
- mysql2 pool configuration details beyond pool size 2.
- chokidar watcher options beyond awaitWriteFinish.
- Exact calendar MCP tool call shape (depends on google-workspace MCP server API).
- Test layout and mocking strategy for external dependencies (mysql2, chokidar, MCP).

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRIG-02 | DB-change triggers poll a configurable MySQL SELECT with `last_seen_id` watermark, fire on new rows matching filter | mysql2/promise pool, `SELECT ... WHERE id > ? ORDER BY id ASC LIMIT N`, watermark stored via `TaskStore.upsertTriggerState()`, committed-read confirmation query pattern |
| TRIG-03 | Webhook triggers accept inbound HTTP POST, verify HMAC signature, dispatch to configured agent | Route on existing dashboard HTTP server (`/webhook/<triggerId>`), `node:crypto` HMAC-SHA256 + timingSafeEqual, raw body buffering before JSON parse, 64KB body limit |
| TRIG-04 | Inbox-arrival triggers fire immediately on write to collaboration/inbox filesystem | chokidar 5.x `watch()` with `awaitWriteFinish`, read file via existing `readMessages()`, ingest via engine, move to processed via existing `markProcessed()`. Replaces heartbeat inbox check as primary path. |
| TRIG-05 | Calendar triggers poll upcoming events via google-workspace MCP, fire at configurable offsets | MCP SDK `Client` + `StdioClientTransport` to spawn and call google-workspace MCP server's `calendar_list_events` tool with `time_min`/`time_max` window. Fired event IDs tracked in cursor_blob JSON. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mysql2 | 3.22.1 | MySQL connection pool + queries | Standard MySQL driver for Node.js. Already used by Finmentum's MCP server. Promise-based pool API. NEW dependency for this phase. |
| chokidar | 5.0.0 | Filesystem watching for inbox | Already in package.json (^5.0.0). Supports `awaitWriteFinish` with `stabilityThreshold`. Used by `src/config/watcher.ts`. |
| @modelcontextprotocol/sdk | 1.29.0 | MCP client for Calendar source | Already in node_modules (transitive). Provides `Client` + `StdioClientTransport` to spawn and call the google-workspace MCP server. |
| node:crypto | built-in | HMAC verification for webhooks | `createHmac('sha256', secret)`, `timingSafeEqual()`. Zero dependencies. |

### Supporting (already in project)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| croner | 10.0.1 | Calendar push channel renewal cron | Already used by SchedulerSource. CalendarSource uses it for 6-day renewal cycle. |
| zod | 4.3.6 | Config schema validation | Per-source config schemas validated at daemon start. |
| nanoid | 5.1.7 | Idempotency keys | Already used throughout. Each source generates unique keys. |
| pino | 9.x | Structured logging | Each source gets a child logger via `log.child({ component: 'MysqlSource' })`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| mysql2/promise pool | Raw mysql2 createConnection | Pool handles reconnection, connection reuse. Raw connections require manual lifecycle. Pool wins for long-running daemon. |
| MCP SDK client for calendar | googleapis direct | Would add googleapis (~50MB) as a dependency + credential management. MCP server already handles auth via 1Password. MCP client approach reuses existing infrastructure. |
| chokidar for inbox | node:fs.watch | node:fs.watch is unreliable across platforms, no `awaitWriteFinish`, no recursive watching. chokidar is the established pattern in this codebase. |

**Installation:**
```bash
npm install mysql2
```

**Version verification:** mysql2@3.22.1 verified via `npm view mysql2 version` on 2026-04-17. chokidar@5.0.0 already installed. @modelcontextprotocol/sdk@1.29.0 already in node_modules.

## Architecture Patterns

### Recommended Project Structure
```
src/triggers/
  sources/                    # NEW subdirectory for Phase 61
    mysql-source.ts           # TRIG-02
    webhook-source.ts         # TRIG-03
    inbox-source.ts           # TRIG-04
    calendar-source.ts        # TRIG-05
  types.ts                    # TriggerSource interface (Phase 60, unchanged)
  engine.ts                   # TriggerEngine (Phase 60, unchanged)
  source-registry.ts          # Registry (Phase 60, unchanged)
  scheduler-source.ts         # Phase 60 reference implementation
  dedup.ts                    # 3-layer dedup (Phase 60, unchanged)
  policy-evaluator.ts         # Policy evaluator (Phase 60, unchanged)
src/config/
  schema.ts                   # MODIFIED: add per-source trigger config schemas
src/dashboard/
  server.ts                   # MODIFIED: add /webhook/<triggerId> route
  webhook-handler.ts          # NEW: extracted webhook route handler
src/manager/
  daemon.ts                   # MODIFIED: wire 4 sources, create mysql pool, shutdown cleanup
```

### Pattern 1: TriggerSource Adapter (reference: SchedulerSource)
**What:** Each source is a class implementing `TriggerSource` with an `ingest` callback bound to `TriggerEngine.ingest`.
**When to use:** Every new trigger source follows this pattern.
**Example:**
```typescript
// Follows src/triggers/scheduler-source.ts pattern
export class MysqlSource implements TriggerSource {
  readonly sourceId: string;
  private readonly ingestFn: (event: TriggerEvent) => Promise<void>;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(options: MysqlSourceOptions) {
    this.sourceId = `mysql:${options.table}`; // unique per table
    this.ingestFn = options.ingest;
  }

  start(): void {
    this.intervalHandle = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
    this.intervalHandle.unref(); // CRITICAL: don't keep process alive
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async poll(since: string | null): Promise<readonly TriggerEvent[]> {
    // Watermark-based replay — SELECT WHERE id > since
  }

  private async pollOnce(): Promise<void> {
    const events = await this.poll(this.lastWatermark);
    for (const event of events) {
      await this.ingestFn(event);
    }
  }
}
```

### Pattern 2: Daemon Wiring (reference: SchedulerSource registration in daemon.ts)
**What:** Sources are created in daemon.ts between TriggerEngine creation and `triggerEngine.startAll()`.
**When to use:** Every new source follows this exact insertion point.
**Example:**
```typescript
// daemon.ts lines ~638-654 — insert AFTER SchedulerSource registration
// Wire MySQL sources (TRIG-02)
if (mysqlPool && mysqlTriggerConfigs.length > 0) {
  for (const cfg of mysqlTriggerConfigs) {
    const mysqlSource = new MysqlSource({
      pool: mysqlPool,
      ...cfg,
      ingest: (event) => triggerEngine.ingest(event),
      log,
    });
    triggerEngine.registerSource(mysqlSource);
  }
}
// Wire webhook source, inbox sources, calendar sources similarly...

// Then existing lines:
await triggerEngine.replayMissed();
triggerEngine.startAll();
```

### Pattern 3: Webhook Route Injection
**What:** The webhook HTTP handler needs access to TriggerEngine.ingest but the dashboard server is created after TriggerEngine in daemon.ts. Solution: pass an optional webhook handler callback into DashboardServerConfig.
**When to use:** TRIG-03 webhook source.
**Example:**
```typescript
// Extend DashboardServerConfig
export type DashboardServerConfig = {
  // ... existing fields
  readonly webhookHandler?: (
    triggerId: string,
    req: IncomingMessage,
    res: ServerResponse,
  ) => Promise<void>;
};

// In handleRequest, before 404:
if (method === "POST" && segments[0] === "webhook" && segments.length === 2) {
  const triggerId = decodeURIComponent(segments[1]!);
  if (config.webhookHandler) {
    await config.webhookHandler(triggerId, req, res);
    return;
  }
  sendJson(res, 404, { error: "Webhook handler not configured" });
  return;
}
```

### Pattern 4: cursor_blob for Source-Specific State
**What:** Each source stores opaque JSON in trigger_state.cursor_blob for state beyond the simple watermark.
**When to use:** CalendarSource (fired event ID set), MysqlSource (optional filter state).
**Example:**
```typescript
// CalendarSource stores fired event IDs as JSON in cursor_blob
const state = this.taskStore.getTriggerState(this.sourceId);
const firedIds: Set<string> = state?.cursor_blob
  ? new Set(JSON.parse(state.cursor_blob) as string[])
  : new Set();

// After processing
this.taskStore.upsertTriggerState(
  this.sourceId,
  String(Date.now()),
  JSON.stringify([...firedIds]),
);
```

### Anti-Patterns to Avoid
- **Direct TurnDispatcher calls from sources:** Never bypass TriggerEngine.ingest() -- the 3-layer dedup and policy evaluation are load-bearing.
- **Blocking the event loop in poll():** mysql2 queries and MCP tool calls are async. Never use sync alternatives.
- **Forgetting .unref() on timers/intervals:** Sources run setInterval for polling. Without `.unref()`, daemon shutdown hangs waiting for timers. SchedulerSource and DedupLayer both use `.unref()` -- follow the pattern.
- **Parsing body before HMAC verification:** For webhooks, the raw body bytes must be hashed for HMAC verification BEFORE JSON.parse. Buffer the body first, verify the signature, then parse.
- **Creating mysql2 pool inside MysqlSource:** The pool is a daemon-level resource. Create it once in daemon.ts, pass it to all MysqlSource instances, close it in the shutdown function.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MySQL connection management | Custom reconnection logic | mysql2/promise `createPool()` | Pool handles reconnection, idle timeouts, connection limits. Hand-rolled reconnection misses edge cases (half-open connections, protocol desync). |
| File write detection | Custom polling with fs.stat | chokidar `watch()` with `awaitWriteFinish` | chokidar handles platform differences (inotify/FSEvents/kqueue), atomic writes, partial writes. awaitWriteFinish specifically handles the "file appears before write completes" race. |
| HMAC comparison | `===` string comparison | `crypto.timingSafeEqual()` | Timing-safe comparison prevents timing attacks on webhook secrets. String equality leaks information via response time differences. |
| MCP server communication | Custom JSON-RPC over stdio | `@modelcontextprotocol/sdk` Client + StdioClientTransport | The SDK handles JSON-RPC framing, message buffering, error handling, and process lifecycle. Hand-rolling stdio JSON-RPC is error-prone (message boundaries, buffer concatenation). |

**Key insight:** Each source adapter is a thin bridge between an external system and the TriggerEngine.ingest() call. The complexity lives in the external system's client library (mysql2, chokidar, MCP SDK), not in the adapter itself. Let the libraries handle the hard parts.

## Common Pitfalls

### Pitfall 1: MySQL ROLLBACKed Rows Advancing Watermark
**What goes wrong:** Source reads row with id=100, advances watermark to 100. Transaction rolls back. Row 100 no longer exists. Future polls start at id > 100, missing the real row 100 if it's re-inserted.
**Why it happens:** MySQL READ COMMITTED isolation means uncommitted rows can be visible to the polling SELECT.
**How to avoid:** Committed-read confirmation -- after advancing the watermark candidate, re-query the max id with a fresh SELECT to confirm the row still exists. If it disappeared, keep the old watermark.
**Warning signs:** Events disappearing, gaps in processed records, "phantom" trigger fires followed by no actual data in the target agent's context.

### Pitfall 2: Webhook Body Buffering OOM
**What goes wrong:** Malicious or buggy client sends an unbounded body. Server buffers it all into memory.
**Why it happens:** `node:http` IncomingMessage is a stream -- without explicit size limits, the server will keep reading.
**How to avoid:** Track accumulated buffer length. Abort with 413 if it exceeds 64KB (the locked limit from CONTEXT.md). Destroy the socket immediately.
**Warning signs:** Memory growth under load, slow responses on large payloads.

### Pitfall 3: chokidar 'add' Event Fires for Existing Files on Start
**What goes wrong:** When chokidar starts watching a directory, it fires 'add' for every existing file, not just new ones.
**Why it happens:** chokidar's default behavior scans the directory and emits 'add' for all discovered files.
**How to avoid:** Use `ignoreInitial: true` option to suppress events for files that exist when watching starts. The InboxSource processes existing files via `poll(since)` on daemon restart, not via the watcher.
**Warning signs:** Duplicate processing of inbox messages on every daemon restart.

### Pitfall 4: Calendar Event ID Set Grows Unbounded
**What goes wrong:** cursor_blob stores fired event IDs forever. After months of operation, the JSON blob grows to megabytes.
**Why it happens:** No eviction strategy for old event IDs.
**How to avoid:** Prune event IDs older than a configurable window (e.g., 7 days past the event's end time). On each poll cycle, filter the Set to remove stale entries before persisting.
**Warning signs:** Increasing `upsertTriggerState` latency, large cursor_blob values in trigger_state table.

### Pitfall 5: MCP Client Process Leak on CalendarSource Stop
**What goes wrong:** The google-workspace MCP server process stays alive after CalendarSource.stop() is called.
**Why it happens:** `StdioClientTransport` spawns a child process. If `close()` is not called, the process leaks.
**How to avoid:** CalendarSource.stop() must call `transport.close()` which terminates the child process. Add defensive cleanup in a try/finally. Consider keeping the MCP client connected across polls (single long-lived process) rather than spawning per-poll to avoid startup overhead.
**Warning signs:** Orphaned node processes visible in `ps aux`, increasing process count over time.

### Pitfall 6: Dashboard Server handleRequest Signature Change Breaking Tests
**What goes wrong:** Adding parameters to `handleRequest` for webhook support breaks all existing test mocks and the `startDashboardServer` call site.
**Why it happens:** `handleRequest` is a module-private function called from the `createServer` callback. Adding dependencies requires threading them through.
**How to avoid:** Use an options object or inject the webhook handler via `DashboardServerConfig` so the existing signature stays compatible. Extract webhook handling into a separate `webhook-handler.ts` module that the dashboard server imports.
**Warning signs:** TypeScript compile errors in daemon.ts, test failures in dashboard tests.

### Pitfall 7: Inbox Source and Heartbeat Inbox Check Racing
**What goes wrong:** InboxSource moves a file to processed/ while the heartbeat inbox check is reading the same file. The heartbeat check fails mid-read.
**Why it happens:** Both systems operate on the same directory concurrently.
**How to avoid:** InboxSource is the PRIMARY path. The heartbeat inbox check becomes a reconciler -- it only acts on files that InboxSource missed (e.g., files written while InboxSource was stopped). Add a check: if InboxSource is registered and running, the heartbeat check should skip or run in read-only mode.
**Warning signs:** Intermittent "file not found" errors in heartbeat logs, duplicate message delivery.

## Code Examples

### MySQL Source: Committed-Read Confirmation
```typescript
// Source: CONTEXT.md TRIG-02 locked decision
async pollOnce(): Promise<readonly TriggerEvent[]> {
  const conn = await this.pool.getConnection();
  try {
    // Primary query: get new rows since watermark
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ${this.idColumn} AS id, * FROM ${this.table} WHERE ${this.idColumn} > ? ORDER BY ${this.idColumn} ASC LIMIT ?`,
      [this.lastSeenId ?? 0, this.batchSize],
    );

    if (rows.length === 0) return [];

    const maxId = rows[rows.length - 1]!.id;

    // Committed-read confirmation: verify max row still exists
    const [confirm] = await conn.query<RowDataPacket[]>(
      `SELECT ${this.idColumn} AS id FROM ${this.table} WHERE ${this.idColumn} = ?`,
      [maxId],
    );

    if (confirm.length === 0) {
      // Row was rolled back -- don't advance watermark
      this.log.warn({ maxId }, "mysql-source: max row disappeared (probable ROLLBACK)");
      return [];
    }

    // Build trigger events
    const events: TriggerEvent[] = rows.map(row => ({
      sourceId: this.sourceId,
      idempotencyKey: `${this.table}:${row.id}`,
      targetAgent: this.targetAgent,
      payload: row,
      timestamp: Date.now(),
    }));

    this.lastSeenId = maxId;
    return events;
  } finally {
    conn.release();
  }
}
```

### Webhook: HMAC Verification Before Parse
```typescript
// Source: CONTEXT.md TRIG-03 locked decision
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 65_536; // 64KB

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalLength = 0;

  for await (const chunk of req) {
    totalLength += (chunk as Buffer).length;
    if (totalLength > MAX_BODY_BYTES) {
      req.destroy();
      throw new Error("Body exceeds 64KB limit");
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function verifyHmac(body: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf-8");
  const actualBuf = Buffer.from(signature, "utf-8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
```

### Inbox Source: chokidar with ignoreInitial
```typescript
// Source: CONTEXT.md TRIG-04 + chokidar 5.x API
import { watch, type FSWatcher } from "chokidar";
import { readFile, rename, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";

export class InboxSource implements TriggerSource {
  private watcher: FSWatcher | null = null;

  start(): void {
    this.watcher = watch(this.inboxDir, {
      ignoreInitial: true, // Don't fire for existing files on start
      awaitWriteFinish: { stabilityThreshold: 500 },
    });

    this.watcher.on("add", (filePath: string) => {
      void this.handleNewFile(filePath);
    });
  }

  stop(): void {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
  }

  // poll(since) handles replay of missed files on daemon restart
  async poll(since: string | null): Promise<readonly TriggerEvent[]> {
    const messages = await readMessages(this.inboxDir);
    // Filter to messages newer than watermark
    const sinceTs = since ? parseInt(since, 10) : 0;
    return messages
      .filter(msg => msg.timestamp > sinceTs)
      .map(msg => ({
        sourceId: this.sourceId,
        idempotencyKey: msg.id,
        targetAgent: this.targetAgent,
        payload: `[Message from ${msg.from}]: ${msg.content}`,
        timestamp: msg.timestamp,
      }));
  }
}
```

### Calendar Source: MCP Client Approach
```typescript
// Source: google-workspace MCP server analysis + MCP SDK client API
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class CalendarSource implements TriggerSource {
  private mcpClient: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    // Spawn google-workspace MCP server as long-lived subprocess
    this.transport = new StdioClientTransport({
      command: this.mcpConfig.command,
      args: this.mcpConfig.args,
      env: this.mcpConfig.env,
    });
    this.mcpClient = new Client({ name: "calendar-source", version: "1.0.0" });
    await this.mcpClient.connect(this.transport);

    this.pollTimer = setInterval(() => void this.pollOnce(), this.pollIntervalMs);
    this.pollTimer.unref();
  }

  private async pollOnce(): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + this.offsetMs);

    const result = await this.mcpClient!.callTool({
      name: "calendar_list_events",
      arguments: {
        user: this.user,
        time_min: now.toISOString(),
        time_max: windowEnd.toISOString(),
        max_results: 50,
      },
    });

    // Parse events from MCP response, filter against firedIds set
    // Ingest new events via this.ingestFn
  }

  stop(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.transport) { void this.transport.close(); this.transport = null; }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Heartbeat inbox polling (60s cycle) | chokidar file watch (instant) | Phase 61 | Sub-second inbox delivery vs 60s worst case. Heartbeat becomes fallback. |
| No external trigger sources | 4 adapter types via TriggerEngine | Phase 61 | Agents can react to DB changes, webhooks, inbox messages, and calendar events autonomously. |
| googleapis direct dependency for Calendar | MCP client calling existing MCP server | Phase 61 | No googleapis dep (~50MB), reuses existing auth (1Password), consistent MCP tool interface. |

**Key architectural insight from research:** The google-workspace MCP server does NOT support syncToken-based incremental updates. Its `calendar_list_events` tool accepts `time_min`/`time_max`/`max_results` parameters. The CONTEXT.md mentions syncToken, but the actual MCP server uses time-window polling. The CalendarSource must use time-window polling with a fired-event-ID set for dedup, not syncToken. This is functionally equivalent but the implementation detail differs from what was discussed.

**MCP server tool signature (verified from source):**
```
calendar_list_events({
  user: "jas" | "ramy",       // required
  calendar_id: string,         // default "primary"
  time_min: string,            // ISO 8601 (optional, defaults to now)
  time_max: string,            // ISO 8601 (optional)
  max_results: number,         // 1-100, default 25
})
```

**chokidar version note:** package.json has `"chokidar": "^5.0.0"` and the installed version is 5.0.0. The CONTEXT.md says "chokidar 4.x" but the project is on 5.x. The API is compatible -- `watch()`, `awaitWriteFinish`, `ignoreInitial`, `on('add')` all work identically. No issue.

## Open Questions

1. **Calendar MCP client lifecycle strategy**
   - What we know: StdioClientTransport spawns a subprocess. The google-workspace MCP server requires 1Password CLI for credential resolution at startup.
   - What's unclear: Should CalendarSource keep the MCP client connected for the lifetime of the daemon (efficient, one process), or spawn/kill per poll cycle (isolated, no leaked state)? Long-lived is recommended but requires health checking.
   - Recommendation: Long-lived client with reconnection on error. Less process churn, faster polls. Add a health check that re-spawns if the process dies.

2. **Calendar push channel renewal**
   - What we know: CONTEXT.md mentions push channel renewal via croner every 6 days.
   - What's unclear: The google-workspace MCP server does not expose a push channel API (watch/stop). It only has list/create/delete for events. Push channels require direct googleapis calls.
   - Recommendation: Drop push channel renewal from Phase 61 scope. Time-window polling with fired-ID dedup is sufficient for the 5-minute poll interval. Push channels can be added later if lower latency is needed, but would require either adding googleapis as a dependency or extending the MCP server.

3. **Per-agent vs per-source inbox watching**
   - What we know: Each agent has its own workspace with an inbox directory. InboxSource watches one directory.
   - What's unclear: Does the daemon create one InboxSource per agent, or one that watches all inbox directories?
   - Recommendation: One InboxSource per agent (matching the per-agent workspace isolation pattern). Each has a unique sourceId like `inbox:<agentName>`. This matches how SchedulerSource handles per-agent schedules but as separate source instances.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| mysql2 (npm) | TRIG-02 MysqlSource | Needs install | 3.22.1 (registry) | Source disabled if no MySQL config |
| MySQL server | TRIG-02 MysqlSource | External (Finmentum) | -- | Source disabled if connection fails |
| chokidar | TRIG-04 InboxSource | Installed | 5.0.0 | -- |
| google-workspace MCP | TRIG-05 CalendarSource | Available | 1.0.0 | Source disabled if MCP config missing |
| @modelcontextprotocol/sdk | TRIG-05 CalendarSource | Installed | 1.29.0 | -- |
| node:crypto | TRIG-03 WebhookSource | Built-in | -- | -- |
| 1Password CLI (op) | CalendarSource MCP auth | System-level | -- | CalendarSource fails to auth; logged as warning |

**Missing dependencies with no fallback:**
- None that block execution. mysql2 must be installed as a new npm dependency, but if the install succeeds, everything is available.

**Missing dependencies with fallback:**
- MySQL server connectivity: If the Finmentum MySQL server is unreachable, MysqlSource logs an error and the source is disabled. Other sources continue.
- Google OAuth tokens: If 1Password or Google tokens are unavailable, CalendarSource fails gracefully on first poll and retries.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run src/triggers/sources/ --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRIG-02 | MySQL poll returns events for rows > watermark | unit | `npx vitest run src/triggers/sources/__tests__/mysql-source.test.ts -x` | Wave 0 |
| TRIG-02 | Committed-read confirmation skips rolled-back rows | unit | `npx vitest run src/triggers/sources/__tests__/mysql-source.test.ts -x` | Wave 0 |
| TRIG-02 | Watermark advances only on confirmed rows | unit | `npx vitest run src/triggers/sources/__tests__/mysql-source.test.ts -x` | Wave 0 |
| TRIG-03 | Webhook verifies HMAC signature (401/403) | unit | `npx vitest run src/triggers/sources/__tests__/webhook-source.test.ts -x` | Wave 0 |
| TRIG-03 | Webhook rejects body > 64KB (413) | unit | `npx vitest run src/triggers/sources/__tests__/webhook-source.test.ts -x` | Wave 0 |
| TRIG-03 | Webhook ingests valid payload through engine | unit | `npx vitest run src/triggers/sources/__tests__/webhook-source.test.ts -x` | Wave 0 |
| TRIG-04 | Inbox fires on new file (chokidar 'add' event) | unit | `npx vitest run src/triggers/sources/__tests__/inbox-source.test.ts -x` | Wave 0 |
| TRIG-04 | Inbox moves processed files to processed/ | unit | `npx vitest run src/triggers/sources/__tests__/inbox-source.test.ts -x` | Wave 0 |
| TRIG-04 | Inbox poll(since) returns unprocessed messages | unit | `npx vitest run src/triggers/sources/__tests__/inbox-source.test.ts -x` | Wave 0 |
| TRIG-05 | Calendar polls events in time window | unit | `npx vitest run src/triggers/sources/__tests__/calendar-source.test.ts -x` | Wave 0 |
| TRIG-05 | Calendar dedup via fired event ID set in cursor_blob | unit | `npx vitest run src/triggers/sources/__tests__/calendar-source.test.ts -x` | Wave 0 |
| TRIG-05 | Calendar prunes stale event IDs from set | unit | `npx vitest run src/triggers/sources/__tests__/calendar-source.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/triggers/sources/ --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/triggers/sources/__tests__/mysql-source.test.ts` -- covers TRIG-02 (mock mysql2 pool)
- [ ] `src/triggers/sources/__tests__/webhook-source.test.ts` -- covers TRIG-03 (mock HTTP req/res)
- [ ] `src/triggers/sources/__tests__/inbox-source.test.ts` -- covers TRIG-04 (mock chokidar, real fs via temp dir)
- [ ] `src/triggers/sources/__tests__/calendar-source.test.ts` -- covers TRIG-05 (mock MCP client)
- [ ] `src/config/__tests__/trigger-source-schemas.test.ts` -- covers per-source Zod config schemas

### Mocking Strategy
- **mysql2:** Mock the pool and connection objects. `pool.getConnection()` returns a mock connection with `.query()` and `.release()`. No real MySQL needed.
- **chokidar:** For unit tests, mock the `watch()` function to return a fake FSWatcher that emits 'add' events on demand. For integration tests, use a real temp directory with `fs.writeFile` to trigger the watcher.
- **MCP client:** Mock `Client.callTool()` to return canned calendar event responses. Don't spawn real MCP server processes in tests.
- **HTTP req/res:** Use mock `IncomingMessage` (writable stream with headers) and `ServerResponse` (capture writes) for webhook tests.

## Project Constraints (from CLAUDE.md)

- **Immutability:** All return values from source methods must be frozen (Object.freeze). TriggerEvent objects should be constructed fresh, never mutated.
- **Small files:** Each source adapter is its own file (200-400 lines). Config schemas in a separate file. Webhook HTTP handler extracted from dashboard server.ts.
- **Error handling:** Every external call (mysql2 query, chokidar event, MCP tool call) must be try/catch wrapped with structured logging via pino child logger.
- **Input validation:** Zod schemas for all config shapes. Webhook body validated for size before parse. MySQL query results validated before ingestion.
- **No hardcoded secrets:** MySQL credentials come from clawcode.yaml (resolved via 1Password `op://` references). Webhook HMAC secrets come from per-source config in clawcode.yaml.
- **Security:** HMAC verification before body parsing (timing-safe comparison). Body size limit enforced. No SQL injection risk (parameterized queries via mysql2 prepared statements).

## Sources

### Primary (HIGH confidence)
- `src/triggers/types.ts` -- TriggerSource interface definition (read directly)
- `src/triggers/engine.ts` -- TriggerEngine ingest pipeline (read directly)
- `src/triggers/scheduler-source.ts` -- Reference TriggerSource implementation (read directly)
- `src/triggers/source-registry.ts` -- Registry pattern (read directly)
- `src/tasks/store.ts` -- upsertTriggerState/getTriggerState API (read directly)
- `src/tasks/schema.ts` -- TriggerStateRowSchema with cursor_blob (read directly)
- `src/dashboard/server.ts` -- Dashboard HTTP server routing pattern (read directly)
- `src/config/schema.ts` -- Existing Zod config schemas (read directly)
- `src/config/watcher.ts` -- Existing chokidar usage pattern (read directly)
- `src/collaboration/inbox.ts` -- readMessages/markProcessed utilities (read directly)
- `src/heartbeat/checks/inbox.ts` -- Existing inbox heartbeat check (read directly)
- `src/manager/daemon.ts` -- Daemon wiring pattern for TriggerEngine + SchedulerSource (read directly)
- `/home/jjagpal/clawd/projects/google-workspace-mcp/src/calendar.ts` -- Calendar MCP tool implementation (read directly)
- `/home/jjagpal/clawd/projects/google-workspace-mcp/src/index.ts` -- MCP server tool registration + parameter schemas (read directly)
- `package.json` -- Dependency versions verified (read directly)
- `node_modules/chokidar/package.json` -- Installed chokidar 5.0.0 confirmed
- `node_modules/@modelcontextprotocol/sdk` -- MCP SDK client StdioClientTransport confirmed available

### Secondary (MEDIUM confidence)
- npm registry -- mysql2@3.22.1 verified via `npm view mysql2 version` (2026-04-17)
- `node_modules/chokidar/index.js` -- awaitWriteFinish/stabilityThreshold confirmed in chokidar 5.x source

### Tertiary (LOW confidence)
- None -- all findings verified from primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified in node_modules or npm registry, patterns proven in existing codebase
- Architecture: HIGH -- all four sources follow the exact same TriggerSource interface and SchedulerSource wiring pattern from Phase 60
- Pitfalls: HIGH -- derived from direct code reading (HMAC verification order, chokidar ignoreInitial, timer .unref(), watermark advancement)
- Calendar MCP approach: MEDIUM -- MCP SDK client API confirmed from type definitions, but the long-lived subprocess approach for CalendarSource has not been tested in this codebase before. Push channel renewal deferred due to MCP server limitation.

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable domain -- mysql2, chokidar, and MCP SDK APIs are mature)
