# Backlog: Agent-to-Agent Communication Reliability

## 999.44 — Fix agent-to-agent message delivery (no-webhook fallthrough)

Agent-to-agent comms via `post_to_agent` / `send_to_agent` frequently fall through to the inbox-heartbeat path instead of delivering live. Returned error from the broker:

> "Message written to fin-acquisition's inbox (reason: no-webhook). Webhook delivery to their Discord channel failed, so they will receive it on their next inbox-heartbeat sweep (not immediately)."

### Symptoms observed

- 2026-05-13 ~10:30 PT — Admin Clawdy sent two messages to fin-acquisition (VM resize correction + SDD verification task). Both returned `no-webhook`, queued for heartbeat.
- Same window — fin-acquisition was perceived as "slow to respond" to Ramy in `finmentum-client-acquisition`. Likely the same broken webhook path means Ramy's messages also arrived only on heartbeat polls instead of in real time.
- Pattern is recurring, not a one-off — operator reported "agent to agent communication never seems to work."

### Root cause hypotheses

1. The agent-specific Discord webhook expired/rotated and the broker is silently falling back to heartbeat without retry/recovery.
2. Webhook subscriptions get lost on daemon restart and aren't re-registered.
3. Cloudflare/rate-limit 1010-style blocking on Python User-Agent (cf. `feedback_post_release_embed` UA patch) might be blocking webhook POSTs too.
4. The `MANAGE_WEBHOOKS` bot permission may be missing in some channels (cf. Phase 90.1 hotfix history).

### Acceptance criteria

- `post_to_agent` returns live-delivery confirmation, not `no-webhook`, in steady state.
- If a webhook genuinely is broken (rotated/deleted), the broker auto-heals: re-registers, retries the failed message, then resumes live delivery — without operator intervention.
- Add daemon-level telemetry: count of `no-webhook` fallbacks per channel per hour; alert if any channel sustains > 0 over a rolling window.
- Heartbeat-sweep cadence should be tightened (or eliminated) for channels with healthy webhooks — it's the slow-path fallback, not the steady-state delivery mode.

### Suggested investigation

1. Capture a `no-webhook` event with full broker stack trace + webhook ID at time of failure.
2. Verify webhook exists in Discord (`GET /channels/{id}/webhooks` with bot token).
3. Check daemon's webhook registry/cache: stale entries? Last-success timestamp?
4. Reproduce: send agent A → agent B 5x rapid; record success vs fallback ratio.

### Related

- Phase 90.1 (webhook auto-provisioner returned `total=0`, hotfix added bot-direct fallback)
- 999.12 (cross-agent IPC channel delivery heartbeat inbox timeout)
- 999.25 (subagent relay on work completion not session end)

### Reporter
Jas, 2026-05-13 10:38 PT.
