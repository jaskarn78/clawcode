import type { Command } from "commander";

/**
 * Register the `clawcode mcp` command.
 * Starts the MCP stdio server for external Claude Code sessions.
 */
export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Start the MCP stdio server for external Claude Code sessions")
    .action(async () => {
      try {
        // Dynamic import to avoid loading MCP SDK until needed
        const { startMcpServer } = await import("../../mcp/server.js");
        await startMcpServer();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error starting MCP server: ${msg}`);
        process.exit(1);
      }
    });
}
