/**
 * Phase 999.10 — daemon-side `op://` secret cache + retry/backoff.
 *
 * `SecretsResolver` is the single in-memory secret cache + p-retry shim that
 * replaces the three independent `op read` shell-out sites (Discord
 * botToken, shared `mcpServers[].env`, and per-agent `mcpEnvOverrides`).
 *
 * Wave 1 (this plan, 999.10-01) implements the class. Wave 2 swaps the three
 * resolution callsites to it; Wave 3 wires `ConfigWatcher` invalidation and
 * the `secrets-status` IPC surface.
 *
 * DI-pure by construction — production wires `defaultOpReadShellOut` (from
 * `op-env-resolver.ts`) as the underlying `opRead`; tests inject a `vi.fn()`.
 *
 * Security invariants (SEC-07):
 *   - Resolved secret values NEVER appear in any pino log call. Only the
 *     `op://` URI (operator-controlled config) and structured retry/cache
 *     metadata land in log fields.
 *   - Errors thrown by `resolve()` embed the URI and the underlying error
 *     message (operator-controlled CLI noise) but never the resolved value.
 *   - Empty-string resolution throws an `AbortError` (no zero-token cache
 *     write — defense in depth against silent fail-open auth).
 *
 * Reliability invariants (SEC-02 / SEC-03):
 *   - URI-keyed cache: repeated `resolve(uri)` calls for the same URI hit
 *     the in-memory `Map` after the first miss.
 *   - Inflight dedup: concurrent `resolve(uri)` calls for the same URI
 *     share one underlying `opRead` invocation via a `Promise` map.
 *   - Exponential backoff with jitter (3 retries, 1s/2s/4s base × random
 *     1-2x). Rate-limit errors bail early via `AbortError` after attempt 2
 *     to avoid compounding the throttle window.
 */

import pRetry, { AbortError } from "p-retry";
import type pino from "pino";

/** Async shell-out signature — one URI in, resolved value out. */
export type OpReadFn = (uri: string) => Promise<string>;

/**
 * Constructor dependency injection — `opRead` and `log` are mandatory;
 * `retryOptions` overrides the per-field defaults (retries:3, minTimeout:
 * 1000, maxTimeout:8000, factor:2, randomize:true).
 */
export interface SecretsResolverDeps {
  readonly opRead: OpReadFn;
  readonly log: pino.Logger;
  readonly retryOptions?: {
    readonly retries?: number;
    readonly minTimeout?: number;
    readonly maxTimeout?: number;
    readonly factor?: number;
    readonly randomize?: boolean;
  };
}

/**
 * Telemetry counters surfaced by `snapshot()` and (in Wave 3) the
 * `secrets-status` IPC method. Mutated in place by the resolver — the
 * snapshot helper returns a frozen copy with `cacheSize` appended.
 */
export interface SecretsCounters {
  hits: number;
  misses: number;
  retries: number;
  rateLimitHits: number;
  lastFailureAt: string | undefined;
  lastFailureReason: string | undefined;
  lastRefreshedAt: string | undefined;
}

/** Rate-limit-class error detection — operator-visible regex per RESEARCH.md Pitfall 5. */
const RATE_LIMIT_RE = /rate.?limit|too many requests/i;

/**
 * In-memory `op://` secret cache + retry shim.
 *
 * One instance per daemon process. Construct in `startDaemon`, pass by
 * reference to (a) the loader's sync resolver wrapper, (b) the per-agent
 * `opEnvResolver` closure, (c) the Discord botToken resolution block, and
 * (d) the recovery handler.
 */
export class SecretsResolver {
  private readonly cache = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<string>>();
  private readonly counters: SecretsCounters = {
    hits: 0,
    misses: 0,
    retries: 0,
    rateLimitHits: 0,
    lastFailureAt: undefined,
    lastFailureReason: undefined,
    lastRefreshedAt: undefined,
  };

  constructor(private readonly deps: SecretsResolverDeps) {}

  /**
   * Resolve an `op://` URI, hitting the cache if warm or shelling out via
   * the injected `opRead` (with retry + dedup) on miss.
   */
  async resolve(uri: string): Promise<string> {
    if (!uri.startsWith("op://")) {
      // Match the existing `defaultOpRefResolver` contract (case-sensitive
      // prefix only) — broader validation lives at the loader/schema layer.
      throw new Error(`SecretsResolver.resolve called with non-op URI: ${uri}`);
    }

    const cached = this.cache.get(uri);
    if (cached !== undefined) {
      this.counters.hits++;
      return cached;
    }

    // De-dupe concurrent resolutions of the same URI (boot-storm fix).
    const inflight = this.inflight.get(uri);
    if (inflight) return inflight;

    const promise = this.resolveWithRetry(uri).finally(() => {
      this.inflight.delete(uri);
    });
    this.inflight.set(uri, promise);
    return promise;
  }

