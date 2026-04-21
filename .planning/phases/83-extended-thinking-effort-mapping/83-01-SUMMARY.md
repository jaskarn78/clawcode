---
phase: 83-extended-thinking-effort-mapping
plan: 01
subsystem: sdk-integration
tags: [claude-agent-sdk, effort, thinking-tokens, setMaxThinkingTokens, zod-schema, hot-reload, regression-pin]

# Dependency graph
requires:
  - phase: 73-persistent-sdk-session
    provides: "persistent-session-handle.ts with captured driverIter + setEffort stub (the P0 bug site)"
  - phase: 56-hot-reload
    provides: "RELOADABLE_FIELDS / NON_RELOADABLE_FIELDS classification + diffConfigs pattern-matcher"
provides:
  - "Pure mapEffortToTokens(level) function covering all 7 v2.2 effort levels (off=0, auto=null, low=1024, medium=4096, high=16384, xhigh=24576, max=32768)"
  - "effortSchema extended from [low|medium|high|max] → [low|medium|high|xhigh|max|auto|off] (additive, v2.1 configs unchanged)"
  - "EffortLevel type (exported from src/config/schema.ts) replacing hand-typed unions across 7 files"
  - "q.setMaxThinkingTokens wired into persistent-session-handle.ts:setEffort — P0 silent no-op closed"
  - "SdkQuery type extended with setMaxThinkingTokens(number | null) method"
  - "Spy-based regression test pinning the SDK wire (8 tests covering every level + rejection + ordering)"
  - "agents.*.effort + defaults.effort classified reloadable (live /clawcode-effort takes effect next turn)"
  - "narrowEffortForSdkOption helper for legacy wrapSdkQuery path (SDK start-option still takes only v2.1 set)"
affects: [phase-86-setModel-wiring, phase-87-setPermissionMode-wiring, phase-83-02-effort-persistence, phase-83-03-fork-quarantine]

# Tech tracking
tech-stack:
  added: []  # zero new npm deps — SDK surface was already on-box at 0.2.97
  patterns:
    - "Fire-and-forget-with-catch pattern for async SDK mutations from sync caller paths"
    - "Narrowed-union + widened-EffortLevel split: session-start option stays narrow, runtime control widens"
    - "Spy-based regression-pin test: asserts actual SDK method invocation, not stored-state surrogate"

key-files:
  created:
    - src/manager/effort-mapping.ts
    - src/manager/__tests__/effort-mapping.test.ts
    - src/manager/__tests__/persistent-session-handle-effort.test.ts
  modified:
    - src/config/schema.ts
    - src/config/types.ts
    - src/config/__tests__/differ.test.ts
    - src/manager/sdk-types.ts
    - src/manager/persistent-session-handle.ts
    - src/manager/session-adapter.ts
    - src/manager/session-manager.ts
    - src/manager/daemon.ts
    - src/discord/slash-commands.ts
    - src/manager/__tests__/persistent-session-handle.test.ts

key-decisions:
  - "Schema extension is additive (low|medium|high|max stay valid); v2.1 migrated fleet parses unchanged — pinned by a 15-agent regression snapshot test."
  - "off → 0 (literal zero, number) and auto → null (model default) are semantically distinct and MUST NOT collapse; Plan 02 persistence depends on the distinction."
  - "setEffort stays synchronous (slash-command/IPC caller can't await); SDK call is fire-and-forget with a .catch that logs via console.warn."
  - "SDK's session-start `effort` option stays narrow (low|medium|high|max); extended levels route exclusively through q.setMaxThinkingTokens. Legacy wrapSdkQuery path adds a narrowEffortForSdkOption helper for type compliance."
  - "Effort is reloadable because the live handle applies changes on next turn — no socket/db/workspace restart needed."

patterns-established:
  - "Spy regression pins for SDK mutation methods: every setter gets a vi.fn().toHaveBeenCalledWith test — blueprint for Phase 86 (setModel) and Phase 87 (setPermissionMode)."
  - "EffortLevel imported-at-boundary: widen the internal type, narrow at the SDK session-start edge."
  - "Log-and-continue on SDK async rejection: observability matters, but a single transient SDK failure must never crash a healthy turn."

