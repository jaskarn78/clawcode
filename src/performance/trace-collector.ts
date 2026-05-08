/**
 * TraceCollector — in-memory span buffer with batched per-turn flush.
 *
 * The collector is injected into hot-path modules (DiscordBridge,
 * ContextAssembler, SdkSessionAdapter) via the project's `Deps` pattern.
 * Each Discord message → reply cycle creates one `Turn`; spans are buffered
 * in memory for the lifetime of that turn and committed to the TraceStore
 * in a SINGLE transaction on `turn.end(status)`. This keeps SQLite write
 * amplification bounded under tool-heavy turns (see 50-RESEARCH.md
 * pitfall 5).
 *
 * Idempotency: calling `span.end()` or `turn.end()` more than once is a
 * safe no-op — useful because error handlers can call `end("error")`
 * alongside normal cleanup without double-writing.
 */

import type { Logger } from "pino";
import type {
  CacheTelemetrySnapshot,
  SpanRecord,
  TurnRecord,
  TurnStatus,
} from "./types.js";
import type { TraceStore } from "./trace-store.js";
import type { TurnOrigin } from "../manager/turn-origin.js";
import { ToolCache } from "../mcp/tool-cache.js";

/**
 * TraceCollector — factory for per-turn `Turn` objects.
 *
 * Holds a single TraceStore reference plus a base logger; callers invoke
 * `startTurn` to open a new in-memory buffer for a single Discord message
 * or scheduler tick.
 */
export class TraceCollector {
  constructor(
    private readonly store: TraceStore,
    private readonly log: Logger,
  ) {}

  /**
   * Open a new turn buffer.
   *
   * @param turnId    - Discord message id for Discord turns, or a prefixed
   *                    nanoid (`scheduler:<id>`, `subagent:<id>`) for
   *                    non-Discord triggers.
   * @param agent     - Agent name for filtering in percentile queries.
   * @param channelId - Discord channel id when available, else `null`.
   */
  startTurn(turnId: string, agent: string, channelId: string | null): Turn {
    const childLog = this.log.child({ agent, turnId });
    const turn = new Turn(turnId, agent, channelId, this.store, childLog, this);
    // Phase 115 Plan 05 T04 — register so `recordLazyRecallCall` can fold
    // the increment in directly. Unregistration happens at Turn.end().
    this.registerActiveTurn(agent, turn);
    return turn;
  }

  /**
   * Phase 115 Plan 05 T03 — record a tier-1 truncation event (D-05 trigger).
   *
   * Called from session-config.ts when MEMORY.md exceeds
   * INJECTED_MEMORY_MAX_CHARS at assembly time and the head-tail
   * truncation fires. Persists into the `tier1_truncation_events` table
   * for the dream-cron 2-in-24h priority-pass trigger.
   *
   * Failure-isolated — observability never blocks the parent path.
   * Errors are logged at warn level but never propagated.
   */
  recordTier1TruncationEvent(agent: string, droppedChars = 0): void {
    try {
      this.store.recordTier1TruncationEvent(agent, droppedChars);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      this.log.warn(
        { agent, droppedChars, err: msg, action: "tier1-truncation-record-failed" },
        "[trace] recordTier1TruncationEvent failed (non-fatal)",
      );
    }
  }

