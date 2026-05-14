---
phase: 121
plan: 01
title: Sub-bug D premature completion gate — streamFullyDrained AND deliveryConfirmed
subsystem: discord/subagent-completion
completed: 2026-05-14
commits:
  - d48afa1 feat(121-01-T01) — ThreadBinding.lastDeliveryAt + stampLastDeliveryAt + migrate helper
  - 524e42e feat(121-01-T02) — stamp in postInitialMessage delivery path
  - a9be728 feat(121-01-T03) — gate markRelayCompleted + session-end backstop
  - fd737dc feat(121-01-T04) — quiescence-sweep emits subagent_idle_warning
  - 2e51d58 feat(121-01-T05) — autoArchive guard (D-14)
  - 57d17cd test(121-01-T06) — regression suite + handleSubagentQuiescenceWarning extraction
  - 5215b14 feat(121-01-T07) — wire startup migration in daemon.ts
  - b783b69 fix(121-01) — test infra: settle void chain before rm/assert
files-modified:
  - src/discord/thread-types.ts (+22)
  - src/discord/thread-registry.ts (+80)
  - src/discord/subagent-thread-spawner.ts (+58)
  - src/manager/relay-and-mark-completed.ts (+17)
  - src/manager/subagent-completion-sweep.ts (net -41 / +90 — callback renamed, helper extracted)
  - src/manager/daemon.ts (+47, -31)
files-created:
  - src/discord/__tests__/thread-registry.test.ts (155 lines, 11 tests)
  - src/manager/__tests__/subagent-completion-gate.test.ts (236 lines, 10 tests)
metrics:
  duration: ~1.7h
  tasks: 7
  tests-added: 21
  tests-rewritten: 5 (subagent-completion-sweep.test.ts — onQuiescent contract)
---

# Phase 121 Plan 01: Sub-bug D premature completion gate Summary

Gated `subagent_complete` event firing on `streamFullyDrained && deliveryConfirmed` (AND-clause). Quiescence-sweep no longer fires relay — emits soft `subagent_idle_warning` for operator visibility. `autoArchive=true` waits for delivery confirmation. Pre-Phase-999.36 bindings get backfilled on first daemon startup (idempotent, one-shot).

## Test Run (final)

```
Test Files  4 passed (4)
     Tests  45 passed (45)
  Duration  501ms
```

Files: `thread-registry.test.ts`, `subagent-completion-gate.test.ts`, `subagent-completion-sweep.test.ts`, `relay-and-mark-completed.test.ts`.

Load-bearing assertion present and passing: `subagent-completion-gate.test.ts` Test 1 — `expect(r).toEqual({ ok: false, reason: "delivery-not-confirmed" })`. Test 1b adds the undefined variant. Test 4 pins `subagent_idle_warning` emission + no relay; Test 5 pins the dedupe window.

Direct-impact test files passing: 97/97 across 7 files (also includes `subagent-thread-spawner.test.ts`, `subagent-recursion-guard.test.ts`, `subagent-delegates-scoping.test.ts`).

## Migration design (for next deploy)

`migrateBindingsForPhase999_36(THREAD_REGISTRY_PATH)` runs once at daemon startup, BEFORE ThreadManager construction. For each binding:
- `completedAt` set → leave alone (terminal).
- `lastDeliveryAt` already set → leave alone (already migrated).
- Otherwise → backfill `lastDeliveryAt = lastActivity`.

Test pins: empty registry → 0 migrated; pre-Phase entry → 1 migrated (lastActivity copied); already-migrated → 0; terminal binding → 0 (lastDeliveryAt stays undefined).

Production sanity: on first deploy, expect `migrated = N` where N = number of live subagent bindings with `completedAt = null`. Subsequent restarts: `migrated = 0`.

## Deviations from plan

1. **Rule 1 (test infra) — void chain race surfaced by stamp's fs I/O.** New `stampLastDeliveryAt` call inside `postInitialMessage`'s fire-and-forget `void` chain races test teardown `rm(tmpDir, force: true)`. `writeThreadRegistry` silently recreates the parent dir via `mkdir(recursive: true)` mid-rm → ENOTEMPTY on rmdir. Fixed in 4 test files (`subagent-recursion-guard`, `subagent-delegates-scoping`, `subagent-thread-spawner` × 3 afterEach blocks, plus mid-test settling for `cleanupSubagentThread`) with a 50ms `setTimeout` wait. Production unchanged. Pre-existing latent race exposed by — not introduced by — this plan; `writeThreadRegistry`'s silent parent recreate is out of scope.

