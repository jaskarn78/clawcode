---
phase: 260501-nfe-fix-relay-summary-not-posted-bug-switch-
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/discord/subagent-thread-spawner.ts
  - src/discord/subagent-thread-spawner.test.ts
autonomous: true
requirements:
  - QUICK-260501-NFE: relay subagent completion summary actually posts to parent's main channel
must_haves:
  truths:
    - "On subagent completion, the parent agent's summary is visibly posted to the parent's main Discord channel."
    - "The relay path uses dispatchStream + ProgressiveMessageEditor (mirrors bridge.ts user-message path)."
    - "All 5 existing relay-skipped diagnostic logs (from quick task 260501-i3r) remain byte-identical."
    - "Empty parent responses or fetch failures emit explicit relay-skipped log lines (no silent drops)."
    - "Overflow (>2000 chars) is chunked via channel.send(), not lost."
  artifacts:
    - path: "src/discord/subagent-thread-spawner.ts"
      provides: "relayCompletionToParent rewritten to actually post the parent's summary"
      contains: "dispatchStream"
    - path: "src/discord/subagent-thread-spawner.test.ts"
      provides: "Migrated mocks (dispatch -> dispatchStream) + new regression test asserting channel.send invocation"
      contains: "dispatchStream"
  key_links:
    - from: "relayCompletionToParent"
      to: "TurnDispatcher.dispatchStream"
      via: "onChunk -> ProgressiveMessageEditor.update"
      pattern: "dispatchStream\\("
    - from: "ProgressiveMessageEditor.editFn"
      to: "parent's main channel"
      via: "channel.send (first chunk) / messageRef.edit (subsequent)"
      pattern: "channel\\.send\\("
    - from: "Overflow handling"
      to: "channel.send(chunk) for each 2000-char slice past the first"
      via: "post-flush while-loop"
      pattern: "cursor \\+= 2000"
---

<objective>
Fix the dominant cause of "subagent completion summary doesn't always land in parent's main channel": `relayCompletionToParent` calls `turnDispatcher.dispatch()` and **discards the returned response string** — so the parent generates a summary but it never reaches Discord. Switch to `dispatchStream()` + `ProgressiveMessageEditor` posting to the parent's main channel, mirroring the user-message pattern in `bridge.ts:585-665`.

Purpose: The Phase 99-M commit message claimed "parent posts brief summary in main channel via normal Discord pipeline" — but the wiring was never finished. Today's diagnosis (2026-05-01) confirmed the missing post is the root cause. This plan finishes the wiring without touching delegation/routing semantics (Phase 999.19).

Output: A relay path with zero dangling-return-value branches — every successful dispatch produces a Discord post, every failure mode produces a structured log line.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/discord/subagent-thread-spawner.ts
@src/discord/subagent-thread-spawner.test.ts
@src/discord/bridge.ts
@src/discord/streaming.ts
@src/discord/thread-types.ts
@src/manager/turn-dispatcher.ts

<interfaces>
<!-- Contracts the executor needs — extracted so no codebase exploration is required. -->