  /** Sync read of the internal cache — used by Wave 2's loader sync wrapper. */
  getCached(uri: string): string | undefined {
    return this.cache.get(uri);
  }

  private async resolveWithRetry(uri: string): Promise<string> {
    this.counters.misses++;

    try {
      const result = await pRetry(
        async () => {
          const value = await this.deps.opRead(uri);
          if (value === undefined || value === null || value.length === 0) {
            // Permanent error — empty resolution should not retry, and must
            // not land in the cache as a zero-length token (Pitfall 4).
            throw new AbortError(`op read returned empty string for ${uri}`);
          }
          return value;
        },
        {
          retries: this.deps.retryOptions?.retries ?? 3,
          minTimeout: this.deps.retryOptions?.minTimeout ?? 1000,
          maxTimeout: this.deps.retryOptions?.maxTimeout ?? 8000,
          factor: this.deps.retryOptions?.factor ?? 2,
          randomize: this.deps.retryOptions?.randomize ?? true,
          onFailedAttempt: (ctx) => {
            this.counters.retries++;
            const reason = ctx.error.message;
            const isRateLimit = RATE_LIMIT_RE.test(reason);
            if (isRateLimit) this.counters.rateLimitHits++;

            // Structured log — operator-correlatable. NEVER includes the
            // resolved value (we only have it on success; failures by
            // construction never carry one).
            this.deps.log.warn(
              {
                uri,
                attempt: ctx.attemptNumber,
                retriesLeft: ctx.retriesLeft,
                reason,
                isRateLimit,
              },
              "secrets-resolver: op read attempt failed",
            );

            // Pitfall 5 — rate-limit early bail. After attempt 2 (the first
            // retry), if the error is still a rate-limit, abort the retry
            // loop. Throwing AbortError from onFailedAttempt halts retries
            // and surfaces the error to the outer catch.
            if (isRateLimit && ctx.attemptNumber >= 2) {
              throw new AbortError(
                `rate-limited at attempt ${ctx.attemptNumber}: ${reason}`,
              );
            }
          },
        },
      );

      this.cache.set(uri, result);
      this.counters.lastRefreshedAt = new Date().toISOString();
      this.deps.log.info(
        { uri, cacheSize: this.cache.size },
        "secrets-resolver: resolved + cached",
      );
      return result;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.counters.lastFailureAt = new Date().toISOString();
      this.counters.lastFailureReason = reason;
      throw new Error(`Failed to resolve ${uri} after retries: ${reason}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  /** Drop one URI from the cache (Wave 3 — ConfigWatcher diff hook). */
  invalidate(uri: string): void {
    if (this.cache.delete(uri)) {
      this.deps.log.info({ uri }, "secrets-resolver: cache invalidated");
    }
  }

  /** Drop the entire cache (Wave 3 — `secrets-invalidate` IPC). */
  invalidateAll(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.deps.log.info({ size }, "secrets-resolver: full cache invalidated");
  }

  /**
   * Pre-resolve every URI in the list in parallel. Used at daemon boot to
   * fill the cache once, before any agent spawn. Failures DO NOT throw —
   * they're returned as a per-URI result so the caller can decide
   * fail-closed vs fail-open per zone (mirrors the existing graceful-
   * degradation contract for op:// reference failures at boot).
   */
  async preResolveAll(
    uris: readonly string[],
  ): Promise<readonly { uri: string; ok: boolean; reason?: string }[]> {
    const results = await Promise.allSettled(
      uris.map(async (uri) => {
        await this.resolve(uri);
        return uri;
      }),
    );
    return results.map((r, i) => {
      const uri = uris[i]!;
      if (r.status === "fulfilled") return { uri, ok: true };
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      return { uri, ok: false, reason };
    });
  }

  /** Frozen telemetry snapshot — counters + current cache size. */
  snapshot(): Readonly<SecretsCounters & { cacheSize: number }> {
    return Object.freeze({ ...this.counters, cacheSize: this.cache.size });
  }
}
