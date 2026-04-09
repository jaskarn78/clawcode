# Phase 19: Discord Reaction Handling - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents can add reactions to Discord messages and respond to reaction events. The bridge listens for messageReactionAdd and messageReactionRemove events. Reactions are forwarded to the agent session as structured messages. Agents can react to messages via their Discord plugin's react tool.

</domain>

<decisions>
## Implementation Decisions

### Reaction Events
- **D-01:** Bridge listens for `messageReactionAdd` and `messageReactionRemove` events
- **D-02:** Only reactions in bound channels are forwarded to agents
- **D-03:** Reaction events are formatted as structured messages: `<reaction type="add|remove" emoji="..." user="..." message_id="..." channel_id="...">`
- **D-04:** Bot's own reactions are ignored (prevent feedback loops)

### Reaction Forwarding
- **D-05:** Reactions forwarded to the bound agent via `sessionManager.forwardToAgent()`
- **D-06:** Thread reactions route to thread sessions if a binding exists
- **D-07:** Reaction events include the original message content if available for context

### Agent Reactions
- **D-08:** Agents use the existing Discord MCP plugin `react` tool for adding reactions
- **D-09:** No new agent-side code needed -- the plugin already supports reactions

### Configuration
- **D-10:** Reactions can be disabled per-agent via `reactions: false` in config (default: true)
- **D-11:** Optional reaction filter: only forward specific emoji reactions

### Claude's Discretion
- Whether to batch rapid reaction events
- How to handle partial/cached reactions
- Rate limiting for reaction forwarding

</decisions>

<canonical_refs>
## Canonical References
- `src/discord/bridge.ts` -- Event listeners (extend for reactions)
- `src/discord/types.ts` -- Type definitions
- `src/config/schema.ts` -- Config schema (extend for reactions)
- `src/shared/types.ts` -- ResolvedAgentConfig
- `src/manager/session-manager.ts` -- forwardToAgent
</canonical_refs>

<code_context>
## Reusable Assets
- Bridge event listener pattern from messageCreate and threadCreate
- Message formatting pattern from formatDiscordMessage
- Config schema extension pattern
- Thread routing check pattern for reaction thread forwarding
</code_context>

<specifics>
## Specific Ideas
- Configurable emoji-to-action mappings per agent
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 19-discord-reaction-handling*
