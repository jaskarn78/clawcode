---
phase: 260501-nfe-fix-relay-summary-not-posted-bug-switch-
plan: 01
subsystem: discord/subagent-thread-spawner
tags: [bugfix, relay, discord, dispatchStream, phase-99-M-followup]
dependency-graph:
  requires:
    - turn-dispatcher dispatchStream (Phase 99-M era)
    - ProgressiveMessageEditor (src/discord/streaming.ts)
    - wrapMarkdownTablesInCodeFence (src/discord/markdown-table-wrap.ts)
  provides:
    - working subagent → parent main-channel summary post
    - parent-channel-fetch-failed relay-skipped reason
    - empty-response-from-parent relay-skipped reason
    - subagent relay overflow chunks summary log
  affects:
    - parent agents with bound subagent threads (every operator-spawned subagent thread)
tech-stack:
  added: []
  patterns:
    - "dispatchStream + ProgressiveMessageEditor closure mirroring bridge.ts:585-665"
    - "post-flush overflow chunk loop mirroring postInitialMessage:633-670"
key-files:
  created:
    - .planning/quick/260501-nfe-fix-relay-summary-not-posted-bug-switch-/260501-nfe-SUMMARY.md
  modified:
    - src/discord/subagent-thread-spawner.ts
    - src/discord/subagent-thread-spawner.test.ts
decisions:
  - "Use channel.send() (bot identity), not webhookManager — webhook routing is Phase 999.19's problem"
  - "Inline overflow loop (no helper extraction) — keeps diff small, mirrors postInitialMessage pattern in same file"
  - "Pass channelId in DispatchOptions for trace plumbing; no behavior change otherwise"
  - "Defensive double-truncation (editFn truncates AND editor.maxLength=2000 default) — matches existing precedent at postInitialMessage:599"
metrics:
  duration: ~25min
  completed-date: 2026-05-01
  task-count: 2
  test-count-delta: "+3 (new regression tests); 6 migrated"
  files-modified: 2
requirements-completed: [QUICK-260501-NFE]
---

# Quick Task 260501-nfe: Relay Summary Not Posted Bug Fix Summary

**One-liner:** Wired `relayCompletionToParent` to actually post via `dispatchStream` + `ProgressiveMessageEditor`, fixing the Phase 99-M wiring gap that caused subagent completion summaries to be generated but never reach the parent's Discord channel.

## Problem Statement

Phase 99-M (shipped 2026-04-26) introduced auto-relay so parent agents would summarize subagent completions in their main Discord channel. The commit message claimed "parent posts brief summary in main channel via normal Discord pipeline" — but the wiring was never finished. `relayCompletionToParent` called `turnDispatcher.dispatch(origin, agentName, prompt)` and **awaited the returned response string only to discard it**. The parent successfully generated a summary, but no code path posted that string to Discord. Diagnosed 2026-05-01.

## Files Changed

| File | Lines | Change |
| ---- | ----- | ------ |
| src/discord/subagent-thread-spawner.ts | +123 / -1 | Replaced 1-line `dispatch(...)` call with full `dispatchStream` + ProgressiveMessageEditor + post-flush overflow loop. Inserted parent-channel fetch with hard-skip guard. Added empty-response-from-parent guard. Augmented happy-path log with `postedLength`. |
| src/discord/subagent-thread-spawner.test.ts | +233 / -32 | Migrated 6 existing relay tests from `dispatch` → `dispatchStream`. Added shared `buildDiscordClient` helper routing parentChannelId vs threadId. Added 3 new regression tests. |

## Before / After: Dispatch Site

**Before** (master, line 304):

```ts
const origin = makeRootOrigin("task", `subagent-completion:${threadId}`);
await this.turnDispatcher.dispatch(origin, binding.agentName, relayPrompt);
this.log.info(/* happy-path */);
```

The `dispatch` resolved with the parent's full summary string — and that string was awaited and dropped. No `channel.send()` call existed in `relayCompletionToParent`. The whole relay pipeline produced exactly zero Discord-visible output.

**After** (post-fix):

