# Backlog: Heartbeat Reply Leaks to User Channel

## 999.48 — Agent's internal cron-poll acknowledgment ("HEARTBEAT_OK") leaks into Discord channel instead of staying silent

The `projects` agent runs a self-scheduled 5-minute cron poll against the `new-reel` tmux session (operator approved Option A — silent polling, set up earlier in the session). The agreed contract:

- If `new-reel` is actively working → **stay silent** (no Discord post)
- If `new-reel` hits a prompt / menu / permission ask → ping the operator with context
- If `new-reel` session dies → tell operator, kill the cron
- Default "nothing to report" signal → `HEARTBEAT_OK`, **meant to be internal**

The bug: `HEARTBEAT_OK` is escaping the agent's internal monitor loop and being posted to the operator's Discord channel. Operator sees `HEARTBEAT_OK` as a reply to their own messages (`?`, `you there?`) and assumes the agent is unresponsive or stuck.

**Important clarification (from `projects` agent self-report, 2026-05-13 15:40 PT):** this is NOT the daemon-level 50-min heartbeat (`heartbeat.every: 50m`, haiku model) that runs `Reply: HEARTBEAT_OK` for context-fill health. That is a separate mechanism. The `HEARTBEAT_OK` leaking here is the agent's *own* monitoring acknowledgment string for an *agent-owned* cron — same literal output, different source.

### Symptoms

- 2026-05-13 ~15:30 PT — Operator pinged `projects` agent (channel `1471307765401129002`) with `?` and `you there?`. Agent replied `HEARTBEAT_OK` three times in five minutes. Operator surfaced this as confusing; looked like the agent was ignoring real messages.
- Transcript:
  ```
  ClawdyV2: HEARTBEAT_OK             ← leaked cron-poll ack
  Jas:      you there?
  ClawdyV2: HEARTBEAT_OK             ← leaked cron-poll ack
  Jas:      ?
  ClawdyV2: HEARTBEAT_OK             ← leaked cron-poll ack
  ```
- Real user messages eventually got real replies (~30–60 s later), so the agent is alive — its monitor output is just being routed to the wrong sink.

### Root cause

The agent's cron poll runs through whatever message-sink path the agent uses for normal channel posts. The "no-op / nothing to report" signal needs a different output destination — either:
- An internal log / state file the operator can inspect on demand, but NOT a Discord post
- Or a dedicated monitor thread/channel, NOT the operator's main agent channel
- Or simply: a NULL action when there's nothing to report

The contract says "stay silent" — but the implementation doesn't actually stay silent; it posts a sentinel string. Two distinct concerns:

1. **The contract is wrong** — "nothing to report = post HEARTBEAT_OK" should be "nothing to report = post nothing." Truly silent.
2. **OR the contract is fine, but the routing is wrong** — `HEARTBEAT_OK` should go to an admin/observability channel (or stderr / a state file), not the user channel.

### Acceptance criteria

- Cron poll acknowledgments do not appear in the operator's user-facing Discord channel
- Operator messages sent during a poll cycle get real, contextually-relevant responses
- Operator has an opt-in way to inspect monitor state ("show me the latest poll status") on demand
- Fix is the agent's own design choice — projects agent maintains its own cron, so the fix lives in its skill/loop logic, not in the daemon

### Implementation notes

- The projects agent owns this — operator should ask projects agent to fix its own monitor loop:
  - "nothing to report" → log to local file or memory, don't post
  - Only post to Discord on actionable state (yellow/red — prompt / dead / unreachable)
- If a periodic "still alive" signal is needed for observer confidence, post to admin observability channel (admin-clawdy) instead of the agent's primary user channel — and frequency should be 30 min+, not 5 min
- Test: run the monitor for 30 minutes against a known-quiet `new-reel` session, assert zero posts to the user channel

### Related

- 999.44 — Agent-to-agent message delivery reliability (parallel routing concern)
- Daemon `heartbeat.every: 50m` config (separate mechanism, NOT the source of this bug)
- Operator preference: silent monitoring (Option A, established earlier this session)

### Reporter

Jas, 2026-05-13 15:36 PT
Clarified by projects agent, 15:40 PT — root cause is agent's own cron-poll, not the daemon heartbeat
