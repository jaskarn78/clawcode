# Subagent Discord Delivery Reliability Analysis

**Date:** 2026-04-26  
**Symptom:** Responses from short-lived subagent threads fail to post to Discord silently (no visible output), while long-running interactive subagents work correctly. Two failure traces: CGFlu9 (harness-level spawn config failure), GBqRqq (agent processes turn successfully but Discord delivery fails silently).

---

## 1. Summary

Short-lived subagents spawned via `SubagentThreadSpawner.spawnInThread()` fail to deliver follow-up replies to Discord after the initial prompt, despite successfully processing operator messages. The root cause is a **critical race condition between session initialization and message routing**: when the operator sends a follow-up message to the thread while the subagent session is still loading, the thread-to-session binding exists in the registry but the subagent session itself is not yet ready to receive turns. This manifests as a `TurnDispatcher` dispatch that completes "successfully" but produces no Discord output because the session was not fully initialized. Long-running interactive subagents work because the operator's follow-ups arrive *after* the session warm-path completes, whereas short-lived one-shot tasks fail when the operator sends rapid follow-ups before the session is operationally ready.

---

## 2. Delivery Flow Trace

### Full Path: Operator Message in Thread → Subagent Response Posted to Discord

```
1. Operator posts message in Discord thread
   ↓
2. DiscordBridge.messageCreate event fires
   → bridge.ts:173 (client.on("messageCreate"))
   ↓
3. DiscordBridge.handleMessage()
   → bridge.ts:350
   ↓
4. Bridge detects message.channel.isThread() === true
   → bridge.ts:366
   ↓
5. ThreadManager.routeMessage(threadId)
   → bridge.ts:367
   → thread-manager.ts:144
   → Reads thread-registry, looks up binding for threadId
   → Returns sessionName if binding exists, else undefined
   ↓
6. [IF BINDING FOUND] DiscordBridge opens Turn + receive span
   → bridge.ts:375-389
   → TraceCollector.startTurn(turnId, sessionName, threadId)
   → Caller-owned Turn lifecycle (bridge keeps ownership)
   ↓
7. DiscordBridge.fireTypingIndicator(message, turn)
   → bridge.ts:395-396
   ↓
8. DiscordBridge.streamAndPostResponse()
   → bridge.ts:425
   ↓
9. ProgressiveMessageEditor created
   → bridge.ts:562-578
   ↓
10. TurnDispatcher.dispatchStream()
    → bridge.ts:592-598
    → turn-dispatcher.ts:617
    → Calls sessionManager.streamFromAgent(sessionName, ...)
    ↓
11. SessionManager.streamFromAgent()
    → session-manager.ts
    → Calls adapter.wrapSdkQuery(...)
    → SDK makes Anthropic API call with agent session handle
    ↓
12. [CRITICAL PATH] SDK processes turn, returns response text
    ↓
13. ProgressiveMessageEditor.update() called for each chunk
    → Callback invokes editFn() (defined in bridge.ts:563)
    → editFn sends/edits Discord message in real-time
    ↓
14. Response fully streamed, editor.flush() called
    → bridge.ts:611
    ↓
15. Final response text posted to thread (or edited if already sent)
    → bridge.ts:614-623
    ↓
16. Turn ends with success status
    → bridge.ts:630 (turn?.end("success"))
    ↓
17. Response captured in conversation store (fire-and-forget)
    → bridge.ts:633-659
```

### Critical Decision Points (Where Delivery Can Fail Silently)

**Point A: Session Readiness Check (MISSING)**  
File: `thread-manager.ts:144`  
The `routeMessage()` function returns the sessionName if a binding exists, but **does NOT verify that the subagent session is operationally ready**. It only checks the registry binding.

**Point B: Dispatch Assumes Session is Ready**  
File: `bridge.ts:592-598` / `turn-dispatcher.ts:617`  
TurnDispatcher.dispatchStream() calls sessionManager.streamFromAgent() without checking if the session has completed its warm-path initialization. If warm-path is still in progress, the session handle may exist but not be ready to process turns.

