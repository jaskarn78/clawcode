/**
 * Slash command registration and interaction handling for Discord.
 *
 * Registers guild-scoped slash commands via Discord REST API on startup,
 * listens for interactions, routes them to agents, and replies with the response.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  EmbedBuilder,
  REST,
  Routes,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { join } from "node:path";
import type { RoutingTable } from "./types.js";
import type { SessionManager } from "../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { EffortLevel } from "../config/schema.js";
import type { SlashCommandDef } from "./slash-types.js";
import { DEFAULT_SLASH_COMMANDS, CONTROL_COMMANDS } from "./slash-types.js";
// Phase 87 CMD-01 — SDK-driven native command registration.
// Phase 87 CMD-03 — buildNativePromptString for prompt-channel dispatch.
import {
  buildNativeCommandDefs,
  mergeAndDedupe,
  buildNativePromptString,
} from "../manager/native-cc-commands.js";
import { resolveDeniedCommands } from "../security/acl-parser.js";
import { sendIpcRequest } from "../ipc/client.js";
import { SOCKET_PATH } from "../manager/daemon.js";
import type { RegistryEntry } from "../manager/types.js";
import { getAgentForChannel } from "./router.js";
import { ProgressiveMessageEditor } from "./streaming.js";
import type { Logger } from "pino";
import { logger } from "../shared/logger.js";
import type { TurnDispatcher } from "../manager/turn-dispatcher.js";
import type { TurnOrigin } from "../manager/turn-origin.js";
import { makeRootOrigin } from "../manager/turn-origin.js";
import type { SkillsCatalog } from "../skills/types.js";

/**
 * Maximum Discord message length (API limit).
 */
const DISCORD_MAX_LENGTH = 2000;

/**
 * Phase 86 MODEL-02 — TTL for the /clawcode-model select-menu collector.
 * The menu auto-dismisses after this many ms with no selection and the
 * handler replies "timed out". 30 seconds matches the Discord ephemeral
 * reply TTL comfortably.
 */
const MODEL_PICKER_TTL_MS = 30_000;

/**
 * Phase 86 MODEL-02 — Discord StringSelectMenuBuilder hard cap. The picker
 * truncates the allowedModels list to the first 25 entries and appends an
 * overflow note to the content string. Discord rejects menus with more
 * than 25 options at registration time.
 */
const DISCORD_SELECT_CAP = 25;

/**
 * Phase 86 MODEL-05 — TTL for the cache-invalidation confirmation collector.
 * Users get 30s to confirm before the dialog auto-dismisses. Mirrors the
 * picker TTL above for consistency (operators only have one "model switch"
 * decision window to hold in their head).
 */
const MODEL_CONFIRM_TTL_MS = 30_000;

/**
 * Phase 87 CMD-07 — Discord's per-guild slash-command cap is 100. Reserve a
 * 10-slot buffer so future admin-only additions don't immediately trip the
 * limit. Exceeding this ceiling throws BEFORE rest.put — no partial registration,
 * no silent truncation.
 */
const MAX_COMMANDS_PER_GUILD = 90;

// ---------------------------------------------------------------------------
// Phase 85 Plan 03 TOOL-06 / UI-01 — /clawcode-tools inline handler helpers.
//
// Hoisted to module scope (not class members) so unit tests can exercise the
// pure bits in isolation, and so the handler reads as a straight-line flow
// without reaching through `this` for simple lookups.
// ---------------------------------------------------------------------------

/** Server status → emoji mapping used as the field-name prefix. */
const STATUS_EMOJI: Record<string, string> = {
  ready: "\u{1F7E2}",         // green circle
  degraded: "\u{1F7E1}",      // yellow circle
  failed: "\u{1F534}",        // red circle
  reconnecting: "\u{1F7E0}",  // orange circle
  unknown: "\u{26AA}",        // white (neutral) circle
};

/**
 * Shape of a single server entry returned by the `list-mcp-status` IPC
 * method (Plan 01 daemon.ts case). Duplicated here instead of imported so
 * slash-commands stays decoupled from the manager module graph.
 */
type ToolsIpcServer = {
  readonly name: string;
  readonly status: "ready" | "degraded" | "failed" | "reconnecting" | "unknown";
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly failureCount: number;
  readonly optional: boolean;
  readonly lastError: string | null;
};

type ToolsIpcResponse = {
  readonly agent: string;
  readonly servers: ReadonlyArray<ToolsIpcServer>;
};

/**
 * Embed colour driven by the worst-state server in the set.
 * Exported for test convenience / future reuse by the dashboard.
 */
export function resolveEmbedColor(
  servers: ReadonlyArray<{ readonly status: string }>,
): number {
  if (servers.some((s) => s.status === "failed")) return 0xea4335;       // red
  if (servers.some((s) => s.status === "degraded")) return 0xfbbc05;     // yellow
  if (servers.some((s) => s.status === "reconnecting")) return 0xfb8c00; // orange
  return 0x34a853;                                                        // green
}

/**
 * Short relative-time formatter for embed fields: "3s", "12m", "4h", "2d".
 * Keeps the embed compact — a full ISO timestamp is overkill for an
 * operator glance.
 */
