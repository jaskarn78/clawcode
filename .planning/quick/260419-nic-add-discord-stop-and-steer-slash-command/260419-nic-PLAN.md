---
phase: quick
plan: 260419-nic
type: execute
wave: 1
depends_on: []
files_modified:
  - src/manager/session-adapter.ts
  - src/manager/persistent-session-handle.ts
  - src/manager/session-manager.ts
  - src/manager/__tests__/session-manager.test.ts
  - src/manager/__tests__/persistent-session-handle.test.ts
  - src/discord/slash-types.ts
  - src/discord/slash-commands.ts
  - src/discord/__tests__/slash-commands.test.ts
autonomous: true
requirements: []
---

<objective>
Add Discord slash commands `/stop` and `/steer` for live control over a running agent's active turn.

- `/stop [agent]` aborts the agent's in-flight SDK turn (drops the queue slot, replies ephemeral).
- `/steer <guidance> [agent]` aborts the in-flight turn AND dispatches a new `[USER STEER] {guidance}` turn so the agent course-corrects without waiting for the current one to finish.

Purpose: Let the operator intervene mid-turn when an agent is going off-rails, without SSHing into the server to restart it.

Output: 2 new slash commands (15 total), new public `SessionHandle.interrupt()` + `hasActiveTurn()` primitives, a new `SessionManager.interruptAgent(name)` method, and full unit + integration test coverage.
</objective>

<scope_correction>
**Critical correction vs. planning scope.**

The planning scope assumed `handle.interrupt()` and `handle.hasActiveTurn()` were already exposed as public `SessionHandle` methods by Phase 73. **They are not.** Phase 73's `persistent-session-handle.ts` fires `q.interrupt()` ONLY from inside `iterateUntilResult`'s abort-signal race — the SDK-level primitive is never exposed on the public `SessionHandle` type. Verified by reading:
- `src/manager/session-adapter.ts:76-86` — `SessionHandle` type has no `interrupt` / `hasActiveTurn` fields
- `src/manager/persistent-session-handle.ts:475-552` — returned handle object exposes only `sessionId`, `send`, `sendAndCollect`, `sendAndStream`, `close`, `onError`, `onEnd`, `setEffort`, `getEffort`

Consequence: the scope's constraint "No changes to persistent-session-handle.ts (Phase 73 stable)" is **not achievable** if we want a real mid-turn interrupt. Two options were considered:
1. **Synthesize interrupt via AbortSignal on send()** — would require every caller to own an AbortController per turn, which none do today. High blast radius.
2. **Add public `interrupt()` + `hasActiveTurn()` to SessionHandle (chosen)** — surgical addition: ~25 lines in persistent-session-handle.ts, ~10 lines in session-adapter.ts (type + MockSessionHandle), zero changes to Phase 73's core streaming loop. Phase 73's invariants (one sdk.query, depth-1 SerialTurnQueue, abort-signal race, 2s deadline) are all preserved.

This plan proceeds with option 2. The Task 1 action below documents the exact delta in one place.

Additional correction: scope claimed the existing 13 slash commands enforce a "channel-access gate." They do NOT — `slash-commands.ts` has zero `checkChannelAccess` calls. The guild-scoped registration is Discord's only gate. We will follow the existing pattern (no ACL check) for consistency; if the user wants ACL enforcement, that's a separate quick task across ALL 15 commands. Noted to user in final summary.
</scope_correction>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md

<interfaces>
<!-- Extracted from codebase so executor needs no scavenger hunt. -->

From src/manager/session-adapter.ts (lines 73-86):
```typescript
export type SendOptions = { readonly signal?: AbortSignal };

export type SessionHandle = {
  readonly sessionId: string;
  send: (message: string, turn?: Turn, options?: SendOptions) => Promise<void>;
  sendAndCollect: (message: string, turn?: Turn, options?: SendOptions) => Promise<string>;
  sendAndStream: (message: string, onChunk: (accumulated: string) => void, turn?: Turn, options?: SendOptions) => Promise<string>;
  close: () => Promise<void>;
  onError: (handler: (error: Error) => void) => void;
  onEnd: (handler: () => void) => void;
  setEffort: (level: "low" | "medium" | "high" | "max") => void;
  getEffort: () => "low" | "medium" | "high" | "max";
};
```

From src/manager/persistent-session-handle.ts (abort path internals, lines 183-260):
```typescript
// Inside iterateUntilResult:
let interruptCalled = false;
const fireInterruptOnce = (): void => {
  if (interruptCalled) return;
  interruptCalled = true;
  try { void q.interrupt(); } catch { /* ignore */ }
};
// `q` is the one long-lived SdkQuery captured at handle construction.
// `turnQueue: SerialTurnQueue` — depth-1 mutex; `inFlight` / `queued` fields.
```