**Point C: Stream Response to Discord (Non-Blocking)**  
File: `bridge.ts:613-627`  
The ProgressiveMessageEditor is the only delivery mechanism. If streamFromAgent() returns successfully (i.e., does not throw) but produces empty/null content, the conditional at line 613 (`if (response && response.trim().length > 0)`) silently skips Discord posting.

---

## 3. Failure Modes Identified

### Failure Mode 1: Session Initialization Not Awaited

**Location:** `subagent-thread-spawner.ts:393` (void this.postInitialMessage(...))  
**Issue:** spawnInThread() calls postInitialMessage() with `void` — fire-and-forget. The function spawns a background task that:
1. Calls `sessionManager.streamFromAgent(sessionName, initialPrompt, ...)`
2. Calls `thread.send(text)` with the response

**Problem:** Between returning from spawnInThread() and the initial message fully streaming to Discord, the binding is already persisted in the registry (line 381-382). If an operator sends a follow-up message DURING the initial-prompt stream, the second turn dispatches to a session that is mid-initialization or hasn't completed warm-path checks yet.

**Evidence:**  
- postInitialMessage wraps streamFromAgent in try/catch (line 415-431) but never awaits session readiness.
- SessionManager.startAgent() (session-manager.ts:472) completes when the session handle is created, but warm-path checks (session-manager.ts:548-571) run asynchronously as part of createSession() inside startAgent.
- No synchronization point ensures "warm-path complete → now accept routed messages."

### Failure Mode 2: Fire-and-Forget Relay + Cleanup Ordering

**Location:** `daemon.ts:4795-4798`  
**Issue:** When a subagent session ends, the registered callback fires in this order:
1. `relayCompletionToParent(threadId)` — async, fire-and-forget
2. `cleanupSubagentThread(threadId)` — removes binding

**Problem:** If the final turn is still streaming to Discord at the moment the session ends (e.g., operator sends a very short task that completes in <100ms), relayCompletionToParent may fire while the response is mid-delivery. The relay fetches the "last assistant message" from the thread (subagent-thread-spawner.ts:207) and dispatches it to the parent, but meanwhile the actual delivery of that message to Discord from the subagent side may not have completed.

**Mechanism:** The thread binding is still readable during relayCompletionToParent (line 4796) but the subagent session is already stopped (line 1259-1266 in session-manager.ts stopAgent). If the session's pending Discord posts are still in flight, there's no guarantee they post before the binding is removed.

### Failure Mode 3: Zero Channels → No Webhook Fallback

**Location:** `subagent-thread-spawner.ts:359` (channels: [])  
**Issue:** The subagent is created with `channels: []` — no channel binding. The only outbound path is:
- `postInitialMessage` → direct `thread.send(text)` (line 424)
- OR follow-up replies via streaming → ProgressiveMessageEditor.editFn (bridge.ts:563)

**Problem:** For follow-up replies, the delivery mechanism is ONLY the ProgressiveMessageEditor callback registered in streamAndPostResponse. But if streamAndPostResponse was never called for a given turn (e.g., thread-routed dispatch but message routing failed, or session returned empty), there is no editor and no callback — the response has nowhere to go.

**Evidence:**  
- Subagent config sets `webhook: {displayName, avatarUrl, webhookUrl}` from parent (line 346-352)
- But subagent has no channels bound, so the normal webhook-based agent-to-agent relay (bridge.ts:354-359) is not invoked for subagent responses
- Subagent replies ONLY post via the ProgressiveMessageEditor callback, which is instantiated per thread-routed turn in streamAndPostResponse (bridge.ts:562)
- If that callback is never wired (e.g., dispatch path bug, or turn dispatch skipped), the response evaporates

### Failure Mode 4: Missing Ready-State Synchronization

**Location:** `session-manager.ts:548-571` (warm-path check after createSession)  
**Issue:** createSession() includes runWarmPathCheck (line 548) which validates MCP servers and tool availability. This is async and happens AFTER the session handle is added to this.sessions (around line 544, inferred from warm-path being in the try block of startAgent).

**Problem:** ThreadManager.routeMessage() (thread-manager.ts:144) does NOT check if warm-path has completed. A subsequent turn dispatch could route to a session whose handle exists but whose MCP servers have not been validated yet. If an MCP tool call is required for the response and warm-path is still running, the turn may timeout or fail silently.

