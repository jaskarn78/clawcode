import type { CheckModule, CheckResult } from "../types.js";

/**
 * Built-in context fill percentage check.
 *
 * Reports healthy/warning/critical based on the agent's context fill
 * relative to configured thresholds. Uses CharacterCountFillProvider
 * from the SessionManager for live fill state.
 *
 * Critical results include a recommendation to compact (but never auto-trigger).
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
    const { warningThreshold, criticalThreshold } = config.contextFill;

    if (fillPercentage >= criticalThreshold) {
      return {
        status: "critical",
        message: `Context fill: ${pct}% -- recommend compaction`,
        metadata: { fillPercentage },
      };
    }

    if (fillPercentage >= warningThreshold) {
      return {
        status: "warning",
        message: `Context fill: ${pct}%`,
        metadata: { fillPercentage },
      };
    }

    return {
      status: "healthy",
      message: `Context fill: ${pct}%`,
      metadata: { fillPercentage },
    };
  },
};

export default contextFillCheck;