requirements-completed: [EFFORT-01, EFFORT-02, EFFORT-04]

# Metrics
duration: 31min
completed: 2026-04-21
---

# Phase 83 Plan 01: P0 Silent No-Op Fix + SDK Canary Spy Test Summary

**SDK wire for mid-session thinking-token control (q.setMaxThinkingTokens) is now observable in production — /clawcode-effort has stopped lying, pinned by a spy test that fails loud if the no-op ever returns.**

## Performance

- **Duration:** 31 min 33s
- **Started:** 2026-04-21T17:00:16Z
- **Completed:** 2026-04-21T17:31:49Z
- **Tasks:** 2
- **Files modified:** 10
- **Files created:** 3

## Accomplishments

- **Closed the Phase 73 P0 silent no-op.** `persistent-session-handle.ts:setEffort` now calls `q.setMaxThinkingTokens(mapEffortToTokens(level))`. Every `/clawcode-effort` command issued since Phase 73 has been observably setting an internal variable and nothing else; that lie is over.
- **Pinned the fix with a spy test that can't be fooled.** 8 tests in `persistent-session-handle-effort.test.ts` assert the SDK method is called with the exact mapped budget for every level (high=16384, off=0, auto=null, xhigh=24576, max=32768), two sequential setEffort calls produce two SDK calls in order (no coalescing), getEffort round-trips state, and SDK rejection is log-and-swallowed (synchronous throw would break the slash-command caller).
- **Extended the effort schema additively to the v2.2 level set.** `effortSchema` now accepts `low | medium | high | xhigh | max | auto | off` — v2.1 migrated fleet (15 agents carrying `effort: low`) parses unchanged, verified by a direct regression-snapshot test.
- **Published a pure `mapEffortToTokens` helper** covering all 7 levels with the correct SDK-API semantics (`off → 0` literal zero, `auto → null` model default, integer budgets otherwise). Future phases can mirror this pattern for model-allowed-list and permission-mode lookup tables.
- **Classified effort as reloadable** — `agents.*.effort` and `defaults.effort` added to `RELOADABLE_FIELDS`. Live `/clawcode-effort` calls take effect on the next turn without restart.
- **Widened `EffortLevel` across the call path** (slash-commands, daemon IPC, session-manager, session-adapter, mock session handle) — no more hand-typed `"low" | "medium" | "high" | "max"` unions. All 7 files now import `EffortLevel` from `src/config/schema.ts`.

## Task Commits

Each task was committed atomically (with `--no-verify` per parallel-execution protocol):

1. **Task 1: Extend effortSchema + add pure mapEffortToTokens module (RED→GREEN)** — `fa31c02` (feat)
   - RED: Created `effort-mapping.test.ts` (15 tests for the missing module + new schema levels) + added effort reloadable tests to `differ.test.ts` (2 tests).
   - GREEN: Extended `effortSchema` to 7 levels; exported `EffortLevel` type; created `effort-mapping.ts`; added `agents.*.effort` + `defaults.effort` to `RELOADABLE_FIELDS`.
2. **Task 2: Wire SDK mid-session setMaxThinkingTokens — close P0 silent no-op with spy test** — `251251e` (fix)
   - RED: Created `persistent-session-handle-effort.test.ts` (8 spy tests) — 7 of 8 failed against pre-fix code (only `getEffort` state parity passed).
   - GREEN: Wired `q.setMaxThinkingTokens` in `persistent-session-handle.ts`; extended `SdkQuery` type; widened `EffortLevel` usage across 8 files; added `narrowEffortForSdkOption` for legacy wrapSdkQuery; extended existing `persistent-session-handle.test.ts` FakeQuery mock to satisfy the new contract (Rule 3 blocking-issue fix).

## The Fix — Diff Hunks

### `src/manager/persistent-session-handle.ts` (the P0 site)

