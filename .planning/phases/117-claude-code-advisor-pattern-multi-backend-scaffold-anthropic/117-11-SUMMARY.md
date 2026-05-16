---
phase: 117
plan: 11
subsystem: discord-slash + advisor-visibility
tags: [verbose, slash-command, sqlite, discord, advisor]
requires: [117-09]
provides:
  - VerboseState SQLite-backed channel-level state (manager/verbose-state.db)
  - /clawcode-verbose Discord slash command (admin-only, ephemeral, on|off|status)
  - set-verbose-level IPC method (closure-intercept in daemon)
  - Bridge mutation point consuming VerboseState.getLevel() — fenced advice block when verbose
affects:
  - src/usage/verbose-state.ts (NEW)
  - src/usage/__tests__/verbose-state.test.ts (NEW)
  - src/discord/slash-types.ts (clawcode-verbose CONTROL_COMMANDS entry)
  - src/discord/slash-commands.ts (handleVerboseSlash + dispatch branch)
  - src/discord/bridge.ts (BridgeConfig.verboseState + constructor wire-up)
  - src/manager/daemon.ts (boot construction + closure-intercept IPC handler)
  - src/ipc/protocol.ts (IPC_METHODS adds "set-verbose-level")
  - src/discord/__tests__/slash-verbose-command.test.ts (NEW)
  - src/discord/__tests__/slash-types.test.ts (CONTROL_COMMANDS length + validMethods)
  - src/ipc/__tests__/protocol.test.ts (IPC_METHODS parity)
key-files:
  created:
    - src/usage/verbose-state.ts
    - src/usage/__tests__/verbose-state.test.ts
    - src/discord/__tests__/slash-verbose-command.test.ts
  modified:
    - src/discord/slash-types.ts
    - src/discord/slash-commands.ts
    - src/discord/bridge.ts
    - src/manager/daemon.ts
    - src/ipc/protocol.ts
    - src/ipc/__tests__/protocol.test.ts
    - src/discord/__tests__/slash-types.test.ts
decisions:
  - VerboseState lives in its own SQLite file ~/.clawcode/manager/verbose-state.db (NOT co-located with advisor-budget.db) per RESEARCH §4.1 + §6 Pitfall 4 + §7 Q2.
  - BridgeConfig.verboseState is OPTIONAL (not required) so the existing structural-stub injection in bridge-advisor-footer.test.ts Case F/F' keeps working without a 4-file test rewrite.
  - daemon IPC handler is wired via the closure-intercept-BEFORE-routeMethod pattern (mirroring secrets-status / broker-status) — keeps the already-24-arg routeMethod signature stable.
  - handleVerboseSlash extracted as a pure exported function (mirroring handleInterruptSlash / handleSteerSlash) — testable without mocking ChatInputCommandInteraction.
  - handleControlCommand uses interaction.editReply (not interaction.reply) — the deferReply({ephemeral:true}) at the top of handleControlCommand already established ephemeral-ness; a second reply would throw InteractionAlreadyReplied.
  - Choice label says "on (inline advisor advice)" (not "Q+A") per RESEARCH §13.2 correction — the executor never passes a question; server_tool_use.input is always {}.
  - defaultMemberPermissions: "0" — admin-only operator-scope per RESEARCH §7 Q3 + Phase 100 admin precedent.
metrics:
  duration: 28min
  completed: 2026-05-13
  tasks-executed: 7
  files-created: 3
  files-modified: 7
  tests-added: 11 (6 VerboseState CRUD + 5 handleVerboseSlash)
  commits: 7
---

# Phase 117 Plan 117-11: `/verbose` operator Discord toggle Summary

**One-liner:** SQLite-backed per-channel verbose-level state + `/clawcode-verbose on|off|status` admin-only slash command wires into the 117-09 bridge mutation point — `verbose` mode replaces the plain advisor footer with a fenced advice block (≤500 chars).

## What was built

Plan 117-11 lands the operator-facing visibility lever for the 117-09 advisor-visibility seam. The 117-09 plan seeded a `verboseState?: { getLevel: ... } | undefined` placeholder in `bridge.ts:200` and a single mutation point at `bridge.ts:809` that branched on `level === "verbose" && variant === "advisor_result"`. 117-11 attaches a real `VerboseState` instance to that seam, persists per-channel level in a separate SQLite file, and surfaces the toggle as `/clawcode-verbose` in the Discord operator menu.

