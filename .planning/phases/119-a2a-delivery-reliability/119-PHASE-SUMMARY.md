# Phase 119 — A2A Delivery Reliability — Phase Summary

**Status:** Code-complete across all 4 plans; production deployed; SC-1 + SC-5 verified live; SC-2 unit-tested; SC-3 + SC-4 deploy-gated for operator-visual / 24h-soak verification.
**Phase window:** 2026-05-14 (Wave 1 + Wave 2 + Plan 04 + hotfixes all landed same day)
**Daemon deploy:** 2026-05-14 18:04 UTC (`/opt/clawcode/dist`, daemon `pid=1801283`, `ActiveEnterTimestamp=Thu 2026-05-14 11:04:20 PDT`)

## Plans

| Plan | Requirement | Commits | Status |
|------|-------------|---------|--------|
| 119-01 | A2A-01 + A2A-02 | `0aa0e5e` `f910de5` `ae4c8b1` `cfbf7bc` | Deployed; SC-1 live-green |
| 119-02 | D-05 counter | `e147b92` `954e3a6` `42af77b` | Deployed; SC-5 live-green |
| 119-03 | A2A-03 | `670931e` `afcab56` (+ hotfixes `ecd1231` `f378ab7`) | Deployed; SC-3 needs operator screenshot |
| 119-04 | A2A-04 | Agent-workspace `e634b7b` + docs `ba1bcdc` `8872ec2` | Agent-workspace not yet rsynced to clawdy; SC-4 24h soak pending |

## Success Criteria — verification status

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | Synthetic admin→admin `post_to_agent` returns `{delivered: true}` at boot | ✅ **Green** | `journalctl -u clawcode \| grep "A2A-01-sentinel"` shows `[A2A-01-sentinel] OK` log line at every daemon boot since deploy. Verified 2026-05-14 ~19:22 UTC. |
| SC-2 | `WebhookManager` re-provisions on HTTP 401/404 within one delivery attempt | ✅ **Unit-tested + deployed** | Vitest mock-401→200 sequence pinned in `src/discord/__tests__/webhook-manager.test.ts` (6 new cases per Plan 01 T-02). Live re-verification gated on a real Discord 401/404 event — not synthetic-triggerable. |
| SC-3 | Queue-state icon transitions `⏳` → `👍` → `✅`/`❌` atomically | ⏳ **Deploy-gated** | Code-deployed (state machine module + bridge wiring + 2 hotfixes). Operator-visual screenshot on a fresh A2A turn is the remaining artifact. |
| SC-4 | 24h `HEARTBEAT_OK` count = 0 in projects channel | 🚧 **Deploy-gated** | Agent-workspace commit `e634b7b` not yet on clawdy. See "Outstanding operator actions" below. |
| SC-5 | `no_webhook_fallbacks_total` stays at 0 across 15-min post-deploy window | ✅ **Green** | `curl http://localhost:3100/api/fleet-stats` returns `noWebhookFallbacksTotal: {}` (empty Record = zero). ~8 hours since deploy with zero fallback dispatches. |

## Outstanding operator actions (close SC-3 + SC-4)

### A — Sync 119-04 agent-workspace to clawdy (unblocks SC-4 soak) — ✅ **UNBLOCKED via `999.55` (`8b1fefe`)**

Three files need to land at `/home/clawcode/.clawcode/agents/projects/` on clawdy from local `~/.clawcode/agents/projects/` @ `e634b7b`:

- `AGENTS.md` (3 sites patched — lines 77, 116-125, 167)
- `HEARTBEAT.md` (line 33: silence contract)
- `skills/cron-poll/SKILL.md` (new file)

**Update 2026-05-14:** Backlog `999.55` landed in commit `8b1fefe` (`feat(deploy-clawdy): per-agent prompt-corpus rsync stanza`). `scripts/deploy-clawdy.sh` now ships per-agent prompt-corpus alongside the daemon binary. The next `deploy-clawdy.sh` invocation will automatically pick up `e634b7b` — no special action required for Item A beyond running a normal deploy.

