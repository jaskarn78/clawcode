import { createServer, type Server, type Socket } from "node:net";
import { ipcRequestSchema } from "./protocol.js";
import type { IpcResponse } from "./protocol.js";
import { logger } from "../shared/logger.js";
import type { Logger } from "pino";

/**
 * Handler function that routes IPC methods to the session manager.
 * Takes a method name and params, returns a result or throws.
 */
export type IpcHandler = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Create a Unix socket server that accepts JSON-RPC 2.0 requests.
 * Messages are newline-delimited JSON (one request per line).
 *
 * @param socketPath - Path to the Unix domain socket
 * @param handler - Function to handle incoming requests
 * @returns The net.Server instance
 */
export function createIpcServer(
  socketPath: string,
  handler: IpcHandler,
): Server {
  const log: Logger = logger.child({ component: "ipc-server" });

  const server = createServer((socket: Socket) => {
    let buffer = "";

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();

      // Process complete messages (newline-delimited)
      const lines = buffer.split("\n");
      // Last element is incomplete (or empty after trailing newline)
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim().length === 0) {
          continue;
        }
        void handleMessage(line, socket, handler, log);
      }
    });

    socket.on("error", (err: Error) => {
      log.warn({ error: err.message }, "socket error");
    });
  });

  server.listen(socketPath, () => {
    log.info({ socket: socketPath }, "IPC server listening");
  });

  return server;
}

/**
 * Parse and handle a single JSON-RPC message.
 */
async function handleMessage(
  raw: string,
  socket: Socket,
  handler: IpcHandler,
  log: Logger,
): Promise<void> {
  let requestId = "unknown";

  try {
    const parsed: unknown = JSON.parse(raw);
    const result = ipcRequestSchema.safeParse(parsed);

    if (!result.success) {
      const response: IpcResponse = {
        jsonrpc: "2.0",
        id: requestId,
        error: {
          code: -32600,
          message: "Invalid Request",
          data: result.error.message,
        },
      };
      socket.write(JSON.stringify(response) + "\n");
      return;
    }

    const request = result.data;
    requestId = request.id;

    log.debug({ method: request.method, id: request.id }, "handling request");

    const handlerResult = await handler(request.method, request.params);

    const response: IpcResponse = {
      jsonrpc: "2.0",
      id: request.id,
      result: handlerResult,
    };
    socket.write(JSON.stringify(response) + "\n");
  } catch (error) {
    const errMessage =
      error instanceof Error ? error.message : String(error);

    log.error({ error: errMessage, requestId }, "handler error");

    const response: IpcResponse = {
      jsonrpc: "2.0",
      id: requestId,
      error: {
        code: -32603,
        message: errMessage,
      },
    };
    socket.write(JSON.stringify(response) + "\n");
  }
}
