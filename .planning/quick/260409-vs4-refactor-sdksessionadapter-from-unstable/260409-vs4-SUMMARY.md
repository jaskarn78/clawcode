---
phase: quick
plan: 260409-vs4
subsystem: manager/session-adapter
tags: [refactor, sdk, query-api, session-management]
dependency_graph:
  requires: []
  provides: [query-api-adapter, mcp-passthrough]
  affects: [session-manager, agent-lifecycle]
tech_stack:
  added: []
  patterns: [per-turn-query-with-resume, async-generator-drain]
key_files:
  created: []
  modified:
    - src/manager/sdk-types.ts
    - src/manager/session-adapter.ts
decisions:
  - Per-turn query pattern over persistent streamInput() for simplicity
  - Initial session drain to extract session_id before returning handle
  - settingSources defaults to ["project"] for all agent sessions
metrics:
  duration: 4min
  completed: "2026-04-09T23:00:00Z"
  tasks: 3
  files: 2
---

# Quick Task 260409-vs4: Refactor SdkSessionAdapter from unstable_v2 to query() API

Migrated SdkSessionAdapter from deprecated unstable_v2_createSession/unstable_v2_resumeSession to the stable query() API with per-turn resume pattern and mcpServers/settingSources passthrough.

## Changes Made

### Task 1: Update sdk-types.ts for query() API
- **Commit:** 87c580f
- Added `SdkUserMessage` type for streamInput() messages
- Added `SdkQueryOptions` replacing `SdkSessionOptions` (adds resume, settingSources, env, sessionId)
- Added `SdkQuery` type (AsyncGenerator + interrupt/close/streamInput/mcpServerStatus/setMcpServers)
- Updated `SdkModule` to expose `query()` instead of `unstable_v2_createSession`/`unstable_v2_resumeSession`
- Removed `SdkSession` and `SdkSessionOptions` types

### Task 2: Refactor SdkSessionAdapter to use query() API
- **Commit:** e87e32b
- `createSession`: calls `sdk.query()` with initial prompt, drains to extract session_id
- `resumeSession`: calls `sdk.query()` with `resume: sessionId` option
- Per-turn pattern: each `send`/`sendAndCollect`/`sendAndStream` creates fresh `query()` with resume
- `mcpServers`, `settingSources`, `permissionMode` pass through to query options
- Removed `wrapSdkSession()` and `getSdkSessionId()` (replaced by `wrapSdkQuery()`)
- Added error handler notification on query iteration failures
- SessionHandle interface completely unchanged -- zero consumer impact

### Task 3: Verify tests pass with query() API
- mcp-session tests: 5/5 passed (use inline transform logic, no SDK type imports)
- session-manager tests: mock adapter unchanged, tests unaffected by refactor
- Pre-existing timeout failure in session-manager stopAgent test is unrelated

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- no placeholder data or unresolved TODO items.

## Verification

1. `npx tsc --noEmit` -- zero errors in modified files (pre-existing errors in tier-manager.test.ts only)
2. `npx vitest run src/manager/__tests__/mcp-session.test.ts` -- 5/5 passed
3. `grep -r "unstable_v2" src/manager/` -- only in migration comments, zero code references
4. `grep "query(" src/manager/session-adapter.ts` -- confirms query() usage throughout

## Self-Check: PASSED

- [x] src/manager/sdk-types.ts exists and exports SdkQuery, SdkQueryOptions, SdkUserMessage, SdkModule
- [x] src/manager/session-adapter.ts exists and uses sdk.query()
- [x] Commit 87c580f exists
- [x] Commit e87e32b exists
