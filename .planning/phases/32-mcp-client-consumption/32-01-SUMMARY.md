---
phase: 32-mcp-client-consumption
plan: 01
subsystem: config
tags: [mcp, zod, yaml, sdk, session-adapter]

requires:
  - phase: 31-subagent-thread-skill
    provides: existing session-adapter and session-config patterns
provides:
  - mcpServerSchema for MCP server config validation
  - per-agent and shared mcpServers in clawcode.yaml schema
  - MCP server resolution in config loader (string refs to shared defs)
  - mcpServers field on ResolvedAgentConfig and AgentSessionConfig
  - SDK session creation receives mcpServers in Record format
affects: [32-mcp-client-consumption]

tech-stack:
  added: []
  patterns: [shared-config-resolution, array-to-record-sdk-transform]

key-files:
  created:
    - src/manager/__tests__/mcp-session.test.ts
  modified:
    - src/config/schema.ts
    - src/shared/types.ts
    - src/config/loader.ts
    - src/manager/types.ts
    - src/manager/sdk-types.ts
    - src/manager/session-config.ts
    - src/manager/session-adapter.ts
    - src/config/__tests__/schema.test.ts
    - src/config/__tests__/loader.test.ts

key-decisions:
  - "MCP servers defined as union of inline objects or string refs in per-agent config"
  - "Shared MCP server definitions at config root level as Record keyed by name"
  - "Deduplication by name with later entries winning on collision"
  - "SDK receives mcpServers as Record<name, {command, args, env}> matching SDK API"

patterns-established:
  - "Shared config resolution: top-level definitions referenceable by string name in per-agent config"
  - "Array-to-Record transform for SDK options (transformMcpServersForSdk helper)"

requirements-completed: [MCPC-01, MCPC-02, MCPC-06]

duration: 4min
completed: 2026-04-09
---

# Phase 32 Plan 01: MCP Client Config Summary

**MCP server config in clawcode.yaml with shared definitions, per-agent resolution, and SDK session passthrough**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-09T22:11:04Z
- **Completed:** 2026-04-09T22:15:31Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- clawcode.yaml schema accepts per-agent mcpServers as inline objects or string references to shared definitions
- Shared MCP server definitions at config root level resolve correctly into per-agent configs with deduplication
- SDK session creation receives MCP server configs so Claude Code natively activates them on agent startup
- 57 tests pass covering schema validation, resolution logic, and session config passthrough

## Task Commits

Each task was committed atomically:

1. **Task 1: Add MCP server config schema, types, and resolution** - `344c1b7` (feat)
2. **Task 2: Pass MCP server configs to SDK session creation** - `c453a97` (feat)

_Note: TDD tasks each include both test and implementation in single commits._

## Files Created/Modified
- `src/config/schema.ts` - Added mcpServerSchema, per-agent mcpServers union, shared mcpServers record
- `src/shared/types.ts` - Added mcpServers field to ResolvedAgentConfig
- `src/config/loader.ts` - MCP server resolution from shared definitions, string ref lookup
- `src/manager/types.ts` - Added mcpServers to AgentSessionConfig
- `src/manager/sdk-types.ts` - Added mcpServers to SdkSessionOptions in SDK Record format
- `src/manager/session-config.ts` - Pass mcpServers through to session config
- `src/manager/session-adapter.ts` - transformMcpServersForSdk helper, pass to createSession/resumeSession
- `src/config/__tests__/schema.test.ts` - Tests for mcpServerSchema and config-level mcpServers
- `src/config/__tests__/loader.test.ts` - Tests for shared ref resolution, inline passthrough, merge behavior
- `src/manager/__tests__/mcp-session.test.ts` - Tests for session config and SDK transform

## Decisions Made
- MCP servers use union type (inline object or string ref) for flexible YAML authoring
- Shared definitions stored as Record<string, McpServerSchemaConfig> at config root
- Deduplication by name with later entries winning allows overrides (inline over shared ref)
- SDK format is Record<name, {command, args, env}> matching Claude Code SDK API expectations

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added mcpServers to existing test fixtures in loader.test.ts**
- **Found during:** Task 1
- **Issue:** Adding required mcpServers field to AgentConfig caused existing test fixtures to be incomplete
- **Fix:** Added `mcpServers: []` and `reactions: true` to all existing AgentConfig fixtures
- **Files modified:** src/config/__tests__/loader.test.ts
- **Verification:** All 46 config tests pass
- **Committed in:** 344c1b7 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to maintain existing test compatibility. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- MCP server config flows from YAML through to SDK session creation
- Ready for MCP tool discovery (system prompt injection) and status CLI in subsequent plans

---
*Phase: 32-mcp-client-consumption*
*Completed: 2026-04-09*
