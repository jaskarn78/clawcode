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
  /**
   * Phase 83 UI-01 — Discord native structured choices for STRING options
   * (type 3). When present, Discord renders a dropdown of the provided values
   * and refuses free-text input. Each choice: `{ name: <display>, value: <sent-to-handler> }`.
   *
   * Discord hard-caps this at 25 entries per option (zod-enforced at
   * slashCommandOptionSchema). Omit the field entirely for free-text options
   * (existing /clawcode-memory, /clawcode-model, control-command agent args).
   */
  readonly choices?: readonly { readonly name: string; readonly value: string }[];
};

/**
 * Phase 83 UI-01 — canonical EffortLevel picker for `/clawcode-effort`.
 *
 * Seven entries, one per level in the v2.2 effortSchema. Order matches the
 * schema's z.enum tuple (low → max) with auto and off tail-positioned because
 * they're semantically distinct from the graded scale (auto = model default,
 * off = explicit disable via setMaxThinkingTokens(0)).
 *
 * Wired into DEFAULT_SLASH_COMMANDS.clawcode-effort.options[0].choices below
 * AND forwarded by slash-commands.ts:register() into the Discord REST body so
 * the user sees a dropdown, not a text box.
 */
export const EFFORT_CHOICES = [
  { name: "low (fastest)",        value: "low"    },
  { name: "medium",               value: "medium" },
  { name: "high",                 value: "high"   },
  { name: "xhigh",                value: "xhigh"  },
  { name: "max (deepest)",        value: "max"    },
  { name: "auto (model default)", value: "auto"   },
  { name: "off (disabled)",       value: "off"    },
] as const;

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
    description: "Change the agent's model (opens a picker when no model is specified)",
    // Phase 86 MODEL-02 / MODEL-03 — LLM-prompt routing REMOVED. The inline
    // handler in slash-commands.ts owns both the no-arg (picker) and arg
    // (IPC dispatch) paths. claudeCommand is intentionally empty so any
    // accidental fallback to formatCommandMessage emits a no-op string that
    // the inline short-circuit prevents from ever being sent.
    claudeCommand: "",
    options: [
      {
        name: "model",
        type: 3,
        description: "Model alias (optional — omit to open picker)",
        required: false,
      },
    ],
  },
  {
    name: "clawcode-effort",
    description: "Set reasoning effort level",
    claudeCommand: "__effort__{level}",
    options: [
      {
        name: "level",
        type: 3,
        description: "Effort level for Claude's next turn",
        required: true,
        // Phase 83 UI-01 — forces Discord to render a 7-item dropdown instead
        // of a free-text input. No invalid level can be typed.
        choices: EFFORT_CHOICES,
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
  {
    name: "clawcode-agent-create",
    description: "Provision a new agent with its own Discord channel",
    claudeCommand: "",
    control: true,
    ipcMethod: "agent-create",
    options: [
      { name: "name", type: 3, description: "Agent name (lowercase, alphanumeric, hyphens)", required: true },
      { name: "soul", type: 3, description: "Personality / system prompt — use \\n for line breaks", required: true },
      { name: "model", type: 3, description: "Model: sonnet (default), opus, or haiku", required: false },
    ],
  },
  // Quick task 260419-nic — live control over an agent's in-flight SDK turn.
  // /clawcode-interrupt aborts the current turn (drops the queue slot).
  // /clawcode-steer aborts + dispatches a [USER STEER] follow-up so the
  // agent course-corrects without waiting for the current turn to finish.
  // Names deliberately avoid collision with the existing clawcode-stop
  // (which stops a whole agent, not a turn).
  {
    name: "clawcode-interrupt",
    description: "Abort the agent's in-flight turn (no effect if idle)",
    claudeCommand: "",
    control: true,
    ipcMethod: "interrupt-agent",
    options: [
      { name: "agent", type: 3, description: "Agent name (default: channel's agent)", required: false },
    ],
  },
  {
    name: "clawcode-steer",
    description: "Abort current turn and redirect the agent with new guidance",
    claudeCommand: "",
    control: true,
    ipcMethod: "steer-agent",
    options: [
      { name: "guidance", type: 3, description: "What the agent should do instead", required: true },
      { name: "agent", type: 3, description: "Agent name (default: channel's agent)", required: false },
    ],
  },
  // Phase 85 Plan 03 TOOL-06 / UI-01 — daemon-routed MCP readiness view.
  // Reads the per-agent state map populated by Plan 01's warm-path gate +
  // mcp-reconnect heartbeat (ipcMethod "list-mcp-status"). The inline handler
  // in slash-commands.ts renders the reply as a native Discord EmbedBuilder
  // (UI-01 compliance — NOT free-text). Zero LLM turn cost per invocation.
  {
    name: "clawcode-tools",
    description: "Show MCP tool readiness for the bound agent",
    claudeCommand: "",
    control: true,
    ipcMethod: "list-mcp-status",
    options: [
      {
        name: "agent",
        type: 3,
        description: "Agent name (defaults to the channel's bound agent)",
        required: false,
      },
    ],
  },
] as const;
