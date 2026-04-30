---
phase: 104-daemon-op-secret-cache-and-retry-backoff
plan: "03"
subsystem: secrets
tags: [secrets, 1password, config-watcher, recovery, op-refresh, sec-05]

requires:
  - 104-01 (SecretsResolver class — invalidate / resolve / getCached methods)
  - 104-02 (SecretsResolver singleton constructed in startDaemon, exposed in return value)
provides:
  - applySecretsDiff bridge: walks ConfigDiff for op:// URI changes, invalidate-FIRST + warm-resolve
  - ConfigWatcher.onChange now calls applySecretsDiff before configReloader.applyChanges
  - RecoveryDeps gains optional invalidate?: (ref) => void for back-compat-safe cache flush
  - op-refresh recovery handler calls deps.invalidate?.(ref) BEFORE deps.opRead(ref) — closes Pitfall 3 staleness gap
  - CheckContext gains optional secretsResolver?: SecretsResolver (heartbeat → recovery deps plumbing)
  - HeartbeatRunner.setSecretsResolver setter (mirrors setThreadManager / setTaskStore pattern)
  - mcp-reconnect's RecoveryDeps factory wires invalidate when ctx.secretsResolver is present
  - 5 watcher tests + 2 new recovery tests + back-compat preserved
affects:
  - 104-04 (Wave 3 plan B — secrets-status / secrets-invalidate IPC surface; orthogonal, no conflict)

tech-stack:
  added: []
  patterns:
    - "Bridge module pattern — extract diff-walking logic from daemon.ts into testable secrets-watcher-bridge.ts"
    - "Optional-dep DI pattern (`invalidate?: (ref) => void`) — back-compat without forcing test deps to know about the new field"
    - "Setter-injection on long-lived runner — secretsResolver flows through setSecretsResolver after construction (matches setThreadManager / setTaskStore for ThreadManager / TaskStore)"
    - "Invalidate-FIRST ordering — drop cache before re-fetch so concurrent resolvers cannot serve stale; relies on inflight-dedup map for race safety"

key-files:
  created:
    - src/manager/secrets-watcher-bridge.ts (75 lines — applySecretsDiff helper)
  modified:
    - src/manager/daemon.ts (+15 lines: import bridge, call applySecretsDiff in onChange, setSecretsResolver on heartbeat runner)
    - src/manager/recovery/op-refresh.ts (+6 lines: deps.invalidate?.(ref) before await deps.opRead(ref))
    - src/manager/recovery/types.ts (+10 lines: invalidate?: optional field on RecoveryDeps)
    - src/manager/__tests__/secrets-resolver-watcher.test.ts (5 → 175 lines: WATCH-01..05)
    - src/manager/__tests__/recovery-op-refresh.test.ts (+72 lines: REC-OP-REFRESH-INV-01 + INV-02 + makeDeps propagates invalidate override)
    - src/heartbeat/types.ts (+9 lines: secretsResolver?: optional on CheckContext)
    - src/heartbeat/runner.ts (+15 lines: private secretsResolver field + setSecretsResolver setter + propagate to context)
    - src/heartbeat/checks/mcp-reconnect.ts (+15 lines: conditionally inject invalidate into RecoveryDeps when ctx.secretsResolver present)

key-decisions:
  - "Bridge factored into secrets-watcher-bridge.ts (RECOMMENDED option from plan). Daemon.ts onChange callback delegates a single line — keeps daemon.ts smaller AND lets the test import the production code path directly (no shape-duplication risk)."
  - "ConfigDiff field name is `fieldPath` (not `path` as the plan's pseudocode hinted). Plan-research already flagged this risk; types.ts:9 confirms `fieldPath: string`. Bridge code + tests use the actual field name."
  - "Recovery deps not wired directly inside daemon.ts — it's wired through CheckContext via setSecretsResolver, then consumed by mcp-reconnect's buildRecoveryDepsForHeartbeat (the actual RecoveryDeps construction site). Daemon.ts only holds the setter call. This minimizes cross-cutting changes to daemon.ts and keeps the wiring at the natural recovery-deps construction edge — exactly where the existing opRead, readEnvForServer, writeEnvForServer factories live."
  - "Optional invalidate field uses `?.` chain at call site for runtime safety AND `readonly invalidate?:` on the type for compile-time back-compat. Existing recovery-op-refresh tests that don't pass invalidate continue to work — REC-OP-REFRESH-INV-02 pins this."
  - "makeDeps test helper propagates invalidate via conditional spread `...(overrides.invalidate !== undefined ? { invalidate: overrides.invalidate } : {})`. Default behavior (no override) keeps deps.invalidate === undefined — preserves the back-compat shape that pre-104 tests assume."
  - "WATCH-03/04/05 added beyond plan's spec — covers the op://→literal swap path (RESEARCH.md SEC-05 invariant 2), non-secret diff entries (no-op invariant), and warm-resolve failure swallowing (the 'never throws' invariant). All three are pinned in the must-haves.truths list at the top of PLAN.md."

