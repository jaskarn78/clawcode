import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { sendIpcRequest } from "../ipc/client.js";
import { SOCKET_PATH } from "../manager/daemon.js";

/**
 * Tool definitions for the ClawCode MCP server.
 * Each tool maps to an existing IPC method on the daemon.
 */
export const TOOL_DEFINITIONS = {
  agent_status: {
    description: "Get status of all ClawCode agents or a specific agent",
    ipcMethod: "status",
  },
  list_agents: {
    description: "List all configured agents with their current status",
    ipcMethod: "status",
  },
  send_message: {
    description: "Send a message to a ClawCode agent's inbox",
    ipcMethod: "send-message",
  },
  list_schedules: {
    description: "Show all scheduled tasks across agents",
    ipcMethod: "schedules",
  },
  list_webhooks: {
    description: "Show configured webhook identities",
    ipcMethod: "webhooks",
  },
  spawn_subagent_thread: {
    description: "Spawn a subagent in a new Discord thread",
    ipcMethod: "spawn-subagent-thread",
  },
  memory_lookup: {
    description: "Search your memory for relevant context, past decisions, and knowledge",
    ipcMethod: "memory-lookup",
  },
} as const;

/**
 * Create and configure the ClawCode MCP server.
 * Tools delegate to the daemon via the IPC client.
 *
 * @returns Configured McpServer ready for transport connection
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "clawcode",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Tool: agent_status
  server.tool(
    "agent_status",
    "Get status of all ClawCode agents or a specific agent",
    { name: z.string().optional().describe("Agent name to filter by") },
    async ({ name }) => {
      const result = (await sendIpcRequest(SOCKET_PATH, "status", {})) as {
        entries: readonly { name: string; status: string; sessionId: string | null }[];
      };

      const entries = name
        ? result.entries.filter((e) => e.name === name)
        : result.entries;

      const text = entries
        .map((e) => `${e.name}: ${e.status}${e.sessionId ? ` (session: ${e.sessionId})` : ""}`)
        .join("\n");

      return { content: [{ type: "text" as const, text: text || "No agents found" }] };
    },
  );

  // Tool: send_message
  server.tool(
    "send_message",
    "Send a message to a ClawCode agent's inbox",
    {
      to: z.string().describe("Target agent name"),
      content: z.string().describe("Message content"),
      from: z.string().default("mcp-client").describe("Sender name"),
      priority: z.enum(["normal", "high", "urgent"]).default("normal").describe("Message priority"),
    },
    async ({ to, content, from, priority }) => {
      const result = (await sendIpcRequest(SOCKET_PATH, "send-message", {
        from,
        to,
        content,
        priority,
      })) as { ok: boolean; messageId: string };

      return {
        content: [{ type: "text" as const, text: `Message sent to ${to} (id: ${result.messageId})` }],
      };
    },
  );

  // Tool: list_schedules
  server.tool(
    "list_schedules",
    "Show all scheduled tasks across agents",
    {},
    async () => {
      const result = (await sendIpcRequest(SOCKET_PATH, "schedules", {})) as {
        schedules: readonly { agent: string; name: string; cron: string; enabled: boolean; nextRun: string | null }[];
      };

      if (result.schedules.length === 0) {
        return { content: [{ type: "text" as const, text: "No scheduled tasks" }] };
      }

      const text = result.schedules
        .map((s) => `${s.agent}/${s.name}: ${s.cron} (${s.enabled ? "enabled" : "disabled"})${s.nextRun ? ` next: ${s.nextRun}` : ""}`)
        .join("\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );

  // Tool: list_webhooks
  server.tool(
    "list_webhooks",
    "Show configured webhook identities for agents",
    {},
    async () => {
      const result = (await sendIpcRequest(SOCKET_PATH, "webhooks", {})) as {
        webhooks: readonly { agent: string; displayName: string; hasWebhookUrl: boolean }[];
      };

      if (result.webhooks.length === 0) {
        return { content: [{ type: "text" as const, text: "No webhook identities configured" }] };
      }

      const text = result.webhooks
        .map((w) => `${w.agent}: ${w.displayName} (${w.hasWebhookUrl ? "active" : "no url"})`)
        .join("\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );

  // Tool: spawn_subagent_thread
  server.tool(
    "spawn_subagent_thread",
    "Spawn a subagent in a new Discord thread",
    {
      agent: z.string().describe("Parent agent name"),
      threadName: z.string().describe("Name for the Discord thread"),
      model: z.enum(["sonnet", "opus", "haiku"]).optional().describe("Model for the subagent"),
      systemPrompt: z.string().optional().describe("Custom system prompt"),
    },
    async ({ agent, threadName, model, systemPrompt }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "spawn-subagent-thread", {
          parentAgent: agent,
          threadName,
          model,
          systemPrompt,
        })) as { threadId: string; sessionName: string; parentAgent: string; channelId: string };

        const text = [
          `Thread URL: https://discord.com/channels/@me/${result.threadId}`,
          `Session: ${result.sessionName}`,
          `Parent Agent: ${result.parentAgent}`,
          `Channel: ${result.channelId}`,
        ].join("\n");

        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }] };
      }
    },
  );

  // Tool: memory_lookup
  server.tool(
    "memory_lookup",
    "Search your memory for relevant context, past decisions, and knowledge",
    {
      query: z.string().describe("What to search for in memory"),
      limit: z.number().int().min(1).max(20).default(5).describe("Max results to return"),
      agent: z.string().describe("Your agent name (pass your own name)"),
    },
    async ({ query, limit, agent }) => {
      const result = (await sendIpcRequest(SOCKET_PATH, "memory-lookup", {
        agent,
        query,
        limit,
      })) as {
        results: readonly {
          id: string;
          content: string;
          relevance_score: number;
          tags: readonly string[];
          created_at: string;
        }[];
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.results, null, 2) }],
      };
    },
  );

  return server;
}

/**
 * Start the MCP server with stdio transport.
 * This is the entry point for `clawcode mcp`.
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
