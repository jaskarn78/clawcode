---
phase: 107
plan: 02
subsystem: memory
tags:
  - vec_memories
  - orphan-cleanup
  - sqlite-vec
  - ipc
  - cli
  - VEC-CLEAN-01
  - VEC-CLEAN-02
  - VEC-CLEAN-03
  - VEC-CLEAN-04
requires:
  - MemoryStore (src/memory/store.ts)
  - vec_memories vtab (sqlite-vec)
  - SessionManager.getMemoryStore
  - IPC dispatch (src/manager/daemon.ts)
  - existing `memory` CLI group (src/cli/commands/memory.ts)
provides:
  - MemoryStore.cleanupOrphans() — idempotent, atomic, directional vec-cleanup helper
  - IPC method `memory-cleanup-orphans` with optional `agent` filter
  - CLI subcommand `clawcode memory cleanup-orphans [-a <agent>]`
  - regression test pinning MemoryStore.delete cascade invariant
affects:
  - operator runbook (forward-going historical-orphan recovery)
tech-stack:
  added: []
  patterns:
    - directional SQL inside db.transaction() for sqlite-vec vtab cleanup
    - closure-intercept IPC handler BEFORE routeMethod (mirrors secrets-status / mcp-tracker-snapshot)
    - per-agent partial-failure sentinel ({ totalAfter: -1 }) so one bad agent doesn't kill the whole operator command
key-files:
  created:
    - src/memory/__tests__/store-orphan-cleanup.test.ts
  modified:
    - src/memory/store.ts
    - src/memory/__tests__/store.test.ts
    - src/ipc/protocol.ts
    - src/ipc/__tests__/protocol.test.ts
    - src/manager/daemon.ts
    - src/cli/commands/memory.ts
decisions:
  - "MemoryStore.cleanupOrphans lives on the class (single owner of the SQLite handle), not as a separate utility — mirrors bumpAccess + getMemoryFileSha256 operational helpers"
  - "Directional SQL: DELETE FROM vec_memories WHERE memory_id NOT IN (SELECT id FROM memories) — never the reverse direction, which would erase cold-archived memories (RESEARCH.md pitfall 3)"
  - "Per-agent failure pushes sentinel { totalAfter: -1 } into results instead of aborting — operator sees both the failures and the successes in one CLI invocation"
metrics:
  duration_minutes: ~45
  tasks_completed: 3
  commits: 3
  files_created: 1
  files_modified: 6
  tests_added: 6   # 5 cleanupOrphans + 1 delete-cascade regression
  ipc_tests_added: 3   # 1 enum-membership + 2 schema-acceptance
completed: 2026-05-01
---

# Phase 107 Plan 02: Pillar B — vec_memories orphan cleanup Summary

**One-liner:** Idempotent, atomic, directional `cleanupOrphans()` on
MemoryStore with operator IPC + CLI surface — closes the
historical-orphan recovery gap from CHECK-constraint table-recreation
migrations without risking cold-archived memories.

## Tasks Completed

### Task 1 (107-02-01) — RED: store-orphan-cleanup test file + delete-cascade regression

- Created `src/memory/__tests__/store-orphan-cleanup.test.ts` with 5 RED
  test blocks (~250 lines): `removes-orphans`, `idempotent`,
  `preserves-cold` (directional pitfall), `atomic` (rollback on
  mid-transaction throw), `no-orphans-clean-state`.
- Extended `src/memory/__tests__/store.test.ts` with a
  Phase 107 VEC-CLEAN-01 describe block containing
  `delete-cascades-vec` regression test that pins the invariant that
  `MemoryStore.delete(id)` cascades to `vec_memories` inside a single
  `db.transaction()`.
- All 5 cleanup tests fail with `TypeError: store.cleanupOrphans is not
  a function` — RED phase confirmed.
- The regression test in store.test.ts passed immediately because
  `MemoryStore.delete` already cascades.
- **Commit:** `cc78c5d`

### Task 2 (107-02-02) — GREEN: MemoryStore.cleanupOrphans + audit

- Added `MemoryStore.cleanupOrphans()` method to `src/memory/store.ts`
  near `bumpAccess`. Implementation:
  - Wraps DELETE + COUNT in a single `db.transaction()` for atomicity.
  - Directional SQL:
    `DELETE FROM vec_memories WHERE memory_id NOT IN (SELECT id FROM memories)`
    — NEVER touches `memories`.
  - Returns `{ removed, totalAfter }`.
