---
phase: quick
plan: 260419-nic
type: execute
subsystem: discord-ops
tags: [discord, slash-commands, session-manager, interrupt, steer, ux]
dependency-graph:
  requires:
    - Phase 73 (persistent-session-handle + SerialTurnQueue depth-1)
    - Phase 57 (TurnDispatcher + TurnOrigin shared contract)
    - Phase 55+ (existing discord.js slash-command registration machinery)
  provides:
    - Public SessionHandle.interrupt() + hasActiveTurn() primitives
    - SessionManager.interruptAgent(name) + SessionManager.hasActiveTurn(name)
    - Discord slash commands /clawcode-interrupt + /clawcode-steer
  affects:
    - Every SessionHandle implementation (MockSessionHandle, persistent, legacy wrapSdkQuery)
    - SlashCommandHandler constructor signature (new optional turnDispatcher)
    - Discord guild-registered command count (13 → 15)
tech-stack:
  added: []
  patterns:
    - Pure exported handler functions with deps-bag (enables vi.fn() testing without Discord pipeline)
    - Handle-level interrupt slot installed/cleared per iterateUntilResult invocation
    - Deadline-arm closure hoisted so external interrupt() arms the current iteration's race
    - Duck-type guards on handle.interrupt/hasActiveTurn for legacy compat
key-files:
  created: []
  modified:
    - src/manager/persistent-session-handle.ts
    - src/manager/persistent-session-queue.ts
    - src/manager/session-adapter.ts
    - src/manager/session-manager.ts
    - src/manager/daemon.ts
    - src/discord/slash-commands.ts
    - src/discord/slash-types.ts
    - src/discord/__tests__/slash-commands.test.ts
    - src/discord/__tests__/slash-types.test.ts
    - src/manager/__tests__/persistent-session-handle.test.ts
    - src/manager/__tests__/session-manager.test.ts
decisions:
  - "Add public interrupt()/hasActiveTurn() to SessionHandle (not AbortSignal synthesis) — surgical ~25-line additive change preserving all Phase 73 invariants"
  - "Naming: clawcode-interrupt + clawcode-steer to avoid collision with existing clawcode-stop (which stops a whole agent, not a turn)"
  - "handleSteerSlash polls SessionManager.hasActiveTurn every 50ms up to 2s; proceed-anyway on deadline (SerialTurnQueue queues behind stuck turn rather than reject)"
  - "Reuse 'discord' TurnOrigin kind for /steer dispatches — sourceId=channelId matches DiscordBridge convention"
  - "Daemon-direct routing (not IPC round-trip) for /interrupt + /steer — SlashCommandHandler already holds SessionManager + TurnDispatcher refs, saves a hop on time-sensitive abort path"
  - "handle.interrupt() is synchronous void (not Promise<void>) — q.interrupt() is fire-and-forget internally; the in-flight send rejects ~2s later via abort-deadline race"
metrics:
  duration: ~45 min
  completed: 2026-04-19
  tasks_completed: 3
  files_modified: 11
  new_tests: 18
  regressions: 0
---

# Quick Task 260419-nic: Add Discord `/clawcode-interrupt` + `/clawcode-steer` Summary

**One-liner:** Live mid-turn control via two new guild-registered Discord slash commands backed by a public SessionHandle.interrupt() primitive and SessionManager.interruptAgent passthrough — operator can abort or redirect an agent without SSHing in.

## What Shipped

Three atomic commits on master (not pushed — orchestrator handles push + deploy):

| Commit | Task | Scope |
|--------|------|-------|
| `0a31f90` | Task 1 | Expose public `interrupt()` + `hasActiveTurn()` on SessionHandle + persistent handle + MockSessionHandle + SerialTurnQueue.hasInFlight() |
| `52fa11c` | Task 2 | SessionManager.interruptAgent + SessionManager.hasActiveTurn passthroughs |
| `8ff6780` | Task 3 | /clawcode-interrupt + /clawcode-steer slash commands + daemon wiring + handler tests |

## Task-by-Task Breakdown

### Task 1 — Public SessionHandle interrupt primitives (commit `0a31f90`)

Extended `SessionHandle` type with:
- `interrupt(): void` — fires SDK `q.interrupt()` via a handle-level `currentInterruptFn` slot installed by `iterateUntilResult` on every turn entry and cleared on every exit path (success finally, catch, step.done throw, close). Synchronous by design — `q.interrupt()` is fire-and-forget.
- `hasActiveTurn(): boolean` — single source of truth via `SerialTurnQueue.hasInFlight()`.

Key subtlety: `fireInterruptOnce` had to reach the per-iteration `armDeadline` closure so external `handle.interrupt()` calls arm the deadline for the currently-pending `driverIter.next()` race. Without this, interrupt on a non-streaming turn (FakeQuery never emits `result`) hung indefinitely. Fix: `armDeadlineForCurrentIteration` closure slot hoisted to the iteration-local scope, cleared in the finally after each step.

`MockSessionHandle` implements both + a test-only `__testSetActiveTurn` hook (prefixed `__test` per existing convention — see `browser-mcp __testOnly_*`). Legacy `wrapSdkQuery` returns no-op stubs (path is test-only via `createTracedSessionHandle`).

