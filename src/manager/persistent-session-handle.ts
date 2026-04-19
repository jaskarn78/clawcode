/**
 * Phase 73 Plan 01 — Persistent per-agent SDK session handle.
 *
 * ONE sdk.query({ prompt: asyncIterable, options: {...} }) per agent lifetime.
 * Turns are fed via an AsyncPushQueue<SDKUserMessage>; outputs stream out of
 * the single generator. The SerialTurnQueue guarantees depth-1 semantics.
 *
 * Replaces wrapSdkQuery's per-turn sdk.query() pattern from session-adapter.ts.
 * See 73-RESEARCH.md Pattern 1 for the SDK contract + Pitfalls 1/2/3.
 *
 * Invariants (enforced by tests in __tests__/persistent-session-handle.test.ts):
 *   - Exactly ONE sdk.query() call per handle, regardless of turn count.
 *   - The driverIter (Query[Symbol.asyncIterator]) is captured ONCE and consumed
 *     across all turns; each per-turn `iterateUntilResult` breaks out when its
 *     `result` message arrives, leaving the next turn's messages for the next
 *     invocation.
 *   - Abort mid-turn races `q.interrupt()` with a 2s deadline. First to fire
 *     ends the turn handler with an AbortError and releases the queue slot.
 *   - onError fires when the generator throws; any in-flight turn rejects with
 *     the same error; `generatorDead` flag prevents further sends.
 *   - SessionHandle public surface is byte-identical to session-adapter's
 *     SessionHandle type.
 */

import type { SdkModule, SdkQuery, SdkQueryOptions, SdkStreamMessage, SdkUserMessage } from "./sdk-types.js";
import type {
  SessionHandle,
  SendOptions,
  UsageCallback,
  PrefixHashProvider,
  SkillTrackingConfig,
} from "./session-adapter.js";
import type { Turn, Span } from "../performance/trace-collector.js";
import { AsyncPushQueue, SerialTurnQueue } from "./persistent-session-queue.js";
import { extractSkillMentions } from "../usage/skill-usage-tracker.js";

/** Deadline (ms) the abort path waits after calling q.interrupt() before
 *  throwing AbortError. Pitfall 3 guard — SDK may not emit `result` on abort. */
const INTERRUPT_DEADLINE_MS = 2000;

/**
 * Build a SessionHandle backed by one long-lived sdk.query({ prompt: asyncIterable }).
 *
 * @param sdk SDK module (wrapper around @anthropic-ai/claude-agent-sdk)
 * @param baseOptions Options carried per-agent (model, cwd, systemPrompt, etc.)
 *                    + optional adapter-only `mutableSuffix` for per-turn prompt
 *                    prepending (stripped before forwarding to sdk.query).
 * @param initialSessionId The session id established at handle creation. Becomes
 *                         the `resume` argument on the single sdk.query call so
 *                         the SDK picks up the existing JSONL state.
 * @param usageCallback Optional per-turn usage telemetry hook.
 * @param prefixHashProvider Optional per-turn prefix-hash recorder (CACHE-04).
 * @param skillTracking Optional per-turn skill-mention tracker.
 */
