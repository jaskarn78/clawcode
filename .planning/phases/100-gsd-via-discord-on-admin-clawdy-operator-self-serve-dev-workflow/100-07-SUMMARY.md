---
phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow
plan: 07
subsystem: clawcode-yaml-fixture
tags: [clawcode-yaml, admin-clawdy, settingSources, gsd-projectDir, slash-commands, fixture, parse-regression, plan-04-handoff, plan-06-handoff, plan-08-handoff]

# Dependency graph
requires:
  - phase: 100
    plan: 01
    provides: "agentSchema.settingSources + agentSchema.gsd.projectDir additive-optional fields (Wave 0 §22 cascade pin PR11 — adjusted by Plan 07 deviation to encode admin-clawdy carrier role)"
  - phase: 100
    plan: 04
    provides: "Plan 04 dispatcher contract — claudeCommand template format + 5-entry roster (gsd-autonomous, gsd-plan-phase, gsd-execute-phase, gsd-debug, gsd-quick); 100-04-SUMMARY.md hand-off documented exact YAML to land"
  - phase: 100
    plan: 06
    provides: "DEFAULTS.sandboxDir = /opt/clawcode-projects/sandbox — admin-clawdy.gsd.projectDir byte-matches"

provides:
  - "admin-clawdy agent block in dev clawcode.yaml at lines 344-409 (66 lines including soul/identity placeholders)"
  - "5 GSD slashCommands entries with names matching Plan 04 GSD_LONG_RUNNERS Set (3 long-runners) + 2 short-runners (gsd-debug + gsd-quick fall-through)"
  - "8-test parse-regression suite at src/config/__tests__/clawcode-yaml-phase100.test.ts (145 lines) reading on-disk yaml + parsing via configSchema"
  - "PR11 (schema.test.ts) updated to encode the Plan 07 cascade: admin-clawdy is sole settingSources/gsd carrier in dev fleet"

affects:
  - "Plan 100-04 dispatcher tests can now resolve `this.resolvedAgents.find(a => a.name === 'admin-clawdy').slashCommands.find(c => c.name === commandName)` against real agent block"
  - "Plan 100-02 session-adapter passes admin-clawdy.settingSources [project, user] through baseOptions (loads ~/.claude/commands/gsd/*.md via SDK)"
  - "Plan 100-06 install helper writes /opt/clawcode-projects/sandbox/ — admin-clawdy.gsd.projectDir byte-matches that target"
  - "Plan 100-08 runbook: production deploy procedure must replicate this admin-clawdy block VERBATIM on clawdy host /etc/clawcode/clawcode.yaml, with channels: [...] populated by the real #admin-clawdy Discord channel ID"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Yaml fixture authoring: append new agent block after last existing entry; settingSources + gsd as additive-optional opt-ins (12th application after Phase 83/86/89/90/94/95/96 + Phase 100 Plans 01/02/04/06)"
    - "Parse-regression test reading on-disk clawcode.yaml (NOT a synthetic fixture string) so drift in dev yaml gets caught at config-tier vitest run, before deploy attempts"
    - "PR11 cascade adjustment: Plan 01 Wave 0 pin updated to encode the planned Plan 07 lock-in instead of the pre-Plan-07 dev-fleet snapshot"

key-files:
  created:
    - src/config/__tests__/clawcode-yaml-phase100.test.ts (145 lines, 8 tests YML1..YML8)
    - .planning/phases/100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow/deferred-items.md (out-of-scope log for pre-existing tsc/loader issues)
  modified:
    - clawcode.yaml (+92 lines — admin-clawdy block at lines 344-409)
    - src/config/__tests__/schema.test.ts (PR11 updated to encode Plan 07 cascade)

