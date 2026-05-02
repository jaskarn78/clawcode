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
  /**
   * Phase 87 CMD-01 — dispatch discriminator for native Claude Code commands.
   *
   *   - "control-plane"   → dispatch via SDK Query.setX() (model/permissions/
   *                          effort); zero LLM turn cost
   *   - "prompt-channel"  → send as user text through TurnDispatcher
   *                          (compact / context / cost / help / hooks / ...)
   *
   * Absent on the CONTROL_COMMANDS (daemon-routed IPC) and on the remaining
   * DEFAULT_SLASH_COMMANDS (static LLM-prompt commands). Plans 02/03 route
   * entirely on the presence of this field — no name-matching required.
   */
  readonly nativeBehavior?: "control-plane" | "prompt-channel";
  /**
   * Phase 100 follow-up — Discord `default_member_permissions` bitmask
   * (passed verbatim to the REST registration body). Set `"0"` to hide
   * the command from every non-admin user in the guild; only members
   * with the `ADMINISTRATOR` role bit (or guild owner) see it in the
   * slash menu. Combine with the handler-level channel guard at
   * slash-commands.ts:1443 for defense in depth.
   *
   * Discord's per-channel command permissions (the "Integrations →
   * Bot → /command → Channels" UI override) cannot be set by the bot
   * itself — that endpoint requires a user OAuth token. Operators
   * apply per-channel restrictions manually post-deploy (see
   * SMOKE-TEST.md Section 8.5 hardening note).
   *
   * Spec: https://discord.com/developers/docs/interactions/application-commands#permissions
   */
  readonly defaultMemberPermissions?: string;
  /**
   * Phase 999.21 — when set, the registration loop nests this entry under
   * the named top-level command as a SUB_COMMAND (Discord type=1) instead
   * of registering it as a standalone slash command. Internal dispatch
   * (handleInteraction) rewrites `<top-level>+<sub>` back to the legacy
   * flat name (`gsd-${sub}`) on entry so existing carve-outs
   * (handleSetGsdProjectCommand, GSD_LONG_RUNNERS, the agent-routed
   * branch) keep working unchanged. This collapses the 19 flat `gsd-*`
   * entries into a single `/get-shit-done` top-level command on Discord —
   * reclaiming 18 slots in Discord's per-guild 100-command cap and giving
   * operators a self-organizing namespace in the slash menu.
   */
  readonly subcommandOf?: string;
};

