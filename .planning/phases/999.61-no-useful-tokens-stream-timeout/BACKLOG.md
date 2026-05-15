# Backlog: No-Useful-Tokens Stream Timeout

## 999.61 — Add SDK-level "no useful content tokens for N seconds → fail the turn" timeout to the agent SDK process supervisor

The Claude Agent SDK today only times out on **dead** streams (no bytes arriving). It does not time out on **stalled** streams (bytes flowing, but no useful content tokens). This means fin-acq (and any other agent) can sit indefinitely on an Anthropic API response that emits keepalive bytes or partial deltas without ever producing a usable token, while the daemon supervisor sees the connection as healthy.

Observed live on 2026-05-14: fin-acq posted an empty-content turn at 02:57 UTC, then sat for ~16 minutes on follow-up questions before Jas asked Admin Clawdy to interrupt. fin-acq process was at 8% sustained CPU (parsing keepalives), Anthropic TCP socket open, all 13 MCP children healthy at 0% CPU. No timeout fired because the stream technically had traffic.

### Why / Symptoms
- **2026-05-14 03:00–03:17 UTC**: fin-acquisition stalled mid-turn on a Components V2 follow-up question. Required manual `clawcode restart fin-acquisition` to recover.
- Empty-content turn at 02:57 UTC was the soft-fail tell — SDK emitted a turn-complete event with no body, then the next turn entered the same stall pattern.
- Effort=high + `--include-partial-messages` + advisor consult amplify the failure mode: the SDK is configured to be patient, so a stall consumes more wall-clock before any safety net trips.
- Operator-observable symptom: agent appears alive (process running, CPU non-zero, MCP children healthy) but emits no Discord output for >5 minutes after a question.

### Acceptance criteria
- Agent SDK supervisor (in `/opt/clawcode/src/sessions/` or wherever the stream lifecycle lives) tracks **last-useful-token timestamp** per active turn, distinct from last-byte timestamp
- "Useful token" defined as: any `content_block_delta` or `message_delta` event with non-empty `text` / `partial_json` content (NOT keepalives, NOT empty deltas)
- Per-agent configurable threshold in `clawcode.yaml`, default **180 seconds** of zero useful tokens triggers turn-failure
- On trip: emit a structured error event, persist a "stream-stall" reason in the session, surface a single-line operator notification in the agent's Discord channel ("⚠️ stream stall — turn aborted, send the message again"), then return supervisor to idle
- Does **not** kill the agent process — only kills the in-flight turn, same blast radius as a normal turn completion
- Telemetry: stall events logged with last-useful-token-age, advisor-active flag, model name, effort level for later analysis
- Threshold tunable per-model: opus-with-advisor can legitimately think longer than sonnet, so default may differ

### Implementation notes / Suggested investigation
- The Anthropic SDK already surfaces fine-grained stream events; the wrap point is wherever the daemon consumes the SDK iterator
- Read `/opt/clawcode/src/sessions/*` for the existing turn-lifecycle handler; the timestamp tracker likely belongs alongside `lastByteAt`
- Default of 180s is a guess — pull last 7 days of agent turns from session logs to find p99 inter-token gap on healthy turns; set threshold at ~2x p99
- Verify advisor consultations don't false-positive: when an agent calls `advisor()`, the parent stream pauses while a child stream runs — make sure last-useful-token clock pauses with it (or the threshold is high enough to cover an Opus advisor consult)
- Test approach: inject a fake "stream emits keepalives only" event source and confirm the supervisor trips at threshold
- Consider also: surface the stall reason in the session JSONL so [[999.51-operator-triggered-session-compaction]] can detect this pattern when compacting

### Why not just "longer timeout on dead streams"
That's what we have today and it's the bug — the stream isn't dead, it's stalled. A longer dead-stream timeout doesn't help. The distinguishing feature must be **content-aware**.

### Related
- Live incident: fin-acquisition stall, 2026-05-14 03:00–03:17 UTC (interrupted manually by Admin Clawdy at 03:13 via `clawcode restart fin-acquisition`)
- [[999.60-clawcode-as-mcp-server]] — external callers will need the same stall protection
- [[999.51-operator-triggered-session-compaction]] — adjacent: also benefits from structured stall events in the session log
- Adjacent operator desire: **provider failover chain** (Anthropic stall → retry with shorter effort or alternate provider) — fold into this phase or split as 999.62 if it grows

**Reporter:** Jas, 2026-05-14 20:17 PT
