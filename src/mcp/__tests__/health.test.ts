import { describe, it, expect } from "vitest";
import { checkMcpServerHealth } from "../health.js";

describe("checkMcpServerHealth", () => {
  it("returns healthy when server responds to initialize", async () => {
    // Mock server: reads stdin, responds with JSON-RPC initialize result
    const mockServerScript = `
      process.stdin.setEncoding("utf-8");
      let buf = "";
      process.stdin.on("data", (chunk) => {
        buf += chunk;
        if (buf.includes("\\n")) {
          const msg = JSON.parse(buf.trim());
          const response = JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              serverInfo: { name: "test-server", version: "0.1.0" },
            },
          });
          process.stdout.write(response + "\\n");
        }
      });
    `;

    const result = await checkMcpServerHealth(
      { name: "test-server", command: "node", args: ["-e", mockServerScript], env: {} },
      5000,
    );

    expect(result.name).toBe("test-server");
    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("returns unhealthy when process fails to start", async () => {
    const result = await checkMcpServerHealth(
      { name: "bad-server", command: "nonexistent-command-xyz", args: [], env: {} },
      3000,
    );

    expect(result.name).toBe("bad-server");
    expect(result.healthy).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns unhealthy when server times out", async () => {
    // Server that never responds
    const hangScript = `setInterval(() => {}, 10000);`;

    const result = await checkMcpServerHealth(
      { name: "slow-server", command: "node", args: ["-e", hangScript], env: {} },
      500, // Very short timeout
    );

    expect(result.name).toBe("slow-server");
    expect(result.healthy).toBe(false);
    expect(result.error).toContain("timed out");
    expect(result.latencyMs).toBeGreaterThanOrEqual(400);
  }, 10000);

  it("returns unhealthy when server exits immediately", async () => {
    const exitScript = `process.exit(1);`;

    const result = await checkMcpServerHealth(
      { name: "crash-server", command: "node", args: ["-e", exitScript], env: {} },
      3000,
    );

    expect(result.name).toBe("crash-server");
    expect(result.healthy).toBe(false);
    expect(result.error).toBeDefined();
  });
});
