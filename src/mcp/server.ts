import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { sendIpcRequest } from "../ipc/client.js";
import { SOCKET_PATH } from "../manager/daemon.js";
import { IDEMPOTENT_TOOL_DEFAULTS } from "../config/schema.js";
import type { Turn } from "../performance/trace-collector.js";

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
  read_thread: {
    description: "Read recent messages from a Discord thread (your subagent's work)",
    ipcMethod: "read-thread",
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
  // Cross-agent RPC / handoffs (Phase 59)
  delegate_task: {
    description: "Delegate a typed task to another agent. Returns a task_id immediately; the result arrives as a new turn. Prefer over send_to_agent when you need a structured, schema-validated payload with deadline + cost attribution.",
    ipcMethod: "delegate-task",
  },
  task_status: {
    description: "Check the status of a delegated task by task_id.",
    ipcMethod: "task-status",
  },
  cancel_task: {
    description: "Cancel an in-flight delegated task by task_id.",
    ipcMethod: "cancel-task",
  },
  task_complete: {
    description: "Signal completion of a delegated task you received. Provide the structured result matching the schema's output shape. Call this at the END of your turn -- the daemon dispatches the result back to the caller.",
    ipcMethod: "task-complete",
  },
} as const;

/**
 * Phase 55 Plan 02 — per-agent tools config shape threaded through
 * `createMcpServer`. Mirrors `ResolvedAgentConfig.perf.tools` verbatim but
 * the whole block is optional (no agent context over stdio MCP transport).
 *
 * Inline type (no cross-module import of ToolsConfig from schema.ts) to
 * preserve server.ts's low-dep boundary.
 */
export type McpPerfTools = {
  readonly maxConcurrent: number;
  readonly idempotent: readonly string[];
  readonly slos?: Readonly<Record<string, {
    readonly thresholdMs: number;
    readonly metric?: "p50" | "p95" | "p99";
  }>>;
};

/**
 * Phase 55 Plan 02 — dependency-injection hooks for the cache wrapper.
 *
 * When `deps` is provided (daemon-hosted MCP path, where an active Turn is
 * available), the wrapped handlers consult `getActiveTurn()` to attach
 * cache lookups and `getAgentPerfTools()` to read the idempotent whitelist.
 *
 * When `deps` is undefined (stdio `clawcode mcp` path — no agent context),
 * the wrapper short-circuits to the legacy non-cached handler path. This
 * preserves backward compatibility with existing MCP clients.
 */
export type McpServerDeps = {
  readonly getActiveTurn?: (agentName: string) => Turn | null;
  readonly getAgentPerfTools?: (agentName: string) => McpPerfTools | undefined;
  /**
   * Phase 55 v1.7 cleanup — per-agent concurrency gate for capping in-flight
   * tool dispatches at `perf.tools.maxConcurrent`. When absent, no gate is
   * applied (concurrency is whatever the SDK/runtime dispatches).
   *
   * The gate's release function is returned from acquire — callers MUST call
   * it in a `finally` block to avoid leaks.
   */
  readonly acquireToolSlot?: (
    agentName: string,
  ) => Promise<() => void>;
};

/**
 * Cross-cutting helper — wrap a raw IPC handler with per-turn cache lookup
 * for whitelisted idempotent tools.
 *
 * Flow:
 *   1. If `deps` is absent OR no active Turn — run raw, no cache.
 *   2. Resolve whitelist from `perfTools.idempotent` ?? IDEMPOTENT_TOOL_DEFAULTS.
 *   3. If tool is whitelisted AND Turn.toolCache has a hit — return frozen
 *      cached value (raw handler NEVER runs).
 *   4. Else run raw handler. On SUCCESS + whitelisted — write to cache.
 *      On FAILURE — propagate; cache stays empty so retries re-run.
 *
 * Span metadata enrichment (`cached: true`) is performed by session-adapter
 * via hitCount delta detection — the wrapper has no direct span handle
 * because MCP handlers don't receive tool_use_id.
 *
 * Exported for direct unit-testing (see src/mcp/server.test.ts Phase 55
 * describe block).
 */