```ts
const origin = makeRootOrigin("task", `subagent-completion:${threadId}`);

// Fetch parent's main channel — hard skip if missing/non-sendable.
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

// ProgressiveMessageEditor mirrors bridge.ts:585-665 user-message path.
let messageRef: { edit: (content: string) => Promise<unknown> } | null = null;
const editor = new ProgressiveMessageEditor({
  editFn: async (content: string) => {
    const wrapped = wrapMarkdownTablesInCodeFence(content);
    const truncated = wrapped.length > 2000 ? wrapped.slice(0, 1997) + "..." : wrapped;
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

// Defense-in-depth empty-response guard.
if (!messageRef && (!response || response.trim().length === 0)) {
  this.log.info(
    { threadId, reason: "empty-response-from-parent", parentAgent: binding.agentName },
    "subagent relay skipped",
  );
  return;
}

// Overflow >2000: send tail chunks; aggregate summary log.
const finalWrapped = wrapMarkdownTablesInCodeFence(response ?? "");
if (finalWrapped.length > 2000) {
  // ... cursor += 2000 loop with chunksSent / lastError / fullySent ...
}

this.log.info(
  { threadId, parentAgent, subagentSession, relayLen, artifactCount, postedLength: (response ?? "").length },
  "subagent completion relayed to parent",
);
```

## New `relay-skipped` Reason Tags

This plan adds **2 new reason tags** (joining the 5 byte-preserved tags from quick task 260501-i3r):

| Tag | Branch | Pre/Post Dispatch |
| --- | ------ | ----------------- |
| `parent-channel-fetch-failed` | `discordClient.channels.fetch(parentChannelId)` returns null OR channel lacks `.send` | Pre-dispatch (short-circuits before any LLM turn) |
| `empty-response-from-parent` | `dispatchStream` resolves with empty/whitespace AND no `onChunk` fired (messageRef still null) | Post-dispatch (turn ran but produced nothing postable) |

The 5 preserved tags from 260501-i3r remain byte-identical at their post-edit positions:

```
203:      this.log.info({ threadId, reason: "no-turn-dispatcher" }, "subagent relay skipped");
210:        this.log.info({ threadId, reason: "no-binding" }, "subagent relay skipped");
215:        this.log.info({ threadId, reason: "no-channel-or-not-text" }, "subagent relay skipped");
252:        this.log.info({ threadId, reason: "no-bot-messages" }, "subagent relay skipped");
258:        this.log.info({ threadId, reason: "empty-content-after-concat" }, "subagent relay skipped");
```

## Test Summary

**Test file**: `src/discord/subagent-thread-spawner.test.ts`

- **Migrated**: 6 existing tests in `relayCompletionToParent integration` describe block (AP10, REL-MULTI-1..4, AP10b). Mock surface change: `turnDispatcher.dispatch` → `turnDispatcher.dispatchStream`. Mock now invokes `onChunk` and returns a non-empty string. Prompt-arg index `[2]` unchanged. Added shared `buildDiscordClient(threadChannel, parentChannelId)` helper that routes `channels.fetch` to a parent-channel mock with a `send` spy when called with `parentChannelId`, and to the supplied thread channel otherwise.
- **New (3)**:
  1. `posts the parent's summary to the parent's main channel via channel.send` — the regression test that proves the bug fix. Asserts `parentChannelSendSpy.mock.calls` includes a string containing the streamed summary token. Pre-fix master = FAIL (no `.send` invoked anywhere). Post-fix = PASS.
  2. `logs relay-skipped reason=parent-channel-fetch-failed when channels.fetch returns null` — failure-mode coverage for new tag.
  3. `logs relay-skipped reason=empty-response-from-parent when dispatchStream resolves empty` — failure-mode coverage for new tag.

**Test count delta**: 6 migrated, +3 new ⇒ 9 tests in the relay describe block (was 6 on master).

**RED → GREEN transition**:

- After Task 1 commit (`9275734`): all 9 relay tests FAIL because production still calls `dispatch`. Other 30 tests in the file pass. `9 failed | 30 passed (39)`.
- After Task 2 commit (`251eb5a`): all 39 tests PASS. Including the regression test that pins the fix.

### Sample of the New Regression Test (channel.send invocation assertion)

```ts
it("posts the parent's summary to the parent's main channel via channel.send", async () => {
  // ... binding + thread message + dispatchStream mock with onChunk("Brief summary") ...
  await spawner.relayCompletionToParent("thread-id-relay");

  expect(parentChannelSendSpy).toHaveBeenCalled();
  const sendArgs = parentChannelSendSpy.mock.calls.flat();
  const anyContainsSummary = sendArgs.some(
    (arg) => typeof arg === "string" && arg.includes("Brief summary"),
  );
  expect(anyContainsSummary).toBe(true);
});
```

This single assertion is what differentiates pre-fix (no Discord post) from post-fix (operator sees the summary). On master pre-fix it fails because `parentChannelSendSpy.mock.calls.length === 0`.

## Verification Output

**Targeted test file** (`npx vitest run src/discord/subagent-thread-spawner.test.ts`):

```
 Test Files  1 passed (1)
      Tests  39 passed (39)
   Duration  ~1s
```

**TypeScript** (`npx tsc --noEmit` — filtered to my changed files):

