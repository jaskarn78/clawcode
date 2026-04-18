/**
 * Capture helper -- ties instruction detection to conversation turn recording.
 *
 * Consumed by bridge.ts to capture each Discord exchange as a pair of turns
 * (user + assistant) in the conversation store. Runs instruction-pattern
 * detection on user content BEFORE storage, persisting the result as
 * instructionFlags on the user turn.
 *
 * This function is fire-and-forget: it NEVER throws. Any error from the
 * conversation store is caught and logged as a non-fatal warning.
 */

import type { ConversationStore } from "../memory/conversation-store.js";
import type { Logger } from "pino";
import { detectInstructionPatterns } from "../security/instruction-detector.js";

/** Input for capturing a single Discord message exchange (user + assistant). */
export type CaptureInput = {
  readonly convStore: ConversationStore;
  readonly sessionId: string;
  readonly userContent: string;
  readonly assistantContent: string;
  readonly channelId: string;
  readonly discordUserId: string;
  readonly discordMessageId: string;
  readonly log: Logger;
};

/**
 * Capture a Discord exchange as two conversation turns.
 *
 * 1. Runs instruction-pattern detection on user content
 * 2. If detected, logs a warning with risk level and channel
 * 3. Records user turn (with instructionFlags if detected)
 * 4. Records assistant turn (no instructionFlags -- only user content is scanned)
 *
 * Never throws -- any error is caught and logged as non-fatal.
 */
export function captureDiscordExchange(input: CaptureInput): void {
  try {
    // Run detection BEFORE any storage
    const detection = detectInstructionPatterns(input.userContent);

    if (detection.detected) {
      input.log.warn(
        {
          risk: detection.riskLevel,
          patterns: detection.patterns,
          channel: input.channelId,
        },
        "instruction pattern detected in user message",
      );
    }

    const instructionFlags = detection.detected
      ? JSON.stringify(detection)
      : undefined;

    // Record user turn
    input.convStore.recordTurn({
      sessionId: input.sessionId,
      role: "user",
      content: input.userContent,
      channelId: input.channelId,
      discordUserId: input.discordUserId,
      discordMessageId: input.discordMessageId,
      instructionFlags,
    });

    // Record assistant turn (no user-specific fields, no instructionFlags)
    input.convStore.recordTurn({
      sessionId: input.sessionId,
      role: "assistant",
      content: input.assistantContent,
      channelId: input.channelId,
    });
  } catch (err) {
    input.log.warn(
      {
        agent: "capture",
        error: (err as Error).message,
      },
      "conversation capture failed (non-fatal)",
    );
  }
}
