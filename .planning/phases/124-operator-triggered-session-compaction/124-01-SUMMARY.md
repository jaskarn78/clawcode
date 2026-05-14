---
phase: 124
plan: 01
title: Hybrid compaction primitive (compactForAgent + sdk.forkSession) + CLI + IPC
status: complete-with-deviation
wave: 1
duration: ~75 min
completed: 2026-05-14
---

# Phase 124-01 — Hybrid Compaction Primitive: SUMMARY

Wires the existing `SessionManager.compactForAgent()` (dead-code at
`src/manager/session-manager.ts:2203` since Phase 103) plus the SDK's
`forkSession()` into a single operator-callable flow: `clawcode session
compact <agent>` → IPC `compact-session` → memory.db grows with extracted
facts + a fork JSONL is produced on disk.

## Commits (Wave 1, plan 124-01)

| Task | SHA       | Subject |
|------|-----------|---------|
| T-01 | `39b078b` | docs(124): revise CONTEXT D-04 + rewrite Plan 01 for Path C |
| T-02 | `833e274` | feat(124-01-T02): add handleCompactSession IPC handler |
| T-03 | `6e3915a` | feat(124-01-T03): wire compact-session dispatch in daemon |
| T-04 | `c0b675e` | feat(124-01-T04): add `clawcode session compact <agent>` CLI |
| T-05 | `aa9c082` | test(124-01-T05): integration test for hybrid compaction |
| T-06 | `946e72d` | test(124-01-T06): mid-turn safety + ERR_TURN_TOO_LONG budget |

## Tests added

- `src/manager/__tests__/compact-session-integration.test.ts` — 4 tests; end-to-end against real MemoryStore + real CompactionManager.
- `src/manager/__tests__/compact-session-mid-turn.test.ts` — 5 tests; injectable clock pins the D-03 10-min budget.

`npx vitest run` (scoped to new + adjacent compaction tests):

```
Test Files  3 passed (3)
     Tests  14 passed (14)
  Start at  06:21:00
  Duration  2.50s
```

Broader `src/manager` regression: 18 pre-existing failures across
`daemon-openai.test.ts`, `bootstrap-integration.test.ts`,
`dream-prompt-builder.test.ts`, `session-config.test.ts`,
`daemon-warmup-probe.test.ts` — confirmed pre-existing (none touch the
files this plan modifies). Logged here per scope-boundary rule; not
addressed in this plan.

## Deviations from plan

### Path B — live-handle hot-swap deferred (advisor-consulted before T-02)

The plan's T-03 step 8 ("swap the worker reference in sessions Map to
the new fork session ID") is **not implemented in Wave 1**. The cost
analysis surfaced during pre-write advisor consult:

- `SessionHandle.sessionId` is a closure-captured `const` at
  `persistent-session-handle.ts:983-986`. It cannot be rebound. A true
  swap requires `stopAgent(name) → startAgent(name, configWith resume:
  forkSessionId)`, which closes the live SDK Query iterator and spins
  up a new one mid-IPC.
- That surgery against a production agent during Ramy-active deploy
  hold (memory: `feedback_ramy_active_no_deploy`) crosses the
  deploy-risk threshold.
- The primitive remains useful WITHOUT the swap: memory.db growth is
  the load-bearing preservation mechanism (extracted facts are
  recallable indefinitely via RRF), and the fork JSONL is preserved on
  disk for audit. The active session continues writing to the original
  JSONL — i.e., Wave 1 does **not** address the on-disk session
  shrinkage half of operator pain (Ramy's 8.5 MB session).

**Open follow-up:** file a backlog entry "124-01-followup-live-handle-swap"
that owns the `stopAgent + restartAgent(resume: forkSessionId)` surgery
+ the chokepoint-prepend at `persistent-session-handle.ts:~1005`.

### `AGENT_NOT_INITIALIZED` error code (Rule 3)

Plan named `AGENT_NOT_RUNNING`, `ERR_TURN_TOO_LONG`, `DAEMON_NOT_READY`.
Discovered during T-02 that `manager.memory.compactionManagers.get(name)`
returns undefined for agents whose memory init was skipped — the
canonical primitive throws at session-manager.ts:2210. Added
`AGENT_NOT_INITIALIZED` to the error union; the CLI maps it to exit
code 4 (unknown bucket).

### `tokens_before/tokens_after` are a char-proxy estimate

The SDK does not expose a token-accurate primitive at this seam. The
IPC payload's `tokens_before/after` are derived from
`CharacterCountFillProvider.getContextFillPercentage() * 200_000 / 4`
(~4 chars/token). When no provider is wired (test fixtures) the
payload returns `null` and the CLI renders "n/a". Field name kept per
CONTEXT D-12; semantics documented inline in
`daemon-compact-session-ipc.ts:estimateTokens`.

### Trivial extractMemoriesFn (MVP)

The wired extractor at the daemon switch case is a line-split filter
(non-empty lines >20 chars, capped at 20). Phase 125 replaces this
with Haiku-driven tiered extraction per CONTEXT D-12. Quality is
explicitly MVP; the primitive's correctness gates (memory.db growth,
fork-on-disk artifact, error contract) are independent of extractor
quality.

## Success-criteria mapping

| SC | Status | Note |
|----|--------|------|
| SC-1 (CLI works) | **partially closed** | `clawcode session compact <agent>` ships + exits with correct codes + produces fork artifact. Active-session JSONL on disk does NOT shrink (Path B deferral). Operator-visible smoke partially fulfilled. |
| SC-3 (memory.db grows + chunk IDs preserved + recall works) | **closed** | Integration test pins all three invariants. |
| SC-4 (mid-turn safe) | **closed** | T-06 pins D-03 budget; tool-chain-intact invariant covered structurally (no turnQueue contention at this seam under Path B). |

## Open items

1. **Live-handle hot-swap follow-up** — the deferred surgery (Path A) needed to fully close SC-1. Sized as a dedicated wave-1.5 plan; will own `stopAgent + restartAgent(resume: forkSessionId)` orchestration + the synthetic-first-turn prepend at the `inputQueue.push` chokepoint.
2. **Extractor quality is MVP.** Phase 125 owns the tiered-retention algorithm.
3. **`turnStartedAt` map not yet wired in production daemon deps.** The handler accepts it via DI; the production switch-case currently omits it, so the budget gate effectively no-ops until a follow-up threads the per-agent turn-start timestamps from `SerialTurnQueue`. T-06 pins the budget logic against an injected fixture, so the gate is correct — just not yet armed in prod.
4. **Pre-existing failing tests in `src/manager`** (18 across 6 files). None overlap with files this plan modifies. Logged for triage; not addressed here per scope-boundary rule.
5. **Deploy hold continues** (Ramy-active). All changes are local-only commits + tests; no clawdy redeploy.

## Self-Check: PASSED

- `src/manager/daemon-compact-session-ipc.ts` — exists.
- `src/cli/commands/session-compact.ts` — exists.
- `src/manager/__tests__/compact-session-integration.test.ts` — exists, 4 tests passing.
- `src/manager/__tests__/compact-session-mid-turn.test.ts` — exists, 5 tests passing.
- `src/cli/index.ts` — `registerSessionCompactCommand(program)` wired.
- `src/manager/daemon.ts` — `case "compact-session":` registered in `routeMethod` switch table (silent-path-bifurcation prevention: dispatch case + handler module are the only seam; verified by grep `grep -n 'compact-session' src/manager/daemon.ts`).
- Commits `833e274`, `6e3915a`, `c0b675e`, `aa9c082`, `946e72d` all in `git log`.
