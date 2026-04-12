# Phase 47: Discord slash commands for control - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Operators can manage the agent fleet via Discord slash commands that bypass agent sessions and go directly to the daemon via IPC. Four control commands: start, stop, restart, and fleet status.

</domain>

<decisions>
## Implementation Decisions

### Command Set
- Four control commands: `/clawcode-start <agent>`, `/clawcode-stop <agent>`, `/clawcode-restart <agent>`, `/clawcode-fleet`
- Commands bypass agent sessions — direct IPC to daemon for system operations
- Only channels bound to agents (+ designated admin channel if configured) can run control commands
- Control actions use ephemeral replies (only visible to invoker); fleet status is public

### Fleet Status Display
- `/clawcode-fleet` shows table: agent name, status (running/stopped), model, uptime, last activity
- Rendered as Discord embed with color-coded status (green=running, red=stopped)
- Shows all configured agents (single deployment per bot token)

### Implementation Approach
- Extend existing SlashCommandHandler to register control commands alongside agent commands
- Add `control` flag to SlashCommandDef — control commands use IPC, agent commands use sendToAgent
- No confirmation prompts — direct execution (ephemeral replies mitigate accidental invocation)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/discord/slash-commands.ts` — SlashCommandHandler with registration and dispatch
- `src/discord/slash-types.ts` — SlashCommandDef, DEFAULT_SLASH_COMMANDS
- `src/ipc/client.ts` — sendIpcRequest for daemon communication
- `src/manager/daemon.ts` — IPC methods for start, stop, restart, status

### Established Patterns
- Guild-scoped command registration via Discord REST API
- `claudeCommand` template with `{placeholder}` substitution for agent commands
- IPC methods: "start", "stop", "restart", "status" already exist in daemon.ts routeMethod

### Integration Points
- Extend SlashCommandDef type with `control?: boolean` flag
- Add control command definitions to DEFAULT_SLASH_COMMANDS or a separate CONTROL_COMMANDS array
- SlashCommandHandler.handleInteraction routes control commands to IPC instead of sendToAgent
- Use existing IPC methods (start, stop, restart, status) — no new daemon code needed

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches using existing slash command and IPC patterns.

</specifics>

<deferred>
## Deferred Ideas

- Log viewing via slash command — add when there's a clear use case
- Config editing via Discord — too risky for a chat interface
- Per-command permission roles — add if access control becomes needed

</deferred>
