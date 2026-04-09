import { z } from "zod/v4";

/**
 * Supported IPC methods for CLI-to-daemon communication.
 * Maps to D-05: start, stop, restart, start-all, status.
 */
export const IPC_METHODS = [
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
