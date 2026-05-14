/**
 * Phase 124 Plan 01 T-02 — `compact-session` IPC handler (pure-DI).
 *
 * Mirrors `daemon-ask-agent-ipc.ts` shape: pure dependency injection so the
 * v2 sync-reply contract can be exercised without spawning the full daemon.
 *
 * Behavior contract (per Plan 124-01 + CONTEXT D-12 hybrid flow):
 *   1. Reject when daemon-not-ready → {ok:false, error:"DAEMON_NOT_READY"}.
 *   2. Reject when agent has no live session handle →
 *      {ok:false, error:"AGENT_NOT_RUNNING"}.
 *   3. Reject when the agent has no CompactionManager wired (memory init
 *      skipped) → {ok:false, error:"AGENT_NOT_INITIALIZED"} (Rule 3 addition;
 *      mirrors the throw at session-manager.ts:2210).
 *   4. Reject when a turn has been in-flight longer than `maxTurnAgeMs`
 *      (default 10 min) → {ok:false, error:"ERR_TURN_TOO_LONG"}.
 *   5. On success: run `compactForAgent` (extracts memories into memory.db
 *      — D-04 revised, growth by design), call SDK `forkSession` to produce
 *      a fork JSONL on disk, return the new fork id plus tokens proxy.
 *
 * Phase 124 Plan 05 — live hot-swap now ships. After `sdkForkSession`
 * returns, the handler invokes `handle.swap(forkSessionId)` so the live
 * SessionHandle rebinds to the fork session id IN-PROCESS — operator no
 * longer needs to `clawcode restart <agent>` to pick up the compaction.
 * Backward compat: handles without `swap` (legacy wrapSdkQuery test
 * fixtures) and swap rejections both fall through with `swapped_live:false`
 * so the primitive is still useful for the memory.db + fork artifact half
 * of the pain; operator-manual restart remains the documented fallback.
 *
 * Wire result shape (success path):
 *   {
 *     ok: true,
 *     tokens_before: number | null,   // null when fill-provider missing
 *     tokens_after: number | null,    // null when fill-provider missing
 *     summary_written: boolean,
 *     forked_to: string,              // SDK fork session uuid
 *     memories_created: number,
 *     swapped_live: boolean,          // true => live worker rebound in-process
 *     swap_reason?: string,           // present when swapped_live:false
 *   }
 */
import type {
  ConversationTurn,
  ContextFillProvider,
} from "../memory/compaction.js";
import type { CompactionResult } from "../memory/compaction.js";

/** Minimal pino-like logger surface — matches daemon-ask-agent-ipc.ts. */
export type CompactLogger = Readonly<{
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}>;

/**
 * Minimal session-handle surface read by the handler.
 *
 * Phase 124 Plan 05 — `swap` is additive-optional. When the live handle
 * exposes it (production createPersistentSessionHandle path), the handler
 * invokes it after `sdkForkSession` returns and surfaces `swapped_live:true`
 * on success. When the handle does NOT expose it (legacy wrapSdkQuery test
 * fixtures), the handler falls back to today's behavior — fork artifact +
 * memory.db growth on disk, no live worker rebinding — and surfaces
 * `swapped_live:false`. The compaction flow as a whole NEVER fails because
 * of a swap rejection — the operator-manual `clawcode restart` path stays
 * available as the documented fallback.
 */
export type CompactSessionHandleLike = Readonly<{
  readonly sessionId: string;
  hasActiveTurn: () => boolean;
  swap?: (newSessionId: string) => Promise<void>;
}>;

/**
 * Minimal SessionManager surface — pure DI. The production daemon passes the
 * real SessionManager; tests construct a minimal fixture.
 */
export type CompactManagerLike = Readonly<{
  /** Live session handle lookup. Undefined → AGENT_NOT_RUNNING. */
  getSessionHandle: (name: string) => CompactSessionHandleLike | undefined;
  /** Conversation turns for compactForAgent input. */
  getConversationTurns: (name: string) => readonly ConversationTurn[];
  /** Returns the per-agent CharacterCountFillProvider (or undefined). */
  getContextFillProvider: (name: string) => ContextFillProvider | undefined;
  /** Canonical compactForAgent entry point (session-manager.ts:2203). */
  compactForAgent: (
    name: string,
    conversation: readonly ConversationTurn[],
    extractMemories: (text: string) => Promise<readonly string[]>,
  ) => Promise<CompactionResult>;
  /** True when the agent has a CompactionManager registered. */
  hasCompactionManager: (name: string) => boolean;
}>;

/** SDK forkSession call surface — narrowed for testability. */
export type SdkForkSessionFn = (
  sessionId: string,
  options?: { upToMessageId?: string },
) => Promise<{ sessionId: string }>;

/** Memory extractor — MVP. Phase 125 replaces with tiered extraction. */
export type ExtractMemoriesFn = (text: string) => Promise<readonly string[]>;

