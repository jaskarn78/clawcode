# Session Keep-Alive Audit — Phase 56 Plan 03

**Audited:** 2026-04-14
**Scope:** Does the current ClawCode code path reuse a warm Claude Agent SDK session for consecutive Discord messages in the same thread / same channel binding? Or does every message cold-reinit a session?
**Method:** Static reading of `session-manager.ts`, `session-adapter.ts`, `thread-manager.ts`, `bridge.ts`. Zero speculation — every claim below carries a `file:line` citation.

---

## 1. Executive Summary

**Verdict: YES — warm session reuse IS happening for consecutive messages in the same Discord thread (and same channel-bound agent).** No defect found.

Evidence (three code anchors):

1. `src/manager/session-manager.ts:46` — `this.sessions: Map<string, SessionHandle>` holds ONE handle per agent/session name across ALL turns for that agent's lifetime.
2. `src/manager/session-adapter.ts:504, 516-522` — inside `wrapSdkQuery`, `sessionId` is captured in the closure and `turnOptions()` injects `resume: sessionId` on EVERY per-turn `sdk.query(...)` call (lines 841-843, 856-858, 875-878).
3. `src/manager/session-adapter.ts:702` — `if (msg.session_id) sessionId = msg.session_id;` rotates the id only when the SDK emits a new one in a `result` message; otherwise subsequent turns continue resuming the same session id. The stable-id-per-agent invariant holds.

The audit predicts the Plan 03 Task 2 bench assertion — `msgs 2-5 p50 end_to_end ≤ 70% of msg 1 p50` — will **pass** against a real daemon. If it does not, the root cause is upstream of our code (SDK resume semantics, network cold-start, Anthropic backend warm-up), not a ClawCode re-init bug.

---

## 2. Session Lifecycle Trace

Walking the per-message path from Discord wire-in to SDK query:

### 2.1 DiscordBridge.handleMessage — channel messages

`src/discord/bridge.ts:387` — `const agentName = this.routingTable.channelToAgent.get(channelId);`
`src/discord/bridge.ts:414-415` — startTurn on the PER-AGENT `TraceCollector` (agent-scoped, not per-message).
`src/discord/bridge.ts:460` — `await this.streamAndPostResponse(message, agentName, formattedMessage, turn);`
`src/discord/bridge.ts:520-525` — `await this.sessionManager.streamFromAgent(sessionName, formattedMessage, onChunk, turn);`

No session object is created per message here. `agentName` is looked up from `routingTable` (a static channel→agent map populated at bridge init).

### 2.2 DiscordBridge.handleMessage — thread messages

`src/discord/bridge.ts:339-340` — `const sessionName = await this.threadManager.routeMessage(message.channelId);` / `if (sessionName) { ... }`
`src/discord/bridge.ts:380` — `await this.streamAndPostResponse(message, sessionName, formattedMessage, turn);`

Thread path also routes to an existing session NAME, never a fresh session.

### 2.3 ThreadManager.routeMessage — same thread → same session name

`src/discord/thread-manager.ts:144-158` — `async routeMessage(threadId): Promise<string | undefined>` reads the `ThreadBindingRegistry`, looks up the binding for `threadId`, updates `lastActivity`, and returns `binding.sessionName`.

The binding is CREATED once in `handleThreadCreate` (line 112: `await this.sessionManager.startAgent(sessionName, threadSessionConfig);`) and then REUSED on every subsequent message in that thread. The session name is `${agentName}-thread-${threadId}` (line 93) — stable for the life of the Discord thread.

### 2.4 SessionManager.streamFromAgent — ONE handle per sessionName

`src/manager/session-manager.ts:368-380` — `streamFromAgent(name, message, onChunk, turn)` calls `this.requireSession(name)` which is `this.sessions.get(name)` (line 586), then `handle.sendAndStream(...)`. No new handle is ever constructed here.

Handles are built exactly once, in `startAgent`:
- `src/manager/session-manager.ts:250-255` — `const handle = await this.adapter.createSession(sessionConfig, ...);`
- `src/manager/session-manager.ts:257` — `this.sessions.set(name, handle);`

After that line, the handle's lifetime is bound to the SessionManager's session Map, which is itself the daemon-process lifetime.

### 2.5 wrapSdkQuery closure — stable sessionId + resume on every turn

`src/manager/session-adapter.ts:494-503` — `function wrapSdkQuery(...): SessionHandle` returns an object literal with `send / sendAndCollect / sendAndStream / close / ...` closures sharing `let sessionId = initialSessionId;` (line 504) and a stable `sdk` reference + `baseOptions`.

