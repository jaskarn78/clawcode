# Phase 122 — Discord Table Auto-Wrap Universalization — Phase Summary

**Status:** Code-complete (1 plan + 1 sanctioned deviation); merged to master; deploy held per `feedback_ramy_active_no_deploy`. SC-2 operator-screenshot verification gated on next deploy window.
**Phase window:** 2026-05-14.

## Plans

| Plan | Subject | Commits | Status |
|------|---------|---------|--------|
| 122-01 | Approach A: single chokepoint wrap at `WebhookManager.send` + `.sendAsAgent` + `BotDirectSender.sendText` + `bridge.sendDirect` + `daemon.ts` BotDirectSender inline impl + embed `description` body | `209745f` (RED) `76f2d6f` `ba549e4` `bd9cee0` `285c392` `8012c2e` | Merged; 36/36 tests green |
| Deviation | `wrapMarkdownTablesInCodeFence` extended to compute outer-fence length dynamically (`max(longestBacktickRun + 1, 3)`) for nested-fence cells | `76f2d6f` | Sanctioned by CONTEXT D-03; documented in `122-DEVIATION.md` |

## Success Criteria — verification status

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | Static-grep regression test enumerates ALL known send sites + each routes through wrap | ✅ **Green** | `122-universal-wrap-coverage.test.ts` UWC-1..11 all green; pins WebhookManager, BotDirectSender, bridge.sendDirect, daemon BotDirectSender inline, Phase 119 fallback, cron `triggerDeliveryFn`, embed.description |
| SC-2 | 4-column table fixture renders legibly across 4 channels (webhook / bot-direct / cron / subagent-relay) | ⏳ **Deploy-gated** | Local code complete; operator captures screenshots across 4 paths post-deploy |
| SC-3 | Nested triple-backtick cells wrap with longer outer fence | ✅ **Green** | Deviation shipped; helper computes fence length dynamically; idempotency preserved |
| SC-4 | Helper itself unchanged where possible (extension limited to SC-3 requirement) | ✅ **Sanctioned deviation** | Only fence-length computation changed; detection/idempotency/pass-through unchanged; documented in `122-DEVIATION.md` per D-03 override authority |

## Phase 119 inheritance verification

Phase 119's bot-direct fallback at `daemon-post-to-agent-ipc.ts:220` routes through `deps.botDirectSender.sendText` → daemon.ts inline `botDirectImpl` (lines 7239-7281) which now wraps `content` before send. **All Phase 119 bot-direct A2A messages inherit the wrap automatically** — structurally proven by UWC-8 + UWC-11 sentinels.

## Outstanding operator actions

1. **Deploy clearance + 4-channel screenshots (SC-2)** — on next deploy, send the canonical 4-column fixture from `.planning/phases/122-discord-table-auto-wrap-universalization/__fixtures__/` (if exists, else inline from test) through:
   - Webhook path (regular agent reply)
   - Bot-direct path (Phase 119 fallback when webhook is 401)
   - Cron `triggerDeliveryFn` path (scheduled delivery)
   - Subagent-relay path (subagent thread auto-relay)
   Each should render the table fenced in monospace, not as raw markdown.

## Anti-pattern compliance

Per `feedback_silent_path_bifurcation.md`: wrap lives at the transport boundary (single chokepoint), not at per-site callers. The static-grep regression test (SC-1) is the long-term sentinel against future bypass commits.

## Deferred / out-of-scope

- 19 pre-existing test failures in `slash-commands-*.test.ts` and siblings — documented in plan summary; not introduced by this phase, out of scope per executor protocol.
- `bridge.sendDirect` deeper behavioral coverage — method is `private`, T-05 static-grep sentinel UWC-5 covers wire presence; behavioral test deferred.

## Net

- 1 plan + 1 sanctioned deviation, all merged.
- 3/4 SCs closed locally; 1 deploy-gated (operator-visual screenshots).
- TDD gate compliance (RED → GREEN → no REFACTOR needed).

Phase 122 closes cleanly when SC-2 operator screenshots are captured post-deploy and attached to a verification artifact.
