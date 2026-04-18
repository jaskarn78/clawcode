# Phase 60: Trigger Engine Foundation - Research

**Researched:** 2026-04-17
**Domain:** Event-driven trigger engine with dedup, replay, causation tracking, and task retention
**Confidence:** HIGH

## Summary

Phase 60 builds the TriggerEngine -- a new subsystem at `src/triggers/` that owns every non-Discord turn initiation. The engine composes a source registry (TriggerSourceRegistry), a three-layer dedup pipeline (in-memory LRU + debounce + SQLite UNIQUE), a minimal PolicyEvaluator chokepoint, and watermark-based replay on restart. The existing TaskScheduler (236 LOC) is wrapped by a SchedulerSource adapter as the engine's first registered source. Every triggered turn carries a `causation_id` (nanoid) from ingress through downstream handoffs. Task retention (LIFE-03) extends the HeartbeatRunner with a new check that purges terminal task rows from tasks.db.

The phase touches five files that already exist (TurnOriginSchema, TaskStore, config schema, daemon.ts, HeartbeatRunner) and creates one new module (`src/triggers/`) with approximately 6-8 files. All decisions are locked in CONTEXT.md -- no design choices remain open. The primary risk is correctly wiring the engine into daemon boot at the right step (after TaskManager, before HeartbeatRunner) and ensuring the scheduler migration is a behavioral no-op for existing cron schedules.

**Primary recommendation:** Build the trigger engine as a purely internal module with a clean TriggerSource interface. Wire the SchedulerSource adapter to prove the engine works end-to-end with existing cron schedules before any Phase 61 sources are added.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- TriggerEngine owns a TriggerSourceRegistry; SchedulerSource wraps existing TaskScheduler as its first registered source, reusing croner logic but routing through the engine's dedup->dispatch pipeline. TaskScheduler class stays but becomes an internal detail of the source adapter.
- PolicyEvaluator is an internal chokepoint -- a thin function called inside TriggerEngine.evaluate() before dispatch. No external DSL yet (Phase 62). Default policy: "if source matches a configured agent, dispatch."
- TriggerEngine wired in daemon boot after TaskManager (step 6-quater), before HeartbeatRunner -- needs TurnDispatcher + TaskStore for watermarks. Wire as step 6-quinquies.
- Source registration via `engine.registerSource(source: TriggerSource)` where TriggerSource is an interface with `start()`, `stop()`, `sourceId`, `poll?()` methods -- Phase 61 sources implement this interface.
- Layer 1 (idempotency): In-memory LRU Map inside TriggerEngine (~10K entries, TTL = debounce window). Checked BEFORE PolicyEvaluator. Rejects exact duplicate (sourceId, idempotencyKey) pairs. Fast path, zero I/O.
- Layer 2 (debounce): Per-source configurable debounce window (default 5s). Events within the window collapsed to the latest. Uses setTimeout + clear pattern.
- Layer 3 (SQLite UNIQUE): Dedicated `trigger_events` table in tasks.db -- columns: source_id TEXT, idempotency_key TEXT, created_at INTEGER, UNIQUE(source_id, idempotency_key). INSERT OR IGNORE as safety net. Separate from trigger_state (watermarks).
- Replay on restart: Watermark-based -- each source persists last_watermark via TaskStore.upsertTriggerState() (already exists from Phase 58). On restart, engine.replayMissed() calls each source's poll(since: watermark). Max age from config triggers.replayMaxAgeMs (default 24h).
- causation_id generated at trigger ingress -- TriggerEngine.ingest() generates nanoid() as causation_id, attaches to TurnOrigin via a new optional causationId field on TurnOriginSchema. Handoffs (Phase 59) already propagate causation_id on task rows -- this connects the trigger->turn link.
- TurnOriginSchema extended with optional `causationId: z.string().nullable()` -- nullable so Discord/scheduler origins (no trigger) pass null. Backward-compatible addition to the Phase 57 locked shape.
- LIFE-03 retention: HeartbeatRunner extension -- taskRetention heartbeat runs every hour, calls TaskStore.purgeCompleted(retentionDays). New method: DELETE FROM tasks WHERE status IN ('complete','failed','cancelled','timed_out') AND ended_at < ?. Config: perf.taskRetentionDays (default 7).
- Dedup table auto-cleaned: purge trigger_events older than 2 * replayMaxAgeMs (default 48h) on the same heartbeat.