export function formatRelativeTime(deltaMs: number): string {
  const s = Math.floor(Math.max(0, deltaMs) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

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
  /**
   * Quick task 260419-nic — optional TurnDispatcher reference used by the
   * /clawcode-steer slash command to dispatch a follow-up [USER STEER] turn
   * after interrupting the in-flight one. Optional so existing callers
   * (tests, legacy wiring) don't break; when absent, /clawcode-steer
   * replies with a clear "steer unavailable" message.
   */
  readonly turnDispatcher?: TurnDispatcher;
  /**
   * Phase 83 EFFORT-05 — optional skills catalog used to resolve per-skill
   * effort overrides on slash-command invocation. When a slash command name
   * (e.g. `clawcode-<skill>`) maps to a catalog entry with an `effort:`
   * frontmatter value, the handler applies that level for the duration of
   * the turn (setEffortForAgent) and reverts in a finally block. Optional
   * so existing callers (tests, pre-Phase-83 wiring) continue to work with
   * no per-skill override behavior.
   */
  readonly skillsCatalog?: SkillsCatalog;
  /**
   * Phase 87 CMD-05 — optional test-time override for the per-agent ACL deny
   * sets. Production code reads SECURITY.md via resolveDeniedCommands inside
   * register(); tests inject the pre-computed Map directly so the integration
   * test doesn't have to fs-write fixture SECURITY.md files.
   *
   * When absent, register() derives `<memoryPath>/SECURITY.md` (or
   * `<workspace>/SECURITY.md`) per agent and calls resolveDeniedCommands
   * itself.
   */
  readonly aclDeniedByAgent?: ReadonlyMap<string, ReadonlySet<string>> | Record<
    string,
    ReadonlySet<string>
  >;
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
  private readonly turnDispatcher: TurnDispatcher | null;
  private readonly skillsCatalog: SkillsCatalog | null;
  /**
   * Phase 87 CMD-05 — optional DI for per-agent ACL deny sets. Tests pass a
   * Map/Record to bypass SECURITY.md file lookups; production derives it at
   * register time.
   */
  private readonly aclDeniedByAgent: ReadonlyMap<string, ReadonlySet<string>> | null;
  private client: Client | null = null;
  private interactionHandler: ((interaction: Interaction) => void) | null = null;

  constructor(config: SlashCommandHandlerConfig) {
    this.routingTable = config.routingTable;
    this.sessionManager = config.sessionManager;
    this.resolvedAgents = config.resolvedAgents;
    this.botToken = config.botToken;
    this.client = config.client ?? null;
    this.log = config.log ?? logger;
    this.turnDispatcher = config.turnDispatcher ?? null;
    this.skillsCatalog = config.skillsCatalog ?? null;
    // Phase 87 CMD-05 — accept either a Map or a plain Record from config.
    if (config.aclDeniedByAgent) {
      if (config.aclDeniedByAgent instanceof Map) {
        this.aclDeniedByAgent = config.aclDeniedByAgent;
      } else {
        this.aclDeniedByAgent = new Map(
          Object.entries(config.aclDeniedByAgent as Record<string, ReadonlySet<string>>),
        );
      }
    } else {
      this.aclDeniedByAgent = null;
    }
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
   *
   * Phase 87 CMD-01/04/05/07 — the registration loop now:
   *   1. Iterates each agent's SessionHandle via SessionManager.getSessionHandle
   *      and calls `getSupportedCommands()` to learn what the SDK reports.
   *   2. Resolves a per-agent deny set (SECURITY.md `## Command ACLs` or the
   *      DI'd override) and filters native commands through it.
   *   3. Builds `clawcode-<name>` SlashCommandDef[] entries via
   *      native-cc-commands.buildNativeCommandDefs with a nativeBehavior
   *      discriminator.
   *   4. Merges with each agent's static slashCommands + CONTROL_COMMANDS via
   *      mergeAndDedupe; native wins on name collision (re-provides
   *      compact/usage removed from DEFAULT_SLASH_COMMANDS per CMD-04).
   *   5. Asserts the per-guild body length stays <= 90 BEFORE rest.put —
   *      over-cap throws without partial registration.
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

        // Phase 87 CMD-01 — discover SDK-reported native commands per agent.
        // A missing handle (agent not yet started, failed warm-path, etc.)
        // or a thrown getSupportedCommands() falls back to an empty list so
        // the static DEFAULT_SLASH_COMMANDS still register. Never throw out of
        // the register loop because of SDK flakiness during startup.
        let sdkCommands: readonly import("../manager/sdk-types.js").SlashCommand[] = [];
        try {
          const handle = this.sessionManager.getSessionHandle?.(agent.name);
          if (handle && typeof handle.getSupportedCommands === "function") {
            sdkCommands = await handle.getSupportedCommands();
          }
        } catch (err) {
          this.log.warn(
            { agent: agent.name, error: (err as Error).message },
            "sdk getSupportedCommands failed — falling back to DEFAULT_SLASH_COMMANDS only",
          );
        }

        // Phase 87 CMD-05 — ACL filter. Prefer the DI'd map when set; else
        // read `<memoryPath>/SECURITY.md` (or `<workspace>/SECURITY.md`) and
        // call resolveDeniedCommands. Missing file / missing section → no
        // denies (permissive default).
        let denied: ReadonlySet<string> = new Set();
        if (this.aclDeniedByAgent) {
          denied = this.aclDeniedByAgent.get(agent.name) ?? new Set();
        } else {
          const basePath = agent.memoryPath || agent.workspace;
          if (basePath) {
            try {
              denied = await resolveDeniedCommands(
                join(basePath, "SECURITY.md"),
              );
            } catch (err) {
              this.log.warn(
                { agent: agent.name, error: (err as Error).message },
                "resolveDeniedCommands failed — defaulting to permissive ACL",
              );
              denied = new Set();
            }
          }
        }

        // Phase 87 CMD-01 — build native-CC entries via pure classifier.
        const nativeDefs = buildNativeCommandDefs(sdkCommands, { denied });

        // Phase 87 CMD-04 — mergeAndDedupe: native wins on name collision so
        // the removed clawcode-compact / clawcode-usage duplicates get
        // re-provided with nativeBehavior="prompt-channel".
        const merged = mergeAndDedupe(agentCommands, nativeDefs);

        for (const cmd of merged) {
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
          // Phase 83 UI-01 — forward choices when defined so Discord renders
          // a dropdown. Spread-only: options without choices stay byte-identical
          // to the pre-Phase-83 payload (back-compat for every other option).
          ...(opt.choices && opt.choices.length > 0
            ? {
                choices: opt.choices.map((c) => ({
                  name: c.name,
                  value: c.value,
                })),
              }
            : {}),
        })),
      }));

      // Phase 87 CMD-07 — pre-flight cap assertion. Thrown BEFORE rest.put so
      // no partial registration lands; operators see the full over-cap error
      // in the warn log below and can prune before retry.
      if (body.length > MAX_COMMANDS_PER_GUILD) {
        this.log.error(
          {
            guildId,
            commandCount: body.length,
            limit: MAX_COMMANDS_PER_GUILD,
          },
          "too many commands for guild — refusing to register (CMD-07)",
        );
        continue;
      }

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

    // Phase 85 Plan 03 TOOL-06 / UI-01 — dedicated inline handler for
    // /clawcode-tools. Routes through the same IPC as a control command but
    // renders the reply as a Discord EmbedBuilder (native structured element,
    // not free-text blob). Carved out BEFORE the generic control-command
    // dispatch so the EmbedBuilder path can't be short-circuited by the
    // text-formatting branch in handleControlCommand.
    if (commandName === "clawcode-tools") {
      await this.handleToolsCommand(interaction);
      return;
    }

    // Phase 86 MODEL-02 / MODEL-03 — /clawcode-model inline handler.
    // Routes ENTIRELY through IPC set-model (Plan 02). The old LLM-prompt
    // routing (slash-types.ts claudeCommand "Set my model to {model}")
    // has been REMOVED — this handler is the only dispatch path. Carved
    // out BEFORE the generic CONTROL_COMMANDS and agent-lookup branches
    // so the picker and IPC dispatch can't be short-circuited downstream.
    if (commandName === "clawcode-model") {
      await this.handleModelCommand(interaction);
      return;
    }

    // Phase 87 CMD-02 — /clawcode-permissions inline handler.
    // Routes through IPC set-permission-mode (control-plane, NOT prompt
    // channel). Carved out BEFORE the generic CONTROL_COMMANDS branch so
    // the IPC dispatch path can't be short-circuited by the text-formatting
    // branch downstream. Mirrors the /clawcode-model carve-out above.
    if (commandName === "clawcode-permissions") {
      await this.handlePermissionsCommand(interaction);
      return;
    }

    // Check if this is a control command (daemon-direct, no agent needed)
    const controlCmd = CONTROL_COMMANDS.find((c) => c.name === commandName);
    if (controlCmd) {
      await this.handleControlCommand(interaction, controlCmd);
      return;
    }

    // Phase 87 CMD-03 — prompt-channel native-CC dispatch carve-out.
    //
    // Looks up the command definition in the resolved (per-guild-merged) set
    // that Plan 01's register() built. If nativeBehavior === "prompt-channel",
    // route through TurnDispatcher.dispatchStream with the canonical
    // `/<name> <args>` string. Output streams via ProgressiveMessageEditor.
    //
    // Ordering rationale: lives AFTER the clawcode-model / clawcode-tools /
    // CONTROL_COMMANDS carve-outs (so those dedicated inline handlers always
    // win for their respective names, even if a stray prompt-channel entry
    // with a colliding name somehow reaches this ladder) but BEFORE the
    // legacy agent-routed branch (so formatCommandMessage + claudeCommand
    // template path does NOT execute for native-CC prompt-channel entries).
    const nativeDef = this.findNativePromptChannelCommand(commandName);
    if (nativeDef) {
      await this.dispatchNativePromptCommand(interaction, nativeDef);
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

    // Phase 83 EFFORT-07 — /clawcode-status daemon-side short-circuit.
    // Pulls the authoritative runtime effort + model directly from the
    // running session handle; does NOT consume an LLM turn. Mirrors the
    // clawcode-effort shortcut below (same no-turn-cost pattern).
    //
    // Trade-off: the old prompt-routed `/clawcode-status` produced a rich
    // agent-authored block (tokens, context fill, compactions, etc.). That
    // data lives only in the agent's context — not in the daemon — so we
    // can't reproduce it server-side without asking the agent. The concise
    // server-side view is authoritative, cheap, and always available
    // (including when the agent is hung mid-turn). Plan 83-03 scope is
    // EFFORT-07's VISIBILITY requirement only; a future `/clawcode-status-detail`
    // can restore the rich prompt-routed form if needed.
    if (commandName === "clawcode-status") {
      try {
        const effort = this.sessionManager.getEffortForAgent(agentName);
        // Phase 86 MODEL-07 — prefer the live handle's model (may reflect a
        // recent /clawcode-model swap before the YAML write); fall back to
        // the resolved-config alias when the handle reports undefined
        // (fresh boot, no setModel call yet).
        const liveModel = this.sessionManager.getModelForAgent(agentName);
        const configModel =
          this.resolvedAgents.find((a) => a.name === agentName)?.model ??
          "(unknown)";
        const model = liveModel ?? configModel;
        await interaction.editReply(
          `📋 ${agentName}\n🤖 Model: ${model}\n🎚️ Effort: ${effort}`,
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        try {
          await interaction.editReply(`Failed to read status: ${msg}`);
        } catch {
          /* expired */
        }
      }
      return;
    }

    // Handle /effort directly — no need to route through the agent.
    // Phase 83 EFFORT-04 — validates against the full v2.2 level set.
    if (commandName === "clawcode-effort") {
      const level = options.get("level");
      const validLevels = ["low", "medium", "high", "xhigh", "max", "auto", "off"];
      if (typeof level !== "string" || !validLevels.includes(level)) {
        try {
          await interaction.editReply(`Invalid effort level. Use: ${validLevels.join(", ")}`);
        } catch { /* expired */ }
        return;
      }
      try {
        this.sessionManager.setEffortForAgent(
          agentName,
          level as EffortLevel,
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

    // Phase 83 EFFORT-05 — per-skill effort override. Resolve the command
    // name against the skills catalog (with or without the `clawcode-` prefix
    // that the Discord convention requires) and, when the skill has an
    // `effort:` frontmatter, apply that level for the duration of the turn.
    // Revert in a finally block so error paths can't strand the agent at an
    // elevated level. Zero side effects when the catalog isn't injected or
    // the command doesn't map to a skill with an override.
    const skillEntry =
      this.skillsCatalog?.get(commandName) ??
      this.skillsCatalog?.get(commandName.replace(/^clawcode-/, ""));
    const skillEffort = skillEntry?.effort;
    let priorEffort: EffortLevel | null = null;
    if (skillEffort) {
      try {
        priorEffort = this.sessionManager.getEffortForAgent(agentName);
        this.sessionManager.setEffortForAgent(agentName, skillEffort);
      } catch (err) {
        this.log.warn(
          { agent: agentName, command: commandName, skillEffort, error: (err as Error).message },
          "slash-command: skill-effort apply failed — continuing without override",
        );
        priorEffort = null;
      }
    }

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
    } finally {
      // Phase 83 EFFORT-05 — revert to the snapshot-at-dispatch-time effort.
      // Runs on both success AND error paths (try/finally). Swallows revert
      // failures (logged) so a transient SDK failure cannot propagate past
      // the interaction boundary.
      if (priorEffort !== null) {
        try {
          this.sessionManager.setEffortForAgent(agentName, priorEffort);
        } catch (err) {
          this.log.warn(
            { agent: agentName, command: commandName, priorEffort, error: (err as Error).message },
            "slash-command: skill-effort revert failed — agent may be at wrong level",
          );
        }
      }
    }
  }

  /**
   * Phase 85 Plan 03 TOOL-06 / UI-01 — handle /clawcode-tools.
   *
   * Reads per-agent MCP readiness via the `list-mcp-status` IPC (daemon-routed,
   * zero LLM turn cost) and replies with a native Discord EmbedBuilder.
   *
   * Agent resolution:
   *   1. Explicit `agent` option takes precedence.
   *   2. Otherwise infer from the channel-agent routing table.
   *   3. Neither → ephemeral error, no IPC call spent.
   *
   * Reply is always ephemeral (operator-only view). Empty-servers case
   * returns a plain string — an empty embed would be visually noisy.
   */
  private async handleToolsCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const explicitAgent = interaction.options.get("agent")?.value;
    const agentName =
      typeof explicitAgent === "string" && explicitAgent.length > 0
        ? explicitAgent
        : getAgentForChannel(this.routingTable, interaction.channelId);

    if (!agentName) {
      try {
        await interaction.reply({
          content:
            "This channel is not bound to an agent and no agent was provided.",
          ephemeral: true,
        });
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (error) {
      this.log.error(
        { command: "clawcode-tools", error: (error as Error).message },
        "failed to defer tools reply",
      );
      return;
    }

    let response: ToolsIpcResponse;
    try {
      response = (await sendIpcRequest(SOCKET_PATH, "list-mcp-status", {
        agent: agentName,
      })) as ToolsIpcResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply(`Failed to read MCP state: ${msg}`);
      } catch {
        /* expired */
      }
      return;
    }

    if (response.servers.length === 0) {
      try {
        await interaction.editReply(`No MCP servers configured for ${agentName}`);
      } catch {
        /* expired */
      }
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`MCP Tools · ${agentName}`)
      .setColor(resolveEmbedColor(response.servers));

    const now = Date.now();
    for (const s of response.servers) {
      const emoji = STATUS_EMOJI[s.status] ?? STATUS_EMOJI.unknown!;
      // Only annotate optional servers that aren't ready — a ready optional
      // doesn't need the annotation (operator cares about "what's down, and
      // does it matter?").
      const optSuffix = s.optional && s.status !== "ready" ? " (optional)" : "";
      const lastSuccess = s.lastSuccessAt
        ? `${formatRelativeTime(now - s.lastSuccessAt)} ago`
        : "never";
      // TOOL-04 end-to-end — pass the lastError string VERBATIM into the
      // embed field. No rewording, no wrapping. Plan 01's readiness module
      // captures the raw transport error; we just render it.
      const errLine = s.lastError ? `\nerror: ${s.lastError}` : "";
      embed.addFields({
        name: `${emoji} ${s.name}${optSuffix}`,
        value: `status: ${s.status}\nlast success: ${lastSuccess}\nfailures: ${s.failureCount}${errLine}`,
        inline: false,
      });
    }

    try {
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.log.error(
        { command: "clawcode-tools", error: (error as Error).message },
        "failed to send tools embed",
      );
    }
  }

  /**
   * Phase 86 MODEL-02 / MODEL-03 / MODEL-06 — /clawcode-model inline handler.
   *
   * Two paths share the same IPC dispatch:
   *   - No-arg: render a StringSelectMenuBuilder from the bound agent's
   *     resolved allowedModels; await the selection (30s TTL); dispatch via
   *     IPC. The menu is pure UI — selection funnels back through
   *     dispatchModelChange so arg-path and picker-path share error handling.
   *   - Arg: validate the agent binding and dispatch immediately via IPC.
   *
   * UI-01 compliance: the picker is a native discord.js StringSelectMenuBuilder
   * (not a free-text argument). Discord enforces a 25-entry cap on the menu;
   * when the allowedModels list exceeds that, the picker truncates and appends
   * a "+N more" note to the content string.
   *
   * Error rendering: when the IPC error envelope carries
   * `data.kind === "model-not-allowed"` (the ModelNotAllowedError payload
   * from Plan 01 surfaced via Plan 02's ManagerError {code:-32602, data}
   * wire), the reply renders the allowed list from `data.allowed`.
   */
  private async handleModelCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const agentName = getAgentForChannel(
      this.routingTable,
      interaction.channelId,
    );
    if (!agentName) {
      try {
        await interaction.reply({
          content: "This channel is not bound to an agent.",
          ephemeral: true,
        });
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    const agentConfig = this.resolvedAgents.find((a) => a.name === agentName);
    const allowed = [...(agentConfig?.allowedModels ?? [])];

    const modelArg = interaction.options.get("model")?.value;
    const model =
      typeof modelArg === "string" && modelArg.length > 0 ? modelArg : undefined;

    // Arg path — direct IPC dispatch.
    if (model !== undefined) {
      await this.dispatchModelChange(interaction, agentName, model, false);
      return;
    }

    // No-arg path — render the select-menu picker.
    if (allowed.length === 0) {
      try {
        await interaction.reply({
          content: `No models available for ${agentName} (allowedModels is empty).`,
          ephemeral: true,
        });
      } catch {
        /* expired */
      }
      return;
    }

    const capped = allowed.slice(0, DISCORD_SELECT_CAP);
    const overflow = allowed.length - capped.length;
    const nonce = Math.random().toString(36).slice(2, 8);
    const customId = `model-picker:${agentName}:${nonce}`;

    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Choose a model")
      .addOptions(
        capped.map((m) =>
          new StringSelectMenuOptionBuilder().setLabel(m).setValue(m),
        ),
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      menu,
    );

    const overflowNote =
      overflow > 0
        ? `\n(Showing first ${DISCORD_SELECT_CAP} of ${allowed.length}.)`
        : "";
    try {
      await interaction.reply({
        content: `Pick a model for **${agentName}**.${overflowNote}`,
        components: [row],
        ephemeral: true,
      });
    } catch (err) {
      this.log.error(
        { agent: agentName, error: (err as Error).message },
        "failed to render model picker",
      );
      return;
    }

    // Wait for the select-menu interaction (30s TTL).
    let followUp: StringSelectMenuInteraction;
    try {
      const channel = interaction.channel;
      if (!channel) {
        throw new Error("interaction has no channel — cannot collect");
      }
      followUp = (await channel.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i: { user: { id: string }; customId: string }) =>
          i.user.id === interaction.user.id && i.customId === customId,
        time: MODEL_PICKER_TTL_MS,
      })) as StringSelectMenuInteraction;
    } catch {
      try {
        await interaction.editReply({
          content: "Model picker timed out (no selection in 30s).",
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    const chosen = followUp.values[0];
    if (!chosen) {
      try {
        await followUp.update({
          content: "No selection captured.",
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    // Acknowledge the select-menu interaction so Discord doesn't mark it as
    // "interaction failed"; dispatchModelChange will emit the final status
    // via editReply on the original slash-command interaction.
    try {
      await followUp.update({
        content: `Switching ${agentName} to **${chosen}**...`,
        components: [],
      });
    } catch {
      /* expired */
    }

    await this.dispatchModelChange(interaction, agentName, chosen, true);
  }

  /**
   * Phase 86 MODEL-03 / MODEL-06 — shared IPC dispatch for both the direct
   * arg-path and the select-menu path.
   *
   * `editMode=true` means the slash-command interaction has already been
   * replied-to (via `interaction.reply` during the picker render) — the
   * final status must use `editReply`. `editMode=false` is the direct
   * arg-path: defer first, then editReply with the outcome.
   *
   * Renders the typed ModelNotAllowedError payload from the IPC envelope
   * by reading `err.data.allowed` (Plan 02 propagates this through
   * IpcError.data, which Plan 03 extended client.ts to pass through).
   */
  private async dispatchModelChange(
    interaction: ChatInputCommandInteraction,
    agentName: string,
    model: string,
    editMode: boolean,
  ): Promise<void> {
    if (!editMode) {
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch {
        /* already replied/deferred */
      }
    }

    // Phase 86 MODEL-05 — cache-invalidation confirmation for mid-conversation
    // changes. Skip when the handle has no active model (fresh boot — no
    // turn has executed yet). Being too conservative (always show confirm)
    // is cheap; being too permissive (never show confirm) misses the prompt-
    // cache invalidation warning, so when in doubt we show it.
    let activeModel: string | undefined;
    try {
      activeModel = this.sessionManager.getModelForAgent(agentName);
    } catch {
      activeModel = undefined;
    }
    if (activeModel !== undefined) {
      const outcome = await this.promptCacheInvalidationConfirm(
        interaction,
        agentName,
        activeModel,
        model,
      );
      if (outcome === "cancelled") {
        try {
          await interaction.editReply({
            content: "Model change cancelled.",
            components: [],
          });
        } catch {
          /* expired */
        }
        return;
      }
      if (outcome === "timeout") {
        try {
          await interaction.editReply({
            content: "Confirmation timed out.",
            components: [],
          });
        } catch {
          /* expired */
        }
        return;
      }
      // outcome === "confirmed" — fall through to IPC dispatch.
    }

    try {
      const res = (await sendIpcRequest(SOCKET_PATH, "set-model", {
        agent: agentName,
        model,
      })) as {
        readonly agent: string;
        readonly old_model: string;
        readonly new_model: string;
        readonly persisted: boolean;
        readonly persist_error: string | null;
        readonly note: string;
      };
      const persistSuffix = res.persisted
        ? ""
        : `\n(Note: live swap OK, but YAML persistence failed: ${res.persist_error ?? "unknown"})`;
      const message = `Model set to **${res.new_model}** for ${agentName} (was ${res.old_model}).${persistSuffix}`;
      try {
        await interaction.editReply(message);
      } catch {
        /* expired */
      }
    } catch (err) {
      // Plan 02 IPC envelope: ModelNotAllowedError carries
      // `data.kind === "model-not-allowed"` and `data.allowed: string[]`.
      // Render the allowed list ephemerally.
      const maybe = err as { message?: string; data?: unknown };
      const data = maybe.data as
        | { kind?: string; allowed?: readonly string[] }
        | undefined;
      let reply: string;
      if (
        data?.kind === "model-not-allowed" &&
        Array.isArray(data.allowed)
      ) {
        reply = `'${model}' is not allowed for ${agentName}. Allowed: ${data.allowed.join(", ")}`;
      } else {
        reply = `Failed to set model: ${maybe.message ?? String(err)}`;
      }
      try {
        await interaction.editReply(reply);
      } catch {
        /* expired */
      }
    }
  }

  /**
   * Phase 86 MODEL-05 — native Discord button confirmation.
   *
   * Renders two buttons (Confirm = danger style, Cancel = secondary) with
   * agent + nonce namespaced customIds; awaits the user's click for up to
   * MODEL_CONFIRM_TTL_MS. Returns "confirmed" | "cancelled" | "timeout".
   *
   * UI-01 compliance: buttons are native ButtonBuilder components — NOT a
   * free-text "yes/no" LLM prompt or a reaction-emoji pattern.
   *
   * The filter accepts any customId whose prefix matches the namespaced
   * confirm OR cancel id for THIS agent (collision safety across parallel
   * picker invocations in the same channel — e.g. two operators picking
   * for different agents at once).
   */
  private async promptCacheInvalidationConfirm(
    interaction: ChatInputCommandInteraction,
    agentName: string,
    oldModel: string,
    newModel: string,
  ): Promise<"confirmed" | "cancelled" | "timeout"> {
    const nonce = Math.random().toString(36).slice(2, 8);
    const confirmId = `model-confirm:${agentName}:${nonce}`;
    const cancelId = `model-cancel:${agentName}:${nonce}`;
    // Prefixes pinned by C7 — the filter below must accept only THIS agent's
    // buttons, not a parallel picker's buttons for a different agent.
    const confirmPrefix = `model-confirm:${agentName}:`;
    const cancelPrefix = `model-cancel:${agentName}:`;

    const confirm = new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel("Switch & invalidate cache")
      .setStyle(ButtonStyle.Danger);
    const cancel = new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      confirm,
      cancel,
    );

    const warning =
      `Changing from **${oldModel}** to **${newModel}** will invalidate the prompt cache ` +
      `for ${agentName}. The next turn will pay full-prefix token cost. Proceed?`;

    try {
      await interaction.editReply({ content: warning, components: [row] });
    } catch {
      // Interaction expired — treat as cancel (no side effect fired yet).
      return "cancelled";
    }

    let btn: ButtonInteraction;
    try {
      const channel = interaction.channel;
      if (!channel) {
        throw new Error("interaction has no channel — cannot collect");
      }
      btn = (await channel.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i: { user: { id: string }; customId: string }) =>
          i.user.id === interaction.user.id &&
          (i.customId.startsWith(confirmPrefix) ||
            i.customId.startsWith(cancelPrefix)),
        time: MODEL_CONFIRM_TTL_MS,
      })) as ButtonInteraction;
    } catch {
      return "timeout";
    }

    const isConfirm = btn.customId.startsWith(confirmPrefix);
    try {
      await btn.update({
        content: isConfirm
          ? `Switching ${agentName} to **${newModel}**...`
          : "Cancelled.",
        components: [],
      });
    } catch {
      /* expired — outcome below still derives from btn.customId */
    }

    return isConfirm ? "confirmed" : "cancelled";
  }

  /**
   * Phase 87 CMD-02 — /clawcode-permissions inline handler.
   *
   * Routes the live SDK permission-mode swap via IPC set-permission-mode
   * (control-plane path — NOT prompt routing). Mirrors the Phase 83
   * clawcode-effort inline shortcut but surfaces through the daemon
   * IPC envelope so daemon-level validation (6-value union) runs once.
   *
   * Contract:
   *   - Unbound channel → ephemeral "not bound" reply, no IPC call.
   *   - Missing/empty mode arg → ephemeral usage reply, no IPC call.
   *   - IPC success → ephemeral confirmation mentioning the mode + agent.
   *   - IPC error → ephemeral error message (daemon error bubbles up
   *     verbatim so the valid-modes list from the server-side rejection
   *     surfaces to the user).
   */
  private async handlePermissionsCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const agentName = getAgentForChannel(
      this.routingTable,
      interaction.channelId,
    );
    if (!agentName) {
      try {
        await interaction.reply({
          content: "This channel is not bound to an agent.",
          ephemeral: true,
        });
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    const modeArg = interaction.options.get("mode")?.value;
    const mode =
      typeof modeArg === "string" && modeArg.length > 0 ? modeArg : undefined;
    if (!mode) {
      try {
        await interaction.reply({
          content:
            "Usage: /clawcode-permissions mode:<default|acceptEdits|bypassPermissions|plan|dontAsk|auto>",
          ephemeral: true,
        });
      } catch {
        /* expired */
      }
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch {
      return;
    }

    try {
      await sendIpcRequest(SOCKET_PATH, "set-permission-mode", {
        name: agentName,
        mode,
      });
      try {
        await interaction.editReply(
          `Permission mode set to **${mode}** for ${agentName}`,
        );
      } catch {
        /* expired */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply(`Failed to set permission mode: ${msg}`);
      } catch {
        /* expired */
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
      } else if (ipcMethod === "interrupt-agent") {
        // Quick task 260419-nic — daemon-direct mid-turn abort. Bypasses IPC
        // (we already hold a SessionManager reference) so there's no extra
        // hop on the time-sensitive path.
        const resolvedName =
          agentName ?? getAgentForChannel(this.routingTable, interaction.channelId);
        if (!resolvedName) {
          await interaction.editReply(
            "No agent to interrupt — specify `agent:` or run in an agent-bound channel.",
          );
          return;
        }
        const reply = await handleInterruptSlash({
          agentName: resolvedName,
          interruptAgent: (n) => this.sessionManager.interruptAgent(n),
          log: this.log,
        });
        await interaction.editReply(reply);
      } else if (ipcMethod === "steer-agent") {
        // Quick task 260419-nic — interrupt + dispatch [USER STEER] follow-up.
        const resolvedName =
          agentName ?? getAgentForChannel(this.routingTable, interaction.channelId);
        const guidance = interaction.options.getString("guidance");
        if (!resolvedName) {
          await interaction.editReply(
            "No agent to steer — specify `agent:` or run in an agent-bound channel.",
          );
          return;
        }
        if (!guidance) {
          await interaction.editReply("Guidance is required.");
          return;
        }
        if (!this.turnDispatcher) {
          await interaction.editReply(
            "Steer unavailable: turn dispatcher not wired.",
          );
          return;
        }
        const dispatcher = this.turnDispatcher;
        const reply = await handleSteerSlash({
          agentName: resolvedName,
          guidance,
          channelId: interaction.channelId,
          interactionId: interaction.id,
          interruptAgent: (n) => this.sessionManager.interruptAgent(n),
          hasActiveTurn: (n) => this.sessionManager.hasActiveTurn(n),
          dispatch: (origin, n, msg) => dispatcher.dispatch(origin, n, msg),
          log: this.log,
        });
        await interaction.editReply(reply);
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

  /**
   * Phase 87 CMD-03 — lookup a registered native-CC command by name and
   * return it iff it has nativeBehavior === "prompt-channel".
   *
   * Implementation reads from the same resolved set register() iterates at
   * startup: walks every resolvedAgents entry, resolves the agent's commands
   * via resolveAgentCommands (which merges DEFAULT_SLASH_COMMANDS with the
   * agent's own slashCommands — the register loop additionally folds in
   * buildNativeCommandDefs output, but by the time we get here the agent's
   * slashCommands carry the nativeBehavior-tagged entries Plan 01's register
   * loop stamped onto them in production).
   *
   * Prompt-channel entries are agent-agnostic by definition (the dispatch
   * target is the channel's bound agent, not the agent that first reported
   * the command) — so returning the FIRST match across all agents is
   * deliberate and safe.
   */
  private findNativePromptChannelCommand(
    name: string,
  ): SlashCommandDef | null {
    for (const agent of this.resolvedAgents) {
      for (const cmd of resolveAgentCommands(agent.slashCommands)) {
        if (cmd.name === name && cmd.nativeBehavior === "prompt-channel") {
          return cmd;
        }
      }
    }
    return null;
  }

  /**
   * Phase 87 CMD-03 / CMD-06 — dispatch a prompt-channel native-CC command.
   *
   * Mirrors the agent-routed streaming flow in handleInteraction (lines
   * 600-700 of this file) but substitutes the canonical `/<name> <args>`
   * prompt (buildNativePromptString) for the agent's claudeCommand template
   * and routes through TurnDispatcher.dispatchStream so origin propagates
   * (critical for trace stitching — see turn-origin.ts).
   *
   * Flow:
   *   1. Resolve agent by channel; reject if unbound (ephemeral "not bound").
   *   2. deferReply + "Thinking..." feedback.
   *   3. Build prompt string via buildNativePromptString.
   *   4. Stream via TurnDispatcher.dispatchStream with ProgressiveMessageEditor
   *      (v1.7 streaming primitive — reused verbatim, ZERO new primitive).
   *   5. On SDK error, dispose editor and surface the VERBATIM error text
   *      in the ephemeral reply (Phase 85 TOOL-04 pattern).
   *   6. Truncate oversized responses at DISCORD_MAX_LENGTH.
   *   7. Empty response → "(No response from agent)".
   *
   * When turnDispatcher is not wired (test scenarios / legacy boot), fall
   * back with an ephemeral error message — this path is unreachable in
   * production (daemon.ts always constructs a TurnDispatcher).
   */
  private async dispatchNativePromptCommand(
    interaction: ChatInputCommandInteraction,
    cmd: SlashCommandDef,
  ): Promise<void> {
    const agentName = getAgentForChannel(
      this.routingTable,
      interaction.channelId,
    );
    if (!agentName) {
      try {
        await interaction.reply({
          content: "This channel is not bound to an agent.",
          ephemeral: true,
        });
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    try {
      await interaction.deferReply();
    } catch (error) {
      this.log.error(
        { command: cmd.name, error: (error as Error).message },
        "failed to defer prompt-channel reply",
      );
      return;
    }

    // Extract optional args value (Discord STRING option) and build the
    // canonical prompt. Non-string / missing values → no args.
    const argsRaw = interaction.options.get("args")?.value;
    const args = typeof argsRaw === "string" ? argsRaw : undefined;
    const prompt = buildNativePromptString(cmd.name, args);

    this.log.info(
      {
        agent: agentName,
        command: cmd.name,
        channelId: interaction.channelId,
        prompt,
      },
      "prompt-channel native-CC dispatch",
    );

    try {
      await interaction.editReply("Thinking...");
    } catch {
      /* non-fatal */
    }

    const editor = new ProgressiveMessageEditor({
      editFn: async (content: string) => {
        const truncated =
          content.length > DISCORD_MAX_LENGTH
            ? content.slice(0, DISCORD_MAX_LENGTH - 3) + "..."
            : content;
        await interaction.editReply(truncated);
      },
      editIntervalMs: 1500,
    });

    try {
      if (!this.turnDispatcher) {
        throw new Error(
          "Turn dispatcher not wired — cannot dispatch native-CC prompt command",
        );
      }
      const origin = makeRootOrigin("discord", interaction.channelId);
      const response = await this.turnDispatcher.dispatchStream(
        origin,
        agentName,
        prompt,
        (accumulated) => editor.update(accumulated),
      );
      await editor.flush();
      const text = response.trim();
      if (text.length === 0) {
        await interaction.editReply("(No response from agent)");
        return;
      }
      const truncated =
        text.length > DISCORD_MAX_LENGTH
          ? text.slice(0, DISCORD_MAX_LENGTH - 3) + "..."
          : text;
      await interaction.editReply(truncated);
    } catch (err) {
      editor.dispose();
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(
        {
          agent: agentName,
          command: cmd.name,
          prompt,
          error: msg,
        },
        "native-CC prompt command failed",
      );
      // CMD-03 truth #4 / Phase 85 TOOL-04 — surface the VERBATIM error
      // text in the ephemeral reply (no rewording, no wrapping).
      try {
        await interaction.editReply(`Command failed: ${msg}`);
      } catch {
        /* expired */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Quick task 260419-nic — pure handlers for /clawcode-interrupt + /clawcode-steer.
//
// Exported so tests can drive the command logic without spinning up a real
// Discord interaction pipeline. `handleControlCommand` wires them in-process
// against SessionManager + TurnDispatcher.
// ---------------------------------------------------------------------------

const STEER_CLEAR_POLL_MS = 50;
const STEER_CLEAR_MAX_WAIT_MS = 2000;
const STEER_PREFIX = "[USER STEER] ";

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Render the ephemeral reply for `/clawcode-interrupt`.
 *
 * Returns:
 *   - "🛑 Stopped {agent} mid-turn."           — interruptAgent reported interrupted:true
 *   - "No active turn for {agent}."            — interruptAgent reported {false,false}
 *   - "Error: could not interrupt {agent}: …"  — interruptAgent threw
 *
 * Never throws — errors map to a user-visible message.
 */
export async function handleInterruptSlash(deps: {
  readonly agentName: string;
  readonly interruptAgent: (
    name: string,
  ) => Promise<{ readonly interrupted: boolean; readonly hadActiveTurn: boolean }>;
  readonly log: Logger;
}): Promise<string> {
  const { agentName, interruptAgent, log } = deps;
  try {
    const result = await interruptAgent(agentName);
    if (result.interrupted) {
      log.info(
        { agent: agentName, event: "slash_interrupt_ok" },
        "slash /interrupt succeeded",
      );
      return `🛑 Stopped ${agentName} mid-turn.`;
    }
    return `No active turn for ${agentName}.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      { agent: agentName, error: msg },
      "slash /interrupt failed",
    );
    return `Error: could not interrupt ${agentName}: ${msg}`;
  }
}

/**
 * Render the ephemeral reply for `/clawcode-steer`.
 *
 * Flow:
 *   1. interruptAgent(agent) — fires q.interrupt() on any in-flight turn.
 *   2. Poll hasActiveTurn() every 50ms for up to 2000ms until the turn clears.
 *      If the deadline expires, log.warn and proceed anyway (SerialTurnQueue
 *      will queue the new turn behind the stuck one — caller still gets a
 *      response once the stuck turn resolves or aborts).
 *   3. dispatch(origin=discord, agent, "[USER STEER] {guidance}") — the
 *      TurnDispatcher owns Turn lifecycle + opens the streaming reply in
 *      the channel via the normal DiscordBridge path.
 *
 * Returns:
 *   - "↩ Steered {agent}. New response coming in this channel." — happy path
 *   - "Error: could not steer {agent}: …"                        — dispatch threw
 */
export async function handleSteerSlash(deps: {
  readonly agentName: string;
  readonly guidance: string;
  readonly channelId: string;
  readonly interactionId: string;
  readonly interruptAgent: (
    name: string,
  ) => Promise<{ readonly interrupted: boolean; readonly hadActiveTurn: boolean }>;
  readonly hasActiveTurn: (name: string) => boolean;
  readonly dispatch: (
    origin: TurnOrigin,
    agentName: string,
    message: string,
  ) => Promise<unknown>;
  readonly log: Logger;
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<string> {
  const {
    agentName,
    guidance,
    channelId,
    interruptAgent,
    hasActiveTurn,
    dispatch,
    log,
  } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  try {
    // 1. Interrupt any in-flight turn (safe no-op if idle).
    await interruptAgent(agentName);

    // 2. Poll for the turn to clear, up to STEER_CLEAR_MAX_WAIT_MS.
    const deadline = Date.now() + STEER_CLEAR_MAX_WAIT_MS;
    while (hasActiveTurn(agentName) && Date.now() < deadline) {
      await sleep(STEER_CLEAR_POLL_MS);
    }
    if (hasActiveTurn(agentName)) {
      log.warn(
        { agent: agentName, waitMs: STEER_CLEAR_MAX_WAIT_MS },
        "steer: turn did not clear within deadline — dispatching anyway (will queue)",
      );
    }

    // 3. Dispatch the new turn via the discord origin kind.
    const origin = makeRootOrigin("discord", channelId);
    await dispatch(origin, agentName, `${STEER_PREFIX}${guidance}`);
    log.info(
      { agent: agentName, channelId, event: "slash_steer_ok" },
      "slash /steer dispatched",
    );
    return `↩ Steered ${agentName}. New response coming in this channel.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ agent: agentName, error: msg }, "slash /steer failed");
    return `Error: could not steer ${agentName}: ${msg}`;
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