**Before (the silent no-op):**
```ts
setEffort(level: "low" | "medium" | "high" | "max"): void {
  currentEffort = level;
  // Future: q.setMaxThinkingTokens() wiring — out of scope per 73-RESEARCH §"Don't hand-roll".
},

getEffort(): "low" | "medium" | "high" | "max" {
  return currentEffort;
},
```

**After:**
```ts
setEffort(level: EffortLevel): void {
  currentEffort = level;
  // Phase 83 EFFORT-01 — close the P0 silent no-op (PITFALLS §Pitfall 1).
  // mapEffortToTokens returns 0 for "off", null for "auto", or an
  // explicit integer budget for the leveled modes. setMaxThinkingTokens
  // is async on the SDK (sdk.d.ts:1728) but we intentionally do NOT
  // await — setEffort must stay synchronous because the slash-command
  // / IPC call path cannot yield. Rejections are logged-and-swallowed
  // so a transient SDK failure never crashes a healthy turn.
  const budget = mapEffortToTokens(level);
  void q.setMaxThinkingTokens(budget).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[effort] setMaxThinkingTokens(${String(budget)}) failed: ${msg}`);
  });
},

getEffort(): EffortLevel {
  return currentEffort;
},
```

### `src/manager/effort-mapping.ts` — the pure mapping

```ts
import type { EffortLevel } from "../config/schema.js";

