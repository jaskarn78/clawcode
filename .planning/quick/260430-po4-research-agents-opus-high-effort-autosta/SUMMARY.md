---
quick_id: 260430-po4
slug: research-agents-opus-high-effort-autostart-and-subthread-delegation
date: 2026-04-30
status: complete
---

# Quick Task — Research agents → opus + high effort + autoStart, subthread delegation contract

## Goal

1. Re-tier `research` and `fin-research` agents to `model: opus` + `effort: high` + `autoStart: true` so deep-research deliverables don't run on the wrong default tier.
2. Codify in Admin Clawdy's SOUL that research delegation MUST use `spawn-subagent-thread` (never inbox-drop), with a precondition gate that fails loud if the target tier is wrong.

## Why

This morning's #admin-clawdy exchange ate ~15 min on three compounding issues:
- Admin Clawdy briefed `research` via inbox-drop instead of a subthread → no operator visibility into progress.
- Reflexively ran `clawcode start research` on a `status: starting` agent that was actually already running → duplicate procs racing on the same inbox file.
- Delegated work without verifying tier — research was at sonnet/default, operator wanted opus/high. The mismatch was caught only after the operator manually killed the duplicate proc and asked.

## Changes deployed (clawdy:`/etc/clawcode/clawcode.yaml`)

### research agent (line 311)
- `autoStart: false` → `true`
- `model: sonnet` → `opus`
- `effort: high` (added; was implicit-default, now explicit)

### fin-research agent (line 324)
- `autoStart: false` → `true`
- `model: sonnet` → `opus`
- `effort: high` (added)

### Admin Clawdy SOUL (line 744)
Added new `## Delegation Protocol (HARD CONTRACT)` section with four sub-rules:

- **Research delegation MUST use subagent threads** — never inbox-drop, never `clawcode message send` for research. Subthread isolates work, surfaces progress, posts summary back to invoking channel.
- **Precondition gate — verify tier BEFORE delegating** — must check `model === opus`, `effort === high`, `autoStart === true`. If mismatch: STOP, surface to operator with the actual values, wait for explicit answer.
- **Confirm-first for any process action** — never reflexively run `start/stop/restart/kill/clear` on another agent. The status badge can lag the registry — read PIDs and journal first, ask before acting. References the 2026-04-30 duplicate-proc incident as the trigger.
- **Suppress reassurance phrases** — no "Moving.", "Will work fast.", "On it." Filler reassurance burns trust; concrete status or "I'm waiting on your call about X" only.

Also extended the existing `## Boundaries` line to include "killing processes, spawning duplicate procs" alongside the existing destructive-action list.

## Deploy verification

| Check | Result |
|-------|--------|
| `scp` yaml to clawdy | ✅ |
| `sudo install -m 644 -o clawcode -g clawcode /tmp/clawcode.yaml.new /etc/clawcode/clawcode.yaml` | ✅ |
| `sudo systemctl restart clawcode` | ✅ `DEPLOY_OK` |
| Service `is-active` | ✅ `active` |
| Boot log: `"no policies.yaml found — using default-allow evaluator…"` | ✅ confirmed (Phase 999.11 POLICY fix also live) |
| `research` agent auto-started (`warm-path ready`) | ✅ |
| `fin-research` agent auto-started (`warm-path ready`) | ✅ |
| Deployed yaml diff vs intended | ✅ exact match (verified via `sed` on clawdy) |

## Bundled deploy

This task shipped together with **Phase 999.11** (trigger-policy default-allow + QUEUE_FULL coalescer storm fix). Both landed in the same `systemctl restart clawcode` cycle. 999.11 verification:
- `"default-allow evaluator"` boot log line present (POLICY-01..03)
- `MAX_DRAIN_DEPTH`, `COMBINED_PREFIX`, `requeue` symbols present in `dist/cli/index.js` (COAL-01..04)
- `"trigger-engine: replayMissed complete"` + `"scheduler-source: started" scheduleCount: 31` — scheduler is live and policy is no longer blocking events.

## Operator-facing follow-ups (NOT in this quick task)

The morning's exchange surfaced infrastructure gaps that this quick task doesn't fully address — they're better as separate phases:

- **Singleton lock on `clawcode start <agent>`** — daemon shouldn't allow a second proc when one is alive. Today only the SOUL says "ask first"; the daemon-side guard is missing.
- **Inbox watcher liveness telemetry** — silent stuck-watcher mode is the same family of bug as 999.11 POLICY. Surface pending-file age + last-pickup timestamp.
- **Registry status state machine** — `status: starting` should distinguish "process up + warm-path complete" from "first-response-emitted". Today they collapse into one state.
- **Distinguish historical vs current `API_ERROR_FINGERPRINTS` matches** in `restart-greeting.ts` — Admin Clawdy keeps misreading old session content as live API errors.

These are queued as candidates for a future "operator orchestration hygiene" phase. Not blocked on; ship-it-when-ready.
