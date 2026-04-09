import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Maximum word count for a context summary to avoid bloating system prompts. */
const DEFAULT_MAX_WORDS = 500;

/** Filename for the persisted context summary. */
const SUMMARY_FILENAME = "context-summary.md";

/**
 * A persisted context summary from a compaction event.
 */
export type ContextSummary = {
  readonly agentName: string;
  readonly summary: string;
  readonly createdAt: string;
};

/**
 * Truncate a summary to a maximum word count.
 * Preserves full words -- does not split mid-word.
 *
 * @param text - The summary text to truncate
 * @param maxWords - Maximum number of words (default 500)
 * @returns Truncated text, with "..." appended if truncated
 */
export function truncateSummary(
  text: string,
  maxWords: number = DEFAULT_MAX_WORDS,
): string {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= maxWords) {
    return text;
  }
  return words.slice(0, maxWords).join(" ") + "...";
}

/**
 * Save a context summary to the agent's memory directory.
 * Overwrites any existing summary (only latest is relevant).
 * Creates the directory if it doesn't exist.
 *
 * @param memoryDir - Path to the agent's memory directory
 * @param agentName - Name of the agent
 * @param summary - The summary text from compaction
 */
export async function saveSummary(
  memoryDir: string,
  agentName: string,
  summary: string,
): Promise<void> {
  await mkdir(memoryDir, { recursive: true });

  const truncated = truncateSummary(summary);
  const content = [
    `# Context Summary`,
    ``,
    `**Agent:** ${agentName}`,
    `**Generated:** ${new Date().toISOString()}`,
    ``,
    truncated,
    ``,
  ].join("\n");

  await writeFile(join(memoryDir, SUMMARY_FILENAME), content, "utf-8");
}

/**
 * Load the latest context summary from the agent's memory directory.
 * Returns the summary text (without the metadata header), or undefined
 * if no summary file exists.
 *
 * @param memoryDir - Path to the agent's memory directory
 * @returns The summary text, or undefined
 */
export async function loadLatestSummary(
  memoryDir: string,
): Promise<string | undefined> {
  try {
    const content = await readFile(
      join(memoryDir, SUMMARY_FILENAME),
      "utf-8",
    );

    // Extract just the summary body (after the metadata header)
    // Format: # Context Summary\n\n**Agent:**...\n**Generated:**...\n\n<body>
    const lines = content.split("\n");
    // Skip header: find the line after **Generated:** and the following blank line
    let bodyStartIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("**Generated:**")) {
        // Skip the blank line after Generated
        bodyStartIndex = i + 2;
        break;
      }
    }

    const body = lines.slice(bodyStartIndex).join("\n").trim();
    return body.length > 0 ? body : undefined;
  } catch {
    return undefined;
  }
}
