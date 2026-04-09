---
phase: 22-tech-debt-test-type-safety
plan: 01
subsystem: testing
tags: [vitest, typescript, type-safety, cli, mocks]

# Dependency graph
requires: []
provides:
  - "Zero as-unknown-as casts in test files under src/"
  - "Unit tests for fork, send, webhooks, mcp CLI commands"
affects: [tech-debt-code-quality]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Properly-typed mocks: add all public methods as vi.fn() stubs instead of using as-unknown-as"
    - "CLI command testing: mock IPC client + output + daemon socket, use commander parseAsync"
    - "vi.mocked() for reassigning mock implementations on already-typed objects"

key-files:
  created:
    - src/cli/commands/fork.test.ts
    - src/cli/commands/send.test.ts
    - src/cli/commands/webhooks.test.ts
    - src/cli/commands/mcp.test.ts
  modified:
    - src/heartbeat/checks/__tests__/tier-maintenance.test.ts
    - src/heartbeat/checks/__tests__/consolidation.test.ts
    - src/discord/thread-manager.test.ts
    - src/discord/__tests__/bridge-attachments.test.ts
    - src/memory/__tests__/compaction.test.ts
    - src/memory/__tests__/consolidation.test.ts
    - src/memory/__tests__/embedder.test.ts

key-decisions:
  - "Used vi.mocked() instead of as-unknown-as for reassigning mock implementations in compaction tests"
  - "For discord.js types, used direct as-Type cast (without unknown intermediate) since mocks provide sufficient structural overlap"

patterns-established:
  - "SessionManager mock pattern: stub all public methods with vi.fn() to satisfy TypeScript without escape hatches"
  - "CLI command test pattern: mock IPC + output modules, use commander exitOverride + parseAsync, spy process.exit"

requirements-completed: [DEBT-05, DEBT-06]

# Metrics
duration: 9min
completed: 2026-04-09
---

# Phase 22 Plan 01: Test Type Safety Summary

**Eliminated all as-unknown-as casts from 7 test files and added unit tests for 4 untested CLI commands (fork, send, webhooks, mcp)**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-09T18:44:20Z
- **Completed:** 2026-04-09T18:53:26Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Zero `as unknown as` casts remain in any test file under src/ (was 13+ across 7 files)
- All 4 untested CLI commands now have comprehensive unit tests (22 new tests)
- Fixed 2 pre-existing test failures in bridge-attachments.test.ts (missing channel mock, stale forwardToAgent reference)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix test fixtures to eliminate as-unknown-as casts** - `3eb9834` (fix)
2. **Task 2: Add unit tests for fork, send, webhooks, mcp CLI commands** - `0728671` (test)

## Files Created/Modified
- `src/cli/commands/fork.test.ts` - Tests for fork CLI command (success, options, error handling)
- `src/cli/commands/send.test.ts` - Tests for send CLI command (success, --from/--priority, errors)
- `src/cli/commands/webhooks.test.ts` - Tests for formatWebhooksTable (empty, headers, avatar, status)
- `src/cli/commands/mcp.test.ts` - Tests for MCP command (success, error, non-Error rejection)
- `src/heartbeat/checks/__tests__/tier-maintenance.test.ts` - Replaced as-unknown-as with full SessionManager mock
- `src/heartbeat/checks/__tests__/consolidation.test.ts` - Replaced as-unknown-as with full SessionManager mock
- `src/discord/thread-manager.test.ts` - Added missing SessionManager methods to mock, removed cast
- `src/discord/__tests__/bridge-attachments.test.ts` - Removed as-unknown-as, fixed pre-existing failures
- `src/memory/__tests__/compaction.test.ts` - Replaced as-unknown-as with direct casts and vi.mocked()
- `src/memory/__tests__/consolidation.test.ts` - Replaced as-unknown-as on EmbeddingService mock
- `src/memory/__tests__/embedder.test.ts` - Replaced as-unknown-as on pipeline mock

## Decisions Made
- Used `vi.mocked()` for reassigning mock implementations instead of `as unknown as { method: fn }` pattern in compaction tests
- For discord.js complex types (Message, Collection, Attachment), used `as Type` directly instead of `as unknown as Type` since partial mocks have enough structural overlap for TypeScript
- Fixed pre-existing bridge-attachments test failures as Rule 1 (bug fix): the bridge now uses `streamFromAgent` instead of `forwardToAgent`, and requires `message.channel` for typing indicators

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing bridge-attachments test failures**
- **Found during:** Task 1 (fixing as-unknown-as casts)
- **Issue:** Two handleMessage integration tests were failing pre-change: (1) `message.channel` was undefined causing sendTyping error, (2) test expected `forwardToAgent` but bridge now uses `streamFromAgent`
- **Fix:** Added `channel: { sendTyping, send }` to mock Message, replaced `forwardToAgent` mock with `streamFromAgent` mock
- **Files modified:** src/discord/__tests__/bridge-attachments.test.ts
- **Verification:** All 7 bridge-attachments tests pass
- **Committed in:** 3eb9834 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix was necessary to bring all tests to passing state. No scope creep.

## Issues Encountered
- Pre-existing test failures in slash-types.test.ts and session-manager.test.ts (unrelated to this plan's changes, confirmed by running tests before and after changes)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DEBT-05 and DEBT-06 requirements fully satisfied
- All CLI commands now have test coverage
- Test fixtures use proper types throughout

---
*Phase: 22-tech-debt-test-type-safety*
*Completed: 2026-04-09*
