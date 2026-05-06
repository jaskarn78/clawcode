/**
 * Phase 110 Stage 0b 0B-RT-13 — `list-mcp-tools` IPC method tests.
 *
 * Wave 1 daemon-side prerequisite. Future Go shims (Waves 2-4) call this
 * method at boot to fetch JSON-Schema-converted tool definitions, keeping
 * the canonical Zod schemas single-sourced in TypeScript.
 *
 * Test coverage:
 *   - Tests 1-4 (this plan, Task 1): contract tests against the protocol
 *     registry — request/response Zod schemas + method registration.
 *   - Tests 5-9 (this plan, Task 2): handler behavior — TOOL_DEFINITIONS
 *     conversion fidelity for each shim type + invalid-params error.
 */
import { describe, it, expect } from "vitest";

import {
  IPC_METHODS,
  listMcpToolsRequestSchema,
  listMcpToolsResponseSchema,
  mcpToolSchemaSchema,
} from "../../ipc/protocol.js";

describe("list-mcp-tools IPC contract (Phase 110 0B-RT-13)", () => {
  describe("request schema", () => {
    it("Test 1 — accepts valid shimType values (search/image/browser)", () => {
      const search = listMcpToolsRequestSchema.safeParse({ shimType: "search" });
      const image = listMcpToolsRequestSchema.safeParse({ shimType: "image" });
      const browser = listMcpToolsRequestSchema.safeParse({
        shimType: "browser",
      });
      expect(search.success).toBe(true);
      expect(image.success).toBe(true);
      expect(browser.success).toBe(true);
      if (search.success) expect(search.data.shimType).toBe("search");
      if (image.success) expect(image.data.shimType).toBe("image");
      if (browser.success) expect(browser.data.shimType).toBe("browser");
    });

    it("Test 2 — rejects unknown / empty shimType values", () => {
      // Operator-side typo ("broker" is a different surface, Phase 108).
      const broker = listMcpToolsRequestSchema.safeParse({
        shimType: "broker",
      });
      expect(broker.success).toBe(false);

      // Empty string also rejected (z.enum is strict).
      const empty = listMcpToolsRequestSchema.safeParse({ shimType: "" });
      expect(empty.success).toBe(false);

      // Missing shimType entirely.
      const missing = listMcpToolsRequestSchema.safeParse({});
      expect(missing.success).toBe(false);

      // Non-string shimType.
      const numeric = listMcpToolsRequestSchema.safeParse({ shimType: 1 });
      expect(numeric.success).toBe(false);
    });
  });

  describe("response schema", () => {
    it("Test 3 — accepts well-formed tools array", () => {
      const wellFormed = listMcpToolsResponseSchema.safeParse({
        tools: [
          {
            name: "x",
            description: "y",
            inputSchema: {},
          },
        ],
      });
      expect(wellFormed.success).toBe(true);

      // Empty tools array is valid (e.g., a future shim type with no tools).
      const empty = listMcpToolsResponseSchema.safeParse({ tools: [] });
      expect(empty.success).toBe(true);

      // Multiple tools with realistic JSON-Schema-shaped inputSchema.
      const multi = listMcpToolsResponseSchema.safeParse({
        tools: [
          {
            name: "web_search",
            description: "Search the live web.",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
          {
            name: "web_fetch_url",
            description: "Fetch a URL.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      });
      expect(multi.success).toBe(true);

      // mcpToolSchemaSchema rejects empty name (per CLAUDE.md input validation).
      const emptyName = mcpToolSchemaSchema.safeParse({
        name: "",
        description: "y",
        inputSchema: {},
      });
      expect(emptyName.success).toBe(false);

      // mcpToolSchemaSchema rejects missing inputSchema.
      const missingSchema = mcpToolSchemaSchema.safeParse({
        name: "x",
        description: "y",
      });
      expect(missingSchema.success).toBe(false);
    });
  });

  describe("method registration", () => {
    it("Test 4 — `list-mcp-tools` is registered in IPC_METHODS", () => {
      expect(IPC_METHODS).toContain("list-mcp-tools");
    });
  });
});
