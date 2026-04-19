/**
 * Phase 69 Plan 03 Task 2 — Production OpenAiSessionDriver.
 *
 * Implements the `OpenAiSessionDriver` interface (src/openai/server.ts) against
 * the real daemon stack: `TurnDispatcher` (Phase 57) + `SessionManager`
 * (Phase 65 ConversationStore lifecycle) + `TraceCollector` (Phase 50) +
 * `ApiKeySessionIndex` (this plan's Task 1).
 *
 * Architecture decisions (recorded for Plan 03 SUMMARY):
 *
 *   1. **NO additive fields on TurnDispatcher.** The existing `dispatchStream`
 *      contract (caller-owned Turn + AbortSignal + channelId) is sufficient
 *      for v2.0 text streaming. Prompt-cache preservation lives in the
 *      SessionAdapter's stable prefix; the OpenAI client's `role:"system"`
 *      messages flow in through the USER MESSAGE BODY (as a trailing "System
 *      context (appended)" note) rather than through a new dispatcher
 *      option — this keeps Pitfall 8 intact (never override the stable
 *      prefix) with zero dispatcher signature change. Tools / toolResults
 *      are accepted at the driver boundary for v2.1 upgrade and for trace
 *      metadata but are NOT wired into the SDK query on this first cut —
 *      the Claude session's MCP tools run server-side as they always did.
 *
 *   2. **SdkStreamEvent synthesis.** TurnDispatcher's callback signature is
 *      `(accumulated: string) => void` — no raw SDK events. The driver
 *      translates that callback into a stream of `content_block_delta`
 *      `text_delta` events (one per callback invocation carrying only the
 *      NEW delta since the last call), terminated by a synthetic `result`
 *      event carrying the current session_id resolved via
 *      `sessionManager.getActiveConversationSessionId(agent)`. This gives
 *      the Plan 02 translator exactly the shape it expects.
 *
 *   3. **Bounded queue + promise resolver** bridges the callback-style
 *      dispatcher into a pull-style async iterable. The generator yields
 *      from the queue; the callback pushes into the queue and resolves a
 *      pending waiter. Backpressure is inherent — if the consumer stops
 *      iterating, the queue stops draining, and when `dispatchStream`
 *      resolves we synthesize the terminal `result` event and close.
 *
 *   4. **Caller-owned Turn via TraceCollector.startTurn** with origin
 *      `makeRootOriginWithTurnId("openai-api", keyHash.slice(0,8), turnId)`.
 *      Turn lifecycle: `end("success")` on clean completion, `end("error")`
 *      on exception or abort. Matches DiscordBridge's pattern verbatim.
 *
 *   5. **Session recording** happens AFTER `dispatchStream` resolves (the
 *      `result` event is synthesized with the session_id resolved via
 *      SessionManager). On success we record/touch; on abort/error we
 *      skip recording (the session didn't complete).
 */

import { nanoid } from "nanoid";
import type { Logger } from "pino";

import type { SessionManager } from "../manager/session-manager.js";
import type { TurnDispatcher } from "../manager/turn-dispatcher.js";
import type { TraceCollector, Span, Turn } from "../performance/trace-collector.js";
import { makeRootOriginWithTurnId } from "../manager/turn-origin.js";

import type { OpenAiSessionDriver } from "./server.js";
import type { ApiKeySessionIndex } from "./session-index.js";
import type { SdkStreamEvent } from "./types.js";

/** Dependency bag for `createOpenAiSessionDriver`. All fields required. */
export interface OpenAiSessionDriverDeps {
  /**
   * SessionManager — used for resolving the ConversationStore session_id
   * AFTER dispatch completes (via `getActiveConversationSessionId`). Tests
   * mock just this method.
   */
  readonly sessionManager: Pick<
    SessionManager,
    "getActiveConversationSessionId"
  >;

  /**
   * TurnDispatcher — the single chokepoint every agent-turn initiation
   * flows through (Phase 57). The driver uses `dispatchStream` with a
   * caller-owned Turn + AbortSignal + channelId:null.
   */
  readonly turnDispatcher: Pick<TurnDispatcher, "dispatchStream">;

