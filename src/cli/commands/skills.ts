import type { Command } from "commander";
import { sendIpcRequest } from "../../ipc/client.js";
import { SOCKET_PATH } from "../../manager/daemon.js";
import { ManagerNotRunningError } from "../../shared/errors.js";

/**
 * A single skill catalog entry from the IPC response.
 */
type SkillCatalogEntry = {
  readonly name: string;
  readonly description: string;
  readonly version: string | null;
  readonly path: string;
};

/**
 * Shape of the "skills" IPC response.
 */
type SkillsResponse = {
  readonly catalog: readonly SkillCatalogEntry[];
  readonly assignments: Record<string, readonly string[]>;
};

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.slice(0, maxLen) + "...";
}

/**
 * Format skills IPC response as a table.
 * Columns: SKILL, VERSION, DESCRIPTION, AGENTS
 *
 * @param data - The skills IPC response
 * @returns Formatted table string
 */
export function formatSkillsTable(data: SkillsResponse): string {
  if (data.catalog.length === 0) {
    return "No skills registered";
  }

  // Build row data
  type Row = {
    readonly skill: string;
    readonly version: string;
    readonly description: string;
    readonly agents: string;
  };

  const rows: readonly Row[] = data.catalog.map((entry) => {
    // Find agents that have this skill assigned
    const assignedAgents: string[] = [];
    for (const [agentName, skills] of Object.entries(data.assignments)) {
      if (skills.includes(entry.name)) {
        assignedAgents.push(agentName);
      }
    }

    return {
      skill: entry.name,
      version: entry.version ?? "-",
      description: truncate(entry.description, 50),
      agents: assignedAgents.length > 0 ? assignedAgents.join(", ") : "-",
    };
  });

  // Calculate column widths dynamically
  const skillWidth = Math.max(5, ...rows.map((r) => r.skill.length));
  const versionWidth = Math.max(7, ...rows.map((r) => r.version.length));
  const descWidth = Math.max(11, ...rows.map((r) => r.description.length));
  const agentsWidth = Math.max(6, ...rows.map((r) => r.agents.length));

  // Header
  const header = [
    "SKILL".padEnd(skillWidth),
    "VERSION".padEnd(versionWidth),
    "DESCRIPTION".padEnd(descWidth),
    "AGENTS".padEnd(agentsWidth),
  ].join("  ");

  const separator = "-".repeat(
    skillWidth + versionWidth + descWidth + agentsWidth + 6,
  );

  // Format rows
  const formattedRows = rows.map((row) =>
    [
      row.skill.padEnd(skillWidth),
      row.version.padEnd(versionWidth),
      row.description.padEnd(descWidth),
      row.agents.padEnd(agentsWidth),
    ].join("  "),
  );

  return [header, separator, ...formattedRows].join("\n");
}

/**
 * Register the `clawcode skills` command.
 * Sends a "skills" IPC request and displays a formatted table.
 */
export function registerSkillsCommand(program: Command): void {
  program
    .command("skills")
    .description("Show available skills and agent assignments")
    .action(async () => {
      try {
        const result = (await sendIpcRequest(
          SOCKET_PATH,
          "skills",
          {},
        )) as SkillsResponse;
        console.log(formatSkillsTable(result));
      } catch (error) {
        if (error instanceof ManagerNotRunningError) {
          console.error(
            "Manager is not running. Start it with: clawcode start-all",
          );
          process.exit(1);
          return;
        }
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
