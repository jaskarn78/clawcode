# Phase 44: Agent-to-agent Discord communication - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents can send messages to each other through Discord. A sending agent invokes an MCP tool that posts to the receiving agent's Discord channel via webhook. The receiving agent processes the message like any channel message, enabling visible, auditable inter-agent communication.

</domain>

<decisions>
## Implementation Decisions

### Message Delivery Mechanism
- MCP tool `send_to_agent` posts to target agent's Discord channel via existing webhook identity system
- Messages appear in the target agent's Discord channel — visible and auditable by operators
- Receiving agent auto-responds by processing the webhook message through normal Discord bridge routing
- No allowlist restrictions — any agent can message any other agent in the same workspace

### Message Format & Routing
- Sender specifies target by agent name: `send_to_agent(to: "agent-b", message: "...")`
- Messages rendered as webhook embeds with sender name, agent badge, and content — visually distinct from human messages
- MCP tool returns synchronous delivery confirmation: `{delivered: true, messageId: "..."}`
- Messages to offline/stopped agents are queued in filesystem inbox AND posted to Discord channel (agent picks up on restart)

### Integration & Scope
- Point-to-point only — no broadcast to all agents
- Receiving agent sees `[Agent Message from X]` context prefix to distinguish from human messages
- Complements existing filesystem inbox (Discord is primary visible path, inbox is fallback/queue)
- No conversation threading — messages go to main channel. Threading is a future enhancement

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/collaboration/inbox.ts` — filesystem inbox (createMessage, writeMessage, readMessages, markProcessed)
- `src/collaboration/types.ts` — InboxMessage type with priority levels
- `src/discord/webhook-manager.ts` — per-agent webhook identities for Discord
- `src/cli/commands/send.ts` — CLI send command via IPC send-message
- `src/mcp/server.ts` — MCP server where new tools are registered

### Established Patterns
- IPC `send-message` method in daemon.ts routes to inbox writeMessage
- Webhook manager provides per-agent display name + avatar
- RoutingTable has `agentToChannels` reverse mapping (agent name → channel IDs)
- Discord bridge processes channel messages and routes to bound agent sessions

### Integration Points
- New MCP tool registered in `src/mcp/server.ts`
- Webhook posting via existing WebhookManager
- Message routing through Discord bridge's existing message handler
- Delivery queue for rate-limited sending

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches using existing webhook and MCP patterns.

</specifics>

<deferred>
## Deferred Ideas

- Broadcast messaging (send to all agents) — add when there's a clear use case
- Conversation threading (auto-thread for agent-to-agent exchanges) — future enhancement
- Agent-to-agent allowlists — add if abuse/noise becomes an issue

</deferred>