- Idempotent (second call removes 0 — proven by test).
- Audit (VEC-CLEAN-01) — confirmed via grep:
  ```
  grep -rn "DELETE FROM memories" src/ --include="*.ts" | grep -v __tests__
  → 1 hit (src/memory/store.ts:1366 prepared statement,
    used inside MemoryStore.delete at store.ts:312-331)
  ```
- All 5 RED tests turn GREEN. 68/68 tests pass in store.test.ts +
  store-orphan-cleanup.test.ts.
- **Commit:** `00501e5`

### Task 3 (107-02-03) — IPC + daemon dispatch + CLI subcommand

- `src/ipc/protocol.ts`: registered `memory-cleanup-orphans` in
  `IPC_METHODS` enum tuple (Phase 106 TRACK-CLI-01 precedent — without
  this, `ipcRequestSchema.safeParse` rejects with -32600 "Invalid
  Request" before dispatch).
- `src/ipc/__tests__/protocol.test.ts`: extended the canonical
  enum-list assertion + added a Phase 107 describe block asserting
  enum membership + schema acceptance with/without optional `agent`
  filter param.
- `src/manager/daemon.ts`: closure-intercept handler for
  `memory-cleanup-orphans` inside the existing switch BEFORE
  `routeMethod` (mirrors `secrets-status` + `mcp-tracker-snapshot`
  precedents at the same callsite). Iterates `resolvedAgents` or one
  agent if `params.agent` is set, calls
  `manager.getMemoryStore(agent).cleanupOrphans()` per target, collects
  `{ agent, removed, totalAfter }` per agent. Per-agent failures
  logged via `log.error` + sentinel `{ totalAfter: -1 }` pushed so
  partial failure doesn't kill the whole operator command.
- `src/cli/commands/memory.ts`: added
  `clawcode memory cleanup-orphans [-a <agent>]` subcommand under
  existing `memory` group. Sends IPC, formats per-agent results
  (no-orphans / removed N / failed), exits 1 with operator-friendly
  message on `ManagerNotRunningError`.
- **Commit:** `6b1771c`

## Files Modified

| File | Change |
|------|--------|
| `src/memory/__tests__/store-orphan-cleanup.test.ts` | created (~250 lines, 5 test blocks) |
| `src/memory/__tests__/store.test.ts` | +60 lines — VEC-CLEAN-01 regression `delete-cascades-vec` |
| `src/memory/store.ts` | +41 lines — `cleanupOrphans()` method near `bumpAccess` |
| `src/ipc/protocol.ts` | +9 lines — `memory-cleanup-orphans` enum entry + comment |
| `src/ipc/__tests__/protocol.test.ts` | +35 lines — enum-list update + Phase 107 describe block |
| `src/manager/daemon.ts` | +42 lines — closure-intercept handler in IPC switch |
| `src/cli/commands/memory.ts` | +56 lines — `cleanup-orphans` subcommand |

## Test Results

- **Before:** 5 RED failures in store-orphan-cleanup.test.ts
- **After:** 102/102 GREEN across store.test.ts +
  store-orphan-cleanup.test.ts + protocol.test.ts.
- **Memory + IPC + CLI scope:** 1147 passing, 7 failing — all 7 pre-
  existing on master in unrelated files (conversation-brief.test.ts,
  conversation-store.test.ts, migrate-openclaw-complete.test.ts) and
  verified untouched by 107-02 changes. Documented in
  `deferred-items.md`.

## Audit Result (VEC-CLEAN-01)

```
$ grep -rn "DELETE FROM memories" src/ --include="*.ts" | grep -v __tests__
src/memory/store.ts:1366: deleteMemory: this.db.prepare(`DELETE FROM memories WHERE id = ?`),
```

**Exactly 1 production site.** This prepared statement is used
exclusively inside `MemoryStore.delete(id)` at `store.ts:312-331`,
which already wraps the deletion in `db.transaction()` and pairs it
with `DELETE FROM vec_memories WHERE memory_id = ?`. Cascade invariant
confirmed.

## Anti-Pattern Audit

```
$ grep -rn "DELETE FROM memories WHERE id NOT IN" src/ --include="*.ts"
(no output)
```

**Zero hits — confirmed.** The dangerous reverse-direction SQL that
would erase cold-archived memories is absent from the codebase.

## Commits

| Hash | Subject |
|------|---------|
| `cc78c5d` | `test(107-02-01): RED — vec_memories orphan-cleanup + delete-cascade regression` |
| `00501e5` | `feat(107-02-02): GREEN — MemoryStore.cleanupOrphans (VEC-CLEAN-01..03)` |
| `6b1771c` | `feat(107-02-03): VEC-CLEAN-03 wiring — IPC + daemon dispatch + CLI` |

## Requirements Completed

- [x] **VEC-CLEAN-01** — audit confirmed `MemoryStore.delete(id)` is
      the only production `DELETE FROM memories` site (grep returns
      exactly 1 hit). Regression test pins the cascade invariant.
- [x] **VEC-CLEAN-02** — `cleanupOrphans` inherits the same
      `db.transaction()` atomicity pattern as `MemoryStore.delete`.
      Atomic-rollback test proves a mid-transaction throw rolls back
      the DELETE.
- [x] **VEC-CLEAN-03** — `MemoryStore.cleanupOrphans()` method, IPC
      method `memory-cleanup-orphans` (enum + dispatch handler +
      schema test), daemon closure-intercept handler, and CLI
      subcommand `clawcode memory cleanup-orphans [-a <agent>]` all
      wired.
- [x] **VEC-CLEAN-04** — vitest covers `removes-orphans`,
      `idempotent`, `preserves-cold` (directional pitfall),
      `atomic` (rollback), `no-orphans-clean-state`, and
      `delete-cascades-vec` regression.

## Deviations from Plan

**None — plan executed exactly as written.**

The plan called out a typecheck verification step in Task 2's
`<verify>` block. Pre-existing typecheck errors in unrelated files
(`src/cli/commands/__tests__/dream.test.ts`,
`src/cli/commands/__tests__/fs-status.test.ts`,
`src/cli/commands/__tests__/latency.test.ts`,
`src/cli/commands/__tests__/probe-fs.test.ts`,
`src/cli/commands/__tests__/tasks.test.ts`,
`src/triggers/__tests__/policy-watcher.test.ts:516`,
`src/usage/__tests__/daily-summary.test.ts`,
`src/usage/budget.ts:138`,
`src/manager/daemon.ts:220, 2107, 6271`) exist on master and are NOT
introduced by this plan. Verified by stash + re-run. Documented in
phase `deferred-items.md`.

`grep "store.ts|store-orphan-cleanup|cli/commands/memory.ts|ipc/protocol"`
on the typecheck output yields zero matches — 107-02 introduced no
new type errors.

## Operator Runbook (post-deploy)

After deploying, operator can clean accumulated historical orphans
from production agent SQLite DBs (`~/.clawcode/agents/<agent>/memory/memories.db`):

```bash
# All agents
clawcode memory cleanup-orphans

# Single agent
clawcode memory cleanup-orphans -a clawdy
```

Per-agent output examples:
- `clawdy: removed 3 orphans (1247 vec_memories remaining)` — patched
- `atlas: no orphans (892 vec_memories total)` — already clean
- `bench: cleanup failed` — see daemon log for the per-agent error;
  other agents continue.

The command is idempotent and safe to re-run.

## Self-Check: PASSED

- [x] `src/memory/__tests__/store-orphan-cleanup.test.ts` exists
- [x] `cleanupOrphans` method present in `src/memory/store.ts`
- [x] `"memory-cleanup-orphans"` registered in `src/ipc/protocol.ts`
      `IPC_METHODS` enum
- [x] `case "memory-cleanup-orphans":` dispatch handler present in
      `src/manager/daemon.ts`
- [x] `cleanup-orphans` subcommand present in
      `src/cli/commands/memory.ts`
- [x] Commits `cc78c5d`, `00501e5`, `6b1771c` all present in
      `git log`
- [x] 102/102 tests GREEN in affected scope
- [x] Audit grep returns exactly 1 production `DELETE FROM memories`
      site
- [x] Anti-pattern grep `DELETE FROM memories WHERE id NOT IN`
      returns 0 matches
