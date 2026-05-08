---
phase: 999.36
title: Subagent UX trio — typing indicator, output truncation, cross-channel file leak
status: BACKLOG
priority: P1 (operator-facing visibility + correctness bugs)
captured_from: operator report 2026-05-05 22:54 PT
captured_by: admin-clawdy
target_milestone: TBD (likely v2.8)
sibling_quicks:
  - 260505-spw-subagent-spawn-announce-gap (subagent boot-time-to-first-content)
---

# Phase 999.36 — Subagent UX trio

## Why this exists

Operator reports three independent subagent UX bugs in the same observation
window (2026-05-05). Bundling here because they all sit in the subagent
dispatch surface and likely share helper code in
`src/discord/subagent-thread-spawner.ts` + adjacent dispatcher.

> "I'm noticing subagents not having typing indicators and often dont
> produce full output and also fin-acqs deep dive landed on content
> creators channel"
> — operator, 2026-05-05 22:54 PT

## Sub-bug A — No typing indicator on subagent dispatch (P1)

### Observation
While a subagent is mid-turn, the Discord thread shows nothing. No typing
indicator, no progress message. Combined with subagent boot latency
(~5 min, see quick task `260505-spw`), operator sees an empty thread for
minutes and can't tell if work is happening.

### Hypothesis
The agent runtime emits Discord `typing` events for top-level agent
turns (registered agents) but the subagent dispatch path doesn't reuse
that emit. Easy fix if confirmed — wire the same `channel.sendTyping()`
loop into the subagent turn dispatcher.

### Investigation steps
1. Grep `sendTyping` / `typing` in `src/`. Confirm whether top-level
   dispatcher uses it and where.
2. Trace subagent turn dispatch path. Compare. Spot the gap.
3. Wire equivalent typing emit at the subagent dispatcher; cap loop
   per Discord rate limit (10s extension per call).

### Test
Spawn a subagent that takes >30s. Watch the thread. Typing indicator
must show throughout (with pulse refresh ≤10s).

## Sub-bug B — Subagent output truncation (P1)

### Observation
"Often don't produce full output" — operator-reported pattern. Subagent
runs, posts a partial response, work is incomplete or cut off mid-sentence.

### Possible causes (need data)
1. **Model `max_tokens` cap.** Subagent dispatch may inherit a smaller
   default than top-level agents. Check `src/agent-config/...` for the
   per-agent or per-dispatch token budget.
2. **Tool-use loop cap.** If the subagent is allowed N tool turns and
   hits N before producing the final text response, the relay sends
   nothing-or-truncated.
3. **Pipeline-side message truncation.** Discord messages cap at 2000
   chars; the relay or `ProgressiveMessageEditor` may be cutting on
   boundary mismatch (saw a related fix in quick `260501-nfe`).
4. **Stream-end race.** Subagent stream closes before final chunk
   flushes through the IPC + Discord post pipeline.

### Investigation
1. Capture three recent subagent threads where this happened.
   - Schwab AIP deep dive thread (`1501438192099000443`) — full text
     landed but file then leaked to wrong channel; check completeness
     of the in-thread text.
   - `reelforge-build-v2` thread (`1501361804012687504`) — operator
     directly observed mid-sentence cutoff at "Now check for other
     gateway references and the env-var ban gate, then update compose
     + pyproject + run tes…". Strong evidence of cause #4 (stream-end
     race) or #3 (chunking).
   - Pick a third from another agent for cross-agent confirmation.
2. Pull `clawcode.service` logs covering each thread's lifecycle. Look
   for early-close, max_tokens hit, or relay truncation warnings.
3. Add structured log around relay-send (not just relay-skipped per
   quick `260501-i3r`) — `relayLen`, `chunkCount`, `endReason` when a
   subagent stream closes.

### Decision tree
- If max_tokens: bump default subagent budget; document in
  `agent-config/...`.
