import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ipcRequestSchema,
  ipcResponseSchema,
  IPC_METHODS,
} from "../protocol.js";
import { handleListRateLimitSnapshotsIpc } from "../../manager/daemon-rate-limit-ipc.js";
import type { RateLimitSnapshot } from "../../usage/rate-limit-tracker.js";

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
      // Phase 85 Plan 01 TOOL-01 — per-agent MCP state snapshot
      "list-mcp-status",
      // Phase 94 Plan 01 TOOL-01 — on-demand capability probe trigger
      "mcp-probe",
      // Phase 94 Plan 05 TOOL-08 / TOOL-09 — built-in Discord helpers
      "fetch-discord-messages",
      "share-file",
      // Phase 91 Plan 05 SYNC-08 — sync snapshot
      "list-sync-status",
      // Phase 103 OBS-06 — per-agent OAuth Max rate-limit snapshots
      "list-rate-limit-snapshots",
      // Messaging
      // Phase 999.2 Plan 02 — canonical names registered FIRST; old names
      // retained as back-compat aliases (D-RNI-IPC-01 / D-RNI-IPC-02).
      "ask-agent",
      "send-message",
      "post-to-agent",
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
      "archive-discord-thread",
      // Phase 100 follow-up — schedule_reminder MCP tool ad-hoc one-off
      // reminders that fire as standalone turns and post via the
      // trigger-delivery callback (operator-surfaced 2026-04-27).
      "schedule-reminder",
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
      // Phase 87 CMD-02 — live SDK permission-mode swap via Query.setPermissionMode.
      "set-permission-mode",
      // Phase 88 Plan 02 MKT-01..07 — marketplace list/install/remove
      "marketplace-list",
      "marketplace-install",
      "marketplace-remove",
      // Phase 90 Plan 05 HUB-02 / HUB-04 — ClawHub plugin list/install
      "marketplace-list-plugins",
      "marketplace-install-plugin",
      // Phase 90 Plan 06 HUB-05 / HUB-07 — GitHub OAuth device-code +
      // 1Password op:// rewrite probe for install-time config collection.
      "clawhub-oauth-start",
      "clawhub-oauth-poll",
      "marketplace-probe-op-items",
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
      // Web search MCP (Phase 71)
      "search-tool-call",
      // Image generation MCP (Phase 72)
      "image-tool-call",
      // Phase 92 Plan 04 / Plan 06 — destructive cutover IPC surface
      "cutover-verify-summary",
      "cutover-button-action",
      "cutover-verify",
      "cutover-rollback",
      // Phase 95 Plan 03 DREAM-07 — operator-driven dream-pass trigger
      "run-dream-pass",
      // Phase 96 Plan 05 D-03 — operator-driven filesystem capability probe
      "probe-fs",
      // Phase 96 Plan 05 D-04 — read-only FS capability snapshot
      "list-fs-status",
      // Phase 100 follow-up — runtime gsd.projectDir override (Discord
      // /gsd-set-project + daemon set-gsd-project IPC handler).
      "set-gsd-project",
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