  /**
   * Phase 115 Plan 05 T03 — count tier-1 truncation events in a window.
   *
   * Used by dream-cron's `shouldFirePriorityPass` to compute the 2-in-24h
   * trigger condition. Returns 0 on error (fail-safe — never block dream
   * scheduling on observability failures).
   */
  countTruncationEventsSince(agent: string, sinceMs: number): number {
    try {
      return this.store.countTier1TruncationEventsSince(agent, sinceMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      this.log.warn(
        { agent, sinceMs, err: msg, action: "tier1-truncation-count-failed" },
        "[trace] countTier1TruncationEventsSince failed (non-fatal); returning 0",
      );
      return 0;
    }
  }

  /**
   * Phase 115 Plan 05 T04 — record one lazy-recall tool invocation.
   *
   * Per CONTEXT.md sub-scope 7, the four lazy-load tools (`clawcode_memory_search`,
   * `_recall`, `_edit`, `_archive`) are the agent-facing surface that converts
   * the model from "always-injected memory" to "tool-mediated lazy recall."
   * This method increments the per-agent call counter the dashboard surfaces
   * (column `lazy_recall_call_count` in traces.db, slot opened by 115-00-T02).
   *
   * Per-turn association: when a Turn is active for `agent`, the increment
   * folds into the active turn buffer and lands in the `lazy_recall_call_count`
   * column at turn-end. When NO active turn exists (e.g. the tool fired
   * outside a Discord turn loop — heartbeat-driven, daemon-initiated probes),
   * a per-agent rolling counter accumulates and gets attached to the next
   * turn that ends for the agent.
   *
   * Failure-isolated — a counter failure NEVER blocks the tool path. Errors
   * are logged at warn level and dropped.
   *
   * @param agent — agent whose lazy-recall counter should be incremented
   * @param tool  — tool name for the structured log line
   *                ('clawcode_memory_search' | 'clawcode_memory_recall' |
   *                'clawcode_memory_edit' | 'clawcode_memory_archive')
   */
  recordLazyRecallCall(agent: string, tool: string): void {
    try {
      // Try the active-turn registry first.
      const turn = this.activeTurns.get(agent);
      if (turn !== undefined) {
        turn.bumpLazyRecallCount(tool);
        return;
      }
      // No active turn — bump the per-agent rolling counter that the next
      // ended turn will pick up.
      const rolling = this.pendingLazyRecallByAgent.get(agent) ?? 0;
      this.pendingLazyRecallByAgent.set(agent, rolling + 1);

      // Best-effort structured trace line so operators can grep
      // `lazy_recall_call agent=X tool=Y` in journalctl. Never throws.
      this.log.debug(
        { agent, tool, action: "lazy-recall-call" },
        "[trace] lazy_recall_call_count incremented (no-active-turn rolling)",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      this.log.warn(
        { agent, tool, err: msg, action: "lazy-recall-record-failed" },
        "[trace] recordLazyRecallCall failed (non-fatal)",
      );
    }
  }

  /**
   * Phase 115 Plan 05 T04 — drain the per-agent rolling lazy-recall counter
   * accumulated since the last turn end. Returns the count and clears the
   * slot. Called from Turn.end() so the column reflects every recorded
   * call. Tests rely on this to assert the counter is correctly attributed.
   */
  drainPendingLazyRecallCount(agent: string): number {
    const n = this.pendingLazyRecallByAgent.get(agent) ?? 0;
    if (n > 0) this.pendingLazyRecallByAgent.delete(agent);
    return n;
  }

  /**
   * Phase 115 Plan 05 T04 — register an active Turn so `recordLazyRecallCall`
   * can fold the increment in directly. Called from Turn constructor; the
   * Turn unregisters on `end()`.
   *
   * Stored as a single-Turn-per-agent slot. ClawCode runs at most one Turn
   * per agent at a time (Phase 50 invariant); concurrent Turns per agent
   * are not supported.
   */
  registerActiveTurn(agent: string, turn: Turn): void {
    this.activeTurns.set(agent, turn);
  }

  unregisterActiveTurn(agent: string, turn: Turn): void {
    if (this.activeTurns.get(agent) === turn) {
      this.activeTurns.delete(agent);
    }
  }

  // Phase 115 Plan 05 T04 — per-agent rolling lazy-recall counter for tool
  // calls that fire OUTSIDE an active Turn (heartbeat probes, daemon-driven
  // memory operations, etc.). Drained into the next Turn that ends for
  // the agent.
  private readonly pendingLazyRecallByAgent = new Map<string, number>();

  // Phase 115 Plan 05 T04 — per-agent active-Turn registry. Single slot
  // per agent (Phase 50 invariant: at most one Turn per agent at a time).
  private readonly activeTurns = new Map<string, Turn>();
}

/**
 * Turn — in-memory span buffer for a single message → reply cycle.
 *
 * Public identity fields (`id`, `agent`, `channelId`) are exposed so tests
 * and diagnostic logging can correlate spans to their parent turn without
 * wrapping the field access in a method.
 */
export class Turn {
  /** Discord message id (or prefixed nanoid for non-Discord turns). */
  public readonly id: string;
  public readonly agent: string;
  public readonly channelId: string | null;

  private readonly store: TraceStore;
  private readonly log: Logger;

  private readonly spans: SpanRecord[] = [];
  private readonly startedAtMs: number;
  private committed = false;
  /**
   * Phase 52 Plan 01: buffered cache-telemetry snapshot attached at `end()`.
   * Undefined when the SDK `result` message did not carry usage fields (or
   * when the session-adapter was not threaded with this Turn).
   */
  private cacheSnapshot: CacheTelemetrySnapshot | undefined = undefined;
  /**
   * Phase 57 Plan 02: buffered TurnOrigin blob attached via `recordOrigin`.
   * Undefined when the caller did not go through TurnDispatcher (Phase 50/51/52
   * legacy path — bench harness, some heartbeat checks). Spread into the
   * frozen TurnRecord at `end()` time (no extra transaction).
   */
  private turnOrigin: TurnOrigin | undefined = undefined;
  /**
   * Phase 55 Plan 02 — per-turn idempotent tool-result cache. Lazy-allocated
   * on first access; the `toolCache` getter constructs the ToolCache only
   * when a whitelisted tool handler first queries it. Most turns that never
   * issue a duplicate whitelisted tool call never allocate a Map.
   *
   * LIFETIME: the cache Map is unreachable once this Turn goes out of scope
   * (GC drops it). Explicit cleanup is theatrical — we do NOT clear the
   * field at `end()` because the Turn itself is the GC root.
   */
  private _toolCache: ToolCache | undefined = undefined;
  /**
   * Phase 115 Plan 05 T04 — per-turn lazy-recall call counter. Incremented
   * by `bumpLazyRecallCount` from the four `clawcode_memory_*` IPC handlers
   * in daemon.ts. Drained into the `lazyRecallCallCount` column in
   * traces.db at `end()` time.
   */
  private lazyRecallCallCount = 0;
  /**
   * Phase 115 Plan 05 T04 — back-reference to the parent collector so the
   * Turn can pull rolling lazy-recall counts from outside-of-turn calls
   * at `end()` time. Optional so legacy bench-harness Turns (instantiated
   * directly) keep working.
   */
  private readonly collector: TraceCollector | undefined;

  constructor(
    id: string,
    agent: string,
    channelId: string | null,
    store: TraceStore,
    log: Logger,
    collector?: TraceCollector,
  ) {
    this.id = id;
    this.agent = agent;
    this.channelId = channelId;
    this.store = store;
    this.log = log;
    this.startedAtMs = Date.now();
    this.collector = collector;
  }

  /**
   * Phase 115 Plan 05 T04 — record one lazy-recall tool call within this
   * turn. Folded into the `lazyRecallCallCount` column at `end()`. No-op
   * after `end()` (post-commit).
   *
   * `tool` is the tool name (e.g. 'clawcode_memory_search'). It only
   * appears in the structured debug log line — the persisted column is
   * an aggregate count, not a per-tool histogram (sub-scope 7 dashboard
   * only needs the rate, not the breakdown — Plan 115-09 closeout).
   */
  bumpLazyRecallCount(tool: string): void {
    if (this.committed) return;
    this.lazyRecallCallCount += 1;
    this.log.debug(
      {
        agent: this.agent,
        turnId: this.id,
        tool,
        count: this.lazyRecallCallCount,
        action: "lazy-recall-call",
      },
      "[trace] lazy_recall_call_count incremented",
    );
  }

  /**
   * Open a new span for the given phase. Metadata is captured by value
   * (shallow-copied + frozen) on `span.end()`.
   */
  startSpan(name: string, metadata: Record<string, unknown> = {}): Span {
    const startedAtMs = Date.now();
    return new Span(name, startedAtMs, metadata, (record) => {
      if (this.committed) return;
      this.spans.push(record);
    });
  }

  /**
   * Phase 55 Plan 02 — lazy-init per-turn tool-result cache.
   *
   * Only constructed on first access so turns that never trigger a duplicate
   * whitelisted tool call never allocate a Map. Subsequent reads return
   * the same instance (stable identity for the lifetime of this Turn).
   *
   * The returned cache is the Turn's property — it is automatically GC'd
   * when the Turn goes out of scope. Do NOT share this instance across
   * Turns (doing so would violate the strictly-per-turn scope invariant
   * that makes cross-turn leaks impossible by construction).
   */
  get toolCache(): ToolCache {
    if (!this._toolCache) this._toolCache = new ToolCache();
    return this._toolCache;
  }

  /**
   * Phase 52 Plan 01: record the SDK result-message usage fields on this Turn.
   *
   * Called by `SdkSessionAdapter.iterateWithTracing` on the `result` message,
   * BEFORE the parent Turn is `end()`ed. The snapshot is buffered in-memory
   * and spread into the TurnRecord at `end()` — no extra transaction.
   *
   * Idempotent: a second call overwrites the first. Calling after `end()`
   * is a no-op (parent already committed).
   *
   * SECURITY: snapshot carries only token counts + sha256 `prefixHash`.
   * NEVER prompt bodies or message contents.
   */
  recordCacheUsage(snapshot: CacheTelemetrySnapshot): void {
    if (this.committed) return;
    this.cacheSnapshot = snapshot;
  }

  /**
   * Phase 57 Plan 02: attach a TurnOrigin to this turn. Buffered in memory
   * and spread into the frozen TurnRecord at `end()`. Idempotent overwrite
   * semantics — second call replaces the first. Calling after `end()` is a
   * no-op (parent already committed). Mirrors the precedent set by
   * `recordCacheUsage`.
   *
   * Primary caller: TurnDispatcher.dispatch / dispatchStream. Downstream
   * Phase 63 `clawcode trace` walker reads the persisted blob to stitch
   * cross-agent causation chains.
   */
  recordOrigin(origin: TurnOrigin): void {
    if (this.committed) return;
    this.turnOrigin = origin;
  }

  /**
   * Commit the turn: build a frozen TurnRecord from all buffered spans
   * and persist it via TraceStore.writeTurn in one transaction.
   *
   * Subsequent calls are no-ops (idempotent). Write failures are logged
   * at `warn` level — trace writes never fail the parent message path.
   *
   * Phase 52 Plan 01: when a cache-telemetry snapshot was recorded via
   * `recordCacheUsage`, its fields are spread into the frozen TurnRecord.
   * Otherwise the five cache fields are `undefined` (legacy shape).
   *
   * Phase 57 Plan 02: when a TurnOrigin was attached via `recordOrigin`,
   * it is spread into the frozen TurnRecord and persisted as a JSON blob
   * in the `turn_origin` column. Otherwise the field is absent (legacy shape)
   * and the column lands NULL.
   */
  end(status: TurnStatus): void {
    if (this.committed) return;
    this.committed = true;
    const endedAtMs = Date.now();

    // Phase 115 Plan 05 T04 — drain any pending out-of-turn lazy-recall
    // calls accumulated for this agent and add them to the per-turn count.
    let lazyRecallCallCount = this.lazyRecallCallCount;
    if (this.collector) {
      lazyRecallCallCount += this.collector.drainPendingLazyRecallCount(this.agent);
      this.collector.unregisterActiveTurn(this.agent, this);
    }

    const base = {
      id: this.id,
      agent: this.agent,
      channelId: this.channelId,
      startedAt: new Date(this.startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      totalMs: endedAtMs - this.startedAtMs,
      status,
      spans: Object.freeze([...this.spans]),
    };
    const record: TurnRecord = Object.freeze({
      ...base,
      ...(this.cacheSnapshot
        ? {
            cacheReadInputTokens: this.cacheSnapshot.cacheReadInputTokens,
            cacheCreationInputTokens: this.cacheSnapshot.cacheCreationInputTokens,
            inputTokens: this.cacheSnapshot.inputTokens,
            prefixHash: this.cacheSnapshot.prefixHash,
            cacheEvictionExpected: this.cacheSnapshot.cacheEvictionExpected,
          }
        : {}),
      ...(this.turnOrigin ? { turnOrigin: this.turnOrigin } : {}),
      // Phase 115 Plan 05 T04 — only attach when non-zero so legacy turn
      // shape stays NULL on the column for turns that never invoked a
      // lazy-recall tool. Mirrors the cache-telemetry-snapshot conditional
      // spread above.
      ...(lazyRecallCallCount > 0 ? { lazyRecallCallCount } : {}),
    });
    try {
      this.store.writeTurn(record);
      this.log.debug(
        { spanCount: record.spans.length, totalMs: record.totalMs, status },
        "turn traced",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      this.log.warn({ err: msg }, "trace write failed — dropping turn");
    }
  }
}

/**
 * Span — a single timed phase within a Turn.
 *
 * The Span captures the start timestamp at construction time and the
 * duration on `end()` (Date.now() delta). Calling `end()` twice is a
 * no-op so error handlers can safely defer cleanup.
 */
export class Span {
  private readonly name: string;
  private readonly startedAtMs: number;
  private readonly metadata: Record<string, unknown>;
  private readonly onEnd: (record: SpanRecord) => void;
  private ended = false;

  constructor(
    name: string,
    startedAtMs: number,
    metadata: Record<string, unknown>,
    onEnd: (record: SpanRecord) => void,
  ) {
    this.name = name;
    this.startedAtMs = startedAtMs;
    this.metadata = { ...metadata };
    this.onEnd = onEnd;
  }

  /**
   * Phase 53 Plan 02 — merge additional keys into this span's metadata record
   * BEFORE `end()` is called. No-op when the span has already ended (prevents
   * mutation after commit).
   *
   * The merge is shallow — top-level keys overwrite. Intended for small
   * dictionaries like `{ section_tokens }` emitted by the context assembler;
   * callers MUST NOT log full prompt bodies here (SECURITY — see phase
   * critical_constraints).
   */
  setMetadata(extra: Record<string, unknown>): void {
    if (this.ended) return;
    for (const key of Object.keys(extra)) {
      this.metadata[key] = extra[key];
    }
  }

  /** Close the span; duration is captured as `Date.now() - startedAtMs`. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    const durationMs = Date.now() - this.startedAtMs;
    this.onEnd(
      Object.freeze({
        name: this.name,
        startedAt: new Date(this.startedAtMs).toISOString(),
        durationMs,
        metadata: Object.freeze({ ...this.metadata }),
      }),
    );
  }
}