/** Per-agent archive slot for the old session id (audit retention). */
export type ArchiveSessionFn = (
  agent: string,
  oldSessionId: string,
  newSessionId: string,
) => void;

/** DI surface — production daemon constructs full deps at the case body. */
export type CompactSessionDeps = Readonly<{
  manager: CompactManagerLike;
  sdkForkSession: SdkForkSessionFn;
  extractMemories: ExtractMemoriesFn;
  log: CompactLogger;
  /** Archive the swapped-out session id (no-op when undefined). */
  archiveSession?: ArchiveSessionFn;
  /** When false, fail fast with DAEMON_NOT_READY (boot-window guard). */
  daemonReady: boolean;
  /**
   * Mid-turn safety budget — when a turn has been in-flight longer than this,
   * exit ERR_TURN_TOO_LONG rather than block on the SerialTurnQueue. Default
   * 10 min per CONTEXT D-03. Tests inject a fixture clock + small budget.
   */
  maxTurnAgeMs?: number;
  /** Injectable clock — production uses Date.now. */
  now?: () => number;
  /** Per-agent active-turn-start timestamps (ms epoch). */
  turnStartedAt?: ReadonlyMap<string, number>;
  /**
   * Optional pre-computed last-message UUID for the SDK `upToMessageId` arg.
   * When undefined, fork copies the full session (acceptable for Wave 1 —
   * future plan threads in the real cut-point UUID).
   */
  upToMessageId?: string;
}>;

/** Wire param shape. */
export type CompactSessionParams = Readonly<{ agent: string }>;

/** Error result shape — matches Phase 117 / Phase 999.2 error contract. */
export type CompactSessionError = Readonly<{
  ok: false;
  error:
    | "DAEMON_NOT_READY"
    | "AGENT_NOT_RUNNING"
    | "AGENT_NOT_INITIALIZED"
    | "ERR_TURN_TOO_LONG"
    | "UNKNOWN";
  message?: string;
}>;

/** Success result shape. */
export type CompactSessionSuccess = Readonly<{
  ok: true;
  tokens_before: number | null;
  tokens_after: number | null;
  summary_written: boolean;
  forked_to: string;
  memories_created: number;
  /**
   * Phase 124 Plan 05 — true when the live SessionHandle was rebound to
   * the fork session id IN-PROCESS (no operator `clawcode restart` needed).
   * False when:
   *   - The handle does not expose `swap` (legacy wrapSdkQuery / test
   *     fixture); the fork artifact is on disk but the live worker still
   *     writes to the original JSONL.
   *   - `swap` threw on the rebuild path; the old epoch survived intact
   *     and the operator can re-run with `clawcode restart` to swap
   *     manually.
   * Backward-compat: callers parsing the old payload shape get `undefined`
   * via JSON-decode and treat that as "no swap" — same as `false`.
   */
  swapped_live: boolean;
  /**
   * Phase 124 Plan 05 — reason swap was skipped or failed. `undefined`
   * when swapped_live is true. Otherwise carries one of:
   *   - "handle_lacks_swap"  — additive-optional method missing.
   *   - "swap_threw:<msg>"   — SDK rebuild rejected.
   */
  swap_reason?: string;
}>;

export type CompactSessionResult = CompactSessionSuccess | CompactSessionError;

const DEFAULT_MAX_TURN_AGE_MS = 10 * 60 * 1000;
/**
 * Rough char→token proxy for the IPC `tokens_before/after` fields. The
 * CharacterCountFillProvider tracks raw characters; the SDK does not expose
 * a token-accurate primitive at this seam. ~4 chars/token is the industry
 * proxy used elsewhere (matches Phase 103 telemetry estimate).
 */
const CHARS_PER_TOKEN = 4;

/**
 * Best-effort token estimate from the per-agent CharacterCountFillProvider.
 * Returns null when no provider is wired (e.g., minimal test fixtures).
 */
function estimateTokens(provider: ContextFillProvider | undefined): number | null {
  if (!provider) return null;
  // CharacterCountFillProvider's getContextFillPercentage is ratio×max, but
  // we want absolute. Cast to the concrete shape we expect (the type guard
  // is informational — production wires CharacterCountFillProvider).
  // The provider exposes only a ratio; reconstruct via max=200_000 default.
  // See compaction.ts:195. Wire-shape: ratio × 200_000 / 4 chars-per-token.
  const ratio = provider.getContextFillPercentage();
  return Math.round((ratio * 200_000) / CHARS_PER_TOKEN);
}

/**
 * Handle a `compact-session` IPC request. See module docstring for the full
 * behavior contract. Errors return as `{ok: false, error}` — caller renders
 * them as recognizable exit codes (see src/cli/commands/session-compact.ts).
 */
