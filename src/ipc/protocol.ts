import { z } from "zod/v4";

/**
 * Supported IPC methods for CLI-to-daemon communication.
 * Maps to D-05: start, stop, restart, start-all, status.
 */
export const IPC_METHODS = [
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
  // Phase 85 Plan 01 TOOL-01 — per-agent MCP state snapshot from the
  // SessionManager state map (fed by the warm-path readiness probe +
  // the `mcp-reconnect` heartbeat). Read by Plan 03's `/clawcode-tools`
  // slash command and by operators verifying live tool health.
  "list-mcp-status",
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
  // Phase 87 CMD-02 — live SDK permission-mode swap via Query.setPermissionMode.
  "set-permission-mode",
  // Phase 88 MKT-01..07 — marketplace list / install / remove routed through
  // the pure-exported-handler blueprint (Phase 86 Plan 02). Returns typed
  // outcomes consumed by the Discord /clawcode-skills-browse + /clawcode-skills
  // inline handlers.
  "marketplace-list",
  "marketplace-install",
  "marketplace-remove",
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
  // Browser automation MCP (Phase 70) — routes per-agent tool calls from
  // the out-of-process `clawcode browser-mcp` subprocess to the daemon's
  // shared BrowserManager + the pure handlers in src/browser/tools.ts.
  "browser-tool-call",
  // Web search MCP (Phase 71) — routes per-agent tool calls from the
  // out-of-process `clawcode search-mcp` subprocess to the daemon's
  // shared BraveClient/ExaClient + URL fetcher + the pure handlers in
  // src/search/tools.ts.
  "search-tool-call",
  // Image generation MCP (Phase 72) — routes per-agent tool calls from
  // the out-of-process `clawcode image-mcp` subprocess to the daemon's
  // shared image provider clients + the pure handlers in
  // src/image/tools.ts.
  "image-tool-call",
] as const;

export type IpcMethod = (typeof IPC_METHODS)[number];

/**
 * JSON-RPC 2.0 request schema for IPC messages.
 * Validates: jsonrpc must be "2.0", id is required string,
 * method must be one of IPC_METHODS, params is a record.
 */
export const ipcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  method: z.enum(IPC_METHODS),
  params: z.record(z.string(), z.unknown()).default({}),
});

export type IpcRequest = z.infer<typeof ipcRequestSchema>;

/**
 * JSON-RPC 2.0 error object schema.
 */
const ipcErrorObjectSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

/**
 * JSON-RPC 2.0 response schema for IPC messages.
 * Must have either result or error (or both), but not neither.
 */
export const ipcResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.string(),
    result: z.unknown().optional(),
    error: ipcErrorObjectSchema.optional(),
  })
  .check(
    z.refine((data) => data.result !== undefined || data.error !== undefined, {
      message: "Response must have either result or error",
    }),
  );

export type IpcResponse = z.infer<typeof ipcResponseSchema>;
