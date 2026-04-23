---
status: partial
phase: 89-agent-restart-greeting-active-discord-send-of-prior-context-summary-on-restart
source: [89-VERIFICATION.md]
started: 2026-04-23T22:45:00Z
updated: 2026-04-23T22:45:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live Discord greeting on restart
expected: After issuing `/clawcode-restart <agent>` (or equivalent daemon restart-agent IPC / CLI), a webhook-attributed embed appears in the agent's bound Discord channel within ~15 seconds. The embed shows:
  - Webhook identity (per-agent avatar + display name via v1.6 webhook-manager)
  - First-person voice summary under 500 characters (truncated with U+2026 ellipsis if the raw Haiku output exceeded 500)
  - Blurple color (0x5865F2) for clean restart OR amber (0xFFCC00) for crash-recovery (based on `prevConsecutiveFailures > 0` classifier)
  - "Recovered after unexpected shutdown" framing on crash path (no internal state leaked — no exit codes, no stack traces)
result: [pending]

### 2. Dormancy skip
expected: Restart an agent that has been idle >7 days (no turns in ConversationStore within the last 7 days). No Discord message is sent to the bound channel. Daemon pino log shows a `skipped-dormant` outcome from `sendRestartGreeting` (or the equivalent discriminated-union kind from `GreetingOutcome`). Restart itself completes successfully.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
