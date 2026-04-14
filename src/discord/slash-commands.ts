/**
 * Slash command registration and interaction handling for Discord.
 *
 * Registers guild-scoped slash commands via Discord REST API on startup,
 * listens for interactions, routes them to agents, and replies with the response.
 */

import {
  Client,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type Interaction,
} from "discord.js";
import type { RoutingTable } from "./types.js";
import type { SessionManager } from "../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { SlashCommandDef } from "./slash-types.js";
import { DEFAULT_SLASH_COMMANDS, CONTROL_COMMANDS } from "./slash-types.js";
import { sendIpcRequest } from "../ipc/client.js";
import { SOCKET_PATH } from "../manager/daemon.js";
import type { RegistryEntry } from "../manager/types.js";
import { getAgentForChannel } from "./router.js";
import { ProgressiveMessageEditor } from "./streaming.js";
import type { Logger } from "pino";
import { logger } from "../shared/logger.js";

/**
 * Maximum Discord message length (API limit).
 */
const DISCORD_MAX_LENGTH = 2000;

/**
 * Configuration for the SlashCommandHandler.
 */
export type SlashCommandHandlerConfig = {
  readonly routingTable: RoutingTable;
  readonly sessionManager: SessionManager;
  readonly resolvedAgents: readonly ResolvedAgentConfig[];
  readonly botToken: string;
  readonly client?: Client;
  readonly log?: Logger;
};

/**
 * Handles Discord slash command registration and interaction dispatch.
 *
 * On start(): connects a discord.js Client, registers guild-scoped commands
 * via the REST API, and listens for interactionCreate events.
 *
 * On stop(): removes the interaction listener and disconnects the client.
 */
export class SlashCommandHandler {
  private readonly routingTable: RoutingTable;
  private readonly sessionManager: SessionManager;
  private readonly resolvedAgents: readonly ResolvedAgentConfig[];
  private readonly botToken: string;
  private readonly log: Logger;
  private client: Client | null = null;
  private interactionHandler: ((interaction: Interaction) => void) | null = null;

  constructor(config: SlashCommandHandlerConfig) {
    this.routingTable = config.routingTable;
    this.sessionManager = config.sessionManager;
    this.resolvedAgents = config.resolvedAgents;
    this.botToken = config.botToken;
    this.client = config.client ?? null;
    this.log = config.log ?? logger;
  }

  /**
   * Start the handler: connect to Discord, register commands, listen for interactions.
   */
  async start(): Promise<void> {
    if (!this.client) {
      throw new Error("SlashCommandHandler requires a Discord client — cannot start without Discord bridge");
    }

    // Register commands for each guild
    await this.register();

    // Start listening for interactions
    this.interactionHandler = (interaction: Interaction) => {
      if (interaction.isChatInputCommand()) {
        void this.handleInteraction(interaction);
      }
    };
    this.client.on("interactionCreate", this.interactionHandler);

    this.log.info("slash command handler started");
  }