The mutation point and footer wording from 117-09 are unchanged — 117-11 only wires the level lookup to a real state store.

## Tasks executed

| Task | Type    | Commit  | Files                                                                                                              | Tests Added |
| ---- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------ | ----------- |
| T01  | feat    | 1e5027f | src/usage/verbose-state.ts                                                                                         | 0           |
| T02  | test    | f2fda24 | src/usage/__tests__/verbose-state.test.ts                                                                          | 6           |
| T03  | feat    | ad4ac8e | src/discord/slash-types.ts                                                                                         | 0           |
| T04  | feat    | e318ee8 | src/discord/slash-commands.ts                                                                                      | 0           |
| T05  | feat    | b13a6f2 | src/ipc/protocol.ts, src/ipc/__tests__/protocol.test.ts, src/manager/daemon.ts                                     | 0           |
| T06  | feat    | 1e291f4 | src/discord/bridge.ts, src/manager/daemon.ts, src/discord/__tests__/slash-types.test.ts, deferred-items.md         | 0           |
| T07  | test    | 7c2d1c7 | src/discord/__tests__/slash-verbose-command.test.ts                                                                | 5           |

All 7 atomic commits land in order on master. No checkpoint pauses — fully autonomous run.

## Test pass count delta

Measured against `src/discord src/usage src/ipc`:

|              | Pre-117-11 | Post-117-11 | Delta |
| ------------ | ---------- | ----------- | ----- |
| Tests passed | 776        | 787         | +11   |
| Tests failed | 19         | 19          | 0     |
| Tests skipped| 7          | 7           | 0     |