2. **Acceptance criterion T03 — "exactly 1" match for `delivery-not-confirmed`.** Actual count is 2 (literal in discriminated-union type + value in return). Both required.

3. **Advisor-prompted decision on Task 4 — modified `subagent-completion-sweep.ts` (option A).** Plan only specified edits to `daemon.ts`'s sweep callback, but the helper's `"firing completion relay"` WARN log would now lie. Renamed the callback contract from `relayAndMarkCompleted(threadId)` to `onQuiescent(candidate)`, dropped the misleading log, kept the helper structure. Plan's "do not delete the helper" anti-spec respected.

4. **Test 6 placement.** Plan offered "extraction vs daemon fixture" for the autoArchive guard test. Chose property-level test (Boolean derivation) since the spawner's guard is a one-line `Boolean(binding?.lastDeliveryAt)` check; mocking the full postInitialMessage chain would dwarf the assertion. Tests 6/6b/6c pin the invariant.

5. **Task 6 extracted `handleSubagentQuiescenceWarning`** as a pure helper from the daemon's inline callback so the regression test exercises the same code path as production. Daemon now imports + delegates.

6. **Acceptance criterion T04 — `relayCompletionToParent` count "2 or 3"**. Final count is 4, but one is a comment reference (line 7733). Functional invocations: 3 (closure key, closure value, session-end). Sweep callback's invocation is gone.

## Open questions for operator

1. **`idleWarningEmittedAt` persistence** — defaulted to in-memory Map per threat-model. Resets on daemon restart, which means the first quiescence cycle post-restart will emit a (possibly redundant) warning even if one was emitted before. Acceptable given Discord operator-visibility goal, but flag for review. If the operator wants persistence, options: (a) persist to `~/.clawcode/manager/subagent-idle-state.json` on emit, or (b) treat the in-memory miss as benign noise.

2. **Quiescence cycle's interaction with sub-bug B (Plan 121-02)** — gate prevents premature COMPLETION event, but Plan 03 must still ship before sub-bug B (chunk-boundary loss within the delivered text) is fully resolved. Operators should still check thread until 121-02/121-03 lands.

3. **One-time migration removal** — `// REMOVE AFTER 999.36+1 milestone closes` markers in both `thread-registry.ts` and `daemon.ts`. Schedule removal once all live bindings on prod have been naturally re-stamped (estimated ≤2 weeks).

## Threat flags

None — no new network endpoints / auth paths / file-access patterns introduced. All changes are inside existing trust boundaries (subagent → daemon → thread-bindings.json).

## Known stubs

None.

## Self-Check: PASSED

- src/discord/thread-types.ts present, `lastDeliveryAt` field declared (grep: 1 match in declaration site).
- src/discord/thread-registry.ts: `stampLastDeliveryAt` exported (1 match), `migrateBindingsForPhase999_36` exported (1 match), `// REMOVE AFTER` marker present.
- src/discord/subagent-thread-spawner.ts: `stampLastDeliveryAt` (2 matches — import + invocation), `auto-archive skipped` (1 match), D-14 comment (1 match).
- src/manager/relay-and-mark-completed.ts: `delivery-not-confirmed` (2 matches — type + return).
- src/manager/daemon.ts: `migrateBindingsForPhase999_36` (2 matches — import + call), `subagent_idle_warning` (2 matches — comment + log), `idleWarningEmittedAt` (3 matches), `// Phase 999.36 sub-bug D backstop` (1 match), `relayCompletionToParent` count = 4 (3 functional + 1 comment).
- src/manager/subagent-completion-sweep.ts: `handleSubagentQuiescenceWarning` exported.
- Commits exist: 8 commits from `d48afa1` to `b783b69`, all on master.
- `npx tsc --noEmit` passes (no output).
- Directly-affected test files: 97/97 pass.
- Pre-existing test failures (slash-commands-gsd-nested, etc.) confirmed via `git stash + retest`; unrelated.