key-decisions:
  - "admin-clawdy block placed at END of agents list (after `research`) — coherent grouping; the block is the structural exception in the dev fleet, so trailing position visually flags it as the new arrival rather than burying it mid-list"
  - "channels: [] in dev fixture (NOT the production #admin-clawdy ID) — per CONTEXT.md decision: dev yaml carries dev placeholders; production deploy on clawdy host populates the real channel ID per Plan 08 runbook. The empty array is structurally valid (z.array(z.string()).default([])) and Plan 04 channel-guard logic handles non-admin channels via getAgentForChannel routing — empty channels cleanly translates to 'admin-clawdy isn't bound to any Discord channel in dev', which is the truth"
  - "PR11 deviation (Rule 3 - Blocking) — Plan 01's PR11 asserted `all agents have settingSources/gsd undefined` (snapshot of pre-Plan-07 state). Plan 07 is the PLANNED cascade. Updated PR11 to assert `only admin-clawdy carries the GSD opt-in fields; all others stay implicit-default` — preserves the additive-optional schema invariant AND encodes CONTEXT.md lock-in. PR11 still guards against accidental cascade onto fin-* / personal / etc."
  - "8 YML tests test SHAPE not BEHAVIOR — they parse the on-disk yaml + assert structural fields. Plan 04's dispatcher tests handle the dispatch-time behavior; Plan 02's session-adapter tests handle the SDK-passthrough behavior. YML1..YML8 are the structural pin between the two consumer-side tests"

requirements-completed: [REQ-100-01, REQ-100-02, REQ-100-04, REQ-100-09]

# Metrics
duration: ~6min
completed: 2026-04-26
---

# Phase 100 Plan 07: clawcode.yaml admin-clawdy fixture — settingSources [project, user] + gsd.projectDir + 5 slashCommands Summary

**admin-clawdy is now the dev fleet's SOLE carrier of `settingSources: [project, user]` + `gsd.projectDir: /opt/clawcode-projects/sandbox` + 5 GSD slashCommand entries (gsd-autonomous, gsd-plan-phase, gsd-execute-phase, gsd-debug, gsd-quick) with claudeCommand templates byte-matching Plan 04's dispatcher contract.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-26T18:53:49Z
- **Completed:** 2026-04-26T19:00:12Z
- **Tasks:** 2 (RED + GREEN per TDD)
- **Files modified:** 3 (1 yaml + 1 new test + 1 schema-test deviation fix)

## Accomplishments

- **admin-clawdy agent block** appended to `clawcode.yaml` at lines 344-409 (66 lines including soul/identity placeholders). Block contents verbatim per RESEARCH.md Code Examples §2 + Plan 04 hand-off:
  - `name: admin-clawdy` / `model: sonnet` / `workspace: /tmp/admin-clawdy` / `channels: []`
  - `settingSources: [project, user]` — SOLE dev-fleet carrier per CONTEXT.md lock-in
  - `gsd.projectDir: /opt/clawcode-projects/sandbox` — byte-matches Plan 06's `DEFAULTS.sandboxDir`
  - 5 slashCommands entries (3 long-runners + 2 short-runners) with claudeCommand templates exactly matching Plan 04's `formatCommandMessage` substitution contract
  - `soul:` + `identity:` placeholders documenting the GSD operator surface role
- **8 parse-regression tests** in `src/config/__tests__/clawcode-yaml-phase100.test.ts` (NEW, 145 lines):
  - **YML1** — admin-clawdy entry exists in clawcode.yaml
  - **YML2** — `admin-clawdy.settingSources` deep-equals `[project, user]`
  - **YML3** — `admin-clawdy.gsd.projectDir === "/opt/clawcode-projects/sandbox"`
  - **YML4** — 5 slashCommands with expected names (gsd-autonomous, gsd-plan-phase, gsd-execute-phase, gsd-debug, gsd-quick)
  - **YML5** — claudeCommand templates exactly match Plan 04 dispatcher contract
  - **YML6** — only admin-clawdy carries settingSources; other agents stay implicit-default (CONTEXT.md lock-in)
  - **YML7** — fleet-wide slashCommand count `<= 90` (Discord cap per RESEARCH.md Pitfall 5) AND `>= 5` (guards against admin-clawdy block loss)
  - **YML8** — every entry passes `slashCommandEntrySchema` regex `/^[\w-]+$/` + 32-char name cap + 100-char description cap + `/gsd:` claudeCommand prefix sanity check