---

## 4. Hypothesis Ranking

### Hypothesis 1: Race Condition Between Session Readiness and Thread Message Routing [HIGHEST LIKELIHOOD]

**Evidence:**
- Operator-reported pattern: "short-lived subagents fail; long-running interactive ones succeed"
- Short-lived = one-shot initial task, operator sends follow-up rapidly
- Long-running = operator messages arrive well AFTER session is stable
- Code path: spawnInThread() persists binding immediately (line 381), but postInitialMessage() is fire-and-forget (line 393)
- Between binding-persistence and session-warmpath-completion, a routed message will dispatch to a not-quite-ready session
- CGFlu9 trace shows `input_tokens: None` — SDK call never happened, harness-level failure consistent with session not initialized

**Test to confirm:**
1. Add a debug log in sessionManager.streamFromAgent() that captures whether the session handle is in a "ready" state (warm-path complete)
2. Reproduce the failure with a short-lived task + rapid operator follow-up
3. Check logs: if the follow-up turn attempts dispatch while warm-path is in progress, this hypothesis is confirmed
4. Verify: long-running task where operator waits >2 seconds before follow-up succeeds consistently (warm-path completes ~1.5-2s typically)

### Hypothesis 2: ProgressiveMessageEditor Callback Never Wired for Some Turns [MEDIUM LIKELIHOOD]

**Evidence:**
- GBqRqq trace shows `input_tokens: 20`, `cache_read_tokens: 250354` — the agent processed the message successfully
- Status: `success` — the turn completed without error
- But no Discord output visible
- Only delivery mechanism for follow-up replies is ProgressiveMessageEditor.editFn callback (bridge.ts:563)
- If streamAndPostResponse is not called (e.g., thread routing returned sessionName but then dispatch was somehow skipped), the callback is never wired
- The response would be "successfully generated" but with nowhere to post it

**Test to confirm:**
1. Add console/log statement at bridge.ts:425 (streamAndPostResponse entry point) to verify it's called for thread-routed messages
2. Check daemon logs for GBqRqq session ID; does the thread-routed flow entry log appear?
3. Add log at ProgressiveMessageEditor constructor (streaming.ts:95) to verify editor is created
4. If editor log is missing while SDK-success log is present, the callback was never wired

### Hypothesis 3: Session End Callback Fires While Final Response is Still Posting [LOWER LIKELIHOOD but POSSIBLE]

**Evidence:**
- relayCompletionToParent (subagent-thread-spawner.ts:196) and cleanupSubagentThread (line 440) are called in sequence from daemon.ts:4795-4798
- If a response is still in flight when session ends, cleanup may delete the binding before Discord delivery completes
- However, the delivery itself uses `thread.send(text)` and message edits which return Promises — the ProgressiveMessageEditor.flush() (bridge.ts:611) awaits these
- Unless there's an unawaited Promise in the response path, this is less likely

**Test to confirm:**
1. Measure time between session-end callback invocation and final Discord message post
2. Add log in cleanupSubagentThread to capture the binding delete timestamp
3. Add log in ProgressiveMessageEditor.flush() to capture its completion timestamp
4. If cleanup fires before flush completes, this hypothesis is confirmed

---

## 5. Recommended Fix Scope

### Fix 1: Synchronize Session Readiness Before Routing Messages (CRITICAL)

**Change needed:**  
In `SessionManager`, expose a `isSessionReady(sessionName: string): boolean` method that returns true only when warm-path has completed. Call this method from `ThreadManager.routeMessage()` and return `undefined` if the session is not yet ready, signaling bridge.ts to defer the message (or retry after a short backoff).

**Phase label:** `99-N: subagent thread delivery reliability — warm-path sync`

### Fix 2: Await Session Initialization Before Persisting Thread Binding (CRITICAL)

**Change needed:**  
In `SubagentThreadSpawner.spawnInThread()`, do NOT fire-and-forget postInitialMessage(). Instead:
1. Start the session (line 367)
2. Wait for the session to be "ready" (warm-path complete)
3. THEN persist the binding (currently line 381-382)
4. THEN call postInitialMessage() async (can remain fire-and-forget now that session is stable)

