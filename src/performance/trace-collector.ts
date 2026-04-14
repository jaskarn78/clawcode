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
    return new Turn(turnId, agent, channelId, this.store, childLog);
  }
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

  constructor(
    id: string,
    agent: string,
    channelId: string | null,
    store: TraceStore,
    log: Logger,
  ) {
    this.id = id;
    this.agent = agent;
    this.channelId = channelId;
    this.store = store;
    this.log = log;
    this.startedAtMs = Date.now();
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
   * Commit the turn: build a frozen TurnRecord from all buffered spans
   * and persist it via TraceStore.writeTurn in one transaction.
   *
   * Subsequent calls are no-ops (idempotent). Write failures are logged
   * at `warn` level — trace writes never fail the parent message path.
   *
   * Phase 52 Plan 01: when a cache-telemetry snapshot was recorded via
   * `recordCacheUsage`, its fields are spread into the frozen TurnRecord.
   * Otherwise the five cache fields are `undefined` (legacy shape).
   */
  end(status: TurnStatus): void {
    if (this.committed) return;
    this.committed = true;
    const endedAtMs = Date.now();
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
    const record: TurnRecord = Object.freeze(
      this.cacheSnapshot
        ? {
            ...base,
            cacheReadInputTokens: this.cacheSnapshot.cacheReadInputTokens,
            cacheCreationInputTokens: this.cacheSnapshot.cacheCreationInputTokens,
            inputTokens: this.cacheSnapshot.inputTokens,
            prefixHash: this.cacheSnapshot.prefixHash,
            cacheEvictionExpected: this.cacheSnapshot.cacheEvictionExpected,
          }
        : base,
    );
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
