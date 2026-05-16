---
phase: 122
plan: 01
subsystem: discord-transport
tags: [discord, wrap, table, regression-sentinel]
requirements: [DISC-01]
key-files:
  created:
    - src/discord/__tests__/122-universal-wrap-coverage.test.ts
    - .planning/phases/122-discord-table-auto-wrap-universalization/122-DEVIATION.md
  modified:
    - src/discord/markdown-table-wrap.ts
    - src/discord/webhook-manager.ts
    - src/discord/bridge.ts
    - src/manager/daemon.ts
    - src/discord/__tests__/markdown-table-wrap.test.ts
    - src/discord/__tests__/webhook-manager.test.ts
decisions:
  - SC-3 forces minimal helper extension; D-02 lock overridden under D-03 (DEVIATION.md)
  - Inline BotDirectSender impl (daemon.ts) IS the chokepoint — 999.12 mirror and 119 A2A-01 inherit
  - Static-grep sentinel anchors per-method, not per-call-site
metrics:
  duration_minutes: ~10
  completed: 2026-05-14
---

# Phase 122 Plan 01: Universal Discord Table Wrap Summary

**One-liner:** Plugged four `wrapMarkdownTablesInCodeFence` bypass gaps at the Discord transport boundary (sendAsAgent embed, bridge.sendDirect fallback, inline BotDirectSender sendText + sendEmbed) and extended the helper to escalate outer fence length when a cell contains a nested triple-backtick run (SC-3). Static-grep sentinel pins every chokepoint by method anchor.

## Commits

| Task | SHA | Message |
|------|-----|---------|
| Plan/Deviation | `f44f4f6` | docs(122-01): PLAN + DEVIATION for universal table wrap |
| T-01 RED | `209745f` | test(122-01): MTW-11 RED — nested-fence escalation pinned (SC-3) |
| T-01 GREEN | `76f2d6f` | feat(122-01): wrapMarkdownTablesInCodeFence escalates outer fence for nested backticks (SC-3) |
| T-02 | `ba549e4` | feat(122-01): wrap embed.description in WebhookManager.sendAsAgent (single chokepoint) |
| T-03 | `bd9cee0` | feat(122-01): wrap channel.send fallback in bridge.sendDirect |
| T-04 | `285c392` | feat(122-01): wrap content + embed.description in inline BotDirectSender (daemon.ts) |
| T-05 | `8012c2e` | test(122-01): static-grep regression sentinel for universal wrap coverage |

## Tests Added / Extended

- **MTW-11** (`src/discord/__tests__/markdown-table-wrap.test.ts`) — SC-3 nested-backtick escalation. RED-then-GREEN.
- **WHM-WRAP-EMBED-1/2/3** (`src/discord/__tests__/webhook-manager.test.ts`) — sendAsAgent description-wrap, empty-description noop, prose-pass-through.
- **UWC-1..11** (`src/discord/__tests__/122-universal-wrap-coverage.test.ts`) — static-grep regression sentinel (universal-wiring SC-1).

### Final test run

```
npx vitest run src/discord/__tests__/markdown-table-wrap.test.ts \
              src/discord/__tests__/webhook-manager.test.ts \
              src/discord/__tests__/122-universal-wrap-coverage.test.ts
```

```
 Test Files  3 passed (3)
      Tests  36 passed (36)
   Start at  02:58:50
   Duration  310ms
```

## Deviations from Plan