export async function handleCompactSession(
  params: CompactSessionParams,
  deps: CompactSessionDeps,
): Promise<CompactSessionResult> {
  const { agent } = params;

  if (!deps.daemonReady) {
    return { ok: false, error: "DAEMON_NOT_READY" };
  }

  const handle = deps.manager.getSessionHandle(agent);
  if (!handle) {
    return { ok: false, error: "AGENT_NOT_RUNNING" };
  }

  if (!deps.manager.hasCompactionManager(agent)) {
    return { ok: false, error: "AGENT_NOT_INITIALIZED" };
  }

  // Mid-turn safety budget — D-03. The SerialTurnQueue handles enqueueing
  // for us when we eventually pass through send/sendAndCollect, but the
  // budget check fires BEFORE we attempt to compact so an in-flight slow
  // turn doesn't block the IPC reply for >10 min.
  if (handle.hasActiveTurn()) {
    const now = (deps.now ?? Date.now)();
    const startedAt = deps.turnStartedAt?.get(agent);
    const maxAge = deps.maxTurnAgeMs ?? DEFAULT_MAX_TURN_AGE_MS;
    if (startedAt !== undefined && now - startedAt > maxAge) {
      return {
        ok: false,
        error: "ERR_TURN_TOO_LONG",
        message: `Turn has been in-flight for ${Math.round((now - startedAt) / 1000)}s (budget ${Math.round(maxAge / 1000)}s).`,
      };
    }
    // Within budget — queue behind the in-flight turn. compactForAgent does
    // NOT itself contend on the SerialTurnQueue (it's a memory-side flush),
    // so we can proceed immediately. The forkSession step reads JSONL from
    // disk, also non-contending. Live-handle hot-swap (deferred Path B)
    // would require turnQueue.run; not exercised here.
    deps.log.info(
      { agent, turnAgeMs: startedAt ? now - startedAt : null },
      "[compact-session] proceeding mid-turn (within budget)",
    );
  }

  const provider = deps.manager.getContextFillProvider(agent);
  const tokens_before = estimateTokens(provider);

  let compactionResult: CompactionResult;
  try {
    const conversation = deps.manager.getConversationTurns(agent);
    compactionResult = await deps.manager.compactForAgent(
      agent,
      conversation,
      deps.extractMemories,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log.error({ agent, err: msg }, "[compact-session] compactForAgent failed");
    return { ok: false, error: "UNKNOWN", message: msg };
  }

  let forkResult: { sessionId: string };
  try {
    forkResult = await deps.sdkForkSession(handle.sessionId, {
      ...(deps.upToMessageId !== undefined
        ? { upToMessageId: deps.upToMessageId }
        : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log.error({ agent, err: msg }, "[compact-session] sdk.forkSession failed");
    return { ok: false, error: "UNKNOWN", message: msg };
  }

  // Phase 124 Plan 05 — live hot-swap. Rebind the live SessionHandle to the
  // fork session id so the next dispatch writes to the fork JSONL on disk
  // (no operator `clawcode restart` needed). Backward compat: when the
  // handle lacks `swap` or when swap rejects, fall through with
  // swapped_live:false; the fork artifact + memory.db growth are already
  // durable, and the operator-manual restart path remains as documented.
  let swapped_live = false;
  let swap_reason: string | undefined;
  const oldSessionId = handle.sessionId;
  if (typeof handle.swap === "function") {
    try {
      await handle.swap(forkResult.sessionId);
      swapped_live = true;
      deps.log.info(
        {
          agent,
          oldSessionId,
          newSessionId: forkResult.sessionId,
        },
        "[compact-session] live hot-swap committed",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      swap_reason = `swap_threw:${msg}`;
      deps.log.warn(
        { agent, err: msg, oldSessionId, newSessionId: forkResult.sessionId },
        "[compact-session] live hot-swap rejected; old epoch intact",
      );
    }
  } else {
    swap_reason = "handle_lacks_swap";
    deps.log.info(
      { agent },
      "[compact-session] handle does not expose swap; skipping live rebind",
    );
  }

  if (deps.archiveSession) {
    try {
      deps.archiveSession(agent, oldSessionId, forkResult.sessionId);
    } catch (err) {
      // Best-effort archive — never aborts the compaction.
      const errMsg = err instanceof Error ? err.message : String(err);
      deps.log.warn(
        { agent, err: errMsg },
        "[compact-session] archive callback failed (non-fatal)",
      );
    }
  }

  const tokens_after = estimateTokens(provider);

  deps.log.info(
    {
      agent,
      tokens_before,
      tokens_after,
      memoriesCreated: compactionResult.memoriesCreated,
      forkedTo: forkResult.sessionId,
      swapped_live,
    },
    "[compact-session] complete",
  );

  return {
    ok: true,
    tokens_before,
    tokens_after,
    summary_written: compactionResult.summary.length > 0,
    forked_to: forkResult.sessionId,
    memories_created: compactionResult.memoriesCreated,
    swapped_live,
    ...(swap_reason !== undefined ? { swap_reason } : {}),
  };
}
