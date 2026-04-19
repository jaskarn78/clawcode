import type { Command } from "commander";
import { cliError } from "../output.js";

/**
 * Register the `clawcode search-mcp` command.
 *
 * Starts the web-search MCP stdio server that delegates web_search and
 * web_fetch_url tool calls to the daemon's shared BraveClient/ExaClient +
 * URL fetcher over Unix-socket IPC. Auto-injected by Task 2 of Plan 02
 * alongside the existing `clawcode mcp` / `browser-mcp` servers.
 */
export function registerSearchMcpCommand(program: Command): void {
  program
    .command("search-mcp")
    .description(
      "Start the search MCP stdio server (auto-injected per agent; delegates to daemon's BraveClient/ExaClient via IPC)",
    )
    .action(async () => {
      try {
        // Dynamic import keeps the MCP SDK out of the main CLI boot path.
        const { startSearchMcpServer } = await import(
          "../../search/mcp-server.js"
        );
        await startSearchMcpServer();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        cliError(`Error starting search MCP server: ${msg}`);
        process.exit(1);
      }
    });
}
