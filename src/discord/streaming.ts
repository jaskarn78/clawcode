/**
 * Progressive message editor utility for Discord streaming responses.
 *
 * Throttles message edits to stay within Discord's rate limits (5 edits per 5 seconds).
 * The first update is sent immediately for fast user feedback, subsequent updates
 * are throttled to editIntervalMs (default 750ms — see Phase 54 CONTEXT D-05 for the
 * tightened cadence; per-agent overrides flow through `perf.streaming.editIntervalMs`
 * with a 300ms floor enforced at Zod).
 *
 * Phase 54 additions:
 *   - first_visible_token span emission on the FIRST editFn invocation (only when
 *     a Turn is passed through the constructor).
 *   - Rate-limit backoff: when editFn rejects with a Discord rate-limit error
 *     (code 20028, HTTP 429, or discord.js RateLimitError), the editor's
 *     editIntervalMs DOUBLES for the remainder of the current turn. A single
 *     pino.WARN fires per editor instance so log volume stays bounded regardless
 *     of how many 429s hit. The editor is reconstructed per Turn so backoff
 *     naturally resets on the next Discord message.
 */

import type { Turn } from "../performance/trace-collector.js";
import type { Logger } from "pino";

export type StreamChunkCallback = (accumulated: string) => void;

export type ProgressiveEditorOptions = {
  readonly editFn: (content: string) => Promise<void>;
  readonly editIntervalMs?: number;  // Default 750ms (Phase 54 — tightened cadence)
  readonly maxLength?: number;       // Default 2000 (Discord limit)
  /**
   * Phase 54: Turn to emit first_visible_token span on the first editFn call.
   * When undefined, no span is emitted (the editor works without trace plumbing).
   */
  readonly turn?: Turn;
  /**
   * Phase 54: logger for the single pino.WARN emitted on the first rate-limit
   * detection per editor instance. When undefined, no warn is emitted.
   */
  readonly log?: Logger;
  /** Agent name included in the rate-limit WARN payload (for operator triage). */
  readonly agent?: string;
  /** Turn id included in the rate-limit WARN payload (for operator triage). */
  readonly turnId?: string;
};

/**
 * Phase 54 — detect Discord rate-limit errors from any editFn rejection.
 * Centralizes the 3 shapes documented in discord.js:
 *   - DiscordAPIError code 20028 (interaction rate-limit)
 *   - HTTP status 429 (response rate-limit)
 *   - RateLimitError instances (discord.js class — we check .name since the
 *     constructor is not imported into this module to avoid a hard dep)
 *
 * Returns `false` for non-object / null / undefined inputs so callers can pass
 * any `unknown` error value without pre-filtering.
 */
export function isDiscordRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; status?: unknown; name?: unknown };
  if (typeof e.code === "number" && e.code === 20028) return true;
  if (typeof e.status === "number" && e.status === 429) return true;
  if (typeof e.name === "string" && e.name === "RateLimitError") return true;
  return false;
}

const DEFAULT_EDIT_INTERVAL_MS = 750;
const DEFAULT_MAX_LENGTH = 2000;

/**
 * Throttled progressive message editor.
 *
 * Accepts accumulated text via update(), throttles calls to editFn to avoid
 * Discord rate limits. The first update is forwarded immediately.
 */
export class ProgressiveMessageEditor {
  private readonly editFn: (content: string) => Promise<void>;
  /**
   * Phase 54: mutable — doubles on rate-limit error for the rest of the turn.
   * The editor is reconstructed per Turn so the doubled value naturally resets.
   */
  private editIntervalMs: number;
  private readonly maxLength: number;
  private pendingText: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hasSentFirst = false;
  private disposed = false;
  // Phase 54 state
  private readonly turn: Turn | undefined;
  private readonly log: Logger | undefined;
  private readonly agent: string | undefined;
  private readonly turnId: string | undefined;
  private firstVisibleTokenEmitted = false;
  private rateLimitWarnEmitted = false;

  constructor(options: ProgressiveEditorOptions) {
    this.editFn = options.editFn;
    this.editIntervalMs = options.editIntervalMs ?? DEFAULT_EDIT_INTERVAL_MS;
    this.maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
    this.turn = options.turn;
    this.log = options.log;
    this.agent = options.agent;
    this.turnId = options.turnId;
  }

  /**
   * Called whenever new accumulated text arrives.
   * First call is forwarded immediately; subsequent calls are throttled.
   */
  update(accumulated: string): void {
    if (this.disposed) return;

    this.pendingText = accumulated;

    if (!this.hasSentFirst) {
      // First chunk: send immediately
      this.hasSentFirst = true;
      // Phase 54: emit first_visible_token span on the FIRST editFn
      // invocation. Span ends synchronously — its duration captures only the
      // scheduling cost from editor construction to first visible edit. The
      // emit is wrapped in try/catch so trace-setup races never propagate.
      if (!this.firstVisibleTokenEmitted) {
        this.firstVisibleTokenEmitted = true;
        try {
          const span = this.turn?.startSpan("first_visible_token", {});
          try {
            span?.end();
          } catch {
            /* non-fatal */
          }
        } catch {
          /* non-fatal */
        }
      }
      const text = this.truncate(accumulated);
      void this.editFn(text).catch((err) => this.handleEditError(err));
      return;
    }

    // Subsequent chunks: schedule a throttled edit if none pending
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.pendingText !== null && !this.disposed) {
          const text = this.truncate(this.pendingText);
          this.pendingText = null;
          void this.editFn(text).catch((err) => this.handleEditError(err));
        }
      }, this.editIntervalMs);
    }
  }

  /**
   * Phase 54 — handle editFn rejections. On a Discord rate-limit error,
   * DOUBLE the editIntervalMs for the rest of this editor's lifetime (one
   * turn). Emit a single pino.WARN on the FIRST hit so downstream log volume
   * stays bounded. Non-rate-limit rejections are silently swallowed to
   * preserve the pre-plan non-fatal edit behavior.
   */
  private handleEditError(err: unknown): void {
    if (!isDiscordRateLimitError(err)) {
      // Non-rate-limit: silent swallow (matches pre-plan non-fatal behavior).
      return;
    }
    const prev = this.editIntervalMs;
    this.editIntervalMs = prev * 2;
    if (!this.rateLimitWarnEmitted) {
      this.rateLimitWarnEmitted = true;
      this.log?.warn(
        {
          agent: this.agent,
          turnId: this.turnId,
          original_ms: prev,
          backoff_ms: this.editIntervalMs,
          error:
            err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : String(err),
        },
        "Discord rate-limit detected — doubling editIntervalMs for rest of turn",
      );
    }
  }

  /**
   * Send the final accumulated text immediately, cancelling any pending timer.
   */
  async flush(): Promise<void> {
    if (this.disposed) return;

    // Cancel pending timer
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pendingText !== null) {
      const text = this.truncate(this.pendingText);
      this.pendingText = null;
      await this.editFn(text);
    }
  }

  /**
   * Cancel any pending timer without sending. Use in error paths.
   */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingText = null;
  }

  /**
   * Truncate text to maxLength, appending "..." if over limit.
   */
  private truncate(text: string): string {
    if (text.length <= this.maxLength) {
      return text;
    }
    return text.slice(0, this.maxLength - 3) + "...";
  }
}