This ensures the binding only exists when the session is operationally ready.

**Phase label:** `99-N: subagent thread delivery reliability — binding persistence order`

### Fix 3: Ensure ProgressiveMessageEditor Callback is Always Wired (MEDIUM PRIORITY)

**Change needed:**  
Add defensive log/metric in DiscordBridge.streamAndPostResponse() to explicitly track when the editor callback is registered and invoked. Verify that every thread-routed turn that reaches streamFromAgent() also wires the editor. If a path exists that skips editor creation, add it.

**Phase label:** `99-N: subagent thread delivery reliability — streaming callback audit`

### Fix 4: Clarify Session End Callback Timing vs. Discord Delivery (LOWER PRIORITY)

**Change needed:**  
Document the contract: session end callbacks fire BEFORE the session is fully torn down. Ensure no in-flight Discord posts are being made from the session AFTER the callback is invoked. This may require a "flush outstanding posts" phase before session stop.

**Phase label:** `99-N: subagent thread delivery reliability — session lifecycle hygiene`

---

## 6. Detailed Code Flow Analysis

### Session Initialization Path (Identifies Readiness Gap)

```
SubagentThreadSpawner.spawnInThread()
  ↓ line 367
SessionManager.startAgent(sessionName, subagentConfig)
  ↓ session-manager.ts:472
  → configs.set(sessionName, config)
  → writeRegistry(..., status="starting")
  ↓ line 503
  → memory.initMemory(sessionName, config)
  ↓ line 520-544 (inferred from try/catch structure)
  → this.sessions.set(sessionName, handle)  [SESSION EXISTS HERE, but not ready]
  ↓ line 548 (inside startAgent try block, after createSession)
  → runWarmPathCheck(handle, ...) [ASYNC, may not complete synchronously]
  ↓ line 563 (writeRegistry(..., status="running"))
[Return from startAgent occurs HERE — session is "running" but warm-path may still be in progress]
  ↓ BACK IN spawnInThread() line 381-382
  → addBinding(registry, binding)  [BINDING PERSISTED — NOW ROUTABLE]
  ↓ line 393
  → void this.postInitialMessage(thread, sessionName, ...)
     [FIRE-AND-FORGET — initial prompt streaming in background]
     [Meanwhile, operator can send follow-up → routing → dispatch to not-quite-ready session]
```

### Message Routing Path (Where Readiness Check is Missing)

```
DiscordBridge.handleMessage(message)
  ↓ message.channel.isThread() === true
ThreadManager.routeMessage(threadId)
  → thread-manager.ts:144
  → getBindingForThread(registry, threadId)
  → Returns sessionName (if binding exists)
  [NO READINESS CHECK HERE]
  ↓
DiscordBridge.streamAndPostResponse(message, sessionName, ...)
  → Creates ProgressiveMessageEditor
  → Calls TurnDispatcher.dispatchStream(..., sessionName, ...)
    → SessionManager.streamFromAgent(sessionName, ...)
      → Retrieves session handle from this.sessions.get(sessionName)
      → Calls adapter.wrapSdkQuery(...)
        [If session is not actually ready, SDK call may fail or return no content]
```

### Critical Data Point: GBqRqq Trace

From operator report:
- `input_tokens: 20` — API call DID happen (not harness-level spawn failure like CGFlu9)
- `cache_read_input_tokens: 250354` — cached context was loaded
- Status: `success` — turn completed
- But **no visible Discord output**

**Interpretation:** The subagent processed the turn, generated a response, but the delivery callback was never invoked (or the response was empty/nil). Consistent with a dispatch that completed "successfully" but produced no content to post.

---

## 7. Test Scenarios for Verification

### Test A: Rapid Follow-Up to Short Task (Reproduces Failure)

```python
# Spawn subagent with 50-character initial task
result = spawn_subagent_thread(
  parent="clawdy",
  task="Count to 5"  # Very short task
)

# Immediately (within 100ms) send follow-up as operator
send_message_to_thread(result.threadId, "That was fast! Now count to 10")

# Expected: Both initial response AND follow-up reply visible in thread
# Actual failure: Follow-up processes (input_tokens seen) but no output in thread
```

