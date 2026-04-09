---
phase: 32-mcp-client-consumption
plan: 02
subsystem: mcp
tags: [mcp, health-check, cli, ipc, system-prompt, json-rpc]

requires:
  - phase: 32-mcp-client-consumption-01
    provides: MCP server config schema, resolution, and session passthrough
provides:
  - MCP tool listing in agent system prompts
  - MCP server health check via JSON-RPC initialize handshake
  - CLI mcp-servers command with agent filter and health check flag
  - IPC mcp-servers method in daemon
affects: [agent-session, mcp, cli]

tech-stack:
  added: []
  patterns: [spawn-and-initialize health check for MCP servers, dynamic import in daemon handler]

key-files:
  created:
    - src/mcp/health.ts
    - src/mcp/__tests__/health.test.ts
    - src/cli/commands/mcp-servers.ts
    - src/cli/commands/__tests__/mcp-servers.test.ts
  modified:
    - src/manager/session-config.ts
    - src/ipc/protocol.ts
    - src/cli/index.ts
    - src/manager/daemon.ts
    - src/manager/__tests__/session-config.test.ts

key-decisions:
  - "Used node:child_process spawn instead of execa for health check to avoid async import complexity in a Promise-based flow"
  - "Dynamic import of health module in daemon handler to avoid circular dependencies"

patterns-established:
  - "MCP health check: spawn server, send JSON-RPC initialize, parse response, kill process"
  - "IPC handler with optional health check flag for lazy vs eager status"

requirements-completed: [MCPC-03, MCPC-04, MCPC-05]

duration: 4min
completed: 2026-04-09
---

# Phase 32 Plan 02: MCP Tool Discoverability Summary

**MCP tool listing in agent system prompts, server health checking via JSON-RPC initialize, and CLI mcp-servers command with IPC plumbing**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-09T22:18:04Z
- **Completed:** 2026-04-09T22:21:48Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Agent system prompts now list available MCP tools with server names and commands when mcpServers is configured
- Health check module spawns MCP server process, sends JSON-RPC initialize request, validates response within configurable timeout
- CLI `clawcode mcp-servers` command shows per-agent MCP server config with optional `--check` flag for health verification
- IPC protocol extended with "mcp-servers" method, daemon routes requests with optional health checking

## Task Commits

Each task was committed atomically:

1. **Task 1: System prompt MCP tools injection and health check module**
   - `b8a2580` (test: failing tests for MCP tools injection and health check)
   - `3c0677b` (feat: MCP tools system prompt injection and health check module)
2. **Task 2: CLI mcp-servers command with IPC plumbing**
   - `2ab2d40` (test: failing tests for CLI mcp-servers command)
   - `7768bdd` (feat: CLI mcp-servers command with IPC plumbing)

## Files Created/Modified
- `src/mcp/health.ts` - MCP server health check via spawn + JSON-RPC initialize handshake
- `src/mcp/__tests__/health.test.ts` - Health check tests with mock server scripts
- `src/cli/commands/mcp-servers.ts` - CLI command with formatMcpServersTable and registerMcpServersCommand
- `src/cli/commands/__tests__/mcp-servers.test.ts` - CLI formatting tests
- `src/manager/session-config.ts` - Added MCP tools section to system prompt
- `src/manager/__tests__/session-config.test.ts` - Added MCP tools injection tests, mcpServers to makeConfig
- `src/ipc/protocol.ts` - Added "mcp-servers" to IPC_METHODS
- `src/cli/index.ts` - Registered mcp-servers command
- `src/manager/daemon.ts` - Added mcp-servers case to routeMethod

## Decisions Made
- Used node:child_process spawn instead of execa for health check to keep the Promise-based flow simpler and avoid ESM dynamic import complexity
- Dynamic import of health module in daemon handler to prevent circular dependency chains
- Health check uses JSON-RPC initialize (MCP protocol handshake) as the liveness probe -- validates the server actually speaks MCP

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added mcpServers to test makeConfig**
- **Found during:** Task 1
- **Issue:** Existing session-config test helper `makeConfig` was missing the `mcpServers` field added in Plan 01, causing TypeScript errors
- **Fix:** Added `mcpServers: []` default to makeConfig helper
- **Files modified:** src/manager/__tests__/session-config.test.ts
- **Committed in:** b8a2580 (part of test commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Test fixture needed updating for new type field. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all data flows are wired to real sources.

## Next Phase Readiness
- MCP client consumption feature complete: config parsing (Plan 01), session passthrough (Plan 01), system prompt injection (Plan 02), health checking (Plan 02), CLI visibility (Plan 02)
- Ready for end-to-end testing with real MCP servers

---
*Phase: 32-mcp-client-consumption*
*Completed: 2026-04-09*
