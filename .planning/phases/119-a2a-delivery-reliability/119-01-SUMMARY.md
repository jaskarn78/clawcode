---
phase: 119-a2a-delivery-reliability
plan: 01
subsystem: a2a-delivery
tags: [a2a, post-to-agent, webhook-manager, bot-direct-fallback, boot-sentinel]
requirements: [A2A-01, A2A-02]
dependency-graph:
  requires: []
  provides: [bot-direct-fallback-on-post-to-agent, webhook-401-404-recovery, boot-sentinel-A2A-01]
  affects: [src/manager/daemon-post-to-agent-ipc.ts, src/discord/webhook-manager.ts, src/manager/daemon.ts]
tech-stack:
  added: []
  patterns: [optional-DI seam (botDirectSender, reprovisionWebhook), boot-time-sentinel log-keyword]
key-files:
  created:
    - .planning/phases/119-a2a-delivery-reliability/deferred-items.md
  modified:
    - src/manager/daemon-post-to-agent-ipc.ts
    - src/manager/__tests__/post-to-agent-ipc.test.ts
    - src/discord/webhook-manager.ts
    - src/discord/__tests__/webhook-manager.test.ts
    - src/manager/daemon.ts
decisions:
  - "DI seam over class extension for the WebhookManager reprovisioner (avoids coupling to Discord Client)."
  - "Sentinel probes first-running auto-started agent (self-probe) — no literal admin agent assumption."
  - "Sentinel skipped under VITEST / NODE_ENV=test (would otherwise fire a synthetic IPC per unit-test boot)."
  - "Reprovisioner closure captured at daemon boot — runtime YAML reloads do not refresh it (daemon restart already covers that path)."
metrics:
  completed: 2026-05-14
  tasks: 3
  files-modified: 5
  files-created: 1
---

# Phase 119 Plan 01: A2A-01 + A2A-02 — Bot-direct fallback + Webhook 401/404 recovery — Summary

One-liner: `post_to_agent` now drops through the same bot-direct rung that `ask_agent` already had (1-2s delivery on offline-webhook agents instead of 60s+ heartbeat-sweep), and `WebhookManager.sendAsAgent` recovers from Discord 401/404 in one bounded retry by invalidating the cache and reprovisioning via an injected closure.

## Tasks completed

| Task  | Commit                                          | Files                                                                                                                                                  |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T-01  | `0aa0e5e` feat(119-01-T01)                      | `src/manager/daemon-post-to-agent-ipc.ts` (+ test), 5 new test cases for the bot-direct rung                                                            |
| T-02  | `f910de5` feat(119-01-T02)                      | `src/discord/webhook-manager.ts` (+ test), 6 new test cases for 401/404 recovery                                                                        |
| T-03  | `ae4c8b1` feat(119-01-T03)                      | `src/manager/daemon.ts` — case-body deps wiring + reprovisioner closure + boot sentinel                                                                  |

## File changes (line-range estimates)

- `src/manager/daemon-post-to-agent-ipc.ts`:
  - `PostToAgentAgentConfigLike` extended with optional `channels` (~line 92).
  - `PostToAgentDeps` extended with optional `botDirectSender` (~line 132).
  - Bot-direct rung inserted between the `no-webhook` check and the `inboxOnlyResponse` return (~lines 200-235).
  - Structured pino info log `[A2A-01] bot-direct dispatch` with `{agent, channel, reason: bot-direct-fallback}` on success.
- `src/discord/webhook-manager.ts`:
  - `WebhookManagerConfig` extended with optional `reprovisionWebhook` (~line 18-30).
  - `identities` made internally mutable (`Map`, not `ReadonlyMap`) so `invalidate()` and the reprovision-set work.
  - `sendAsAgent` wrapped in a try/catch that gates on HTTP status 401 OR 404 (via `extractDiscordStatusCode`), calls `invalidate(agentName)` → `reprovisionWebhook(agentName)` → retries the send ONCE.
  - New `invalidate(agentName)` method (cache + client teardown).
  - New private `attemptSendAsAgent` helper (single-attempt extraction).
  - New `extractDiscordStatusCode` helper handles both `.status` and `.code` (discord.js v14 DiscordAPIError shapes).
- `src/manager/daemon.ts`:
  - `case "post-to-agent":` body now passes `botDirectSender` (late-bound via `botDirectSenderRef.current`) — mirrors the `case "ask-agent":` shape at the same case-block.
  - WebhookManager construction (Discord-up branch only) now passes a `reprovisionWebhook` closure that delegates to `verifyAgentWebhookIdentity` (single source of truth for the auto-provision contract).
  - Boot sentinel inserted inside the void-IIFE that calls `manager.startAll(...)`. Fires once after auto-start resolves, picks the first running auto-started agent, synthesizes a self-`post_to_agent`, asserts `result.delivered === true`, logs literal `[A2A-01-sentinel] OK` or `[A2A-01-sentinel] FAIL`. Gated on `process.env.VITEST` / `NODE_ENV=test`.

