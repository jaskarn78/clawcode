# Phase 105: Trigger-policy default-allow + QUEUE_FULL coalescer storm fix — Context

**Gathered:** 2026-04-30
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — performance + functionality unblock)

<domain>
## Phase Boundary

Two production-impact bugs observed on clawdy 2026-04-30, both in core dispatch infrastructure. Fix together — they share the daemon hot path and ship as a coherent "performance/functionality unblock" patch. The remaining items from the original 105 scope (cross-agent IPC channel delivery, inbox heartbeat timeout) are deferred to **Phase 999.12** since they have lower operator impact and can ship independently.

### 1. Trigger-policy default-allow fallback (POLICY-01..03)

**Symptom:** Every scheduler/reminder/calendar/inbox event since policies.yaml went missing has been **silently dropped** before reaching its target agent. Today's journal shows the 09:00 fin-acquisition standup cron and the 08:26 finmentum-content-creator one-shot reminder both rejected with `reason: "no matching rule"`. The fail-closed behavior affects every agent: birthdays, Form ADV deadlines, daily standups, hourly checks, calendar-derived events, inbox triggers — none deliver.

**Root cause:** `src/manager/daemon.ts:2033`:
```ts
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "ENOENT") {
    bootEvaluator = new PolicyEvaluator([], configuredAgentNames);  // ← fail-closed
    log.info("no policies.yaml found, using default policy");
  } ...
}
```
With `[]` rules, every event hits the final `return { allow: false, reason: "no matching rule" }` branch in `PolicyEvaluator.evaluate()`. The function-form `evaluatePolicy(event, configuredAgents)` already exists at `src/triggers/policy-evaluator.ts:18127` — it's the simpler default-allow fallback used by `TriggerEngine.ingest()` when `this.evaluator` is null. We need to wire that semantic into the missing-file path.

**Fix:** When `policies.yaml` is missing, construct the evaluator so it allows any event whose target agent is configured. Two options for the planner to pick from:
- **(a)** Synthesize a single permissive `PolicyEvaluator` rule (`source: { kind: '*' }`, target: any configured, identity template).
- **(b)** Make `TriggerEngine` accept a `null` evaluator, which already triggers the default-allow `evaluatePolicy()` branch.

Either is one-file-touch. The boot log line `"no policies.yaml found, using default policy"` must be replaced with text that makes the semantic obvious to a future reader (e.g. `"no policies.yaml found — using default-allow evaluator (any configured agent can receive events)"`). `PolicyWatcher.onReload` must continue to swap in a real evaluator when the operator drops a `policies.yaml` in place — back-compat with hot-reload.

**Verification:** Within 5 min of deploy, journal must show scheduler events being **dispatched** (`trigger-engine: event dispatched`) instead of `policy rejected event`. Test fixture: spin a daemon with no `policies.yaml` and assert that a synthetic scheduler event reaches the target agent's dispatcher.

### 2. QUEUE_FULL coalescer storm fix (COAL-01..04)

**Symptom:** Today 09:47–09:58 PT, fin-acquisition was processing one slow turn while ~10 user messages arrived in burst. The daemon entered a runaway recursive retry loop: every ~150ms a `streamAndPostResponse` drain attempt re-tried, hit `QUEUE_FULL` (depth-2 SerialTurnQueue: in-flight + queued slots both occupied), threw the payload back into the `messageCoalescer`, and re-entered. Each iteration **wrapped the prior failed payload in another `[Combined: 1 message received during prior turn]\n\n(1) ...` header**, so message length grew ~50–100 chars per cycle (1429 → 9607 → 8454 → 8508 → 8562 → ... → 8832). Daemon CPU spiked. When the in-flight slot finally freed, the eventual successful turn received the **multiply-wrapped corrupted payload** instead of the user's original message.

