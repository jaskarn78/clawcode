---
phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow
plan: 02
subsystem: session-adapter
tags: [session-adapter, settingSources, gsd, projectDir, claude-agent-sdk, baseOptions, createSession, resumeSession, symmetric-edits]

# Dependency graph
requires:
  - phase: 100
    plan: 01
    provides: "ResolvedAgentConfig.settingSources (always populated, default ['project']) + ResolvedAgentConfig.gsd?.projectDir (undefined when unset)"
  - phase: 73
    provides: "createPersistentSessionHandle baseOptions threading pattern — Plan 02's two-line edit per call site sits inside the existing baseOptions literal"
  - phase: 53
    provides: "buildSessionConfig mapper at session-config.ts:712 — Plan 02 extends the return literal with spread-conditional propagation matching the existing mutableSuffix pattern"
provides:
  - "AgentSessionConfig.settingSources?: readonly ('project'|'user'|'local')[] (additive-optional)"
  - "AgentSessionConfig.gsd?: { readonly projectDir: string } (additive-optional)"
  - "session-adapter.createSession baseOptions reads cwd + settingSources from config (lines 588/592)"
  - "session-adapter.resumeSession baseOptions reads cwd + settingSources from config (lines 627/631 — symmetric with create)"
  - "buildSessionConfig threads settingSources + gsd from ResolvedAgentConfig → AgentSessionConfig verbatim"
  - "10-test SA1..SA10 regression suite pinning the post-Plan-02 SDK contract"
affects:
  - "Plan 100-03 (differ): can now classify settingSources + gsd.projectDir field paths against RELOADABLE / NON_RELOADABLE — already shipped in commit 42751b4"
  - "Plan 100-04 (slash dispatcher): subagent-thread-spawner inherits the fields verbatim via ...parentConfig spread at line 211 — no additional plumbing"
  - "Plan 100-05 (subagent-thread-spawner): same — additive-optional propagation works as designed"
  - "Plan 100-07 (clawcode.yaml fixture): Admin Clawdy entry sets settingSources: ['project','user'] + gsd.projectDir to drive GSD workflows"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Symmetric-edits between createSession and resumeSession (Rule 3) — RESEARCH.md Pitfall ordering pin enforced"
    - "Spread-conditional field propagation matching the existing mutableSuffix pattern at session-adapter.ts:594 + buildSessionConfig:718 — preserves byte-stable deep-equality in regression tests"
    - "vi.mock @anthropic-ai/claude-agent-sdk at file top — first SDK adapter test in the codebase that exercises createSession/resumeSession end-to-end via the dynamic import path (vs the existing pattern of constructing mockSdk inline and passing to createTracedSessionHandle)"

key-files:
  created: []
  modified:
    - src/manager/types.ts (+18 lines: AgentSessionConfig gains settingSources + gsd optional fields with JSDoc citing GSD-02/04)
    - src/manager/session-adapter.ts (+30 lines: createSession at 585-596 + resumeSession at 624-636 each gain JSDoc block + 2-field config-driven values)
    - src/manager/session-config.ts (+9 lines: buildSessionConfig return literal extended with spread-conditional settingSources + gsd propagation)
    - src/manager/__tests__/session-adapter.test.ts (+303 lines: vi.mock SDK at top + Phase 100 describe block with 10 SA1..SA10 tests)

key-decisions:
  - "Mock the Claude Agent SDK at file top via vi.mock instead of constructing mockSdk inline — required because the new tests exercise SdkSessionAdapter.createSession / .resumeSession (which dynamically import the SDK via loadSdk), unlike existing tests that pass mockSdk directly to createTracedSessionHandle. Existing tests are unaffected because they don't await import the SDK module."
  - "Apply symmetric edits to BOTH createSession AND resumeSession in the same commit (Rule 3) — prevents the well-known drift bug where createSession honors per-agent settings but resumeSession reverts to hardcoded defaults on next agent boot."
  - "Use spread-conditional field propagation (...(config.X ? { X: config.X } : {})) in the mapper — keeps the AgentSessionConfig field OMITTED rather than explicitly undefined when the resolved config doesn't carry them. This preserves byte-stable deep-equality in regression tests (SA10) and matches the existing mutableSuffix pattern at session-config.ts:718."
  - "AgentSessionConfig fields stay OPTIONAL even though ResolvedAgentConfig.settingSources is required (Plan 01 always-populated default ['project']). Reason: AgentSessionConfig is a downstream type; the adapter applies its own ['project'] fallback at line 592/631, so optionality at this boundary keeps existing call sites that build AgentSessionConfig (test fixtures, future callers) from needing updates until they choose to opt in."