- **PR11 cascade update** in `src/config/__tests__/schema.test.ts` (deviation, see below). Encodes CONTEXT.md decision lock-in: admin-clawdy is sole carrier; all 10+ other agents have settingSources/gsd undefined.
- **Cross-reference verification:** `gsd.projectDir = /opt/clawcode-projects/sandbox` matches Plan 06's `DEFAULTS.sandboxDir` verbatim (no trailing slash, absolute path). Verified via `grep -E "/opt/clawcode-projects/sandbox" src/cli/commands/gsd-install.ts` (Plan 06 file at HEAD).
- **Zero new tsc errors** caused by Plan 07 — verified via stash-baseline diff (`tsc --noEmit` output identical pre/post-edit).
- **Zero new vitest regressions** outside Plan 07's own test file. The 1 failing test in `loader.test.ts` (LR-RESOLVE-DEFAULT-CONST-MATCHES) is pre-existing per stash-baseline check; logged to `deferred-items.md`.

## Task Commits

1. **Task 1: TDD RED — 8 yaml-fixture parse tests targeting admin-clawdy block** — `a71a7c7` (test): scaffolds the failing test suite. 7/8 RED initially (admin-clawdy doesn't exist); 1/8 vacuously green (YML6 — others-not-having-settingSources is true when adminClawdy and `others` resolve to undefined cascading through `find`).
2. **Task 2: GREEN — admin-clawdy block + PR11 deviation fix** — `af7cf27` (feat): all 8 YML tests green; PR11 updated to encode Plan 07 cascade; 174 config-tier tests green (zero regressions outside the pre-existing LR-RESOLVE-DEFAULT-CONST-MATCHES baseline).

**Plan metadata commit:** TBD (final commit on this SUMMARY + STATE.md + ROADMAP.md update).

## Files Created/Modified

### Source

- `clawcode.yaml:344-409` — NEW admin-clawdy agent block (+92 lines including the leading `# Phase 100 — admin-clawdy` 9-line docblock comment + the agent body).

### Tests

- `src/config/__tests__/clawcode-yaml-phase100.test.ts` — NEW (145 lines). `describe("Phase 100 — clawcode.yaml admin-clawdy fixture", ...)` containing 8 YML1..YML8 tests reading on-disk yaml + parsing via `configSchema.parse(...)` once at top of describe block (efficient — single parse drives all 8 assertions).
- `src/config/__tests__/schema.test.ts:1915-1947` — UPDATED PR11 from "all 10 agents have settingSources/gsd undefined" to "only admin-clawdy carries the GSD opt-in fields; production agents stay implicit-default". Deviation Rule 3 - Blocking. Comment updated to reflect Plan 07 lock-in.

### Plan artifacts

- `.planning/phases/100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow/deferred-items.md` — NEW. Logs 2 pre-existing out-of-scope items: (1) `loader.test.ts` LR-RESOLVE-DEFAULT-CONST-MATCHES failure (Phase 94 follow-up), (2) 233 pre-existing tsc errors across `dream.test.ts` / `latency.test.ts` / `tasks.test.ts` / etc.

## Decisions Made

- **admin-clawdy block placement at END of agents list** — after `research`. Visually flags the new arrival; alphabetical-ish placement (after `personal` but before `fin-*`) was the alternative but breaks the existing dev-fleet's coherent finmentum/personal/general/projects/research grouping.
- **`channels: []` in dev fixture** — production yaml on clawdy carries the real `#admin-clawdy` channel ID per Plan 08 runbook. Empty array is structurally valid (`z.array(z.string()).default([])`) and Plan 04 channel-guard logic handles non-admin channels via `getAgentForChannel` routing — empty channels cleanly translates to "admin-clawdy isn't bound to any Discord channel in dev", which matches the dev/prod split.
- **`workspace: /tmp/admin-clawdy`** — placeholder absolute path for the dev fixture. Production yaml on clawdy points at the operator's chosen workspace. The fixture's workspace value is never resolved at vitest time (the parse-regression tests don't exercise filesystem ops); production setup creates the directory via the install helper.
- **PR11 deviation (Rule 3 - Blocking)** — see Deviations section below.
- **8 YML tests cover SHAPE, not BEHAVIOR** — Plan 04's dispatcher tests handle dispatch-time behavior; Plan 02's session-adapter tests handle SDK-passthrough behavior. YML1..YML8 are the structural pin between the two consumer-side tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan 01's PR11 (schema.test.ts:1915) asserted "all 10 agents have settingSources/gsd undefined" — Plan 07 cascade breaks this assertion**

- **Found during:** Task 2 GREEN verification (`npx vitest run src/config/__tests__/schema.test.ts`)
- **Issue:** Plan 01 Wave 0 §22 added PR11 as a parse-regression cascade pin asserting that the additive-optional schema fields (settingSources, gsd) are undefined on EVERY agent in the dev clawcode.yaml. This pin captures the PRE-PLAN-07 snapshot. Plan 07 is the PLANNED cascade — admin-clawdy IS supposed to carry these fields. Without updating PR11, every Plan 07-style cascade trips the pin.
- **Fix:** Updated PR11 to encode the Plan 07 lock-in: "admin-clawdy carries `[project, user]` + `gsd.projectDir = /opt/clawcode-projects/sandbox`; all OTHER agents stay implicit-default (undefined)." Preserves the additive-optional schema invariant (other agents unaffected) AND encodes CONTEXT.md decision lock-in (admin-clawdy is the sole opt-in).
- **Files modified:** `src/config/__tests__/schema.test.ts:1915-1947` (PR11 test body — 16 lines changed)
- **Verification:** `npx vitest run src/config/__tests__/schema.test.ts` → 166 passed (PR11 + 165 others, all green). `npx vitest run src/config/__tests__/clawcode-yaml-phase100.test.ts` → 8 passed. Stash-baseline confirmed PR11 was the ONLY new failure caused by the admin-clawdy edit.
- **Committed in:** `af7cf27` (Task 2 GREEN — landed alongside the admin-clawdy block, NOT as a separate commit since the schema.test.ts edit is part of the same atomic GREEN landing).

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** PR11 now encodes the actual lock-in instead of the pre-Plan-07 snapshot. Catches both directions of accidental drift: (a) admin-clawdy losing the GSD fields (test fails on first branch), (b) production agents accidentally gaining them (test fails on second branch). Strictly better coverage than the pre-Plan-07 PR11.

## Issues Encountered

- **Pre-existing `loader.test.ts` LR-RESOLVE-DEFAULT-CONST-MATCHES failure** — stash-baseline confirmed the failure exists without any Plan 07 changes. `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` exports 3 entries; the test asserts a hard-coded 2-entry array. Phase 94/96 follow-up territory. Logged to `deferred-items.md`.
- **Pre-existing 233 tsc `--noEmit` errors** across `dream.test.ts`, `fs-status.test.ts`, `latency.test.ts`, `tasks.test.ts`, `probe-fs.test.ts`, `differ.test.ts`, `loader.test.ts` (typed array literal/tuple-type mismatches around `outputDir`), and `gsd-install.test.ts` (parallel Plan 06 file-not-yet-committed during my run). Stash-baseline diff shows zero new errors caused by Plan 07. Logged to `deferred-items.md`.
- **Parallel Plan 06 working-tree changes** — observed `src/cli/index.ts` (M) and `src/cli/commands/gsd-install.ts` (??) in `git status` during my run. Plan 06 committed those before my Task 2 commit landed (the `M` on `index.ts` cleared between Task 1 and Task 2). No collision: Plan 06 + Plan 07 touch disjoint files (Plan 06 = `src/cli/`; Plan 07 = `clawcode.yaml` + `src/config/__tests__/`).

## User Setup Required

None — Plan 07 is dev-fixture authoring + 1 new parse-regression test + 1 schema-test deviation fix. Production rollout requires:

- **Plan 100-08** runbook documents the operator-driven manual deploy step on the clawdy host: SSH into clawdy, edit `/etc/clawcode/clawcode.yaml`, replicate the admin-clawdy block from this dev yaml VERBATIM, populate `channels: ["<real #admin-clawdy ID>"]`, restart the daemon. Per the deployment_constraint that this conversation's executor never touches clawdy.
- **Plan 100-06** install helper symlinks `~/.claude/commands/gsd/` to the `clawcode` system user's `~/.claude/commands/gsd/`. Without it, the SDK reports "Unknown skill" when the dispatcher passes `/gsd:autonomous --from 100` as the subagent's task.

## Next Phase Readiness

**Plan 08 hand-off — production deploy procedure on clawdy host:**

The Plan 08 runbook's "Step: edit /etc/clawcode/clawcode.yaml on clawdy" section MUST replicate this admin-clawdy block VERBATIM, with two production-specific substitutions:

1. **`channels: []`** → `channels: ["<real #admin-clawdy Discord channel ID>"]`. Operator looks up the channel ID in Discord developer mode + pastes it.
2. **`workspace: /tmp/admin-clawdy`** → operator's chosen workspace path on clawdy (e.g. `/home/clawcode/admin-clawdy`).

All OTHER fields (model, settingSources, gsd.projectDir, slashCommands, soul, identity) MUST land byte-identical to preserve Plan 04's dispatcher contract + Plan 02's SDK-passthrough invariant + Plan 06's sandbox-path matching. The Plan 08 runbook should include a verification step: after edit, `clawcode config validate /etc/clawcode/clawcode.yaml` (if the CLI exists) or `npx tsx -e "..."` parse-test to confirm the production yaml schema-validates before daemon restart.

**Verification points for the Plan 08 smoke test:**

- Operator types `/gsd-autonomous` in `#admin-clawdy` → expect a thread named `gsd:autonomous` (no phase arg) appears within 3s + ack message in main channel (Plan 04 dispatcher).
- Operator types `/gsd-plan-phase 100` in `#admin-clawdy` → expect thread `gsd:plan:100` + ack.
- Operator types `/gsd-debug "memory leak"` in `#admin-clawdy` → expect inline reply (no thread spawn — short-runner fall-through path).
- Operator types `/gsd-autonomous` in a non-admin-clawdy channel → expect `"/gsd-* commands are restricted to #admin-clawdy."` reply, no thread (Plan 04 channel guard).

---

*Phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow*
*Plan: 07*
*Completed: 2026-04-26*

## Self-Check: PASSED

- ✓ `clawcode.yaml` admin-clawdy block FOUND at lines 344-409
- ✓ `src/config/__tests__/clawcode-yaml-phase100.test.ts` (NEW, 145 lines) FOUND
- ✓ `.planning/phases/100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow/deferred-items.md` FOUND
- ✓ commit `a71a7c7` (Task 1 RED — 8 tests, 7 failing) FOUND
- ✓ commit `af7cf27` (Task 2 GREEN — admin-clawdy block + PR11 deviation fix) FOUND
- ✓ All 8 YML1..YML8 parse-regression tests green
- ✓ schema.test.ts PR11 + 165 sibling tests green (174 config-tier tests green excluding pre-existing baseline)
- ✓ Zero new tsc errors caused by Plan 07 (verified via stash-baseline diff)
- ✓ admin-clawdy.gsd.projectDir = /opt/clawcode-projects/sandbox (matches Plan 06 DEFAULTS.sandboxDir verbatim)
- ✓ 5 slashCommands with claudeCommand templates exactly matching Plan 04 dispatcher contract
- ✓ `settingSources: [project, user]` ONLY on admin-clawdy (verified by YML6 + updated PR11)