export async function invokeWithCache<R>(
  toolName: string,
  agentName: string,
  args: unknown,
  rawCall: () => Promise<R>,
  deps: McpServerDeps | undefined,
): Promise<R> {
  if (!deps?.getActiveTurn) return invokeWithConcurrencyGate(agentName, rawCall, deps);
  const turn = deps.getActiveTurn(agentName);
  if (!turn) return invokeWithConcurrencyGate(agentName, rawCall, deps);

  const perfTools = deps.getAgentPerfTools?.(agentName);
  const idempotent = perfTools?.idempotent ?? IDEMPOTENT_TOOL_DEFAULTS;
  const isIdempotent = idempotent.includes(toolName);

  if (isIdempotent) {
    const cached = turn.toolCache.get(toolName, args);
    if (cached !== undefined) {
      // Cache hit: no raw call, no concurrency slot needed
      return cached as R;
    }
  }

  const result = await invokeWithConcurrencyGate(agentName, rawCall, deps);
  if (isIdempotent) {
    turn.toolCache.set(toolName, args, result);
  }
  return result;
}

/**
 * Phase 55 v1.7 cleanup — gate a raw tool call through the per-agent
 * `ConcurrencyGate` when one is wired via `McpServerDeps.acquireToolSlot`.
 *
 * When `deps.acquireToolSlot` is undefined (stdio MCP path, or daemon running
 * without the gate hook), falls through to the raw call with no gating.
 *
 * The release function is called in a `finally` block so exceptions never
 * leak slots.
 */
async function invokeWithConcurrencyGate<R>(
  agentName: string,
  rawCall: () => Promise<R>,
  deps: McpServerDeps | undefined,
): Promise<R> {
  if (!deps?.acquireToolSlot) return rawCall();
  const release = await deps.acquireToolSlot(agentName);
  try {
    return await rawCall();
  } finally {
    release();
  }
}

/**
 * Create and configure the ClawCode MCP server.
 * Tools delegate to the daemon via the IPC client.
 *
 * Phase 55 Plan 02 — optional `deps` hooks thread per-agent Turn + perf.tools
 * config into the 4 whitelisted tool handlers (memory_lookup, search_documents,
 * memory_list, memory_graph — the latter two are not yet registered, but the
 * whitelist includes them for future-proofing). Non-whitelisted tools bypass
 * the cache unconditionally.
 *
 * @param deps Optional dependency-injection hooks. When absent (e.g. stdio
 *             MCP startMcpServer path), the wrapper falls back to the raw
 *             non-cached handler path.
 * @returns Configured McpServer ready for transport connection
 */
