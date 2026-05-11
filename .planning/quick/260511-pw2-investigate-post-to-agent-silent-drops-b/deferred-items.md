# Deferred items (out-of-scope discoveries)

## Pre-existing test failure: src/mcp/server.test.ts "has exactly 22 tools defined"

- Test asserts `TOOL_DEFINITIONS.length === 22`; actual count is 27.
- Pre-dates this quick task (verified via `git stash` baseline).
- Not caused by 260511-pw2 or 260511-pw3.
- Owner action: update the magic number when tool count stabilizes (or
  replace the brittle count assertion with an explicit allow-list).
