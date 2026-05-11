---
phase: 260505-spw-subagent-spawn-announce-gap
plan: 01
type: investigate-then-execute
wave: 1
depends_on: []
files_likely_modified:
  - src/discord/subagent-thread-spawner.ts (TBD after investigation)
  - tools/clawcode-mcp tool description for spawn_subagent_thread (TBD)
autonomous: false
captured_from: operator observation, fin-acquisition deep-dive spawn 2026-05-05 21:11→21:19 PT
---

# Quick task: subagent spawn → first-content visible gap

## Observation (2026-05-05 PT, fin-acquisition agent in Ramy's channel)

Operator timeline:

- **21:11:15 PT** — Ramy: "do a deep dive on auto deposits vs auto investing"
- **21:13:38 PT** — fin-acq replies in main channel: "Deep dive spawned. Opus
  subagent running in thread: <discord URL with thread id ending …92099000443>
  — will relay summary here when done."
- **21:19:20 PT** — first content lands inside that thread:
  starter post "Schwab Deposit vs Auto-Invest Timing — Deep Dive"

Operator-visible gap: **~6 minutes** between the parent agent announcing the
thread URL and the thread actually showing any content. Operator clicked
through and saw an empty thread for 6 minutes, leading to the question
"He prompted at 9:11 but the subthread didn't start till like 9:20."

## Why this is a product issue, not just an agent-discipline issue

Two plausible root causes — investigation should rule them in or out:

1. **Subagent boot latency dominates.** `spawn_subagent_thread` returns
   `threadId` synchronously the moment the Discord thread is created. But
   the *first content* in that thread is the subagent's first turn, which
   only fires after subagent session boot (SOUL/IDENTITY hydration, MCP
   server startup, model warm-up). If boot takes 5–6 min, every spawn
   shows this gap.

2. **Parent agent announces the URL before the spawn IPC returns.** The
   parent serializes `spawn_subagent_thread` after several other tool
   calls (DB schema migration + standup script edits in this case). The
   announcement message is composed mid-tool-batch and posted before the
   spawn call actually fires. URL in the announcement comes from… (need
   to verify — possible the agent invented/predicted the URL? unlikely
   given Discord snowflakes are unguessable, more likely the announcement
   text is constructed AFTER spawn returns, but parent message arrives
   before subagent's first turn for reason #1).

The fin-acq case looks like #1: the parent's announcement at 21:13:38 is
2.5 min after Ramy's prompt (consistent with the parent doing 4 things in
serial), the subagent thread starter at 21:19:20 is ~5.7 min after the
announcement (consistent with subagent boot + first-turn render).

## What "good" looks like

When an operator sees `spawn_subagent_thread` URL in chat and clicks it,
they should see EITHER:

- **(A)** Visible content from the subagent in <10 s, OR
- **(B)** A loading-state placeholder ("Subagent booting…") posted by the
  daemon at the moment of thread creation, replaced by the real first
  turn when ready.

Today they see an empty thread for minutes. That's a UX bug.

## Investigation tasks

1. **Measure subagent boot time.** Instrument `spawn_subagent_thread` to
   emit `subagent_spawn_boot_ms` (between Discord-thread-created and
   subagent first-turn-posted). Sample 10 recent spawns from the fleet
   to confirm 5–6 min is typical (or whether the fin-acq case was an
   outlier).

2. **Confirm the URL announcement source.** Verify whether the parent's
   announcement text (containing the thread URL) is constructed after the
   `spawn_subagent_thread` IPC returns OR before. If before, that's a
   separate ordering bug to fix in tool-call discipline (SOUL note for
   all agents).

3. **Decide between options A and B.** Two paths to "good":
   - **A — Reduce boot latency.** Pre-warm subagent sessions, skip MCP
     servers the spawn doesn't need, use a smaller model for boot
     (`haiku`?) and hand-off to opus on first real turn. Expensive,
     architectural.
   - **B — Loading-state placeholder.** Daemon posts a system message
     to the thread on creation: "🔄 Subagent booting… first content in
     ~5 min." Replaced/edited or appended-to when subagent's first turn
     lands. Cheap, observability win, ships in days not weeks.

   Recommend B as the immediate fix, A as a parallel longer arc.

## Concrete next steps (operator chooses one)

- **Quick win (1–2 hours):** Add the loading-state placeholder + boot-time
  instrumentation. Code lives in `src/discord/subagent-thread-spawner.ts`
  near where the Discord thread is created.

- **Phase work (multi-day):** Investigate boot latency end-to-end and ship
  pre-warming if 5–6 min is in fact typical and unacceptable.

## Adjacent SOUL discipline note (no code)

Independent of the daemon fix: when an agent kicks off a deep-dive that
will take time, the in-channel ack should set expectation explicitly:

> "Spawned subagent — first content lands in ~5 min."

Not just "Deep dive spawned." Set the timer on the operator's mental
clock. Could be added as a feedback-memory / SOUL convention for all
fleet agents.

## Status

Captured 2026-05-05 from operator observation. Awaiting investigation
green-light before implementation.
