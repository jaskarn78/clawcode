# Phase 119 Plan 04 — Summary

**Plan:** 119-04 — projects agent HEARTBEAT_OK suppression (agent-side fix)
**Requirement closed:** A2A-04 / SC-4 (code-complete; deploy-gated on 24h soak)
**Date:** 2026-05-14

> ✅ **Agent-workspace commit is self-contained.** `e634b7b` patches all four prompt-corpus sites (3 in `AGENTS.md`, 1 in `HEARTBEAT.md`) plus new `skills/cron-poll/SKILL.md`.
>
> 📦 Pre-existing condensation WIP on `AGENTS.md`/`IDENTITY.md`/`MEMORY.md`/`TOOLS.md`/`USER.md`/`memory/2026-02-23.md` from a separate session is stashed under `stash@{0}` for operator review (restore with `git -C ~/.clawcode/agents/projects stash pop`; conflicts expected at the A2A-04 lines).

## Task 1 — Skill location + dispatch shape

The plan assumed `~/.clawcode/agents/projects/skills/cron-poll/` existed with a code-level wrapper that conditionally invoked `post_to_agent`. **It didn't.** No such skill, no wrapper script, no JS/bash dispatch hook anywhere under `~/.clawcode/`.

Actual leak source: the literal "reply `HEARTBEAT_OK`" instruction was embedded in **prompt prose** at three locations (`AGENTS.md:55`, `AGENTS.md:68`, `HEARTBEAT.md:33`) plus inline in every runtime TMUX_POLL cron prompt the projects agent had registered via the scheduler IPC. Dispatch path: scheduler cron fires → `scheduler.ts:107` dispatches the prompt as a turn → LLM produces "HEARTBEAT_OK" as its final assistant message → `bridge.ts` auto-delivers it to Discord. No conditional `post_to_agent` hook to gate; Pattern A (bash/JS guard) was unavailable. Plan's Pattern B (SKILL.md prose) was the only shape that fits.

## Task 2 — Guard insertion site + commit SHA

**Agent-workspace commit:** `e634b7b` in `~/.clawcode/agents/projects/` (git-tracked).
Subject: `feat(cron-poll): suppress HEARTBEAT_OK no-op to user channel (A2A-04 / 119-04)`.

Files in the commit (all 4 prompt-corpus sites patched):
- `AGENTS.md` — 3 sites: line 77 group-chat "Stay silent (HEARTBEAT_OK)" → "Stay silent" + sentinel-prohibition note; lines 116-125 Heartbeats section rewritten with silence contract + updated embedded default-heartbeat-prompt example; line 167 "When to stay quiet (HEARTBEAT_OK)" → "When to stay quiet (produce no Discord output — NOT emit HEARTBEAT_OK)".
- `HEARTBEAT.md` — line 33 "Reply: HEARTBEAT_OK" → silence contract + optional `state/heartbeat.log` write + cross-reference to cron-poll SKILL.md.
- `skills/cron-poll/SKILL.md` (new) — silence contract for self-scheduled tmux/process monitors + prompt template for re-registering existing TMUX_POLL crons whose prompts still embed the legacy instruction inline.

Narrowness: prose-level changes only, no broad regex; actionable paths (Yellow/Orange/Red context warnings, menu-prompt alerts, session-dead notifications, real user messages) explicitly preserved. All remaining `HEARTBEAT_OK` mentions in the agent workspace are now NEGATIVE references explaining what NOT to emit.

## Task 3 — 24h soak (DEFERRED)

Operator-gated. Cannot be triggered from this session. Requires production rollout to clawdy AND recreation of existing TMUX_POLL crons (whose prompts still embed the old instruction inline — see SKILL.md "Recreating existing monitors" section). Verification command at SC-4 verification time:

```
journalctl -u clawcode --since "24 hours ago" | grep -c "HEARTBEAT_OK.*projects"
```

Expected: `0`. Append the soak result to `119-04-VERIFICATION.md` per the plan's Task 3 template when complete.

## D-06 invariant (daemon repo)

`grep -rn "HEARTBEAT_OK" src/` returns 12 hits. Disposition:

- `src/manager/compact-extractors/tier4-drop.ts:14` — compaction-time matcher for in-conversation-history summarization. Not a delivery-layer filter.
- `src/memory/memory-scanner.ts:15` — docstring.
- 10 other hits — test fixtures and migration fixture preserving legacy OpenClaw shape (loader drops `prompt` at runtime per `src/config/loader.ts:263-276`).

**No daemon delivery-layer string-match filter was added.** D-06 spirit preserved. Plan line 184's strict-zero is technically violated but only by pre-existing non-filter references; flagged in VERIFICATION.md for strict-grep reviewers.

## Status

**Code-complete (agent workspace).** Plan 04 closes SC-4 only after Task 3's 24h soak returns count=0. Until then: deploy-gated.

## References

- `.planning/phases/119-a2a-delivery-reliability/119-04-PLAN.md`
- `.planning/phases/119-a2a-delivery-reliability/119-04-VERIFICATION.md`
- `.planning/phases/999.48-heartbeat-reply-leaks-to-user-channel/BACKLOG.md`
- Agent-workspace commit: `~/.clawcode/agents/projects/` @ `e634b7b`
