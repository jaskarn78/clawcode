import type { Command } from "commander";
import { cliError } from "../output.js";

/**
 * Register the `clawcode browser-mcp` command.
 *
 * Starts the browser MCP stdio server that delegates browser tool calls
 * to the daemon's BrowserManager over Unix-socket IPC. Auto-injected by
 * Plan 03 alongside the existing `clawcode mcp` server.
 */
export function registerBrowserMcpCommand(program: Command): void {
  program
    .command("browser-mcp")
    .description(
      "Start the browser MCP stdio server (auto-injected per agent; delegates to daemon's BrowserManager via IPC)",
    )
    .action(async () => {
      try {
        // Dynamic import keeps the MCP SDK out of the main CLI boot path.
        const { startBrowserMcpServer } = await import(
          "../../browser/mcp-server.js"
        );
        await startBrowserMcpServer();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        cliError(`Error starting browser MCP server: ${msg}`);
        process.exit(1);
      }
    });
}
