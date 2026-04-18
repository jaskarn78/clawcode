# Phase 60: Trigger Engine Foundation - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

A single TriggerEngine + TriggerSourceRegistry + internal PolicyEvaluator owns every non-Discord turn initiation. The v1.6 TaskScheduler is migrated as its first registered source (SchedulerSource adapter). Three-layer dedup prevents trigger storms. Watermark-based replay recovers missed events on daemon restart. Every triggered turn carries a causation_id from ingress through downstream handoffs. Task retention purges completed rows on a configurable heartbeat.

</domain>

<decisions>
## Implementation Decisions

### Engine Architecture & Scheduler Migration
- TriggerEngine owns a TriggerSourceRegistry; SchedulerSource wraps existing TaskScheduler as its first registered source, reusing croner logic but routing through the engine's dedup→dispatch pipeline. TaskScheduler class stays but becomes an internal detail of the source adapter.
- PolicyEvaluator is an internal chokepoint — a thin function called inside TriggerEngine.evaluate() before dispatch. No external DSL yet (Phase 62). Default policy: "if source matches a configured agent, dispatch."
- TriggerEngine wired in daemon boot after TaskManager (step 6-quater), before HeartbeatRunner — needs TurnDispatcher + TaskStore for watermarks. Wire as step 6-quinquies.
- Source registration via `engine.registerSource(source: TriggerSource)` where TriggerSource is an interface with `start()`, `stop()`, `sourceId`, `poll?()` methods — Phase 61 sources implement this interface.

### Three-Layer Dedup & Replay
- Layer 1 (idempotency): In-memory LRU Map inside TriggerEngine (~10K entries, TTL = debounce window). Checked BEFORE PolicyEvaluator. Rejects exact duplicate (sourceId, idempotencyKey) pairs. Fast path, zero I/O.
- Layer 2 (debounce): Per-source configurable debounce window (default 5s). Events within the window collapsed to the latest. Uses setTimeout + clear pattern.
- Layer 3 (SQLite UNIQUE): Dedicated `trigger_events` table in tasks.db — columns: source_id TEXT, idempotency_key TEXT, created_at INTEGER, UNIQUE(source_id, idempotency_key). INSERT OR IGNORE as safety net. Separate from trigger_state (watermarks).
- Replay on restart: Watermark-based — each source persists last_watermark via TaskStore.upsertTriggerState() (already exists from Phase 58). On restart, engine.replayMissed() calls each source's poll(since: watermark). Max age from config triggers.replayMaxAgeMs (default 24h).

### Causation ID Propagation & Task Retention
- causation_id generated at trigger ingress — TriggerEngine.ingest() generates nanoid() as causation_id, attaches to TurnOrigin via a new optional causationId field on TurnOriginSchema. Handoffs (Phase 59) already propagate causation_id on task rows — this connects the trigger→turn link.
- TurnOriginSchema extended with optional `causationId: z.string().nullable()` — nullable so Discord/scheduler origins (no trigger) pass null. Backward-compatible addition to the Phase 57 locked shape.
- LIFE-03 retention: HeartbeatRunner extension — taskRetention heartbeat runs every hour, calls TaskStore.purgeCompleted(retentionDays). New method: DELETE FROM tasks WHERE status IN ('complete','failed','cancelled','timed_out') AND ended_at < ?. Config: perf.taskRetentionDays (default 7).
- Dedup table auto-cleaned: purge trigger_events older than 2 * replayMaxAgeMs (default 48h) on the same heartbeat.

### Claude's Discretion
- Internal file organization under src/triggers/ (new module) — e.g. engine.ts, source-registry.ts, policy-evaluator.ts, scheduler-source.ts, dedup.ts, types.ts — or fewer/more files as natural.
- LRU Map implementation detail (simple Map with size cap + eviction, or a tiny LRU class).
- Exact debounce mechanics (setTimeout vs requestAnimationFrame-style tick).
- trigger_events table column types and index strategy beyond the UNIQUE constraint.
- Test layout under src/triggers/__tests__/ (follows Phase 58/59 convention).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/scheduler/scheduler.ts` — TaskScheduler class (236 LOC) with croner, per-agent locks, TurnDispatcher integration. SchedulerSource wraps this.
- `src/manager/turn-dispatcher.ts` — TurnDispatcher (188 LOC) with dispatch(), dispatchStream(), AbortSignal threading.
- `src/manager/turn-origin.ts` — TurnOrigin schema, makeRootOrigin(), makeTurnId(), SOURCE_KINDS includes "trigger".
- `src/tasks/store.ts` — TaskStore with trigger_state CRUD (upsertTriggerState, getTriggerState) already built in Phase 58.
- `src/tasks/task-manager.ts` — TaskManager (525 LOC) with delegate(), completeTask(), cancel(), retry().

### Established Patterns
- Daemon boot sequence: numbered steps (step 6-bis for TurnDispatcher, 6-ter for TaskStore, 6-quater for TaskManager).
- Deeply-frozen return objects (TurnOrigin, TaskRow shapes).
- Zod schemas for all persistent shapes, z.infer<> for types.
- HeartbeatRunner for periodic daemon tasks (context health, cost alerts).
- Per-agent sequential locks in TaskScheduler (reuse pattern for trigger dispatch).

### Integration Points
- daemon.ts — wire TriggerEngine after TaskManager, expose on return value.
- HeartbeatRunner — register taskRetention heartbeat.
- TurnOriginSchema — extend with nullable causationId field.
- TaskStore — add trigger_events DDL, purgeCompleted() method, purgeTriggerEvents() method.
- config/schema.ts — add triggers.replayMaxAgeMs and perf.taskRetentionDays config fields.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches within the decisions above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
