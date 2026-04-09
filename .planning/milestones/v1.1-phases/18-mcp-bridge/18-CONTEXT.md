# Phase 18: MCP Bridge - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose ClawCode tools (memory search, agent messaging, scheduling, status) as an MCP stdio server. External Claude Code sessions can connect to it via MCP client configuration. Implements the @modelcontextprotocol/sdk server pattern so any Claude Code instance can interact with the ClawCode system.

</domain>

<decisions>
## Implementation Decisions

### MCP Server
- **D-01:** Implement MCP server using `@modelcontextprotocol/sdk` Server class with stdio transport
- **D-02:** Server exposes tools: `memory_search`, `send_message`, `agent_status`, `list_schedules`, `list_agents`
- **D-03:** Server runs as a standalone process that connects to the daemon via IPC (Unix socket)
- **D-04:** Entry point: `src/mcp/server.ts` with `clawcode mcp` CLI command to start it

### Tool Definitions
- **D-05:** `memory_search` -- search an agent's memory by query text, returns ranked results
- **D-06:** `send_message` -- send a message to an agent's inbox
- **D-07:** `agent_status` -- get status of all agents or a specific agent
- **D-08:** `list_schedules` -- show scheduled tasks across agents
- **D-09:** `list_agents` -- list all configured agents with their status

### Integration
- **D-10:** External Claude Code sessions add this server to their MCP config: `{ "command": "clawcode", "args": ["mcp"] }`
- **D-11:** MCP server reuses existing IPC client for daemon communication
- **D-12:** Tool responses follow MCP content format (text content blocks)

### Claude's Discretion
- Whether to add MCP resources (e.g., agent memory as resources)
- Error formatting for MCP tool failures
- Whether to add prompts/templates as MCP features

</decisions>

<canonical_refs>
## Canonical References
- `src/ipc/client.ts` -- IPC client for daemon communication
- `src/ipc/protocol.ts` -- IPC methods available
- `src/memory/search.ts` -- SemanticSearch for memory queries
- `src/manager/daemon.ts` -- Available daemon operations
- `@modelcontextprotocol/sdk` -- MCP SDK for server implementation
</canonical_refs>

<code_context>
## Reusable Assets
- IPC client sendIpcRequest for daemon communication
- Existing IPC methods map directly to MCP tools
- CLI command registration pattern from other commands
</code_context>

<specifics>
## Specific Ideas
- MCP server could expose agent workspaces as MCP resources for file browsing
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 18-mcp-bridge*