Dry-run verified: 6 production agents detected (`finmentum`, `general`, `personal`, `projects`, `research`, `test-agent`); the `projects` agent's `skills/cron-poll/` (the new directory from `e634b7b`) shows up in the discovery output. When deployed, `AGENTS.md` + `HEARTBEAT.md` + `skills/cron-poll/SKILL.md` will land in place, chowned to `clawcode:clawcode`, md5-verified post-copy.

**Numbering collision footnote:** I originally drafted the prompt-corpus deploy backlog under `999.54` but admin-clawdy filed a different `999.54` (`allowed-tools-sdk-passthrough`, commit `aea1c44`) ~2 minutes before my commit landed. Renumbered to `999.55` to keep both backlog items distinct.

See `.planning/phases/999.55-deploy-clawdy-agent-workspace-prompt-corpus/BACKLOG.md` for the deploy-script extension spec (allowlist sync of prompt-corpus only — `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `skills/**`; explicit exclude of `memory/`, `state/`, telemetry, media, scripts) + the closeout note linking `8b1fefe`.

### B — Recreate existing TMUX_POLL crons (so the new prompts apply to in-flight monitors)

The projects agent has self-registered TMUX_POLL crons via scheduler IPC; their `prompt` field still embeds the legacy `IF still working: reply HEARTBEAT_OK` instruction inline. The fix in AGENTS.md/HEARTBEAT.md doesn't reach these in-memory cron prompts — they need to be removed and re-added with the new prompt template documented at `skills/cron-poll/SKILL.md` "Recreating existing monitors" section.

Operator surfaces this to the projects agent on its next interactive turn: *"Recreate your TMUX_POLL crons per skills/cron-poll/SKILL.md."* The agent owns its own scheduler entries.

### C — 24h soak (SC-4)

Once A + B complete, start the 24-hour observation window. Verification command:

```bash
ssh clawdy 'journalctl -u clawcode --since "24 hours ago" | grep -c "HEARTBEAT_OK.*projects"'
```

Expected: `0`. Append result to `119-04-VERIFICATION.md` under the "Task 3 — Soak result" template.

### D — SC-3 screenshot (operator-visual)

On the next live A2A turn, capture a Discord screenshot showing the icon transition `⏳ → 👍 → ✅` (or `❌` on terminal failure). Attach to `.planning/phases/119-a2a-delivery-reliability/sc-3-screenshot.png` or equivalent. Phase 119 ROADMAP success criteria #3 closes.

## What's *not* in scope for closeout

- **A2A-01 narration on personal/admin-clawdy** — the 2026-05-14 11:15 Discord exchange flagged in `119-04-VERIFICATION.md` (admin-clawdy narrated "webhook delivery failed → inbox-heartbeat sweep" even though bot-direct fallback is deployed). Three candidate explanations documented; operator follow-up. Does not gate phase closeout.
- **`999.53` mcp-broker hot-reload for OP_SERVICE_ACCOUNT_TOKEN rotation** — filed as backlog (`136a74b`). Not phase-119 scope.

## Deferred items

Pre-existing migration-verifier test failures from `verifier.test.ts` (Plan 999.30 era) — see `deferred-items.md`. Not Phase 119 scope.

## Net

- 4/4 plans code-complete.
- 4/4 plans deployed (119-01/02/03 code in daemon binary; 119-04 in agent-workspace local repo, sync to clawdy is item A above).
- 3/5 SCs verified live in production (SC-1, SC-5, plus SC-2 covered by unit test + deploy).
- 2/5 SCs deploy-gated for operator-visual artifact (SC-3 screenshot) or 24h soak (SC-4).

**Phase 119 status:** code-complete across all 4 plans; production-deployed for 119-01/02/03; 3 SCs live-verified (SC-1, SC-2 unit-tested, SC-5). The remaining two SCs are gated:

- **SC-3** (operator-visual screenshot) — operator captures on next live A2A turn.
- **SC-4** (24h HEARTBEAT_OK = 0 soak) — `999.55` landed in `8b1fefe`. Next `deploy-clawdy.sh` picks up `e634b7b` automatically; operator then surfaces cron-recreation directive to the `projects` agent (Item B); 24h soak window starts.

Phase 119 closes cleanly when the operator captures the SC-3 screenshot AND the SC-4 soak verification (after the next deploy + cron recreation + 24h wait) is appended to `119-04-VERIFICATION.md`.