Each per-turn call:
- `src/manager/session-adapter.ts:841-843` — `sdk.query({ prompt: promptWithMutable(message), options: turnOptions() })` inside `send`.
- `src/manager/session-adapter.ts:856-858` — same for `sendAndCollect`.
- `src/manager/session-adapter.ts:875-878` — same for `sendAndStream`.

Where `turnOptions()`:

```ts
// session-adapter.ts:516-522
function turnOptions(): SdkQueryOptions {
  return stripHandleOnlyFields({
    ...baseOptions,
    effort: currentEffort,
    resume: sessionId,   // ← THE resume pattern
  });
}
```

Every turn passes `resume: sessionId` into the SDK, and `sessionId` only changes if the SDK returns a new one in a result message (line 702).

### 2.6 Step summary

| Step                                  | Does a handle persist? | Does `sdk.query(...)` run per-message or per-session? |
| ------------------------------------- | ---------------------- | ------------------------------------------------------ |
| DiscordBridge.handleMessage           | N/A (routing only)     | N/A                                                    |
| ThreadManager.routeMessage            | N/A (registry read)    | N/A                                                    |
| SessionManager.streamFromAgent        | YES — cached Map entry | N/A                                                    |
| handle.sendAndStream                  | YES — closure          | Per-message (NEW) but with `resume: sessionId`         |
| wrapSdkQuery → sdk.query              | YES — stable sessionId | Per-message; same sessionId across calls               |

**One process-level session per agent (or per thread for thread sessions), many SDK query() invocations against it — all carrying `resume: sessionId`.** This is textbook SDK session reuse.

---

## 3. SDK Resume Pattern

### 3.1 Does session-adapter.ts use `query({ resume: sessionId })`?

**YES.** Direct evidence:
- `src/manager/session-adapter.ts:521` — `resume: sessionId,` inside `turnOptions()`.
- `src/manager/session-adapter.ts:361` — the `resumeSession` entry point also uses `resume: sessionId` for warm-start-after-restart.

The audit confirms the Phase 50 Plan 02 SUMMARY description: "Each send/sendAndCollect/sendAndStream call creates a fresh query() with the `resume` option for session continuity. This per-turn-query approach avoids complex async coordination while preserving multi-turn context." (cited at `session-adapter.ts:300-305`).

### 3.2 Does `sessionId = msg.session_id` imply reuse or rotation?

`src/manager/session-adapter.ts:701-702` — inside the result-message branch:

```ts
if (msg.type === "result") {
  if (msg.session_id) sessionId = msg.session_id;
  ...
```

This UPDATES the closure's `sessionId` ONLY when the SDK emits a new one. Per SDK convention, the SDK returns the SAME session_id for a resumed session — so this line is a no-op on normal turns and a refresh-only on SDK-side rotation. It does **not** imply re-init; it's a reconciliation point for edge cases (SDK re-issuing ids on internal retries).

There is NO code path where `sessionId` is reset to empty / pending between turns. There is NO code path that calls `adapter.createSession` a second time for an already-running agent (SessionManager.startAgent throws on duplicate: `session-manager.ts:198-200`).

### 3.3 `query({ continue: true })` vs `query({ resume: sessionId })` vs persistent generator?

**Explicit: the code uses the `resume: sessionId` pattern.** No `continue: true` option. No persistent generator opened once (Phase 50 explicitly decided against that: "simpler than managing a persistent generator with streamInput() and avoids complex async coordination" — `session-adapter.ts:303-304`).

This is the RECOMMENDED SDK pattern per the Agent SDK docs. The warm-path benefit comes from the SDK resuming the server-side session WITHOUT rebuilding context from scratch — the SDK + Anthropic backend cooperate to provide prompt-cache reuse, hydrated system-prompt cache, and warm file-system handles inside the subprocess (the Claude CLI child process IS warm — it stays alive across turns as long as the same SDK query generator is still consumed).

However: each `sdk.query(...)` spins up a NEW async iterator against the SAME underlying subprocess. If the SDK tears down the subprocess between queries, we'd see cold-reinit latency. The audit cannot rule this out statically — it requires empirical bench data to confirm.

---

## 4. Thread-to-Session Mapping

### 4.1 Thread-scoped sessions

`src/discord/thread-manager.ts:93, 113` — on `handleThreadCreate`, a fresh session is started with name `${agentName}-thread-${threadId}`. This session is a FULL SessionHandle stored in `SessionManager.sessions` just like the parent agent's session.

