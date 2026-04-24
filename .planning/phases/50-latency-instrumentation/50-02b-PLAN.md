---
phase: 50-latency-instrumentation
plan: 02b
type: execute
wave: 2
depends_on: [50-01, 50-02]
files_modified:
  - src/discord/bridge.ts
  - src/scheduler/scheduler.ts
  - src/heartbeat/checks/trace-retention.ts
autonomous: true
requirements: [PERF-01]
must_haves:
  truths:
    - "DiscordBridge.handleMessage creates a Turn via SessionManager.getTraceCollector, opens the `receive` span immediately, ends `receive` before streamAndPostResponse is called, and ends the Turn with status='success'/'error' in the streamAndPostResponse try/catch"
    - "Thread routing (message.channel.isThread()) gets tracing parity — Turn is created for threads just like channels"
    - "Scheduler-initiated turns generate `turnId = 'scheduler:' + nanoid()` and construct a Turn via SessionManager.getTraceCollector; the scheduler ends the Turn (success or error)"
    - "Retention heartbeat check src/heartbeat/checks/trace-retention.ts is auto-discovered via src/heartbeat/discovery.ts; calls SessionManager.getTraceStore(agent).pruneOlderThan(cutoffIso) using perf.traceRetentionDays (default 7 days)"
    - "Retention check uses CASCADE-only deletion (parent traces row deletion cascades to trace_spans via foreign_keys ON) — NO secondary DELETE FROM trace_spans statement (per RESEARCH Pitfall 4 and CONTEXT retention addendum)"
    - "When TraceStore or agentConfig is missing for an agent, retention check returns status=healthy with message exactly 'No trace store' or 'No config' — matches Wave 0 test assertions verbatim"
    - "Traces persist across daemon restarts — validated indirectly by per-agent traces.db existing on disk and new TraceStore instances reopening the same file (canonical test in 50-00-03's trace-store-persistence.test.ts)"
  artifacts:
    - path: "src/discord/bridge.ts"
      provides: "receive span start + caller-owned Turn lifecycle + thread routing parity"
      contains: "startSpan(\"receive\""
    - path: "src/scheduler/scheduler.ts"
      provides: "scheduler:<nanoid> turnId generation; Turn construction + lifecycle ownership"
      contains: "scheduler:"
    - path: "src/heartbeat/checks/trace-retention.ts"
      provides: "Auto-discovered CheckModule that prunes expired turns per agent via CASCADE"
      contains: "default traceRetentionCheck"
  key_links:
    - from: "DiscordBridge.handleMessage"
      to: "SessionManager.getTraceCollector + TraceCollector.startTurn"
      via: "bridge constructs the Turn using Discord message.id; opens receive span; passes Turn to streamAndPostResponse"
      pattern: "getTraceCollector\\(.*\\)\\.startTurn"
    - from: "DiscordBridge.streamAndPostResponse"
      to: "SessionManager.streamFromAgent(name, msg, onChunk, turn)"
      via: "caller-owned Turn passed through as 4th argument"
      pattern: "streamFromAgent\\([^)]*turn"
    - from: "Scheduler tick handler"
      to: "SessionManager.sendToAgent(name, prompt, turn)"
      via: "scheduler constructs Turn with nanoid-prefixed turnId; caller owns end()"
      pattern: "sendToAgent\\([^)]*turn"
    - from: "src/heartbeat/checks/trace-retention.ts"
      to: "SessionManager.getTraceStore(agent).pruneOlderThan(cutoffIso)"
      via: "retention heartbeat tick"
      pattern: "pruneOlderThan"
---

<objective>
Wire the caller-owned Turn lifecycle into the two entry points (DiscordBridge, Scheduler) and add the auto-discovered retention heartbeat check. All three artifacts consume the LOCKED contract from Plan 50-02: SessionManager.getTraceCollector(agent) to construct the Turn, pass it through to streamFromAgent/sendToAgent, and end it with status='success'/'error'.

