# Phase 12: Discord Slash Commands - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds Discord slash command registration and mapping to Claude Code skills/commands. After this phase, the daemon auto-registers configured slash commands with Discord's API on startup, users can invoke them in Discord channels, and they're routed to the correct agent as Claude Code skill invocations with argument passthrough.

</domain>

<decisions>
## Implementation Decisions

### Command Registration
- **D-01:** Slash commands defined per-agent in clawcode.yaml under a `slashCommands` array
- **D-02:** Each command has: name, description, claudeCommand (the skill/prompt to invoke), options (array of Discord command options with name, type, description, required)
- **D-03:** Commands registered with Discord's REST API on daemon startup using discord.js's REST module (already installed)
- **D-04:** Guild-scoped registration (instant, not global which takes up to 1 hour)
- **D-05:** Commands unregistered on clean shutdown (or left registered — Discord handles stale commands gracefully)

### Command Execution
- **D-06:** When a slash command is invoked, the daemon's discord.js client receives an `interactionCreate` event
- **D-07:** The interaction is matched to an agent via channel binding (same routing as messages)
- **D-08:** The command and its arguments are formatted as a message to the agent: `/skill-name arg1 arg2` or a natural language prompt incorporating the args
- **D-09:** Agent processes the command via its session and responds
- **D-10:** Response sent back via interaction.reply() for clean Discord UX (shows "thinking..." indicator)

### Default Commands
- **D-11:** Ship with sensible default commands that map common operations:
  - `/status` → agent status check
  - `/memory <query>` → search agent memory
  - `/schedule` → show agent's scheduled tasks
  - `/health` → heartbeat status
  - `/compact` → trigger context compaction
- **D-12:** Agents can also have custom commands defined in their config

### Architecture
- **D-13:** Reuse the existing discord.js client from the bridge module (re-enable the discord.js connection in the daemon for slash command handling)
- **D-14:** Slash command handler is a separate module (`src/discord/slash-commands.ts`) that registers and handles interactions
- **D-15:** The handler calls `sendToAgent()` for commands that need a response, `forwardToAgent()` for fire-and-forget

### Claude's Discretion
- Exact default command definitions
- Ephemeral vs public responses
- How to handle long-running commands (deferred responses)
- Error formatting for failed commands

</decisions>

<canonical_refs>
## Canonical References

### Existing Codebase
- `src/discord/bridge.ts` — Discord.js client setup (reuse connection pattern)
- `src/discord/types.ts` — Discord routing types
- `src/manager/session-manager.ts` — sendToAgent, forwardToAgent
- `src/manager/daemon.ts` — Daemon startup
- `src/config/schema.ts` — Config schema
- `src/ipc/protocol.ts` — IPC methods

### Discord.js References
- discord.js REST API for command registration
- SlashCommandBuilder for command definitions
- InteractionCreate event for handling

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- discord.js already installed (v14)
- Discord bridge module has client setup pattern
- SessionManager.sendToAgent() for command execution
- Channel routing table for agent lookup

### Integration Points
- Daemon: initialize slash command handler after discord.js client connects
- Config: per-agent slashCommands array
- Discord client: interactionCreate listener

</code_context>

<specifics>
## Specific Ideas
- Use interaction.deferReply() for commands that take time, then editReply() with result
- Slash command responses should be formatted nicely (embeds or markdown)
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 12-discord-slash-commands*
*Context gathered: 2026-04-09*