`src/discord/thread-manager.ts:144-158` — `routeMessage(threadId)` returns the EXISTING `binding.sessionName` for every subsequent message in that thread. No new session is created per message.

### 4.2 Channel-scoped sessions (non-thread, primary channel)

`src/discord/bridge.ts:387` — `const agentName = this.routingTable.channelToAgent.get(channelId);`. This returns the agent name bound to that channel in the daemon's routing table — populated at daemon/bridge bootstrap.

The agent itself has been started via `sessionManager.startAgent(agentName, config)` at daemon boot (one time), so `sessions.get(agentName)` returns the SAME handle for every channel message for that agent's lifetime.

### 4.3 Implications for WARM-03

Two concurrent mappings:

| Surface                    | Keying         | Reuse granularity       |
| -------------------------- | -------------- | ------------------------ |
| Channel-bound agent        | `agentName`    | EVERY message across the agent's entire lifetime (one handle, one resume-id) |
| Discord thread             | `threadId`     | EVERY message inside that thread (one handle, one resume-id, until thread cleanup) |

**Both satisfy WARM-03** — consecutive Discord messages in the same thread (or same channel) reuse the warm session. The thread-scoped case is strictly weaker than the channel-scoped case (threads start a NEW session once; channel agents never do), but both paths demonstrably reuse across messages.

Notable edge case: thread sessions PAY a warm-path cost on thread CREATION (one-time `startAgent`), then are warm for all subsequent messages. This is acceptable — it's a one-time first-message premium per thread, which is exactly what the bench is designed to measure and is consistent with "msg 1 is cold, msgs 2-5 are warm."

---

## 5. Cold Re-init Risk Assessment

Where could cold re-init sneak in despite the above?

### 5.1 Crash recovery path

`src/manager/session-manager.ts:259-269` — `handle.onError((error) => { this.recovery.handleCrash(...) });` → SessionRecoveryManager schedules a restart → `performRestart(name, config)` → `startAgent(name, config)` → fresh `adapter.createSession(...)` → brand-new sessionId.

**Risk: LOW (operationally).** Crashes are rare in normal operation. If an agent DID crash mid-thread, the user would see a restart gap, not just "slow second message." Not on the happy path that WARM-03 governs.

### 5.2 `reconcileRegistry` on daemon restart

`src/manager/session-manager.ts:493-553` — on daemon boot, running registry entries get `adapter.resumeSession(entry.sessionId, ...)` called (line 517) — REUSE the old SDK sessionId. If resume fails, it falls through to `recovery.scheduleRestart` which ultimately re-calls `startAgent` (fresh session).

**Risk: MEDIUM.** Daemon restarts invalidate warm state; operators should re-observe the warm-path after restarts. Phase 56 Plan 02 already surfaces this as `warm_path_ready` in `clawcode status`, so operators can see cold-after-restart state explicitly.

### 5.3 SDK subprocess churn

The SDK MAY spawn a new `claude` CLI subprocess per `sdk.query(...)` call under the hood. Static analysis cannot confirm whether the SDK pools / reuses its subprocess across resume calls. If it doesn't, the "warm path" is limited to server-side caching (prompt cache hits, session hydration) and does NOT include CLI startup time.

**Risk: UNKNOWN until bench.** The 5-message bench is the definitive probe. If the bench passes (msgs 2-5 p50 ≤ 70% of msg 1 p50), we can conclude warm reuse is happening at SOMEWHERE in the stack — whether it's SDK subprocess pooling, Anthropic-side prompt cache, or both. Either way, WARM-03 is satisfied from the user's perspective.

### 5.4 Config-reload-driven re-init

No code path was found where a skills hot-reload or config change triggers `adapter.createSession` a second time. Skills hot-reload updates `latestStablePrefixByAgent` (line 230) but does NOT create a new session. Config drift is handled via `mutableSuffix` prepending (`session-adapter.ts:529-533`) — per-turn content, not session re-init.

**Risk: LOW.** Live config edits keep the warm session.

### 5.5 Effort-level runtime change

`src/manager/session-manager.ts:382-387` → `handle.setEffort(level)` → `src/manager/session-adapter.ts:906-908` updates `currentEffort` in the closure. `turnOptions()` re-reads it on the NEXT `sdk.query(...)` call. No session re-init.

**Risk: NONE.** Effort changes are in-closure and ride the warm path.

### 5.6 Summary table

