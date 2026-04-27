# Deferred items — phase 99

Out-of-scope discoveries during 99-mdrop fix (Admin Clawdy memory drop).
Audit ref: `ADMIN-CLAWDY-MEMORY-DROP-2026-04-27.md`.

## Pre-existing failures (confirmed on baseline master)

Confirmed by `git stash` + re-run on master at commit 870623f: 6 failures
exist before AND after 99-mdrop changes — zero regressions, zero new
failures introduced.

`src/memory/__tests__/conversation-brief.test.ts`:
- `skips when gap under threshold`
- `regression: agents-forget-across-sessions (production ordering) >
  still gap-skips when the prior terminated session is within threshold`

`src/memory/__tests__/conversation-store.test.ts`:
- `listRecentTerminatedSessions excludes active sessions`
- `listRecentTerminatedSessions includes summarized sessions`
- `listRecentTerminatedSessions orders by started_at DESC`
- `listRecentTerminatedSessions respects limit and agent filter`

**Root cause (not fixed here):** `ConversationStore.listRecentTerminatedSessions`
filters with `EXISTS (SELECT 1 FROM conversation_turns ...)`. The two
failing tests seed terminated sessions WITHOUT recording any turns, so
the EXISTS filter excludes them and the gap check never fires. The
brief renders instead of gap-skipping.

**Why deferred:** unrelated to memory drop scope. Either the test
fixtures need to seed at least one turn (likely the right fix — production
sessions always have turns) or `listRecentTerminatedSessions` needs an
option to opt out of the EXISTS filter for callers that only care about
timestamps. Both options are larger than the audit fix scope.

**Suggested next pass:** open a small follow-up task to add a
`recordTurn(...)` call inside `seedEndedSession` in
`conversation-brief.test.ts`. Two lines per test, no production change.