This plan completes the Wave 2 work — combined with 50-02, Phase 50's instrumentation coverage (PERF-01) is delivered.

Purpose: Close the Turn lifecycle loop and deliver retention. Every turn type (Discord channel, Discord thread, scheduler-initiated) produces a trace. Expired traces are pruned via CASCADE on a heartbeat tick.
Output: Instrumented bridge + scheduler; auto-discovered retention heartbeat check; Wave 0 tests for these surfaces turn green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/50-latency-instrumentation/50-CONTEXT.md
@.planning/phases/50-latency-instrumentation/50-RESEARCH.md
@.planning/phases/50-latency-instrumentation/50-VALIDATION.md
@.planning/phases/50-latency-instrumentation/50-00-SUMMARY.md
@.planning/phases/50-latency-instrumentation/50-01-SUMMARY.md
@.planning/phases/50-latency-instrumentation/50-02-SUMMARY.md
@.planning/codebase/CONVENTIONS.md

# Reference implementations — copy these patterns verbatim
@src/heartbeat/checks/attachment-cleanup.ts
@src/heartbeat/discovery.ts
@src/heartbeat/types.ts
@src/discord/bridge.ts
@src/scheduler/scheduler.ts

# Tests to satisfy (scaffolded in Wave 0 by Plan 50-00 Task 3)
@src/discord/__tests__/bridge.test.ts
@src/scheduler/__tests__/scheduler.test.ts
@src/heartbeat/checks/__tests__/trace-retention.test.ts

<interfaces>
<!-- CANONICAL CONTRACT (inherited from Plan 50-02; do not redefine) -->

From `src/performance/trace-collector.ts`:
```typescript
export class TraceCollector {
  startTurn(turnId: string, agent: string, channelId: string | null): Turn;
}
export class Turn {
  startSpan(name: string, metadata?: Record<string, unknown>): Span;
  end(status: "success" | "error"): void;
}
```

From `src/manager/session-manager.ts` (Plan 50-02):
```typescript
// Caller-owned Turn lifecycle. Caller constructs via getTraceCollector(agent).startTurn(...),
// passes to these methods, and calls turn.end() in its own try/catch.
getTraceStore(agentName: string): TraceStore | undefined;
getTraceCollector(agentName: string): TraceCollector | undefined;
async streamFromAgent(name: string, message: string, onChunk: (acc: string) => void, turn?: Turn): Promise<string>;
async sendToAgent(name: string, message: string, turn?: Turn): Promise<string>;
```

From `src/shared/types.ts` (Wave 1):
```typescript
export type ResolvedAgentConfig = {
  readonly perf?: { readonly traceRetentionDays?: number };
};
```

Existing contracts to respect:

From `src/discord/bridge.ts`:
- `handleMessage(message: Message)` — entry at line ~276. The Discord `message.id` is the turnId.
- `streamAndPostResponse(message, sessionName, formattedMessage)` — the streaming boundary. Turn.end() fires after this returns (success or catch).
- Thread routing path at lines 292-310 follows the same pattern.

From `src/scheduler/scheduler.ts` (~line 92):
- `await this.sessionManager.sendToAgent(agentName, schedule.prompt!)` — scheduler-triggered entry.