**Root cause:** `src/manager/discord-bridge.ts` (or wherever `streamAndPostResponse`'s drain block lives — confirmed at line ~25380 of bundled `dist/cli/index.js`):
```ts
} catch (error) {
  if (errorMsg === QUEUE_FULL_ERROR_MESSAGE) {
    coalesced = this.messageCoalescer.addMessage(sessionName, formattedMessage, message.id);
    // ⏳ reaction added
  }
}
const pending = this.messageCoalescer.takePending(sessionName);
if (pending.length > 0) {
  const combinedPayload = this.formatCoalescedPayload(pending);  // ← wraps with [Combined: N message] header
  await this.streamAndPostResponse(message, sessionName, combinedPayload, void 0);  // ← recursion
}
```

Three concerns stack:
- **No backoff** — the recursion fires immediately, so under sustained QUEUE_FULL the loop spin-retries every ~150ms.
- **No header dedup** — when a coalesced payload itself fails with QUEUE_FULL, it gets fed back through `addMessage` → `formatCoalescedPayload` and gains a *second* `[Combined:]` wrapper. Repeated retries create deeply nested wrappers.
- **No "wait for in-flight to free" gate** — the drain attempt is fire-and-pray instead of awaiting `queue.hasInFlight() === false`.

**Fix sketch (planner picks final shape):**
- Detect "this payload was already a coalesced batch" before re-coalescing — strip/skip the `[Combined: …]` wrapper instead of re-wrapping (idempotent coalesce).
- Add `await waitForInFlightFree()` (or backoff loop with jitter, max-retries cap) before recursing through `streamAndPostResponse`. The `SerialTurnQueue` already exposes `hasInFlight()` (per `persistent-session-queue.ts` comment "Quick task 260419-nic — pure accessor for the in-flight slot").
- Cap drain depth at N (e.g. 3) to prevent unbounded recursion regardless of root cause.
- Optional: emit a `level=40 warn` log line when the storm persists past the cap so operators see it in journals.

**Verification:** Reproduce by sending 10 messages in 1s to a busy agent. Assert: (a) daemon CPU stays <5% during the burst, (b) the eventual successful turn payload contains the user's messages joined cleanly with **exactly one** `[Combined:]` wrapper (not nested), (c) no log spam — at most one `"draining coalesced messages"` line per actual drain.

**Out of scope:**
- Cross-agent IPC channel delivery (`dispatchTurn` → target's bound channel) → **deferred to Phase 999.12**
- Heartbeat inbox 10s timeout → **deferred to Phase 999.12**
- Per-turn API latency telemetry → backlog (would help diagnose slow turns but not blocking)
- 1Password rate limiting → fixed in Phase 104
- Reminder-poller MySQL "too many connections" → separate openclaw cron, not clawcode
- Async correlation-ID-based reply path (Phase 999.2 longer-term) — already deferred
- Policy DSL changes — schema unchanged

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure / performance phase. Use codebase conventions established in:

- **Phase 62** (`src/triggers/policy-loader.ts`, `policy-evaluator.ts`, `policy-watcher.ts`) for the policy layer.
- **Phase 100 follow-up** for the `triggerDeliveryFn` channel-delivery pattern (referenced for context — not modified here).
- **Phase 100-fu coalescer + Quick task 260419-nic** (`SerialTurnQueue.hasInFlight()` accessor) for the queue/coalescer layer.

### Determinism preferences
- POLICY: default-allow fallback must remain back-compat with `PolicyWatcher.onReload` — when a `policies.yaml` lands later, the watcher must replace the default-allow evaluator with the real one.
- POLICY: log line should make it **obvious** that no policies.yaml was found AND that all events are being allowed because of that. `"using default policy"` is misleading and must change.
- COAL: idempotent coalesce — a payload already wrapped in `[Combined: …]` must not gain a second wrapper when re-queued. Detect via prefix match.
- COAL: drain must wait for in-flight slot OR cap retries. Picking ONE of these two approaches is the planner's call; if both are easy, do both.
- COAL: do not regress the legitimate "user sent 3 messages while agent was working" coalesce behavior — that combine-into-one-payload is the original feature and must still work.
- Both: ship with vitest tests that pin the failure modes documented in `<specifics>` below.

</decisions>

<code_context>
## Existing Code Insights

Detailed exploration deferred to plan-phase RESEARCH.md. Known anchors (verified via `grep` against `dist/cli/index.js` on the running daemon):

### Reusable Assets
- `evaluatePolicy(event, configuredAgents)` at `src/triggers/policy-evaluator.ts` (function form, default-allow if target configured) — already exists as the back-compat fallback when `TriggerEngine.evaluator` is null. Use this directly or wrap.
- `SerialTurnQueue.hasInFlight()` at `src/manager/persistent-session-queue.ts` — pure accessor for the in-flight slot. Quick task 260419-nic shipped this exactly so callers could check before retrying.
- `MessageCoalescer.addMessage` / `takePending` — coalescer storage. Adding an idempotency check there (skip if payload starts with `[Combined:`) is one tidy place to land COAL-01.
- `formatCoalescedPayload(pending)` — produces the `[Combined: N message...]` wrapper. Adding a "is this already wrapped" guard pairs with the coalescer change.

### Established Patterns
- Phase 62 ratified: `PolicyEvaluator` is the canonical evaluator wrapper; `evaluatePolicy()` function exists as the empty-rules baseline. `TriggerEngine` accepts either via `this.evaluator` ternary.
- Phase 60 dedup → policy → dispatch pipeline is the integration point — do not bypass.
- `PolicyWatcher.onReload` calls `triggerEngine.reloadEvaluator(newEvaluator)` — must keep working when default-allow → real-rules transition happens.

### Integration Points
- `src/manager/daemon.ts` ~lines 2010-2060 — boot policy load fallback, evaluator construction.
- `src/triggers/policy-evaluator.ts` — `PolicyEvaluator.evaluate`, `evaluatePolicy`.
- `src/manager/discord-bridge.ts` (or `discord/handle-message.ts`) — `streamAndPostResponse` drain block. Find by grepping for `"draining coalesced messages as combined dispatch"`.
- `src/manager/persistent-session-queue.ts` — `SerialTurnQueue`, `MessageCoalescer`.
- Tests: `src/triggers/__tests__/policy-evaluator.test.ts`, `src/manager/__tests__/discord-bridge.test.ts` (or wherever the coalescer is tested) — extend.

</code_context>

<specifics>
## Specific Ideas

### POLICY reproducer (from clawdy journal 2026-04-30)
```
09:00:05  TriggerEngine  sourceId="scheduler"           targetAgent="fin-acquisition"           reason="no matching rule"  → policy rejected event
08:26:03  TriggerEngine  sourceId="reminder:tOy1G4Bs"   targetAgent="finmentum-content-creator" reason="no matching rule"  → policy rejected event
```
Boot log: `"no policies.yaml found, using default policy"` — replace with something like:
`"no policies.yaml found — using default-allow evaluator: any configured agent can receive events. Drop a policies.yaml at $HOME/.clawcode/policies.yaml to enable rule-based filtering."`

Test assertion: with no policies.yaml, an ingested event with `targetAgent` ∈ `configuredAgents` must dispatch (assert `"trigger-engine: event dispatched"`); with `targetAgent` ∉ `configuredAgents`, must reject with `reason: "target agent 'X' not configured"` (NOT `"no matching rule"`).

### COAL reproducer (from clawdy journal 2026-04-30 09:47–09:58)
```
09:57:48  draining coalesced messages count=1  → streaming message len=9607  → QUEUE_FULL
09:57:49  draining coalesced messages count=1  → streaming message len=8454  → QUEUE_FULL
09:57:49  draining coalesced messages count=1  → streaming message len=8508  → QUEUE_FULL  (+54 chars)
09:57:49  draining coalesced messages count=1  → streaming message len=8562  → QUEUE_FULL  (+54 chars)
... ~10 iterations of +54 chars each ...
09:57:53  agent stream complete responseLength=366
09:57:53  draining coalesced messages count=1  → streaming message len=8832  (one more cycle even after success)
09:57:53  agent response sent to Discord
```
The +54 chars/iteration is the cumulative `[Combined: 1 message received during prior turn]` wrapper getting nested. Test assertion: simulate two QUEUE_FULL throws in a row on the same payload → resulting payload must contain **at most one** `[Combined:` substring.

CPU baseline during storm: `clawcode` daemon at ~20% sustained (today's `pcpu` value in `ps`). Post-storm: 0% idle. Test target: storm CPU should not exceed normal-busy (~5%) baseline.

### Verification commands (post-deploy)
```bash
ssh clawdy 'journalctl -u clawcode --since "5 min ago" -p info --no-pager | grep -E "policy|trigger-engine"'
# expect: "default-allow evaluator" or "trigger-engine: event dispatched", NOT "policy rejected event"

ssh clawdy 'journalctl -u clawcode --since "5 min ago" --no-pager | grep -cE "QUEUE_FULL"'
# expect: 0 under normal load; bounded count during a forced burst test
```

</specifics>

<deferred>
## Deferred Ideas

- **Cross-agent IPC channel delivery (IPC-01..03)** — moved to Phase 999.12. dispatchTurn → target's bound channel via webhook→bot fallback. Mirrors `triggerDeliveryFn` pattern.
- **Heartbeat inbox 10s timeout (HB-01..02)** — moved to Phase 999.12. Bump to ≥60s OR state-aware skip while in-flight.
- **Per-turn API latency telemetry** — backlog. No `total_ms` on actual turns (only on warm-path startup). Would aid diagnostics but not blocking today.
- **Async correlation-ID reply path** — Phase 999.2's longer-term item. Out of scope.
- **policies.yaml template auto-install** — superseded by default-allow fallback. Operator can drop a real `policies.yaml` whenever rule-based filtering is needed; the watcher picks it up.
- **Policy DSL extensions** (priority overrides, time-window throttles) — schema unchanged.

</deferred>
