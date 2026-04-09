import { join } from "node:path";
import type { CheckModule, CheckResult } from "../types.js";
import { readMessages, markProcessed } from "../../collaboration/inbox.js";

/**
 * Inbox heartbeat check for async message delivery.
 *
 * On each heartbeat cycle, discovers unprocessed messages in the agent's
 * inbox directory and delivers them via sendToAgent. Successfully delivered
 * messages are moved to inbox/processed/. Failed deliveries remain for
 * retry on the next heartbeat cycle.
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
    const messages = await readMessages(inboxDir);

    // 4. If no messages, return healthy with count 0
    if (messages.length === 0) {
      return {
        status: "healthy",
        message: "No pending messages",
        metadata: { pending: 0 },
      };
    }

    // 5. For each message, deliver to agent via sendToAgent (per D-07)
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
        // Don't mark processed on failure -- retry next heartbeat
      }
    }

    // 6. Return status based on delivery results
    if (failed > 0) {
      return {
        status: "warning",
        message: `Delivered ${delivered}/${messages.length} messages (${failed} failed)`,
        metadata: { delivered, failed, pending: messages.length },
      };
    }

    return {
      status: "healthy",
      message: `Delivered ${delivered} message(s)`,
      metadata: { delivered, pending: 0 },
    };
  },
};

export default inboxCheck;