From `src/heartbeat/discovery.ts`:
- Loads all `.ts` files in `src/heartbeat/checks/` and registers them automatically. Dropping `trace-retention.ts` with a default export is all that is required.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wire receive span in Discord bridge (channels + threads) + scheduler turnId prefix</name>
  <files>src/discord/bridge.ts, src/scheduler/scheduler.ts</files>
  <read_first>
    - src/discord/bridge.ts (FULL — lines 276-357 handleMessage; line 365-441 streamAndPostResponse; thread routing at lines 292-310)
    - src/scheduler/scheduler.ts (FULL — locate sendToAgent invocation around line 92)
    - src/manager/session-manager.ts (Plan 50-02 output — confirm getTraceCollector + streamFromAgent(name, msg, onChunk, turn) / sendToAgent(name, msg, turn) signatures)
    - src/performance/trace-collector.ts (Wave 1 — Turn.startSpan + Turn.end signatures)
    - src/discord/__tests__/bridge.test.ts (Wave 0 — contract expectations with -t filters "receive span", "end_to_end")
    - src/scheduler/__tests__/scheduler.test.ts (Wave 0 — appended "trace" describe block with exact assertions)
  </read_first>
  <behavior>
    - DiscordBridge.handleMessage derives the target agent from the routing table; if a TraceCollector exists for that agent, calls `collector.startTurn(message.id, agent, message.channelId)` to create a Turn
    - A `receive` span is opened immediately after Turn creation (before ACL checks, attachment downloads, or session dispatch)
    - The `receive` span is ended just before `streamAndPostResponse` is invoked
    - streamAndPostResponse accepts an optional `turn?: Turn` parameter and passes it to SessionManager.streamFromAgent
    - streamAndPostResponse calls `turn?.end("success")` on resolution and `turn?.end("error")` on rejection (try/catch)
    - Thread routing branch (lines 292-310) creates a Turn with the same pattern — threads are NOT skipped
    - When getTraceCollector returns undefined (agent not running, race at startup), handleMessage proceeds without tracing — no throw, no double-Turn
    - Scheduler constructs `turnId = "scheduler:" + nanoid(10)`; calls `getTraceCollector(agentName).startTurn(turnId, agentName, null)`; passes Turn to sendToAgent; ends Turn with success/error
    - No secondary Turn is constructed inside SessionManager — the Turn owned here is the ONLY Turn for this invocation (caller-owned lifecycle, per 50-02 contract)
  </behavior>
  <action>
**Edit `src/discord/bridge.ts`:**

1. Add import at top:
```typescript
import type { Turn } from "../performance/trace-collector.js";
```

2. Locate `handleMessage` (line ~276). After the bot/webhook filter early returns but BEFORE ACL / attachment handling, construct the Turn:

```typescript
// Inside handleMessage, after bot filter and before routing logic
let turn: Turn | undefined;
let receiveSpan: import("../performance/trace-collector.js").Span | undefined;

const resolvedAgent = (() => {
  if (this.threadManager && message.channel.isThread()) {
    // Thread routing — get the agent via threadManager.getAgentForThread or similar.
    // Use the existing lookup the bridge already performs (see line ~292-310).
    return this.threadManager.resolveThread(message)?.agentName;
  }
  return this.routingTable.channelToAgent.get(message.channelId);
})();

if (resolvedAgent) {
  const collector = this.sessionManager.getTraceCollector(resolvedAgent);
  turn = collector?.startTurn(message.id, resolvedAgent, message.channelId);
  receiveSpan = turn?.startSpan("receive", {
    channel: message.channelId,
    user: message.author.id,
    is_thread: message.channel.isThread(),
  });
}
```

(Adjust the `resolvedAgent` lookup to match the actual bridge routing code — if the existing code already has a helper like `this.routeMessage(message)`, call that before creating the Turn.)

3. End the `receive` span just BEFORE the call to `streamAndPostResponse`:
```typescript
receiveSpan?.end();
await this.streamAndPostResponse(message, sessionName, formattedMessage, turn);
```

4. Update `streamAndPostResponse` signature and lifecycle:
```typescript
private async streamAndPostResponse(
  message: Message,
  sessionName: string,
  formattedMessage: string,
  turn?: Turn,
): Promise<void> {
  try {
    // ... existing setTyping + editor setup ...
    const response = await this.sessionManager.streamFromAgent(
      sessionName,
      formattedMessage,
      (accumulated) => editor!.update(accumulated),
      turn,  // caller-owned Turn passed through
    );
    // ... existing response handling ...
    turn?.end("success");
  } catch (error) {
    turn?.end("error");
    // ... existing error handling (re-throw or log) ...
  }
}
```