export function mapEffortToTokens(level: EffortLevel): number | null {
  switch (level) {
    case "off":    return 0;
    case "auto":   return null;
    case "low":    return 1024;
    case "medium": return 4096;
    case "high":   return 16384;
    case "xhigh":  return 24576;
    case "max":    return 32768;
  }
}
```

### `src/config/types.ts` — effort classified reloadable

```ts
export const RELOADABLE_FIELDS: ReadonlySet<string> = new Set([
  "agents.*.channels",
  "agents.*.skills",
  "agents.*.schedules",
  "agents.*.heartbeat",
  "defaults.heartbeat",
  // Phase 83 EFFORT-01 — runtime override via handle.setEffort → next turn.
  // No socket/db/workspace resource touched; buildOptions re-reads
  // currentEffort per turn, so YAML edits are picked up on restart AND a
  // live /clawcode-effort call invokes q.setMaxThinkingTokens immediately.
  "agents.*.effort",
  "defaults.effort",
]);
```

## Spy-Test Results — The Regression Pin

`src/manager/__tests__/persistent-session-handle-effort.test.ts`:

| Test | Asserts | Status |
|------|---------|--------|
| `setEffort('high')` | `spy.toHaveBeenCalledTimes(1)` + `toHaveBeenCalledWith(16384)` | PASS |
| `setEffort('off')` | `toHaveBeenCalledWith(0)` (explicit disable) | PASS |
| `setEffort('auto')` | `toHaveBeenCalledWith(null)` (model default) | PASS |
| `setEffort('xhigh')` | `toHaveBeenCalledWith(24576)` | PASS |
| `setEffort('max')` | `toHaveBeenCalledWith(32768)` | PASS |
| two sequential calls | `spy.mock.calls === [[1024], [16384]]` (ordered, no coalescing) | PASS |
| `getEffort` state parity | returns most-recently-set level | PASS |
| SDK rejection | `expect(() => handle.setEffort('max')).not.toThrow()` + `warnSpy.toHaveBeenCalled()` | PASS |

**8/8 green.** This suite is the contract. If `setEffort` ever silently un-wires again, all 7 wire-asserting tests go red on the next CI run.

## Files Created/Modified

### Created
- `src/manager/effort-mapping.ts` (49 lines) — pure level → token-budget mapping
- `src/manager/__tests__/effort-mapping.test.ts` (98 lines) — 15 unit tests for the mapping + schema extension
- `src/manager/__tests__/persistent-session-handle-effort.test.ts` (161 lines) — 8 spy-based SDK regression pins

### Modified
- `src/config/schema.ts` — extended `effortSchema`, exported `EffortLevel` type
- `src/config/types.ts` — added `agents.*.effort` + `defaults.effort` to `RELOADABLE_FIELDS`
- `src/config/__tests__/differ.test.ts` — 2 new tests (agent-effort reloadable, defaults.effort reloadable)
- `src/manager/sdk-types.ts` — added `setMaxThinkingTokens(number|null)` to `SdkQuery` type
- `src/manager/persistent-session-handle.ts` — THE FIX. setEffort now calls the SDK method; widened `currentEffort` to `EffortLevel`
- `src/manager/session-adapter.ts` — widened `SessionHandle.setEffort`/`getEffort` + `MockSessionHandle` + legacy `wrapSdkQuery`; added `narrowEffortForSdkOption` helper
- `src/manager/session-manager.ts` — widened `setEffortForAgent`/`getEffortForAgent` to `EffortLevel`
- `src/manager/daemon.ts` — IPC `set-effort` validates the 7-level set
- `src/discord/slash-commands.ts` — `/clawcode-effort` slash-command validates the 7-level set
- `src/manager/__tests__/persistent-session-handle.test.ts` — extended FakeQuery mock with `setMaxThinkingTokens: vi.fn()` (Rule 3 blocking-issue fix)

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

1. **Additive schema extension.** Adding xhigh/auto/off instead of renaming or removing — v2.1 migrated configs MUST parse unchanged (PITFALLS.md §Pitfall 4). Verified by a dedicated backward-compat test.
2. **`off → 0` vs `auto → null` distinction.** Number vs null is load-bearing — Plan 02 persistence depends on re-serializing the distinction, and the SDK itself treats them differently (0 = explicit disable, null = use model default).
3. **Synchronous setEffort, fire-and-forget SDK call.** The slash-command / IPC caller cannot yield; the SDK call's Promise is intentionally unawaited and `.catch`-logged.
4. **Narrow SDK session-start option, widen runtime control.** The Agent SDK's `Options.effort` (sdk.d.ts:435) still only accepts `low|medium|high|max` — extended levels only make sense via `Query.setMaxThinkingTokens`. The legacy `wrapSdkQuery` path (test-only per `@deprecated` comment) gets a `narrowEffortForSdkOption` helper so type-safety holds end-to-end.
5. **Effort is reloadable.** Hot-reload change to `effort` is a one-call-to-the-handle operation — no restart needed. Classified in `RELOADABLE_FIELDS` with an explanatory comment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended existing `persistent-session-handle.test.ts` FakeQuery mock**
- **Found during:** Task 2 (GREEN verification)
- **Issue:** The existing "SessionHandle surface is byte-identical" test at line 244 calls `handle.setEffort("high")`. After Task 2 wired `q.setMaxThinkingTokens`, the mock FakeQuery's SDK object had no such method — existing test crashed with `TypeError: q.setMaxThinkingTokens is not a function`.
- **Fix:** Added `setMaxThinkingTokens: vi.fn(() => Promise.resolve(undefined))` to the mock Query object (1 line addition).
- **Files modified:** `src/manager/__tests__/persistent-session-handle.test.ts`
- **Verification:** 15/15 tests pass in that file after the mock extension. No production code affected.
- **Committed in:** `251251e` (Task 2 commit)

**2. [Rule 3 - Blocking] Added `narrowEffortForSdkOption` helper to legacy `wrapSdkQuery`**
- **Found during:** Task 2 (TypeScript check)
- **Issue:** The legacy `wrapSdkQuery` path (test-only, `@deprecated`) passes `effort: currentEffort` into `SdkQueryOptions`. After widening `currentEffort` to `EffortLevel`, the SDK's session-start option type (`low|medium|high|max` only) rejected the wider type — TS2322.
- **Fix:** Added `narrowEffortForSdkOption(level): "low"|"medium"|"high"|"max"|undefined` helper that maps `xhigh → high`, `auto|off → undefined` (runtime-only via setMaxThinkingTokens). `turnOptions` spreads the narrowed result conditionally.
- **Files modified:** `src/manager/session-adapter.ts`
- **Verification:** Existing cache-telemetry tests still pass; `npx tsc --noEmit` shows zero new errors in touched files.
- **Committed in:** `251251e` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking-issues, both strictly necessary for the wiring to compile and the existing test suite to pass).
**Impact on plan:** Zero scope creep. Both were unavoidable compile/test cascades from the SDK wire and EffortLevel widening. Plan 02 / 03 unblocked.

## Issues Encountered

- **Pre-existing test infrastructure flakiness** — 9 pre-existing test failures (`daemon-openai.test.ts`, `bootstrap-integration.test.ts`) and several 5000ms timeouts under parallel vitest pressure. **Verified via `git stash` that these failures exist on the pre-Plan-83-01 tree.** Logged to `deferred-items.md`; out of scope. None touch effort code.
- **Pre-existing TypeScript errors** (4 total in `triggers/__tests__/engine.test.ts`, `usage/__tests__/daily-summary.test.ts`, `usage/budget.ts`, `session-adapter.ts:817 pre-widen`). All predate Plan 83-01; logged to `deferred-items.md`. None touch effort code, none were introduced by this plan.

## Known Stubs

None. Every level in `mapEffortToTokens` returns a real value; every call site of `setEffort` is wired to the real SDK; no placeholder text, no TODO comments remain in the modified files. Specifically:

```bash
$ grep -rn "Future: q\.setMaxThinkingTokens" src/
$ # (zero hits — the silent no-op marker is gone)
```

## Next Phase Readiness

- **Plan 02 (persistence) is unblocked.** The `EffortLevel` type is stable; `off` and `auto` have distinct serialization semantics; the reloadable-classification is in place.
- **Plan 03 (fork quarantine) is unblocked.** The `EffortLevel` widening is complete across `buildForkConfig` inputs; the wire is verified observable so fork-reset tests can assert `forkHandle.getEffort() === "low"` AND `forkSpyOnSetMax.toHaveBeenCalledWith(1024)` without relying on stored-state surrogates.
- **Phase 86 (setModel) pattern is established.** The spy-test harness in `persistent-session-handle-effort.test.ts` is the direct blueprint: mock the Query with `setModel: vi.fn()`, drive `handle.setModel(...)`, assert the spy. Same shape for Phase 87 (`setPermissionMode`).
- **Zero new npm deps.** All work ran on existing stack (SDK 0.2.97, Zod 4.3.6, vitest 4.1.3).

## Self-Check: PASSED

Verified 2026-04-21:

- FOUND: `src/manager/effort-mapping.ts` (49 lines)
- FOUND: `src/manager/__tests__/effort-mapping.test.ts`
- FOUND: `src/manager/__tests__/persistent-session-handle-effort.test.ts`
- FOUND: commit `fa31c02` (Task 1)
- FOUND: commit `251251e` (Task 2)
- FOUND: `mapEffortToTokens` in `src/manager/persistent-session-handle.ts` (3 refs)
- FOUND: `q.setMaxThinkingTokens` in `src/manager/persistent-session-handle.ts` (1 call site)
- FOUND: `setMaxThinkingTokens` in `src/manager/sdk-types.ts` (2 refs — type + docstring)
- FOUND: `"xhigh"` (1), `"auto"` (1), `"off"` (1) in `src/discord/slash-commands.ts`
- FOUND: `"xhigh"` (1), `"auto"` (1), `"off"` (1) in `src/manager/daemon.ts`
- FOUND: `agents.*.effort` + `defaults.effort` in `src/config/types.ts`
- ZERO HITS for `Future: q\.setMaxThinkingTokens` across `src/` (silent no-op marker successfully removed)
- All 39 Plan-83-01 tests GREEN (15 mapping + 8 spy + 15 existing handle surface + 14 differ including 2 new effort-reloadable)

---
*Phase: 83-extended-thinking-effort-mapping*
*Completed: 2026-04-21*
