import { describe, it, expect } from "vitest";
import {
  ipcRequestSchema,
  ipcResponseSchema,
  IPC_METHODS,
} from "../protocol.js";

describe("IPC_METHODS", () => {
  it("includes all required methods", () => {
    expect(IPC_METHODS).toEqual([
      "start",
      "stop",
      "restart",
      "start-all",
      "status",
      "routes",
      "rate-limit-status",
      "heartbeat-status",
      "schedules",
      "skills",
      "send-message",
      "slash-commands",
      "webhooks",
      "fork-session",
      "memory-search",
      "memory-list",
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
