import type { Command } from "commander";
import { sendIpcRequest } from "../../ipc/client.js";
import { SOCKET_PATH } from "../../manager/daemon.js";
import { ManagerNotRunningError } from "../../shared/errors.js";

/**
 * A single webhook entry from the IPC response.
 */
type WebhookEntry = {
  readonly agent: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  readonly hasWebhookUrl: boolean;
};

/**
 * Shape of the "webhooks" IPC response.
 */
type WebhooksResponse = {
  readonly webhooks: readonly WebhookEntry[];
};

/**
 * Format webhooks IPC response as a table.
 *
 * @param data - The webhooks IPC response
 * @returns Formatted table string
 */
export function formatWebhooksTable(data: WebhooksResponse): string {
  if (data.webhooks.length === 0) {
    return "No webhook identities configured";
  }

  type Row = {
    readonly agent: string;
    readonly displayName: string;
    readonly avatar: string;
    readonly status: string;
  };

  const rows: readonly Row[] = data.webhooks.map((entry) => ({
    agent: entry.agent,
    displayName: entry.displayName,
    avatar: entry.avatarUrl ? "yes" : "no",
    status: entry.hasWebhookUrl ? "active" : "no url",
  }));

  const agentWidth = Math.max(5, ...rows.map((r) => r.agent.length));
  const nameWidth = Math.max(12, ...rows.map((r) => r.displayName.length));
  const avatarWidth = 6;
  const statusWidth = 6;

  const header = [
    "AGENT".padEnd(agentWidth),
    "DISPLAY NAME".padEnd(nameWidth),
    "AVATAR".padEnd(avatarWidth),
    "STATUS".padEnd(statusWidth),
  ].join("  ");

  const separator = "-".repeat(agentWidth + nameWidth + avatarWidth + statusWidth + 6);

  const formattedRows = rows.map((row) =>
    [
      row.agent.padEnd(agentWidth),
      row.displayName.padEnd(nameWidth),
      row.avatar.padEnd(avatarWidth),
      row.status.padEnd(statusWidth),
    ].join("  "),
  );

  return ["Webhook Identities", "", header, separator, ...formattedRows].join("\n");
}

/**
 * Register the `clawcode webhooks` command.
 * Sends a "webhooks" IPC request and displays a formatted table.
 */
export function registerWebhooksCommand(program: Command): void {
  program
    .command("webhooks")
    .description("Show configured webhook identities")
    .action(async () => {
      try {
        const result = (await sendIpcRequest(
          SOCKET_PATH,
          "webhooks",
          {},
        )) as WebhooksResponse;
        console.log(formatWebhooksTable(result));
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