### Claude's Discretion
- Internal file organization under src/triggers/ (new module) -- e.g. engine.ts, source-registry.ts, policy-evaluator.ts, scheduler-source.ts, dedup.ts, types.ts -- or fewer/more files as natural.
- LRU Map implementation detail (simple Map with size cap + eviction, or a tiny LRU class).
- Exact debounce mechanics (setTimeout vs requestAnimationFrame-style tick).
- trigger_events table column types and index strategy beyond the UNIQUE constraint.
- Test layout under src/triggers/__tests__/ (follows Phase 58/59 convention).

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRIG-01 | Scheduled triggers fire agent turns on cron expressions with a rich context payload -- extends v1.6 TaskScheduler | SchedulerSource adapter wraps TaskScheduler, routes through engine's dedup->dispatch pipeline. TaskScheduler class retained as internal detail. Existing croner cron logic reused. |
| TRIG-06 | Daemon startup replays missed events since last watermark with configurable max age (default 24h) | engine.replayMissed() reads watermarks from TaskStore.getTriggerState() (Phase 58 API), calls each source's poll(since: watermark). Max age config: triggers.replayMaxAgeMs. |
| TRIG-07 | Three-layer dedup prevents trigger storms: idempotency key + debounce + SQLite UNIQUE | Layer 1: in-memory LRU (~10K entries). Layer 2: per-source setTimeout-based debounce (5s default). Layer 3: trigger_events table with UNIQUE(source_id, idempotency_key) + INSERT OR IGNORE. |
| TRIG-08 | Every trigger fire generates causation_id that propagates to turn trace metadata and downstream handoffs | TriggerEngine.ingest() generates nanoid(), attaches to TurnOrigin.causationId (new nullable field). Handoff propagation already built in Phase 59 TaskManager via TaskRow.causation_id. |
| LIFE-03 | Task retention defaults to 7 days matching traces.db convention; configurable via perf.taskRetentionDays | New heartbeat check (task-retention.ts) calls TaskStore.purgeCompleted(retentionDays). Config field: perf.taskRetentionDays. Same heartbeat also purges trigger_events older than 2x replayMaxAgeMs. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Immutability**: All returned objects must be deeply frozen (Object.freeze). Established pattern in TurnOrigin, TaskRow shapes.
- **File organization**: Many small files > few large files. 200-400 lines typical, 800 max. The ~6-8 file split for src/triggers/ is appropriate.
- **Error handling**: Handle errors explicitly at every level. Log detailed context server-side.
- **Input validation**: Use Zod schemas for all persistent shapes. z.infer<> for types. Established pattern.
- **Security**: No hardcoded secrets. Validate all inputs. Parameterized SQL queries (prepared statements).
- **Testing**: vitest with verbose reporter. Follow src/tasks/__tests__/ convention for test layout.
- **Git**: feat/fix/refactor commit types. No attribution line.
- **GSD workflow**: All changes through GSD commands.
- **TypeScript 6.0.2, Node.js 22 LTS, ESM-only** (execa pattern -- "type": "module" in package.json).

## Standard Stack

### Core (already in project -- zero new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| croner | 10.0.1 | Cron scheduling inside SchedulerSource | Already used by TaskScheduler. Reuse, do not re-import. |
| better-sqlite3 | 12.8.0 | trigger_events table in tasks.db | TaskStore already manages the DB handle. New DDL + prepared statements added to TaskStore. |
| nanoid | 5.x | causation_id generation at trigger ingress | Already used project-wide for turnIds, taskIds. |
| zod | 4.3.6 | Schema validation for TriggerEvent, TriggerSource config | Already used for all persistent shapes. |
| pino | 9.x | Structured logging inside TriggerEngine | Already available via daemon logger injection pattern. |

### Supporting (already in project)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | 4.x | Retention cutoff calculation (subDays) | In task-retention heartbeat check, mirrors trace-retention.ts pattern. |

### New Dependencies
None. Phase 60 requires zero new npm packages.

**Installation:** No new packages to install.

## Architecture Patterns