patterns-established:
  - "vi.mock @anthropic-ai/claude-agent-sdk at SDK adapter test file top — repeatable for any future Phase that needs to exercise SdkSessionAdapter.createSession / .resumeSession end-to-end without spawning the real SDK"
  - "Symmetric-edits Rule 3 — Phase 100 codifies the createSession + resumeSession symmetry as a hard contract, enforced by SA5..SA8 parity tests"

requirements-completed: [REQ-100-02, REQ-100-04]

# Metrics
duration: 16min
completed: 2026-04-26
---

# Phase 100 Plan 02: Session-adapter wiring — replace hardcoded cwd + settingSources with config-driven values Summary

**Per-agent SDK cwd + settingSources now flow from ResolvedAgentConfig → AgentSessionConfig → session-adapter.createSession/.resumeSession baseOptions, with documented fallbacks (workspace, ['project']) preserving zero behavior change for the 15+ agent fleet that does not opt in.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-04-26T18:20:00Z
- **Completed:** 2026-04-26T18:35:29Z
- **Tasks:** 2 (RED + GREEN per TDD)
- **Files modified:** 4 (3 source + 1 test extension)

## Accomplishments

- **AgentSessionConfig type extension** — two new optional fields (`settingSources?: readonly ('project'|'user'|'local')[]` and `gsd?: { readonly projectDir: string }`) with JSDoc citing Phase 100 GSD-02/04 and Architecture Pattern 5. Optional at this boundary so existing call sites don't need updates until they opt in.
- **createSession + resumeSession symmetric edits** — both methods at `session-adapter.ts:585-596` and `:624-636` now read cwd from `config.gsd?.projectDir ?? config.workspace` and settingSources from `config.settingSources ?? ["project"]`. Identical pattern across both methods enforced by Rule 3 (RESEARCH.md Pitfall ordering pin).
- **buildSessionConfig mapper extension** — return literal at `session-config.ts:712` extended with spread-conditional propagation (`...(config.settingSources ? { settingSources: config.settingSources } : {})` and `...(config.gsd ? { gsd: config.gsd } : {})`). Matches the existing `mutableSuffix` pattern at line 718; preserves byte-stable deep-equality in regression tests.
- **10 new tests (SA1..SA10)** — vi.mock @anthropic-ai/claude-agent-sdk at file top + new describe block "Phase 100 — settingSources + gsd.projectDir flow into baseOptions". Coverage:
  - SA1..SA4 — createSession behavior across 4 config shapes (default, settingSources, gsd.projectDir, both)
  - SA5..SA8 — resumeSession parity at every shape (Rule 3 enforcement)
  - SA9 — input AgentSessionConfig is NOT mutated (immutability invariant)
  - SA10 — zero-behavior-change cascade (byte-stable regression pin)
- **40 total tests pass green** (30 existing + 10 new). 6 of 10 were RED before Task 2's GREEN edits landed. Existing 30 tests unaffected by the vi.mock at file top because they construct mockSdk inline and pass to `createTracedSessionHandle` — they don't `await import` the SDK module.
- **Mapper file location confirmed** — `src/manager/session-config.ts:712` (the `buildSessionConfig` return literal). NOT `session-manager.ts` — `SessionManager.startAgent` calls `buildSessionConfig(...)` and threads the result; no separate mapper needed.

## Task Commits