From src/discord/thread-types.ts (binding has the parent's channel id):
```typescript
export type ThreadBinding = {
  readonly threadId: string;
  readonly parentChannelId: string;   // <-- where to post the summary
  readonly agentName: string;
  readonly sessionName: string;
  readonly createdAt: number;
  readonly lastActivity: number;
};
```

From src/manager/turn-dispatcher.ts (the streaming dispatch entry point):
```typescript
async dispatchStream(
  origin: TurnOrigin,
  agentName: string,
  message: string,
  onChunk: (accumulated: string) => void,
  options: DispatchOptions = {},   // { turn?, channelId?, signal?, skillEffort? }
): Promise<string>
```
Returns the full final response string (same contract as `dispatch`), but additionally calls `onChunk(accumulated)` as tokens stream.

From src/discord/streaming.ts:
```typescript
export class ProgressiveMessageEditor {
  constructor(options: {
    editFn: (content: string) => Promise<void>;
    editIntervalMs?: number;   // default 750
    maxLength?: number;        // default 2000
    log?: Logger;
    agent?: string;
    turnId?: string;
    turn?: Turn;
  });
  update(accumulated: string): void;
  flush(): Promise<void>;
  dispose(): void;
}
```

From src/discord/subagent-thread-spawner.ts (existing imports — already wired, no new imports needed):
```typescript
import { ProgressiveMessageEditor } from "./streaming.js";          // line 27
import { wrapMarkdownTablesInCodeFence } from "./markdown-table-wrap.js";  // line 28
import type { TextChannel } from "discord.js";                       // line 2
```

Reference pattern (bridge.ts:585-665) — the editor closure shape to mirror:
```typescript
const channel = message.channel;
const messageRef: { current: Message | null } = { current: null };
editor = new ProgressiveMessageEditor({
  editFn: async (content: string) => {
    const wrapped = wrapMarkdownTablesInCodeFence(content);
    if (!messageRef.current) {
      if ("send" in channel && typeof channel.send === "function") {
        messageRef.current = await channel.send(wrapped);
      }
    } else {
      await messageRef.current.edit(wrapped);
    }
  },
  editIntervalMs: 750,
  log: this.log,
  agent: sessionName,
});
const response = await this.turnDispatcher.dispatchStream(
  origin, sessionName, formattedMessage,
  (accumulated) => editor!.update(accumulated),
  { turn, channelId },
);
await editor.flush();
// Overflow (>2000) → delete typing msg + sendResponse chunked send
```
</interfaces>

<ratified_decisions>
1. **Channel target:** `binding.parentChannelId` fetched via `this.discordClient.channels.fetch(parentChannelId)`. Defensive: if fetch returns null OR the channel lacks a `.send` function, log relay-skipped with reason `"parent-channel-fetch-failed"` and return.
2. **Posting identity:** `channel.send()` (bot identity), NOT webhookManager. Locked per task brief — webhook routing is Phase 999.19's problem.
3. **Editor closure:** Inline closure with `let messageRef: any | null = null;` — exactly matches the bridge.ts:586-608 shape. First call creates via `channel.send(wrapped)`, subsequent calls use `messageRef.edit(wrapped)`. Wrap content via `wrapMarkdownTablesInCodeFence` before each `editFn` invocation (idempotent for already-wrapped content).
4. **Overflow handling:** Inline (do NOT extract a helper) — keeps the diff small and the existing `postInitialMessage` overflow code at lines 633-670 as the visible template. The relay's overflow loop calls `channel.send(chunk)` (not `thread.send`).
5. **New relay-skipped reason tags (added by this plan):**
   - `"parent-channel-fetch-failed"` — channels.fetch() returned null OR channel has no `.send` function.
   - `"empty-response-from-parent"` — `dispatchStream` resolved with empty/whitespace string AND `messageRef` is still null (no chunk fired). Emitted AFTER a successful dispatch — distinct from the 5 pre-dispatch silent-return reasons.
6. **Truncation:** Each `editFn` invocation truncates `wrapped` to ≤2000 chars with `"..."` suffix when over, matching `postInitialMessage:599`. The editor's own `maxLength` default is 2000 — defensive double-truncation is fine and matches existing precedent.
7. **DispatchOptions:** Pass `{ channelId: binding.parentChannelId }` — good signal for trace plumbing, no behavior change otherwise.
8. **Test mock migration:** Existing tests at lines 722-1062 mock `turnDispatcher.dispatch` returning `undefined`. Migrate to `turnDispatcher.dispatchStream = vi.fn(async () => "ok")` (return a non-empty string so the post happens). Assertions on `dispatch.mock.calls[0][2]` (the prompt arg) become `dispatchStream.mock.calls[0][2]` — same index. Add `discordClient.channels.fetch` mock returning a channel with `send: vi.fn(async () => ({ edit: vi.fn(async () => {}), id: "msg-1" }))`.
</ratified_decisions>

<preserved_invariants>
- Lines 203/210/215/252/258 (5 relay-skipped diagnostic logs from quick task 260501-i3r): **byte-identical**.
- Lines 291-302 (relay prompt text): **untouched**.
- Lines 305-314 happy-path log: kept; may add `postedLength` field if natural.
- Lines 315-320 outer try/catch: kept.
- `postInitialMessage` (lines 551-718): **not touched**.
- `delegationContext`, webhook identity, registry/binding code elsewhere in the file: **not touched**.
- discoverArtifactPaths + artifactsLine prompt enrichment (lines 267-302): **not touched**.
</preserved_invariants>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Migrate test mocks + add red regression test</name>
  <files>src/discord/subagent-thread-spawner.test.ts</files>
  <behavior>
    - Existing relay tests (lines 722-1062, currently mocking `turnDispatcher.dispatch`) compile and pass once migrated to mock `dispatchStream` instead. Mock shape: `dispatchStream: vi.fn(async (_origin, _agent, _prompt, onChunk) => { onChunk?.("Summary text"); return "Summary text"; })`. Prompt-arg assertions use index `[2]` unchanged.
    - NEW regression test "posts the parent's summary to the parent's main channel via channel.send":
      * Mock binding with `parentChannelId: "parent-chan-1"`.
      * Mock `discordClient.channels.fetch` to resolve with `{ send: vi.fn(async () => ({ edit: vi.fn(async () => {}) })) }` when called with `"parent-chan-1"`, and the existing thread channel mock when called with the threadId.
      * Mock `turnDispatcher.dispatchStream` to invoke `onChunk("Brief summary")` once and resolve with `"Brief summary"`.
      * After `relayCompletionToParent("thread-id-A")`, assert: parent channel's `send` was called at least once with a string containing `"Brief summary"` (post-wrapMarkdownTables — but this short string has no tables so it passes through). Without the fix this fails (no .send invocation).
    - NEW test "logs relay-skipped reason=parent-channel-fetch-failed when channels.fetch returns null":
      * `discordClient.channels.fetch` returns null for `parentChannelId`.
      * `relayCompletionToParent` returns without throwing; `log.info` called with `{ reason: "parent-channel-fetch-failed" }`; `dispatchStream` NOT called.
    - NEW test "logs relay-skipped reason=empty-response-from-parent when dispatchStream resolves empty":
      * Channel fetch succeeds; `dispatchStream` resolves with `""` and never invokes `onChunk`.
      * Assert `log.info` called with `{ reason: "empty-response-from-parent" }`; channel.send NOT called.
  </behavior>
  <action>
    1. Open `src/discord/subagent-thread-spawner.test.ts`. Locate the 6 existing relay tests in `describe("relayCompletionToParent integration")` (lines 722-1062).
    2. In the shared `beforeEach` (line ~726-732), change the dispatcher fixture:
       ```typescript
       turnDispatcher = {
         dispatchStream: vi.fn(async (_origin, _agent, _prompt, onChunk) => {
           onChunk?.("OK summary");
           return "OK summary";
         }),
       };
       ```
       (Drop `dispatch` from the mock object entirely — relay no longer uses it.)
    3. Globally rewrite within this describe block: `turnDispatcher.dispatch` → `turnDispatcher.dispatchStream`. Prompt arg index `[2]` unchanged. The existing assertions on `toHaveBeenCalledTimes(1)` and the prompt content stay valid.
    4. Extend the per-test discordClient mock so `channels.fetch(parentChannelId)` resolves to a fake parent channel with a `send` spy. Easiest: in `beforeEach` build a `parentChannelSendSpy = vi.fn(async () => ({ edit: vi.fn(async () => {}) }))` and route `channels.fetch` to return `{ send: parentChannelSendSpy }` for parentChannelId, and the existing thread-message mock for threadId.
    5. Add the 3 NEW tests described in `<behavior>`. Place them inside the same describe block. Name them precisely as listed.
    6. Do NOT modify any test outside the relay describe block.
    7. Run `bun test src/discord/subagent-thread-spawner.test.ts` — expect FAILURE on the new "posts the parent's summary" test (RED step) and the "empty-response-from-parent" test. Existing migrated tests can also fail at this point (the production code still calls `dispatch`, not `dispatchStream`) — that's expected RED state; Task 2 turns them GREEN.
  </action>
  <verify>
    <automated>bun test src/discord/subagent-thread-spawner.test.ts 2>&1 | tail -40</automated>
  </verify>
  <done>
    Test file compiles (no TS errors), and `bun test src/discord/subagent-thread-spawner.test.ts` shows the new regression tests + migrated existing tests in a deterministic FAIL state caused by the production code still calling `dispatch`. No syntax errors, no unrelated test breakage outside the relay describe block.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Rewrite relayCompletionToParent dispatch site to actually post</name>
  <files>src/discord/subagent-thread-spawner.ts</files>
  <behavior>
    - `relayCompletionToParent` now: (a) fetches parent channel via `discordClient.channels.fetch(binding.parentChannelId)`, (b) builds a ProgressiveMessageEditor whose `editFn` posts via `channel.send` / `messageRef.edit`, (c) calls `dispatchStream(origin, binding.agentName, relayPrompt, (acc) => editor.update(acc), { channelId: binding.parentChannelId })`, (d) awaits `editor.flush()`, (e) handles overflow >2000 via `channel.send` chunk loop, (f) emits new relay-skipped logs for `parent-channel-fetch-failed` and `empty-response-from-parent`.
    - All 5 pre-dispatch relay-skipped logs from quick task 260501-i3r (lines 203/210/215/252/258) remain byte-identical.
    - Happy-path log at lines 305-314 retained, augmented with `postedLength: response.length` (natural addition; don't reformat the rest).
    - Outer try/catch at 315-320 retained.
    - `postInitialMessage` is not touched.
  </behavior>
  <action>
    Edit `src/discord/subagent-thread-spawner.ts`. The change is localized: replace lines 303-304 (the `dispatch` call) with the streaming + post block, and add the parent-channel fetch immediately after the `binding` resolution. Concretely:

    1. **Add parent-channel fetch.** After the existing `const fetched = await (channel as TextChannel).messages.fetch({ limit: 10 });` (line ~221) we already have the THREAD channel as `channel`. We need a SEPARATE variable for the PARENT channel. Place the parent-channel fetch immediately BEFORE constructing `origin` (line 303). Use a distinct local name so the existing `channel` (the thread) stays unchanged:
       ```typescript
       // Phase 99-M follow-up (2026-05-01) — fetch the parent's main channel
       // so the relay summary actually posts. Defensive: a missing or non-text
       // channel is a hard skip (we have no surface to post to).
       const parentChannel = await this.discordClient.channels
         .fetch(binding.parentChannelId)
         .catch(() => null);
       const parentSendable = parentChannel as
         | { send: (content: string) => Promise<{ edit: (c: string) => Promise<unknown> }> }
         | null;
       if (!parentSendable || typeof parentSendable.send !== "function") {
         this.log.info(
           { threadId, reason: "parent-channel-fetch-failed", parentChannelId: binding.parentChannelId },
           "subagent relay skipped",
         );
         return;
       }
       ```

    2. **Replace the dispatch call (lines 303-304) with editor + dispatchStream + post.** Keep `const origin = makeRootOrigin("task", \`subagent-completion:${threadId}\`);` exactly as-is. Replace the single `await this.turnDispatcher.dispatch(...)` line with:
       ```typescript
       // Phase 99-M follow-up — mirror bridge.ts:585-665 user-message path.
       // Stream tokens into a ProgressiveMessageEditor that posts to the
       // parent's main channel via channel.send (first chunk) / .edit
       // (subsequent). Without this, the response string was awaited and
       // discarded — the dominant cause of "summary never posts" in
       // production (diagnosed 2026-05-01).
       let messageRef:
         | { edit: (content: string) => Promise<unknown> }
         | null = null;
       const editor = new ProgressiveMessageEditor({
         editFn: async (content: string) => {
           const wrapped = wrapMarkdownTablesInCodeFence(content);
           const truncated =
             wrapped.length > 2000 ? wrapped.slice(0, 1997) + "..." : wrapped;
           if (!messageRef) {
             messageRef = await parentSendable.send(truncated);
           } else {
             await messageRef.edit(truncated);
           }
         },
         editIntervalMs: 750,
         log: this.log,
         agent: binding.agentName,
       });

       const response = await this.turnDispatcher.dispatchStream(
         origin,
         binding.agentName,
         relayPrompt,
         (accumulated: string) => editor.update(accumulated),
         { channelId: binding.parentChannelId },
       );
       await editor.flush();

       // Defense-in-depth: if dispatch returned empty AND no chunk fired,
       // we have no post. Distinct from the 5 pre-dispatch silent-return
       // reasons because this one is post-dispatch.
       if (!messageRef && (!response || response.trim().length === 0)) {
         this.log.info(
           { threadId, reason: "empty-response-from-parent", parentAgent: binding.agentName },
           "subagent relay skipped",
         );
         return;
       }

       // Overflow handling — when the final response exceeds 2000 chars, the
       // editor truncated the visible message. Send the tail as additional
       // channel.send() chunks so nothing is lost. Mirrors postInitialMessage
       // overflow logic at lines 633-670 (this file).
       const finalWrapped = wrapMarkdownTablesInCodeFence(response ?? "");
       if (finalWrapped.length > 2000) {
         let cursor = 2000;
         let chunksSent = 0;
         let lastError: string | null = null;
         while (cursor < finalWrapped.length) {
           const chunk = finalWrapped.slice(cursor, cursor + 2000);
           try {
             await parentSendable.send(chunk);
             chunksSent++;
           } catch (err) {
             lastError = (err as Error).message;
             this.log.warn(
               {
                 threadId,
                 parentAgent: binding.agentName,
                 chunkIndex: chunksSent,
                 cursor,
                 totalLength: finalWrapped.length,
                 error: lastError,
               },
               "subagent relay overflow chunk send failed (non-fatal — continuing if possible)",
             );
             break;
           }
           cursor += 2000;
         }
         this.log.info(
           {
             threadId,
             parentAgent: binding.agentName,
             totalLength: finalWrapped.length,
             chunksSent,
             lastError,
             fullySent: cursor >= finalWrapped.length,
           },
           "subagent relay overflow chunks summary",
         );
       }
       ```

    3. **Update the happy-path log (lines 305-314) to include `postedLength`.** Add one field, do not reformat:
       ```typescript
       this.log.info(
         {
           threadId,
           parentAgent: binding.agentName,
           subagentSession: binding.sessionName,
           relayLen: trimmed.length,
           artifactCount: artifacts.length,
           postedLength: (response ?? "").length,
         },
         "subagent completion relayed to parent",
       );
       ```

    4. **Do not modify** lines 203/210/215/252/258 (the 5 quick-task-260501-i3r relay-skipped logs), the relay prompt block (lines 291-302), the artifact discovery block (lines 267-290), or the outer try/catch at 315-320.

    5. **No new imports needed.** `ProgressiveMessageEditor` (line 27) and `wrapMarkdownTablesInCodeFence` (line 28) are already imported. `TextChannel` is unused for the parent-channel path — we use a structural type instead to avoid the discord.js TextChannel type forcing extra fields the test mock doesn't supply.

    6. Run `bun tsc --noEmit` to confirm no type errors, then `bun test src/discord/subagent-thread-spawner.test.ts` (must pass — GREEN), then `bun test src/discord` (must pass).
  </action>
  <verify>
    <automated>bun tsc --noEmit && bun test src/discord/subagent-thread-spawner.test.ts && bun test src/discord 2>&1 | tail -30</automated>
  </verify>
  <done>
    - `bun tsc --noEmit` passes with zero errors.
    - `bun test src/discord/subagent-thread-spawner.test.ts` — all relay tests green, including the 3 new ones.
    - `bun test src/discord` — full discord suite passes.
    - Code review of `relayCompletionToParent` confirms zero dangling-return-value paths: every successful `dispatchStream` resolution either produces a `parentSendable.send` call (via editor) OR emits the `empty-response-from-parent` log; every failure mode emits a structured log line.
    - All 5 quick-task-260501-i3r relay-skipped logs at lines 203/210/215/252/258 (or their post-edit equivalents) are byte-identical to current `master`.
    - `postInitialMessage` is unchanged (diff scoped to `relayCompletionToParent` only).
  </done>
</task>

</tasks>

<verification>
- TypeScript: `bun tsc --noEmit` returns 0 errors.
- Unit tests: `bun test src/discord/subagent-thread-spawner.test.ts` all pass.
- Discord suite: `bun test src/discord` all pass.
- Manual diff review: `git diff src/discord/subagent-thread-spawner.ts` touches ONLY `relayCompletionToParent`. The 5 quick-task-260501-i3r logs are unchanged. The relay prompt text is unchanged. `postInitialMessage` is unchanged.
- Behavior: every code path in `relayCompletionToParent` after the `try {` either (a) returns with a structured `relay-skipped` log, (b) posts via `parentSendable.send` and logs the happy-path summary, or (c) is caught by the outer try/catch and logged as `subagent completion relay failed`. No dangling returns.

**LOCAL ONLY — DO NOT DEPLOY.** Per task brief: user holds the deploy order. Per `feedback_ramy_active_no_deploy.md`, even when the deploy order arrives, check Ramy first.
</verification>

<success_criteria>
- The relay path uses `dispatchStream` and posts the parent's summary to `binding.parentChannelId` via `channel.send` / message edit.
- All existing relay tests migrated to the new mock surface and pass.
- 1+ NEW regression test asserts `parentChannel.send` is called with non-empty content on a successful relay (this is the test that today fails on master and proves the bug exists).
- 2 NEW failure-mode tests cover `parent-channel-fetch-failed` and `empty-response-from-parent`.
- Overflow >2000 chars produces additional `channel.send` chunks plus an aggregate `"subagent relay overflow chunks summary"` log line.
- Zero TypeScript errors. Full `bun test src/discord` suite green.
- Diff is surgical: only `relayCompletionToParent` body and the colocated test file change.
</success_criteria>

<output>
After completion, create `.planning/quick/260501-nfe-fix-relay-summary-not-posted-bug-switch-/260501-nfe-SUMMARY.md` with:
- Problem statement (one paragraph) — the dispatch-vs-dispatchStream miswire from Phase 99-M.
- Files changed table (subagent-thread-spawner.ts + its test file).
- Test summary — count of migrated tests + count of new tests + the FAIL-on-master vs PASS-on-fix transition.
- Verification command outputs (tsc + test runs).
- Defer note: ROADMAP 999.18 stays BACKLOG (orchestrator handles the roadmap note about this fix landing).
- DEPLOY HOLD note: not deployed; awaiting explicit operator deploy order; Ramy-active hold still in effect.
</output>
