import { describe, it, expect } from "vitest";
import {
  ipcRequestSchema,
  ipcResponseSchema,
  IPC_METHODS,
} from "../protocol.js";

describe("IPC_METHODS", () => {
  it("includes all required methods", () => {
    expect(IPC_METHODS).toEqual([
      // Lifecycle
      "start",
      "stop",
      "restart",
      "start-all",
      "stop-all",
      "status",
      // Observability
      "routes",
      "rate-limit-status",
      "heartbeat-status",
      "schedules",
      "skills",
      "threads",
      "usage",
      "context-zone-status",
      "episode-list",
      "delivery-queue-status",
      "mcp-servers",
      // Messaging
      "send-message",
      "send-to-agent",
      "send-attachment",
      "slash-commands",
      "webhooks",
      "fork-session",
      // Memory
      "memory-search",
      "memory-lookup",
      "memory-list",
      "memory-graph",
      "memory-save",
      // Subagent threads
      "spawn-subagent-thread",
      "cleanup-subagent-thread",
      "read-thread",
      "message-history",
      // Security (Phase 27)
      "approve-command",
      "deny-command",
      "allow-always",
      "check-command",
      "update-security",
      "security-status",
      // Model tiering (Phase 39)
      "ask-advisor",
      "set-model",
      // Cost tracking (Phase 40)
      "costs",
      // Latency (Phase 50)
      "latency",
      // Bench (Phase 51)
      "bench-run-prompt",
      // Cache (Phase 52)
      "cache",
      // Tools (Phase 55)
      "tools",
      // Effort (reasoning level)
      "set-effort",
      "get-effort",
      // Document RAG (Phase 49)
      "ingest-document",
      "search-documents",
      "delete-document",
      "list-documents",
      // Agent provisioning
      "agent-create",
      // Cross-agent RPC / handoffs (Phase 59)
      "delegate-task",
      "task-status",
      "cancel-task",
      "task-complete",
      "task-retry",
      // Observability (Phase 63)
      "list-tasks",
      // OpenAI-compatible endpoint key management (Phase 69)
      "openai-key-create",
      "openai-key-list",
      "openai-key-revoke",
      // Browser automation MCP (Phase 70)
      "browser-tool-call",
    ]);
  });
});

describe("ipcRequestSchema", () => {
  const validRequest = {
    jsonrpc: "2.0",
    id: "req-1",
    method: "start",
    params: { name: "researcher" },
  };

  it("parses a valid request", () => {
    const result = ipcRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jsonrpc).toBe("2.0");
      expect(result.data.id).toBe("req-1");
      expect(result.data.method).toBe("start");
      expect(result.data.params).toEqual({ name: "researcher" });
    }
  });

  it("rejects missing jsonrpc field", () => {
    const { jsonrpc, ...rest } = validRequest;
    const result = ipcRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects non-2.0 jsonrpc version", () => {
    const result = ipcRequestSchema.safeParse({
      ...validRequest,
      jsonrpc: "1.0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing id", () => {
    const { id, ...rest } = validRequest;
    const result = ipcRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects unknown method", () => {
    const result = ipcRequestSchema.safeParse({
      ...validRequest,
      method: "destroy",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid methods", () => {
    for (const method of IPC_METHODS) {
      const result = ipcRequestSchema.safeParse({
        ...validRequest,
        method,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("ipcResponseSchema", () => {
  const baseResponse = {
    jsonrpc: "2.0" as const,
    id: "req-1",
  };

  it("parses a valid response with result", () => {
    const result = ipcResponseSchema.safeParse({
      ...baseResponse,
      result: { status: "ok" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.result).toEqual({ status: "ok" });
    }
  });

  it("parses a valid response with error", () => {
    const result = ipcResponseSchema.safeParse({
      ...baseResponse,
      error: { code: -32600, message: "Invalid request" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error?.code).toBe(-32600);
      expect(result.data.error?.message).toBe("Invalid request");
    }
  });

  it("parses a response with error including data", () => {
    const result = ipcResponseSchema.safeParse({
      ...baseResponse,
      error: { code: -32600, message: "Invalid request", data: { detail: "missing field" } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects response with neither result nor error", () => {
    const result = ipcResponseSchema.safeParse(baseResponse);
    expect(result.success).toBe(false);
  });

  it("rejects missing jsonrpc", () => {
    const result = ipcResponseSchema.safeParse({
      id: "req-1",
      result: { status: "ok" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing id", () => {
    const result = ipcResponseSchema.safeParse({
      jsonrpc: "2.0",
      result: { status: "ok" },
    });
    expect(result.success).toBe(false);
  });
});

describe("ipcRequestSchema bench-run-prompt", () => {
  it("accepts a bench-run-prompt request with agent, prompt, and turnIdPrefix params", () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: "bench-1",
      method: "bench-run-prompt",
      params: {
        agent: "bench-agent",
        prompt: "Say hi.",
        turnIdPrefix: "bench:no-tool-short:",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.method).toBe("bench-run-prompt");
      expect(result.data.params).toEqual({
        agent: "bench-agent",
        prompt: "Say hi.",
        turnIdPrefix: "bench:no-tool-short:",
      });
    }
  });
});

describe("ipcRequestSchema cache", () => {
  it("accepts a cache request with agent + since params", () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: "c-1",
      method: "cache",
      params: { agent: "atlas", since: "24h" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.method).toBe("cache");
      expect(result.data.params).toEqual({ agent: "atlas", since: "24h" });
    }
  });

  it("accepts a cache request with --all (no agent)", () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: "c-2",
      method: "cache",
      params: { all: true, since: "7d" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.method).toBe("cache");
      expect(result.data.params).toEqual({ all: true, since: "7d" });
    }
  });
});

describe("ipcRequestSchema tools (Phase 55)", () => {
  it("accepts a tools request with agent + since params", () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: "t-1",
      method: "tools",
      params: { agent: "atlas", since: "24h" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.method).toBe("tools");
      expect(result.data.params).toEqual({ agent: "atlas", since: "24h" });
    }
  });

  it("accepts a tools request with --all (no agent)", () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: "t-2",
      method: "tools",
      params: { all: true, since: "7d" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.method).toBe("tools");
      expect(result.data.params).toEqual({ all: true, since: "7d" });
    }
  });
});