### [Rule 2 — SC-3 helper extension under D-03 override]
The dictated plan assumed `wrapMarkdownTablesInCodeFence` already handled SC-3. It did not — the helper hardcoded a 3-backtick `` ```text `` fence. CONTEXT D-03 explicitly authorizes extending the helper for SC-3. Extension is minimal: scan the collected table block for the longest run of consecutive backticks, set `outerFenceLen = max(longestRun + 1, 3)`. Detection regexes and pre-fenced pass-through behavior are unchanged. Idempotency preserved (verified by MTW-10 still passing + MTW-11's own idempotency assertion). Full rationale in `122-DEVIATION.md`.

### [Rule 2 — bridge.ts sendDirect fallback was a 5th gap]
Not in operator-dictated plan. `bridge.ts:1280, 1287` `sendDirect` falls back to `channel.send(response)` when no webhook is resolved — bypassed the wrap entirely. Surfaced by orientation read of `webhook-manager.ts:88` (already wrapping) which prompted a wider grep for other untreated send sites. Added T-03 to close it. Sentinel UWC-5 pins it.

### [Rule 2 — Plan terminology fix: BotDirectSender is a type, not a class]
The dictated plan said "wrap at `BotDirectSender.sendText`." `BotDirectSender` is a `type` (`restart-greeting.ts:95`) and the single concrete implementation is an inline object literal at `daemon.ts:7239-7281`. The wrap was inserted there (T-04). Inheritance for Phase 119 A2A-01 (`daemon-post-to-agent-ipc.ts:220`) and 999.12 mirror (`daemon-ask-agent-ipc.ts:286`) is preserved — both still call `botDirectSender.sendText(channelId, ...)` unchanged. UWC-10 + UWC-11 pin the thin-caller shape so future drift triggers the sentinel.

### [Rule 3 — fixed sendMock reset in new webhook-manager test block]
Pre-existing tests use `sendMock.mockClear()` and rely on the module-level default `.mockResolvedValue({ id: "msg-id" })`. The new `Phase 122` describe block needed `mockReset()` + re-applied `mockResolvedValue` because some earlier failure paths leave the mock in a rejecting state across describe boundaries. Two-line fix in the new `beforeEach`.

## Auth gates / human-action

None.

## Threat surface scan

No new network endpoints, auth paths, file access patterns, or schema changes. Wrap is purely formatting at the transport boundary.

## Inheritance verification (Phase 119 link)

Phase 119's `daemon-post-to-agent-ipc.ts:220` bot-direct rung calls `deps.botDirectSender.sendText(channelId, message)`. `deps.botDirectSender` is wired by `daemon.ts:8214-8220` to a closure over `botDirectSenderRef.current`, which is the inline `botDirectImpl` from `daemon.ts:7239-7281` — the very impl now wrapping `content`. **Phase 119 bot-direct messages from this commit forward will be table-wrapped automatically.** UWC-8 + UWC-11 together prove this structurally: the daemon.ts impl wraps; the call site is a thin pass-through that imports no wrap helper of its own.

## Deferred / open verification

- **SC-2 — operator screenshots across 4 channels (webhook / bot-direct / cron / subagent-relay):** `BLOCKED-deploy-pending`. Ramy active in `#fin-acquisition` per `feedback_ramy_active_no_deploy`. Local code is ready; deploy window required to capture screenshots.
- **`bridge.sendDirect` unit test:** the method is `private` and the existing `bridge.test.ts` does not exercise it directly. T-05 static-grep sentinel UWC-5 covers wire presence; deeper behavioral coverage deferred (would require constructor-mocking the bridge, which existing test infra does not set up for sendDirect).

## Pre-existing test failures (NOT introduced by this plan)

`npx vitest run src/discord` reports 19 failing tests across:
- `slash-commands-gsd-nested.test.ts` (count mismatches — `expected 19 to be …`)
- `slash-commands-gsd-register.test.ts` (subcommand counts)
- `slash-commands-status-*.test.ts`
- `slash-commands-sync-status.test.ts`
- `slash-commands.test.ts` (expected 24 to be 25)

Out of scope per executor protocol; documented here so future verifier does not attribute them to Phase 122.

## TDD Gate Compliance

- RED commit: `209745f` (test only — MTW-11 failing).
- GREEN commit: `76f2d6f` (helper minimal extension; all 11 tests pass).
- REFACTOR: none required.

## Self-Check

- File `src/discord/markdown-table-wrap.ts` modified — `git log --oneline 76f2d6f -1` → present. **FOUND**
- File `src/discord/webhook-manager.ts` modified — present in `ba549e4`. **FOUND**
- File `src/discord/bridge.ts` modified — present in `bd9cee0`. **FOUND**
- File `src/manager/daemon.ts` modified — present in `285c392`. **FOUND**
- File `src/discord/__tests__/122-universal-wrap-coverage.test.ts` created — `8012c2e`. **FOUND**
- File `.planning/phases/122-discord-table-auto-wrap-universalization/122-DEVIATION.md` created — `f44f4f6`. **FOUND**
- Final test run 36/36 passing. **VERIFIED**

## Self-Check: PASSED
