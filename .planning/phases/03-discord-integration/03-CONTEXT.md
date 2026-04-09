# Phase 3: Discord Integration - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers Discord channel-to-agent message routing with rate limiting. After this phase, messages sent in a Discord channel are received and processed by the correct agent, responses appear in the originating channel, and rate limits are respected across all agents sharing a bot token. No memory system, no heartbeat — just Discord routing.

</domain>

<decisions>
## Implementation Decisions

### Discord Plugin Integration
- **D-01:** Each agent's Claude Code SDK session already has access to the Discord plugin via MCP tools (reply, fetch_messages, react, etc.)
- **D-02:** The manager configures each agent session with its allowed channel IDs from clawcode.yaml
- **D-03:** Channel binding is enforced at the agent level — agents only process messages from their bound channels
- **D-04:** The existing Discord plugin (`plugin:discord:discord`) handles the actual Discord WebSocket connection and message delivery

### Message Routing
- **D-05:** Messages arrive via the Discord plugin to the Claude Code session. The manager's role is ensuring the RIGHT session is bound to the RIGHT channel
- **D-06:** Channel-to-agent mapping is read from clawcode.yaml config on daemon startup
- **D-07:** If a message arrives in a channel with no agent binding, it is ignored (not routed to any agent)
- **D-08:** Multiple channels can map to a single agent (one agent can handle multiple channels)

### Rate Limiting
- **D-09:** Centralized token bucket rate limiter since all agents share one Discord bot token
- **D-10:** Rate limit: 50 requests per second (Discord's global rate limit per bot token)
- **D-11:** Rate limiter state stored in a shared JSON file or in-memory within the daemon process
- **D-12:** Agents that hit the rate limit queue their responses rather than dropping them
- **D-13:** Per-channel rate limits also respected (5 messages per 5 seconds per channel)

### Response Delivery
- **D-14:** Agent sessions use the Discord plugin's `reply` MCP tool natively — no custom response delivery
- **D-15:** Responses are delivered to the same channel the message came from (handled by the plugin's chat_id parameter)

### Claude's Discretion
- Token bucket implementation details (sliding window vs fixed window)
- Queue overflow behavior (max queue depth before dropping)
- Logging format for message routing events
- Error handling for Discord API failures (retry, backoff, etc.)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Codebase
- `src/config/schema.ts` — Config schema with agent channel bindings
- `src/manager/session-manager.ts` — SessionManager that manages agent sessions
- `src/manager/daemon.ts` — Daemon that starts sessions and IPC server
- `src/manager/types.ts` — AgentStatus, RegistryEntry types
- `src/ipc/protocol.ts` — IPC protocol for CLI-daemon communication

### Research
- `.planning/research/PITFALLS.md` — Discord rate limits section (50 req/s per bot token)
- `.planning/research/ARCHITECTURE.md` — Discord plugin delegation pattern

### Discord Plugin Reference
- The Discord plugin exposes MCP tools: reply, fetch_messages, react, edit_message, download_attachment
- Messages arrive as `<channel>` tags with chat_id, message_id, user, ts attributes

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/manager/session-manager.ts`: SessionManager — extend to configure agent sessions with Discord channel bindings
- `src/manager/daemon.ts`: Daemon startup — extend to initialize Discord routing and rate limiter
- `src/config/schema.ts`: Config already has channels array per agent — used for routing
- `src/ipc/protocol.ts`: IPC protocol — extend with Discord-specific commands if needed

### Established Patterns
- SessionAdapter interface for abstracting SDK sessions
- IPC server/client for daemon communication
- Zod schema validation for config and protocols
- Atomic JSON file writes for state persistence

### Integration Points
- Daemon startup: after creating SessionManager, initialize rate limiter and configure channel routing
- Agent session creation: pass channel bindings as part of session system prompt/config
- IPC: potentially add Discord-specific commands (e.g., check routing status)

</code_context>

<specifics>
## Specific Ideas

- Rate limiter should be a standalone module (reusable for other rate-limited services later)
- Channel routing table should be queryable via CLI (`clawcode routes` or similar)
- Consider adding a `clawcode channels` command that shows which agent handles which channel

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-discord-integration*
*Context gathered: 2026-04-09*
