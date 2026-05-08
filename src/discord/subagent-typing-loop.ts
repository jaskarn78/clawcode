import type { Logger } from "pino";
// 2026-05-08 hotfix — typing rate-limit tracker; honors retry-after on 429
// so subagent loops stop spamming sendTyping when Discord puts the bot in
// cooldown. Without this, the 8s setInterval keeps refilling the bucket.
import {
  shouldFireTyping,
  markRateLimited,
  isRateLimitError,
} from "./typing-rate-limit-tracker.js";

/**
 * Phase 999.36 sub-bug A (D-04, D-05) — typing-indicator emit loop for
 * subagent thread dispatch. Mirrors bridge.ts:357-377 (fireTypingIndicator)
 * + bridge.ts:606-611 (8-second re-typing heartbeat) reference patterns.
 *
 * Cadence: 8s. Discord typing extends ~10s per call; 2s margin keeps the
 * indicator solid under clock drift (D-05).
 *
 * Failure mode: observational. sendTyping rejections (archived threads,
 * rate limits, missing permissions) are caught + log.debug'd, never thrown.
 * Surfaces without sendTyping (test mocks) produce a no-op handle.
 *
 * 2026-05-08 hotfix — when sendTyping returns 429, the channel goes into a
 * retry-after cooldown via the typing-rate-limit-tracker. Subsequent fires
 * skip until the cooldown expires. Prevents the loop from continuing to
 * spam every 8s while Discord is rejecting the calls.
 *
 * Caller MUST call `returnedHandle.stop()` in a finally block — leaving the
 * setInterval running on a dead thread leaks a timer for the daemon's life.
 */

/** D-05 cadence regression pin. Exported for tests. */
export const TYPING_REFRESH_MS = 8000;

export type TypingLoopHandle = {
  readonly stop: () => void;
};

type ThreadLikeWithTyping = {
  /** 2026-05-08 hotfix — used as the rate-limit tracker key. */
  id?: string;
  sendTyping?: () => Promise<unknown>;
};

export function startTypingLoop(
  thread: ThreadLikeWithTyping,
  log: Logger,
): TypingLoopHandle {
  const canType =
    "sendTyping" in thread && typeof thread.sendTyping === "function";
  // 2026-05-08 hotfix — fall back to a stable per-loop key when the thread
  // surface doesn't expose `id` (e.g. test mocks). Real Discord ThreadChannel
  // surfaces always have `id`.
  const channelKey = thread.id ?? `subagent-typing-loop-${Math.random()}`;

  const fire = (): void => {
    if (!canType) return;
    // 2026-05-08 hotfix — skip fire if the thread channel is in 429 cooldown.
    if (!shouldFireTyping(channelKey)) return;
    try {
      const promise = thread.sendTyping?.();
      if (promise && typeof (promise as Promise<unknown>).catch === "function") {
        void (promise as Promise<unknown>).catch((err: unknown) => {
          // 2026-05-08 hotfix — record cooldown on 429 so the 8s setInterval
          // skips subsequent fires until the bucket reopens.
          if (isRateLimitError(err)) {
            markRateLimited(channelKey, err, log);
          }
          log.debug(
            { error: (err as Error).message ?? String(err) },
            "subagent typing indicator sendTyping failed — observational, non-fatal",
          );
        });
      }
    } catch (err) {
      log.debug(
        { error: (err as Error).message ?? String(err) },
        "subagent typing indicator setup failed — observational, non-fatal",
      );
    }
  };

  // Eager fire at t=0 mirrors bridge.ts:362 fireTypingIndicator pattern.
  fire();

  // Re-fire every 8s. Caller's finally invokes stop() to clear.
  const handle = setInterval(fire, TYPING_REFRESH_MS);

  return {
    stop: (): void => {
      clearInterval(handle);
    },
  };
}
