import type { Command } from "commander";
import { sendIpcRequest } from "../../ipc/client.js";
import { SOCKET_PATH } from "../../manager/daemon.js";
import { ManagerNotRunningError } from "../../shared/errors.js";
import { cliLog, cliError } from "../output.js";

/**
 * A single memory search result from the IPC response.
 */
type SearchResultEntry = {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly importance: number;
  readonly accessCount: number;
  readonly tier: string;
  readonly createdAt: string;
  readonly score: number;
  readonly distance: number;
};

/**
 * Shape of the "memory-search" IPC response.
 */
type MemorySearchResponse = {
  readonly results: readonly SearchResultEntry[];
};

/**
 * A single memory list entry from the IPC response.
 */
type MemoryListEntry = {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly importance: number;
  readonly accessCount: number;
  readonly tier: string;
  readonly createdAt: string;
  readonly accessedAt: string;
};

/**
 * Shape of the "memory-list" IPC response.
 */
type MemoryListResponse = {
  readonly entries: readonly MemoryListEntry[];
};

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 */
function truncate(text: string, maxLen: number): string {
  const singleLine = text.replace(/\n/g, " ").trim();
  if (singleLine.length <= maxLen) {
    return singleLine;
  }
  return singleLine.slice(0, maxLen) + "...";
}

/**
 * Format memory search results as a table.
 *
 * @param data - The memory-search IPC response
 * @returns Formatted table string
 */
export function formatSearchResults(data: MemorySearchResponse): string {
  if (data.results.length === 0) {
    return "No results found";
  }

  const rows = data.results.map((r, i) => ({
    rank: String(i + 1),
    score: r.score.toFixed(3),
    content: truncate(r.content, 60),
    source: r.source,
    tier: r.tier,
    importance: r.importance.toFixed(2),
    created: r.createdAt.slice(0, 10),
  }));

  const rankWidth = 4;
  const scoreWidth = 6;
  const contentWidth = Math.max(7, ...rows.map((r) => r.content.length));
  const sourceWidth = Math.max(6, ...rows.map((r) => r.source.length));
  const tierWidth = 4;
  const impWidth = 4;
  const dateWidth = 10;

  const header = [
    "#".padEnd(rankWidth),
    "SCORE".padEnd(scoreWidth),
    "CONTENT".padEnd(contentWidth),
    "SOURCE".padEnd(sourceWidth),
    "TIER".padEnd(tierWidth),
    "IMP".padEnd(impWidth),
    "CREATED".padEnd(dateWidth),
  ].join("  ");

  const separator = "-".repeat(
    rankWidth + scoreWidth + contentWidth + sourceWidth + tierWidth + impWidth + dateWidth + 12,
  );

  const formatted = rows.map((row) =>
    [
      row.rank.padEnd(rankWidth),
      row.score.padEnd(scoreWidth),
      row.content.padEnd(contentWidth),
      row.source.padEnd(sourceWidth),
      row.tier.padEnd(tierWidth),
      row.importance.padEnd(impWidth),
      row.created.padEnd(dateWidth),
    ].join("  "),
  );

  return ["Memory Search Results", "", header, separator, ...formatted].join("\n");
}

/**
 * Format memory list entries as a table.
 *
 * @param data - The memory-list IPC response
 * @returns Formatted table string
 */
export function formatMemoryList(data: MemoryListResponse): string {
  if (data.entries.length === 0) {
    return "No memories found";
  }

  const rows = data.entries.map((e) => ({
    id: e.id.slice(0, 8),
    content: truncate(e.content, 50),
    tier: e.tier,
    importance: e.importance.toFixed(2),
    accesses: String(e.accessCount),
    accessed: e.accessedAt.slice(0, 10),
  }));

  const idWidth = 8;
  const contentWidth = Math.max(7, ...rows.map((r) => r.content.length));
  const tierWidth = 4;
  const impWidth = 4;
  const accessWidth = 7;
  const dateWidth = 10;

  const header = [
    "ID".padEnd(idWidth),
    "CONTENT".padEnd(contentWidth),
    "TIER".padEnd(tierWidth),
    "IMP".padEnd(impWidth),
    "ACCESSES".padEnd(accessWidth),
    "ACCESSED".padEnd(dateWidth),
  ].join("  ");

  const separator = "-".repeat(
    idWidth + contentWidth + tierWidth + impWidth + accessWidth + dateWidth + 10,
  );

  const formatted = rows.map((row) =>
    [
      row.id.padEnd(idWidth),
      row.content.padEnd(contentWidth),
      row.tier.padEnd(tierWidth),
      row.importance.padEnd(impWidth),
      row.accesses.padEnd(accessWidth),
      row.accessed.padEnd(dateWidth),
    ].join("  "),
  );

  return ["Agent Memories", "", header, separator, ...formatted].join("\n");
}

/**
 * Register the `clawcode memory` command group.
 * Includes `memory search` and `memory list` subcommands.
 */
export function registerMemoryCommand(program: Command): void {
  const memoryCmd = program
    .command("memory")
    .description("Search and browse agent memory");

  memoryCmd
    .command("search <agent> <query>")
    .description("Semantic search an agent's memory")
    .option("--top-k <n>", "Number of results", "10")
    .action(async (agent: string, query: string, opts: { topK: string }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "memory-search", {
          agent,
          query,
          topK: parseInt(opts.topK, 10),
        })) as MemorySearchResponse;
        cliLog(formatSearchResults(result));
      } catch (error) {
        if (error instanceof ManagerNotRunningError) {
          cliError("Manager is not running. Start it with: clawcode start-all");
          process.exit(1);
          return;
        }
        const msg = error instanceof Error ? error.message : String(error);
        cliError(`Error: ${msg}`);
        process.exit(1);
      }
    });

  memoryCmd
    .command("list <agent>")
    .description("List recent memories for an agent")
    .option("--limit <n>", "Number of entries", "20")
    .action(async (agent: string, opts: { limit: string }) => {
      try {
        const result = (await sendIpcRequest(SOCKET_PATH, "memory-list", {
          agent,
          limit: parseInt(opts.limit, 10),
        })) as MemoryListResponse;
        cliLog(formatMemoryList(result));
      } catch (error) {
        if (error instanceof ManagerNotRunningError) {
          cliError("Manager is not running. Start it with: clawcode start-all");
          process.exit(1);
          return;
        }
        const msg = error instanceof Error ? error.message : String(error);
        cliError(`Error: ${msg}`);
        process.exit(1);
      }
    });
}