export function createPersistentSessionHandle(
  sdk: SdkModule,
  baseOptions: SdkQueryOptions & { readonly mutableSuffix?: string },
  initialSessionId: string,
  usageCallback?: UsageCallback,
  prefixHashProvider?: PrefixHashProvider,
  skillTracking?: SkillTrackingConfig,
): SessionHandle {
  const inputQueue = new AsyncPushQueue<SdkUserMessage>();
  const turnQueue = new SerialTurnQueue();

  // Strip adapter-only fields; enable streaming input mode via AsyncIterable
  // prompt + includePartialMessages for token-level streaming.
  const { mutableSuffix, ...sdkOptions } = baseOptions;
  const q: SdkQuery = sdk.query({
    // AsyncPushQueue<SdkUserMessage> is an AsyncIterable<SdkUserMessage>.
    // The real SDK type is AsyncIterable<SDKUserMessage> with a richer shape;
    // SdkUserMessage is our narrower local projection — the SDK accepts any
    // iterable of user messages, and the extra fields we push (message,
    // parent_tool_use_id) are ignored by the SdkUserMessage cast.
    prompt: inputQueue as unknown as AsyncIterable<SdkUserMessage>,
    options: {
      ...sdkOptions,
      resume: initialSessionId,
      // Token-level streaming — adapter's stream_event branch consumes these.
      // Cast: local SdkQueryOptions is narrower than the real SDK Options
      // (missing includePartialMessages); see sdk-types.ts deferred-items.
      includePartialMessages: true,
    } as SdkQueryOptions,
  });

  // Capture ONE iterator for the whole handle lifetime (Pattern 1 invariant).
  const driverIter = (q as unknown as AsyncIterable<SdkStreamMessage>)[Symbol.asyncIterator]();

  let sessionId = initialSessionId;
  let currentEffort: "low" | "medium" | "high" | "max" =
    (baseOptions.effort ?? "low") as "low" | "medium" | "high" | "max";
  const errorHandlers: Array<(err: Error) => void> = [];
  const endHandlers: Array<() => void> = [];
  let closed = false;
  let generatorDead = false;
  let generatorError: Error | null = null;

  function notifyError(err: Error): void {
    generatorDead = true;
    generatorError = err;
    for (const h of errorHandlers) {
      try {
        h(err);
      } catch {
        // swallow to avoid cascading failures
      }
    }
  }

  function promptWithMutable(message: string): string {
    return mutableSuffix && mutableSuffix.length > 0
      ? `${mutableSuffix}\n\n${message}`
      : message;
  }

  /**
   * Build an SDKUserMessage for streaming input mode. The real SDK shape is
   * `{ type, message: { role, content }, parent_tool_use_id }`; our local
   * `SdkUserMessage` type is narrower. We build the richer shape and cast —
   * the SDK accepts the extra fields.
   */
  function buildUserMessage(content: string): SdkUserMessage {
    return {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      // `content` mirrors the narrow local SdkUserMessage field for back-compat
      // with any consumer reading SdkUserMessage.content directly.
      content,
    } as unknown as SdkUserMessage;
  }

  /** Safely invoke the UsageCallback with a result message. */
  function extractUsage(msg: SdkStreamMessage): void {
    if (!usageCallback) return;
    if (msg.type !== "result") return;
    try {
      const result = msg as {
        total_cost_usd?: number;
        usage?: { input_tokens?: number; output_tokens?: number };
        num_turns?: number;
        duration_ms?: number;
        model?: string;
      };
      usageCallback({
        tokens_in: typeof result.usage?.input_tokens === "number" ? result.usage.input_tokens : 0,
        tokens_out: typeof result.usage?.output_tokens === "number" ? result.usage.output_tokens : 0,
        cost_usd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : 0,
        turns: typeof result.num_turns === "number" ? result.num_turns : 0,
        model: typeof result.model === "string" ? result.model : "",
        duration_ms: typeof result.duration_ms === "number" ? result.duration_ms : 0,
      });
    } catch {
      // observational path — never break the message flow
    }
  }

  /**
   * Drive the shared driverIter until the turn-terminating `result` message
   * arrives, handling tracing, streaming chunks, cache telemetry, and skill
   * tracking. Breaks out of iteration on `result` so the NEXT turn's messages
   * remain on the iterator for the next call (Pattern 1 "iteration boundary").
   */
  async function iterateUntilResult(
    onChunk: ((accumulated: string) => void) | null,
    turn: Turn | undefined,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const endToEnd = turn?.startSpan("end_to_end", {});
    const firstToken = turn?.startSpan("first_token", {});
    let firstTokenEnded = false;
    const activeTools = new Map<
      string,
      {
        readonly span: Span;
        readonly hitCountAtOpen: number;
        readonly openedAtMs: number;
      }
    >();
    const textParts: string[] = [];
    const blockTextParts: string[] = [];
    let streamedText = "";
    let interruptCalled = false;

    const closeAllSpans = (): void => {
      for (const entry of activeTools.values()) entry.span.end();
      activeTools.clear();
      if (!firstTokenEnded) {
        firstToken?.end();
        firstTokenEnded = true;
      }
      endToEnd?.end();
    };

    const fireInterruptOnce = (): void => {
      if (interruptCalled) return;
      interruptCalled = true;
      try {
        // Fire-and-forget — Pitfall 3 guard (don't await on hot path).
        void q.interrupt();
      } catch {
        // ignore — interrupt failure is not fatal
      }
    };

    // If already aborted on entry, fire interrupt immediately and race deadline.
    if (signal?.aborted) {
      fireInterruptOnce();
    }

    try {
      // Pre-register abort listener so a late abort during iteration also races.
      const abortHandler = (): void => {
        fireInterruptOnce();
      };
      if (signal && !signal.aborted) {
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      try {
        for (;;) {
          // Each iteration races driverIter.next() against:
          //   - abort deadline (2s from interrupt() call)
          // so aborted turns don't hang waiting for a `result` that may never arrive.
          const nextPromise = driverIter.next();
          let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
          let deadlineReject: ((err: Error) => void) | null = null;
          const deadlinePromise = new Promise<never>((_resolve, reject) => {
            if (interruptCalled) {
              deadlineTimer = setTimeout(() => {
                const err = new Error("Aborted: interrupt deadline exceeded");
                err.name = "AbortError";
                reject(err);
              }, INTERRUPT_DEADLINE_MS);
            } else {
              // Track the reject so a later abort can arm the deadline.
              deadlineReject = reject;
            }
          });

          // If signal fires between now and the next message, arm the deadline.
          const lateAbortHandler = (): void => {
            fireInterruptOnce();
            if (!deadlineTimer && deadlineReject) {
              deadlineTimer = setTimeout(() => {
                const err = new Error("Aborted: interrupt deadline exceeded");
                err.name = "AbortError";
                deadlineReject!(err);
              }, INTERRUPT_DEADLINE_MS);
            }
          };
          if (signal && !signal.aborted) {
            signal.addEventListener("abort", lateAbortHandler, { once: true });
          } else if (signal?.aborted && !deadlineTimer) {
            deadlineTimer = setTimeout(() => {
              const err = new Error("Aborted: interrupt deadline exceeded");
              err.name = "AbortError";
              if (deadlineReject) deadlineReject(err);
            }, INTERRUPT_DEADLINE_MS);
          }

          let step: IteratorResult<SdkStreamMessage>;
          try {
            step = await Promise.race([nextPromise, deadlinePromise]);
          } finally {
            if (deadlineTimer) clearTimeout(deadlineTimer);
            if (signal) signal.removeEventListener("abort", lateAbortHandler);
          }

          if (step.done) {
            // Stream ended without a result — treat as generator-dead.
            throw new Error("generator-dead");
          }
          const msg = step.value;

          // -- assistant message: drive first_token + tool_call span opens --
          if (msg.type === "assistant") {
            const parentToolUseId =
              (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null;
            if (parentToolUseId === null) {
              const contentBlocks = ((msg as { message?: { content?: unknown[] } }).message?.content ?? []) as unknown[];
              const toolUseCount = contentBlocks.filter(
                (b) => (b as { type?: string }).type === "tool_use",
              ).length;
              const isParallelBatch = toolUseCount > 1;

              for (const raw of contentBlocks) {
                const block = raw as { type?: string; name?: string; id?: string; text?: string };
                if (block.type === "text" && !firstTokenEnded) {
                  firstToken?.end();
                  firstTokenEnded = true;
                }
                if (block.type === "text" && typeof block.text === "string") {
                  blockTextParts.push(block.text);
                }
                if (block.type === "tool_use" && block.id && block.name) {
                  const span = turn?.startSpan(`tool_call.${block.name}`, {
                    tool_use_id: block.id,
                    tool_name: block.name,
                    is_parallel: isParallelBatch,
                    cached: false,
                  });
                  if (span) {
                    const hitCountAtOpen =
                      (turn as { toolCache?: { hitCount: () => number } } | undefined)
                        ?.toolCache?.hitCount() ?? 0;
                    activeTools.set(block.id, {
                      span,
                      hitCountAtOpen,
                      openedAtMs: Date.now(),
                    });
                  }
                }
              }
            }
            if (typeof (msg as { content?: string }).content === "string" && (msg as { content: string }).content.length > 0) {
              textParts.push((msg as { content: string }).content);
            }
          }

          // -- token-level streaming via SDKPartialAssistantMessage --
          if ((msg as { type?: string }).type === "stream_event" && onChunk !== null) {
            const parentToolUseId =
              (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null;
            if (parentToolUseId === null) {
              const event = (msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
              if (
                event?.type === "content_block_delta" &&
                event.delta?.type === "text_delta" &&
                typeof event.delta.text === "string" &&
                event.delta.text.length > 0
              ) {
                if (!firstTokenEnded) {
                  firstToken?.end();
                  firstTokenEnded = true;
                }
                streamedText += event.delta.text;
                onChunk(streamedText);
              }
            }
          }

          // -- tool_use_result closes matching tool_call span --
          if (msg.type === ("user" as SdkStreamMessage["type"])) {
            const toolUseId = (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id;
            if (toolUseId) {
              const entry = activeTools.get(toolUseId);
              if (entry) {
                try {
                  const hitCountNow =
                    (turn as { toolCache?: { hitCount: () => number } } | undefined)
                      ?.toolCache?.hitCount() ?? entry.hitCountAtOpen;
                  if (hitCountNow > entry.hitCountAtOpen) {
                    entry.span.setMetadata({
                      cached: true,
                      cache_hit_duration_ms: Date.now() - entry.openedAtMs,
                    });
                  }
                } catch {
                  // observational — never break message path
                }
                entry.span.end();
                activeTools.delete(toolUseId);
              }
            }
          }

          // -- result message: terminates THIS turn; capture telemetry --
          if (msg.type === "result") {
            const resMsg = msg as {
              session_id?: string;
              result?: string;
              subtype?: string;
              is_error?: boolean;
              usage?: {
                input_tokens?: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
              };
            };
            if (resMsg.session_id) sessionId = resMsg.session_id;
            extractUsage(msg);

            // Cache telemetry (Phase 52 Plan 01 + Plan 02 CACHE-04).
            if (turn) {
              try {
                const u = resMsg.usage ?? {};
                const cacheRead = typeof u.cache_read_input_tokens === "number" ? u.cache_read_input_tokens : 0;
                const cacheCreation = typeof u.cache_creation_input_tokens === "number" ? u.cache_creation_input_tokens : 0;
                const input = typeof u.input_tokens === "number" ? u.input_tokens : 0;

                let prefixHash: string | undefined;
                let cacheEvictionExpected: boolean | undefined;
                try {
                  if (prefixHashProvider) {
                    const probe = prefixHashProvider.get();
                    if (probe && typeof probe.current === "string" && probe.current.length > 0) {
                      prefixHash = probe.current;
                      cacheEvictionExpected =
                        probe.last === undefined ? false : probe.current !== probe.last;
                    }
                  }
                } catch {
                  // provider threw — continue with token counts only
                }

                turn.recordCacheUsage({
                  cacheReadInputTokens: cacheRead,
                  cacheCreationInputTokens: cacheCreation,
                  inputTokens: input,
                  prefixHash,
                  cacheEvictionExpected,
                });

                try {
                  if (prefixHash !== undefined) {
                    prefixHashProvider?.persist(prefixHash);
                  }
                } catch {
                  // persistence failure — observational path, never break message
                }
              } catch {
                // never break the send flow due to cache-capture failure
              }
            }

            // Skill-mention capture (Phase 53 Plan 03).
            try {
              if (skillTracking) {
                const assistantText = [...textParts, ...blockTextParts].join("\n");
                const mentioned = extractSkillMentions(
                  assistantText,
                  skillTracking.skillCatalogNames,
                );
                skillTracking.skillUsageTracker.recordTurn(skillTracking.agentName, {
                  mentionedSkills: mentioned,
                });
              }
            } catch {
              // observational — never break message path
            }

            closeAllSpans();

            if (typeof resMsg.result === "string" && resMsg.result.length > 0) {
              return resMsg.result;
            }
            if (resMsg.subtype !== "success" && resMsg.is_error) {
              throw new Error(`Agent error: ${resMsg.subtype}`);
            }
            return streamedText.length > 0 ? streamedText : textParts.join("\n");
          }
        }
      } finally {
        if (signal) signal.removeEventListener("abort", abortHandler);
      }
    } catch (err) {
      closeAllSpans();
      // If abort path caused the error, propagate as AbortError; otherwise
      // this is a generator-dead scenario — notify error handlers.
      if (
        (err instanceof Error && err.name === "AbortError") ||
        signal?.aborted
      ) {
        const abortErr = err instanceof Error ? err : new Error(String(err));
        abortErr.name = "AbortError";
        throw abortErr;
      }
      const e = err instanceof Error ? err : new Error(String(err));
      notifyError(e);
      throw e;
    }
  }

  const handle: SessionHandle = {
    get sessionId(): string {
      return sessionId;
    },

    async send(message: string, turn?: Turn, options?: SendOptions): Promise<void> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      if (generatorDead) {
        throw generatorError ?? new Error(`Session ${sessionId} closed: generator-dead`);
      }
      await turnQueue.run(async () => {
        inputQueue.push(buildUserMessage(promptWithMutable(message)));
        await iterateUntilResult(null, turn, options?.signal);
      });
    },

    async sendAndCollect(message: string, turn?: Turn, options?: SendOptions): Promise<string> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      if (generatorDead) {
        throw generatorError ?? new Error(`Session ${sessionId} closed: generator-dead`);
      }
      return turnQueue.run(async () => {
        inputQueue.push(buildUserMessage(promptWithMutable(message)));
        return iterateUntilResult(null, turn, options?.signal);
      });
    },

    async sendAndStream(
      message: string,
      onChunk: (accumulated: string) => void,
      turn?: Turn,
      options?: SendOptions,
    ): Promise<string> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      if (generatorDead) {
        throw generatorError ?? new Error(`Session ${sessionId} closed: generator-dead`);
      }
      return turnQueue.run(async () => {
        inputQueue.push(buildUserMessage(promptWithMutable(message)));
        return iterateUntilResult(onChunk, turn, options?.signal);
      });
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      inputQueue.end();
      try {
        q.close();
      } catch {
        // ignore — close may already be in-flight
      }
      for (const h of endHandlers) {
        try {
          h();
        } catch {
          // swallow
        }
      }
    },

    onError(handler: (err: Error) => void): void {
      errorHandlers.push(handler);
    },

    onEnd(handler: () => void): void {
      endHandlers.push(handler);
    },

    setEffort(level: "low" | "medium" | "high" | "max"): void {
      currentEffort = level;
      // Future: q.setMaxThinkingTokens() wiring — out of scope per 73-RESEARCH §"Don't hand-roll".
    },

    getEffort(): "low" | "medium" | "high" | "max" {
      return currentEffort;
    },
  };

  return handle;
}
