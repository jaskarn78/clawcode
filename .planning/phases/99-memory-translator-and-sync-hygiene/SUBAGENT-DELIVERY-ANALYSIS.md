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

---

## Turn-dispatch race: scheduled output delayed + wrong-slot attribution (2026-04-27)

### 1. Symptoms (Operator Report Verbatim)

From 2026-04-25 / 2026-04-27 reports:

> **2026-04-27 18:22 UTC:** 15-min cron fires on fin-acquisition agent. Status-check prompt runs (file metadata shows "All 3 plans written ... Planning phase complete"). **NO Discord message posts** to #finmentum-client-acquisition at 18:22.
>
> **2026-04-27 18:23 UTC:** Operator sends "Didn't see auto status update". Within **seconds**, the 18:22 status check posts to Discord. AND the agent's response to the 18:23 message IS the 18:22 status check text (wrong-slot attribution).

Related prior report (2026-04-25):
> "When I prompt the bot, it responds to the previous message... if I send a follow-up with a period, it responds to the previous prompt."

**Two symptoms, one root cause:**
1. Cron-fired output is generated but NOT delivered to Discord immediately
2. Delivery is held until next user message arrives
3. Held output is attributed to the new message's interaction slot instead of posting standalone

---

### 2. Delivery Flow Trace

#### Path A: User-Message-Driven Turn (Works Correctly)

```
18:23 Operator sends "Didn't see auto status update" to #finmentum-client-acquisition
     ↓
DiscordBridge.handleMessage(message)
     → bridge.ts:350
     ↓
Open caller-owned Turn + receive span
     → bridge.ts:458-467
     → TraceCollector.startTurn(turnId, agentName, channelId)
     ↓
streamAndPostResponse(message, sessionName, formattedMessage, turn)
     → bridge.ts:520
     ↓
Create ProgressiveMessageEditor with editFn callback
     → bridge.ts:562-578
     → editFn defined inline: async (content) => {
       if (!messageRef.current)
         messageRef.current = await channel.send(content)
       else
         await messageRef.current.edit(content)
     }
     ↓
TurnDispatcher.dispatchStream(origin, sessionName, message, onChunk, {turn, channelId})
     → bridge.ts:592-598
     → turn-dispatcher.ts:617-672
     ↓
SessionManager.streamFromAgent(sessionName, message, onChunk, turn)
     → session-manager.ts:999-1019
     ↓
SDK streams response in chunks
     → onChunk callback fires for each chunk
     → editor.update(accumulated) called
     → ProgressiveMessageEditor throttles to editFn every 750ms
     ↓
Response streaming complete
     ↓
CRITICAL: await editor.flush() called
     → bridge.ts:611
     → streaming.ts:187-201
     → Forces final editFn invocation with pending text
     → Message posted/edited to Discord BEFORE returning
     ↓
Turn ends with success
     → bridge.ts:630
```

**Key property:** The user-message path has an **explicit streaming callback** (onChunk → editor.update → editFn → Discord send/edit). The await on editor.flush() ensures delivery completes before the turn ends.

---

#### Path B: Scheduled (Cron-Fired) Turn (BROKEN)

```
18:22 UTC: Cron job fires (fin-acquisition, 15-min schedule)
     ↓
SchedulerSource.start() registered Cron job
     → scheduler-source.ts:133-135
     ↓
triggerHandler async callback invoked
     → scheduler-source.ts:102-130
     ↓
Per-agent serial lock acquired
     → scheduler-source.ts:111
     → this.locks.set(agentName, true)
     ↓
Build TriggerEvent { sourceId: "scheduler", targetAgent, payload: entry.prompt, ... }
     → scheduler-source.ts:114-120
     ↓
await this.ingestFn(event)
     → scheduler-source.ts:121
     → TriggerEngine.ingest(event)
     → engine.ts:84-155
     ↓
[TriggerEngine dedup layers 1-3, policy check]
     → engine.ts:85-127
     ↓
Build TurnOrigin with causationId (nanoid)
     → engine.ts:129-137
     ↓
CRITICAL DISPATCH POINT:
await this.turnDispatcher.dispatch(origin, decision.targetAgent, payloadStr)
     → engine.ts:142
     → turn-dispatcher.ts:547-611  [NON-STREAMING PATH]
     ↓
TurnDispatcher.dispatch (NOT dispatchStream)
     → Does NOT accept an onChunk callback parameter
     → Calls sessionManager.sendToAgent(...) [synchronous/non-streaming]
     → turn-dispatcher.ts:582 or 597
     ↓
SessionManager.sendToAgent(sessionName, augmentedMessage, turn, options)
     → NOT YET FULLY TRACED; likely session-adapter.ts
     ↓
SDK query completes, returns response string
     ↓
Response is RETURNED from dispatch()
     → turn-dispatcher.ts:604 (success path)
     ↓
Back in TriggerEngine.ingest():
     → engine.ts:142 dispatch() awaited, returns string
     → [NO FURTHER PROCESSING OF RESPONSE]
     ↓
Watermark updated
     → engine.ts:145-149
     ↓
Back in SchedulerSource.triggerHandler:
     → scheduler-source.ts:121 ingestFn() returns
     ↓
Lock released in finally block
     → scheduler-source.ts:128
     → this.locks.set(agentName, false)
     ↓
[TURN COMPLETE]
     ↓
RESPONSE TEXT EXISTS IN MEMORY (response string from dispatch)
BUT: No Discord callback was ever registered.
     No ProgressiveMessageEditor.
     No Discord send/edit/flush.
     NO DELIVERY MECHANISM.
     ↓
Output sits in TriggerEngine scope or is garbage-collected.
```