### Recommended Project Structure
```
src/triggers/
  types.ts              # TriggerSource interface, TriggerEvent schema, TriggerEngineOptions
  engine.ts             # TriggerEngine class (registry + dedup + dispatch + replay)
  source-registry.ts    # TriggerSourceRegistry (Map<sourceId, TriggerSource>)
  policy-evaluator.ts   # evaluatePolicy() pure function (thin chokepoint)
  dedup.ts              # DedupLayer class (LRU + debounce + SQLite INSERT OR IGNORE)
  scheduler-source.ts   # SchedulerSource adapter wrapping TaskScheduler
  __tests__/
    engine.test.ts
    dedup.test.ts
    scheduler-source.test.ts
    policy-evaluator.test.ts
src/heartbeat/checks/
  task-retention.ts     # New heartbeat check for LIFE-03
  __tests__/
    task-retention.test.ts
```

### Pattern 1: TriggerSource Interface (Plugin contract for Phase 61)
**What:** Every trigger source implements a common interface so the engine is source-agnostic.
**When to use:** Any new source type (scheduler, webhook, MySQL poller, inbox watcher, calendar).
**Example:**
```typescript
// src/triggers/types.ts
export type TriggerEvent = Readonly<{
  sourceId: string;
  idempotencyKey: string;
  targetAgent: string;
  payload: unknown;
  timestamp: number;
}>;

export type TriggerSource = {
  readonly sourceId: string;
  start(): void;
  stop(): void;
  poll?(since: string | null): Promise<readonly TriggerEvent[]>;
};
```

### Pattern 2: Three-Layer Dedup Pipeline
**What:** Events flow through LRU check -> debounce collapse -> SQLite UNIQUE as a sequential pipeline.
**When to use:** Every event that enters TriggerEngine.ingest().
**Example:**
```typescript
// Pseudocode for the ingest pipeline
async ingest(event: TriggerEvent): Promise<void> {
  // Layer 1: LRU check (zero I/O fast path)
  const dedupKey = `${event.sourceId}:${event.idempotencyKey}`;
  if (this.lru.has(dedupKey)) {
    this.log.debug({ dedupKey }, "dedup: LRU hit, rejecting");
    return;
  }
  this.lru.set(dedupKey, Date.now());

  // Layer 2: debounce (per-source window collapse)
  const debounced = this.debounce(event);
  if (!debounced) return; // collapsed into pending timer

  // Layer 3: SQLite UNIQUE safety net
  const inserted = this.insertTriggerEvent(event.sourceId, event.idempotencyKey);
  if (!inserted) {
    this.log.debug({ dedupKey }, "dedup: SQLite UNIQUE hit, rejecting");
    return;
  }

  // Generate causation_id and dispatch
  const causationId = nanoid();
  const origin = makeRootOrigin("trigger", event.sourceId);
  // Extend origin with causationId...
  await this.turnDispatcher.dispatch(origin, event.targetAgent, formatPayload(event));
}
```

### Pattern 3: Watermark-Based Replay
**What:** On daemon restart, each source's last persisted watermark is read from trigger_state, and its `poll(since)` method is called to retrieve missed events.
**When to use:** engine.replayMissed() called during daemon boot AFTER source registration.
**Example:**
```typescript
async replayMissed(): Promise<void> {
  const maxAge = Date.now() - this.config.replayMaxAgeMs;
  for (const source of this.registry.all()) {
    if (!source.poll) continue;
    const state = this.taskStore.getTriggerState(source.sourceId);
    const watermark = state?.last_watermark ?? null;
    // Skip if watermark is older than maxAge
    if (watermark && parseInt(watermark, 10) < maxAge) {
      this.log.warn({ sourceId: source.sourceId }, "watermark older than max age, skipping replay");
      continue;
    }
    const missed = await source.poll(watermark);
    for (const event of missed) {
      await this.ingest(event);
    }
  }
}
```

### Pattern 4: Daemon Boot Wiring (step 6-quinquies)
**What:** TriggerEngine must be wired AFTER TaskManager (step 6-quater) because it needs TurnDispatcher + TaskStore, and BEFORE HeartbeatRunner (step 8) so replay runs before heartbeats start.
**When to use:** daemon.ts boot sequence.
**Example:**
```typescript
// 6-quinquies. Create TriggerEngine singleton (Phase 60).
// Depends on: turnDispatcher (6-bis), taskStore (6-ter), taskScheduler (8b).
// Note: taskScheduler is currently wired at step 8b. TriggerEngine must
// either be wired after 8b or SchedulerSource construction deferred.
const triggerEngine = new TriggerEngine({
  turnDispatcher,
  taskStore,
  log,
  config: { replayMaxAgeMs: config.triggers?.replayMaxAgeMs ?? 86400000 },
});

// Register SchedulerSource adapter
const schedulerSource = new SchedulerSource({ taskScheduler, resolvedAgents });
triggerEngine.registerSource(schedulerSource);

// Replay missed events from last watermarks
await triggerEngine.replayMissed();

// Start all sources
triggerEngine.startAll();
```

