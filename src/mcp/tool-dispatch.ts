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
