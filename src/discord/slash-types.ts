/**
 * Slash command type definitions and default commands for Discord integration.
 *
 * These types define the data contract for slash commands that agents
 * can register and handle via Discord's application command system.
 */

/**
 * A single option for a slash command.
 *
 * The `type` field uses Discord's ApplicationCommandOptionType numeric values:
 * - 1 = SUB_COMMAND
 * - 2 = SUB_COMMAND_GROUP
 * - 3 = STRING
 * - 4 = INTEGER
 * - 5 = BOOLEAN
 * - 6 = USER
 * - 7 = CHANNEL
 * - 8 = ROLE
 * - 9 = MENTIONABLE
 * - 10 = NUMBER (double)
 * - 11 = ATTACHMENT
 */
export type SlashCommandOption = {
  readonly name: string;
  readonly type: number;
  readonly description: string;
  readonly required: boolean;
};

/**
 * Definition of a single slash command.
 *
 * `claudeCommand` is the prompt sent to the agent when the command is invoked.
 * Placeholders like `{query}` are replaced with the corresponding option value.
 */
export type SlashCommandDef = {
  readonly name: string;
  readonly description: string;
  readonly claudeCommand: string;
  readonly options: readonly SlashCommandOption[];
  readonly control?: boolean;
  readonly ipcMethod?: string;
};

/**
 * Default slash commands available to all agents.
 * Agents can override or extend these via clawcode.yaml config.
 */
export const DEFAULT_SLASH_COMMANDS: readonly SlashCommandDef[] = [
  {
    name: "clawcode-status",
    description: "Get the agent's current status",
    claudeCommand: `Report your status in EXACTLY this compact format (replace values with your actual state). Use emoji line prefixes. Keep it concise — no extra text:

🤖 {your name} · {model}
🧮 Tokens: {input tokens} in / {output tokens} out
📚 Context: {estimate}% used · 🧹 Compactions: {count}
🧵 Session: {your session id or "active"} • updated {when}
⚙️ Runtime: SDK session · Permissions: bypass
💰 Usage: {tokens in} in / {tokens out} out · \${cost} this session
📋 Task: {what you're currently doing or "idle"}`,
    options: [],
  },
  {
    name: "clawcode-memory",
    description: "Search the agent's memory",
    claudeCommand: "Search your memory for: {query}",
    options: [
      {
        name: "query",
        type: 3,
        description: "What to search for",
        required: true,
      },
    ],
  },
  {
    name: "clawcode-schedule",
    description: "Show the agent's scheduled tasks",
    claudeCommand: "Show your current scheduled tasks and their next run times",
    options: [],
  },
  {
    name: "clawcode-health",
    description: "Get the agent's health status",
    claudeCommand: "Report your health status including context usage and memory stats",
    options: [],
  },
  {
    name: "clawcode-compact",
    description: "Trigger context compaction",
    claudeCommand: "Trigger context compaction now and report the result",
    options: [],
  },
  {
    name: "clawcode-usage",
    description: "Show token usage and costs",
    claudeCommand: "Report your usage statistics: session totals and this week's usage. Include tokens in/out, cost, turns, and duration.",
    options: [],
  },
  {
    name: "clawcode-model",
    description: "Set the default model for an agent",
    claudeCommand: "Set my model to {model}",
    options: [
      {
        name: "model",
        type: 3,
        description: "Model to use (haiku, sonnet, opus)",
        required: true,
      },
    ],
  },
  {
    name: "clawcode-effort",
    description: "Set reasoning effort level (low/medium/high/max)",
    claudeCommand: "__effort__{level}",
    options: [
      {
        name: "level",
        type: 3,
        description: "Effort level: low (fastest), medium, high, max (deepest thinking)",
        required: true,
      },
    ],
  },
] as const;

/**
 * Control commands that route directly to the daemon via IPC.
 * These bypass agent sessions entirely — the daemon handles start/stop/restart/status.
 */
export const CONTROL_COMMANDS: readonly SlashCommandDef[] = [
  {
    name: "clawcode-start",
    description: "Start an agent",
    claudeCommand: "",
    control: true,
    ipcMethod: "start",
    options: [
      { name: "agent", type: 3, description: "Agent name to start", required: true },
    ],
  },
  {
    name: "clawcode-stop",
    description: "Stop an agent",
    claudeCommand: "",
    control: true,
    ipcMethod: "stop",
    options: [
      { name: "agent", type: 3, description: "Agent name to stop", required: true },
    ],
  },
  {
    name: "clawcode-restart",
    description: "Restart an agent",
    claudeCommand: "",
    control: true,
    ipcMethod: "restart",
    options: [
      { name: "agent", type: 3, description: "Agent name to restart", required: true },
    ],
  },
  {
    name: "clawcode-fleet",
    description: "Show fleet status",
    claudeCommand: "",
    control: true,
    ipcMethod: "status",
    options: [],
  },
] as const;