5. Thread routing branch (around lines 292-310): apply the SAME Turn-creation pattern inside the thread branch. Threads get traces just like channels. Do NOT early-return from Turn creation for threads.

**Edit `src/scheduler/scheduler.ts`:**

1. Add imports:
```typescript
import { nanoid } from "nanoid";
```

2. At the sendToAgent call site (~line 92), replace with Turn-owned pattern:
```typescript
const collector = this.sessionManager.getTraceCollector(agentName);
const turnId = `scheduler:${nanoid(10)}`;
const turn = collector?.startTurn(turnId, agentName, null);  // null channelId — not a Discord turn
try {
  if (schedule.handler) {
    await schedule.handler();
    turn?.end("success");
  } else {
    await this.sessionManager.sendToAgent(agentName, schedule.prompt!, turn);
    turn?.end("success");
  }
} catch (err) {
  turn?.end("error");
  throw err;
}
```

If the `schedule.handler` path does not go through sendToAgent, the Turn still tracks wall-time for the scheduled action (useful for surfacing handler latency in the CLI even without SDK spans).

**TDD cycle:**
1. RED: `npx vitest run src/discord/__tests__/bridge.test.ts src/scheduler/__tests__/scheduler.test.ts` — Wave 0 tests fail against current (non-instrumented) bridge and scheduler.
2. Implement the above.
3. GREEN: both test files pass their tracing blocks. Existing scheduler tests must still pass.
4. Full suite: `npm test` must stay green.

**Regression guard:** `grep -c 'sendTyping' src/discord/bridge.ts` should return the existing count (typing indicator behavior unchanged by this plan).
  </action>
  <verify>
    <automated>npx vitest run src/discord/__tests__/bridge.test.ts src/scheduler/__tests__/scheduler.test.ts 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q 'import type { Turn }' src/discord/bridge.ts`
    - `grep -q 'getTraceCollector' src/discord/bridge.ts`
    - `grep -q 'startSpan("receive"' src/discord/bridge.ts`
    - `grep -q 'turn\\?\\.end("success")' src/discord/bridge.ts`
    - `grep -q 'turn\\?\\.end("error")' src/discord/bridge.ts`
    - `grep -q 'receiveSpan\\?\\.end()' src/discord/bridge.ts` (receive span ended before session dispatch)
    - `grep -q 'streamFromAgent.*turn' src/discord/bridge.ts` (Turn passed to streamFromAgent)
    - `grep -q 'scheduler:' src/scheduler/scheduler.ts`
    - `grep -q 'nanoid' src/scheduler/scheduler.ts`
    - `grep -q 'getTraceCollector' src/scheduler/scheduler.ts`
    - `grep -q 'turn\\?\\.end("success")' src/scheduler/scheduler.ts`
    - `grep -q 'turn\\?\\.end("error")' src/scheduler/scheduler.ts`
    - Tests green: `npx vitest run src/discord/__tests__/bridge.test.ts src/scheduler/__tests__/scheduler.test.ts` exits 0
    - Regression guard: pre-existing tests in scheduler.test.ts still pass
  </acceptance_criteria>
  <done>Discord handleMessage starts a Turn with `message.id`, opens/ends the receive span, passes Turn to streamAndPostResponse; streamAndPostResponse ends the Turn with success/error in its try/catch. Thread routing branch has tracing parity. Scheduler generates `scheduler:<nanoid>` turnIds, owns Turn lifecycle. Wave 0 bridge + scheduler tracing tests green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create auto-discovered retention heartbeat check (CASCADE-only deletion)</name>
  <files>src/heartbeat/checks/trace-retention.ts</files>
  <read_first>
    - src/heartbeat/checks/attachment-cleanup.ts (FULL — verbatim pattern for CheckModule default export)
    - src/heartbeat/checks/__tests__/trace-retention.test.ts (Wave 0 — contract expectations; message strings must match exactly)
    - src/heartbeat/types.ts (CheckModule / CheckContext / CheckResult shape)
    - src/heartbeat/discovery.ts (confirm auto-discovery reads src/heartbeat/checks/)
    - src/manager/session-manager.ts (confirm getTraceStore + getAgentConfig signatures)
    - .planning/phases/50-latency-instrumentation/50-CONTEXT.md (retention addendum — CASCADE ratified)
    - .planning/phases/50-latency-instrumentation/50-RESEARCH.md (Pitfall 4 on orphan cleanup)
  </read_first>
  <behavior>
    - `src/heartbeat/checks/trace-retention.ts` is a default export matching `CheckModule`; auto-discovered; fetches `sessionManager.getTraceStore(agent)`; calls `pruneOlderThan(isoCutoff)` where cutoff = now - `perf.traceRetentionDays` (default 7) days
    - The check DOES NOT run a secondary `DELETE FROM trace_spans WHERE turn_id NOT IN ...` — CASCADE handles it (ratified in CONTEXT addendum; RESEARCH Pitfall 4)
    - If no TraceStore exists for the agent (race at startup), return `{ status: "healthy", message: "No trace store" }` — this message string must match exactly for the Wave 0 test
    - If no agentConfig available, return `{ status: "healthy", message: "No config available" }` — exact string
    - Metadata includes `deleted` (count), `cutoff` (ISO), and `retentionDays`
    - `name` field on the exported module is `"trace-retention"` (exact string)
  </behavior>
  <action>
**Create `src/heartbeat/checks/trace-retention.ts`** (new file):
```typescript
/**
 * Heartbeat check that prunes expired traces per agent.
 *
 * Auto-discovered by HeartbeatRunner from the checks directory.
 * Deletes rows from `traces` older than `perf.traceRetentionDays` (default 7).
 * Child spans are removed via ON DELETE CASCADE foreign key (per RESEARCH Pitfall 4
 * and the CONTEXT retention addendum dated 2026-04-13).
 */