From src/manager/session-manager.ts (lines 57, 757-759):
```typescript
private readonly sessions: Map<string, SessionHandle> = new Map();

private requireSession(name: string): SessionHandle {
  const handle = this.sessions.get(name);
  if (!handle) throw new SessionError(`Agent '${name}' is not running`, name);
  return handle;
}
```

From src/manager/turn-dispatcher.ts (lines 96-126):
```typescript
// Signature:
async dispatch(
  origin: TurnOrigin,
  agentName: string,
  message: string,
  options: DispatchOptions = {},
): Promise<string>
// NOTE: takes 3 positional args + options. Origin FIRST, then agent, then message.
// The scope's sample call `dispatch({ agent, origin, userMessage })` was WRONG shape.
```

From src/manager/turn-origin.ts (lines 21, 79-88):
```typescript
export const SOURCE_KINDS = ["discord", "scheduler", "task", "trigger", "openai-api"] as const;
export function makeRootOrigin(kind: SourceKind, sourceId: string): TurnOrigin;
// TurnOrigin already has a 'discord' kind. We reuse it for /steer —
// sourceId = channelId (same convention as DiscordBridge).
```

From src/discord/slash-types.ts (lines 134-185):
```typescript
// Pattern for control commands — the 13 existing commands include:
{
  name: "clawcode-stop",       // ALREADY EXISTS — stops a whole agent (not mid-turn)
  description: "Stop an agent",
  claudeCommand: "",
  control: true,
  ipcMethod: "stop",
  options: [{ name: "agent", type: 3, description: "Agent name to stop", required: true }],
}
```

**Naming collision alert:** `clawcode-stop` already exists. Our new command MUST be named `clawcode-interrupt` (verb-aligned with interruptAgent), NOT `clawcode-stop`. Similarly new command is `clawcode-steer`.

From src/discord/slash-commands.ts (lines 344-414):
```typescript
// Control-command handler: defers reply (ephemeral), reads `agent` option,
// sends IPC request to daemon via `sendIpcRequest(SOCKET_PATH, ipcMethod, { name })`.
// Our new commands follow the same pattern — ipcMethod names: "interrupt-agent", "steer-agent".
```

From src/ipc/client.ts (implied by existing usage):
```typescript
// sendIpcRequest(socketPath: string, method: string, params: object): Promise<unknown>
// Routes to daemon's routeMethod dispatcher.
```
</interfaces>