export function createMcpServer(deps?: McpServerDeps): McpServer {
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
        schedules: readonly { agentName: string; name: string; cron: string; enabled: boolean; nextRun: string | null }[];
      };

      if (result.schedules.length === 0) {
        return { content: [{ type: "text" as const, text: "No scheduled tasks" }] };
      }

      const text = result.schedules
        .map((s) => `${s.agentName}/${s.name}: ${s.cron} (${s.enabled ? "enabled" : "disabled"})${s.nextRun ? ` next: ${s.nextRun}` : ""}`)
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

  // Tool: read_thread
  server.tool(
    "read_thread",
    "Read recent messages from a Discord thread. Use this after spawning a subagent with spawn_subagent_thread to see what it has posted. Returns messages oldest-first.",
    {
      threadId: z.string().describe("Discord thread ID (from spawn_subagent_thread result)"),
      limit: z.number().int().min(1).max(100).default(20).describe("Max messages to return (1-100, default 20)"),
    },
    async ({ threadId, limit }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "read-thread", {
          threadId,
          limit,
        })) as {
          threadId: string;
          threadName: string | null;
          messageCount: number;
          messages: ReadonlyArray<{
            id: string;
            author: string;
            bot: boolean;
            webhookId: string | null;
            content: string;
            embedFooter: string | null;
            createdAt: string;
            attachmentCount: number;
          }>;
        };
        if (result.messages.length === 0) {
          return { content: [{ type: "text" as const, text: `Thread '${result.threadName ?? result.threadId}' has no messages yet.` }] };
        }
        const header = `Thread: ${result.threadName ?? result.threadId} (${result.messageCount} messages)\n${"─".repeat(60)}`;
        const body = result.messages.map((m) => {
          const who = m.embedFooter ?? (m.bot ? `${m.author} [bot]` : m.author);
          const ts = m.createdAt.slice(0, 19).replace("T", " ");
          const attach = m.attachmentCount > 0 ? `  [${m.attachmentCount} attachment${m.attachmentCount === 1 ? "" : "s"}]` : "";
          return `[${ts}] ${who}:${attach}\n${m.content}`;
        }).join("\n\n");
        return { content: [{ type: "text" as const, text: `${header}\n${body}` }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Failed to read thread: ${msg}` }], isError: true };
      }
    },
  );

  // Tool: memory_lookup
  //
  // Phase 55 Plan 02 — WHITELISTED IDEMPOTENT TOOL. Handler body runs through
  // `invokeWithCache` so a duplicate invocation within the same Turn returns
  // the frozen cached response without a second IPC round-trip.
  server.tool(
    "memory_lookup",
    "Search your memory for relevant context, past decisions, and knowledge. " +
      "Use scope='conversations' to search older Discord conversation history " +
      "(session summaries + raw turns via FTS5) when the auto-injected resume brief " +
      "is insufficient. Use scope='all' to search both memories and conversations. " +
      "Results are paginated (max 10 per page); call again with page+1 if hasMore is true. " +
      "Note: if new conversation turns are recorded between page requests, pagination " +
      "boundaries may shift — re-issue with page 0 if strict consistency is required.",
    {
      query: z.string().describe("What to search for in memory"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Max results per page (1-10, hard cap at 10)"),
      agent: z.string().describe("Your agent name (pass your own name)"),
      scope: z
        .enum(["memories", "conversations", "all"])
        .default("memories")
        .describe(
          "What to search: 'memories' (default, matches pre-v1.9 behavior), " +
            "'conversations' (session summaries + raw turns), or 'all' (both).",
        ),
      page: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe(
          "Zero-based page index for pagination (default 0). " +
            "Response includes hasMore + nextOffset if more results exist.",
        ),
    },
    async ({ query, limit, agent, scope, page }) => {
      return invokeWithCache(
        "memory_lookup",
        agent,
        // Include scope+page in the per-Turn cache key so an earlier
        // scope='memories' call does not serve a stale response to a later
        // scope='all' request in the same Turn.
        { query, limit, scope, page },
        async () => {
          const result = (await sendIpcRequest(SOCKET_PATH, "memory-lookup", {
            agent,
            query,
            limit,
            scope,
            page,
          })) as {
            results: readonly Record<string, unknown>[];
            hasMore?: boolean;
            nextOffset?: number | null;
          };

          // Legacy call path (scope='memories' && page=0) returns
          // { results: [...] } WITHOUT hasMore/nextOffset. New call paths
          // return the full paginated envelope. Pass through whichever
          // shape the daemon produced — the agent reads the fields the
          // response contains.
          const payload =
            result.hasMore !== undefined
              ? {
                  results: result.results,
                  hasMore: result.hasMore,
                  nextOffset: result.nextOffset ?? null,
                }
              : result.results;

          return {
            content: [
              { type: "text" as const, text: JSON.stringify(payload, null, 2) },
            ],
          };
        },
        deps,
      );
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
  //
  // Phase 55 Plan 02 — WHITELISTED IDEMPOTENT TOOL. Handler body runs through
  // `invokeWithCache` so identical searches within the same Turn return the
  // frozen cached response without a second IPC round-trip.
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
      return invokeWithCache(
        "search_documents",
        agent,
        { query, limit, source },
        async () => {
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
        deps,
      );
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

  // -------------------------------------------------------------------------
  // Cross-agent RPC / handoffs (Phase 59)
  // -------------------------------------------------------------------------

  // Tool: delegate_task
  server.tool(
    "delegate_task",
    "Delegate a typed task to another agent. Returns task_id immediately; the result arrives as a new turn.",
    {
      caller: z.string().describe("Your agent name"),
      target: z.string().describe("Target agent name"),
      schema: z.string().describe("Task schema name (e.g. 'research.brief')"),
      payload: z.record(z.string(), z.unknown()).describe("Task input payload matching the named schema"),
      deadline_ms: z.number().int().positive().optional().describe("Absolute wall-clock deadline (ms since epoch)"),
      budgetOwner: z.string().optional().describe("Override budget attribution (default: caller)"),
      parent_task_id: z.string().optional().describe("For nested handoffs; omit for root delegations"),
    },
    async ({ caller, target, schema, payload, deadline_ms, budgetOwner, parent_task_id }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "delegate-task", {
          caller, target, schema, payload, deadline_ms, budgetOwner, parent_task_id,
        })) as { task_id: string };
        return { content: [{ type: "text" as const, text: JSON.stringify({ task_id: result.task_id }) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Delegate failed: ${msg}` }] };
      }
    },
  );

  // Tool: task_status
  server.tool(
    "task_status",
    "Check the status of a delegated task.",
    { task_id: z.string().describe("Task id returned by delegate_task") },
    async ({ task_id }) => {
      try {
        const result = await sendIpcRequest(SOCKET_PATH, "task-status", { task_id });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Status failed: ${msg}` }] };
      }
    },
  );

  // Tool: cancel_task
  server.tool(
    "cancel_task",
    "Cancel an in-flight delegated task.",
    {
      task_id: z.string().describe("Task id to cancel"),
      caller: z.string().describe("Your agent name (for audit trail)"),
    },
    async ({ task_id, caller }) => {
      try {
        await sendIpcRequest(SOCKET_PATH, "cancel-task", { task_id, caller });
        return { content: [{ type: "text" as const, text: `Task ${task_id} cancelled` }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Cancel failed: ${msg}` }] };
      }
    },
  );

  // Tool: task_complete
  server.tool(
    "task_complete",
    "Signal completion of a delegated task with a structured result. Call this at the END of your turn.",
    {
      task_id: z.string().describe("Task id you received as the delegated task"),
      result: z.record(z.string(), z.unknown()).describe("Structured result matching the schema's output shape"),
      chain_token_cost: z.number().int().min(0).optional().describe("Tokens consumed during this task's execution"),
    },
    async ({ task_id, result, chain_token_cost }) => {
      try {
        await sendIpcRequest(SOCKET_PATH, "task-complete", { task_id, result, chain_token_cost });
        return { content: [{ type: "text" as const, text: `Task ${task_id} completed` }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Complete failed: ${msg}` }] };
      }
    },
  );

  // Phase 94 Plan 05 TOOL-08 / D-08 — built-in Discord message fetcher
  // (Gap 3 closure). Forwards to the daemon's fetch-discord-messages IPC,
  // where the discord.js client + channel/thread fetch lives. Auto-injected
  // into every agent's tool list because the clawcode MCP server is auto-
  // injected. Pure dispatch wrapper — handler logic + production deps are
  // bound at the daemon edge (src/manager/tools/clawcode-fetch-discord-messages.ts
  // accepts deps; the IPC handler wires discord.js client.channels.fetch).
  server.tool(
    "clawcode_fetch_discord_messages",
    "Fetch the most recent messages from a Discord channel or thread (Discord treats threads as channels). " +
      "Use channel_id for either. Limit defaults to 50, max 100. " +
      "Use before=<message_id> to page back further when N > 100 needed.",
    {
      channel_id: z.string().describe("Discord channel or thread ID (snowflake)"),
      limit: z.number().int().min(1).max(100).default(50).describe(
        "Number of messages to fetch (1-100; default 50)",
      ),
      before: z
        .string()
        .optional()
        .describe("Message snowflake — fetch messages older than this ID"),
    },
    async ({ channel_id, limit, before }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "fetch-discord-messages", {
          channel_id,
          limit,
          ...(before !== undefined ? { before } : {}),
        })) as {
          messages: ReadonlyArray<{
            id: string;
            author: string;
            content: string;
            ts: string;
            attachments: ReadonlyArray<{ filename: string; url: string }>;
          }>;
        };
        // Return as JSON text so the LLM can read the full structure.
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Failed to fetch messages: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );

  // Phase 94 Plan 05 TOOL-09 / D-09 — built-in file-share helper (Gap 3
  // closure). Forwards to the daemon's share-file IPC, where the
  // discord.js bot-direct upload + 25MB cap + allowedRoots enforcement
  // live. Auto-injected into every agent's tool list because the
  // clawcode MCP server is auto-injected.
  server.tool(
    "clawcode_share_file",
    "Upload a file from the agent's workspace to the Discord channel/thread the agent is currently answering in. " +
      "Returns the CDN URL the user can click. " +
      "Use this WHENEVER the user wants a file — never tell the user a local path " +
      "(e.g. /home/clawcode/...). " +
      "Path must be absolute and inside the agent's workspace or memory directory.",
    {
      agent: z.string().describe("Your agent name (pass your own name)"),
      path: z
        .string()
        .describe("Absolute path inside agent workspace or memoryPath"),
      caption: z
        .string()
        .optional()
        .describe("Optional caption sent alongside the file"),
      channel_id: z
        .string()
        .optional()
        .describe(
          "Channel or thread ID for the upload destination. Defaults to the first configured channel for the agent.",
        ),
    },
    async ({ agent, path, caption, channel_id }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "share-file", {
          agent,
          path,
          ...(caption !== undefined ? { caption } : {}),
          ...(channel_id !== undefined ? { channel_id } : {}),
        })) as { url: string; filename: string; sizeBytes: number };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Failed to share file: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

/**
 * Start the MCP server with stdio transport.
 * This is the entry point for `clawcode mcp`.
 *
 * Phase 55 Plan 02 — stdio transport has no agent context, so we omit
 * `deps`. Whitelisted-tool wrappers fall back to the raw handler path;
 * no intra-turn caching occurs on this path (correct: stdio MCP clients
 * are external — they are not inside a ClawCode Turn).
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