1. **Task 1: TDD RED — 10 session-adapter tests covering settingSources + gsd.projectDir flow** — `490cb9f` (test): 6 of 10 fail (SA2/SA3/SA4/SA6/SA7/SA8 — fields ignored by hardcoded values). 4 pass vacuously today (SA1/SA5/SA9/SA10) — they're regression pins.
2. **Task 2: GREEN — extend AgentSessionConfig + session-adapter (createSession + resumeSession) + buildSessionConfig mapper** — `7d60f0b` (feat): all 10 Phase 100 tests pass; 30 existing tests still pass; zero new TS errors; pre-existing failures unchanged.

**Plan metadata:** TBD (final commit on this SUMMARY + STATE.md + ROADMAP.md update)

## Files Created/Modified

### Source

- `src/manager/types.ts:113-130` — AgentSessionConfig gains 2 optional fields:
  ```typescript
  readonly settingSources?: readonly ("project" | "user" | "local")[];
  readonly gsd?: { readonly projectDir: string };
  ```
  JSDoc above each field cites Phase 100 GSD-02/04 + Plan 01 hand-off.
- `src/manager/session-adapter.ts:583-602` — createSession baseOptions assignment:
  - Line 588 (was `cwd: config.workspace,`) → `cwd: config.gsd?.projectDir ?? config.workspace,`
  - Line 592 (was `settingSources: ["project"],`) → `settingSources: config.settingSources ?? ["project"],`
  - JSDoc block above the literal cites GSD-02/04 + Architecture Pattern 5.
- `src/manager/session-adapter.ts:622-642` — resumeSession baseOptions assignment:
  - Line 627 (was `cwd: config.workspace,`) → `cwd: config.gsd?.projectDir ?? config.workspace,`
  - Line 631 (was `settingSources: ["project"],`) → `settingSources: config.settingSources ?? ["project"],`
  - JSDoc block above the literal cites Rule 3 symmetric-edits enforcement.
- `src/manager/session-config.ts:712-735` — `buildSessionConfig` return literal extended with spread-conditional propagation:
  ```typescript
  ...(config.settingSources ? { settingSources: config.settingSources } : {}),
  ...(config.gsd ? { gsd: config.gsd } : {}),
  ```
  JSDoc above the spreads cites Phase 100 GSD-02/04 + matches the existing mutableSuffix pattern at line 718.

### Tests

