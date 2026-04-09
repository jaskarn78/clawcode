import type { CheckModule, CheckResult } from "../types.js";
import { classifyZone, DEFAULT_ZONE_THRESHOLDS } from "../context-zones.js";

/**
 * Built-in context fill percentage check.
 *
 * Reports healthy/warning/critical based on the agent's context fill
 * classified into 4 zones (green/yellow/orange/red).
 * Uses CharacterCountFillProvider from the SessionManager for live fill state.
 *
 * Zone-to-status mapping:
 * - green -> healthy
 * - yellow -> warning
 * - orange -> warning
 * - red -> critical (includes compaction recommendation)
 */
const contextFillCheck: CheckModule = {
  name: "context-fill",

  async execute(context): Promise<CheckResult> {
    const { agentName, sessionManager, config } = context;

    const provider = sessionManager.getContextFillProvider(agentName);
    if (!provider) {
      return {
        status: "healthy",
        message: "No memory system configured",
      };
    }

    const fillPercentage = provider.getContextFillPercentage();
    const pct = Math.round(fillPercentage * 100);
    const thresholds = config.contextFill.zoneThresholds ?? DEFAULT_ZONE_THRESHOLDS;
    const zone = classifyZone(fillPercentage, thresholds);

    if (zone === "red") {
      return {
        status: "critical",
        message: `Context fill: ${pct}% [${zone}] -- recommend compaction`,
        metadata: { fillPercentage, zone },
      };
    }

    if (zone === "orange" || zone === "yellow") {
      return {
        status: "warning",
        message: `Context fill: ${pct}% [${zone}]`,
        metadata: { fillPercentage, zone },
      };
    }

    return {
      status: "healthy",
      message: `Context fill: ${pct}% [${zone}]`,
      metadata: { fillPercentage, zone },
    };
  },
};

export default contextFillCheck;
