---
phase: 124
plan: 05
title: Live hot-swap — in-process SessionHandle rebind on compaction
status: complete
wave: 1.5
duration: ~75 min
completed: 2026-05-14
follows: 124-01
---

# Phase 124-05 — Live Hot-Swap: SUMMARY

Closes Plan 124-01's deferred Path B. `clawcode session compact <agent>`
(and the heartbeat auto-trigger) now rebind the live `SessionHandle`
to the fork session id IN-PROCESS — operator no longer needs to run
`clawcode restart <agent>` to pick up the compaction.

## Chosen approach (advisor-validated)

**Option A — closure-rebinding inside `buildEpoch`.** The factory's
`q`, `inputQueue`, and `driverIter` were changed from `const` to `let`
captured by every closure (turn dispatch, interrupt, setters, accessors).
A new `handle.swap(newSessionId)` method serializes through the existing
depth-1 `SerialTurnQueue` and atomically swaps all three bindings to a
freshly-built epoch resumed against the new session id. `handle`
identity is preserved so the daemon's `sessions` Map keeps its
existing reference.

Rejected:
- **Option B (shared mutable ref between handle and `sessions` Map).**
  The SDK reads `resume` exactly once at `sdk.query` construction
  (`persistent-session-handle.ts:193`). A mere getter swap leaves the
  on-disk JSONL writes targeting the old session — silently wrong.
- **Option C (close + respawn the entire handle).** Loses every
  post-construction DI mirror (MCP state, flap history, recovery
  attempts, fs capability snapshot, rate-limit tracker, slash-command
  cache, advisor observer). Option A preserves all of them.

## Commits (Wave 1.5, plan 124-05)

| Task | SHA       | Subject |
|------|-----------|---------|
| T-01 | `bfae32e` | feat(124-05-T01): add SessionHandle.swap() for live hot-swap |
| T-02 | `498a68d` | test(124-05-T02): unit tests for SessionHandle.swap epoch boundary |
| T-03 | `f753e42` | feat(124-05-T03): wire live hot-swap into compact-session handler |
| T-04 | `4e5b195` | test(124-05-T04): integration + mid-turn tests for live hot-swap |

## Safety properties

- **Build-new-before-close-old.** `sdk.query()` for the new epoch runs
  BEFORE `q.close()` on the old. If the SDK rebuild rejects, the old
  epoch is intact (`sessionId`, `epoch`, `driverIter`, `q` all
  unchanged) and the caller sees the rejection — never a half-built
  handle. Pinned by `persistent-session-handle-swap.test.ts` "build-
  new-before-close-old" test.
- **Mid-turn safe.** Swap is wrapped in `turnQueue.run`, so it cannot
  interleave with an in-flight `send`. A concurrent 2nd swap rejects
  with `QUEUE_FULL` (same shape as a 3rd concurrent `send`). Pinned
  by "mid-turn swap queues behind the in-flight turn" test.
- **Per-handle state preserved.** `currentEffort`, `currentModel`,
  `currentPermissionMode` are re-applied to the new `q` via
  fire-and-forget setters (same async-no-await contract as the
  existing `setEffort`/`setModel`/`setPermissionMode` callers).
  `errorHandlers`, `endHandlers`, `flapHistory`,
  `recoveryAttemptHistory`, `currentMcpState`, `_fsCapabilitySnapshot`,
  `_rateLimitTracker` are untouched across the swap.