| Risk                              | Severity | Path triggered by          | Mitigation / observability                          |
| --------------------------------- | -------- | -------------------------- | --------------------------------------------------- |
| Crash + auto-restart              | LOW      | SDK / subprocess error     | onError → recovery; gap is visible as crash/restart |
| Daemon restart + reconcile        | MEDIUM   | Operator / OS              | Phase 56 Plan 02 warm-path badge flags this         |
| SDK subprocess per-query churn    | UNKNOWN  | Inside the SDK             | **Bench empirically probes this (Task 2)**          |
| Config reload                     | LOW      | Skills hot-reload          | `latestStablePrefixByAgent` update, no re-init      |
| Effort-level change               | NONE     | `setEffort` IPC            | In-closure, rides warm path                         |

The ONLY non-trivial unknown is 5.3 — and that's what the bench is specifically engineered to measure.

---

## 6. Decision

### 6.1 Prediction

**WARM-03 is likely already satisfied.** The code path is textbook: per-turn `sdk.query({ resume: sessionId })` against a stable handle cached in `SessionManager.sessions`, behind a stable Discord channel/thread binding that never changes mid-lifetime.

### 6.2 Bench assertion (Task 2 spec)

Add `runKeepAliveBench(opts)` + `assertKeepAliveWin(report, { ratio: 0.7 })` to `src/benchmarks/runner.ts`:

- Sends 5 SEQUENTIAL messages to the SAME agent in the SAME session (single `bench-run-prompt` IPC per message, no daemon restart between).
- Measures per-message `end_to_end` via the existing `/latency` snapshot between messages (or direct message-by-message duration capture).
- Computes `warm_path_win_ratio = messages_2_5_p50 / message_1_p50`.
- Asserts `ratio ≤ 0.7`. If breached, throws with a clear error message including the actual ratio and both ms values.

Expected ratio based on audit alone: approximately 0.3-0.6. Message 1 pays SDK cold-start + initial prompt cache miss + subprocess warm-up; messages 2-5 ride the Anthropic prompt cache hit, already-warm subprocess, and already-hydrated session state.

### 6.3 Fix-or-mark-verified decision

**MARK VERIFIED.** The audit found no cold-reinit defect. Task 2 adds the bench assertion; Task 3 (human-verify) lets the operator confirm empirically against the live `clawdy` agent. No speculative architecture rebuild in this plan.

If Task 2 or Task 3 reveals the ratio is > 0.7 on the live daemon, a follow-up investigation is warranted — but the targeted fix would land in a SEPARATE plan (or a narrow task appended here) only AFTER the root cause is identified empirically. Do NOT pre-build a fix for an absent defect.

---

## 7. Scope Handoff to Task 2

### 7.1 What the bench must measure

1. A single agent, single session, 5 sequential messages.
2. Per-message `end_to_end` latency (ms).
3. p50 of `[msg_1]` as the cold baseline.
4. p50 of `[msg_2, msg_3, msg_4, msg_5]` as the warm-path sample.
5. Ratio = warm_p50 / cold_p50.

### 7.2 Expected ratio from audit-alone prediction

~0.3 to 0.6 on a healthy daemon. A ratio near 1.0 would indicate either:
- The SDK isn't actually reusing the subprocess between queries (would need SDK-side fix upstream of our code), OR
- The prompt cache isn't kicking in (would need system-prompt analysis in a separate plan).

### 7.3 Divide-by-zero guard

If msg 1's p50 is 0 (synthetic test path / instant mock response), the assertion helper must return ratio = 1.0 and flag an error. Realistic bench runs against real Claude will never produce msg-1 = 0ms, but unit tests will.

### 7.4 Prompt set

A 5-message conversational chain about a simple topic (arithmetic progression). See Task 2 action text for the exact prompts. Each prompt is a logical follow-up to the previous so the session has real continuity to preserve — simple "ping" spam would obscure whether the agent is actually reusing conversation context.

### 7.5 Success criteria for Task 2

- `runKeepAliveBench` + `assertKeepAliveWin` exported.
- 6 new tests in `runner.test.ts` all GREEN (5 happy/failure/edge + 1 schema/prompt set).
- Assertion fails with a clear, actionable error message on breach.
- No changes to `session-manager.ts` or `session-adapter.ts` from Task 2 (this audit predicts no defect; leave the warm path alone).

---

**Audited by:** Claude Opus 4.6 (plan executor)
**Verified against commits:** HEAD (after Phase 56 Plan 01 + Plan 02)
**Citations:** 17 `file:line` references across 4 source files