describe("list-rate-limit-snapshots IPC handler (OBS-06)", () => {
  // Pure-DI handler module mirrors the Phase 96 daemon-fs-ipc + Phase 92
  // cutover-ipc-handlers blueprint — extract the case-body into a small
  // module so the IPC contract can be tested without spawning the daemon.

  function buildStubTracker(snapshots: readonly RateLimitSnapshot[]) {
    return {
      getAllSnapshots: () => snapshots,
    };
  }

  function buildDeps(
    trackers: Record<string, readonly RateLimitSnapshot[]>,
  ) {
    return {
      getRateLimitTrackerForAgent: (name: string) =>
        trackers[name] !== undefined
          ? buildStubTracker(trackers[name])
          : undefined,
    };
  }

  it("returns {agent, snapshots[]} for a running agent", () => {
    const fixedNow = Date.now();
    const seeded: RateLimitSnapshot = Object.freeze({
      rateLimitType: "five_hour",
      status: "allowed",
      utilization: 0.42,
      resetsAt: fixedNow + 3_600_000,
      surpassedThreshold: undefined,
      overageStatus: undefined,
      overageResetsAt: undefined,
      overageDisabledReason: undefined,
      isUsingOverage: undefined,
      recordedAt: fixedNow,
    });
    const deps = buildDeps({ "running-agent": [seeded] });
    const result = handleListRateLimitSnapshotsIpc(
      { agent: "running-agent" },
      deps,
    );
    expect(result).toMatchObject({ agent: "running-agent" });
    expect(Array.isArray(result.snapshots)).toBe(true);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]).toEqual(seeded);
  });

  it("returns {agent, snapshots: []} for an unknown agent (does not throw)", () => {
    const deps = buildDeps({}); // no agents registered
    const result = handleListRateLimitSnapshotsIpc(
      { agent: "no-such-agent" },
      deps,
    );
    expect(result).toEqual({ agent: "no-such-agent", snapshots: [] });
  });

  it("returns empty array when tracker has no snapshots yet", () => {
    const deps = buildDeps({ "fresh-agent": [] });
    const result = handleListRateLimitSnapshotsIpc(
      { agent: "fresh-agent" },
      deps,
    );
    expect(result).toEqual({ agent: "fresh-agent", snapshots: [] });
  });

  it("includes 'list-rate-limit-snapshots' in IPC_METHODS", () => {
    expect(IPC_METHODS).toContain("list-rate-limit-snapshots");
  });

  it("does NOT collide with existing 'rate-limit-status' (Pitfall 5)", () => {
    // Both must coexist — they are SEPARATE domains:
    //   - rate-limit-status         → Discord outbound rate-limiter token bucket
    //   - list-rate-limit-snapshots → per-agent OAuth Max rate-limit snapshots
    expect(IPC_METHODS).toContain("rate-limit-status");
    expect(IPC_METHODS).toContain("list-rate-limit-snapshots");
  });
});

// Phase 999.2 Plan 02 — IPC method aliases (D-RNI-IPC-01..04)
//
// Pins:
//   - IPC_METHODS contains both old AND new names exactly once each
//     (z.enum(IPC_METHODS) accepts both — back-compat for CLI / external
//     IPC consumers per D-RNI-IPC-03).
//   - protocol.ts source contains explicit DEPRECATED annotation comments
//     (D-RNI-IPC-04 — operator-facing rationale for the duplicate entries).
//   - daemon.ts case-statement uses stacked-case form to share a body
//     between old and new method names (RESEARCH.md §Pattern 2).
describe("Phase 999.2 Plan 02 — IPC method aliases", () => {
  it("IPC_METHODS contains ask-agent exactly once", () => {
    const occurrences = IPC_METHODS.filter((m) => m === "ask-agent").length;
    expect(occurrences).toBe(1);
  });

  it("IPC_METHODS contains send-message exactly once (deprecated alias retained)", () => {
    const occurrences = IPC_METHODS.filter((m) => m === "send-message").length;
    expect(occurrences).toBe(1);
  });

  it("IPC_METHODS contains post-to-agent exactly once", () => {
    const occurrences = IPC_METHODS.filter((m) => m === "post-to-agent").length;
    expect(occurrences).toBe(1);
  });

  it("IPC_METHODS contains send-to-agent exactly once (deprecated alias retained)", () => {
    const occurrences = IPC_METHODS.filter((m) => m === "send-to-agent").length;
    expect(occurrences).toBe(1);
  });

  it("src/ipc/protocol.ts has `// DEPRECATED — use ask-agent` annotation (D-RNI-IPC-04)", () => {
    const text = readFileSync("src/ipc/protocol.ts", "utf8");
    expect(text).toContain("// DEPRECATED — use ask-agent");
  });

  it("src/ipc/protocol.ts has `// DEPRECATED — use post-to-agent` annotation (D-RNI-IPC-04)", () => {
    const text = readFileSync("src/ipc/protocol.ts", "utf8");
    expect(text).toContain("// DEPRECATED — use post-to-agent");
  });

  it("src/manager/daemon.ts has stacked-case `ask-agent` + `send-message` with shared body", () => {
    const text = readFileSync("src/manager/daemon.ts", "utf8");
    expect(text).toMatch(/case "ask-agent":\s*\n\s*case "send-message":/);
  });

  it("src/manager/daemon.ts has stacked-case `post-to-agent` + `send-to-agent` with shared body", () => {
    const text = readFileSync("src/manager/daemon.ts", "utf8");
    expect(text).toMatch(/case "post-to-agent":\s*\n\s*case "send-to-agent":/);
  });
});
