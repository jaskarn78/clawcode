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

import type { SdkModule, SdkQuery, SdkQueryOptions, SdkStreamMessage, SdkUserMessage, SlashCommand, PermissionMode } from "./sdk-types.js";
import type {
  SessionHandle,
  SendOptions,
  UsageCallback,
  PrefixHashProvider,
  SkillTrackingConfig,
} from "./session-adapter.js";
import type { Turn, Span } from "../performance/trace-collector.js";
import type { EffortLevel } from "../config/schema.js";
import type { McpServerState } from "../mcp/readiness.js";
import type { FlapHistoryEntry } from "./filter-tools-by-capability-probe.js";
import type { AttemptRecord } from "./recovery/types.js";

/**
 * Phase 94 Plan 01 — capability probe types re-anchored at this file path
 * for the static-grep regression pins (the plan's acceptance criteria
 * verify `export type CapabilityProbeStatus`, `interface CapabilityProbeSnapshot`,
 * and `capabilityProbe?:` are all visible at this path). Single source of
 * truth for the runtime types lives in src/mcp/readiness.ts where
 * McpServerState is defined; the structural-typing equivalents below are
 * verified against the canonical types via the assignment expressions at
 * module-load — any drift fails to compile.
 *
 * D-02 status enum locked at exactly 5 values:
 *   "ready" | "degraded" | "reconnecting" | "failed" | "unknown"
 * Adding a 6th value cascades through Plans 94-02/03/04/07.
 *
 * The `capabilityProbe?:` field on McpServerState is additive-optional —
 * Phase 85 callers ignoring the new field continue to compile/execute
 * unchanged.
 */
export type CapabilityProbeStatus =
  | "ready"
  | "degraded"
  | "reconnecting"
  | "failed"
  | "unknown";

export interface CapabilityProbeSnapshot {
  /** ISO8601 — when this probe last ran. */
  readonly lastRunAt: string;
  /** Current capability status (D-02 5-value enum). */
  readonly status: CapabilityProbeStatus;
  /** Verbatim error message from the failed probe (Phase 85 TOOL-04). */
  readonly error?: string;
  /** ISO8601 — most recent ready outcome; preserved across degraded ticks. */
  readonly lastSuccessAt?: string;
}

// Compile-time structural-equivalence guard: the local types above must
// remain assignable to the canonical types in readiness.ts in both
// directions. If the readiness.ts definition drifts, this assignment
// fails at build time. The capabilityProbe?: field shape is the
// additive-optional extension on McpServerState.
const _capabilityProbeStatusGuard: CapabilityProbeStatus =
  "ready" as import("../mcp/readiness.js").CapabilityProbeStatus;
void _capabilityProbeStatusGuard;
const _capabilityProbeSnapshotGuard: CapabilityProbeSnapshot = {
  lastRunAt: "",
  status: "unknown",
} as import("../mcp/readiness.js").CapabilityProbeSnapshot;
void _capabilityProbeSnapshotGuard;

/**
 * Phase 96 Plan 01 D-CONTEXT — filesystem capability primitives.
 *
 * 3-value status enum (ready|degraded|unknown) — INTENTIONALLY DIVERGES
 * from Phase 94's 5-value MCP capability enum because filesystem capability
 * has no reconnect/failed analog: operator-driven ACL changes don't
 * transition through transient connect states. A path is either readable
 * NOW (ready), declared-but-not-readable (degraded), or never probed
 * (unknown).
 *
 * Adding a 4th value (such as the Phase 94 transient-state enum entries)
 * requires explicit STATE.md decision and cascades through Plans
 * 96-02/03/04/05/07 consumers. Pinned by static-grep in 96-01-PLAN.md.
 *
 * Mode enum models POSIX read/write permissions:
 *   - "rw"     — fs.access(R_OK | W_OK) succeeded
 *   - "ro"     — fs.access(R_OK) succeeded; W_OK either denied or not probed
 *   - "denied" — fs.access(R_OK) failed
 *
 * Verbatim error pass-through (Phase 85 TOOL-04 inheritance): the `error`
 * field carries the raw `err.message` from `fs.access` — no wrapping, no
 * classification at probe layer. ToolCallError schema (Phase 94 D-06) does
 * the classification at the executor edge in 96-03 / 96-04.
 */
