# Phase 32: MCP Client Consumption - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped per autonomous mode)

<domain>
## Phase Boundary

Agents can connect to and use tools from external MCP servers configured per-agent.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key considerations:
- clawcode.yaml defines MCP servers per agent: name, command, args, env vars
- Shared MCP server definitions (define once at top level, reference by name in agents)
- Daemon passes MCP configs to agent sessions via Claude Code's native settingSources or mcpServers option
- System prompt lists available MCP tools with descriptions for agent discoverability
- Health check: daemon verifies MCP servers start and respond
- CLI `clawcode mcp-servers` shows configured servers per agent with status
- OpenClaw reference: 4 MCP servers (Finnhub financial data, MySQL database, Google Workspace, content library)

### Claude Code MCP Integration
- Claude Code supports MCP servers via settings.json `mcpServers` config
- The Agent SDK's `settingSources` option can point to config files with MCP server definitions
- Alternative: write a per-agent .claude/settings.local.json in the agent workspace with MCP server configs

</decisions>

<code_context>
## Existing Code Insights

### Relevant Files
- `src/config/schema.ts` — config schema (add MCP server definitions)
- `src/config/loader.ts` — config loading and resolution
- `src/manager/session-config.ts` — buildSessionConfig (system prompt, settingSources)
- `src/manager/session-adapter.ts` — SDK session creation (passes options)
- `src/mcp/server.ts` — existing MCP server (ClawCode as MCP server, not client)
- `src/shared/types.ts` — ResolvedAgentConfig

### Established Patterns
- Zod schema for config validation
- buildSessionConfig assembles system prompt with feature injections
- CLI commands follow commander.js pattern with IPC client

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
