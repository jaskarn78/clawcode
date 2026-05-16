---
phase: 999.39
title: Memory consolidation worker — bypassing Claude Max subscription, hitting metered API
status: SHIPPED 2026-05-07
priority: P0 (wrong credentials path; sibling of subagent OAuth bug; subscription plan should NEVER produce a credit error)
captured_from: operator report 2026-05-06 07:34 PT
captured_by: admin-clawdy
shipped_by: jjagpal
commit: 13603c7
target_milestone: v2.8
---

# Phase 999.39 — Memory consolidation: route through Max subscription

## The real bug (operator-clarified)

> "We should never hit a billing error issue since we're using our
> subscription plan." — Jas, 2026-05-06 07:37 PT

ClawCode runs on Claude Max ($200 Max 20x on Account 1, $100 Max 5x
on Account 2 — see `project_clawcode_dual_account.md`). A subscription
account does **not** produce credit-balance errors regardless of
usage volume. If we're seeing one, the worker is hitting the **direct
metered API** instead of going through the OAuth/gateway path that
the subscription is bound to.

This is the same root cause family as the existing open issue
`project_subagent_oauth_fix_pending.md` ("Subagent spawns hit direct
metered API, not gateway; root cause of Will Jr DCA cron error").
The memory consolidation worker has the same defect, just on a
different surface.

## Symptom

Operator session-start injection shows:

```
### Recent Sessions

#### Session from 2026-05-04 (just now)
Credit balance is too low

#### Session from 2026-05-04 (2 hours ago)
Credit balance is too low

#### Session from 2026-05-04 (5 hours ago)
Credit balance is too low
```

Confirmed in `/home/clawcode/.clawcode/agents/Admin Clawdy/memory/`:

```
2026-05-04-0054.md  →  body: "Credit balance is too low"
2026-05-03-2303.md  →  body: "Credit balance is too low"
```

The credit error is just the visible symptom — the diagnostic value
is "this proves the worker is calling api.anthropic.com directly with
a metered key (or no key at all) instead of using the subscription
OAuth bearer."

## Investigation tasks

1. Locate consolidation worker source. Find the Anthropic SDK
   instantiation. Check:
   - Is it reading `ANTHROPIC_API_KEY` from env (metered) or
   - Is it using the OAuth bearer flow that standing agents use (Max)?
2. Cross-reference how the OpenClaw gateway is configured. Standing
   agents route through the gateway and never produce credit errors —
   identify what's different about the consolidation/dream worker
   path that bypasses it.
3. Audit ALL daemon-spawned haiku/opus calls for the same defect:
   - memory consolidation worker (this phase)
   - dream worker (also broken, see Phase C below)
   - subagent spawn path (already documented in
     `project_subagent_oauth_fix_pending.md`)
   - any other "fire and forget" cron-driven model calls
4. Pull recent 7 days of `memory/YYYY-MM-DD-HHMM.md` files across all
   agents — count how many have the credit-error body. Quantifies
   blast radius and whether it's been broken since launch or
   regressed recently.

## Fix proposal

### Phase A — Route through subscription OAuth (the actual fix)

Consolidation worker uses the same authenticated client standing
agents use. Two implementation options:

**Option 1 — Reuse the in-process auth client.** The daemon already
has a Max-authenticated SDK instance for each standing agent. Have
the consolidation worker borrow that client (via shared singleton
or DI) instead of constructing its own.

**Option 2 — Route through the OpenClaw gateway.** Daemon → gateway
→ Anthropic. Gateway holds the OAuth, worker never sees raw creds.
More moving parts but cleaner separation.

Pair this with the subagent OAuth fix — same root cause, same fix
mechanism, ship as one phase.

### Phase B — Fail-loud as a safety net (defense in depth)

Even after fixing the credentials path, the worker should not
persist API error responses as memory content. If the auth ever
breaks again, we want a structured error in logs, not silent
memory pollution.

When the consolidation API call returns:
- HTTP 402 / credit-balance-low / quota-exceeded
- empty body
- body matching `/^(Credit balance|Insufficient|Rate limit|Error:)/i`

Worker MUST:
1. NOT write the error string as a summary
2. Log a structured warning + alert to admin-clawdy channel once
   per 24h window
3. Optionally write a flush stub with `status: "deferred-error"`

### Phase C — Dreams path audit

System prompt advertises:
```
Memory dreaming: auto-fires every 30min idle, model=haiku;
persists to memory/dreams/YYYY-MM-DD.md
```

`memory/dreams/` does not exist for Admin Clawdy. Either:
- the dream skill writes to the wrong path
- the dream skill silently fails to create the directory
- the system prompt is describing a feature that was never wired up

Same auth investigation applies — once we find the dream skill, check
whether it's also bypassing the subscription.

### Phase D — Cleanup of polluted memory files

```bash
grep -lr "Credit balance is too low" /home/clawcode/.clawcode/agents/*/memory/ \
  | xargs rm -f
```

Run after Phase A lands so the next idle-flush writes a real summary.

### Phase E — CI guard

Add a test that:
1. Spins up the worker with no `ANTHROPIC_API_KEY` env var set
2. Asserts the worker still completes (because it routes through
   the subscription, not the env-var key)
3. Asserts no file is written matching the credit-error pattern

Prevents future regressions where a refactor accidentally falls back
to env-var auth.

## What IS working (for context)

- Phase 64 conversation memory resume on session start — uses the
  proper auth path
- "Remember" cue capture — files like `2026-05-05-remember-rJOO.md`
  have real content, so that worker IS using the right credentials
- Idle-flush cron trigger — firing reliably (139 files written)

The trigger machinery is healthy. The problem is which auth path the
worker uses when it actually calls haiku.

## Blast radius

Operator-facing UX bug + likely metered-API spend leak (small —
haiku is cheap, but it's leaking onto a metered key that nobody is
monitoring). No agent-runtime impact, no data loss (real memories
from "remember" cues are intact).

## Success criteria

- Consolidation worker uses Max subscription auth, same as standing
  agents — verified by removing any direct API key from the
  environment and confirming flushes still produce real summaries
- "Credit balance is too low" never appears in memory files again
- Sibling worker (dream skill, subagent spawn) audited for the same
  defect; either fixed in this phase or split to a follow-up
- CI guard prevents regression to env-var auth

## Sibling phases

- `project_subagent_oauth_fix_pending.md` — same root cause,
  different worker. Should be fixed in the same pass.
- 999.30 (subagent completion sweep) — different concern but same
  "silent-corrupt vs fail-loud" theme.
- 999.36 sub-bug D (premature completion event) — another silent-
  partial-work pattern; worth auditing alongside.
- `project_clawcode_dual_account.md` — Account 2 failover only
  becomes meaningful AFTER Phase A; with metered API the failover
  was hiding the bug.