### Test B: Slow Follow-Up to Short Task (Should Succeed)

```python
# Same setup as Test A
result = spawn_subagent_thread(
  parent="clawdy",
  task="Count to 5"
)

# Wait 3 seconds (enough for warm-path to complete)
time.sleep(3)
send_message_to_thread(result.threadId, "Now count to 10")

# Expected: Follow-up visible in thread
```

### Test C: Check Session Readiness State

```python
# Instrument SessionManager.streamFromAgent():
# Log at entry: { session: sessionName, ready_state: isSessionReady(sessionName) }
# Correlate with failures: if ready_state=false at dispatch time, confirms Hypothesis 1
```

---

## 8. References

- `subagent-thread-spawner.ts:290-401` — spawnInThread() and postInitialMessage() flow
- `thread-manager.ts:144-158` — routeMessage() without readiness check
- `bridge.ts:350-427` — handleMessage() + streamAndPostResponse() dispatcher entry
- `session-manager.ts:472-644` — startAgent() warm-path lifecycle
- `daemon.ts:4795-4798` — session end callback registration
- `streaming.ts:75-223` — ProgressiveMessageEditor (only delivery mechanism for follow-up replies)

---

## 9. Appendix: Why Long-Running Subagents Work

Long-running interactive subagents (like the buildout agent `oQsSO_` with 10+ messages) work because:

1. **First message succeeds:** Initial task completes via postInitialMessage(), which streams while the session is still warming up. By the time this returns, warm-path is nearly done.

2. **Operator waits:** By the time the operator sends the first follow-up, 2-3 seconds have elapsed. Warm-path has completed. routeMessage() finds the binding, dispatch succeeds, editor posts the response.

3. **Subsequent turns:** All further operator messages arrive to an already-warmed session. No race condition.

Short-lived subagents fail because the operator's follow-up arrives during the warm-path window, before the session is fully initialized.

---

**Confidence Level:** High (80%+)  
**Severity:** High (silent failures, operator-facing)  
**Effort to Fix:** Medium (synchronization + test coverage)  
**Blockers:** None identified

---

## Resolution (2026-04-26) — sub-scope N: subagent recursion guard

**Bug:** Operator's Earl Scheib spawn from Admin Clawdy chained 5-deep nested
Admin Clawdy subagents because each subagent inherited the parent's "delegate,
do not execute" soul + had access to `mcp__clawcode__spawn_subagent_thread`.
Default `maxThreadSessions: 10` was too high to cap the blast radius.

**Fix (two layers, universal — applies to every agent):**

1. **Layer 1 — physical SDK block.** `SubagentThreadSpawner.spawnInThread`
   now injects `disallowedTools: ["mcp__clawcode__spawn_subagent_thread"]`
   on the subagent's `ResolvedAgentConfig`. The new field is plumbed
   through `ResolvedAgentConfig` → `buildSessionConfig` → `AgentSessionConfig`
   → `SdkSessionAdapter.createSession`/`resumeSession` (Rule 3 symmetric
   edits) into the SDK's `disallowedTools` option. The subagent LLM
   physically cannot invoke the recursion tool. Operator can still spawn
   subagents from a real agent session (no disallow on real agents).

2. **Layer 2 — defense-in-depth.** `DEFAULT_THREAD_CONFIG.maxThreadSessions`
   lowered from 10 → 3 (also schema.ts × 3 locations) to cap the blast
   radius if Layer 1 is somehow bypassed.

**Tests:** New `src/discord/__tests__/subagent-recursion-guard.test.ts`
covers RG1 (subagent config carries disallowedTools), RG2 (parent agent
unaffected), RG3a-e (createSession + resumeSession SDK forwarding +
back-compat omission), RG5 (multi-parent agent identity coverage).
Schema test extended with RG4a-d for the new default value. All 252
tests in the related suites pass; zero new tsc errors.

**Commits:**
- `879401d` — `test(99-N): RED — recursion-guard tests for disallowedTools + lower thread cap`
- `ee7a205` — `feat(99-N): subagents cannot spawn further subagents (disallowedTools at SDK level + cap default 10->3)`