  /**
   * Register guild-scoped slash commands via Discord REST API.
   * Uses bulk overwrite (PUT) per guild to sync all commands at once.
   */
  async register(): Promise<void> {
    if (!this.client?.user) {
      throw new Error("Client not connected — call start() first");
    }

    const rest = new REST({ version: "10" }).setToken(this.botToken);
    const clientId = this.client.user.id;

    // Extract unique guild IDs from client cache
    const guildIds = [...this.client.guilds.cache.keys()];

    if (guildIds.length === 0) {
      this.log.warn("no guilds found in client cache — no commands registered");
      return;
    }

    for (const guildId of guildIds) {
      // Collect all commands across all agents for this guild
      const allCommands: SlashCommandDef[] = [];
      const seenNames = new Set<string>();

      for (const agent of this.resolvedAgents) {
        const agentCommands = resolveAgentCommands(agent.slashCommands);
        for (const cmd of agentCommands) {
          if (!seenNames.has(cmd.name)) {
            seenNames.add(cmd.name);
            allCommands.push(cmd);
          }
        }
      }

      // Add control commands (daemon-direct, not agent-routed)
      for (const cmd of CONTROL_COMMANDS) {
        if (!seenNames.has(cmd.name)) {
          seenNames.add(cmd.name);
          allCommands.push(cmd);
        }
      }

      // Convert to Discord API format
      const body = allCommands.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        options: cmd.options.map((opt) => ({
          name: opt.name,
          type: opt.type,
          description: opt.description,
          required: opt.required,
        })),
      }));

      try {
        await rest.put(
          Routes.applicationGuildCommands(clientId, guildId),
          { body },
        );
        this.log.info(
          { guildId, commandCount: body.length },
          "slash commands registered",
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.log.error({ guildId, error: msg }, "failed to register slash commands");
      }
    }
  }

  /**
   * Stop the handler: remove interaction listener and disconnect.
   * Per D-05, commands are left registered (Discord handles stale gracefully).
   */
  async stop(): Promise<void> {
    if (this.client && this.interactionHandler) {
      this.client.removeListener("interactionCreate", this.interactionHandler);
      this.interactionHandler = null;
    }

    // Client is shared with Discord bridge — do not destroy it here
    this.client = null;

    this.log.info("slash command handler stopped");
  }

  /**
   * Handle an incoming slash command interaction.
   * Routes to the correct agent by channel, defers reply for long-running execution.
   */
  private async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const channelId = interaction.channelId;
    const commandName = interaction.commandName;

    // Check if this is a control command (daemon-direct, no agent needed)
    const controlCmd = CONTROL_COMMANDS.find((c) => c.name === commandName);
    if (controlCmd) {
      await this.handleControlCommand(interaction, controlCmd);
      return;
    }

    // Look up agent for this channel
    const agentName = getAgentForChannel(this.routingTable, channelId);

    if (!agentName) {
      try {
        await interaction.reply({
          content: "This channel is not bound to an agent.",
          ephemeral: true,
        });
      } catch {
        // Interaction may have expired
      }
      return;
    }

    // Defer reply immediately (allows up to 15 min for response)
    try {
      await interaction.deferReply();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.error({ commandName, channelId, error: msg }, "failed to defer reply");
      return;
    }

    // Find the command definition for this agent
    const agentConfig = this.resolvedAgents.find((a) => a.name === agentName);
    const agentCommands = agentConfig
      ? resolveAgentCommands(agentConfig.slashCommands)
      : DEFAULT_SLASH_COMMANDS;
    const commandDef = agentCommands.find((c) => c.name === commandName);

    if (!commandDef) {
      try {
        await interaction.editReply(`Unknown command: /${commandName}`);
      } catch {
        // Interaction may have expired
      }
      return;
    }

    // Extract options from the interaction
    const options = new Map<string, string | number | boolean>();
    for (const opt of commandDef.options) {
      const value = interaction.options.get(opt.name);
      if (value !== null && value !== undefined) {
        // discord.js returns CommandInteractionOption; extract the value
        const raw = value.value;
        if (raw !== null && raw !== undefined) {
          options.set(opt.name, raw);
        }
      }
    }

    // Handle /effort directly — no need to route through the agent
    if (commandName === "clawcode-effort") {
      const level = options.get("level");
      const validLevels = ["low", "medium", "high", "max"];
      if (typeof level !== "string" || !validLevels.includes(level)) {
        try {
          await interaction.editReply(`Invalid effort level. Use: ${validLevels.join(", ")}`);
        } catch { /* expired */ }
        return;
      }
      try {
        this.sessionManager.setEffortForAgent(
          agentName,
          level as "low" | "medium" | "high" | "max",
        );
        await interaction.editReply(`Effort set to **${level}** for ${agentName}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await interaction.editReply(`Failed to set effort: ${msg}`);
      }
      return;
    }

    // Format the command message
    const formattedMessage = formatCommandMessage(commandDef, options);

    this.log.info(
      { agent: agentName, command: commandName, channelId },
      "routing slash command to agent",
    );

    // Show immediate "Thinking..." feedback
    try {
      await interaction.editReply("Thinking...");
    } catch {
      // Non-fatal: continue even if this edit fails
    }

    // Set up progressive editor for streaming updates
    const editor = new ProgressiveMessageEditor({
      editFn: async (content: string) => {
        const truncated = content.length > DISCORD_MAX_LENGTH
          ? content.slice(0, DISCORD_MAX_LENGTH - 3) + "..."
          : content;
        await interaction.editReply(truncated);
      },
      editIntervalMs: 1500,
    });

    try {
      // Stream from agent with progressive updates
      const response = await this.sessionManager.streamFromAgent(
        agentName,
        formattedMessage,
        (accumulated) => editor.update(accumulated),
      );

      await editor.flush();

      // Handle empty response
      const text = response.trim();
      if (text.length === 0) {
        await interaction.editReply("(No response from agent)");
        return;
      }

      // Final edit with complete (possibly truncated) text
      const truncated =
        text.length > DISCORD_MAX_LENGTH
          ? text.slice(0, DISCORD_MAX_LENGTH - 3) + "..."
          : text;

      await interaction.editReply(truncated);
    } catch (error) {
      editor.dispose();

      const msg = error instanceof Error ? error.message : String(error);
      this.log.error(
        { agent: agentName, command: commandName, error: msg },
        "slash command execution failed",
      );
      try {
        await interaction.editReply(`Command failed: ${msg}`);
      } catch {
        // Interaction may have expired
      }
    }
  }

  /**
   * Handle a control command by routing to the daemon via IPC.
   * Control commands defer with ephemeral (except fleet which is public)
   * and communicate directly with the daemon — no agent session involved.
   */
  private async handleControlCommand(
    interaction: ChatInputCommandInteraction,
    cmd: SlashCommandDef,
  ): Promise<void> {
    const isFleet = cmd.name === "clawcode-fleet";

    try {
      await interaction.deferReply({ ephemeral: !isFleet });
    } catch (error) {
      this.log.error(
        { command: cmd.name, error: (error as Error).message },
        "failed to defer control reply",
      );
      return;
    }

    const ipcMethod = cmd.ipcMethod ?? cmd.name;
    const agentName = interaction.options.getString("agent");

    try {
      if (isFleet) {
        const result = (await sendIpcRequest(SOCKET_PATH, "status", {})) as {
          entries: RegistryEntry[];
        };
        const embed = buildFleetEmbed(result.entries, this.resolvedAgents);
        await interaction.editReply({ embeds: [embed] });
      } else if (ipcMethod === "agent-create") {
        const name = interaction.options.getString("name");
        const soul = interaction.options.getString("soul");
        const model = interaction.options.getString("model") ?? undefined;
        if (!name || !soul) {
          await interaction.editReply("Both `name` and `soul` are required.");
          return;
        }
        const result = (await sendIpcRequest(SOCKET_PATH, "agent-create", {
          name,
          soul: soul.replaceAll("\\n", "\n"),
          model,
          parentChannelId: interaction.channelId,
          invokerUserId: interaction.user.id,
        })) as { name: string; model: string; channelId: string; channelUrl: string };
        await interaction.editReply(
          `Agent **${result.name}** created on \`${result.model}\`. Channel: ${result.channelUrl}`,
        );
      } else {
        if (!agentName) {
          await interaction.editReply("Agent name is required.");
          return;
        }
        await sendIpcRequest(SOCKET_PATH, ipcMethod, { name: agentName });
        const verb =
          ipcMethod === "start"
            ? "started"
            : ipcMethod === "stop"
              ? "stopped"
              : "restarted";
        await interaction.editReply(`Agent **${agentName}** ${verb}.`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.error(
        { command: cmd.name, agent: agentName, error: msg },
        "control command failed",
      );
      try {
        await interaction.editReply(`Command failed: ${msg}`);
      } catch {
        /* expired */
      }
    }
  }
}

