import { describe, it, expect } from "vitest";
import { formatCostsTable } from "./costs.js";
import type { CostByAgentModel } from "../../usage/types.js";

describe("formatCostsTable", () => {
  it("formats a table with agent, model, tokens, and cost columns", () => {
    const rows: CostByAgentModel[] = [
      { agent: "test-agent", model: "sonnet", tokens_in: 50000, tokens_out: 10000, cost_usd: 0.30 },
      { agent: "test-agent", model: "haiku", tokens_in: 100000, tokens_out: 20000, cost_usd: 0.05 },
    ];

    const output = formatCostsTable(rows);

    expect(output).toContain("Agent");
    expect(output).toContain("Model");
    expect(output).toContain("Tokens In");
    expect(output).toContain("Tokens Out");
    expect(output).toContain("Cost");
    expect(output).toContain("test-agent");
    expect(output).toContain("sonnet");
    expect(output).toContain("haiku");
  });

  it("shows total row at bottom", () => {
    const rows: CostByAgentModel[] = [
      { agent: "agent-a", model: "sonnet", tokens_in: 1000, tokens_out: 500, cost_usd: 0.10 },
      { agent: "agent-b", model: "opus", tokens_in: 2000, tokens_out: 1000, cost_usd: 0.50 },
    ];

    const output = formatCostsTable(rows);
    expect(output).toContain("TOTAL");
    expect(output).toContain("0.60");
  });

  it("handles empty rows gracefully", () => {
    const output = formatCostsTable([]);
    expect(output).toContain("No cost data");
  });
});