Net delta: **+11 passing tests, 0 new failures**. The 11 additions are exactly the 6 VerboseState CRUD assertions (T02) + 5 handleVerboseSlash assertions (T07). All 19 pre-existing failures are unrelated to the advisor/verbose surface and pre-date 117-11 (GSD nested register tests, status-model parity, sync-status — see deferred-items.md). Plan-target tests (verbose-state.test.ts and slash-verbose-command.test.ts) and the 117-09 bridge-advisor-footer.test.ts (12 cases, including F/F' verbose seam) all remain green.

## Critical correctness gates — confirmation

- **Separate SQLite file:** `manager/verbose-state.db` constructed at daemon boot (`src/manager/daemon.ts:~2706`), NOT co-located with `advisor-budget.db`. Verified by `grep verbose-state.db src/manager/daemon.ts` — 1 hit, owns its own `new Database(...)` call.
- **Single mutation point preserved:** `bridge.ts` contains exactly ONE `this.verboseState?.getLevel(` call at `:817` (one line after the 117-09 seam comment). No fallback mutation in `sendResponse`, no second branch. Silent-path-bifurcation regression prevention from 117-09's Case G1/G2/G3 tests stays in effect — all 3 delivery exits read the same augmented `response`.
- **Advice-only display:** verbose mode shows the truncated advice text (≤500 chars) only; no question rendered. RESEARCH §13.2 confirmed at code site `bridge.ts:836` — there is no advisor question in scope (the AdvisorResultedEvent carries `text` only, not a Q+A pair). `advisor_redacted_result` intentionally falls through to the plain footer (no plaintext leak — Case E test).
- **defaultMemberPermissions: "0":** Set in `slash-types.ts` CONTROL_COMMANDS entry. Admin-only — hides the command from non-admin members in the Discord slash menu (Phase 100 admin precedent + RESEARCH §7 Q3).
- **All replies ephemeral:** Inherited via `interaction.deferReply({ephemeral: true})` at `handleControlCommand:4017`. handleVerboseSlash returns a plain string; the caller wraps in `interaction.editReply(...)` which keeps the ephemeral context. T07 Case E guards against future regression.
- **No new mutation point in bridge.ts:** 117-09's `:809` branch is the single seam — 117-11 only swapped the placeholder `verboseState` field type and added constructor injection. No `bridge.ts:809`-area logic changed.
- **Footer wording unchanged for normal mode:** `*— consulted advisor (Opus) before responding*` and `*— advisor unavailable (<errorCode>)*` are owned by 117-09 — untouched by 117-11.
- **Bridge constructor stays back-compat:** `BridgeConfig.verboseState` is OPTIONAL — existing tests (bridge.test.ts, bridge-agent-messages.test.ts, bridge-attachments.test.ts) that omit it continue to typecheck and pass without modification. The 12-case bridge-advisor-footer.test.ts suite (which uses `as any` structural-stub injection) is also untouched.

## Deviations from plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Validate `level` string in IPC handler**

- **Found during:** T05 — implementing `case "set-verbose-level"`
- **Issue:** The plan T05 snippet only handled `"status"` and `"on"`/`else "normal"`. Invalid level strings (e.g., a typo from a malicious caller or a future shim version drift) would silently coerce to `"normal"` without surfacing an error.
- **Fix:** Added explicit `if (level !== "on" && level !== "off") throw ManagerError(...)` guard before the `level === "on" ? "verbose" : "normal"` coercion. Surfaces the typo as a JSON-RPC error → caller (handleVerboseSlash) renders "verbose: invalid verbose level '<typo>' — expected on | off | status".
- **Files modified:** `src/manager/daemon.ts` (closure-intercept case branch)
- **Commit:** b13a6f2

**2. [Rule 3 - Blocking issue] slash-types.test.ts CONTROL_COMMANDS length comment was off-by-one pre-117-11**

- **Found during:** T06 — running full Discord test suite after constructor wire-up
- **Issue:** `slash-types.test.ts:163` asserted `expect(CONTROL_COMMANDS).toHaveLength(12)` but the actual pre-117-11 runtime length was 10 (the 999.32 historical comment chain decremented from 13 to 12 in the COMMENT but never updated the runtime check). Adding /clawcode-verbose would have left the test failing.
- **Fix:** Updated the test assertion to `toHaveLength(11)` (the real post-117-11 runtime count) + added a comment documenting the historical off-by-one. The wider drift in `slash-commands.test.ts:487` (sum = 25 expected but 24 actual post-117-11) is pre-existing and logged to deferred-items.md.
- **Files modified:** `src/discord/__tests__/slash-types.test.ts`, `.planning/phases/117-.../deferred-items.md`
- **Commit:** 1e291f4

No other deviations. T01–T07 executed exactly as planned otherwise.

## Verification

- `npm run typecheck` (npx tsc --noEmit) — clean after every task.
- `npx vitest run src/usage/__tests__/verbose-state.test.ts` — 6/6 pass.
- `npx vitest run src/discord/__tests__/slash-verbose-command.test.ts` — 5/5 pass.
- `npx vitest run src/discord/__tests__/bridge-advisor-footer.test.ts` (117-09 regression) — 12/12 pass.
- `npx vitest run src/ipc` — 72/72 pass.
- Full Discord/usage/ipc suite: 787 passed, 19 pre-existing failures (no regressions).

## Out of scope (intentionally not done)

- Per-agent verbose state — CONTEXT.md `<deferred>`; channel-level only in 117.
- `lastAdvisorResult` history beyond the current turn — RESEARCH §13.12 A13 (closure-scoped, garbage-collected at turn end).
- Production deployment — operator-gated per CLAUDE.md feedback memories (`feedback_no_auto_deploy` + `feedback_ramy_active_no_deploy`).
- Slash-command guild-level smoke test (Plan 117-10's responsibility).
- Touching IPC handlers from 117-07 territory (ask-advisor flow).
- Touching capability manifest from 117-08 territory.

## Self-Check: PASSED

- src/usage/verbose-state.ts: FOUND
- src/usage/__tests__/verbose-state.test.ts: FOUND
- src/discord/__tests__/slash-verbose-command.test.ts: FOUND
- Commit 1e5027f (T01): FOUND
- Commit f2fda24 (T02): FOUND
- Commit ad4ac8e (T03): FOUND
- Commit e318ee8 (T04): FOUND
- Commit b13a6f2 (T05): FOUND
- Commit 1e291f4 (T06): FOUND
- Commit 7c2d1c7 (T07): FOUND
