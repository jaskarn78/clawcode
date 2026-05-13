# Backlog: Heartbeat Reply Leaks to User Channel

## 999.48 — Daemon heartbeat probe replies leak into user-facing Discord channel, blocking real responses

When the daemon fires its periodic context-health heartbeat (`heartbeat.every: 50m`), the agent's response — which is supposed to be the literal string `HEARTBEAT_OK` consumed internally — leaks into the agent's user-facing Discord channel. Worse: subsequent user messages sent within ~30–60 s of the heartbeat firing also get answered with `HEARTBEAT_OK` instead of a real reply. The user appears to be ignored until the heartbeat cycle clears.

### Symptoms

- 2026-05-13 ~15:30 PT — Operator pinged the `projects` agent (channel `1471307765401129002`) with multiple short queries (`?`, `you there?`). The agent replied `HEARTBEAT_OK` to each, then eventually surfaced a proper menu after ~1 minute.
- Conversation transcript (verbatim, from projects channel):
  ```
  ClawdyV2: HEARTBEAT_OK
  Jas:      ?
  ClawdyV2: 💠 new-reel needs you — numbered menu waiting. [...]
  Jas:      you there?
  ClawdyV2: HEARTBEAT_OK
  Jas:      ?
  ClawdyV2: HEARTBEAT_OK
  ```
- Pattern: heartbeat fires → 1–3 subsequent user-channel posts come back as `HEARTBEAT_OK` regardless of the user's actual question.
- Operator surfaced this as confusing — looked like the agent was unresponsive, when actually the agent was alive but its replies were being mis-routed (or it was mis-interpreting heartbeat context as still in scope).

### Root cause (hypotheses, ranked)

1. **Daemon routing bug** — heartbeat reply pathway not isolated from user-channel webhook posting. The string `HEARTBEAT_OK` is meant for an internal probe handler, but it's reaching the Discord webhook instead. Agent isolation between the haiku-driven heartbeat sub-call and the main agent session may not be tight enough.
2. **Context pollution** — the heartbeat prompt is being injected into the same context window as user messages, so the agent treats short user pings (`?`, `you there?`) as still part of the heartbeat probe and replies in heartbeat-mode.
3. **Sticky reply mode** — once the agent enters "minimal heartbeat reply" mode, it doesn't fully reset for 1–3 cycles, even when user messages arrive.

Heartbeat config that fires this behavior (from `clawcode.yaml`):

```yaml
heartbeat:
  every: 50m
  model: haiku
  prompt: |
    # Context Health Monitor
    1. Call session_status to get current token usage
    2. Identify zone and act: ...
    Reply: HEARTBEAT_OK
```

The `Reply: HEARTBEAT_OK` instruction is bare — no marker, no envelope. The daemon presumably greps for `HEARTBEAT_OK` and consumes it. If it doesn't (or if the same string also appears in user-channel output), the leak happens.

### Acceptance criteria

- Heartbeat probe replies (`HEARTBEAT_OK`) never appear in a user-facing Discord channel
- User messages sent within ±1 min of a heartbeat firing get real responses, not `HEARTBEAT_OK`
- A heartbeat that returns a non-OK status (e.g. context fill warning) routes to operator alerting (admin channel), NOT to the user channel where the agent was working
- The behavior is testable: send a synthetic message during heartbeat window and assert the agent replies normally

### Implementation notes

- Likely fix is in the daemon's response router — branch on `isHeartbeatReply` (truthy if the agent invocation was triggered by the heartbeat scheduler) BEFORE deciding whether to post the response to a Discord webhook
- Simpler: change the heartbeat prompt to require a wrapped marker (e.g. `<heartbeat>OK</heartbeat>`) that the daemon strips before any output gets near a webhook
- Verify isolation: a heartbeat invocation should ideally be a completely separate session/process, not a turn inside the live user session. If it's currently a turn, switching to an out-of-band call removes the leak entirely
- Test fixture: simulate heartbeat fire ±10 s of user message, assert correct routing

### Related

- 999.44 — Agent-to-agent message delivery reliability (parallel routing problem; symptom-adjacent)
- 999.45 — Hourglass-to-thumbs-up icon (UI signal that prompt-cycle completed; related to "is the agent alive" UX)
- `feedback_recall_via_discord_history.md` — Operator already relies on Discord history when session summaries are lossy; heartbeat noise pollutes the transcript

### Reporter

Jas, 2026-05-13 15:36 PT
