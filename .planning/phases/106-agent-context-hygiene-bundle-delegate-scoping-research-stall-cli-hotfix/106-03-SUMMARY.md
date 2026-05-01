---
phase: 106
plan: 03
subsystem: ipc-protocol
tags: [track-cli, ipc-enum, hot-fix, wave-1, green]
requires:
  - 106-00 RED test (protocol.test.ts:152 expected-list extended)
  - 999.15-03 daemon dispatch + CLI client + handler (already wired)
provides:
  - TRACK-CLI-01 GREEN — `mcp-tracker-snapshot` registered in `IPC_METHODS` enum
  - `clawcode mcp-tracker` daemon path now reachable (no more -32600 "Invalid Request")
  - `IpcMethod` type union includes the new literal (auto-derived)
affects:
  - `clawcode mcp-tracker` CLI command (operator surface restored on next deploy)
  - Daemon-side `mcp-tracker-snapshot` switch case (dispatch now reachable)
tech-stack:
  added: []
  patterns:
    - IPC method enum append (single source of truth: IPC_METHODS tuple → IpcMethod type → ipcRequestSchema gate)
    - Direct mirror of commit a9c39c7 fix shape (Phase 96-05 probe-fs/list-fs-status regression)
key-files:
  created: []
  modified:
    - src/ipc/protocol.ts
key-decisions:
  - "Append `mcp-tracker-snapshot` AFTER `secrets-invalidate` (chronological-by-phase order, matches the existing tuple convention; no logical/MCP grouping required since the entry stands alone for now)"
  - "Use 8-line inline comment matching nearby comment density (annotates the regression source: Plan 999.15-03 wired everything but the enum, mirroring 96-05 / commit a9c39c7); cache-stable since the comment text is part of the source, not the runtime tuple"
  - "Did NOT touch `ipcRequestSchema`, `server.ts`, `daemon.ts`, `mcp-tracker.ts` CLI client, or `mcp-tracker-snapshot.ts` handler — all already correctly wired; this plan is a single-line semantic fix"
  - "Did NOT rename `mcp-tracker` → `mcp-pids` (deferred per CONTEXT.md §Deferred — the CLI keeps its name; only the IPC enum gets fixed)"
requirements-completed:
  - TRACK-CLI-01
duration: 3 min
completed: 2026-05-01
---

# Phase 106 Plan 03: TRACK-CLI Wave 1 GREEN — `mcp-tracker-snapshot` IPC enum entry Summary

Single-line semantic fix appending `"mcp-tracker-snapshot"` to the `IPC_METHODS` z.enum tuple in `src/ipc/protocol.ts`, restoring the `clawcode mcp-tracker` CLI command path that 999.15-03 left dangling. Direct mirror of commit `a9c39c7` (Phase 96-05's identical regression for `probe-fs` / `list-fs-status`).

## Execution Metrics

- **Duration:** ~3 min
- **Start:** 2026-05-01 ~05:59 UTC
- **End:** 2026-05-01 06:02 UTC
- **Tasks:** 1/1
- **Files created:** 0
- **Files modified:** 1 (`src/ipc/protocol.ts`)
- **Commits:** 1 (`ab0c2ce`)
- **Lines added:** 9 (8 comment + 1 enum entry)

## Tasks Executed

### Task 1: Append `mcp-tracker-snapshot` to IPC_METHODS tuple

- **File modified:** `src/ipc/protocol.ts` (lines 245-253, +9 lines)
- **Commit:** `ab0c2ce` — `feat(106-03): GREEN — append mcp-tracker-snapshot to IPC_METHODS enum`
- **Behavior delivered:**
  - `"mcp-tracker-snapshot"` now appears in the `IPC_METHODS` tuple after `"secrets-invalidate"`.
  - `IpcMethod` type union (derived via `(typeof IPC_METHODS)[number]`) automatically includes the new literal.
  - `ipcRequestSchema.safeParse({ jsonrpc: "2.0", id: "x", method: "mcp-tracker-snapshot", params: {} })` returns `{ success: true }`.
  - Plan 00 RED test in `protocol.test.ts` (extended expected list at line 152) turns GREEN.
- **RED→GREEN transition:**
  - **Before edit:** `npx vitest run src/ipc/__tests__/protocol.test.ts` — 1 failed | 30 passed (31). Failure: `expected array to deeply equal […] − "mcp-tracker-snapshot",` exactly as Plan 00 predicted.
  - **After edit:** `npx vitest run src/ipc/__tests__/protocol.test.ts` — 31 passed (31). Both "includes all required methods" (line 13) and "ipcRequestSchema accepts all valid methods" (line 203) GREEN.

## Verification Results

```
$ npx vitest run src/ipc/__tests__/protocol.test.ts
 Test Files  1 passed (1)
      Tests  31 passed (31)
   Duration  449ms
```

### Collateral check — full IPC suite

```
$ npx vitest run src/ipc/
 Test Files  6 passed (6)
      Tests  67 passed (67)
   Duration  1.68s
```

All 67 tests across 6 IPC test files GREEN. Zero regressions.

### `npx tsc --noEmit` — IPC scope

```
$ npx tsc --noEmit 2>&1 | grep -E "src/ipc/" | head
(empty — no errors in src/ipc/)
```

The `IpcMethod` type union derives correctly with the new literal. Out-of-scope tsc errors exist in `src/tasks/`, `src/triggers/__tests__/`, `src/usage/` (pre-existing on master before Phase 106; logged in `deferred-items.md`).

## Deviations from Plan

None — plan executed exactly as written. 1 functional line + 8 lines of comment, zero other files touched.

## Authentication Gates

None.

## Issues Encountered

**File-modified-by-linter races (resolved):** During execution, the working tree's protocol.ts had unrelated pre-existing dirty edits (comment renames `999.10` → `104` from a prior session) that intermixed with my edit. I stashed the pre-existing dirty state to isolate the diff, then re-applied my single targeted edit on a clean HEAD. Final commit contains ONLY the planned change (+9 lines). A separate parallel executor (Phase 106-01) was also writing to `deferred-items.md` concurrently — coordinated naturally via append.

## Next Phase Readiness

Wave 1 GREEN for TRACK-CLI complete. Plan 106-03 ships independently of 106-01 (DSCOPE) and 106-02 (STALL-02). Combined deploy is gated by Plan 106-04 (deploy step + smoke verification on clawdy):

```bash
ssh clawdy 'sudo -u clawcode node /opt/clawcode/dist/cli/index.js mcp-tracker'
# Expected: formatted table of MCP-server PIDs by agent
# Previously: Error: Invalid Request
```

The daemon switch case (wired in 999.15-03) is now reachable from CLI.

## Self-Check: PASSED

- File modified on disk: `src/ipc/protocol.ts` ✓ (verified via `grep -n "mcp-tracker-snapshot" src/ipc/protocol.ts` — line 253)
- Commit exists in git log: `ab0c2ce` ✓ (`feat(106-03): GREEN — append mcp-tracker-snapshot to IPC_METHODS enum`)
- Predicted GREEN verified: protocol.test.ts 31/31 passing ✓
- Diff size within budget: 9 lines added (≤ 12 line budget per plan's `<done>`) ✓
- No other files touched ✓ (verified: `git show --stat ab0c2ce` lists only `src/ipc/protocol.ts`)
- Full IPC suite stays green: 67/67 ✓
- IpcMethod type derives correctly: `npx tsc --noEmit` clean for `src/ipc/` ✓