requirements-completed: [SEC-05]

duration: ~6min
completed: 2026-04-30
---

# Phase 104 Plan 03: Cache invalidation surfaces (ConfigWatcher + recovery/op-refresh) Summary

**Wired SecretsResolver cache invalidation into the two operator-driven surfaces — ConfigWatcher.onChange auto-invalidates op:// URIs that changed in clawcode.yaml (with warm-resolve of new ones), and the existing recovery/op-refresh handler now drops cached values BEFORE re-resolving via op CLI — closing the Pitfall 3 staleness gap (a rotated 1Password token would otherwise cause SecretsResolver to keep serving the same stale value forever).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-30T15:36:00Z (approx — read-first phase)
- **Completed:** 2026-04-30T15:45:00Z
- **Tasks:** 2 (both TDD: RED → GREEN)
- **Files modified:** 1 created, 7 modified
- **New tests:** 7 (WATCH-01..05 + REC-OP-REFRESH-INV-01 + REC-OP-REFRESH-INV-02)
- **All related tests:** 39 passed across 5 test files in 3.08s wall-clock
- **TypeScript:** zero NEW errors in any changed file (modulo the same 3 pre-existing daemon.ts errors documented in plan 02's SUMMARY)

## ConfigDiff field-name confirmation (vs plan)

The plan's RESEARCH.md and PLAN.md described diff entries with `change.path / change.oldValue / change.newValue`. The actual `ConfigDiff` type in `src/config/types.ts:8-13` uses:

```typescript
export type ConfigChange = {
  readonly fieldPath: string;       // NOT `path`
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly reloadable: boolean;     // additional field
};
```

Bridge code + tests use the real field name (`fieldPath`). The `reloadable` field is unused by the bridge — secrets cache invalidation is independent of whether the change is hot-reloadable or restart-required. Net deviation: minor field name only; surfaced during read-first phase per plan instructions, written correctly on first commit.

## Daemon.ts edit map (line numbers — for plan 04 / future plans)

| Edit | Description | Line(s) |
|------|-------------|---------|
| A | Add import: `applySecretsDiff` from `./secrets-watcher-bridge.js` | 35 |
| B | ConfigWatcher.onChange callback now `await applySecretsDiff(diff, secretsResolver, log)` BEFORE configReloader | 3838-3845 |
| C | `heartbeatRunner.setSecretsResolver(secretsResolver)` after `setTaskStore` | 2396-2402 |

The recovery deps wiring lives in `src/heartbeat/checks/mcp-reconnect.ts:206-215` (where buildRecoveryDepsForHeartbeat constructs RecoveryDeps from the CheckContext). Plan 04's secrets-status IPC handler is orthogonal — it dispatches against `secretsResolver.snapshot()` from the IPC handler dispatch site and does not touch any of the surfaces above.

## Test results

| Test ID | File | Status |
|---------|------|--------|
| WATCH-01 | secrets-resolver-watcher.test.ts | green |
| WATCH-02 | secrets-resolver-watcher.test.ts | green |
| WATCH-03 | secrets-resolver-watcher.test.ts | green |
| WATCH-04 | secrets-resolver-watcher.test.ts | green |
| WATCH-05 | secrets-resolver-watcher.test.ts | green |
| REC-OP-MATCH (regression) | recovery-op-refresh.test.ts | green |
| REC-OP-NO-MATCH (regression) | recovery-op-refresh.test.ts | green |
| REC-OP-RECOVER-OK (regression) | recovery-op-refresh.test.ts | green |
| REC-OP-REFRESH-INV-01 (NEW) | recovery-op-refresh.test.ts | green |
| REC-OP-REFRESH-INV-02 (NEW back-compat) | recovery-op-refresh.test.ts | green |
| mcp-reconnect tests (regression × 13) | heartbeat/checks/__tests__/mcp-reconnect.test.ts | green |
| auto-linker tests (regression) | heartbeat/checks/__tests__/auto-linker.test.ts | green |
| fs-probe tests (regression) | heartbeat/checks/__tests__/fs-probe.test.ts | green |

**Total:** 39 passed across 5 files in 3.08s wall-clock. Zero failed. Zero todos.

## Acceptance criteria verification

Task 1:
- `grep "applySecretsDiff" src/manager/daemon.ts | wc -l` == 4 (≥1 required) ✓ (1 import + 1 call site + 2 comments)
- `test -f src/manager/secrets-watcher-bridge.ts` exits 0 ✓
- `grep "^export.*applySecretsDiff" src/manager/secrets-watcher-bridge.ts` returns 1 ✓
- `grep -c "it.todo" src/manager/__tests__/secrets-resolver-watcher.test.ts` == 0 ✓
- `grep "WATCH-01" / "WATCH-02"` ≥ 1 ✓

Task 2:
- `grep "invalidate?:" src/manager/recovery/types.ts` == 1 ✓
- `grep "deps.invalidate?\.(" src/manager/recovery/op-refresh.ts` == 1 ✓
- Recovery deps wired with secretsResolver — verified via `mcp-reconnect.ts` (the actual RecoveryDeps construction site) ✓
- `grep "REC-OP-REFRESH-INV-01" recovery-op-refresh.test.ts` ≥ 1 ✓
- All 5 recovery tests pass (3 regression + 2 new) ✓
- `grep -B1 "await deps.opRead(ref)" src/manager/recovery/op-refresh.ts` shows `deps.invalidate?.(ref);` immediately preceding ✓

## Decisions made

- **Bridge factoring vs inline:** Chose RECOMMENDED bridge approach (`secrets-watcher-bridge.ts`). Tests now import production code directly — no shape-drift risk, daemon.ts stays smaller.
- **Recovery deps wiring location:** Wired at `mcp-reconnect.ts:206-215` (where RecoveryDeps is actually constructed) rather than inside daemon.ts directly. Daemon.ts only holds `heartbeatRunner.setSecretsResolver(secretsResolver)`. This keeps the wiring at the natural construction edge alongside the existing opRead, readEnvForServer, writeEnvForServer factories.
- **CheckContext propagation:** Added `secretsResolver?: SecretsResolver` to CheckContext so any future heartbeat check needing cache-flush has the same path. Optional — no existing tests break.
- **Optional `invalidate` chain at call site:** Both compile-time (`readonly invalidate?:` interface field) and runtime (`deps.invalidate?.(ref)` optional call). Existing pre-104 tests / deps work unchanged. Pinned by REC-OP-REFRESH-INV-02.
- **3 extra watcher tests beyond plan minimum:** WATCH-03 (op://→literal swap), WATCH-04 (non-secret diffs are ignored), WATCH-05 (warm-resolve failure is swallowed). The plan's must-haves.truths list explicitly enumerates these as invariants — adding tests for them is the discipline. They were almost-free given the bridge factoring.

## Deviations from plan

None requiring rework. Two minor adjustments documented above:

1. **ConfigDiff field name** is `fieldPath` (not `path`) — confirmed during read-first per plan instructions, written correctly on first commit.
2. **Recovery deps wiring is in mcp-reconnect.ts**, not directly in daemon.ts — daemon.ts only calls `setSecretsResolver`. This is what the plan's "Conservative path" hinted at: wire at the actual deps construction site, not the daemon orchestration site. The plan's literal `grep "invalidate:.*secretsResolver" src/manager/daemon.ts` acceptance criterion as written would not match (daemon.ts uses `setSecretsResolver(secretsResolver)`); the equivalent grep against `src/heartbeat/checks/mcp-reconnect.ts` does match. Same observable behavior; just better cohesion.

No Rule 1/2/3/4 deviations triggered. No auth gates encountered. No architectural changes needed.

## Confirmation: plan 04 files NOT touched

Per the parallel-execution contract with plan 04 (which touches IPC handler dispatch in daemon.ts), plan 03 only touched the disjoint daemon.ts regions:

- ConfigWatcher construction site (line ~3838) — distinct from IPC handler dispatch
- Heartbeat runner setter call (line ~2396) — distinct from IPC handler dispatch

No edits to `src/ipc/protocol.ts` or to the IPC handler dispatch table inside daemon.ts. Plan 04's surface is fully orthogonal.

## Issues encountered

One: the test helper `makeDeps` in `recovery-op-refresh.test.ts` did not propagate the new optional `invalidate` field by default. Initial GREEN run failed because `deps.invalidate` was always undefined regardless of the override. Fixed by adding the conditional spread `...(overrides.invalidate !== undefined ? { invalidate: overrides.invalidate } : {})` to keep the back-compat default (undefined) intact while honoring explicit overrides. Documented inline.

## Known stubs

None. Both invalidation surfaces are fully wired end-to-end:

- ConfigWatcher.onChange → applySecretsDiff → secretsResolver.invalidate / .resolve (production)
- mcp-reconnect heartbeat → buildRecoveryDepsForHeartbeat → ctx.secretsResolver.invalidate (production)

The deferred items called out in plan 02's RESEARCH.md (full live env mutation in writeEnvForServer; killSubprocess SDK API) remain pre-existing stubs from Phase 94 — not introduced by this plan and out of scope per SCOPE BOUNDARY.

## User setup required

None. Both surfaces activate automatically once the daemon restarts:

- Editing `clawcode.yaml` to swap an `op://` URI now auto-invalidates + warm-resolves
- Any MCP child raising an op://-auth-error (matching the existing OP_AUTH_RE pattern) now triggers cache invalidation before re-resolution

## Next phase readiness

- **Plan 04 (secrets-status IPC) ready** — secretsResolver.snapshot() is unchanged from Wave 1 + Wave 2 expose the resolver in startDaemon's return value; the IPC handler dispatch can wire to it without touching plan 03's surfaces.
- **No blockers.** All 39 related tests green; TypeScript clean for changed files; both SEC-05 invariants pinned.

## Task commits

1. **Task 1 RED:** `09c19cc` (test) — add failing watcher invalidation tests (WATCH-01..05)
2. **Task 1 GREEN:** `624bfbe` (feat) — wire ConfigWatcher.onChange → applySecretsDiff bridge
3. **Task 2 RED:** `b88ba69` (test) — add REC-OP-REFRESH-INV-01 + INV-02 + RecoveryDeps.invalidate?
4. **Task 2 GREEN:** `f561a7e` (feat) — wire SecretsResolver.invalidate into recovery/op-refresh

## Self-Check

Created files exist:
- FOUND: src/manager/secrets-watcher-bridge.ts

Modified files exist:
- FOUND: src/manager/daemon.ts (import + onChange callback + setSecretsResolver)
- FOUND: src/manager/recovery/op-refresh.ts (deps.invalidate?.(ref) before opRead)
- FOUND: src/manager/recovery/types.ts (invalidate?: optional field)
- FOUND: src/manager/__tests__/secrets-resolver-watcher.test.ts (5 tests)
- FOUND: src/manager/__tests__/recovery-op-refresh.test.ts (5 tests; 2 new)
- FOUND: src/heartbeat/types.ts (secretsResolver?: optional on CheckContext)
- FOUND: src/heartbeat/runner.ts (setSecretsResolver setter)
- FOUND: src/heartbeat/checks/mcp-reconnect.ts (conditional invalidate wiring)

Commits exist:
- FOUND: 09c19cc (Task 1 RED)
- FOUND: 624bfbe (Task 1 GREEN)
- FOUND: b88ba69 (Task 2 RED)
- FOUND: f561a7e (Task 2 GREEN)

## Self-Check: PASSED

---
*Phase: 104-daemon-op-secret-cache-and-retry-backoff*
*Plan: 03 — ConfigWatcher + recovery/op-refresh cache invalidation surfaces (SEC-05)*
*Completed: 2026-04-30*
