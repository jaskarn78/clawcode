/**
 * Heartbeat check that triggers the memory consolidation pipeline.
 *
 * Auto-discovered by HeartbeatRunner from the checks directory.
 * Runs on a daily interval (86400s) with a 2-minute timeout to
 * accommodate LLM summarization calls via sendToAgent.
 *
 * Uses a simple per-agent lock (Set) to prevent concurrent
 * consolidation runs within a single process.
 */

import type { CheckModule, CheckResult } from "../types.js";
import { runConsolidation } from "../../memory/consolidation.js";
import { join } from "node:path";

/** Simple per-agent lock to prevent concurrent consolidation runs. */
const runningAgents = new Set<string>();

const consolidationCheck: CheckModule = {
  name: "consolidation",
  interval: 86400, // 24 hours in seconds (daily per D-01)
  timeout: 120, // 2 minutes -- LLM summarization needs more time than default 10s

  async execute(context): Promise<CheckResult> {
    const { agentName, sessionManager } = context;

    // Concurrency lock -- return immediately if already running for this agent
    if (runningAgents.has(agentName)) {
      return {
        status: "healthy",
        message: "Consolidation already running, skipping",
        metadata: { skipped: true },
      };
    }

    // Get required resources via SessionManager accessors (Plan 01)
    const memoryStore = sessionManager.getMemoryStore(agentName);
    const agentConfig = sessionManager.getAgentConfig(agentName);
    if (!memoryStore || !agentConfig) {
      return {
        status: "warning",
        message: "No memory system configured for consolidation",
      };
    }

    const embedder = sessionManager.getEmbedder();
    const memoryDir = join(agentConfig.workspace, "memory");

    // Get consolidation config from agent's memory config
    const consolidationConfig = agentConfig.memory.consolidation ?? {
      enabled: true,
      weeklyThreshold: 7,
      monthlyThreshold: 4,
    };

    if (!consolidationConfig.enabled) {
      return {
        status: "healthy",
        message: "Consolidation disabled",
        metadata: { enabled: false },
      };
    }

    // Build deps with sendToAgent as the summarization function (per D-05, D-13)
    const deps = {
      memoryDir,
      memoryStore,
      embedder,
      summarize: (prompt: string) => sessionManager.sendToAgent(agentName, prompt),
    };

    runningAgents.add(agentName);
    try {
      const result = await runConsolidation(deps, consolidationConfig);

      const total = result.weeklyDigestsCreated + result.monthlyDigestsCreated;
      if (total === 0 && result.errors.length === 0) {
        return {
          status: "healthy",
          message: "No consolidation needed",
          metadata: { ...result },
        };
      }

      if (result.errors.length > 0) {
        return {
          status: "warning",
          message: `Consolidation partial: ${result.weeklyDigestsCreated} weekly, ${result.monthlyDigestsCreated} monthly, ${result.errors.length} errors`,
          metadata: { ...result },
        };
      }

      return {
        status: "healthy",
        message: `Consolidated: ${result.weeklyDigestsCreated} weekly, ${result.monthlyDigestsCreated} monthly, ${result.filesArchived} archived`,
        metadata: { ...result },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        status: "warning",
        message: `Consolidation failed: ${message}`,
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

export default consolidationCheck;
