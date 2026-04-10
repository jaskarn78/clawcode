/**
 * Heartbeat check that discovers semantically similar unlinked memories
 * and creates bidirectional edges between them.
 *
 * Auto-discovered by HeartbeatRunner from the checks directory.
 * Runs every 6 hours (21600s) with a 1-minute timeout.
 *
 * Uses a simple per-agent lock (Set) to prevent concurrent runs.
 */

import type { CheckModule, CheckResult } from "../types.js";
import { discoverAutoLinks } from "../../memory/similarity.js";

/** Simple per-agent lock to prevent concurrent auto-linker runs. */
const runningAgents = new Set<string>();

const autoLinkerCheck: CheckModule = {
  name: "auto-linker",
  interval: 21600, // 6 hours
  timeout: 60, // 1 minute

  async execute(context): Promise<CheckResult> {
    const { agentName, sessionManager } = context;

    if (runningAgents.has(agentName)) {
      return {
        status: "healthy",
        message: "Auto-linker already running, skipping",
        metadata: { skipped: true },
      };
    }

    const memoryStore = sessionManager.getMemoryStore(agentName);
    if (!memoryStore) {
      return {
        status: "warning",
        message: `Memory store not found for ${agentName}`,
      };
    }

    runningAgents.add(agentName);
    try {
      const result = discoverAutoLinks(memoryStore);
      return {
        status: "healthy",
        message: `Auto-linker: created ${result.linksCreated} links, scanned ${result.pairsScanned} pairs, skipped ${result.skippedExisting} existing`,
        metadata: { ...result },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        status: "warning",
        message: `Auto-linker failed: ${message}`,
      };
    } finally {
      runningAgents.delete(agentName);
    }
  },
};

/**
 * Reset the concurrency lock. Exported for test cleanup only.
 * @internal
 */
export function _resetLock(): void {
  runningAgents.clear();
}

export default autoLinkerCheck;