// Phase 87 CMD-04 — clawcode-compact + clawcode-usage REMOVED from
// DEFAULT_SLASH_COMMANDS. They are re-provided by the SDK registration loop
// in slash-commands.ts via native-cc-commands.buildNativeCommandDefs as
// native-dispatch entries (nativeBehavior:"prompt-channel"). The native
// path is the ONLY path for /compact and /cost going forward.

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
    description: "Set reasoning effort level (admin-clawdy only)",
    claudeCommand: "__effort__{level}",
    // Phase 100 follow-up — `"0"` hides the command from every non-admin
    // user. Only the guild owner / admins see it. Even then, the handler
    // at slash-commands.ts:1443 rejects invocation outside #admin-clawdy.
    // Truly per-channel hiding (so even the owner doesn't see it outside
    // #admin-clawdy) requires the operator to set channel overrides
    // manually in Discord's Server Settings UI — bots can't push that.
    defaultMemberPermissions: "0",
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
      // Phase 100 follow-up — optional target agent. When provided, applies
      // the effort to that agent (validated against sessionManager.getAgentConfig).
      // When omitted, applies to the channel-bound agent — which under the
      // admin-clawdy channel guard at slash-commands.ts:1443 is admin-clawdy
      // itself. Free-text by design: the choices list would have to enumerate
      // every configured agent statically and stay in sync via codegen, which
      // is heavier than just typing the name.
      {
        name: "agent",
        type: 3,
        description: "Target agent name (default: admin-clawdy)",
        required: false,
      },
    ],
  },
  {
    name: "clawcode-skills-browse",
    description: "Browse the skills marketplace and install one to this agent",
    // Phase 88 MKT-01 / UI-01 — inline handler in slash-commands.ts owns the
    // entire flow (StringSelectMenuBuilder + IPC marketplace-list/install).
    // claudeCommand empty (no LLM-prompt routing) — mirrors Phase 86
    // /clawcode-model. options=[] per UI-01 (zero free-text args).
    claudeCommand: "",
    options: [],
  },
  {
    name: "clawcode-skills",
    description: "List installed skills for this agent (with remove option)",
    // Phase 88 MKT-07 / UI-01 — inline handler renders the installed list +
    // native StringSelectMenuBuilder remove picker, dispatches
    // IPC marketplace-remove on selection.
    claudeCommand: "",
    options: [],
  },
  {
    name: "clawcode-plugins-browse",
    description: "Browse ClawHub plugins and install one to this agent",
    // Phase 90 Plan 05 HUB-02 / UI-01 — inline handler in slash-commands.ts
    // owns the entire flow (StringSelectMenuBuilder → manifest fetch →
    // ModalBuilder config collection → IPC marketplace-install-plugin →
    // exhaustive renderPluginInstallOutcome). Mirrors Phase 88
    // /clawcode-skills-browse shape byte-for-byte.
    claudeCommand: "",
    options: [],
  },
  {
    name: "clawcode-clawhub-auth",
    description:
      "Authenticate ClawCode with ClawHub via GitHub OAuth (device-code flow)",
    // Phase 90 Plan 06 HUB-07 / UI-01 — inline handler in slash-commands.ts
    // runs the GitHub device-code flow. Shows an embed with the user_code +
    // verification_uri, long-polls the token endpoint via IPC, then stores
    // the resulting access_token at op://clawdbot/ClawHub Token/credential.
    claudeCommand: "",
    options: [],
  },
] as const;

/**
 * Phase 100 follow-up — auto-inherited slash commands for any agent with
 * `gsd.projectDir` configured. Operator-curated subset of the ~57 GSD skills
 * in ~/.claude/commands/gsd/ — covers the most common paths so operators
 * don't hit "command not found" friction in the Discord slash menu. The full
 * 57 remain available via plain-text /gsd:* typing.
 *
 * Auto-injected at register time (slash-commands.ts register loop) when at
 * least one agent has `gsd?.projectDir` set. Per-agent yaml entries with
 * matching names get deduped via the existing `seenNames` set so the legacy
 * Phase 100 yaml block on Admin Clawdy keeps working unchanged.
 *
 * Phase 999.21 — entries are now NESTED subcommands under a single top-level
 * `/get-shit-done` command (each entry has `subcommandOf: "get-shit-done"`).
 * The slash-commands.ts register loop groups every entry whose `subcommandOf`
 * matches into ONE composite Discord body item (type=1 SUB_COMMAND children),
 * collapsing 19 flat `gsd-*` slots into 1 namespaced slot. The handleInteraction
 * dispatcher rewrites `commandName === "get-shit-done"` + `getSubcommand()`
 * back to the legacy flat form (`gsd-${sub}`) at the top of the function so
 * every downstream carve-out keeps matching by the legacy strings unchanged.
 *
 * Dispatch (post-rewrite, all carve-outs see the legacy `gsd-*` names):
 *   - `/get-shit-done autonomous`, `/get-shit-done plan-phase`,
 *     `/get-shit-done execute-phase` route to handleGsdLongRunner (subagent
 *     thread spawn) when GSD_LONG_RUNNERS matches the rewritten name.
 *   - `/get-shit-done set-project` is handled inline by handleSetGsdProjectCommand
 *     (validates path + dispatches IPC `set-gsd-project`); claudeCommand
 *     intentionally empty so any accidental fallback to formatCommandMessage
 *     emits a no-op string the inline short-circuit prevents from being sent.
 *   - All other entries fall through to the legacy agent-routed branch where
 *     formatCommandMessage rewrites their claudeCommand template into the
 *     canonical SDK form for inline dispatch via the user's settingSources
 *     (loads ~/.claude/commands/gsd/*.md per Plan 100-06 symlinks).
 *
 * The `name` field on each entry is the SUBCOMMAND name (e.g. "autonomous",
 * "plan-phase", "set-project") — NOT the full flat name. The composite
 * top-level command is named `"get-shit-done"`.
 */