- If tool-loop cap: bump or make configurable per spawn.
- If pipeline truncation: fix chunking; same primitives as the
  `ProgressiveMessageEditor` from quick `260501-nfe`.
- If stream-end race: add explicit drain/ack before close.

## Sub-bug C — Cross-channel file leak (P0 correctness bug)

### Observation
fin-acquisition spawned the Schwab AIP deep-dive subagent. The TL;DR
text landed correctly in Ramy's channel thread. But the markdown file
attachment (`schwab-aip-timing-research-2026-05-05.md`) was posted at
2026-05-06 04:28:03 UTC into channel `1486348188763029648`
(**finmentum-content-creator's primary channel**) — not Ramy's
`1481670479017414767`.

### Root-cause hypothesis (high confidence)
fin-acquisition and finmentum-content-creator share the same workspace:

```yaml
fin-acquisition:
  workspace: /home/clawcode/.clawcode/agents/finmentum
finmentum-content-creator:
  workspace: /home/clawcode/.clawcode/agents/finmentum
```

When `clawcode_share_file` (or the subagent-side equivalent) resolves
"which channel do I post this attachment to?" by walking from a workspace
path to an agent → channel binding, multiple agents share the same
workspace and the lookup grabs the **wrong** one (likely first in the
config list, which happens to be content-creator).

This is structurally identical to a long-standing class of "shared
workspace" pitfalls — agent identity should drive the resolution, not
the workspace.

### Why this is P0
- File leaks across boundaries. A Schwab account research markdown ended
  up in a content-creator channel. In a different scenario this could be
  PII routed to the wrong audience (compliance-relevant for Finmentum).
- This is a silent failure — the operator didn't get an error, the file
  just landed in the wrong place.

### Fix
1. **Rebind file post by agent identity, not workspace.** Resolution path
   should be: subagent's parent agent identity → that agent's channel
   bindings → the originating thread's parent channel. Workspace is a
   coincidence, not a routing primitive.
2. **Add an explicit invariant in tests.** Spawn two agents sharing a
   workspace; verify that `clawcode_share_file` from one routes to the
   correct channel.
3. **Audit other resolution paths that key off workspace.** Memory
   writes, Discord posts, attachment uploads. Any "which agent owns
   this?" question keyed off workspace is suspect when workspaces are
   shared (the entire finmentum family shares one).

### Test
- Manual repro: trigger fin-acquisition file share with a known marker,
  verify it lands in channel `1481670479017414767`, not the
  content-creator channel.
- Regression: unit test on the resolution helper covering the
  shared-workspace case.

## Operator decision needed before kickoff

- **Bundle or split?** Three sub-bugs share the subagent dispatch
  surface but A vs B vs C have very different fix sizes (A: small,
  B: investigation-heavy, C: small + audit). Recommend keeping
  bundled because they'll all touch `subagent-thread-spawner.ts` and
  testing all three together is one machine cycle. Operator decides.
- **Sub-bug C blast radius.** Audit step 3 ("other resolution paths
  keyed off workspace") may surface more bugs. Decide whether to
  scope-creep this phase or split a follow-up.

## Success criteria

- Subagent threads show a typing indicator throughout dispatch.
- Subagent output is delivered in full, never truncated mid-sentence;
  truncation has a structured log entry if it happens.
- File attachments from a subagent always land in the same channel as
  the parent agent's originating thread, regardless of workspace shared
  state.

## Sibling quick task (already captured)

`260505-spw-subagent-spawn-announce-gap` — covers the empty-thread-for-
minutes-during-subagent-boot UX gap. Different bug, adjacent surface.
Both should ship as a coherent subagent-UX wave.
## Amendment 2026-05-06 07:21 PT — additional evidence + new sub-bug D

Operator surfaced new symptom and pointed at the 2026-05-05 reelforge
phase rebuild thread history for evidence. Captured below.

### Sub-bug D — Completion event fires before subagent finishes (NEW, P0)

**Operator-reported pattern:** "sometimes it seems like the completion
event fires before agent finishes."

**Why this is P0:** when the completion event fires early, the parent's
`autoRelay` summary lands in the main channel announcing work is done,
the thread autoarchives if `autoArchive=true`, and the operator is
told the subagent shipped — but the subagent's actual final chunks
never arrived. Silent partial-work delivery.

This compounds with sub-bug B (output truncation) — combined effect
is that the operator sees a confident "Phase 2 complete" relay summary
in the main channel while the subagent's last 2 minutes of work
silently disappeared.

### Evidence collected from reelforge build threads (2026-05-05)

#### Thread `1501361804012687504` (reelforge-build-v2 / Admin Clawdy-sub-OV9rkf)

**Turn 1** ends with:
```
Already read. Now updating docker-compose.yml to mount the daemon
socket.Now let's run the test...
```
The actual `pytest` invocation, results, and commit narrative that
followed are gone. Subagent kept working — confirmed because turn 2
starts mid-word and references the Phase 2 commit hashes
(`04f3b48` / `3851792` / `57d7fb6`) that landed AFTER turn 1's cutoff.

**Turn 2** starts with:
```
o-end in this session.
```
Should be `"end-to-end"`. The leading `"end-t"` chunk was eaten at
the chunk boundary between turns. Strong evidence of chunk-boundary
mismatch in the relay/post pipeline.

**Multiple "Already read" lines back-to-back** in turn 1 — looks like
a retry/loop pattern where the subagent re-narrates "Already read it
earlier" after each Read tool call. May be a separate issue (verbose
narration), but worth noting for context.

#### Thread `1501302129782952126` (Admin Clawdy-sub-zECOi5)

**Turn at 19:34:27.531Z** starts with:
```
lls the whole file regardless.
```
Should be `"reads the whole file regardless"` or similar. Same
chunk-boundary truncation pattern as the reelforge thread. Different
subagent, same surface bug — confirms it's not a one-off.

### Updated investigation priority for sub-bug B (output truncation)

The two evidence points above strongly suggest the cause is **#3
pipeline-side chunking** (not max_tokens, not tool-loop cap). The
truncation always happens at message boundaries — the head of one
chunk gets eaten and the tail of the previous chunk is preserved
elsewhere.

This is consistent with `ProgressiveMessageEditor` chunking behavior
where chunk N+1's leading whitespace/word gets concatenated into
chunk N's trailing edit, but the actual text content is dropped on
the floor at the seam.

### Investigation tasks (added)

1. Reproduce locally: spawn a subagent with a long multi-chunk turn
   (>4000 chars). Compare what the model emitted vs what landed in
   Discord. Diff at chunk boundaries.
2. Trace the relay path: `subagent stream chunk` → `IPC` →
   `parent dispatch` → `Discord post / edit` → `next chunk`. Find
   where the leading bytes get dropped.
3. For sub-bug D specifically: instrument `subagent_complete` event
   firing path. Confirm whether the event fires:
   - on stream `end` (correct), or
   - on tool-result-with-no-followup (premature), or
   - on heartbeat-quiescence (timeout-driven, premature)
   The 999.30 quiescence sweep (`quiescenceMinutes` default 5) may
   be firing on subagents that are mid-think between tool calls.

### Updated success criteria

- Add: completion event fires only after the subagent's stream has
  fully drained AND been delivered to Discord — not on stream-end
  IPC alone.
- Add: when `autoArchive=true`, the archive must wait for the relay
  to confirm delivery, not race ahead.

### Cross-reference

Sub-bug D rhymes with quick task `260501-i3r` (relay-skipped
diagnostic logs). Once those diagnostic logs are deployed, the
relay-fired-too-early case should produce a structured log entry
identifying which silent-return branch hit. Use those logs to
confirm or deny D's cause before writing fix code.