import { subDays } from "date-fns";
import type { CheckModule, CheckResult } from "../types.js";

const DEFAULT_RETENTION_DAYS = 7;

const traceRetentionCheck: CheckModule = {
  name: "trace-retention",

  async execute(context): Promise<CheckResult> {
    const { agentName, sessionManager } = context;

    const agentConfig = sessionManager.getAgentConfig(agentName);
    if (!agentConfig) {
      return { status: "healthy", message: "No config available" };
    }

    const store = sessionManager.getTraceStore(agentName);
    if (!store) {
      return { status: "healthy", message: "No trace store" };
    }

    const retentionDays = agentConfig.perf?.traceRetentionDays ?? DEFAULT_RETENTION_DAYS;
    const cutoffDate = subDays(new Date(), retentionDays);
    const cutoffIso = cutoffDate.toISOString();

    const deleted = store.pruneOlderThan(cutoffIso);
    // NOTE: CASCADE handles trace_spans deletion. Do NOT add a secondary DELETE
    // against trace_spans — that creates the race documented in RESEARCH Pitfall 4.

    return {
      status: "healthy",
      message: deleted > 0 ? `Pruned ${deleted} expired turn(s)` : "No expired traces",
      metadata: { deleted, cutoff: cutoffIso, retentionDays },
    };
  },
};