```
$ npx tsc --noEmit 2>&1 | grep subagent-thread-spawner
(no output — zero errors in my files)
```

The repo has pre-existing tsc errors in `src/tasks/`, `src/triggers/`, `src/memory/`, `src/usage/`, `src/manager/secrets-resolver.ts`, etc. — all unrelated to this fix and out of scope per executor scope-boundary rule. Logged for awareness; not addressed in this plan.

**Discord suite** (`npx vitest run src/discord`): `52 passed | 2 failed` — the 2 failures are in `src/discord/__tests__/bridge-attachments.test.ts` (`beforeEach` hook timeout while importing `../bridge.js`). The repo's `git status` at session start showed `M src/discord/bridge.ts` was already modified before this session began (pre-existing parallel work). These flakes are unrelated to `subagent-thread-spawner.ts` and are out of scope.

## Code Review — No Dangling-Return-Value Paths

Walking every code path in `relayCompletionToParent` after the outer `try {`:

1. **`turnDispatcher` not wired** → log `reason=no-turn-dispatcher`, return. (preserved from i3r)
2. **No binding for threadId** → log `reason=no-binding`, return. (preserved from i3r)
3. **Thread channel fetch returns non-text** → log `reason=no-channel-or-not-text`, return. (preserved from i3r)
4. **No bot messages in thread** → log `reason=no-bot-messages`, return. (preserved from i3r)
5. **Empty content after concat** → log `reason=empty-content-after-concat`, return. (preserved from i3r)
6. **Parent channel fetch fails** → log `reason=parent-channel-fetch-failed`, return. (NEW)
7. **dispatchStream succeeds + onChunk fires** → editor posts via channel.send → editor.flush → optional overflow loop → happy-path log with `postedLength`.
8. **dispatchStream succeeds but empty + no onChunk** → log `reason=empty-response-from-parent`, return. (NEW)
9. **dispatchStream throws** → caught by outer `try/catch` (lines 446-449 post-edit) → log `subagent completion relay failed (non-fatal)`.

**Every path either posts to Discord OR emits a structured log line.** Zero dangling returns. The `response` variable from `dispatchStream` is never silently discarded.

## Preserved Invariants Verified

- **5 quick-task-260501-i3r relay-skipped logs**: byte-identical at post-edit lines 203/210/215/252/258. Confirmed via `grep -n '"subagent relay skipped"'` showing those 5 lines unchanged plus 2 new entries (the new reasons).
- **Relay prompt text** (lines 291-302): untouched.
- **`postInitialMessage`** (lines 551-718 pre-edit, shifted by my insertion but body byte-identical): untouched.
- **`delegationContext`, webhook identity, registry/binding code**: untouched.
- **`discoverArtifactPaths` + artifactsLine** (lines 267-302): untouched.
- **Diff scope**: `git diff --stat src/discord/subagent-thread-spawner.ts` ⇒ `1 file changed, 123 insertions(+), 1 deletion(-)`.

## Commits

| Task | Commit | Type | Description |
| ---- | ------ | ---- | ----------- |
| 1 | `9275734` | test | migrate relay tests to dispatchStream + add 3 regression tests |
| 2 | `251eb5a` | fix | wire relayCompletionToParent to actually post via dispatchStream |

## Defer Note

ROADMAP 999.18 stays BACKLOG. The orchestrator handles the partial-shipped note about this fix landing — this SUMMARY does NOT update ROADMAP per the constraint.

## DEPLOY HOLD

**LOCAL ONLY — NOT DEPLOYED.** Per task brief and `feedback_no_auto_deploy.md`: never include prod deploy steps without an explicit deploy order in the same turn. The user said "Wait for me to give deploy order"; even when the deploy order arrives, check Ramy first per `feedback_ramy_active_no_deploy.md`. This fix is committed locally on `master` only.

## Self-Check: PASSED

- File `src/discord/subagent-thread-spawner.ts` exists and contains `dispatchStream` reference: FOUND
- File `src/discord/subagent-thread-spawner.test.ts` exists and contains `dispatchStream` reference: FOUND
- Commit `9275734` exists in git log: FOUND
- Commit `251eb5a` exists in git log: FOUND
- 5 preserved relay-skipped logs at lines 203/210/215/252/258: FOUND (byte-identical)
- 2 new relay-skipped reason tags present: FOUND (`parent-channel-fetch-failed`, `empty-response-from-parent`)
- `postInitialMessage` body untouched: FOUND (diff scope confirms relayCompletionToParent only)
- Relay prompt text (lines 291-302 pre-edit) untouched: FOUND
- 39/39 tests pass in target test file: FOUND
- Zero new tsc errors in my changed files: FOUND
