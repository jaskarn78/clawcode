# Deferred Items — Phase 53

## Pre-existing failures outside Phase 53 scope

### src/mcp/server.test.ts — "TOOL_DEFINITIONS has exactly 8 tools defined"

- **Expected**: 8 tools
- **Actual**: 16 tools
- **Status**: Pre-existing before Phase 53 Plan 02 work (verified via `git stash` + retest on `e660b38`).
- **Scope**: unrelated to context-token-budget-tuning; the MCP tool count has drifted from the test's literal since a prior phase added new tools.
- **Owner**: Future phase (likely a quick-fix task) to update the assertion to track the current tool catalog. NOT addressed in Phase 53 per SCOPE BOUNDARY rule.