/**
 * Format a slash command invocation into a message string for the agent.
 *
 * Replaces `{optionName}` placeholders in claudeCommand with the provided values.
 * Any options without a matching placeholder are appended as "key: value" lines.
 *
 * @param def - The slash command definition
 * @param options - Map of option name to value from the Discord interaction
 * @returns Formatted message string
 */
export function formatCommandMessage(
  def: SlashCommandDef,
  options: ReadonlyMap<string, string | number | boolean>,
): string {
  let message = def.claudeCommand;
  const unmatched: Array<[string, string | number | boolean]> = [];

  for (const [name, value] of options) {
    const placeholder = `{${name}}`;
    if (message.includes(placeholder)) {
      message = message.replaceAll(placeholder, String(value));
    } else {
      unmatched.push([name, value]);
    }
  }

  if (unmatched.length > 0) {
    const extra = unmatched.map(([k, v]) => `${k}: ${String(v)}`).join("\n");
    message = `${message}\n${extra}`;
  }

  return message;
}

/**
 * Resolve the full set of slash commands for an agent.
 *
 * Starts with DEFAULT_SLASH_COMMANDS and overrides any matching names
 * with the agent's custom commands. Returns the merged array.
 *
 * @param agentSlashCommands - Agent's custom slash commands (may be empty)
 * @returns Merged array with defaults + custom overrides
 */