- **Cache invalidation.** `supportedCommandsCache` is reset to `null`
  so the next caller re-pulls `q.initializationResult()` from the new
  SDK query. `generatorDead` flag is cleared (it tracked the old
  generator's death; the swap deliberately discarded that generator).
- **Backward compat.** `swap` and `getEpoch` are additive-optional on
  the `SessionHandle` interface. Legacy `wrapSdkQuery` (test-only)
  does not implement them. The daemon handler treats missing `swap`
  as `swapped_live:false` with `swap_reason:'handle_lacks_swap'`.

## Payload extensions (`compact-session` IPC)

Additive — old parsers ignore the new fields and treat them as `false`:

```
ok: true,
tokens_before, tokens_after, summary_written, forked_to, memories_created,
swapped_live: boolean,
swap_reason?: 'handle_lacks_swap' | 'swap_threw:<msg>',
```

Failure-but-fork-succeeded path: `swapped_live:false` + `swap_reason`,
fork artifact on disk + memory.db growth still delivered, operator-manual
`clawcode restart` remains the documented fallback.

## Files

- **Modified:** `src/manager/persistent-session-handle.ts` — closure
  refactor (let bindings for q/inputQueue/driverIter), `buildEpoch`
  helper, `handle.swap`, `handle.getEpoch`, updated file docstring.
- **Modified:** `src/manager/session-adapter.ts` — additive-optional
  `swap?` and `getEpoch?` on the `SessionHandle` type.
- **Modified:** `src/manager/daemon-compact-session-ipc.ts` — swap
  invocation after `sdkForkSession`, `swapped_live` + `swap_reason`
  on the success payload, `CompactSessionHandleLike.swap?` additive,
  updated docstring (Path B deferral note replaced).
- **Added:** `src/manager/__tests__/persistent-session-handle-swap.test.ts`
  (7 tests).
- **Added:** `src/manager/__tests__/compact-session-swap-integration.test.ts`
  (3 tests).

## Tests added

`npx vitest run src/manager/__tests__/persistent-session-handle src/manager/__tests__/compact-session`:

```
Test Files  10 passed (10)
     Tests  59 passed (59)
  Start at  14:04:07
  Duration  6.38s
```

`src/manager/__tests__/persistent-session-handle-swap.test.ts` (7 tests):
- swap reopens the SDK query and updates sessionId + epoch
- N sends per epoch → 1 sdk.query per epoch; 2 epochs → 2 total
- swap to same sessionId is a no-op
- swap rejects after close
- re-applies model + effort + permission on the new SDK query
- build-new-before-close-old: sdk.query rebuild rejection leaves old epoch intact
- mid-turn swap queues behind the in-flight turn (tool-chain-intact invariant)

`src/manager/__tests__/compact-session-swap-integration.test.ts` (3 tests):
- end-to-end against a real `createPersistentSessionHandle`: pre-swap
  message lands on epoch-0 controller, post-swap message lands on
  epoch-1; pre-swap memory.db chunk recallable post-swap; extracted
  facts queryable via `store.searchMemoriesVec`
- backward compat: handle lacks `swap` → `swapped_live:false`, fork
  artifact + memory.db growth still delivered
- throw path: `handle.swap` rejects → `swapped_live:false`,
  `swap_reason:'swap_threw:sdk-rebuild-failed'`, old epoch intact

Regression sweep: `npx vitest run src/manager/__tests__/persistent-session-handle`:
46/46 passing (including the pre-existing "N sends → exactly one
sdk.query" invariant test, which generalizes to per-epoch).

## Invariant change (file docstring)

The file-level docstring at `persistent-session-handle.ts:1-32` was
updated from "Exactly ONE sdk.query() call per handle" to "Exactly
ONE sdk.query() call per handle PER EPOCH; swap opens a new epoch".
The existing `N sendAndStream calls → exactly one sdk.query
invocation` test still passes because it never calls `swap`. The
new cross-epoch test `N sends per epoch → 1 sdk.query per epoch; 2
epochs → 2 total` documents the generalized invariant.

## Deviations from plan

None. Followed the advisor-validated plan exactly:
1. Closure refactor (let bindings, `buildEpoch`).
2. `handle.swap` with build-new-before-close-old commit point.
3. Optional `swap?:` on `SessionHandle` for backward compat.
4. Daemon handler invocation with fallback `swapped_live:false`.
5. Daemon `case "compact-session"` and heartbeat auto-trigger BOTH
   path through the same `handleCompactSession` import; the new
   `swap` invocation lives inside the handler so both call sites
   are wired automatically (silent-path-bifurcation memory observed).

## Open items

1. **Production daemon deps already wired.** Both
   `daemon.ts:3344` (heartbeat auto-trigger) and `daemon.ts:10451`
   (manual IPC) construct `CompactSessionDeps` and pass
   `manager.getSessionHandle` which now returns a handle WITH the
   `swap` method. No daemon edit required for the swap to take
   effect in production — verified by reading the daemon dispatch.
2. **Phase 105 turnStartedAt map** (Plan 124-01 open item #3) still
   not wired in production. The mid-turn budget remains a structural
   gate; in production the swap proceeds without budget enforcement
   until that follow-up lands.
3. **Pre-existing failing tests** (18, none touching files this plan
   modifies) remain. Logged per scope-boundary rule.
4. **Deploy hold continues** (Ramy-active). All changes local-only.
   Operator runs `clawcode reload` or `clawcode restart <agent>` to
   pick up the new code path; subsequent compactions then swap
   in-process.

## Self-Check: PASSED

- `src/manager/persistent-session-handle.ts` — `swap`, `getEpoch`,
  `buildEpoch`, let-binding refactor present (`grep -n "function swap\|swap(newSessionId\|getEpoch" src/manager/persistent-session-handle.ts`).
- `src/manager/session-adapter.ts` — additive-optional `swap?:` on
  `SessionHandle` (`grep -n "swap\?:" src/manager/session-adapter.ts`).
- `src/manager/daemon-compact-session-ipc.ts` — handler invokes
  `handle.swap` and surfaces `swapped_live` (`grep -n "swapped_live\|handle.swap" src/manager/daemon-compact-session-ipc.ts`).
- `src/manager/__tests__/persistent-session-handle-swap.test.ts` —
  7 tests passing.
- `src/manager/__tests__/compact-session-swap-integration.test.ts` —
  3 tests passing.
- Commits `bfae32e`, `498a68d`, `f753e42`, `4e5b195` all in `git log`.
