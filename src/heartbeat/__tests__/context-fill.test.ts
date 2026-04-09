import { describe, it, expect, vi } from "vitest";
import contextFillCheck from "../checks/context-fill.js";
import type { CheckContext } from "../types.js";

/**
 * Create a mock CheckContext with a configurable fill provider.
 */
function createMockContext(
  fillPercentage: number | null,
  thresholds = { warningThreshold: 0.6, criticalThreshold: 0.75 },
): CheckContext {
  const mockProvider = fillPercentage !== null
    ? { getContextFillPercentage: () => fillPercentage, addTurn: vi.fn(), reset: vi.fn() }
    : undefined;

  return {
    agentName: "test-agent",
    sessionManager: {
      getContextFillProvider: vi.fn().mockReturnValue(mockProvider),
      getRunningAgents: vi.fn().mockReturnValue([]),
      getCompactionManager: vi.fn().mockReturnValue(undefined),
    } as any,
    registry: { entries: [], updatedAt: Date.now() },
    config: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: thresholds,
    },
  };
}

describe("context-fill check", () => {
  it("returns healthy when fill < warningThreshold", async () => {
    const context = createMockContext(0.3);
    const result = await contextFillCheck.execute(context);

    expect(result.status).toBe("healthy");
    expect(result.message).toContain("Context fill: 30%");
    expect(result.metadata).toEqual({ fillPercentage: 0.3 });
  });

  it("returns warning when fill >= warningThreshold and < criticalThreshold", async () => {
    const context = createMockContext(0.65);
    const result = await contextFillCheck.execute(context);

    expect(result.status).toBe("warning");
    expect(result.message).toContain("Context fill: 65%");
    expect(result.metadata).toEqual({ fillPercentage: 0.65 });
  });

  it("returns critical when fill >= criticalThreshold with recommend compaction", async () => {
    const context = createMockContext(0.8);
    const result = await contextFillCheck.execute(context);

    expect(result.status).toBe("critical");
    expect(result.message).toContain("Context fill: 80%");
    expect(result.message).toContain("recommend compaction");
    expect(result.metadata).toEqual({ fillPercentage: 0.8 });
  });

  it("returns healthy with no memory system message when no fill provider", async () => {
    const context = createMockContext(null);
    const result = await contextFillCheck.execute(context);

    expect(result.status).toBe("healthy");
    expect(result.message).toBe("No memory system configured");
    expect(result.metadata).toBeUndefined();
  });

  it("metadata includes fillPercentage as raw 0-1 value", async () => {
    const context = createMockContext(0.42);
    const result = await contextFillCheck.execute(context);

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.fillPercentage).toBe(0.42);
  });

  it("returns critical at exactly the critical threshold", async () => {
    const context = createMockContext(0.75);
    const result = await contextFillCheck.execute(context);

    expect(result.status).toBe("critical");
  });

  it("returns warning at exactly the warning threshold", async () => {
    const context = createMockContext(0.6);
    const result = await contextFillCheck.execute(context);

    expect(result.status).toBe("warning");
  });

  it("has name 'context-fill'", () => {
    expect(contextFillCheck.name).toBe("context-fill");
  });
});
