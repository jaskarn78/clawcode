---
phase: 119-a2a-delivery-reliability
plan: 03
title: A2A-03 queue-state icon mutex state machine (⏳ → 👍 → ✅/❌)
subsystem: discord-bridge
tags: [discord, observability, A2A, state-machine]
requires:
  - Phase 119-01 bot-direct fallback rung (24h soak gate before deploy — D-07)
  - 999.45 backlog source spec
provides:
  - "src/discord/queue-state-icon.ts — typed state machine, per-channel mutex, debounce, retry"
  - "QueueState enum + QUEUE_STATE_EMOJI mapping"
  - "transitionQueueState(channelId, messageId, target, discord) — public API"
  - "bridge.ts transitionIcon helper — single mutation point for queue-state reactions"
affects: [src/discord/queue-state-icon.ts, src/discord/bridge.ts, src/discord/__tests__/queue-state-icon.test.ts, src/discord/__tests__/bridge.test.ts]
decisions:
  - "Pure DI module — no discord.js import in the state machine; bridge.ts constructs the DiscordChannelHandle adapter."
  - "Sticky terminal states (DELIVERED/FAILED) — heartbeat-sweep downgrade-race guard."
  - "Reaction failures NEVER abort delivery — UX is decorative; non-rate-limit errors swallowed inside the helper."
metrics:
  duration_minutes: 18
  completed: 2026-05-14
key-decisions:
  - "Added IN_FLIGHT + DELIVERED transition sites that did not exist in bridge.ts pre-Phase-119"
---

# Phase 119 Plan 03: A2A-03 queue-state icon state machine Summary

Typed four-state queue indicator (⏳ → 👍 → ✅/❌) with per-channel mutex serialization, 200ms debounce, ≤3-attempt retry on Discord 429, and sticky terminal states. Eliminates the double-emoji races and the ⏳-vs-active-LLM ambiguity reported at 999.45.

## Files Modified

- `src/discord/queue-state-icon.ts` — **new** module. 251 lines. Typed state enum, per-channel mutex (Map<key, Promise>), debounce + retry primitives, prior-emoji tracking, `_resetQueueStateMemory()` test seam.
- `src/discord/__tests__/queue-state-icon.test.ts` — **new** test file. 248 lines. 8 vitest cases pinning state-machine semantics.
- `src/discord/bridge.ts` — replaces inline `message.react(...)` queue-state calls with `transitionIcon(message, target)` helper (5 sites covering all 4 states). Imports `transitionQueueState` + types.
- `src/discord/__tests__/bridge.test.ts` — fixture + 3 test updates for CO-4/5/6 to handle debounced fire-and-forget transitions.

## Commits

- `670931e` — feat(119-03-T01): state machine module + 8 vitest cases
- `afcab56` — feat(119-03-T02): bridge.ts wiring + bridge.test.ts updates

## State Machine API

```typescript
export type QueueState = "QUEUED" | "IN_FLIGHT" | "DELIVERED" | "FAILED";
export const QUEUE_STATE_EMOJI: Readonly<Record<QueueState, string>>;
export type DiscordChannelHandle = Readonly<{
  addReaction(channelId, messageId, emoji): Promise<void>;
  removeReaction(channelId, messageId, emoji): Promise<void>;
}>;
export function transitionQueueState(channelId, messageId, target, discord): Promise<void>;
```

## bridge.ts Wiring (5 sites)

| Site | State | Trigger |
|------|-------|---------|
| `streamAndPostResponse` start | `IN_FLIGHT` | SDK call about to start |
| Response sent successfully | `DELIVERED` | Post-render, before `turn.end("success")` (terminal) |
| Crash-recovery retry branch | `QUEUED` | Exit 143 / "is not running" recovery wait |
| QUEUE_FULL → coalesced | `QUEUED` | SerialTurnQueue depth-1 overflow absorbed |
| Non-coalesced error | `FAILED` | Real failure (auth, agent crash, etc.) (terminal) |

`grep -c "transitionIcon\|transitionQueueState" src/discord/bridge.ts` = **9** (≥ 4 required). No inline `message.react("⏳/👍/✅/❌")` calls remain.

## Verification

- `npx vitest run src/discord/__tests__/queue-state-icon.test.ts src/discord/__tests__/bridge.test.ts` — **37/37 green**.
- `npx tsc --noEmit` — clean.
- Pre-merge static-grep gates all pass.

### 8 state-machine cases pinned

(a) ⏳→👍→✅ exact pair order · (b) concurrent-same-channel serialize + debounce-collapse-to-latest · (c) 50ms burst debounce · (d) 429×2 then success = 3 attempts · (e) 4×429 = give-up, state unchanged · (f) terminal sticky · (g) idempotent same-state · (h) cross-channel parallelism.

