/**
 * Heartbeat check that triggers tier maintenance for agent memory.
 *
 * Auto-discovered by HeartbeatRunner from the checks directory.
 * Runs every 6 hours to promote/demote/archive memories between tiers.
 *
 * Uses a simple per-agent lock (Set) to prevent concurrent runs.
 */

import type { CheckModule, CheckResult } from "../types.js";

/** Simple per-agent lock to prevent concurrent tier maintenance runs. */
const runningAgents = new Set<string>();

const tierMaintenanceCheck: CheckModule = {
  name: "tier-maintenance",
  interval: 21600, // 6 hours in seconds
  timeout: 30, // 30 seconds — no LLM calls, just DB operations

  async execute(context): Promise<CheckResult> {
    const { agentName, sessionManager } = context;

    // Concurrency lock
    if (runningAgents.has(agentName)) {
      return {
        status: "healthy",
        message: "Tier maintenance already running, skipping",
        metadata: { skipped: true },
      };
    }

    const tierManager = sessionManager.getTierManager(agentName);
    if (!tierManager) {
      return {
        status: "healthy",
        message: "No tier manager configured",
      };
    }

    runningAgents.add(agentName);
    try {
      const result = tierManager.runMaintenance();

      const total = result.demoted + result.archived + result.promoted;
      if (total === 0) {
        return {
          status: "healthy",
          message: "No tier changes needed",
          metadata: { ...result },
        };
      }

      return {
        status: "healthy",
        message: `Tier maintenance: ${result.promoted} promoted, ${result.demoted} demoted, ${result.archived} archived`,
        metadata: { ...result },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        status: "warning",
        message: `Tier maintenance failed: ${message}`,
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

export default tierMaintenanceCheck;
