# Phase 94 Deferred Items

## Pre-existing test failure: src/ipc/__tests__/protocol.test.ts

**Discovered during:** Plan 94-01 execution (Task 2 verification sweep)

**Status:** Pre-existing — not caused by this plan. Verified by `git stash` baseline run before any plan changes.

**Issue:** The `IPC_METHODS` exact-array equality test in `src/ipc/__tests__/protocol.test.ts` is missing the four `cutover-*` IPC methods (`cutover-verify-summary`, `cutover-button-action`, `cutover-verify`, `cutover-rollback`) that landed in Phase 92 / Plan 92-04 + 92-06 inside `src/ipc/protocol.ts` but were never added to the test fixture array.

**Plan 94-01 contribution:** Added `mcp-probe` entry to BOTH protocol.ts AND the test fixture array — net-zero new failure surface from this plan.

**Suggested fix (out of scope for 94-01):** Add the 4 cutover-* entries to the IPC_METHODS test fixture in protocol.test.ts, plus consider switching the test from exact-array equality to a subset/contains assertion to prevent recurrence whenever new IPC methods land.