- `src/manager/__tests__/session-adapter.test.ts` — three additions:
  1. **Top of file** (lines 3-19) — `vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: mockSdkQuery }))` — captures sdk.query options for all SdkSessionAdapter tests below. Existing tests unaffected (they don't `await import` the SDK module).
  2. **Bottom of file** (lines 1119-1402) — `describe("Phase 100 — settingSources + gsd.projectDir flow into baseOptions", () => { ... })` containing 10 SA1..SA10 tests + a `makePhase100Config` fixture builder + a `makeMockSdkStream` helper.
  3. **No changes to any existing test** — additive-only.

## Decisions Made

- **vi.mock the SDK at file top** instead of constructing mockSdk inline. Required because Phase 100 tests exercise `SdkSessionAdapter.createSession` / `.resumeSession`, which call the dynamic import via `loadSdk()`. Existing tests in this file pass `mockSdk` directly to `createTracedSessionHandle` and never trigger `loadSdk()`, so the mock is invisible to them. Confirmed by running the full file with no filter: 30 existing tests pass + 10 new tests pass = 40 total.
- **Symmetric-edits enforced in same commit.** Both createSession and resumeSession got the identical 2-line edit pattern in commit `7d60f0b`. Tests SA5..SA8 are direct parity tests of SA1..SA4 — they would catch any future drift between the two methods.
- **Spread-conditional propagation in the mapper.** `...(config.settingSources ? { settingSources: config.settingSources } : {})` keeps the field OMITTED rather than explicitly `undefined` when the resolved config doesn't carry it. This preserves byte-stable deep-equality in regression tests (SA10) and matches the existing `mutableSuffix` conditional at session-config.ts:718.
- **AgentSessionConfig fields stay OPTIONAL** even though ResolvedAgentConfig.settingSources is required (Plan 01 always-populated default `['project']`). The adapter applies its own `["project"]` fallback at line 592/631, so optionality at this boundary lets existing call sites that build AgentSessionConfig (test fixtures, future callers) keep working without updates.

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed cleanly:
- Task 1 RED: 6 of 10 tests failed initially as expected (the plan said >= 6 must fail)
- Task 2 GREEN: all 10 pass with the exact 4-line + 2-line edits the plan prescribed

The mapper file location identified in Task 2's read_first matched the plan's prediction (`src/manager/session-config.ts`), and the spread-conditional pattern matched RESEARCH.md Code Examples §4 verbatim.

## Issues Encountered

- **Pre-existing test failures unchanged.** Master baseline shows 22 failing tests in `src/manager/`; my changes show 15-16 (depending on flaky test timing). `diff` confirms zero NEW failures introduced — the variation is entirely flaky pre-existing tests.
- **Pre-existing tsc errors unchanged.** Total tsc error count is 101 on both master and my branch. The single error in `src/manager/session-adapter.ts` (line 1043 → 1059 due to my JSDoc additions shifting lines) is the same pre-existing error, unaffected by my changes.

## User Setup Required

None — Plan 02 is type-plumbing + 4-line adapter edits + mapper extension. The Phase 100 deploy-runbook (Plan 100-08) handles the production rollout to Admin Clawdy on clawdy host (operator-driven manual step per the deployment_constraint).

## Next Phase Readiness

**Plan 03 hand-off (already shipped in commit `42751b4` while this plan was executing in parallel):**
- ✓ `agents.*.settingSources` and `agents.*.gsd.projectDir` field paths classified as NON_RELOADABLE in differ.ts. Reason: changing either field requires a full agent restart for the new SDK baseOptions to take effect (cwd and settingSources are passed to `sdk.query` ONLY at session start; mid-session changes have no effect).

**Plan 04 hand-off (subagent-thread-spawner — not yet started):**
- ✓ The existing `...parentConfig` spread at `subagent-thread-spawner.ts:211` already inherits Phase 100 fields verbatim — once a `ResolvedAgentConfig` carries them (Plan 01 ✓), the subagent's session config inherits them with zero plumbing. Plan 04 needs only the `handleGsdLongRunner` inline-handler-short-circuit + auto-thread spawn logic; no additional Plan 02-side work.

**Plan 05/07 hand-off:**
- ✓ Same as Plan 04 — they read `ResolvedAgentConfig.settingSources` and `ResolvedAgentConfig.gsd?.projectDir` directly with no further plumbing.

**Smoke test deferred to Plan 08:**
- The full end-to-end test (operator types `/gsd-autonomous` in #admin-clawdy → subagent thread spawns → cwd is `/opt/clawcode-projects/sandbox` → settingSources loads `~/.claude/commands/gsd/*.md`) requires the production deploy. Plan 02's contribution is verified by the 10 unit tests pinning the SDK contract — the runtime behavior is now provably correct.

---
*Phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow*
*Plan: 02*
*Completed: 2026-04-26*

## Self-Check: PASSED

- ✓ src/manager/types.ts FOUND
- ✓ src/manager/session-adapter.ts FOUND
- ✓ src/manager/session-config.ts FOUND
- ✓ src/manager/__tests__/session-adapter.test.ts FOUND
- ✓ commit 490cb9f (RED) FOUND
- ✓ commit 7d60f0b (GREEN) FOUND
- ✓ All 10 Phase 100 SA1..SA10 tests pass GREEN
- ✓ All 30 existing session-adapter tests still pass (zero regression)
- ✓ Zero new tsc errors caused by Phase 100 (101 → 101)
- ✓ Zero new test failures introduced (master baseline 22 fails → 15-16 fails, all flaky pre-existing)
- ✓ Symmetric edits verified — both grep counts at exactly 2 (createSession + resumeSession)
- ✓ No remaining hardcoded `cwd: config.workspace,` or `settingSources: ["project"],` literals in session-adapter.ts
