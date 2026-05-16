---
phase: 117
plan: 09
subsystem: discord-bridge
tags: [advisor, discord, bridge, observer-pattern, footer, reaction, single-mutation-point]
requires: [117-04]
provides: [advisor-discord-visibility, advisor-footer-seam, verbose-state-seam]
affects:
  - src/discord/reactions.ts                                  # NEW addReaction(message, emoji) helper export
  - src/discord/bridge.ts                                     # NEW per-turn listener registration + single-point response mutation; new private verboseState seam
  - src/discord/__tests__/bridge-advisor-footer.test.ts       # NEW — 12 cases (A/B/C/D/E/F/F'/G1/G2/G3 + lifecycle + agent-guard)
  - src/discord/__tests__/bridge.test.ts                      # stale fakeSessionManager mocks pre-117-04 — added advisorEvents EventEmitter
  - src/discord/__tests__/bridge-agent-messages.test.ts       # same — added advisorEvents
  - src/discord/__tests__/bridge-attachments.test.ts          # same — added advisorEvents
tech-stack:
  added:
    - node:events EventEmitter (already in use by SessionManager, now read by bridge)
  patterns:
    - Per-turn register-around-dispatch (RESEARCH §6 Pitfall 1, §13.12 A13) — closure IS the per-turn scope; listeners GC at turn end
    - Single mutation point (silent-path-bifurcation prevention) — all three delivery exits read the same `response` local
    - Decorative-outbound-hook fail-silent (matches session-adapter.ts:1422 try/catch precedent)
key-files:
  created:
    - src/discord/__tests__/bridge-advisor-footer.test.ts
  modified:
    - src/discord/reactions.ts                                # +addReaction export (Message + emoji ⇒ Promise<void>, swallows errors)
    - src/discord/bridge.ts                                   # +advisor types imports, +verboseState seam field, +per-turn listeners around dispatchStream, +single-point response mutation between editor.flush() and the delivery branches
    - src/discord/__tests__/bridge.test.ts                    # +fakeAdvisorEvents on four fakeSessionManager constructions
    - src/discord/__tests__/bridge-agent-messages.test.ts     # +fakeAdvisorEvents on fakeSessionManager
    - src/discord/__tests__/bridge-attachments.test.ts        # +fakeAdvisorEvents on fakeSessionManager
decisions:
  - Per-turn listener scope (register before dispatchStream, unregister in finally) — closure-scoped flag/result, no per-agent map needed.
  - Single mutation point at bridge.ts:809 between `editor.flush()` (793) and the `response.trim().length > 0` delivery branch (848). All three delivery exits (:853 large, :855 edit, :857 send) inherit the augmented response.
  - advisor_redacted_result intentionally falls through to the plain footer even in verbose mode — no plaintext leak (RESEARCH §13.4).
  - kind === undefined case (invoked-but-never-resulted) still shows the plain footer because the 💭 reaction already landed; consistent with the visible side-effect.
  - verboseState declared as optional private field with no constructor wiring; Plan 117-11 must add a setter or BridgeConfig field. Tests inject via `(bridge as any).verboseState = ...`.
  - Test mocks for `fakeSessionManager` were stale from before 117-04 added `advisorEvents`; added a real `EventEmitter` rather than making the bridge defensive (defensive guard would have been a Rule 2 silent-path-bifurcation anti-pattern per feedback_silent_path_bifurcation memory).
  - Standalone-runner branch (`turnDispatcher === undefined` → `streamFromAgent`) does NOT emit advisor events today; documented in code comments and accepted per RESEARCH §13.9 / §13.13 Pitfall 8.
metrics:
  duration: ~75min
  completed: 2026-05-13
  tasks: 4/4
  commits: 4 task commits (T01..T04) + this SUMMARY commit
  tests_added: 12 (all pass)
  tests_baseline_failures: 50→51 (+1 flake in src/migration/__tests__/report-writer.test.ts; passes in isolation; unrelated to bridge changes)
---

# Phase 117 Plan 09: Discord visibility — 💭 reaction + footer (level-aware seam for 117-11) Summary

**One-liner.** Bridge subscribes to `SessionManager.advisorEvents`
(117-04) around every `dispatchStream` call; an `advisor:invoked`
event fires `addReaction(message, "💭")` on the triggering user
message, and a single response-mutation point between
`editor.flush()` and the delivery branches appends a level-aware
footer (advisor_result / redacted / tool_result_error variants).
The mutation lands ONCE — all three downstream delivery exits
inherit it.

## What landed