export const GSD_SLASH_COMMANDS: readonly SlashCommandDef[] = [
  // The 5 originally shipped in Phase 100 Plan 04 (also live in Admin Clawdy's
  // yaml block — dedup via seenNames keeps both registrations safe).
  {
    name: "autonomous",
    subcommandOf: "get-shit-done",
    description: "Run all remaining phases autonomously",
    claudeCommand: "/gsd:autonomous {args}",
    options: [
      { name: "args", type: 3, description: "Optional flags (e.g. --from 100)", required: false },
    ],
  },
  {
    name: "plan-phase",
    subcommandOf: "get-shit-done",
    description: "Create phase plan with verification loop",
    claudeCommand: "/gsd:plan-phase {phase}",
    options: [
      { name: "phase", type: 3, description: "Phase number + optional flags", required: false },
    ],
  },
  {
    name: "execute-phase",
    subcommandOf: "get-shit-done",
    description: "Execute all plans in a phase",
    claudeCommand: "/gsd:execute-phase {phase}",
    options: [
      { name: "phase", type: 3, description: "Phase number + optional flags", required: false },
    ],
  },
  {
    name: "debug",
    subcommandOf: "get-shit-done",
    description: "Systematic debugging with persistent state",
    claudeCommand: "/gsd:debug {issue}",
    options: [
      { name: "issue", type: 3, description: "Issue description", required: true },
    ],
  },
  {
    name: "quick",
    subcommandOf: "get-shit-done",
    description: "Quick task with GSD guarantees",
    claudeCommand: "/gsd:quick {task}",
    options: [
      { name: "task", type: 3, description: "Task description", required: true },
    ],
  },

  // Phase 100 follow-up additions — operator hit friction (these were missing
  // from the slash menu, forcing them to type /gsd:* manually).
  {
    name: "new-project",
    subcommandOf: "get-shit-done",
    description: "Initialize a fresh GSD project (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, codebase maps)",
    claudeCommand: "/gsd:new-project {args}",
    options: [
      { name: "args", type: 3, description: "Optional project description", required: false },
    ],
  },
  {
    name: "new-milestone",
    subcommandOf: "get-shit-done",
    description: "Create a new milestone in the current project",
    claudeCommand: "/gsd:new-milestone {args}",
    options: [
      { name: "args", type: 3, description: "Milestone description", required: false },
    ],
  },
  {
    name: "add-phase",
    subcommandOf: "get-shit-done",
    description: "Insert a new phase into the current milestone",
    claudeCommand: "/gsd:add-phase {args}",
    options: [
      { name: "args", type: 3, description: "Phase description", required: false },
    ],
  },
  {
    name: "add-tests",
    subcommandOf: "get-shit-done",
    description: "Add tests for an existing phase or plan",
    claudeCommand: "/gsd:add-tests {args}",
    options: [
      { name: "args", type: 3, description: "Target (phase/plan id)", required: false },
    ],
  },
  {
    name: "audit-milestone",
    subcommandOf: "get-shit-done",
    description: "Audit milestone before completion",
    claudeCommand: "/gsd:audit-milestone",
    options: [],
  },
  {
    name: "complete-milestone",
    subcommandOf: "get-shit-done",
    description: "Mark current milestone complete + archive",
    claudeCommand: "/gsd:complete-milestone {args}",
    options: [
      { name: "args", type: 3, description: "Milestone version", required: false },
    ],
  },
  {
    name: "cleanup",
    subcommandOf: "get-shit-done",
    description: "Clean up planning artifacts after milestone",
    claudeCommand: "/gsd:cleanup",
    options: [],
  },
  {
    name: "progress",
    subcommandOf: "get-shit-done",
    description: "Show current GSD project progress",
    claudeCommand: "/gsd:progress",
    options: [],
  },
  {
    name: "verify-work",
    subcommandOf: "get-shit-done",
    description: "Manually verify a phase or UAT item",
    claudeCommand: "/gsd:verify-work {args}",
    options: [
      { name: "args", type: 3, description: "Phase/UAT id", required: false },
    ],
  },
  {
    name: "discuss-phase",
    subcommandOf: "get-shit-done",
    description: "Discuss design grey areas before planning",
    claudeCommand: "/gsd:discuss-phase {phase}",
    options: [
      { name: "phase", type: 3, description: "Phase number", required: true },
    ],
  },
  {
    name: "do",
    subcommandOf: "get-shit-done",
    description: "Quick task wrapper with GSD guarantees",
    claudeCommand: "/gsd:do {task}",
    options: [
      { name: "task", type: 3, description: "Task description", required: true },
    ],
  },
  {
    name: "fast",
    subcommandOf: "get-shit-done",
    description: "Lightweight GSD without full ceremony",
    claudeCommand: "/gsd:fast {task}",
    options: [
      { name: "task", type: 3, description: "Task description", required: true },
    ],
  },
  {
    name: "help",
    subcommandOf: "get-shit-done",
    description: "GSD framework help",
    claudeCommand: "/gsd:help {args}",
    options: [
      { name: "args", type: 3, description: "Command name (optional)", required: false },
    ],
  },

  // The runtime project switcher — handled inline (not routed to LLM).
  // claudeCommand "" mirrors /clawcode-model and /clawcode-skills-browse.
  {
    name: "set-project",
    subcommandOf: "get-shit-done",
    description: "Switch this agent's gsd.projectDir at runtime (avoids yaml edit + restart)",
    claudeCommand: "",
    options: [
      { name: "path", type: 3, description: "Absolute path to the new project directory", required: true },
    ],
  },

  // Phase 999.31 — ultra-* commands (consensus planning + multi-agent review).
  // These delegate to OMC marketplace skills (ralplan = consensus planner via
  // Planner/Architect/Critic loop) and Claude Code's built-in /ultrareview
  // (multi-agent cloud review of branch or PR).
  {
    name: "ultra-plan",
    subcommandOf: "get-shit-done",
    description: "Consensus planning — Planner + Architect + Critic loop",
    claudeCommand: "/oh-my-claudecode:ralplan {args}",
    options: [
      { name: "args", type: 3, description: "Task description", required: true },
    ],
  },
  {
    name: "ultra-review",
    subcommandOf: "get-shit-done",
    description: "Multi-agent cloud review of current branch (or specific PR)",
    claudeCommand: "/ultrareview {args}",
    options: [
      { name: "args", type: 3, description: "Optional PR number", required: false },
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
  // Phase 91 Plan 05 SYNC-08 / UI-01 — daemon-routed OpenClaw ↔ ClawCode
  // sync status view. Reads ~/.clawcode/manager/sync-state.json + tails
  // ~/.clawcode/manager/sync.jsonl via ipcMethod "list-sync-status". The
  // inline handler in slash-commands.ts renders the reply as a native
  // Discord EmbedBuilder (UI-01 compliance — NOT free-text). Zero LLM
  // turn cost per invocation. Fleet-level (no per-agent argument): the
  // sync state is singleton for the fin-acquisition topology.
  {
    name: "clawcode-sync-status",
    description:
      "Show current OpenClaw ↔ ClawCode sync status and any active conflicts",
    claudeCommand: "",
    control: true,
    ipcMethod: "list-sync-status",
    options: [],
  },
  // Phase 95 Plan 03 DREAM-07 / UI-01 — operator-driven manual dream-pass
  // trigger. Admin-only ephemeral; the inline-short-circuit handler in
  // slash-commands.ts checks isAdminClawdyInteraction BEFORE routing through
  // ipcMethod "run-dream-pass" so non-admins get an instant "Admin-only
  // command" reply (zero IPC + zero LLM turn cost). Renders the
  // DreamPassOutcome via renderDreamEmbed (themedReflection + counts +
  // cost + log path). 10th application of the inline-short-circuit pattern.
  {
    name: "clawcode-dream",
    description:
      "Trigger a dream pass for an agent (admin-only operator-driven reflection)",
    claudeCommand: "",
    control: true,
    ipcMethod: "run-dream-pass",
    options: [
      {
        name: "agent",
        type: 3,
        description: "Agent name to dream",
        required: true,
      },
    ],
  },
  // Phase 92 Plan 04 CUT-06 / CUT-07 / UI-01 — daemon-routed cutover verify.
  // Reads CUTOVER-GAPS.json (Plan 92-02) and renders ONE ephemeral embed per
  // destructive gap (or batched if > 10) with Accept/Reject/Defer buttons.
  // The buttons use the `cutover-{agent}-{gapId}:{action}` customId namespace
  // (collision-safe — see daemon-cutover-button.test.ts D2). Operator clicks
  // route through ipcMethod "cutover-button-action" → daemon's pure
  // handleCutoverButtonActionIpc → applyDestructiveFix or audit-only ledger row.
  // Inline-short-circuit handler in slash-commands.ts mirrors the Phase 85/86/
  // 87/88/91 pattern. Zero LLM turn cost per invocation (UI-01).
  {
    name: "clawcode-cutover-verify",
    description:
      "Surface destructive cutover gaps for the bound agent (Accept/Reject/Defer per gap)",
    claudeCommand: "",
    control: true,
    ipcMethod: "cutover-verify-summary",
    options: [
      {
        name: "agent",
        type: 3,
        description: "Agent name (defaults to the channel's bound agent)",
        required: false,
      },
    ],
  },
  // Phase 96 Plan 05 PFS- / UI-01 — operator-driven on-demand filesystem
  // capability re-probe. Admin-only ephemeral; the inline-short-circuit
  // handler in slash-commands.ts checks isAdminClawdyInteraction BEFORE
  // routing through ipcMethod "probe-fs" so non-admins get an instant
  // "Admin-only command" reply (zero IPC + zero LLM turn cost). Renders
  // FsProbeOutcome via renderProbeFsEmbed (paths probed, ready/degraded
  // counts, top 3 changes since last probe). 11th application of the
  // inline-short-circuit pattern (after Phases 85/86/87/88/90/91/92/95).
  // D-03 refresh trigger: operator runs after ACL/group/systemd change
  // to force re-probe BEFORE asking user to retry — eliminates the 60s
  // heartbeat-stale window per RESEARCH.md Pitfall 7.
  {
    name: "clawcode-probe-fs",
    description:
      "Force re-probe of an agent's filesystem capability (admin-only)",
    claudeCommand: "",
    control: true,
    ipcMethod: "probe-fs",
    options: [
      {
        name: "agent",
        type: 3,
        description: "Agent name to re-probe",
        required: true,
      },
    ],
  },
  // Phase 103 OBS-07 / UI-01 — daemon-routed OAuth Max usage panel. Reads
  // the per-agent RateLimitTracker via ipcMethod "list-rate-limit-snapshots"
  // (NOT "rate-limit-status" which is the SEPARATE Discord outbound rate-
  // limiter IPC at protocol.ts:17 — see Pitfall 5). The inline handler in
  // slash-commands.ts renders an EmbedBuilder (UI-01 compliance — NOT free-
  // text). Zero LLM turn cost per invocation. 12th application of the
  // inline-handler-short-circuit-before-CONTROL_COMMANDS pattern (Phases
  // 85/86/87/88/90/91/92/95/96/100).
  {
    name: "clawcode-usage",
    description: "Show OAuth Max session/weekly usage for the bound agent",
    claudeCommand: "",
    control: true,
    ipcMethod: "list-rate-limit-snapshots",
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