  /**
   * Factory that returns the per-agent `ApiKeySessionIndex`. The production
   * wiring builds this from `sessionManager.getMemoryStore(agent)
   * .getDatabase()`. Tests pass an in-memory `:memory:` DB.
   */
  readonly sessionIndexFor: (agentName: string) => ApiKeySessionIndex;

  /**
   * Factory that returns the per-agent `TraceCollector`. Production wiring
   * uses `sessionManager.getTraceCollector(agent)`. Returns `null` or
   * `undefined` when no collector is wired — driver degrades gracefully
   * (no Turn lifecycle, but dispatch still proceeds).
   */
  readonly traceCollectorFor: (agentName: string) => TraceCollector | undefined | null;

  /** Optional logger for structured diagnostics. */
  readonly log?: Logger;
}

/** Input shape for `driver.dispatch` — mirrors `OpenAiSessionDriver.dispatch`. */
type DispatchInput = Parameters<OpenAiSessionDriver["dispatch"]>[0];

/**
 * Build the production OpenAiSessionDriver. The returned object satisfies
 * Plan 02's `OpenAiSessionDriver` interface; `startOpenAiServer` consumes it
 * via its `driver` config field.
 */
export function createOpenAiSessionDriver(
  deps: OpenAiSessionDriverDeps,
): OpenAiSessionDriver {
  return {
    dispatch(input) {
      return dispatchAsyncIterable(deps, input);
    },
  };
}

/**
 * Kick off a dispatch and return an `AsyncIterable<SdkStreamEvent>`. The
 * iterable is a thin wrapper around an async generator so the consumer can
 * control iteration cadence (stop early, race against timeouts, etc.).
 */
function dispatchAsyncIterable(
  deps: OpenAiSessionDriverDeps,
  input: DispatchInput,
): AsyncIterable<SdkStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      return runDispatch(deps, input);
    },
  };
}

/** Item queued by the dispatcher callback, pulled by the generator. */
type QueueItem =
  | { kind: "event"; event: SdkStreamEvent }
  | { kind: "end"; finalText: string }
  | { kind: "error"; error: Error };

/**
 * The core driver loop — bridges the TurnDispatcher callback style into a
 * pull-style async iterator. Written as a hand-rolled iterator (rather than
 * `async function*`) so the abort path can reject any pending `next()` call
 * immediately without waiting for `dispatchStream` to resolve.
 */