## Test results

- `npx vitest run src/manager/__tests__/post-to-agent-ipc.test.ts src/discord/__tests__/webhook-manager.test.ts`
  - **Test Files: 2 passed (2). Tests: 26 passed (26).** Duration 623ms.
- `npx tsc --noEmit` — exit 0, clean.
- New cases:
  - **A2A-01 bot-direct (5):** happy-path (no-webhook + bound channel + sender wired → delivered), sender-throws-falls-through-to-inbox, webhook-wins (no bot-direct call), unwired (no bot-direct call), no-bound-channel via `no-target-channels` gate.
  - **A2A-02 401/404 recovery (6):** 401-then-200 (cache holds NEW URL), 404-then-200 (same), 401-then-401 (bounded — 2 attempts then throws), non-4xx (no retry), reprovisioner unwired (no retry), reprovisioner returns undefined (no retry).

## Sentinel keyword in production

After deploy, the production verification artifact is:

```
journalctl -u clawcode -n 500 | grep "A2A-01-sentinel"
```

Expected: a single line `[A2A-01-sentinel] OK` per daemon boot.

Local dev-run smoke test was NOT performed in this commit cycle — a full daemon boot needs a Discord bot token + live agent processes, which is out of scope for a pre-deploy commit. The sentinel keyword is pre-committed in the source (greppable at `src/manager/daemon.ts` lines 8214, 8223, 8229), and the unit tests cover the handler logic the sentinel exercises. The actual end-to-end "sentinel logs OK at boot" verification is the operator's job at the deploy + 24h observation window per D-07.

## Deviations from plan

- **T-02 reprovisioner is an injected closure, not an internal method on WebhookManager.** The plan says "call the bot to provision a fresh webhook — re-use existing provisioning helper", which implied the manager already had a bot reference. It does not (the manager only knows its `identities` map, not the Discord Client). I added an optional `reprovisionWebhook` DI seam on `WebhookManagerConfig` and wired the closure from `daemon.ts` where the Discord Client is in scope. **Rationale:** matches the existing DI shape of the manager, keeps `webhook-manager.ts` unaware of `discord.js.Client`, and is exactly the seam the unit tests already mock.
- **Sentinel target uses first-running agent, not `admin→admin`.** The plan literal `{from: 'admin', to: 'admin'}` does not match any agent in `clawcode.yaml` (production admin is `admin-clawdy`). The implementation picks the first running auto-started agent and self-probes (`from === to`), which gives an end-to-end signal of "handler is wired + at least one agent is running + delivery returns delivered:true" without hardcoding an agent name. **Rationale:** plan literal would FAIL on every clean boot — silent-path-bifurcation prevention turning into a permanent noise source.
- **Sentinel skip-gate uses `VITEST` / `NODE_ENV=test` env vars,** not "the test-mode flag the ask-agent path uses at line 158." That flag does not exist in `daemon-ask-agent-ipc.ts:158` — line 158 is `buildAskAgentDeps` internals. **Rationale:** there is no pre-existing test-mode flag in `daemon.ts`; vitest sets `VITEST=true` automatically.

## Deferred / out-of-scope

- 17 pre-existing test failures on `master` (bootstrap-integration, daemon-openai, dream-prompt-builder, session-config, daemon-warmup-probe, migration/verifier) — verified pre-existing via `git stash` + rerun. Logged in `deferred-items.md` alongside the migration verifier failures. None of these touch the A2A delivery surface.

## Pre-merge gate verification

- `grep -rn "DeliveryStrategy\|delivery-strategy" src/` → no matches. D-10 enforcement holds.
- `grep -n "A2A-01-sentinel" src/manager/daemon.ts` → 5 matches at lines 8169, 8177, 8214, 8223, 8229. Sentinel keyword pre-committed.
- `grep -n "botDirectSender\." src/manager/daemon-post-to-agent-ipc.ts` → match at the new rung. Bot-direct rung in place.
- `grep -n "401\|404" src/discord/webhook-manager.ts` → matches in `sendAsAgent` 401/404 gate. A2A-02 wired.

## Outstanding

- **Deploy to clawdy + 24h observation window** before Plan 119-03 (icon transitions) lands — per D-07 sequencing.
  - Operator gate: Ramy active in #fin-acquisition per `feedback_ramy_active_no_deploy`. NO auto-deploy from this plan. Deploy on explicit operator confirmation.
- Verification artifact at deploy time: grep journalctl for `[A2A-01-sentinel] OK` after daemon restart.

## Self-Check: PASSED

- T-01 commit `0aa0e5e` present in `git log`.
- T-02 commit `f910de5` present in `git log`.
- T-03 commit `ae4c8b1` present in `git log`.
- All five plan-targeted files exist on disk and contain the expected changes.
- `npx tsc --noEmit` clean (no type errors introduced).
- 26 plan-targeted tests pass; 0 plan-related failures.
