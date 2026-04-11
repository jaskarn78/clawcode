/**
 * Progressive message editor utility for Discord streaming responses.
 *
 * Throttles message edits to stay within Discord's rate limits (5 edits per 5 seconds).
 * The first update is sent immediately for fast user feedback, subsequent updates
 * are throttled to editIntervalMs (default 1500ms).
 */

export type StreamChunkCallback = (accumulated: string) => void;

export type ProgressiveEditorOptions = {
  readonly editFn: (content: string) => Promise<void>;
  readonly editIntervalMs?: number;  // Default 1500ms (safe under 5 edits/5s limit)
  readonly maxLength?: number;       // Default 2000 (Discord limit)
};

const DEFAULT_EDIT_INTERVAL_MS = 800;
const DEFAULT_MAX_LENGTH = 2000;

/**
 * Throttled progressive message editor.
 *
 * Accepts accumulated text via update(), throttles calls to editFn to avoid
 * Discord rate limits. The first update is forwarded immediately.
 */
export class ProgressiveMessageEditor {
  private readonly editFn: (content: string) => Promise<void>;
  private readonly editIntervalMs: number;
  private readonly maxLength: number;
  private pendingText: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hasSentFirst = false;
  private disposed = false;

  constructor(options: ProgressiveEditorOptions) {
    this.editFn = options.editFn;
    this.editIntervalMs = options.editIntervalMs ?? DEFAULT_EDIT_INTERVAL_MS;
    this.maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
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
      const text = this.truncate(accumulated);
      void this.editFn(text).catch(() => {
        // Edit failure is non-fatal
      });
      return;
    }

    // Subsequent chunks: schedule a throttled edit if none pending
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.pendingText !== null && !this.disposed) {
          const text = this.truncate(this.pendingText);
          this.pendingText = null;
          void this.editFn(text).catch(() => {
            // Edit failure is non-fatal
          });
        }
      }, this.editIntervalMs);
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