| Task | Commit | What |
|---|---|---|
| T01 | `a23e0cd` | `addReaction(message, emoji): Promise<void>` exported from `src/discord/reactions.ts`. discord.js v14 `Message.react(unicodeEmoji)`; failures swallowed (decorative hook must not break delivery). |
| T02 | `b8c7a2a` | Per-turn listeners on `sessionManager.advisorEvents` registered BEFORE `dispatchStream` and unregistered in `finally`. Closure flag `didConsultAdvisor` + `lastAdvisorResult` are the per-turn scope. Agent-name guard (`ev.agent !== sessionName`) filters concurrent agents' events. Also added `private verboseState: { getLevel(channelId): "normal"\|"verbose" } \| undefined` seam — tests inject; Plan 117-11 will wire production. Test-mock fixes for three pre-existing test files (advisorEvents was missing from stale `fakeSessionManager`s post-117-04). |
| T03 | `4615675` | Single response mutation at `bridge.ts:809` (between `editor.flush()` and `if (response && response.trim().length > 0)`). Variant matrix: advisor_tool_result_error → `"*— advisor unavailable (<errorCode>)*"`; verbose-level + advisor_result + text → fenced `💭 advisor consulted (Opus)\n<text>` block (truncated to 500 chars + `…`); everything else → plain `"*— consulted advisor (Opus) before responding*"`. The single mutation propagates to all three delivery exits (:853 sendResponse-large, :855 edit-small, :857 sendResponse-no-placeholder). |
| T04 | `2e9fc4c` | `src/discord/__tests__/bridge-advisor-footer.test.ts` — 12 assertions covering: A (reaction + plain footer on advisor_result/normal), B (no event → no reaction/footer), C (>2000-char response still gets footer), D (advisor_tool_result_error with errorCode), E (advisor_redacted_result is plain, no plaintext leak), F (verbose seam + advisor_result → fenced block), F' (verbose advice >500 chars truncated with ellipsis), G1/G2/G3 (silent-path-bifurcation regression — footer in all three delivery exits), listener-lifecycle (zero leaks across turns), agent-guard (cross-agent events ignored). |

## Code-anchor reference

The plan was written when the file was shorter — line numbers have
drifted by ~+58 since then. For the next reader/auditor:

| Plan-cited line | Actual line (post-T03) | What |
|---|---|---|
| ~715 (listener register) | 764–765 | `advisorEvents.on("advisor:invoked", onInvoked)` + `onResulted` |
| ~739 (mutation point) | 809 | The single `if (didConsultAdvisor && response && response.trim().length > 0)` mutation block |
| ~745 (sendResponse-large exit) | 853 | `await this.sendResponse(message, response, sessionName)` for >2000-char responses |
| ~747 (edit-small exit) | 855 | `await messageRef.current.edit(response)` for the placeholder-edit path |
| ~749 (sendResponse-no-placeholder exit) | 857 | `await this.sendResponse(message, response, sessionName)` for short responses with no placeholder |

The plan's invariant ("single mutation, three exits inherit") still
holds — only the absolute line numbers shifted (the editor.flush →
delivery-branch relative anchor in the plan is what matters and is
unchanged).

## Behavior matrix (RESEARCH §13.4, §13.2, §6 Pitfall 1)

