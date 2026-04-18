/**
 * Phase 69 Plan 02 — SSE writer for the OpenAI endpoint.
 *
 * Wraps a Node.js `http.ServerResponse` with:
 *
 *   - SSE headers (Pitfall 5): `Content-Type: text/event-stream`,
 *     `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`,
 *     `X-Accel-Buffering: no` (nginx buffering kill).
 *
 *   - Keepalive timer (69-RESEARCH.md Pattern 5): emits `: keepalive\n\n`
 *     (SSE comment — spec-compliant, clients ignore) every `keepaliveMs`
 *     while no real delta has been sent. Stops as soon as the first chunk
 *     is emitted so real content isn't interleaved with comments.
 *
 *   - Backpressure (Node.js backpressuring-in-streams docs): when
 *     `res.write()` returns `false`, `emit` awaits the `drain` event before
 *     resolving so the caller doesn't race ahead of the socket buffer.
 *
 *   - `[DONE]` terminator (Pitfall 4): `emitDone` writes the literal
 *     `data: [DONE]\n\n` bytes and calls `res.end()`. The double newline is
 *     load-bearing — Python OpenAI SDK's SSE parser blocks forever without it.
 *
 *   - Client-disconnect hook: `onClose(cb)` wires the `close` and `error`
 *     events on the response socket so the server can abort the Claude
 *     query via AbortController.
 *
 *   - Graceful-shutdown hook (Pitfall 10): server keeps a Set<handle> and
 *     calls `close()` on each before `server.close()` so the SSE connections
 *     don't hold the daemon open during systemd shutdown.
 *
 * This module is pure-Node; it has no knowledge of translator state,
 * ApiKeysStore, or config — just writes bytes in the right shape.
 */

import type { ServerResponse } from "node:http";
import type { ChatCompletionChunk, OpenAiError } from "./types.js";

/**
 * Public handle returned by `startOpenAiSse`. Each handle is bound to a single
 * `res` object; tests may use a `PassThrough`-backed shim that satisfies the
 * subset of `ServerResponse` we touch.
 */
export interface OpenAiSseHandle {
  /**
   * Emit one chunk as `data: <json>\n\n`. Resolves after the bytes have been
   * accepted by the socket (may await `drain` under backpressure). Resolves
   * to `false` if the response is already ended or the write failed.
   */
  emit(chunk: ChatCompletionChunk): Promise<boolean>;

  /**
   * Emit the terminal `data: [DONE]\n\n` sentinel and end the response.
   * Idempotent — a second call is a no-op.
   */
  emitDone(): void;

  /**
   * Emit a final error chunk (LiteLLM-compatible error-in-stream pattern)
   * followed by the `[DONE]` sentinel. Use this when the driver fails mid
   * stream after at least one chunk has been sent — the client sees a clean
   * termination.
   */
  emitError(err: OpenAiError): void;

  /**
   * Register a callback for the `close` and `error` events on the underlying
   * response. Used by the server to trigger `AbortController.abort()` when
   * the client disconnects. Safe to call multiple times.
   */
  onClose(cb: () => void): void;

  /**
   * Hard-close the stream without writing `[DONE]`. Clears the keepalive
   * timer and calls `res.end()` if the response is not already ended. Used
   * by the graceful-shutdown path (Pitfall 10).
   */
  close(): void;
}

/** Minimal shape of `ServerResponse` we actually touch — kept tight for testability. */
interface SseResponseLike {
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: string): boolean;
  end(): void;
  once(event: "drain", cb: () => void): void;
  on(event: "close" | "error", cb: () => void): void;
  readonly writableEnded: boolean;
}

/** Minimum keepalive cadence — guards against pathological 0/negative values. */
const MIN_KEEPALIVE_MS = 100;

/**
 * Wrap a `ServerResponse` with SSE semantics for OpenAI `/v1/chat/completions`.
 *
 * Writes the SSE response headers on creation (status 200). Every subsequent
 * call to `emit`/`emitDone`/`emitError` writes body bytes. The caller is
 * responsible for translating SDK events into ChatCompletionChunk objects
 * (via `src/openai/translator.ts`) before passing them here.
 */
export function startOpenAiSse(
  res: ServerResponse,
  opts: { keepaliveMs: number },
): OpenAiSseHandle {
  const keepaliveMs = Math.max(opts.keepaliveMs, MIN_KEEPALIVE_MS);
  const resLike = res as unknown as SseResponseLike;

  // Write headers exactly once. Pitfall 5 headers included.
  resLike.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let firstDeltaSent = false;
  let doneEmitted = false;

  const keepalive = setInterval(() => {
    if (firstDeltaSent) return;
    if (resLike.writableEnded) return;
    try {
      resLike.write(": keepalive\n\n");
    } catch {
      // Socket died between now and the previous check — swallow; the next
      // emit attempt will see writableEnded or re-throw.
    }
  }, keepaliveMs);
  // Prevent the keepalive timer from keeping the Node.js event loop alive —
  // otherwise tests with fake timers could hang waiting for the timer to
  // fire when the test has already finished. Always unref in production too
  // (the caller owns the lifecycle of the response; SSE state shouldn't keep
  // the process alive on its own).
  if (typeof (keepalive as unknown as { unref?: () => void }).unref === "function") {
    (keepalive as unknown as { unref: () => void }).unref();
  }

  /**
   * Wait for a single `drain` event. Resolves to true if it arrived, or
   * false if the response ended first (we assume caller already observed
   * `writableEnded`).
   */
  function waitForDrain(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const onDrain = () => {
        if (settled) return;
        settled = true;
        resolve(true);
      };
      const onClose = () => {
        if (settled) return;
        settled = true;
        resolve(false);
      };
      resLike.once("drain", onDrain);
      resLike.on("close", onClose);
    });
  }

  async function emit(chunk: ChatCompletionChunk): Promise<boolean> {
    if (resLike.writableEnded || doneEmitted) return false;
    firstDeltaSent = true;
    const body = `data: ${JSON.stringify(chunk)}\n\n`;
    try {
      const ok = resLike.write(body);
      if (!ok) {
        const drained = await waitForDrain();
        if (!drained) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function emitDone(): void {
    if (doneEmitted) return;
    doneEmitted = true;
    clearInterval(keepalive);
    try {
      if (!resLike.writableEnded) {
        resLike.write("data: [DONE]\n\n");
        resLike.end();
      }
    } catch {
      // Socket closed already — nothing to do.
    }
  }

  function emitError(err: OpenAiError): void {
    if (doneEmitted) return;
    doneEmitted = true;
    clearInterval(keepalive);
    try {
      if (!resLike.writableEnded) {
        // Emit a final SSE frame carrying the OpenAI error envelope, then
        // the [DONE] terminator so well-behaved clients terminate their
        // parse loop gracefully (LiteLLM-style error-in-stream).
        resLike.write(`data: ${JSON.stringify(err)}\n\n`);
        resLike.write("data: [DONE]\n\n");
        resLike.end();
      }
    } catch {
      // ignore
    }
  }

  function onClose(cb: () => void): void {
    resLike.on("close", cb);
    resLike.on("error", cb);
  }

  function close(): void {
    clearInterval(keepalive);
    doneEmitted = true;
    try {
      if (!resLike.writableEnded) {
        resLike.end();
      }
    } catch {
      // ignore
    }
  }

  return { emit, emitDone, emitError, onClose, close };
}
