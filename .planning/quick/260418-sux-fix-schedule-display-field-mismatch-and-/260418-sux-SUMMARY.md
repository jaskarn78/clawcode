---
phase: 260418-sux
plan: 01
type: quick
subsystem: mcp + manager
tags: [bug-fix, registry, mcp, daemon-boot]
requires: []
provides:
  - corrected list_schedules MCP tool output (agentName, not agent)
  - reconcileRegistry pure function for ghost-entry pruning
  - daemon boot-time registry reconciliation with ops-visible logging
affects:
  - src/mcp/server.ts
  - src/manager/registry.ts
  - src/manager/__tests__/registry.test.ts
  - src/manager/daemon.ts
tech_stack_added: []
patterns:
  - immutable-return (pruner returns new Registry or reference-equal input)
  - TDD RED→GREEN for the new pure function
key_files:
  created: []
  modified:
    - src/mcp/server.ts (2 insertions, 2 deletions)
    - src/manager/registry.ts (94 insertions)
    - src/manager/__tests__/registry.test.ts (174 insertions)
    - src/manager/daemon.ts (20 insertions, 1 deletion)
decisions:
  - Task 1 scoped to rename only (no widening to full ScheduleStatus) — keeps MCP inline type minimal, consistent with adjacent list_webhooks.
  - reconcileRegistry routes empty-parent names (e.g. "-sub-foo") to "orphaned-subagent" / "orphaned-thread" via explicit `parent.length > 0` guard (preferred option in plan Task 2).
  - Reference-equal early return when no pruning — callers skip writeRegistry on clean boots, preserving updatedAt.
  - reconcile block slotted as step "5d" after routing-table build, before SessionManager construction.
metrics:
  duration: "~11 min"
  completed: 2026-04-18
  commits: 3
  tests_added: 12
  tests_passing: "33/33 in plan verify gate (registry.test.ts + bootstrap-integration.test.ts)"
---

# Quick Task 260418-sux: Fix list_schedules Field Mismatch + Registry Ghost-Entry Pruning Summary

**One-liner:** Renamed `agent`→`agentName` in list_schedules MCP handler and added a pure `reconcileRegistry` pruner wired into daemon boot so ghost entries from renamed/removed agents never leak into SessionManager.

## Objective

Two independent defects fixed in one pass:

1. `list_schedules` MCP tool printed `undefined/<task>` because its inline type asserted `agent` while the daemon IPC (`ScheduleStatus`) returns `agentName`.
2. `~/.clawcode/manager/registry.json` accumulated stale entries after agent renames/removals because nothing pruned them at boot.

## Files Changed

| File                                        | Change                                                             | Lines |
| ------------------------------------------- | ------------------------------------------------------------------ | ----- |
| `src/mcp/server.ts`                         | Rename `agent`→`agentName` in list_schedules IPC type + template   | +2 -2 |
| `src/manager/registry.ts`                   | Add `reconcileRegistry` + `PrunedEntry` export                     | +94   |
| `src/manager/__tests__/registry.test.ts`    | Add 12 unit tests for reconcileRegistry + import                   | +174  |
| `src/manager/daemon.ts`                     | Import reconcile/write + step 5d boot-time reconciliation          | +20 -1|

**Total:** 4 files, +290 / −3.

## Commits

| Task | Hash      | Message                                                                         |
| ---- | --------- | ------------------------------------------------------------------------------- |
| 1    | `56a7781` | fix(260418-sux-01): rename agent to agentName in list_schedules MCP handler      |
| 2    | `77ab421` | feat(260418-sux-02): add reconcileRegistry pure function with unit tests         |
| 3    | `db8af51` | feat(260418-sux-03): wire reconcileRegistry into daemon boot                     |

## Tests

**New (Task 2):** 12 unit tests in `src/manager/__tests__/registry.test.ts` under `describe("reconcileRegistry", ...)`:

1. Empty registry → returns input unchanged (reference equality).
2. All entries configured → returns input unchanged (reference equality).
3. Unknown entry → pruned with reason `"unknown-agent"`, kept entries preserve order.
4. Rename scenario: `"Admin Clawdy"` pruned, `"admin-clawdy"` retained.
5. Live subagent `"atlas-sub-abc123"` with known `"atlas"` → retained.
6. Orphaned subagent `"ghost-sub-xyz"` → pruned with reason `"orphaned-subagent"`.
7. Live thread `"clawdy-thread-1234"` with known `"clawdy"` → retained.
8. Orphaned thread `"ghost-thread-567"` → pruned with reason `"orphaned-thread"`.
9. Mixed real-world scenario — 3 pruned entries in registry order, 4 retained.
10. Immutability — original entries array and registry object unchanged on prune.
11. `updatedAt` bumps to `Date.now()` when pruning occurs.
12. Empty-parent edge case `"-sub-foo"` → pruned as `"orphaned-subagent"` even when `""` is in knownAgentNames.