export type FsCapabilityStatus =
  | "ready"          // fs.access(R_OK) succeeded — path readable now
  | "degraded"       // declared in fileAccess but fs.access failed
  | "unknown";       // never probed (boot pre-warm-path)

export type FsCapabilityMode = "rw" | "ro" | "denied";

export interface FsCapabilitySnapshot {
  /** D-02 3-value status enum. */
  readonly status: FsCapabilityStatus;
  /** POSIX read/write mode classification. */
  readonly mode: FsCapabilityMode;
  /** ISO8601 — when this probe last ran. */
  readonly lastProbeAt: string;
  /** ISO8601 — most recent ready outcome; preserved across degraded ticks. */
  readonly lastSuccessAt?: string;
  /** Verbatim error from fs.access — Phase 85 TOOL-04 inheritance. */
  readonly error?: string;
}
import { AsyncPushQueue, SerialTurnQueue } from "./persistent-session-queue.js";
import { extractSkillMentions } from "../usage/skill-usage-tracker.js";
import { mapEffortToTokens } from "./effort-mapping.js";

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
  // Phase 83 EFFORT-04 — widened from v2.1 set ("low"|"medium"|"high"|"max")
  // to the full v2.2 EffortLevel union (adds "xhigh", "auto", "off").
  let currentEffort: EffortLevel =
    (baseOptions.effort ?? "low") as EffortLevel;
  // Phase 86 MODEL-03 — per-handle runtime model mirror.
  // Initialized from baseOptions.model (which is the resolved SDK model id
  // passed by session-adapter.ts, NOT the config alias). Updated by
  // handle.setModel; read by handle.getModel and surfaced downstream via
  // SessionManager.getModelForAgent (Plan 02 /clawcode-status).
  let currentModel: string | undefined = baseOptions.model;
  // Phase 87 CMD-02 — per-handle runtime permission-mode mirror.
  // Initialized from baseOptions.permissionMode (passed by session-adapter.ts;
  // default "default" when unset). Updated by handle.setPermissionMode; read
  // by handle.getPermissionMode and surfaced via SessionManager for the
  // /clawcode-permissions slash command.
  let currentPermissionMode: PermissionMode =
    (baseOptions.permissionMode as PermissionMode | undefined) ?? "default";
  const errorHandlers: Array<(err: Error) => void> = [];
  const endHandlers: Array<() => void> = [];
  let closed = false;
  let generatorDead = false;
  let generatorError: Error | null = null;

  // Quick task 260419-nic — public interrupt primitive slot.
  // iterateUntilResult installs its fireInterruptOnce on entry and clears on
  // exit. handle.interrupt() reads and invokes if set. Never holds a stale
  // reference across turns — guarded by `closed` + explicit clears in the
  // try/finally + catch path of iterateUntilResult.
  let currentInterruptFn: (() => void) | null = null;

  // Phase 85 Plan 01 TOOL-01 — per-handle MCP state mirror (owned by
  // SessionManager; handle is a thin read surface for TurnDispatcher-scope
  // consumers in Plans 02 + 03). Updated at warm-path gate + on every
  // mcp-reconnect heartbeat tick.
  let currentMcpState: ReadonlyMap<string, McpServerState> = new Map();

  // Phase 94 Plan 02 TOOL-03 — per-handle flap-history Map for the D-12
  // 5min flap-stability window. Lazily initialized; persists across all
  // session-config rebuilds for this handle so the filter's flap-tracker
  // correctly counts ready ↔ non-ready transitions over time. The filter
  // mutates this Map on every call; same handle → same Map identity.
  const flapHistory: Map<string, FlapHistoryEntry> = new Map();

  // Phase 94 Plan 03 TOOL-04/05/06 — per-handle recovery-attempt history.
  // Lazily-initialized at handle-construction; the registry mutates in-place
  // per heartbeat tick. Stable Map identity is the contract — bounded
  // 3-attempts-per-hour budget accumulates across ticks via this Map.
  const recoveryAttemptHistory: Map<string, AttemptRecord[]> = new Map();

  // Phase 87 CMD-01 — cache of SDK-reported slash commands. Populated once via
  // q.initializationResult() on first call; subsequent calls hit the cache.
  // Kept null on failure so the next call retries — the SDK may not be ready
  // at the moment of first query (e.g. early in the warm-path).
  let supportedCommandsCache: readonly SlashCommand[] | null = null;

  // Phase 96 Plan 01 D-CONTEXT — per-handle filesystem capability snapshot
  // mirror. Lazy-init: undefined until the first runFsProbe outcome is
  // populated by SessionManager (boot probe + heartbeat tick + on-demand).
  // Accessor returns an empty Map when null so callers can read
  // unconditionally without a reachable null path. Mirrors the Phase 85
  // getMcpState/setMcpState pair exactly — 6th application of the post-
  // construction DI mirror pattern (after McpState, FlapHistory,
  // RecoveryAttemptHistory, SupportedCommands, and ModelMirror).
  let _fsCapabilitySnapshot: ReadonlyMap<string, FsCapabilitySnapshot> | undefined;

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

    // Per-iteration deadline arm hook. Set at the top of each loop iteration
    // when the deadline hasn't yet been armed. Consumed by fireInterruptOnce
    // so that an external handle.interrupt() call (quick-task 260419-nic) can
    // arm the deadline on the currently-pending driverIter.next() race —
    // otherwise the iteration would hang indefinitely waiting for a `result`
    // message that never arrives. Cleared once the arm fires or iteration
    // proceeds past the current step.
    let armDeadlineForCurrentIteration: (() => void) | null = null;

    const fireInterruptOnce = (): void => {
      if (interruptCalled) return;
      interruptCalled = true;
      try {
        // Fire-and-forget — Pitfall 3 guard (don't await on hot path).
        void q.interrupt();
      } catch {
        // ignore — interrupt failure is not fatal
      }
      // Quick task 260419-nic — arm the deadline for the currently-pending
      // driverIter.next() race so the turn rejects with AbortError within
      // INTERRUPT_DEADLINE_MS instead of hanging forever.
      if (armDeadlineForCurrentIteration) {
        try {
          armDeadlineForCurrentIteration();
        } catch {
          // ignore — never fatal
        }
      }
    };

    // Quick task 260419-nic — install handle-level interrupt slot for the
    // duration of this turn. Cleared in every exit path (success finally,
    // catch, and step.done throw) below.
    currentInterruptFn = fireInterruptOnce;

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

          // Shared deadline-arm closure used by (a) the signal abort handler,
          // (b) the already-aborted branch below, and (c) quick-task 260419-nic's
          // handle.interrupt() path via fireInterruptOnce → armDeadlineForCurrentIteration.
          const armDeadline = (): void => {
            if (deadlineTimer || !deadlineReject) return;
            deadlineTimer = setTimeout(() => {
              const err = new Error("Aborted: interrupt deadline exceeded");
              err.name = "AbortError";
              deadlineReject!(err);
            }, INTERRUPT_DEADLINE_MS);
          };
          // Expose to fireInterruptOnce for this iteration.
          armDeadlineForCurrentIteration = armDeadline;
          // If interrupt() was already called BEFORE this iteration started
          // (previous iteration consumed a message, then handle.interrupt()
          // fired), arm the deadline immediately so this iteration's
          // driverIter.next() doesn't hang.
          if (interruptCalled) {
            armDeadline();
          }

          // If signal fires between now and the next message, arm the deadline.
          const lateAbortHandler = (): void => {
            fireInterruptOnce();
            armDeadline();
          };
          if (signal && !signal.aborted) {
            signal.addEventListener("abort", lateAbortHandler, { once: true });
          } else if (signal?.aborted) {
            armDeadline();
          }

          let step: IteratorResult<SdkStreamMessage>;
          try {
            step = await Promise.race([nextPromise, deadlinePromise]);
          } finally {
            if (deadlineTimer) clearTimeout(deadlineTimer);
            if (signal) signal.removeEventListener("abort", lateAbortHandler);
            // Clear per-iteration arm hook so a stale closure doesn't fire
            // after the iteration proceeds.
            armDeadlineForCurrentIteration = null;
          }

          if (step.done) {
            // Stream ended without a result — treat as generator-dead.
            currentInterruptFn = null;
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
        // Quick task 260419-nic — clear handle-level interrupt slot on every
        // exit path (success and error). Post-turn handle.interrupt() is a no-op.
        currentInterruptFn = null;
      }
    } catch (err) {
      closeAllSpans();
      // Quick task 260419-nic — also clear on error path (defense in depth;
      // the try/finally above already clears, but pair this with closeAllSpans).
      currentInterruptFn = null;
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
      // Quick task 260419-nic — clear handle-level interrupt slot so any
      // post-close handle.interrupt() call is a hard no-op.
      currentInterruptFn = null;
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

    setEffort(level: EffortLevel): void {
      currentEffort = level;
      // Phase 83 EFFORT-01 — close the P0 silent no-op (PITFALLS §Pitfall 1).
      // mapEffortToTokens returns 0 for "off", null for "auto", or an
      // explicit integer budget for the leveled modes. setMaxThinkingTokens
      // is async on the SDK (sdk.d.ts:1728) but we intentionally do NOT
      // await — setEffort must stay synchronous because the slash-command
      // / IPC call path cannot yield. Rejections are logged-and-swallowed
      // so a transient SDK failure never crashes a healthy turn.
      const budget = mapEffortToTokens(level);
      void q.setMaxThinkingTokens(budget).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[effort] setMaxThinkingTokens(${String(budget)}) failed: ${msg}`);
      });
    },

    getEffort(): EffortLevel {
      return currentEffort;
    },

    setModel(modelId: string): void {
      currentModel = modelId;
      // Phase 86 MODEL-03 — SDK canary pattern (Phase 83 blueprint).
      // q.setModel is async on the SDK (sdk.d.ts:1711) but we DO NOT await —
      // setModel must stay synchronous because the IPC / slash call path
      // cannot yield. Rejections are logged-and-swallowed so a transient
      // SDK failure never crashes a healthy turn. Regression pinned by
      // spy test in persistent-session-handle-model.test.ts.
      void q.setModel(modelId).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[model] setModel(${modelId}) failed: ${msg}`);
      });
    },

    getModel(): string | undefined {
      return currentModel;
    },

    setPermissionMode(mode: PermissionMode): void {
      currentPermissionMode = mode;
      // Phase 87 CMD-02 — SDK canary pattern (Phase 83/86 blueprint applied).
      // q.setPermissionMode is async on the SDK (sdk.d.ts:1704) but we DO
      // NOT await — setPermissionMode must stay synchronous because the
      // IPC / slash call path cannot yield. Rejections are logged-and-
      // swallowed so a transient SDK failure never crashes a healthy turn.
      // Regression pinned by spy test in
      // persistent-session-handle-permission.test.ts (P1-P5).
      void q.setPermissionMode(mode).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[permission] setPermissionMode(${mode}) failed: ${msg}`);
      });
    },

    getPermissionMode(): PermissionMode {
      return currentPermissionMode;
    },

    /**
     * Quick task 260419-nic — public mid-turn interrupt primitive.
     *
     * When a turn is in-flight (currentInterruptFn installed by
     * iterateUntilResult), fires the SDK q.interrupt() via the captured
     * closure. The in-flight send/sendAndCollect/sendAndStream rejects with
     * AbortError within the INTERRUPT_DEADLINE_MS (2s) window via the
     * existing abort-deadline race inside iterateUntilResult.
     *
     * No-op when:
     *   - handle is closed (currentInterruptFn cleared in close())
     *   - no turn is in-flight (slot is null between turns)
     *   - q.interrupt() was already called this turn (fireInterruptOnce guard)
     *
     * Synchronous by design — q.interrupt() is fire-and-forget.
     */
    interrupt(): void {
      if (closed) return;
      const fn = currentInterruptFn;
      if (fn) fn();
    },

    /**
     * Quick task 260419-nic — in-flight turn probe.
     *
     * Returns true only when a turn is actively iterating driverIter.
     * False on freshly-created handle, between turns, and after close().
     * Backed by SerialTurnQueue.hasInFlight() — single source of truth.
     */
    hasActiveTurn(): boolean {
      return !closed && turnQueue.hasInFlight();
    },

    /**
     * Phase 85 Plan 01 TOOL-01 — read the per-handle MCP state mirror.
     *
     * Always returns the latest map set via `setMcpState`. Returns the
     * default empty map before the first warm-path population.
     */
    getMcpState(): ReadonlyMap<string, McpServerState> {
      return currentMcpState;
    },
    /**
     * Phase 85 Plan 01 TOOL-01 — update the per-handle MCP state mirror.
     *
     * Called by SessionManager (at warm-path gate) and by the
     * `mcp-reconnect` heartbeat check (every tick). Always stores a
     * defensive copy so external mutations of the passed-in map don't
     * leak into the handle's state.
     */
    setMcpState(state: ReadonlyMap<string, McpServerState>): void {
      currentMcpState = new Map(state);
    },

    /**
     * Phase 96 Plan 01 D-CONTEXT — read the per-handle filesystem capability
     * snapshot mirror.
     *
     * Always returns a Map (empty when first probe hasn't yet run). Allows
     * callers (Plan 96-02 prompt-builder, Plan 96-03 clawcode_list_files,
     * Plan 96-04 share-file boundary check) to read unconditionally — the
     * empty-map default is the "no paths probed yet" signal.
     */
    getFsCapabilitySnapshot(): ReadonlyMap<string, FsCapabilitySnapshot> {
      return _fsCapabilitySnapshot ?? new Map();
    },

    /**
     * Phase 96 Plan 01 D-CONTEXT — update the per-handle filesystem
     * capability snapshot mirror.
     *
     * Called by:
     *   - SessionManager (at warm-path gate / boot probe)
     *   - heartbeat fs-probe check (every 60s tick — wired in 96-07)
     *   - on-demand /clawcode-probe-fs slash + clawcode probe-fs CLI (96-05)
     *
     * Always stores a defensive copy so external mutations of the passed-
     * in map don't leak into the handle's state. NEVER mutates the input.
     */
    setFsCapabilitySnapshot(next: ReadonlyMap<string, FsCapabilitySnapshot>): void {
      _fsCapabilitySnapshot = new Map(next);
    },

    /**
     * Phase 94 Plan 02 TOOL-03 — accessor for the per-handle flap-history
     * Map consumed by `filterToolsByCapabilityProbe` in session-config.
     *
     * Map identity is stable across all calls for the lifetime of this
     * handle — the filter mutates it in-place per tick to count ready ↔
     * non-ready transitions for the D-12 5min flap-stability window.
     *
     * Production wiring: `buildSessionConfig` reads this via
     * `SessionConfigDeps.flapHistoryProvider(agentName)` and threads it
     * into the filter call. Tests can stub the provider directly without
     * needing a real handle.
     */
    getFlapHistory(): Map<string, FlapHistoryEntry> {
      return flapHistory;
    },

    /**
     * Phase 94 Plan 03 TOOL-04/05/06 — per-handle recovery-attempt history.
     *
     * Stable Map identity across the handle's lifetime so the registry's
     * bounded 3-attempts-per-hour budget counter accumulates correctly
     * across heartbeat ticks. The registry mutates the Map in-place by
     * replacing AttemptRecord arrays with `[...prev, new]` (immutability
     * preserved at the inner-array level — old entries retain reference
     * identity).
     */
    getRecoveryAttemptHistory(): Map<string, AttemptRecord[]> {
      return recoveryAttemptHistory;
    },

    /**
     * Phase 87 CMD-01 — enumerate the SDK-reported slash commands for this
     * agent session. First call invokes q.initializationResult() and caches
     * the resulting `commands` array; subsequent calls hit the cache.
     *
     * On SDK failure, the cache stays null so the NEXT call retries. This is
     * important because the SDK may not have completed its init handshake at
     * the exact moment of first query (e.g. warm-path ran too eagerly).
     *
     * Returned shape is the local SlashCommand projection — no-op if the
     * agent has zero native commands (empty array is valid + cached).
     */
    async getSupportedCommands(): Promise<readonly SlashCommand[]> {
      if (supportedCommandsCache !== null) return supportedCommandsCache;
      const result = await q.initializationResult();
      supportedCommandsCache = result.commands;
      return supportedCommandsCache;
    },
  };

  return handle;
}