### Pattern 5: HeartbeatRunner Extension (task-retention check)
**What:** A new auto-discovered heartbeat check that prunes terminal task rows and stale trigger_events.
**When to use:** Runs on the heartbeat interval (every 60s by default), but with its own `interval` override (3600s = hourly).
**Example:**
```typescript
// src/heartbeat/checks/task-retention.ts -- mirrors trace-retention.ts pattern
const taskRetentionCheck: CheckModule = {
  name: "task-retention",
  interval: 3600, // 1 hour, not every heartbeat tick
  async execute(context: CheckContext): Promise<CheckResult> {
    // Access taskStore from context (needs injection -- see pitfall)
    // DELETE FROM tasks WHERE status IN (...) AND ended_at < cutoff
    // DELETE FROM trigger_events WHERE created_at < cutoff
  },
};
export default taskRetentionCheck;
```

### Anti-Patterns to Avoid
- **Replacing TaskScheduler entirely:** The CONTEXT decision says TaskScheduler class STAYS as an internal detail of SchedulerSource. Do not rewrite cron logic -- wrap it.
- **Sync dedup in SQLite for hot path:** Layer 1 (LRU) exists specifically to avoid hitting SQLite on every event. The SQLite UNIQUE is a safety net, not the primary dedup.
- **Global debounce timer:** Debounce is per-source, not global. A slow source must not delay a fast source.
- **Mutable TurnOrigin:** All TurnOrigin objects must be deeply frozen (Object.freeze). The new causationId field is set at construction, never mutated.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron scheduling | Custom cron parser | croner 10.0.1 (already in project) | DST handling, leap seconds, timezone math |
| ID generation | Custom unique ID generator | nanoid 5.x (already in project) | URL-safe, collision-resistant, proven |
| Schema validation | Runtime type checks | zod 4.3.6 (already in project) | Established project pattern, z.infer<> for types |
| LRU cache | npm LRU library | Simple Map with size cap (~40 LOC) | 10K entries is trivial, no dependency warranted |
| Date arithmetic | Manual epoch math | date-fns subDays/subHours (already in project) | Mirrors trace-retention.ts pattern |

**Key insight:** This phase requires ZERO new npm dependencies. Every tool needed is already in the project. The LRU is small enough (~40 LOC) that importing an LRU library would add more complexity than it saves.

## Common Pitfalls

### Pitfall 1: HeartbeatRunner Check Context Lacks TaskStore Access
**What goes wrong:** The heartbeat check discovery system (`discoverChecks`) passes a `CheckContext` with `sessionManager`, `registry`, and `config`. There is no `taskStore` field. The task-retention check needs to call `TaskStore.purgeCompleted()`.
**Why it happens:** The heartbeat system was designed for per-agent health checks, not daemon-scoped cleanup tasks.
**How to avoid:** Two options: (a) extend `CheckContext` with an optional `taskStore` field (matching the `threadManager` precedent at line 184 of runner.ts), or (b) register the retention job as a standalone setInterval in daemon.ts rather than a heartbeat check. Option (a) is cleaner -- matches the existing `threadManager` injection pattern.
**Warning signs:** Test compilation fails because CheckContext.taskStore is undefined in existing test stubs.

