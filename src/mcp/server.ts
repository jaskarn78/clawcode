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
  memory_save: {
    description: "Save knowledge, decisions, or important context to long-term memory",
    ipcMethod: "memory-save",
  },
  ask_advisor: {
    description: "Ask opus for advice on a complex decision without switching sessions",
    ipcMethod: "ask-advisor",
  },
  send_attachment: {
    description: "Send a file attachment to your Discord channel (images, PDFs, media, etc.)",
    ipcMethod: "send-attachment",
  },
  send_to_agent: {
    description: "Send a message to another agent via their Discord channel",
    ipcMethod: "send-to-agent",
  },
  ingest_document: {
    description: "Ingest a document from your workspace for RAG search (text, markdown, or PDF)",
    ipcMethod: "ingest-document",
  },
  search_documents: {
    description: "Search across ingested documents for relevant content",
    ipcMethod: "search-documents",
  },
  delete_document: {
    description: "Delete all chunks for an ingested document",
    ipcMethod: "delete-document",
  },
  list_documents: {
    description: "List all ingested document sources and total chunk count",
    ipcMethod: "list-documents",
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
    "Spawn a subagent in a new Discord thread. If you pass `task`, the subagent starts working on it immediately and posts its response in the thread — you do NOT need to send a follow-up message.",
    {
      agent: z.string().describe("Parent agent name"),
      threadName: z.string().describe("Name for the Discord thread"),
      model: z.enum(["sonnet", "opus", "haiku"]).optional().describe("Model for the subagent"),
      systemPrompt: z.string().optional().describe("Custom system prompt (personality/role override; not the task)"),
      task: z.string().optional().describe("The task for the subagent to perform. When provided, the subagent starts working immediately and posts its response in the thread — no separate prompt needed."),
    },
    async ({ agent, threadName, model, systemPrompt, task }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "spawn-subagent-thread", {
          parentAgent: agent,
          threadName,
          model,
          systemPrompt,
          task,
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

  // Tool: memory_save
  server.tool(
    "memory_save",
    "Save a piece of knowledge, decision, or important context to your long-term memory for future recall",
    {
      content: z.string().describe("The knowledge or context to remember"),
      tags: z.array(z.string()).default([]).describe("Tags for categorization (e.g. ['project', 'decision'])"),
      importance: z.number().min(0).max(1).default(0.7).describe("Importance score: 0.0 (trivial) to 1.0 (critical)"),
      agent: z.string().describe("Your agent name (pass your own name)"),
    },
    async ({ content, tags, importance, agent }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "memory-save", {
          agent,
          content,
          tags,
          importance,
        })) as { id: string };
        return {
          content: [{ type: "text" as const, text: `Memory saved (id: ${result.id})` }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Failed to save memory: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: ask_advisor
  server.tool(
    "ask_advisor",
    "Ask opus for advice on a complex decision without switching sessions",
    {
      question: z.string().describe("The question or decision you need advice on"),
      agent: z.string().describe("Your agent name (pass your own name)"),
    },
    async ({ question, agent }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "ask-advisor", {
          agent,
          question,
        })) as { answer: string; budget_remaining: number };

        const text = [
          result.answer,
          "",
          `--- Budget remaining: ${result.budget_remaining} advisor calls today ---`,
        ].join("\n");

        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Advisor error: ${message}` }] };
      }
    },
  );

  // Tool: send_attachment
  server.tool(
    "send_attachment",
    "Send a file attachment to your Discord channel (images, PDFs, media, etc.)",
    {
      agent: z.string().describe("Your agent name (pass your own name)"),
      file_path: z.string().describe("Absolute path to the file to send"),
      message: z.string().optional().describe("Optional text message to include with the file"),
      channel_id: z.string().optional().describe("Target channel ID (defaults to your primary channel)"),
    },
    async ({ agent, file_path, message, channel_id }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "send-attachment", {
          agent,
          file_path,
          message,
          channel_id,
        })) as { ok: boolean; agent: string; channel: string; file: string };

        return {
          content: [{ type: "text" as const, text: `File sent to channel ${result.channel}: ${result.file}` }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Failed to send attachment: ${msg}` }] };
      }
    },
  );

  // Tool: send_to_agent
  server.tool(
    "send_to_agent",
    "Send a message to another agent via their Discord channel",
    {
      from: z.string().describe("Your agent name (pass your own name)"),
      to: z.string().describe("Target agent name"),
      message: z.string().describe("Message content to send"),
    },
    async ({ from, to, message }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "send-to-agent", {
          from,
          to,
          message,
        })) as { delivered: boolean; messageId: string };
        return {
          content: [
            {
              type: "text" as const,
              text: result.delivered
                ? `Message delivered to ${to} (id: ${result.messageId})`
                : `Message queued for ${to} (id: ${result.messageId})`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: "text" as const, text: `Failed to send to ${to}: ${msg}` },
          ],
        };
      }
    },
  );

  // Tool: ingest_document
  server.tool(
    "ingest_document",
    "Ingest a document from your workspace for RAG search (supports .txt, .md, .pdf)",
    {
      agent: z.string().describe("Your agent name"),
      file_path: z.string().describe("Absolute path to the document file"),
      source: z.string().optional().describe("Custom source identifier (defaults to file path)"),
    },
    async ({ agent, file_path, source }) => {
      try {
        const result = await sendIpcRequest(SOCKET_PATH, "ingest-document", {
          agent, file_path, source,
        });
        const r = result as { ok: boolean; source: string; chunks_created: number; total_chars: number };
        return {
          content: [{ type: "text" as const, text: `Ingested "${r.source}": ${r.chunks_created} chunks (${r.total_chars} chars)` }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Ingest failed: ${msg}` }] };
      }
    },
  );

  // Tool: search_documents
  server.tool(
    "search_documents",
    "Search across ingested documents for relevant content",
    {
      agent: z.string().describe("Your agent name"),
      query: z.string().describe("Search query"),
      limit: z.number().int().min(1).max(20).default(5).describe("Max results (default 5)"),
      source: z.string().optional().describe("Filter to a specific document source"),
    },
    async ({ agent, query, limit, source }) => {
      const result = await sendIpcRequest(SOCKET_PATH, "search-documents", {
        agent, query, limit, source,
      });
      const r = result as { results: readonly { chunk_id: string; source: string; chunk_index: number; content: string; similarity: number; context_before: string | null; context_after: string | null }[] };
      if (r.results.length === 0) {
        return { content: [{ type: "text" as const, text: "No matching documents found." }] };
      }
      const formatted = r.results.map((hit, i) => {
        const parts = [
          `--- Result ${i + 1} (similarity: ${hit.similarity.toFixed(3)}) ---`,
          `Source: ${hit.source} [chunk ${hit.chunk_index}]`,
        ];
        if (hit.context_before) parts.push(`[...] ${hit.context_before}`);
        parts.push(hit.content);
        if (hit.context_after) parts.push(`${hit.context_after} [...]`);
        return parts.join("\n");
      }).join("\n\n");
      return { content: [{ type: "text" as const, text: formatted }] };
    },
  );

  // Tool: delete_document
  server.tool(
    "delete_document",
    "Delete all chunks for an ingested document",
    {
      agent: z.string().describe("Your agent name"),
      source: z.string().describe("Document source identifier to delete"),
    },
    async ({ agent, source }) => {
      try {
        const result = await sendIpcRequest(SOCKET_PATH, "delete-document", { agent, source });
        const r = result as { ok: boolean; source: string; chunks_deleted: number };
        return {
          content: [{ type: "text" as const, text: `Deleted "${r.source}": ${r.chunks_deleted} chunks removed` }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Delete failed: ${msg}` }] };
      }
    },
  );

  // Tool: list_documents
  server.tool(
    "list_documents",
    "List all ingested document sources and total chunk count",
    {
      agent: z.string().describe("Your agent name"),
    },
    async ({ agent }) => {
      const result = await sendIpcRequest(SOCKET_PATH, "list-documents", { agent });
      const r = result as { sources: readonly string[]; total_chunks: number };
      if (r.sources.length === 0) {
        return { content: [{ type: "text" as const, text: "No documents ingested." }] };
      }
      const text = [`Documents (${r.total_chunks} total chunks):`, ...r.sources.map(s => `  - ${s}`)].join("\n");
      return { content: [{ type: "text" as const, text }] };
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
