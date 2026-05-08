/**
 * 2026-05-08 hotfix — per-channel typing rate-limit tracker.
 *
 * Discord rate-limits the typing endpoint at ~5 calls per shared bucket.
 * Bot's 8s typing heartbeats across multiple channels + subagent threads can
 * exhaust this bucket and stay in 429 for extended periods because:
 *   1. Each fire that returns 429 still consumes a token
 *   2. Cloudflare flags sustained over-firing into a stricter bucket
 *   3. Without backoff, the bot keeps firing every 8s and never recovers
 *
 * This tracker keeps a per-channel cooldown timestamp. Call sites do:
 *   if (shouldFireTyping(channelId)) {
 *     try { await channel.sendTyping(); }
 *     catch (err) { markRateLimited(channelId, err); }
 *   }
 *
 * The cooldown clears after `retry-after` seconds (parsed from the 429 response
 * via discord.js's RateLimitError), with a 5s buffer to avoid immediately
 * re-firing the moment the bucket reopens.
 *
 * Storage: in-memory Map. Resets on daemon restart (which is fine — the bot's
 * Discord-side rate-limit bucket also clears with quiet-time after restart).
 *
 * Out of scope (defer to a later refactor):
 *   - Global typing scheduler that knows the 5-token bucket centrally.
 *     Current per-channel approach lets multiple channels still over-fire
 *     globally; we trade off perfect prevention for minimal change.
 *   - Increasing typing intervals to reduce baseline fire rate.
 *     8s stays; if Cloudflare keeps the bot in stricter bucket post-hotfix,
 *     bump intervals in the proper refactor.
 */

import type { Logger } from "pino";

/**
 * Map of channelId → cooldown-until epoch ms. Module-scoped singleton; survives
 * across DiscordBridge / SubagentTypingLoop instantiations. The same channel
 * may appear in both surfaces (bridge fires on parent, subagent loop fires on
 * thread); per-channelId keying handles both.
 */
const cooldownUntil = new Map<string, number>();

/** Buffer added to retry-after to avoid immediately re-firing on bucket reopen. */
const COOLDOWN_BUFFER_MS = 5000;

/** Default cooldown when 429 has no retry-after header (defensive fallback). */
const DEFAULT_COOLDOWN_MS = 30_000;

/**
 * Check whether the given channel is currently in a rate-limit cooldown.
 * Call BEFORE invoking `channel.sendTyping()` to skip fires during 429.
 *
 * @returns true if it's safe to fire typing on this channel; false if cooling
 *          down (caller skips the fire silently).
 */
export function shouldFireTyping(channelId: string): boolean {
  const until = cooldownUntil.get(channelId);
  if (until === undefined) return true;
  if (Date.now() >= until) {
    // Cooldown expired — clear the entry to keep the map bounded.
    cooldownUntil.delete(channelId);
    return true;
  }
  return false;
}

/**
 * Record a rate-limit hit for the given channel. Inspect the error for a
 * retry-after value (discord.js RateLimitError exposes `.retryAfter` in ms;
 * raw fetch errors may have `.retry_after` in seconds; fall back to the
 * default if neither is present).
 */
export function markRateLimited(
  channelId: string,
  err: unknown,
  log?: Logger,
): void {
  const retryAfterMs = extractRetryAfterMs(err);
  const cooldownMs = retryAfterMs + COOLDOWN_BUFFER_MS;
  const until = Date.now() + cooldownMs;
  cooldownUntil.set(channelId, until);
  log?.warn(
    {
      channelId,
      cooldownMs,
      retryAfterMs,
      activeCooldowns: cooldownUntil.size,
    },
    "typing rate-limited — channel cooling down",
  );
}

/**
 * Detect whether an error is a Discord rate-limit (429) error.
 * Centralizes the 3 shapes documented in discord.js + raw fetch:
 *   - DiscordAPIError code 429
 *   - HTTP status 429
 *   - discord.js RateLimitError instance
 */
export function isRateLimitError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  const e = err as { code?: number | string; status?: number; httpStatus?: number; name?: string; constructor?: { name?: string } };
  if (e.code === 429 || e.code === "429") return true;
  if (e.status === 429 || e.httpStatus === 429) return true;
  if (e.name === "RateLimitError") return true;
  if (e.constructor?.name === "RateLimitError") return true;
  // discord.js v14 sometimes embeds the rate-limit signal in the message
  const msg = String((err as Error).message ?? err).toLowerCase();
  if (msg.includes("rate limit") || msg.includes("429")) return true;
  return false;
}

/**
 * Extract retry-after milliseconds from a rate-limit error. Returns
 * DEFAULT_COOLDOWN_MS if no retry-after value is found.
 */
function extractRetryAfterMs(err: unknown): number {
  if (err === null || err === undefined) return DEFAULT_COOLDOWN_MS;
  const e = err as { retryAfter?: number; retry_after?: number; retryAfterMs?: number };
  // discord.js RateLimitError uses retryAfter (already in ms in v14)
  if (typeof e.retryAfter === "number" && e.retryAfter > 0) {
    // Heuristic: if value is < 1000 it's probably seconds (older formats);
    // if >= 1000 it's already ms.
    return e.retryAfter < 1000 ? e.retryAfter * 1000 : e.retryAfter;
  }
  if (typeof e.retryAfterMs === "number" && e.retryAfterMs > 0) {
    return e.retryAfterMs;
  }
  // Raw HTTP retry_after is in seconds.
  if (typeof e.retry_after === "number" && e.retry_after > 0) {
    return e.retry_after * 1000;
  }
  return DEFAULT_COOLDOWN_MS;
}

/**
 * Test-only: clear all cooldowns. Production code MUST NOT call this — the
 * tracker is module-scoped and cooldowns are correctness-critical.
 */
export function _resetForTests(): void {
  cooldownUntil.clear();
}

/**
 * Test-only: introspect current cooldown count. Production code MUST NOT
 * depend on this for routing decisions — use `shouldFireTyping` instead.
 */
export function _getCooldownCountForTests(): number {
  return cooldownUntil.size;
}