Phase 73 invariants preserved:
- One `sdk.query()` per handle
- Depth-1 SerialTurnQueue (hasInFlight is pure getter)
- Abort-signal race with 2s INTERRUPT_DEADLINE_MS unchanged (reuses `fireInterruptOnce`)
- SessionHandle surface extended (not replaced)

**Tests:** 7 new (A–G) in `persistent-session-handle.test.ts` + 1 surface test updated:
- A: exposes interrupt + hasActiveTurn
- B: fresh handle → hasActiveTurn=false
- C: hasActiveTurn=true during in-flight, false after resolution
- D: interrupt → q.interrupt() called once + sendAndStream rejects with AbortError < 2500ms
- E: interrupt with no active turn is a no-op
- F: interrupt idempotent (3x call → q.interrupt called 1x)
- G: close() makes subsequent interrupt() a hard no-op

Final: 15/15 passing in this file.

### Task 2 — SessionManager.interruptAgent (commit `52fa11c`)

```typescript
async interruptAgent(name: string): Promise<{
  readonly interrupted: boolean;
  readonly hadActiveTurn: boolean;
}>
```

Return shape covers all four caller-visible states:
- Unknown agent → `{false, false}` (no throw, matches "no session" semantics)
- Agent running but idle → `{false, false}`
- Agent running with in-flight turn → `{true, true}` + `log.info({event: 'agent_interrupted'})`
- `handle.interrupt()` throws → `log.warn` + re-throws so the slash layer surfaces error ephemerally

Plus `hasActiveTurn(name): boolean` passthrough used by `handleSteerSlash` poll loop.

Duck-type guards on `handle.interrupt` and `handle.hasActiveTurn` keep the method safe against legacy handles that somehow predate Task 1.

**Tests:** 4 new in `session-manager.test.ts`:
- Test 1: unknown agent → {false,false}
- Test 2: running-but-idle → {false,false}
- Test 3: active turn → {true,true}, interrupt spy called once, info log captured
- Test 4: interrupt throws → re-throws + warn log captured

Final: 31/31 passing in this file.

### Task 3 — Discord `/clawcode-interrupt` + `/clawcode-steer` (commit `8ff6780`)

**slash-types.ts:** `CONTROL_COMMANDS` grew from 5 to 7:
- `clawcode-interrupt` — optional `agent` (defaults to channel's bound agent), ipcMethod `interrupt-agent`
- `clawcode-steer` — required `guidance` + optional `agent`, ipcMethod `steer-agent`

Total default (8) + control (7) = **15 slash commands** (up from 13).

**slash-commands.ts:**
- Exports two pure handler functions: `handleInterruptSlash` + `handleSteerSlash` that take plain deps-bags. Tests drive them with `vi.fn()` mocks — zero Discord pipeline in the test surface.
- `SlashCommandHandler` constructor gains optional `turnDispatcher` config (null-safe for legacy callers).
- `handleControlCommand` branches on the two new ipcMethods BEFORE the generic else — daemon-direct routing (no IPC round-trip; SlashCommandHandler already holds SessionManager + TurnDispatcher refs, saving a hop on the time-sensitive abort path).

**handleSteerSlash flow:**
1. `interruptAgent(agent)` — safe no-op if idle
2. Poll `hasActiveTurn(agent)` every 50ms for up to 2000ms until clear
3. `dispatch(origin={kind:'discord',id:channelId}, agent, '[USER STEER] ' + guidance)`

On deadline (turn never clears): log warn, proceed with dispatch anyway — SerialTurnQueue queues behind the stuck turn. Caller still gets a response once the stuck turn resolves/aborts. Reply: `↩ Steered {agent}. New response coming in this channel.`

**daemon.ts:** threads `turnDispatcher` into `SlashCommandHandler` constructor (`turnDispatcher` already in scope at line 510; wired at line 1309).

**Tests:** 7 new in `slash-commands.test.ts` + 2 updated in `slash-types.test.ts`:
- T1-T3: `handleInterruptSlash` (happy / idle / error)
- T4: `handleSteerSlash` happy — dispatch receives discord origin + `[USER STEER]` prefix + guidance
- T5: `handleSteerSlash` deadline — hasActiveTurn never flips false, log.warn, still dispatches (uses `Date.now` spy to virtualize the 2s wait)
- T6: `handleSteerSlash` dispatch error
- T7: CONTROL_COMMANDS shape + 15-total invariant + descriptions < 100 chars
- Updated `slash-types.test.ts` tests: CONTROL_COMMANDS count 5→7, valid ipcMethods grow to include `interrupt-agent` + `steer-agent`

Final: 27/27 in slash-commands.test.ts, 14/14 in slash-types.test.ts.

## Scope Corrections (From Plan)

The plan's `<scope_correction>` block surfaced three planning-scope errors the plan then corrected:

1. **`handle.interrupt()` + `hasActiveTurn()` were NOT already public Phase 73 APIs** — Phase 73 fires `q.interrupt()` only from `iterateUntilResult`'s abort-signal race path; never exposed on the handle. Plan relaxed the "no changes to persistent-session-handle.ts" constraint in Task 1 and added the primitives. All Phase 73 invariants preserved.
2. **No existing channel-access ACL on slash commands** — `slash-commands.ts` has zero `checkChannelAccess` calls. New commands follow existing (no-ACL) pattern. If ACL is wanted, it's a separate quick task across all 15 commands.
3. **`TurnDispatcher.dispatch` positional signature** — plan used the correct `(origin, agentName, message, options?)` shape (NOT the object-arg shape some earlier docs suggested).

Plus the **`clawcode-stop` naming collision** — already exists (stops whole agent). New commands avoid collision by using `clawcode-interrupt` (mid-turn abort) + `clawcode-steer` (interrupt + redirect).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing invariant update] Updated `slash-types.test.ts` CONTROL_COMMANDS count + valid-ipcMethods invariants**

