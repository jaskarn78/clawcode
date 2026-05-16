---
quick_id: 260511-pw2
slug: investigate-post-to-agent-silent-drops-b
date: 2026-05-11
status: complete
classification: fully-fixed
commits:
  - 43e2c79  # fix(260511-pw2): post_to_agent silent-drop diagnostics + sentinel test
files_changed:
  - src/manager/daemon-post-to-agent-ipc.ts (new — pure-DI handler)
  - src/manager/daemon.ts (extract case "post-to-agent" body to handler)
  - src/mcp/server.ts (rewrite postToAgentHandler result text)
  - src/manager/__tests__/post-to-agent-ipc.test.ts (new — 8 functional + 2 sentinel tests)
deferred:
  - src/mcp/server.test.ts "has exactly 22 tools defined" — pre-existing
    failure, expected 22 actual 27. Not caused by this quick task; logged
    in deferred-items.md.
---

# Quick 260511-pw2 — post_to_agent silent drops

## Summary

`post_to_agent` between top-level agents could silently drop messages on
three orthogonal failure modes (no target channels, no webhook, webhook
send failed) — each path returned `{ delivered: false, messageId }` with
no `reason`, and the MCP wrapper rendered `"Message queued for X (id:
<nanoid>)"`. The sender's LLM then called `task_status(id)` because the
opaque nanoid looked task-shaped, and got "not found" — the
post-id-looks-task-shaped confusion Admin Clawdy reported on 2026-05-11.

This change extracts the IPC body to a pure-DI handler
(`daemon-post-to-agent-ipc.ts`, mirrors Phase 999.2 Plan 03's
`daemon-ask-agent-ipc.ts` blueprint). All six silent-skip points now emit
structured `"post-to-agent skipped"` pino info logs with `reason` tags —
the exact substrate Phase 999.18 / quick 260501-i3r added for the
subagent-relay path.

## What the bug actually was

Three compounding failure modes, none surfaced:

1. **MCP wrapper rendered "queued" with an opaque inbox id.** The sender's
   LLM (and Admin Clawdy) took the id to be a delegate-task id and called
   `task_status(id)`, which always returns "not found" — they're separate
   systems. **This is the user-visible half of the bug.**
2. **`delivered=false` returned with no reason.** Operators reading the
   IPC response had no telemetry on which of three skip paths fired.
3. **Webhook failure was logged via `console.warn` once, but the other
   two skip paths (`no-target-channels`, `no-webhook`) had no logs at
   all** — pure silent returns.

Underlying delivery was NOT actually lost: the inbox-write happens before
the webhook attempt, and the heartbeat inbox check (`src/heartbeat/
checks/inbox.ts`) drains the inbox for every agent on a 60s cadence and
calls `sessionManager.dispatchTurn` for each unprocessed message. So the
recipient eventually got the message — but the sender's LLM had no
indication that this was an "eventually" path versus a "now" path.

## What changed

### Reason tags (six total)

| Reason                  | Trigger                                                  | Disposition                |
| ----------------------- | -------------------------------------------------------- | -------------------------- |
| `target-not-found`      | target agent absent from configs                         | throws ManagerError        |
| `inbox-write-failed`    | `writeMessage` rejected (disk / permissions)             | throws ManagerError        |
| `no-target-channels`    | `agentToChannels.get(to)` empty                          | returns `delivered=false`  |
| `no-webhook`            | `webhookManager.hasWebhook(to) === false`                | returns `delivered=false`  |
| `webhook-send-failed`   | `sendAsAgent` rejected                                   | returns `delivered=false`  |
| `target-not-running`    | inbox-only AND target offline (secondary diagnostic log) | additional log only        |

### Response shape

Before: `{ delivered: boolean, messageId: string }`
After:  `{ ok: boolean, delivered: boolean, messageId: string, reason?: string }`

`reason` is present iff `delivered=false`. Sender's MCP wrapper reads it
and renders explicit text: "Message written to X's inbox (reason: ...).
Webhook delivery failed, so they will receive it on their next
inbox-heartbeat sweep (not immediately). Note: this is NOT a delegate_task
id — do not call task_status on it. For synchronous Q&A use ask_agent
instead."

### Sentinel test

`src/manager/__tests__/post-to-agent-ipc.test.ts` contains:

- 8 functional tests — one per reason tag (target-not-found,
  inbox-write-failed, no-target-channels, no-webhook,
  webhook-send-failed, target-not-running plus the negative case, and
  the happy path).
- 2 static-grep sentinels:
  - `daemon.ts case "post-to-agent"` imports
    `./daemon-post-to-agent-ipc.js` (anti-pattern guard: pin the
    production caller chain so future refactors can't bifurcate it
    silently).
  - The handler module emits all six reason tags AND uses the SAME
    `"post-to-agent skipped"` substrate string everywhere (operators
    grep one phrase to inventory every skip).

## Verification

- `npx tsc --noEmit` exits 0
- `npx vitest run src/manager/__tests__/post-to-agent-ipc.test.ts` —
  10/10 pass
- `npx vitest run src/manager/__tests__/ask-agent-ipc.test.ts` —
  unchanged, 48/48 pass

## Threat-surface scan

No new network endpoints, auth paths, file-access patterns, or schema
changes at trust boundaries. The handler is a pure refactor + log
addition on an existing IPC method.

## Self-Check: PASSED

- `src/manager/daemon-post-to-agent-ipc.ts` exists.
- `src/manager/__tests__/post-to-agent-ipc.test.ts` exists.
- `docs/cross-agent-schemas.md` (Bug 2's doc) exists.
- Commit 43e2c79 exists in `git log --oneline`.