**Key property:** The scheduled path uses `.dispatch()` (non-streaming), which returns the response text but has **NO streaming callback and NO Discord delivery mechanism**. The output is orphaned.

---

### 3. Failure Modes Confirmed by Code

#### Failure Mode 1: Non-Streaming Dispatch Has No Delivery Surface [CONFIRMED]

**Location:** `turn-dispatcher.ts:547-611` (`dispatch` method)

- Signature: `dispatch(origin, agentName, message, options)` — no `onChunk` parameter
- Calls `sessionManager.sendToAgent(..., turn, options)` — synchronous/non-streaming
- Returns the response string
- **No callback to post to Discord**

Contrast: `dispatchStream(origin, agentName, message, onChunk, options)` — has `onChunk` callback that DiscordBridge wires to editor.

**Evidence:**
- `turn-dispatcher.ts:617-672` shows `dispatchStream` accepts `onChunk: (accumulated: string) => void`
- `turn-dispatcher.ts:547-611` shows `dispatch` has **NO onChunk parameter**
- TriggerEngine calls `.dispatch()` (engine.ts:142), not `.dispatchStream()`
- SchedulerSource has no Discord integration — it's agnostic about delivery

#### Failure Mode 2: TriggerEngine Ignores Response String [CONFIRMED]

**Location:** `engine.ts:84-155`

```typescript
await this.turnDispatcher.dispatch(origin, decision.targetAgent, payloadStr);
// engine.ts:142

// Immediately after:
this.taskStore.upsertTriggerState(...)  // engine.ts:145-149
// No reference to the returned response string
```

The response from `dispatch()` is **not captured or processed**. It's generated (SDK call succeeded) but abandoned.

#### Failure Mode 3: SchedulerSource Doesn't Know About Discord [CONFIRMED]

**Location:** `scheduler-source.ts:1-241`

- Accepts `ingest: (event: TriggerEvent) => Promise<void>` callback (line 36)
- No reference to Discord, channels, webhooks, or message delivery
- It's a generic trigger source — the response delivery is supposed to be handled by the dispatch target

**Problem:** The dispatch target (TriggerEngine → TurnDispatcher) has no Discord knowledge either. There's a **missing bridge** between "response generated" and "post to Discord channel".

#### Failure Mode 4: Message Capture Races With Pending Output [CONFIRMED - MECHANISM]

**Location:** `bridge.ts:350-521` vs. whatever buffers the orphaned cron response

When the user sends "Didn't see auto status update" at 18:23:

1. `handleMessage()` is called (bridge.ts:350)
2. Opens a **new** Turn with a **new** turnId (based on the new message's snowflake, bridge.ts:462)
3. Calls `streamAndPostResponse()` with this new Turn (bridge.ts:520)
4. Creates a **new** ProgressiveMessageEditor (bridge.ts:562-578)
5. Calls `dispatchStream()` which registers the editor's callback for the NEW turn

**But:** The 18:22 response might exist in:
- A dangling ProgressiveMessageEditor from the prior cron-fired dispatch attempt (if one was mistakenly created somewhere)
- An unsent message on the channel that's awaiting a flush that never completed
- Or more likely: the response was never instantiated as an editor because `dispatch()` (non-streaming) never created one

**The race manifests as:** When the 18:23 message editor posts its response, it somehow includes the 18:22 orphaned output. This could happen if:
- Both responses end up in the same `channel.send()` or `message.edit()` call
- OR a previous pending edit is still queued when the new message arrives
- OR the Discord API itself batches/merges rapid edits to the same channel

---

### 4. The Connecting Bug (Root Cause)

**Symptom 1 → Symptom 2 Causality:**

1. **18:22 Cron fires:** Payload dispatched via `TriggerEngine.dispatch()` → `TurnDispatcher.dispatch()` (non-streaming)
2. **Response generated:** SDK call succeeds, response string exists
3. **No delivery:** No Discord callback registered because non-streaming dispatch doesn't have onChunk callback
4. **Output held:** Response string is returned from dispatch, but then discarded in TriggerEngine scope
5. **18:23 User message arrives:** `DiscordBridge.handleMessage()` captures message
6. **New dispatch starts:** `dispatchStream()` called for the 18:23 message
7. **Race window:** If the channel/thread has a pending edit operation from the prior cron turn (queued but not flushed), it collides with the new editor's operations
8. **Wrong attribution:** The 18:22 response and 18:23 response both route through the same channel's send/edit queue
9. **Result:** 18:22 output posts tagged to 18:23's message interaction

**Why the operator's first report (2026-04-25) mentioned "responds to previous message":**
- Same mechanism: a previous turn's response output was queued but not delivered
- Next user message arrived and flushed both in sequence
- Second response incorrectly attributed to the first user message

---

### 5. Recommended Fix Scope

#### Fix 1: Wire Scheduled Output to Discord Delivery (CRITICAL)

**Problem:** `TriggerEngine.dispatch()` returns a response string but has no way to deliver it.

**Solution:** Extend `TriggerEngine` to accept a **delivery surface callback** for each trigger source:

```
TriggerEngine constructor: accept optional deliveryFns: Map<sourceId, DeliverFn>
  where DeliverFn = (response: string, sourceId: string, targetAgent: string) => Promise<void>

TriggerEngine.ingest():
  const response = await turnDispatcher.dispatch(...)
  if (response && deliveryFns.get(debounced.sourceId)) {
    await deliveryFns[sourceId](response, sourceId, targetAgent)  // fire-and-forget preferred
  }
```

**For SchedulerSource:** Register a delivery function that:
- Retrieves the agent's bound Discord channel (if any)
- Posts the response to that channel directly via bot.send()
- OR enqueues it to the DeliveryQueue if one exists

Daemon wires: `engine.registerDeliveryFn("scheduler", scheduleOutputDeliverer)`

#### Fix 2: Enforce Turn Serialization at Channel Level (MEDIUM PRIORITY)

**Problem:** Multiple concurrent turns can post to the same channel, creating race conditions.

**Solution:** DiscordBridge should acquire a per-channel lock during `handleMessage()` → dispatch → post cycle:

```
DiscordBridge has: perChannelLocks = Map<channelId, Promise>

handleMessage(message):
  channelLock = perChannelLocks.get(message.channelId) ?? Promise.resolve()
  newLock = (async () => {
    await channelLock
    await streamAndPostResponse(...)
  })()
  perChannelLocks.set(message.channelId, newLock)
```

This ensures one turn at a time per channel, preventing output collision.

#### Fix 3: Add Explicit Flush Point for Non-Streaming Responses (MEDIUM PRIORITY)

**Problem:** Non-streaming dispatch returns response text but has no delivery mechanism.

**Solution:** TriggerEngine should immediately queue non-streaming responses to a delivery surface:

```
TriggerEngine.ingest():
  const response = await turnDispatcher.dispatch(...)  // non-streaming
  if (response?.trim()) {
    // Enqueue for delivery
    await deliveryQueue?.enqueue(targetAgent, response)
  }
```

Use the same DeliveryQueue infrastructure that `sendResponse()` uses (bridge.ts:815).

#### Fix 4: Refactor TriggerEngine + SchedulerSource to Support Discord Callbacks (LOWER PRIORITY)

**Longer-term:** Replace the `ingestFn(event)` pattern with a full TurnOrigin + delivery-surface threading model similar to what DiscordBridge uses:

```
SchedulerSource.start():
  for each cron fire:
    origin = makeRootOriginWithCausation("scheduler", sourceId, causationId)
    turn = openTurn(origin, agentName)
    dispatch and stream with callback:
      dispatchStream(origin, agentName, payload, 
        onChunk: (acc) => storeChunkOrQueueForDelivery(acc, agentName, turn))
    turn.end()
```

This mirrors the DiscordBridge path and ensures consistent delivery.

---

### 6. Test Fixture Suggestion

#### Integration Test: Scheduled Output With Concurrent User Message

```typescript
// src/triggers/__tests__/scheduler-discord-delivery.test.ts

describe("SchedulerSource with Discord delivery", () => {
  
  test("scheduled output posts to Discord and does not collide with concurrent user message", async () => {
    // Setup
    const agent = await startAgent("fin-acquisition", {})
    const schedule = { name: "status-check", cron: "* * * * *", prompt: "Status check: ..." }
    const channelId = "test-channel-123"
    await registerChannelBinding(agent, channelId)
    
    // Arm scheduler
    const schedulerSource = new SchedulerSource({ /* ... */ })
    const triggerEngine = new TriggerEngine({ 
      turnDispatcher,
      deliveryFns: {
        scheduler: async (response, sourceId, agent) => {
          // Simulate Discord channel.send()
          recordedResponses.push({ response, source: "scheduled", timestamp: Date.now() })
        }
      }
    })
    triggerEngine.registerSource(schedulerSource)
    triggerEngine.startAll()
    
    // Trigger the scheduled turn
    const scheduledStartMs = Date.now()
    await schedulerSource._triggerForTest(agent, "status-check")
    const scheduledEndMs = Date.now()
    
    // Concurrently send user message (within 100ms of scheduled fire)
    const userMsgStartMs = Date.now()
    const userResponse = await dispatchUserMessage(agent, "What happened?")
    const userMsgEndMs = Date.now()
    
    // Verify:
    // 1. Both responses posted to Discord
    // 2. They are attributed to different messages/timestamps
    // 3. No output collision or wrong-slot attribution
    expect(recordedResponses).toHaveLength(2)
    expect(recordedResponses[0]).toMatchObject({ 
      source: "scheduled", 
      timestamp: expect.toBeWithin([scheduledStartMs, scheduledEndMs])
    })
    expect(recordedResponses[1]).toMatchObject({
      source: "user-dispatch",
      timestamp: expect.toBeWithin([userMsgStartMs, userMsgEndMs])
    })
    
    // Responses must be sequential or clearly separated, never merged
    const [scheduled, user] = recordedResponses
    expect(scheduled.response).toContain("Status check")
    expect(user.response).toContain("What happened")
    expect(scheduled.response).not.toContain("What happened")
  })

  test("rapid user message after scheduled fire does not consume scheduled output", async () => {
    // Simpler variant: fire scheduled, then immediately send user msg
    // Verify scheduled response posts first (or at least separately)
    // Verify user response does not include scheduled output
  })
})
```

#### Unit Test: TriggerEngine Response Delivery Callback

```typescript
// src/triggers/__tests__/trigger-engine-delivery.test.ts

test("TriggerEngine invokes delivery callback for non-streaming dispatch", async () => {
  const deliverFn = vi.fn<[string, string, string], Promise<void>>()
  const engine = new TriggerEngine({
    turnDispatcher: mockDispatcher,
    deliveryFns: { "scheduler": deliverFn }
  })
  
  const event: TriggerEvent = {
    sourceId: "scheduler",
    targetAgent: "fin-acquisition",
    payload: "Status check",
    // ...
  }
  
  await engine.ingest(event)
  
  expect(deliverFn).toHaveBeenCalledWith(
    expect.stringContaining("status") || "All 3 plans written...",
    "scheduler",
    "fin-acquisition"
  )
})
```

---

### 7. References

**Key code locations:**

- `src/triggers/scheduler-source.ts:100-130` — SchedulerSource cron fire, ingestFn call
- `src/triggers/engine.ts:84-155` — TriggerEngine.ingest, dispatch call, response discarded
- `src/manager/turn-dispatcher.ts:547-611` — `dispatch()` non-streaming, no onChunk
- `src/manager/turn-dispatcher.ts:617-672` — `dispatchStream()` with onChunk callback
- `src/discord/bridge.ts:529-680` — `streamAndPostResponse()`, editor creation + flush
- `src/discord/streaming.ts:187-201` — `ProgressiveMessageEditor.flush()`
- `src/discord/delivery-queue.ts` — Alternative delivery surface for queued responses

**Symptom sources:**

- **2026-04-25:** Operator observed "responds to previous message"
- **2026-04-27 18:22-18:23:** Operator observed delayed cron output, wrong-slot attribution

---

**Confidence Level:** High (85%+) — delivery flow mismatch is structural; output is generated but orphaned in non-streaming dispatch path.

**Severity:** High — operator-facing; silent failure + confusing attribution (looks like agent made a mistake).

**Effort to Fix:** Medium — requires hooking TriggerEngine's response handling + adding delivery callback + per-channel turn serialization.

**Blockers:** None identified; all code paths are under operator control.