export default traceRetentionCheck;
```

Auto-discovery handles registration — no edit to `src/heartbeat/discovery.ts` or `src/manager/daemon.ts`. Verify by running: `grep -q 'readdir.*checks' src/heartbeat/discovery.ts` to confirm the auto-load mechanism reads the directory at startup.

**Post-edit grep sanity check (MUST hold — referenced by CONTEXT addendum and checker's remaining BLOCKER 3 confirmation):**
```bash
grep -c 'DELETE FROM trace_spans' src/heartbeat/checks/trace-retention.ts
# MUST return 0 — CASCADE-only deletion per ratified CONTEXT decision
```

**TDD cycle:**
1. RED: `npx vitest run src/heartbeat/checks/__tests__/trace-retention.test.ts` — Wave 0 tests fail (module doesn't exist).
2. Implement trace-retention.ts.
3. GREEN: all 6 retention tests pass.
4. Full suite: `npm test` — no regressions.
  </action>
  <verify>
    <automated>npx vitest run src/heartbeat/checks/__tests__/trace-retention.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/heartbeat/checks/trace-retention.ts`
    - `grep -q 'name: "trace-retention"' src/heartbeat/checks/trace-retention.ts`
    - `grep -q 'export default traceRetentionCheck' src/heartbeat/checks/trace-retention.ts`
    - `grep -q 'import { subDays }' src/heartbeat/checks/trace-retention.ts`
    - `grep -q 'traceRetentionDays' src/heartbeat/checks/trace-retention.ts`
    - `grep -q 'perf\\?\\.traceRetentionDays \\?\\? 7' src/heartbeat/checks/trace-retention.ts` (default 7 days)
    - `grep -q '"No trace store"' src/heartbeat/checks/trace-retention.ts` (exact string — Wave 0 test matches this literal)
    - `grep -q '"No config available"' src/heartbeat/checks/trace-retention.ts` (exact string)
    - `grep -q 'pruneOlderThan' src/heartbeat/checks/trace-retention.ts`
    - CASCADE-only verification: `grep -c 'DELETE FROM trace_spans' src/heartbeat/checks/trace-retention.ts` returns 0 (ratified CONTEXT addendum; RESEARCH Pitfall 4)
    - Tests green: `npx vitest run src/heartbeat/checks/__tests__/trace-retention.test.ts` exits 0 (all 6 tests pass)
    - Full suite: `npm test` exits 0 (no regressions)
  </acceptance_criteria>
  <done>Retention heartbeat check exists, auto-discovered, prunes traces older than configured days (default 7) via the parent-only DELETE + CASCADE pattern. Wave 0 retention tests all green. CASCADE-only decision from CONTEXT addendum respected (zero secondary DELETE statements against trace_spans).</done>
</task>

</tasks>

<verification>
- `npx vitest run src/discord src/scheduler src/heartbeat src/manager src/performance` — all Wave 0 + Wave 1 + Wave 2 tests green
- `npm test` — full suite green (no cross-module regression)
- `grep -r 'startSpan("receive"' src/` returns ≥1 (bridge)
- `grep -r 'scheduler:' src/scheduler/` returns ≥1 (scheduler turnId prefix)
- `grep -c 'DELETE FROM trace_spans' src/heartbeat/checks/trace-retention.ts` returns 0 (CASCADE-only)
- Manual: start daemon; send a Discord message; observe `~/.clawcode/agents/<agent>/traces.db` contains a row with non-null total_ms (deferred to manual smoke in Plan 50-03)
</verification>

<success_criteria>
- [ ] DiscordBridge.handleMessage creates Turn for channel + thread routes; opens/ends receive span
- [ ] streamAndPostResponse owns Turn lifecycle (turn.end success/error)
- [ ] Scheduler generates scheduler:<nanoid> turnIds and owns Turn lifecycle
- [ ] trace-retention.ts exists with default export, CASCADE-only deletion, exact message strings matching Wave 0 tests
- [ ] No new IPC methods or UI changes in this plan (Wave 3 owns those)
- [ ] `npm test` green
- [ ] Pre-existing tests in scheduler.test.ts still pass (append-only Wave 0 edit respected)
</success_criteria>

<output>
After completion, create `.planning/phases/50-latency-instrumentation/50-02b-SUMMARY.md` listing: bridge call-site changes with line refs, scheduler turnId prefix implementation, trace-retention auto-discovery confirmation, the grep-verified zero-count of "DELETE FROM trace_spans" (proving CASCADE-only compliance), any deviations, full-suite test count delta.
</output>