Source files (read in full for Task 1/2 — listed but not inlined to keep plan compact):
@src/manager/persistent-session-handle.ts
@src/manager/session-adapter.ts
@src/manager/session-manager.ts
@src/manager/persistent-session-queue.ts
@src/discord/slash-commands.ts
@src/discord/slash-types.ts
@src/discord/__tests__/slash-commands.test.ts
@src/manager/__tests__/persistent-session-handle.test.ts
@src/manager/__tests__/session-manager.test.ts
@src/manager/turn-dispatcher.ts
@src/manager/turn-origin.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Expose public `interrupt()` + `hasActiveTurn()` on SessionHandle, wire through persistent-session-handle + MockSessionHandle + SerialTurnQueue</name>
  <files>
    src/manager/session-adapter.ts
    src/manager/persistent-session-handle.ts
    src/manager/persistent-session-queue.ts
    src/manager/__tests__/persistent-session-handle.test.ts
  </files>
  <behavior>
    RED tests first in persistent-session-handle.test.ts (append to existing describe("createPersistentSessionHandle", ...)):

    - Test A: "handle exposes interrupt() and hasActiveTurn() on public surface" — expect typeof handle.interrupt === "function" AND typeof handle.hasActiveTurn === "function".
    - Test B: "hasActiveTurn() returns false on a fresh handle (no send yet)" — construct handle, expect hasActiveTurn() to be false.
    - Test C: "hasActiveTurn() returns true while a sendAndStream is awaiting the SDK" — start sendAndStream, await 2 microtasks so the push + iterateUntilResult are awaiting driverIter.next(), expect hasActiveTurn() === true BEFORE emitting result. After emitStockTurn + awaiting the promise, expect hasActiveTurn() === false.
    - Test D: "interrupt() with active turn → calls q.interrupt() exactly once and the in-flight sendAndStream rejects with AbortError within 2500ms" — start sendAndStream, await microtasks, call handle.interrupt(), expect controller.interrupt to have been called, expect the send promise to reject with { name: "AbortError" }. Elapsed < 2500ms.
    - Test E: "interrupt() with no active turn is a no-op: returns void, does NOT call q.interrupt()" — construct handle, call handle.interrupt() (no prior send), expect no throw, expect getController().interrupt NOT to have been called. (Note: getController() may throw "FakeQuery not yet created" if buildHarness's inner `query` vi.fn hasn't been invoked; if so, assert via try/catch that the controller was never created.)
    - Test F: "interrupt() is idempotent: calling twice during the same in-flight turn fires q.interrupt() only once" — start send, interrupt twice in quick succession, expect getController().interrupt to have been called exactly once (same count as before the 2nd call).
    - Test G: "close() makes subsequent interrupt() a no-op" — close the handle, call interrupt(), expect no throw and getController().interrupt NOT called (or unchanged count).
  </behavior>
  <action>
    GREEN implementation (after tests fail as expected):

    **Step 1 — `src/manager/persistent-session-queue.ts`**:
    Extend `SerialTurnQueue` with a public `hasInFlight(): boolean` method:
    ```typescript
    hasInFlight(): boolean { return this.inFlight !== null; }
    ```
    Pure accessor, no state change. Matches the existing pattern (no setter leakage).

    **Step 2 — `src/manager/session-adapter.ts`** (lines 76-86, SessionHandle type):
    Add two new method signatures:
    ```typescript
    export type SessionHandle = {
      // ... existing fields unchanged ...
      /**
       * Phase 73 extension (quick task 260419-nic) — mid-turn abort primitive.
       *
       * When a turn is in-flight, fires the SDK Query.interrupt() and the
       * awaiting send/sendAndCollect/sendAndStream rejects with AbortError
       * within the 2s interrupt-deadline window. When no turn is in-flight,
       * returns without side effects (idempotent no-op).
       *
       * Never throws — interrupt failure is swallowed (matches fireInterruptOnce).
       */
      interrupt: () => void;
      /**
       * Phase 73 extension (quick task 260419-nic) — in-flight turn probe.
       *
       * Returns true when there is an active iterateUntilResult() consuming
       * driverIter, false otherwise (handle freshly created OR last turn resolved
       * OR handle closed). Backed by the depth-1 SerialTurnQueue.inFlight slot.
       */
      hasActiveTurn: () => boolean;
    };
    ```

    Also update `MockSessionHandle` class (lines 121-211):
    - Add private field: `private activeTurn: boolean = false;`
    - In `sendAndCollect` and `sendAndStream`: set `activeTurn = true` at entry, `false` in finally-style (after the mock awaits and resolves — since the mock is synchronous-ish, just set false before the return). `send()` too.
    - Add `hasActiveTurn(): boolean { return this.activeTurn; }`
    - Add `interrupt(): void { /* mock no-op — tests use the real handle for interrupt behavior */ }`
    - Mock satisfies the new type; `SessionManager.interruptAgent` tests that pass a MockSessionHandle get `hasActiveTurn=false` / interrupt no-op by default. One mock test will explicitly flip `activeTurn = true` to exercise the positive path.

    **Step 3 — `src/manager/persistent-session-handle.ts`**:

    The existing `fireInterruptOnce` is a closure LOCAL to each `iterateUntilResult` call. We need a new handle-level interrupt function that can reach the current iteration's interrupt path. Pattern: store a module-level-to-handle `currentInterruptFn` slot that `iterateUntilResult` installs on entry and clears on finally.

    a) Add near the top of the handle closure (after `const turnQueue = new SerialTurnQueue();`):
    ```typescript
    // quick-task 260419-nic — public interrupt primitive.
    // Set by iterateUntilResult on entry (points at its fireInterruptOnce),
    // cleared on exit. handle.interrupt() reads and invokes if set.
    let currentInterruptFn: (() => void) | null = null;
    ```

    b) Inside `iterateUntilResult`, right after `const fireInterruptOnce = (): void => { ... };`:
    ```typescript
    currentInterruptFn = fireInterruptOnce;
    ```
    And at the END of the outer try/finally (both success return AND the catch path), clear it:
    ```typescript
    // In the existing outer try { ... } finally { signal.removeEventListener(...); }:
    finally {
      if (signal) signal.removeEventListener("abort", abortHandler);
      currentInterruptFn = null;
    }
    ```
    AND in the catch block that currently calls `closeAllSpans()`:
    ```typescript
    } catch (err) {
      closeAllSpans();
      currentInterruptFn = null;   // ADDED
      // ... existing AbortError / notifyError path unchanged ...
    }
    ```
    Also clear at the top of the `if (step.done)` path before the throw, to be safe:
    ```typescript
    if (step.done) {
      currentInterruptFn = null;
      throw new Error("generator-dead");
    }
    ```

    c) Extend the returned handle object (lines 475-552) with:
    ```typescript
    interrupt(): void {
      if (closed) return;
      const fn = currentInterruptFn;
      if (fn) fn();
    },
    hasActiveTurn(): boolean {
      return !closed && turnQueue.hasInFlight();
    },
    ```

    d) In `close()`, also clear `currentInterruptFn = null;` after `closed = true;` so post-close interrupt calls are hard no-ops.

    **Step 4 — verify Phase 73 invariants preserved**:
    - `sdk.query` still called exactly once (no change to construction).
    - `SerialTurnQueue` depth-1 semantics unchanged (hasInFlight is a pure getter).
    - Abort-signal race with 2s deadline unchanged (reuses fireInterruptOnce).
    - SessionHandle surface is EXTENDED with two methods — existing fields all present. The existing "SessionHandle surface is byte-identical" test at line 224 of persistent-session-handle.test.ts needs to be UPDATED (now checks 10 methods instead of 8: add `typeof handle.interrupt === "function"` and `typeof handle.hasActiveTurn === "function"`).

    Commit atomic: `feat(session): expose public interrupt() + hasActiveTurn() on SessionHandle (quick 260419-nic)`
  </action>
  <verify>
    <automated>npx vitest run src/manager/__tests__/persistent-session-handle.test.ts 2>&1 | tail -25</automated>
  </verify>
  <done>
    - New tests A-G all pass; existing "surface is byte-identical" test updated and still passes.
    - `SessionHandle` type in session-adapter.ts has two new fields.
    - `MockSessionHandle` implements the new fields.
    - `SerialTurnQueue.hasInFlight()` exists.
    - Grep verifies: `grep -n "interrupt" src/manager/persistent-session-handle.ts | wc -l` ≥ 4 (original abort path + new public interrupt + clear slots).
    - Grep verifies: `grep -c "hasActiveTurn" src/manager/session-adapter.ts src/manager/persistent-session-handle.ts` each ≥ 1.
    - Full persistent-session-handle test file: ALL tests green (no regression in the 8 existing tests).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add `SessionManager.interruptAgent(name)` primitive + unit tests</name>
  <files>
    src/manager/session-manager.ts
    src/manager/__tests__/session-manager.test.ts
  </files>
  <behavior>
    RED tests first — append a new `describe("interruptAgent", ...)` block to session-manager.test.ts:

    - Test 1 "unknown agent → no-op return {interrupted:false, hadActiveTurn:false}" — call `manager.interruptAgent("nonexistent")`. Expect result `{ interrupted: false, hadActiveTurn: false }`. Expect no throw. Expect adapter.sessions (MockSessionAdapter.sessions) to be unchanged.

    - Test 2 "agent running but no active turn → no-op, returns {interrupted:false, hadActiveTurn:false}" — start agent, assert MockSessionHandle.hasActiveTurn() === false, call interruptAgent. Expect `{interrupted:false, hadActiveTurn:false}`.

    - Test 3 "agent running WITH active turn → calls handle.interrupt(), returns {interrupted:true, hadActiveTurn:true}, emits log.info with event:'agent_interrupted'" — start agent, flip MockSessionHandle's private `activeTurn` to true (use a test helper exposed on MockSessionHandle OR via `(mockHandle as unknown as { activeTurn: boolean }).activeTurn = true;`). Spy on mockHandle.interrupt. Call interruptAgent. Expect `{interrupted:true, hadActiveTurn:true}`. Expect mockHandle.interrupt to have been called exactly once. Expect log capture (inject a pino mock via SessionManager constructor `log` option) to have received `{ agent: name, event: 'agent_interrupted' }` at info level.

    - Test 4 "handle.interrupt() throws → re-throws + log.warn" — start agent, flip activeTurn=true, replace `mockHandle.interrupt` with `vi.fn(() => { throw new Error("interrupt boom"); })`. Expect interruptAgent to reject with /interrupt boom/. Expect log.warn to have been called with agent name + error message.

    **MockSessionHandle test-hook**: add a public (but test-only, commented as such) setter `__testSetActiveTurn(v: boolean): void { this.activeTurn = v; }` on MockSessionHandle in session-adapter.ts. Tests call this directly; production code never does. Prefix `__test` follows existing test-only conventions (search `__testOnly_` in codebase — browser-mcp uses it).
  </behavior>
  <action>
    GREEN implementation:

    **session-adapter.ts**: Add the test-only setter on MockSessionHandle:
    ```typescript
    /** Test-only hook — flip activeTurn to drive interruptAgent tests. Never called from production. */
    __testSetActiveTurn(v: boolean): void { this.activeTurn = v; }
    ```

    **session-manager.ts**: Add public `interruptAgent` method after `stopAgent` (around line 598):
    ```typescript
    /**
     * Quick task 260419-nic — interrupt the agent's in-flight SDK turn.
     *
     * Returns a 2-flag tuple so callers (e.g., /stop Discord slash) can render
     * the right message:
     *   - hadActiveTurn=false, interrupted=false → "No active turn for X"
     *   - hadActiveTurn=true,  interrupted=true  → "Stopped X mid-turn"
     *
     * No-op (returns {false,false}) when:
     *   - the agent is not in this.sessions (never started / already stopped)
     *   - the handle does not expose `interrupt` / `hasActiveTurn` (legacy
     *     wrapSdkQuery handles, or MockSessionHandle in tests that didn't
     *     enable activeTurn)
     *   - hasActiveTurn() returns false
     *
     * Throws if handle.interrupt() throws — caller (slash-command layer)
     * surfaces the error ephemerally.
     */
    async interruptAgent(
      name: string,
    ): Promise<{ readonly interrupted: boolean; readonly hadActiveTurn: boolean }> {
      const handle = this.sessions.get(name);
      if (!handle) {
        return { interrupted: false, hadActiveTurn: false };
      }
      // Duck-type check — legacy wrapSdkQuery handles (used only by test-only
      // createTracedSessionHandle) lack these methods. Treat as no-op.
      if (typeof handle.interrupt !== "function" || typeof handle.hasActiveTurn !== "function") {
        return { interrupted: false, hadActiveTurn: false };
      }
      if (!handle.hasActiveTurn()) {
        return { interrupted: false, hadActiveTurn: false };
      }
      try {
        handle.interrupt();
      } catch (err) {
        this.log.warn(
          { agent: name, error: (err as Error).message },
          "interrupt failed",
        );
        throw err;
      }
      this.log.info({ agent: name, event: "agent_interrupted" }, "agent turn interrupted");
      return { interrupted: true, hadActiveTurn: true };
    }
    ```

    Note on return type: `handle.interrupt` in the SessionHandle type from Task 1 returns `void`, NOT `Promise<void>` — we made it synchronous because `q.interrupt()` is already fire-and-forget internally. No `await` needed. The caller's in-flight `sendAndStream` rejects ~2s later via the abort-deadline race; `interruptAgent` returns immediately once the interrupt is fired.

    Commit: `feat(session-manager): add interruptAgent primitive (quick 260419-nic)`
  </action>
  <verify>
    <automated>npx vitest run src/manager/__tests__/session-manager.test.ts -t "interruptAgent" 2>&1 | tail -20</automated>
  </verify>
  <done>
    - 4 new tests pass, 0 regressions in the rest of session-manager.test.ts.
    - `SessionManager.interruptAgent` exists, typed, documented.
    - MockSessionHandle has `__testSetActiveTurn` hook.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Discord slash commands `/stop` + `/steer` with daemon IPC wiring + integration tests</name>
  <files>
    src/discord/slash-types.ts
    src/discord/slash-commands.ts
    src/manager/daemon.ts
    src/discord/__tests__/slash-commands.test.ts
  </files>
  <behavior>
    RED tests first — add a new `describe("slash /clawcode-interrupt + /clawcode-steer", ...)` to slash-commands.test.ts. The existing test file imports pure helpers (formatCommandMessage, buildFleetEmbed); we need NEW tests that drive `handleInteraction` or `handleControlCommand`. Since `SlashCommandHandler.handleInteraction` is private, we export a test-only helper OR we lift the interrupt+steer logic into exported functions that take plain deps.

    **Chosen approach**: Export a pair of pure handler functions from `slash-commands.ts`:

    ```typescript
    // Exported for testing. Handles the /clawcode-interrupt command's logic
    // GIVEN a resolved agent name + dependencies. Returns the reply string
    // the caller should ephemeral-edit-reply with.
    export async function handleInterruptSlash(deps: {
      readonly agentName: string;
      readonly interruptAgent: (name: string) => Promise<{ interrupted: boolean; hadActiveTurn: boolean }>;
      readonly log: Logger;
    }): Promise<string> { ... }

    // Exported for testing. Handles the /clawcode-steer command's logic.
    // Interrupts, waits up to 2s for the turn to clear, then dispatches a
    // new [USER STEER] turn via turnDispatcher.
    export async function handleSteerSlash(deps: {
      readonly agentName: string;
      readonly guidance: string;
      readonly channelId: string;
      readonly interactionId: string;
      readonly interruptAgent: (name: string) => Promise<{ interrupted: boolean; hadActiveTurn: boolean }>;
      readonly hasActiveTurn: (name: string) => boolean;
      readonly dispatch: (origin: TurnOrigin, agentName: string, message: string) => Promise<unknown>;
      readonly log: Logger;
      readonly sleep?: (ms: number) => Promise<void>;  // test-only override
    }): Promise<string> { ... }
    ```

    Tests drive these pure functions with vi.fn() mocks. Integration with `SlashCommandHandler.handleControlCommand` is a small 2-line call site — covered by manual live smoke on clawdy after deploy.

    Test suite (7 tests):

    - T1 "handleInterruptSlash: hadActiveTurn=true, interrupted=true → returns '🛑 Stopped {agent} mid-turn.'"
    - T2 "handleInterruptSlash: hadActiveTurn=false → returns 'No active turn for {agent}.'"
    - T3 "handleInterruptSlash: interruptAgent throws → returns 'Error: could not interrupt {agent}: {message}'"
    - T4 "handleSteerSlash: happy path — interruptAgent called once, 50ms tick sleeps waiting on hasActiveTurn flipping to false, dispatch called with origin.source.kind='discord' + userMessage starting '[USER STEER] ' + the guidance appended, returns '↩ Steered {agent}. New response coming in this channel.'"
    - T5 "handleSteerSlash: hasActiveTurn still true after 2000ms → log.warn + dispatch still called (proceed-anyway path), reply unchanged"
    - T6 "handleSteerSlash: dispatch throws → returns 'Error: could not steer {agent}: {message}' and does NOT crash"
    - T7 "SlashCommandDef: CONTROL_COMMANDS now includes clawcode-interrupt + clawcode-steer with correct option shapes, descriptions < 100 chars, and commandCount === 15 when combined with DEFAULT+CONTROL" — assert on the exported array shapes directly, no handler invocation.

    Use fake timers (`vi.useFakeTimers()`) for T5 to advance 2000ms without real delays. Provide a `sleep` mock that resolves immediately when fake timers tick.
  </behavior>
  <action>
    **Step 1 — slash-types.ts (lines 134-185, CONTROL_COMMANDS array)**:
    Append two new entries:
    ```typescript
    {
      name: "clawcode-interrupt",
      description: "Abort the agent's in-flight turn (no effect if idle)",
      claudeCommand: "",
      control: true,
      ipcMethod: "interrupt-agent",
      options: [
        { name: "agent", type: 3, description: "Agent name (default: channel's agent)", required: false },
      ],
    },
    {
      name: "clawcode-steer",
      description: "Abort current turn and redirect the agent with new guidance",
      claudeCommand: "",
      control: true,
      ipcMethod: "steer-agent",
      options: [
        { name: "guidance", type: 3, description: "What the agent should do instead", required: true },
        { name: "agent", type: 3, description: "Agent name (default: channel's agent)", required: false },
      ],
    },
    ```
    All descriptions < 100 chars — verified by eye (longest is 59 chars).

    **Step 2 — slash-commands.ts**:

    a) Export the two pure helpers (near bottom of file, before `buildFleetEmbed`):

    ```typescript
    import { makeRootOrigin } from "../manager/turn-origin.js";
    import type { TurnOrigin } from "../manager/turn-origin.js";

    const STEER_CLEAR_POLL_MS = 50;
    const STEER_CLEAR_MAX_WAIT_MS = 2000;
    const STEER_PREFIX = "[USER STEER] ";

    const defaultSleep = (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));

    export async function handleInterruptSlash(deps: {
      readonly agentName: string;
      readonly interruptAgent: (name: string) => Promise<{ interrupted: boolean; hadActiveTurn: boolean }>;
      readonly log: Logger;
    }): Promise<string> {
      const { agentName, interruptAgent, log } = deps;
      try {
        const result = await interruptAgent(agentName);
        if (result.interrupted) {
          log.info({ agent: agentName, event: "slash_interrupt_ok" }, "slash /interrupt succeeded");
          return `🛑 Stopped ${agentName} mid-turn.`;
        }
        return `No active turn for ${agentName}.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ agent: agentName, error: msg }, "slash /interrupt failed");
        return `Error: could not interrupt ${agentName}: ${msg}`;
      }
    }

    export async function handleSteerSlash(deps: {
      readonly agentName: string;
      readonly guidance: string;
      readonly channelId: string;
      readonly interactionId: string;
      readonly interruptAgent: (name: string) => Promise<{ interrupted: boolean; hadActiveTurn: boolean }>;
      readonly hasActiveTurn: (name: string) => boolean;
      readonly dispatch: (origin: TurnOrigin, agentName: string, message: string) => Promise<unknown>;
      readonly log: Logger;
      readonly sleep?: (ms: number) => Promise<void>;
    }): Promise<string> {
      const { agentName, guidance, channelId, interruptAgent, hasActiveTurn, dispatch, log } = deps;
      const sleep = deps.sleep ?? defaultSleep;
      try {
        // 1. Interrupt any in-flight turn (safe no-op if idle).
        await interruptAgent(agentName);
        // 2. Poll for the turn to clear, up to STEER_CLEAR_MAX_WAIT_MS.
        const deadline = Date.now() + STEER_CLEAR_MAX_WAIT_MS;
        while (hasActiveTurn(agentName) && Date.now() < deadline) {
          await sleep(STEER_CLEAR_POLL_MS);
        }
        if (hasActiveTurn(agentName)) {
          log.warn(
            { agent: agentName, waitMs: STEER_CLEAR_MAX_WAIT_MS },
            "steer: turn did not clear within deadline — dispatching anyway (will queue)",
          );
        }
        // 3. Dispatch the new turn. Reuse 'discord' origin kind — sourceId is channelId.
        const origin = makeRootOrigin("discord", channelId);
        await dispatch(origin, agentName, `${STEER_PREFIX}${guidance}`);
        log.info(
          { agent: agentName, channelId, event: "slash_steer_ok" },
          "slash /steer dispatched",
        );
        return `↩ Steered ${agentName}. New response coming in this channel.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ agent: agentName, error: msg }, "slash /steer failed");
        return `Error: could not steer ${agentName}: ${msg}`;
      }
    }
    ```

    b) Update `handleControlCommand` (lines 344-414) to branch on the two new ipcMethods:

    ```typescript
    // Before the `if (isFleet)` branch, route the new commands via the pure helpers.
    // These are daemon-direct (not IPC-round-tripped) because the SlashCommandHandler
    // already holds a SessionManager reference. Using SessionManager directly keeps
    // the call in-process, avoiding the IPC hop latency during a time-sensitive abort.
    if (ipcMethod === "interrupt-agent") {
      // Resolve agent name: explicit option > channel binding.
      const resolvedName = agentName ?? getAgentForChannel(this.routingTable, interaction.channelId);
      if (!resolvedName) {
        await interaction.editReply("No agent to interrupt — specify `agent:` or run in an agent-bound channel.");
        return;
      }
      const reply = await handleInterruptSlash({
        agentName: resolvedName,
        interruptAgent: (n) => this.sessionManager.interruptAgent(n),
        log: this.log,
      });
      await interaction.editReply(reply);
      return;
    }
    if (ipcMethod === "steer-agent") {
      const resolvedName = agentName ?? getAgentForChannel(this.routingTable, interaction.channelId);
      const guidance = interaction.options.getString("guidance");
      if (!resolvedName) {
        await interaction.editReply("No agent to steer — specify `agent:` or run in an agent-bound channel.");
        return;
      }
      if (!guidance) {
        await interaction.editReply("Guidance is required.");
        return;
      }
      // Steer needs a TurnDispatcher reference — we add one via constructor in step c.
      if (!this.turnDispatcher) {
        await interaction.editReply("Steer unavailable: turn dispatcher not wired.");
        return;
      }
      const reply = await handleSteerSlash({
        agentName: resolvedName,
        guidance,
        channelId: interaction.channelId,
        interactionId: interaction.id,
        interruptAgent: (n) => this.sessionManager.interruptAgent(n),
        hasActiveTurn: (n) => {
          // Tunnel through SessionManager — add a pass-through method below too.
          return this.sessionManager.hasActiveTurn(n);
        },
        dispatch: (origin, n, msg) => this.turnDispatcher!.dispatch(origin, n, msg),
        log: this.log,
      });
      await interaction.editReply(reply);
      return;
    }
    ```

    c) Thread a `TurnDispatcher` + new `hasActiveTurn(name)` passthrough on SessionManager:

    In `session-manager.ts` add (next to `isRunning`):
    ```typescript
    /**
     * Quick task 260419-nic — expose the handle's hasActiveTurn() for the
     * /steer slash-command's poll loop. Returns false when the agent is not
     * running OR the handle predates the Task 1 primitive.
     */
    hasActiveTurn(name: string): boolean {
      const handle = this.sessions.get(name);
      if (!handle) return false;
      if (typeof handle.hasActiveTurn !== "function") return false;
      return handle.hasActiveTurn();
    }
    ```

    In `slash-commands.ts` `SlashCommandHandlerConfig` type:
    ```typescript
    export type SlashCommandHandlerConfig = {
      // ... existing ...
      readonly turnDispatcher?: TurnDispatcher;  // ADDED — optional so construction doesn't break existing callers
    };
    ```
    Store `this.turnDispatcher: TurnDispatcher | null = config.turnDispatcher ?? null;` in the constructor.

    **Step 3 — daemon.ts**: Wire the TurnDispatcher into the SlashCommandHandler constructor call (around line 1309). Search for the existing `turnDispatcher` instance (it's already constructed earlier in daemon.ts for DiscordBridge/TaskScheduler). Pass it in:
    ```typescript
    const slashHandler = new SlashCommandHandler({
      routingTable,
      sessionManager: manager,
      resolvedAgents,
      botToken,
      client: discordBridge?.discordClient,
      turnDispatcher,   // ADDED
      log,
    });
    ```
    (If `turnDispatcher` isn't in scope at that line, use Grep to find its construction site and lift the variable — it's definitely there; DiscordBridge construction needs it.)

    **Step 4 — commit atomic**: `feat(discord): add /clawcode-interrupt + /clawcode-steer slash commands (quick 260419-nic)`
  </action>
  <verify>
    <automated>npx vitest run src/discord/__tests__/slash-commands.test.ts src/manager/__tests__/session-manager.test.ts src/manager/__tests__/persistent-session-handle.test.ts 2>&1 | tail -30</automated>
  </verify>
  <done>
    - 7 new slash-commands tests pass.
    - CONTROL_COMMANDS.length increased by 2 (now 7); combined DEFAULT + CONTROL = 15.
    - `SessionManager.hasActiveTurn` exists.
    - `SlashCommandHandler` accepts optional `turnDispatcher` config field.
    - Daemon wires `turnDispatcher` into `SlashCommandHandler`.
    - `grep -n "clawcode-interrupt\|clawcode-steer" src/discord/slash-types.ts` returns 2 matches each (name field + registration).
    - `grep -c "\\[USER STEER\\]" src/discord/slash-commands.ts` returns 1.
    - Full test sweep: no regressions in persistent-session-handle or session-manager tests from Tasks 1-2.
  </done>
</task>

</tasks>

<verification>
After all 3 tasks commit:

```bash
# Unit + integration sweep for the new code
npx vitest run \
  src/manager/__tests__/persistent-session-handle.test.ts \
  src/manager/__tests__/session-manager.test.ts \
  src/discord/__tests__/slash-commands.test.ts 2>&1 | tail -15

# Typecheck — expect 29 pre-existing baseline errors, NO new ones introduced
npx tsc --noEmit 2>&1 | grep -c "error TS" || true

# Full test sweep — expect same baseline (7 pre-existing daemon-openai failures tolerable)
npx vitest run 2>&1 | tail -5
```

Expected:
- All new tests green (7 in persistent-session-handle + 4 in session-manager + 7 in slash-commands = 18 new green).
- tsc error count unchanged at 29 (baseline).
- vitest sweep: ≥ 2864 green (2846 baseline + 18 new), 7 daemon-openai flaky failures tolerable.
</verification>

<success_criteria>
- [ ] `SessionHandle` exposes `interrupt(): void` and `hasActiveTurn(): boolean` as public methods.
- [ ] `MockSessionHandle` implements both + a test-only `__testSetActiveTurn` hook.
- [ ] `createPersistentSessionHandle` public handle has both methods wired to the existing interrupt machinery, idempotent and close-safe.
- [ ] `SessionManager.interruptAgent(name): Promise<{interrupted, hadActiveTurn}>` implemented per spec, with 4 unit tests passing.
- [ ] `SessionManager.hasActiveTurn(name): boolean` passthrough implemented.
- [ ] Two new slash commands registered: `clawcode-interrupt` (optional agent) + `clawcode-steer` (required guidance + optional agent). Combined default + control = 15.
- [ ] `handleInterruptSlash` + `handleSteerSlash` exported, pure, tested with 7 integration tests.
- [ ] Daemon wires `turnDispatcher` into `SlashCommandHandler`.
- [ ] Three atomic commits, each with Conventional prefix, no Co-Authored-By.
- [ ] No new npm deps.
- [ ] tsc error count unchanged from baseline (29).
</success_criteria>

<notes_to_user>
**Scope corrections surfaced** (see `<scope_correction>` at top of this plan):

1. The planning scope claimed `handle.interrupt()` + `handle.hasActiveTurn()` were already public Phase 73 APIs. **They aren't** — Phase 73 only fires `q.interrupt()` internally from the abort-signal race path. Task 1 adds these primitives. The "no changes to persistent-session-handle.ts" constraint was therefore relaxed — the changes there are ~25 lines, purely additive, preserving all Phase 73 invariants (one sdk.query, depth-1 queue, 2s deadline).

2. The planning scope claimed existing slash commands enforce an "existing channel-access gate." **They don't** — `slash-commands.ts` has zero ACL calls. Guild-scoped registration is the only gate today. Our new commands follow the existing (no-ACL) pattern for consistency. If you want ACL enforcement on slash commands, that's a separate quick task that should apply uniformly across ALL 15 commands.

3. Command names: `clawcode-stop` already exists (stops a whole agent). To avoid the naming collision, the new commands are `clawcode-interrupt` (mid-turn abort, keeps agent running) and `clawcode-steer` (interrupt + re-dispatch).

4. `TurnDispatcher.dispatch` signature in the scope was wrong (`{agent, origin, userMessage}` object) — it's actually `(origin, agentName, message, options?)`. Plan uses the correct signature.

Deploy smoke (post-land, manual): `/clawcode-interrupt` in an agent channel while the agent is streaming a slow response — expect Discord ephemeral "🛑 Stopped X mid-turn." and the in-flight message edit stops growing. `/clawcode-steer guidance:"actually just say hi"` while the agent is mid-explanation — expect the agent to finish aborting then stream a new "hi" response in the channel.
</notes_to_user>

<output>
Three atomic commits on master. No SUMMARY.md required for quick tasks — the orchestrator updates STATE.md Quick Tasks Completed table on land.
</output>