function runDispatch(
  deps: OpenAiSessionDriverDeps,
  input: DispatchInput,
): AsyncIterator<SdkStreamEvent> {
  const { agentName, keyHash, lastUserMessage, clientSystemAppend, signal, xRequestId } = input;

  // 1. Build TurnOrigin — kind:"openai-api", source.id = first-8-hex(key_hash).
  const fingerprint = keyHash.slice(0, 8);
  // nanoid(10) produces a 10-char URL-safe string; TURN_ID_REGEX requires
  // ≥10 alphanumeric chars after the `openai-api:` prefix.
  const turnId = `openai-api:${nanoid(12)}`;
  const origin = makeRootOriginWithTurnId("openai-api", fingerprint, turnId);

  // 2. Open caller-owned Turn via the agent's TraceCollector (non-fatal if absent).
  const collector = deps.traceCollectorFor(agentName) ?? null;
  let turn: Turn | undefined;
  if (collector) {
    try {
      turn = collector.startTurn(origin.rootTurnId, agentName, null);
    } catch (err) {
      deps.log?.warn(
        { agent: agentName, err: (err as Error).message },
        "openai-driver: startTurn failed — continuing without trace",
      );
    }
  }

  // Phase 73 Plan 03 — openai.chat_completion span for TTFB + total-turn
  // latency (LAT-03). Sibling to session-adapter's `first_token` span —
  // divergence between the two surfaces driver-queue overhead vs raw-SDK
  // first-token latency.
  const dispatchStartMs = Date.now();
  let firstDeltaMs: number | undefined = undefined;
  let chatSpan: Span | undefined;
  if (turn) {
    try {
      chatSpan = turn.startSpan("openai.chat_completion", {
        agent: agentName,
        keyHashPrefix: fingerprint,
        xRequestId,
        stream: true,
        tools: input.tools?.length ?? 0,
      });
    } catch {
      /* non-fatal — trace write is best-effort */
    }
  }
  // Pitfall 8 guard (73-RESEARCH): parallel wiring from success, error, and
  // abort paths may all call endChatSpanOnce — idempotent close preserves the
  // metadata captured at the FIRST call.
  let chatSpanEnded = false;
  const endChatSpanOnce = (metadata: Record<string, unknown>): void => {
    if (chatSpanEnded) return;
    chatSpanEnded = true;
    try {
      chatSpan?.setMetadata(metadata);
      chatSpan?.end();
    } catch {
      /* non-fatal */
    }
  };

  // 3. Build the outgoing user message. clientSystemAppend — when present —
  //    is APPENDED after a visible delimiter so the agent's stable system
  //    prefix (prompt-cache preserved) stays intact (Pitfall 8). We also
  //    stamp the x-request-id + any present tool definitions into a trailer
  //    section so they appear in trace rows for observability.
  const messageParts: string[] = [lastUserMessage];
  if (clientSystemAppend && clientSystemAppend.length > 0) {
    messageParts.push(
      "",
      "--- System context (appended) ---",
      clientSystemAppend,
    );
  }
  if (input.tools && input.tools.length > 0) {
    const names = input.tools.map((t) => t.name).join(", ");
    messageParts.push("", `(Client-declared tools: ${names})`);
  }
  if (input.toolResults.length > 0) {
    const ids = input.toolResults.map((t) => t.tool_use_id).join(", ");
    messageParts.push("", `(Client tool results for: ${ids})`);
  }
  const outgoingMessage = messageParts.join("\n");

  // 4. Set up the bounded queue + pending waiter for the pull-style iterator.
  const queue: QueueItem[] = [];
  let pendingResolve: ((v: IteratorResult<SdkStreamEvent>) => void) | null = null;
  let pendingReject: ((err: Error) => void) | null = null;
  let accumulatedSoFar = "";
  let emittedTextBlockStart = false;
  let done = false;
  let abortListenerAttached = false;
  // Ensure turn.end() fires exactly once — the abort listener and the
  // dispatchStream promise-rejection path may both trigger.
  let turnEnded = false;
  const endTurnOnce = (outcome: "success" | "error"): void => {
    if (turnEnded) return;
    turnEnded = true;
    try {
      turn?.end(outcome);
    } catch {
      /* non-fatal — trace write is best-effort */
    }
  };

  const flushNext = (): boolean => {
    if (!pendingResolve) return false;
    const item = queue.shift();
    if (!item) return false;
    const resolve = pendingResolve;
    const reject = pendingReject;
    pendingResolve = null;
    pendingReject = null;
    if (item.kind === "event") {
      resolve({ value: item.event, done: false });
      return true;
    }
    if (item.kind === "end") {
      // Terminal result event — compute the final session id and emit.
      emitTerminal(resolve, item.finalText);
      return true;
    }
    // error
    if (reject) reject(item.error);
    else resolve({ value: undefined, done: true });
    return true;
  };

  const emitTerminal = (
    resolve: (v: IteratorResult<SdkStreamEvent>) => void,
    _finalText: string,
  ): void => {
    done = true;
    // Close the trailing content block + emit the result.
    if (emittedTextBlockStart) {
      // We could also emit a content_block_stop, but the Plan 02 translator
      // tolerates its absence. Keep the event stream minimal.
    }
    let sessionId: string | undefined;
    try {
      sessionId = deps.sessionManager.getActiveConversationSessionId(agentName);
    } catch {
      sessionId = undefined;
    }
    // Record / touch the bearer-key → session mapping.
    if (sessionId) {
      try {
        const idx = deps.sessionIndexFor(agentName);
        idx.record(keyHash, agentName, sessionId);
        idx.touch(keyHash);
      } catch (err) {
        deps.log?.warn(
          { agent: agentName, err: (err as Error).message },
          "openai-driver: session-index record/touch failed (non-fatal)",
        );
      }
    }
    const event: SdkStreamEvent = {
      type: "result",
      // Fall back to a synthetic id so downstream builders (makeNonStreamResponse)
      // always have a non-empty string to work with; the translator treats it
      // as opaque — only the server persistence cares about its authenticity.
      session_id: sessionId ?? `openai-${xRequestId}`,
    };
    resolve({ value: event, done: false });
  };

  const pushEvent = (event: SdkStreamEvent): void => {
    queue.push({ kind: "event", event });
    flushNext();
  };

  const pushEnd = (finalText: string): void => {
    queue.push({ kind: "end", finalText });
    flushNext();
  };

  const pushError = (err: Error): void => {
    queue.push({ kind: "error", error: err });
    flushNext();
  };

  // 5. Kick off the dispatch (fire-and-forget — we own the callbacks).
  const onChunk = (accumulated: string): void => {
    // Phase 73 Plan 03 — stamp ttfb_ms on the FIRST onChunk invocation. The
    // guard (firstDeltaMs === undefined) protects against spurious pre-delta
    // calls or a second call beating the dispatch-promise settle.
    if (firstDeltaMs === undefined) {
      firstDeltaMs = Date.now();
    }
    if (!emittedTextBlockStart) {
      emittedTextBlockStart = true;
      pushEvent({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text" },
        },
      });
    }
    // Delta = accumulated text minus what we've already emitted.
    if (accumulated.length <= accumulatedSoFar.length) return;
    const delta = accumulated.slice(accumulatedSoFar.length);
    accumulatedSoFar = accumulated;
    if (delta.length === 0) return;
    pushEvent({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: delta },
      },
    });
  };

  const dispatchPromise = deps.turnDispatcher
    .dispatchStream(origin, agentName, outgoingMessage, onChunk, {
      turn,
      signal,
      channelId: null,
    })
    .then((finalText) => {
      endTurnOnce("success");
      endChatSpanOnce({
        ttfb_ms:
          firstDeltaMs !== undefined ? firstDeltaMs - dispatchStartMs : null,
        total_turn_ms: Date.now() - dispatchStartMs,
      });
      pushEnd(finalText);
    })
    .catch((err: unknown) => {
      endTurnOnce("error");
      endChatSpanOnce({
        ttfb_ms:
          firstDeltaMs !== undefined ? firstDeltaMs - dispatchStartMs : null,
        total_turn_ms: Date.now() - dispatchStartMs,
        error: true,
      });
      pushError(err instanceof Error ? err : new Error(String(err)));
    });

  // Swallow unhandled rejections on the promise itself — we surface errors
  // via pushError so the iterator caller sees them.
  void dispatchPromise;

  // 6. Wire abort → synthesize an error into the queue so pending next()
  //    calls resolve promptly. dispatchStream's underlying SDK also honors
  //    the signal (end-of-turn), but this guarantees the iterator resolves
  //    even if the SDK is slow to notice.
  if (!abortListenerAttached) {
    abortListenerAttached = true;
    const onAbort = (): void => {
      if (done) return;
      endTurnOnce("error");
      endChatSpanOnce({
        ttfb_ms:
          firstDeltaMs !== undefined ? firstDeltaMs - dispatchStartMs : null,
        total_turn_ms: Date.now() - dispatchStartMs,
        error: true,
      });
      pushError(new Error("openai-driver: aborted"));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  // 7. Return the async iterator.
  const iterator: AsyncIterator<SdkStreamEvent> = {
    next(): Promise<IteratorResult<SdkStreamEvent>> {
      return new Promise<IteratorResult<SdkStreamEvent>>((resolve, reject) => {
        if (done && queue.length === 0) {
          resolve({ value: undefined, done: true });
          return;
        }
        pendingResolve = resolve;
        pendingReject = reject;
        flushNext();
      });
    },
    return(): Promise<IteratorResult<SdkStreamEvent>> {
      done = true;
      return Promise.resolve({ value: undefined, done: true });
    },
  };
  return iterator;
}
