---
phase: 260429-ouw-webhook-path-table-wrap-regression
plan: 01
subsystem: discord
tags: [webhook, markdown, discord.js, vitest, regression]

# Dependency graph
requires:
  - phase: 100-fu-discord-formatting-fixes
    provides: wrapMarkdownTablesInCodeFence pure idempotent helper + bot-side wiring
provides:
  - Webhook send path now wraps raw markdown tables in ```text``` code fences before chunking
  - Regression test (5 cases) locking webhookManager.send wrap behavior
  - Three downstream callers (bridge.ts:917 sendDirect fallback, daemon.ts:3544, usage/daily-summary.ts:111) inherit the fix without modification
affects:
  - Any future webhook-bearing agent path (Admin Clawdy, ClawdyV2, all webhook-display-named agents)
  - Daily-summary cron output (was the most likely operator-screenshot culprit)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-point wrap: pure idempotent transform applied at the OUTPUT BOUNDARY (webhookManager.send) rather than threaded through every caller"
    - "vi.mock with class-shaped factory for discord.js WebhookClient (constructable in vitest)"

key-files:
  created:
    - src/discord/__tests__/webhook-manager.test.ts
  modified:
    - src/discord/webhook-manager.ts

key-decisions:
  - "Wrap inside webhookManager.send instead of patching the three callers individually — pure + idempotent helper makes single-point fix safe and closes the gap permanently"
  - "Did NOT modify sendAsAgent (it ships EmbedBuilder, not raw markdown) — out of scope, embeds render their own structure"
  - "Class-based vi.mock factory for discord.js WebhookClient (vi.fn().mockImplementation cannot be called with `new` in vitest 4.x)"

patterns-established:
  - "Output-boundary wrap pattern: when N callers feed one delivery sink, transform inside the sink — idempotency makes it safe regardless of caller behavior"

requirements-completed: [WEBHOOK-WRAP-01]

# Metrics
duration: 9min
completed: 2026-04-29
---

# Phase 260429-ouw Plan 01: Webhook Path Table-Wrap Regression Summary

**webhookManager.send now wraps raw markdown tables in ```text``` code fences before chunking — closes the Phase 100-fu gap that left bridge.ts:917 sendDirect fallback, daemon.ts:3544, and usage/daily-summary.ts:111 emitting raw `| col | col |` rows that rendered as literal pipes in Discord.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-29T17:50:42Z (approx — plan load)
- **Completed:** 2026-04-29T17:59:25Z (deploy verified)
- **Tasks:** 1 auto (TDD RED+GREEN) + 1 deploy task (Task 2 partially complete — Discord visual confirm deferred to operator)
- **Files modified:** 2 (1 created, 1 modified)
- **Commits:** 2 source + 1 metadata (this commit)

## Accomplishments

- Single-point fix at the webhook output boundary — wrapMarkdownTablesInCodeFence runs inside send() before splitMessage chunking
- All three downstream webhook callers inherit the wrap automatically; zero churn at call sites
- 5-test regression suite (WHM-WRAP-1..5) pinning: wrap, idempotency, prose pass-through, chunking + identity preservation, no-webhook error
- Local build green (tsup, 357ms), prod build green (tsup, 153ms)
- Prod daemon restarted cleanly (pid 3263059, active running, 0 errors from new pid in journal)

## Task Commits

1. **Task 1 RED — failing regression test for webhookManager.send wrap** — `d454e7b` (test)
2. **Task 1 GREEN — wrap markdown tables in code fences inside webhookManager.send** — `696bc39` (fix)

**Plan metadata:** _(this commit, after summary write)_

## Files Created/Modified

- `src/discord/__tests__/webhook-manager.test.ts` — created. 5 vitest cases mocking discord.js WebhookClient via class factory; asserts wrap, idempotency, prose pass-through, chunking + identity, and the no-webhook error path.
- `src/discord/webhook-manager.ts` — modified. Added `import { wrapMarkdownTablesInCodeFence } from "./markdown-table-wrap.js"` and inserted `const wrapped = wrapMarkdownTablesInCodeFence(content)` before chunking inside `send()`. sendAsAgent untouched (embeds out of scope).

## Decisions Made

