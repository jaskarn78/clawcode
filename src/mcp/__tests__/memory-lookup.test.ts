import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS } from "../server.js";

describe("memory_lookup tool definition", () => {
  it("is defined in TOOL_DEFINITIONS", () => {
    expect(TOOL_DEFINITIONS).toHaveProperty("memory_lookup");
  });

  it("has correct ipcMethod", () => {
    expect(TOOL_DEFINITIONS.memory_lookup.ipcMethod).toBe("memory-lookup");
  });

  it("has a description", () => {
    expect(TOOL_DEFINITIONS.memory_lookup.description).toBeTruthy();
  });
});