| advisor:invoked | advisor:resulted.kind | verboseState level | Result text? | Outcome |
|---|---|---|---|---|
| ✗ | — | — | — | No reaction, no footer (test B) |
| ✓ | advisor_result | normal | yes | 💭 reaction + plain footer (test A) |
| ✓ | advisor_result | normal | yes | 💭 + plain footer on >2000-char response (test C) |
| ✓ | advisor_tool_result_error | any | — | 💭 + `"*— advisor unavailable (<errorCode>)*"` (test D) |
| ✓ | advisor_redacted_result | normal | — | 💭 + plain footer; NO fenced block; NO plaintext (test E) |
| ✓ | advisor_redacted_result | verbose | — | 💭 + plain footer (deliberate; no plaintext leak even in verbose) |
| ✓ | advisor_result | verbose | yes | 💭 + fenced `💭 advisor consulted (Opus)\n<text>` block; ≤500 chars + `…` (test F, F') |
| ✓ | (undefined — invoked but never resulted) | any | — | 💭 already landed; plain footer applied because the reaction is visible side-effect |

## Self-Check: PASSED

**Files created/modified exist:**
- `src/discord/reactions.ts` — addReaction exported ✓
- `src/discord/bridge.ts` — imports + verboseState field + listener registration + mutation point ✓
- `src/discord/__tests__/bridge-advisor-footer.test.ts` — 12 tests pass ✓
- `src/discord/__tests__/bridge.test.ts`, `bridge-agent-messages.test.ts`, `bridge-attachments.test.ts` — fakeAdvisorEvents added; 47 baseline tests still green ✓

**Commits exist:**
- `a23e0cd` T01 ✓
- `b8c7a2a` T02 ✓
- `4615675` T03 ✓
- `2e9fc4c` T04 ✓

**Type-check:** `npx tsc --noEmit` clean ✓
**Test suite:** 6833 pass / 51 fail. Baseline (without 117-09): 6834 pass / 50 fail. Delta: −1 pass / +1 fail in `src/migration/__tests__/report-writer.test.ts`; that test passes in isolation = pre-existing flake, NOT caused by 117-09. New `bridge-advisor-footer.test.ts` adds 12 fresh passes (already counted in the 6833).

## Deviations from Plan

### Rule 1 — Stale test mocks (auto-fixed)

**[Rule 1 - Bug] `fakeSessionManager` in three bridge test files was stale.**
- **Found during:** T02 verification.
- **Issue:** `bridge.test.ts`, `bridge-agent-messages.test.ts`, and `bridge-attachments.test.ts` constructed a `fakeSessionManager` without `advisorEvents`. After T02 the listener registration would crash with `Cannot read properties of undefined (reading 'on')`, hit the bridge's outer `try/catch`, and react with `❌` instead of executing the dispatch. This was 19 newly failing tests at first run.
- **Fix:** Added a real `EventEmitter` as `advisorEvents` on each mock. Considered (and rejected) making the bridge defensive with `?.on` — that would have been a Rule 2 silent-path-bifurcation anti-pattern per the `feedback_silent_path_bifurcation` memory and RESEARCH §6 Pitfall 1: a future refactor that breaks the emitter would silently disable advisor visibility instead of failing loudly.
- **Files modified:** `src/discord/__tests__/bridge.test.ts`, `bridge-agent-messages.test.ts`, `bridge-attachments.test.ts`.
- **Commit:** Folded into `b8c7a2a` (T02) per the plan's testability requirement — mock updates are required to land alongside the production listener registration.

### Rule 3 — TS narrowing on closure-mutated local (auto-fixed)

**[Rule 3 - Blocking issue] TS control-flow analysis narrows `lastAdvisorResult` to `null` at the read site.**
- **Found during:** T03 typecheck.
- **Issue:** `lastAdvisorResult` is declared `let ... | null = null` and reassigned inside the `onResulted` closure. TS does not see closure-side mutation, so at the mutation point it narrows the variable type to `null` and rejects property accesses (`.kind`, `.text`, `.errorCode`).
- **Fix:** Read the variable through an explicit cast (`as { kind: ...; text?: string; errorCode?: string } | null`) into a local. No runtime behavior change — purely a TS narrowing workaround. Commented inline.
- **Commit:** Folded into `4615675` (T03).

### Rule 4 (none) — no architectural surprises.

## Known Stubs

| File | Line | What | Resolution |
|---|---|---|---|
| `src/discord/bridge.ts` | 200 | `private verboseState: { getLevel(...): "normal"\|"verbose" } \| undefined;` declared on the bridge with no constructor field, no setter, and no DI wiring. Field is `undefined` in production today, so the verbose branch of the response mutation (the fenced advice block) is dead code in production. | **Plan 117-11** must add a wiring path: one of (a) `setVerboseState(vs: VerboseState)` setter mirroring `setWebhookManager`, (b) `verboseState?: VerboseState` field on `BridgeConfig` with constructor assignment, or (c) hot-reload via chokidar. The decision is 117-11's. Tests in 117-09 inject the stub via `(bridge as any).verboseState = ...` and cover the fenced-block code path. |

## Handoff to Plan 117-11

- Add the `verboseState` wiring (constructor field or setter — see Known Stubs).
- Implement the real `VerboseState` class with `getLevel(channelId): "normal" | "verbose"` (SQLite-backed per RESEARCH §13.2).
- Add the `/verbose` slash command + handler.
- 117-09's mutation already handles the `verbose` branch (fenced advice block, ≤500 chars + ellipsis); 117-11 only needs to make the seam non-undefined for channels the operator has toggled.

## Reference

- `.planning/phases/117-claude-code-advisor-pattern-multi-backend-scaffold-anthropic/117-CONTEXT.md` (`<decisions>.Discord visibility` LOCKED)
- `.planning/phases/117-claude-code-advisor-pattern-multi-backend-scaffold-anthropic/117-RESEARCH.md` (§2 Gate 3; §4.5, §4.6; §6 Pitfall 1; §13.2, §13.4, §13.9, §13.13 Pitfall 8)
- `.planning/phases/117-claude-code-advisor-pattern-multi-backend-scaffold-anthropic/117-04-SUMMARY.md` (advisorEvents emitter shipped + event shape)
- `src/manager/persistent-session-handle.ts:719..771` — production emit sites for `advisor:invoked` / `advisor:resulted` (agent: `advisorObserver.agentName`)
- `src/advisor/types.ts:70..100` — event payload types (`AdvisorInvokedEvent`, `AdvisorResultedEvent`)