### Pitfall 2: Daemon Boot Order -- TaskScheduler is Wired AFTER HeartbeatRunner
**What goes wrong:** CONTEXT says "wire TriggerEngine as step 6-quinquies (after TaskManager, before HeartbeatRunner)." But the TaskScheduler is currently wired at step 8b (AFTER HeartbeatRunner at step 8). The SchedulerSource adapter wraps TaskScheduler, which doesn't exist yet at step 6-quinquies.
**Why it happens:** The v1.6 TaskScheduler was a late addition to the daemon boot sequence.
**How to avoid:** Two strategies: (a) move TaskScheduler creation to step 6-quinquies alongside TriggerEngine (the scheduler doesn't depend on HeartbeatRunner), or (b) split TriggerEngine creation into two phases -- create engine at 6-quinquies, register SchedulerSource at 8c after TaskScheduler exists. Strategy (a) is cleaner since TaskScheduler only needs SessionManager + TurnDispatcher + log, all available by step 6-bis.
**Warning signs:** SchedulerSource constructor receives an uninitialized or null TaskScheduler reference.

### Pitfall 3: Debounce Timer Leaks on Shutdown
**What goes wrong:** Debounce uses setTimeout. If the daemon shuts down while timers are pending, the process hangs until timers fire.
**Why it happens:** Node.js keeps the event loop alive for active setTimeout handles.
**How to avoid:** Call `timer.unref()` on every debounce timer (matches TaskManager deadline pattern at line 229 of task-manager.ts). Also add a `stop()` method that clears all pending timers. Wire `triggerEngine.stop()` in daemon shutdown BEFORE `taskStore.close()`.
**Warning signs:** Process hangs for up to 5 seconds on SIGTERM (the default debounce window).

### Pitfall 4: LRU TTL Drift When Debounce Window Changes
**What goes wrong:** The LRU TTL is defined as "debounce window" per CONTEXT. If per-source debounce windows differ (e.g., scheduler=1s, webhook=10s), a single global TTL causes either premature eviction (short TTL) or stale entries (long TTL).
**Why it happens:** A single LRU with one TTL doesn't account for heterogeneous source windows.
**How to avoid:** Store the event timestamp in the LRU value and check `(now - storedTs) > sourceDebounceMs` on lookup rather than relying on a global TTL sweep. Or use a per-source LRU. The per-source approach is simpler and matches the per-source debounce timer pattern.
**Warning signs:** Duplicate events slip through Layer 1 for sources with long debounce windows.

### Pitfall 5: TurnOriginSchema Backward Compatibility
**What goes wrong:** Adding `causationId` to TurnOriginSchema breaks existing Zod.parse() calls if the field is required.
**Why it happens:** Existing code calls TurnOriginSchema.parse() on objects that lack causationId.
**How to avoid:** The CONTEXT explicitly says `causationId: z.string().nullable()` -- but this makes it REQUIRED with a null value. Use `.optional().nullable()` or `.nullable().default(null)` instead, so existing objects without the field pass validation. The `.nullable().default(null)` approach is cleanest -- omitted fields default to null, explicit null is accepted, strings are accepted.
**Warning signs:** Existing tests that parse TurnOrigin objects fail with "causationId required" errors.

### Pitfall 6: trigger_events Table Migration on Existing Deployments
**What goes wrong:** The TaskStore.ensureSchema() DDL creates `trigger_events` table. But existing tasks.db files (created by Phase 58) don't have this table. If the CREATE TABLE IF NOT EXISTS is in a separate transaction or fails silently, INSERT OR IGNORE calls will throw "table not found."
**Why it happens:** Phase 58 DDL is in a single BEGIN/COMMIT block. Adding a new table to that block is safe (IF NOT EXISTS), but if added as a separate migration step it could fail if the transaction semantics are wrong.
**How to avoid:** Add the `CREATE TABLE IF NOT EXISTS trigger_events` DDL inside the existing `ensureSchema()` transaction in TaskStore. This is the established idempotent migration pattern (Phase 58 CONTEXT). Also add the purgeCompleted and purgeTriggerEvents prepared statements to the prepareStatements block.
**Warning signs:** "no such table: trigger_events" error on first TriggerEngine ingest after upgrade.

### Pitfall 7: SchedulerSource poll() Must Generate Correct Watermarks
**What goes wrong:** The replay system calls `source.poll(since: watermark)` on restart. For a scheduler source, "missed events" means cron ticks that should have fired while the daemon was down. Croner can compute missed ticks via `nextRuns()` or by iterating from `since` to `now`, but the interface expects TriggerEvent[] back.
**Why it happens:** Cron is time-based (next tick), not event-based (watermark). Converting between the two models requires careful timestamp handling.
**How to avoid:** SchedulerSource.poll(since) should: (1) compute all cron ticks between `since` and `now` using croner's `nextRuns()` with appropriate options, (2) convert each tick to a TriggerEvent with `idempotencyKey = <scheduleName>:<tickTimestamp>`, (3) return the array. The watermark for scheduler sources is the timestamp of the last fired tick.
**Warning signs:** Replayed events have identical idempotency keys (missing tick timestamp), causing the dedup layer to drop all but the first.

## Code Examples

### TriggerSource Interface
```typescript
// src/triggers/types.ts
import { z } from "zod/v4";

export const TriggerEventSchema = z.object({
  sourceId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  targetAgent: z.string().min(1),
  payload: z.unknown(),
  timestamp: z.number().int().min(0),
});
export type TriggerEvent = z.infer<typeof TriggerEventSchema>;

export type TriggerSource = {
  readonly sourceId: string;
  start(): void;
  stop(): void;
  /** Called on daemon restart to replay missed events since watermark. */
  poll?(since: string | null): Promise<readonly TriggerEvent[]>;
};

export type TriggerEngineOptions = Readonly<{
  turnDispatcher: import("../manager/turn-dispatcher.js").TurnDispatcher;
  taskStore: import("../tasks/store.js").TaskStore;
  log: import("pino").Logger;
  config: Readonly<{
    replayMaxAgeMs: number;    // default 86400000 (24h)
    dedupLruSize: number;      // default 10000
    defaultDebounceMs: number; // default 5000
  }>;
}>;
```

### Simple LRU Map (~40 LOC)
```typescript
// src/triggers/dedup.ts (LRU portion)
export class LruMap<K, V> {
  private readonly map = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest (first entry)
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  get size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
}
```

### TurnOriginSchema Extension
```typescript
// Modification to src/manager/turn-origin.ts
export const TurnOriginSchema = z.object({
  source: TurnOriginSourceSchema,
  rootTurnId: z.string().min(1),
  parentTurnId: z.string().min(1).nullable(),
  chain: z.array(z.string().min(1)).min(1),
  causationId: z.string().nullable().default(null), // Phase 60 TRIG-08
});
```

### TaskStore DDL Extension (trigger_events table)
```sql
-- Added to TaskStore.ensureSchema() inside existing BEGIN/COMMIT block
CREATE TABLE IF NOT EXISTS trigger_events (
  source_id        TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE(source_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_trigger_events_created_at
  ON trigger_events(created_at);
```

### TaskStore.purgeCompleted (LIFE-03)
```typescript
// New prepared statement in TaskStore
purgeCompletedStmt: this.db.prepare(`
  DELETE FROM tasks
  WHERE status IN ('complete', 'failed', 'cancelled', 'timed_out', 'orphaned')
    AND ended_at < ?
`),
```

### Config Schema Extension
```typescript
// Added to src/config/schema.ts -- top-level triggers config
export const triggersConfigSchema = z.object({
  replayMaxAgeMs: z.number().int().positive().default(86400000), // 24h
  defaultDebounceMs: z.number().int().min(0).default(5000),      // 5s
}).optional();

// Added to perf section of defaultsSchema / agentSchema
// perf.taskRetentionDays: z.number().int().positive().default(7)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TaskScheduler directly calls TurnDispatcher | SchedulerSource routes through TriggerEngine | Phase 60 | Single chokepoint for all non-Discord turns; dedup + causation_id for free |
| No causation tracking across triggers | causation_id on TurnOrigin from trigger ingress | Phase 60 | End-to-end tracing from trigger -> turn -> handoff -> turn (TRIG-08) |
| No task row cleanup | TaskStore.purgeCompleted on heartbeat interval | Phase 60 | Terminal rows older than 7 days auto-purged (LIFE-03) |
| No trigger event persistence | trigger_events table in tasks.db | Phase 60 | Layer 3 dedup + auditability |

## Open Questions

1. **HeartbeatRunner taskStore injection mechanism**
   - What we know: CheckContext has an optional `threadManager` field (set via `setThreadManager()`). The same pattern can be used for `taskStore`.
   - What's unclear: Whether to add `taskStore` to CheckContext directly or use the daemon-scoped closure pattern (the trace-retention check accesses TraceStore via sessionManager.getTraceStore, not CheckContext).
   - Recommendation: Extend CheckContext with optional `taskStore` field + corresponding `setTaskStore()` setter on HeartbeatRunner (matches threadManager precedent). This is cleaner than the trace-retention pattern which casts sessionManager.

2. **Scheduler source boot ordering in daemon.ts**
   - What we know: TaskScheduler is wired at step 8b, TriggerEngine should be at step 6-quinquies. SchedulerSource wraps TaskScheduler.
   - What's unclear: Whether to move TaskScheduler creation earlier or defer SchedulerSource registration.
   - Recommendation: Move TaskScheduler creation to 6-quinquies-a (it only needs sessionManager + turnDispatcher + log, all available). Then create TriggerEngine at 6-quinquies-b, register SchedulerSource immediately. This keeps the boot sequence linear.

3. **SchedulerSource.poll() -- computing missed cron ticks**
   - What we know: Croner's `Cron` class has `nextRuns(count)` and `nextRun()` but no built-in "ticks between A and B" method.
   - What's unclear: Exact API for iterating cron ticks in a time range.
   - Recommendation: Use a loop: create a temporary Cron, call `nextRun(startDate)` repeatedly until past `now`. Each tick becomes a TriggerEvent. Test with known cron expressions to verify accuracy.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (via `vitest run --reporter=verbose`) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run src/triggers --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRIG-01 | SchedulerSource fires agent turns via engine | integration | `npx vitest run src/triggers/__tests__/scheduler-source.test.ts -x` | Wave 0 |
| TRIG-06 | engine.replayMissed() replays from watermark | unit | `npx vitest run src/triggers/__tests__/engine.test.ts -t "replay" -x` | Wave 0 |
| TRIG-07 | Three-layer dedup rejects duplicates | unit | `npx vitest run src/triggers/__tests__/dedup.test.ts -x` | Wave 0 |
| TRIG-08 | causation_id on TurnOrigin from trigger ingress | unit | `npx vitest run src/triggers/__tests__/engine.test.ts -t "causation" -x` | Wave 0 |
| LIFE-03 | purgeCompleted deletes terminal rows older than retention | unit | `npx vitest run src/heartbeat/checks/__tests__/task-retention.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/triggers --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/triggers/__tests__/engine.test.ts` -- covers TRIG-06, TRIG-08
- [ ] `src/triggers/__tests__/dedup.test.ts` -- covers TRIG-07 (all 3 layers)
- [ ] `src/triggers/__tests__/scheduler-source.test.ts` -- covers TRIG-01
- [ ] `src/triggers/__tests__/policy-evaluator.test.ts` -- covers default policy behavior
- [ ] `src/heartbeat/checks/__tests__/task-retention.test.ts` -- covers LIFE-03
- [ ] Framework install: none needed (vitest already in project)

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `src/scheduler/scheduler.ts` (236 LOC, croner + TurnDispatcher integration)
- Direct codebase analysis: `src/manager/turn-dispatcher.ts` (188 LOC, dispatch/dispatchStream contract)
- Direct codebase analysis: `src/manager/turn-origin.ts` (TurnOriginSchema, makeRootOrigin, SOURCE_KINDS)
- Direct codebase analysis: `src/tasks/store.ts` (TaskStore with trigger_state CRUD, ensureSchema pattern)
- Direct codebase analysis: `src/tasks/task-manager.ts` (525 LOC, causation_id propagation pattern)
- Direct codebase analysis: `src/manager/daemon.ts` (boot sequence, wiring order, shutdown)
- Direct codebase analysis: `src/heartbeat/runner.ts` (HeartbeatRunner, CheckContext, setThreadManager pattern)
- Direct codebase analysis: `src/heartbeat/checks/trace-retention.ts` (retention check pattern)
- Direct codebase analysis: `src/heartbeat/discovery.ts` (auto-discovery mechanism)
- Direct codebase analysis: `src/config/schema.ts` (Zod config schemas, perf section structure)
- Direct codebase analysis: `src/tasks/types.ts` (TERMINAL_STATUSES set, used for purge query)

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions (user-locked architecture choices)
- REQUIREMENTS.md (TRIG-01, TRIG-06, TRIG-07, TRIG-08, LIFE-03 specifications)
- STATE.md (accumulated project decisions, boot order conventions, Phase 58/59 patterns)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all libraries verified in codebase
- Architecture: HIGH -- all integration points read and understood, CONTEXT decisions are specific
- Pitfalls: HIGH -- derived from direct codebase analysis of boot order, schema migration, timer lifecycle
- Dedup design: HIGH -- CONTEXT specifies all three layers in detail, codebase has patterns for each

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable -- internal architecture, no external dependency changes expected)
