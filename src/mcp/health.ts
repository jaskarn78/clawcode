import { spawn } from "node:child_process";

/**
 * Result of an MCP server health check.
 */
export type McpHealthResult = {
  readonly name: string;
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly error?: string;
};

/**
 * MCP server config for health checking.
 */
type McpServerConfig = {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
};

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Check if an MCP server is healthy by spawning it and sending an initialize request.
 *
 * Spawns the server process, sends a JSON-RPC initialize message, and waits for
 * a valid response. Always kills the spawned process after the check completes.
 *
 * @param server - MCP server configuration
 * @param timeoutMs - Maximum time to wait for response (default 5000ms)
 * @returns Health check result with name, healthy status, latency, and optional error
 */
export async function checkMcpServerHealth(
  server: McpServerConfig,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<McpHealthResult> {
  const startTime = Date.now();

  return new Promise<McpHealthResult>((resolve) => {
    let resolved = false;
    let child: ReturnType<typeof spawn> | null = null;

    const finish = (healthy: boolean, error?: string): void => {
      if (resolved) return;
      resolved = true;
      const latencyMs = Date.now() - startTime;

      // Kill the child process if still running
      if (child && !child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process may have already exited
        }
      }

      resolve({
        name: server.name,
        healthy,
        latencyMs,
        ...(error !== undefined ? { error } : {}),
      });
    };

    // Set up timeout
    const timer = setTimeout(() => {
      finish(false, `Health check timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    try {
      child = spawn(server.command, [...server.args], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...server.env },
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        finish(false, `Failed to start: ${err.message}`);
      });

      child.on("exit", (code: number | null) => {
        clearTimeout(timer);
        if (!resolved) {
          finish(false, `Process exited with code ${code ?? "unknown"} before responding`);
        }
      });

      // Collect stdout data to parse JSON-RPC response
      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        // Check if we have a complete JSON-RPC response (newline-delimited)
        const lines = stdout.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length === 0) continue;
          try {
            const parsed = JSON.parse(trimmed) as { jsonrpc?: string; id?: string; result?: unknown };
            if (parsed.jsonrpc === "2.0" && parsed.result !== undefined) {
              clearTimeout(timer);
              finish(true);
              return;
            }
          } catch {
            // Not valid JSON yet, keep collecting
          }
        }
      });

      // Send JSON-RPC initialize request
      const initializeRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: "health-check",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "clawcode-health", version: "0.1.0" },
        },
      });

      child.stdin?.write(initializeRequest + "\n");
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      finish(false, `Failed to spawn: ${message}`);
    }
  });
}
