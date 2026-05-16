# Backlog: Hourglass → Thumbs-Up Status Indicator

## 999.45 — Replace hourglass with thumbs-up once prompt leaves queue

When an agent has a queued/in-flight prompt, Discord embeds currently show 🕓 (hourglass). The icon stays the same regardless of whether the prompt is **still waiting in queue** or has **been picked up and is actively being processed**. Operator can't tell from the UI which state it's in.

### Desired behavior

- 🕓 **hourglass** = prompt is queued, not yet picked up by the agent's event loop
- 👍 **thumbs up** = prompt has been picked up and is being processed (LLM call in flight or tool call running)
- Final state (existing) = green check / reply embed when output is delivered

### Why

Operator hands off a task and doesn't know whether they're waiting on a queue drain (which could indicate a broken webhook — cf. 999.44) or on an actively-running model call (which is just normal latency). Right now both look identical, so debug-time intuition is broken.

### Implementation notes

- The "moved from queued → processing" transition needs an explicit hook in the agent runtime. Likely fires when:
  - The SDK call (`claude --resume ...`) starts, OR
  - The first tool call / first stream-json event is emitted
- Update the embed in place via Discord webhook PATCH (same path used for streaming response edits)
- Emoji change is cheap; the harder part is wiring the runtime hook + ensuring it never double-fires on retries

### Edge cases

- Tool call retries — don't oscillate the emoji
- Crash mid-processing — should land on a red ❌ not stuck at 👍
- Webhook unavailable (cf. 999.44) — the icon update will also fail, so fixing 999.44 first makes this UI improvement actually visible

### Related screenshot

Operator-supplied screenshot 2026-05-13 10:38 PT shows ClawdyV2 reply with hourglass icon while message was already being processed — exactly the ambiguity this item resolves.

### Reporter
Jas, 2026-05-13 10:38 PT.