## Deviations from Plan

### Rule 2 — Missing observable transitions added (IN_FLIGHT + DELIVERED)

- **Found during:** Task 2 (bridge.ts wiring).
- **Issue:** Pre-119 bridge.ts only emitted ⏳ (queued/retry) and ❌ (failed) — no 👍 (in-flight) or ✅ (delivered) sites existed. Plan T02 acceptance criterion `grep -c "transitionQueueState" >= 4` and the 999.45 source spec both require the full 4-state cycle.
- **Fix:** Added IN_FLIGHT site at `streamAndPostResponse` start (just before dispatchStream/streamFromAgent) and DELIVERED site after response delivery succeeds. These complete the 999.45 source-spec four-state cycle.
- **Files modified:** `src/discord/bridge.ts`.
- **Commit:** `afcab56`.

### Rule 1 — bridge.test.ts CO-4/5/6 timing regression auto-fixed

- **Found during:** Task 2 verification.
- **Issue:** Three CO-N tests directly asserted `expect(react).toHaveBeenCalledWith("⏳" | "❌")` synchronously after `await handleMessage(msg)`. The state machine debounces 200ms + chains through per-channel mutex, so the synchronous `message.react` call now lands ~400ms later. Initial test run: 3 failures.
- **Fix:** (a) Extended `makeQueueFullMessage` fixture with `reactions.cache` + `client.user.id` so the adapter's removeReaction path resolves correctly. (b) Imported `_resetQueueStateMemory` and called it in `beforeEach` AFTER draining 600ms of pending setTimeout callbacks from prior tests (the state machine's fire-and-forget pattern means earlier tests leave pending timers). (c) Added `await new Promise(r => setTimeout(r, 500))` after `handleMessage` in CO-4/5/6 to span both the IN_FLIGHT and the subsequent QUEUED/FAILED debounce windows.
- **Known cost:** the 600ms `beforeEach` drain runs on every test in the QUEUE_FULL describe block (~11 tests). That's ~6.6s of pure sleep per CI run for this file. A future cleanup plan can replace the drain with `vi.useFakeTimers()` + explicit advance — not blocking, not regressing other tests.
- **Files modified:** `src/discord/__tests__/bridge.test.ts`.
- **Commit:** `afcab56`.

## Open Items

### D-07 deploy gate (operator-enforced, NOT tooling-enforced)

Per `<operator_notes>` and CONTEXT.md D-07, Plan 03 ships **AFTER Plan 01 has been observably green in production for ≥24h**. Plan 01 was deployed previously (commits `0aa0e5e..ae4c8b1` + sentinel revision at `cfbf7bc`) and the prompt confirms it has been stable. The code + tests for Plan 03 are committed; the deploy itself is gated on explicit operator "deploy" / "ship it" per `feedback_no_auto_deploy` and `feedback_ramy_active_no_deploy`. **DO NOT deploy without explicit operator confirmation.**

### Task 3 — Operator screenshot for SC-3 (deploy-gated)

Plan 03 Task 3 is a `checkpoint:human-verify` capturing the post-deploy operator-visible verification:

1. From any agent's Discord channel, trigger a fresh A2A turn.
2. Watch the reaction transition: ⏳ → 👍 → ✅ (or ❌).
3. Screenshot the intermediate 👍 state (if catchable) and the final state.
4. Repeat on 2+ different agent channels (per-channel mutex isolation check).
5. Attach to `.planning/phases/119-a2a-delivery-reliability/119-VERIFICATION.md`.

This is the operator-visual half of SC-3 — the pre-merge half (state-machine correctness via vitest) is closed by the 8 cases in `queue-state-icon.test.ts`.

## Pre-existing test failures (NOT caused by Plan 03)

20 slash-commands-* and slash-types test failures observed during the discord suite run. Baseline-confirmed via `git stash` — `compact-session` ipcMethod regression dates to a prior phase (`slash-commands-sync-status.test.ts` last touched in commit `e2efce4`). Logged in `.planning/phases/119-a2a-delivery-reliability/deferred-items.md`.

## Self-Check: PASSED

- `src/discord/queue-state-icon.ts` — FOUND (new file, 251 lines)
- `src/discord/__tests__/queue-state-icon.test.ts` — FOUND (new file, 248 lines)
- `src/discord/bridge.ts` — FOUND (modified, 5 transitionIcon sites)
- `src/discord/__tests__/bridge.test.ts` — FOUND (modified, fixture + 3 CO-N updates)
- Commits `670931e`, `afcab56` — FOUND in `git log`.
