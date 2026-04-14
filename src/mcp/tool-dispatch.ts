/**
 * Phase 55 Plan 02 — concurrency-capped parallel dispatch.
 *
 * Purpose
 *   When the Claude Agent SDK dispatches multiple tool_use blocks in the
 *   SAME assistant message batch, our MCP handlers (registered in
 *   src/mcp/server.ts) can execute them in parallel. This utility caps the
 *   in-flight count at `perf.tools.maxConcurrent` (default 10) using a
 *   simple worker-pool pattern, and returns per-handler outcomes via
 *   Promise.allSettled semantics so one failure does not block siblings.
 *
 * Implementation
 *   Lock-free worker pool: a shared `nextIndex` counter is advanced by each
 *   worker. `workerCount = min(maxConcurrent, handlers.length)` workers
 *   loop until the shared counter is exhausted. No polling, no setInterval;
 *   only native promise scheduling.
 *
 * Error Isolation
 *   Each handler's outcome is captured as `{status: "fulfilled", value}` or
 *   `{status: "rejected", reason}`. Unhandled rejections cannot escape
 *   because we catch inside the worker. Behaviour matches Promise.allSettled
 *   but with a concurrency cap.
 *
 * Result Ordering
 *   Results are placed into the output array at their input index, so the
 *   returned array is ALWAYS in input order regardless of completion
 *   order.
 */

export async function runWithConcurrencyLimit<T>(
  handlers: ReadonlyArray<() => Promise<T>>,
  maxConcurrent: number,
): Promise<ReadonlyArray<PromiseSettledResult<T>>> {
  if (handlers.length === 0) return [];
  if (maxConcurrent <= 0) {
    throw new Error(
      `runWithConcurrencyLimit: maxConcurrent must be >= 1 (got ${maxConcurrent})`,
    );
  }

  const results: PromiseSettledResult<T>[] = new Array(handlers.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= handlers.length) return;
      try {
        const value = await handlers[i]!();
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };

  const workerCount = Math.min(maxConcurrent, handlers.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * ConcurrencyGate — per-agent semaphore for gating individual tool invocations.
 *
 * Motivation
 *   The Claude Agent SDK dispatches multiple `tool_use` blocks in parallel — our
 *   MCP handler is invoked concurrently for each. `runWithConcurrencyLimit`
 *   above gates a known array of handlers (call-site batch), but at the MCP
 *   transport boundary handler invocations arrive as independent async calls.
 *   A semaphore is the natural fit: each call `await`s acquire(), runs, then
 *   calls release() in a `finally`.
 *
 * Semantics
 *   - `acquire()` resolves when in-flight count < limit; increments count.
 *   - Returned release function decrements count and wakes the next waiter.
 *   - FIFO fairness — waiters resolve in enqueue order.
 *   - Reentrant-safe: each acquire returns its own release fn; double-release
 *     on the SAME call is a no-op (idempotent).
 *
 * Usage
 *   ```ts
 *   const gate = new ConcurrencyGate(10);
 *   const release = await gate.acquire();
 *   try { return await rawCall(); } finally { release(); }
 *   ```
 */
export class ConcurrencyGate {
  readonly #limit: number;
  #inFlight = 0;
  readonly #waiters: Array<() => void> = [];

  constructor(limit: number) {
    if (limit <= 0 || !Number.isFinite(limit)) {
      throw new Error(
        `ConcurrencyGate: limit must be a positive finite integer (got ${limit})`,
      );
    }
    this.#limit = limit;
  }

  /** Current number of in-flight acquirers. Test-only accessor. */
  get inFlight(): number {
    return this.#inFlight;
  }

  /** Configured concurrency limit. Test-only accessor. */
  get limit(): number {
    return this.#limit;
  }

  /**
   * Acquire a slot. Returns a one-shot release function.
   *
   * When in-flight count < limit, resolves immediately.
   * Otherwise queues until a slot frees up.
   */
  async acquire(): Promise<() => void> {
    if (this.#inFlight < this.#limit) {
      this.#inFlight += 1;
      return this.#makeReleaseFn();
    }

    await new Promise<void>((resolve) => {
      this.#waiters.push(resolve);
    });
    this.#inFlight += 1;
    return this.#makeReleaseFn();
  }

  #makeReleaseFn(): () => void {
    let released = false;
    return () => {
      if (released) return; // idempotent
      released = true;
      this.#inFlight -= 1;
      const nextWaiter = this.#waiters.shift();
      if (nextWaiter) nextWaiter();
    };
  }
}