**Results:** 29/29 registry tests pass (17 existing + 12 new). Plan verify gate (`registry.test.ts` + `bootstrap-integration.test.ts`) passes 33/33.

## Self-Check

- [x] `src/mcp/server.ts` — FOUND (commit `56a7781`)
- [x] `src/manager/registry.ts` — reconcileRegistry + PrunedEntry exported (commit `77ab421`)
- [x] `src/manager/__tests__/registry.test.ts` — 12 new tests added (commit `77ab421`)
- [x] `src/manager/daemon.ts` — step 5d wired with imports (commit `db8af51`)
- [x] All 3 commit hashes present in `git log`
- [x] Plan verify gates passed:
  - Task 1: `grep s\.agent\b src/mcp/server.ts` → no matches
  - Task 2: `vitest run src/manager/__tests__/registry.test.ts` → 29/29 pass
  - Task 3: `vitest run src/manager/__tests__/{registry,bootstrap-integration}.test.ts` → 33/33 pass

## Self-Check: PASSED

## Deviations from Plan

### Auto-fixed Issues

**None.** Plan executed exactly as written. Task 2 followed the "Preferred" empty-parent routing option (prune as `orphaned-subagent` / `orphaned-thread` via explicit `parent.length > 0` guard), exactly as the plan recommended.

### Scope-boundary items (NOT auto-fixed — pre-existing)

Pre-existing `tsc --noEmit` errors were detected but confirmed pre-existing via `git stash` baseline and logged to `deferred-items.md`. They exist on master without this plan's changes and are out-of-scope per the SCOPE BOUNDARY rule:

- `src/memory/__tests__/graph.test.ts:338` — `recencyWeight` ScoringConfig drift.
- `src/tasks/task-manager.ts:239/328/367/485` — `causationId` missing in TurnContext (4 sites).
- `src/triggers/__tests__/engine.test.ts:66/67` — vitest Mock type incompatibility.
- `src/usage/__tests__/daily-summary.test.ts:209/288/313` — tuple index errors.
- `src/usage/budget.ts:138` — disjoint comparison (warning/null vs exceeded).
- `src/manager/daemon.ts` (lines 636/2348 after my insert, 617/2329 on baseline) — scheduler config `handler` property, `CostByAgentModel` shape mismatch.

A small number of flaky tests in the broader `src/manager/` suite surface under concurrent load (27 test files running simultaneously) — specifically `session-memory-warmup.test.ts` (two 5s timeouts) and occasional `daemon-task-store.test.ts` LIFE-04 timeout. Confirmed pre-existing via `git stash` baseline — these tests have no registry or MCP code path touched by this plan. They pass reliably in isolation.

### Authentication gates

None.

## Manual Smoke Test (ops-ready)

1. Seed `~/.clawcode/manager/registry.json` with a ghost entry:
   ```json
   {"entries":[{"name":"Ghost Agent","status":"stopped","sessionId":null,"startedAt":null,"restartCount":0,"consecutiveFailures":0,"lastError":null,"lastStableAt":null}],"updatedAt":0}
   ```
2. Restart daemon: `systemctl restart clawcode` (or `clawcode start-all`).
3. Check journal: `journalctl -u clawcode -n 50 | grep "pruned ghost"` — expect `{ name: "Ghost Agent", reason: "unknown-agent" }`.
4. Verify `~/.clawcode/manager/registry.json` no longer contains `"Ghost Agent"`.
5. Invoke `list_schedules` from an MCP client — output must show real agent names (e.g. `clawdy/memory-consolidation: 0 3 * * * (enabled) next: ...`), never `undefined/`.

## Key Decisions

- **Narrow MCP type rename** over widening to full `ScheduleStatus` — the MCP tool only prints four fields; matching IPC shape narrowly (agentName/name/cron/enabled/nextRun) keeps the inline assertion minimal and consistent with adjacent `list_webhooks`.
- **Reference-equal no-op** in `reconcileRegistry` — when no pruning occurs, returns input registry by identity so callers skip `writeRegistry` entirely. Avoids touching `updatedAt` on clean boots.
- **Empty-parent routed to structural reason** — `"-sub-foo"` → `orphaned-subagent` (not `unknown-agent`). Uses explicit `parent.length > 0` guard; empty string never treated as live parent even if it appears in `knownAgentNames`.
- **Boot-time integration step "5d"** — inserted after routing-table build (line 446), before SessionManager creation (line 450). Guarantees reconciliation runs before any consumer reads the registry.
- **Fail-fast semantics preserved** — no try/catch wraps the reconcile block; `readRegistry` propagates `ManagerError` on corrupt JSON (same as before this plan).
- **THREAD_REGISTRY_PATH untouched** — separate file (`thread-bindings.json`) with different entry shape; out of scope.
