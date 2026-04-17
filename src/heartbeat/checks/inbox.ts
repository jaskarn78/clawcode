import { join } from "node:path";
import type { CheckModule, CheckResult } from "../types.js";
import { readMessages, markProcessed } from "../../collaboration/inbox.js";

/**
 * Reconciler staleness threshold in milliseconds.
 * When InboxSource is active (primary path), the heartbeat inbox check
 * only processes messages older than this threshold. Set to 2x the
 * default heartbeat interval (60s) = 120s. Messages newer than this
 * are left for InboxSource's chokidar watcher to handle.
 */
const RECONCILER_STALE_THRESHOLD_MS = 120_000;

/**
 * Module-level flag toggled by daemon.ts when InboxSource is registered.
 * When true, this check operates in reconciler/fallback mode — only
 * processing stale messages that InboxSource likely missed.
 */
let inboxSourceActive = false;

/**
 * Mark InboxSource as active, demoting this heartbeat check to
 * reconciler/fallback mode. Called from daemon.ts after InboxSource
 * registration (Phase 61 TRIG-04).
 */
export function setInboxSourceActive(active: boolean): void {
  inboxSourceActive = active;
}

/**
 * Inbox heartbeat check for async message delivery.
 *
 * When InboxSource is NOT active (legacy mode): discovers ALL unprocessed
 * messages and delivers them — full primary delivery path.
 *
 * When InboxSource IS active (reconciler mode): only processes messages
 * older than RECONCILER_STALE_THRESHOLD_MS (120s). Recent messages are
 * left for InboxSource's chokidar watcher. This prevents the race
 * condition where both InboxSource and heartbeat try to process the same
 * file simultaneously (Research Pitfall 7).
 */
const inboxCheck: CheckModule = {
  name: "inbox",

  async execute(context): Promise<CheckResult> {
    const { agentName, sessionManager } = context;

    // 1. Get agent config from sessionManager to find workspace path
    const agentConfig = sessionManager.getAgentConfig(agentName);
    if (!agentConfig) {
      return { status: "healthy", message: "No config available" };
    }

    // 2. Build inbox path: {workspace}/inbox/
    const inboxDir = join(agentConfig.workspace, "inbox");

    // 3. Read all unprocessed messages via readMessages()
    const allMessages = await readMessages(inboxDir);

    // 4. In reconciler mode, filter to stale messages only
    const now = Date.now();
    const messages = inboxSourceActive
      ? allMessages.filter(msg => (now - msg.timestamp) >= RECONCILER_STALE_THRESHOLD_MS)
      : allMessages;

    const skippedByReconciler = allMessages.length - messages.length;

    // 5. If no messages to process, return healthy
    if (messages.length === 0) {
      const mode = inboxSourceActive ? "reconciler" : "primary";
      return {
        status: "healthy",
        message: inboxSourceActive
          ? `Reconciler mode: no stale messages (${skippedByReconciler} recent, left for InboxSource)`
          : "No pending messages",
        metadata: { pending: 0, mode, skippedByReconciler },
      };
    }

    // 6. For each message, deliver to agent via sendToAgent (per D-07)
    //    Format: "[Message from {from}]: {content}"
    //    After successful delivery, markProcessed (per D-08)
    let delivered = 0;
    let failed = 0;
    for (const msg of messages) {
      try {
        const formatted = `[Message from ${msg.from}]: ${msg.content}`;
        await sessionManager.sendToAgent(agentName, formatted);
        await markProcessed(inboxDir, msg.id);
        delivered++;
      } catch {
        failed++;
        // Delivery failed -- don't mark processed so it retries next heartbeat cycle
      }
    }

    // 7. Return status based on delivery results
    const mode = inboxSourceActive ? "reconciler" : "primary";
    if (failed > 0) {
      return {
        status: "warning",
        message: inboxSourceActive
          ? `Reconciler: delivered ${delivered}/${messages.length} stale messages (${failed} failed, ${skippedByReconciler} recent skipped)`
          : `Delivered ${delivered}/${messages.length} messages (${failed} failed)`,
        metadata: { delivered, failed, pending: messages.length, mode, skippedByReconciler },
      };
    }

    return {
      status: "healthy",
      message: inboxSourceActive
        ? `Reconciler: delivered ${delivered} stale message(s) (${skippedByReconciler} recent skipped)`
        : `Delivered ${delivered} message(s)`,
      metadata: { delivered, pending: 0, mode, skippedByReconciler },
    };
  },
};

export default inboxCheck;