- **Single-point wrap over per-caller threading.** Pure idempotent helper makes the boundary fix safe — already-wrapped content is a no-op, callers that intentionally pre-fence stay correct, callers that send prose are byte-stable.
- **Skipped `sendAsAgent`.** That path ships an `EmbedBuilder`, not raw markdown content; embeds render their own structure and have no markdown-table failure mode.
- **Class-shaped vi.mock factory.** Initial `vi.fn().mockImplementation()` mock failed under `new WebhookClient(...)` (vitest 4.x). Switched to `class MockWebhookClient { send = sendMock; ... }` which is constructable. Pattern noted for future discord.js mocks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Mock factory shape adjusted to class form**
- **Found during:** Task 1 RED test run
- **Issue:** Plan recommended `vi.fn().mockImplementation(() => ({ send, destroy }))`. Under vitest 4.1.3 this throws `TypeError: ... is not a constructor` when `new WebhookClient({ url })` runs.
- **Fix:** Replaced with `class MockWebhookClient { constructor(_opts) {} send = sendMock; destroy = destroyMock; }` returned from the `vi.mock` factory.
- **Files modified:** src/discord/__tests__/webhook-manager.test.ts
- **Verification:** RED produced the expected single-test failure (WHM-WRAP-1) with all four other tests passing on master, confirming the mock works AND the wrap gap exists.
- **Committed in:** d454e7b (RED commit)

**2. [Rule 3 — Blocking] Server git pull blocked by local ROADMAP.md drift**
- **Found during:** Task 2 deploy
- **Issue:** Prod /opt/clawcode had uncommitted local mods to `.planning/ROADMAP.md` plus untracked yaml backups. Plan called for `sudo -u clawcode git pull`, but the directory is `jjagpal:clawcode`-owned (not clawcode-owned), so pull runs as jjagpal directly.
- **Fix:** `git stash push -m "auto-stash-260429-ouw-deploy"` then `git pull` as jjagpal. Stash retained on prod for operator review.
- **Files modified:** none (prod-side only; stash not applied back)
- **Verification:** Prod HEAD now at `696bc39`, clean working tree.
- **Committed in:** n/a (server-side state operation)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking)
**Impact on plan:** Zero scope creep. Mock-shape fix is one-line. Stash is a deploy hygiene step the plan should bake in for future quick-task deploys against the prod workspace.

## Issues Encountered

- None functional. Mock-constructor issue caught at first test run; deploy git-stash issue caught at first pull attempt; both resolved inline.

## Test Results

- `npx vitest run src/discord/__tests__/webhook-manager.test.ts src/discord/__tests__/markdown-table-wrap.test.ts` — **15 passed (15)** in 400ms.
- `npm run build` (local) — **success** in 357ms, zero TypeScript errors.
- `npm run build` (prod) — **success** in 153ms, zero TypeScript errors.

## Production Deploy

- Push: `0278e6f..696bc39 master -> master` (origin)
- Prod pull: `0278e6f..696bc39` after stashing local ROADMAP drift
- Prod build: `dist/cli/index.js 1.92 MB` rebuilt
- Drain: `clawcode stop-all` → "All agents stopped"
- Restart: `systemctl restart clawcode` → active running (pid 3263059, 35s uptime at status check)
- Log scan: zero error/fail/fatal lines from new pid since boot

## Manual Verification Deferred (operator)

Per plan Task 2 / quick-task constraints:

> Operator verifies in Discord — ask Admin Clawdy to produce a markdown table (e.g. "show me a table of agent names and their models"). Confirm the response renders as a monospace code block with aligned pipes (NOT raw `| col | col |` text). Optional spot-check: trigger or wait for daily-summary cron and confirm any tables are fenced.

This is the only outstanding item. Per execution constraints it is **non-blocking** — the wrap is unit-test pinned and the daemon is live with the fix.

## Next Phase Readiness

- Webhook table-wrap regression closed at the boundary; future webhook callers added downstream of `webhookManager.send` inherit the fix automatically.
- Stash on prod (`auto-stash-260429-ouw-deploy`) should be reviewed by operator and either restored or dropped.
- No follow-up phase required.

## Self-Check: PASSED

- File `src/discord/__tests__/webhook-manager.test.ts` — FOUND
- File `src/discord/webhook-manager.ts` — FOUND (modified)
- Commit `d454e7b` (RED test) — FOUND in git log
- Commit `696bc39` (GREEN fix) — FOUND in git log + pushed to origin/master + pulled to prod
- Prod daemon — `systemctl is-active clawcode` returns `active`
- Vitest — 15/15 green across webhook-manager + markdown-table-wrap suites

---
*Quick task: 260429-ouw-webhook-path-table-wrap-regression-add-w*
*Completed: 2026-04-29*