export function resolveAgentCommands(
  agentSlashCommands: readonly SlashCommandDef[],
): readonly SlashCommandDef[] {
  const customByName = new Map<string, SlashCommandDef>();
  for (const cmd of agentSlashCommands) {
    customByName.set(cmd.name, cmd);
  }

  // Replace defaults with custom overrides, keep order
  const merged = DEFAULT_SLASH_COMMANDS.map((defaultCmd) => {
    const custom = customByName.get(defaultCmd.name);
    if (custom) {
      customByName.delete(defaultCmd.name);
      return custom;
    }
    return defaultCmd;
  });

  // Append any custom commands that don't override a default
  const extras = [...customByName.values()];

  return [...merged, ...extras];
}

/**
 * Format a duration in milliseconds to a compact "Xd Xh Xm" string.
 */
export function formatUptime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(" ");
}

/**
 * Build a Discord embed data object for fleet status display.
 * Returns a plain object (not EmbedBuilder) for testability.
 *
 * Color coding:
 * - Green (0x00ff00): all agents running
 * - Red (0xff0000): any agent stopped, crashed, or failed
 * - Yellow (0xffff00): mixed statuses
 * - Gray (0x808080): no agents
 */
export function buildFleetEmbed(
  entries: readonly RegistryEntry[],
  configs: readonly ResolvedAgentConfig[],
): {
  title: string;
  color: number;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  timestamp: string;
} {
  const fields = entries.map((entry) => {
    const config = configs.find((c) => c.name === entry.name);
    const statusEmoji =
      entry.status === "running"
        ? "\u{1F7E2}"
        : entry.status === "stopped" || entry.status === "crashed" || entry.status === "failed"
          ? "\u{1F534}"
          : "\u{1F7E1}";
    const model = config?.model ?? "unknown";
    const uptime = entry.startedAt
      ? formatUptime(Date.now() - entry.startedAt)
      : "\u2014";
    const lastActivity = entry.lastStableAt
      ? new Date(entry.lastStableAt).toISOString().slice(0, 16).replace("T", " ")
      : "\u2014";
    // Phase 56 Plan 02 — append warm-path suffix so operators see readiness
    // without leaving Discord. Legacy entries (no fields) get no suffix so
    // the embed stays backward-compat.
    let warmPathSuffix = "";
    if (
      entry.warm_path_readiness_ms !== undefined &&
      entry.warm_path_readiness_ms !== null
    ) {
      if (entry.lastError?.startsWith("warm-path:")) {
        warmPathSuffix = " \u00B7 warm-path error";
      } else if (entry.warm_path_ready === true) {
        const ms = Math.round(entry.warm_path_readiness_ms);
        warmPathSuffix = ` \u00B7 warm ${ms}ms`;
      } else {
        warmPathSuffix = " \u00B7 warming";
      }
    }
    return {
      name: entry.name,
      value: `${statusEmoji} ${entry.status} \u00B7 ${model} \u00B7 up ${uptime} \u00B7 last ${lastActivity}${warmPathSuffix}`,
      inline: false,
    };
  });

  const allRunning = entries.every((e) => e.status === "running");
  const anyDown = entries.some(
    (e) =>
      e.status === "stopped" || e.status === "crashed" || e.status === "failed",
  );
  const color =
    entries.length === 0
      ? 0x808080
      : allRunning
        ? 0x00ff00
        : anyDown
          ? 0xff0000
          : 0xffff00;

  return { title: "Fleet Status", color, fields, timestamp: new Date().toISOString() };
}