- **Found during:** Task 3 final full-sweep verification
- **Issue:** `slash-types.test.ts` had two invariant tests pinned to the pre-existing CONTROL_COMMANDS shape: `expect(CONTROL_COMMANDS).toHaveLength(5)` and `validMethods = ["start", "stop", "restart", "status", "agent-create"]`. Task 3's scope explicitly grew CONTROL_COMMANDS from 5 to 7, so these invariants became FAIL after the Task 3 change. Plan's `<files>` listed slash-types.ts but not slash-types.test.ts.
- **Fix:** Updated length assertion to 7 and added `"interrupt-agent"` + `"steer-agent"` to `validMethods`. Comments reference quick-task 260419-nic for future archaeology.
- **Files modified:** `src/discord/__tests__/slash-types.test.ts`
- **Commit:** Folded into Task 3 (`8ff6780`) via amend — the update is definitionally part of Task 3's scope (CONTROL_COMMANDS shape change), and the constraint was "3 atomic commits".

No other deviations. All three tasks executed exactly as planned, including the RED-GREEN-REFACTOR TDD flow per task.

## Authentication Gates

None — this was a pure in-repo code change, no secrets or external auth touched.

## Verification

All automated verify commands ran green per-task. Final cross-cutting verification:

```
npx vitest run \
  src/manager/__tests__/persistent-session-handle.test.ts \
  src/manager/__tests__/session-manager.test.ts \
  src/discord/__tests__/slash-commands.test.ts \
  src/discord/__tests__/slash-types.test.ts
→ 87/87 passing (15 + 31 + 27 + 14)

npx tsc --noEmit 2>&1 | grep -c "error TS"
→ 29  (baseline unchanged)

npm run build
→ success — ESM dist/cli/index.js 1011.40 KB

npx vitest run  (full sweep)
→ 3073 passing / 7 failing
   7 failures all in daemon-openai.test.ts — pre-existing tolerable per plan constraints.
   (One flake in policy-watcher.test.ts resolved on re-run — 13/13 in isolation.)
```

## Known Stubs

None — every code path introduced has a real implementation. `MockSessionHandle.interrupt()` is a mock no-op by design (the plan explicitly says real abort mechanics are tested against the persistent handle, not the mock).

## Post-Deploy Smoke (Manual — Orchestrator Responsibility)

Per the plan's `<notes_to_user>`:

1. After orchestrator push + `systemctl restart clawcode`, grep the journal for the slash-registration log line. `commandCount` should flip from 13 to 15.
2. In a Discord agent channel, while agent streams a slow response:
   - `/clawcode-interrupt` → expect ephemeral `🛑 Stopped X mid-turn.` and the in-flight message edit stops growing.
3. While agent is mid-explanation:
   - `/clawcode-steer guidance:"actually just say hi"` → expect the agent to finish aborting then stream a new `hi`-style response in the channel.

## Self-Check: PASSED

Files claimed created/modified — verified present with correct content:
- FOUND: src/manager/persistent-session-handle.ts (interrupt/hasActiveTurn wired)
- FOUND: src/manager/persistent-session-queue.ts (hasInFlight added)
- FOUND: src/manager/session-adapter.ts (SessionHandle type extended, MockSessionHandle updated)
- FOUND: src/manager/session-manager.ts (interruptAgent + hasActiveTurn passthrough)
- FOUND: src/manager/daemon.ts (turnDispatcher wired into SlashCommandHandler)
- FOUND: src/discord/slash-types.ts (2 new CONTROL_COMMANDS entries)
- FOUND: src/discord/slash-commands.ts (handleInterruptSlash, handleSteerSlash, handleControlCommand branching)
- FOUND: src/discord/__tests__/slash-commands.test.ts (7 new tests)
- FOUND: src/discord/__tests__/slash-types.test.ts (2 invariants updated)
- FOUND: src/manager/__tests__/persistent-session-handle.test.ts (7 new + 1 updated)
- FOUND: src/manager/__tests__/session-manager.test.ts (4 new)

Commits claimed — verified present:
- FOUND: 0a31f90 (Task 1)
- FOUND: 52fa11c (Task 2)
- FOUND: 8ff6780 (Task 3)
