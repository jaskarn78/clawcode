import type { Command } from "commander";
import { cliError } from "../output.js";

/**
 * Register the `clawcode image-mcp` command.
 *
 * Starts the image generation MCP stdio server that delegates
 * image_generate / image_edit / image_variations tool calls to the
 * daemon's shared OpenAI / MiniMax / fal.ai clients over Unix-socket
 * IPC. Auto-injected by Task 2 of Plan 02 alongside the existing
 * `clawcode mcp` / `browser-mcp` / `search-mcp` servers.
 */
export function registerImageMcpCommand(program: Command): void {
  program
    .command("image-mcp")
    .description(
      "Start the image MCP stdio server (auto-injected per agent; delegates to daemon's image provider clients via IPC)",
    )
    .action(async () => {
      try {
        // Dynamic import keeps the MCP SDK out of the main CLI boot path.
        const { startImageMcpServer } = await import(
          "../../image/mcp-server.js"
        );
        await startImageMcpServer();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        cliError(`Error starting image MCP server: ${msg}`);
        process.exit(1);
      }
    });
}
