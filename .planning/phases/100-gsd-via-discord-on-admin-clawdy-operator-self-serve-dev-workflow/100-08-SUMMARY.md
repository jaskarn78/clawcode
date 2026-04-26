---
phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow
plan: 08
subsystem: smoke-test-runbook
tags: [runbook, smoke-test, uat, operator-driven, clawdy, deploy-procedure, autonomous-false, plan-04-handoff, plan-05-handoff, plan-06-handoff, plan-07-handoff]

# Dependency graph
requires:
  - phase: 100
    plan: 02
    provides: "Session-adapter passes settingSources + cwd from config — Section 4 daemon redeploy verifies admin-clawdy boot logs"
  - phase: 100
    plan: 03
    provides: "Differ classifies settingSources/gsd.projectDir as NON_RELOADABLE — Section 8 UAT-100-C verifies operator-visible restart-needed log"
  - phase: 100
    plan: 04
    provides: "Slash dispatcher with auto-thread for gsd-autonomous/gsd-plan-phase/gsd-execute-phase + fall-through for gsd-debug/gsd-quick — Sections 6+7 verify both paths"
  - phase: 100
    plan: 05
    provides: "Phase 99-M relay extension surfaces `Artifacts written:` line — Section 7 UAT-100-B acceptance criterion"
  - phase: 100
    plan: 06
    provides: "`clawcode gsd install` CLI subcommand — Section 2 invokes it as the install step"
  - phase: 100
    plan: 07
    provides: "admin-clawdy block in dev clawcode.yaml — Section 3 references it as the production template (with 2 documented substitutions)"

provides:
  - ".planning/phases/100-*/SMOKE-TEST.md (NEW): 562-line 9-section operator-runnable runbook for transitioning Phase 100 from dev to production on clawdy"
  - ".planning/phases/100-*/__tests__/smoke-test-doc.test.ts (NEW): 10-test structural validation (SMK1..SMK10)"
  - "Single source of truth for Phase 100 deploy + UAT acceptance criteria"
  - "Operator-callable rollback procedure (Section 9) for safe failure recovery"
  - "Sign-off checklist tying all 9 sections together"

affects:
  - "ROADMAP.md Phase 100 status — flips to 'Shipped <date>' once operator runs the runbook through Section 9 sign-off"
  - "Plan 100-04/05/06/07 hand-offs — runbook references each plan's contract verbatim, pinning their downstream UAT acceptance"
  - "Future phase admin-clawdy operator workflow — runbook is the canonical reference for re-deploys, additional slash commands, or new subagent skills"

# Tech tracking
tech-stack:
  added: []  # Zero source code changes; zero new npm dependencies
  patterns:
    - "9-section deploy + UAT runbook pattern (mirrors Phase 96 96-07-DEPLOY-RUNBOOK.md structure: Section 1 prereqs, Sections 2-5 deploy, Sections 6-8 UAT, Section 9 rollback, Sign-off checklist)"
    - "BLOCKED-BY relationships table at top — operator can read the dependency graph at a glance before starting"
    - "Per-section Acceptance criteria + Failure mitigation pairings — every step has both a success-path verification AND a debug-path recovery"
    - "Structural test pattern: 10 SMK tests pin runbook invariants (9 sections, no TODOs, references all 5 slash names + clawcode gsd install + UAT acceptance markers + clawdy host + 200-600 line size budget)"

key-files:
  created:
    - .planning/phases/100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow/SMOKE-TEST.md (562 lines)
    - .planning/phases/100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow/__tests__/smoke-test-doc.test.ts (105 lines, 10 SMK tests)
  modified: []  # Plan 08 ONLY adds files under .planning/. Zero source-code changes.

key-decisions:
  - "Runbook DOCUMENTS the deploy procedure; structural test validates only that the runbook FILE exists and has the required sections — does NOT execute any of the documented procedures (deployment_constraint compliance)"
  - "9-section structure mirrors Phase 96 deploy runbook precedent: Section 1 prereqs, Sections 2-5 deploy, Sections 6-8 UAT, Section 9 rollback, plus Sign-off checklist + Cross-references"
  - "Sections 6-8 UAT cannot be executed by Claude — they're real Discord operator interactions on the production guild. autonomous=false reflects this; runbook documents what operator types + observes"
  - "Section 9 rollback is operator-initiated only — explicitly noted 'never autonomous' so a future runbook automation attempt does not accidentally trigger destructive ops"
  - "Two production substitutions documented for Section 3 yaml edit: channels (real Discord ID) + workspace (operator's chosen path); ALL other fields land byte-identical to dev fixture per Plan 07 hand-off"

patterns-established:
  - "Runbook structural test pattern: a vitest spec at .planning/phases/<N>-*/_tests__/<doc>-doc.test.ts that pins the markdown's invariants. Repeatable for any future phase that ships an operator-runnable artifact (deploy runbook, migration runbook, smoke test) — cheap to author (<150 lines) and prevents drift before operator attempts the procedure"
  - "BLOCKED-BY relationships table at top of multi-section runbooks: makes the dependency graph explicit so operator understands ordering before starting"

requirements-completed: [REQ-100-10]

# Metrics
duration: 5min
completed: 2026-04-26
---

# Phase 100 Plan 08: Smoke-test runbook — operator-runnable deploy procedure + post-deploy UAT verification Summary

**562-line 9-section operator-runnable runbook (`SMOKE-TEST.md`) for transitioning Phase 100 from dev to production on clawdy, plus 10 structural tests pinning the runbook's invariants. Once an operator runs through the runbook + signs off, Phase 100 ships.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-26T19:05:04Z
- **Completed:** 2026-04-26T19:09:33Z
- **Tasks:** 1 (combined RED+GREEN per TDD — runbook is small enough to combine)
- **Files created:** 2 (SMOKE-TEST.md + smoke-test-doc.test.ts)
- **Files modified:** 0

## Accomplishments

- **`SMOKE-TEST.md` runbook** at `.planning/phases/100-*/SMOKE-TEST.md` (562 lines, 13 h2 sections including the 9 numbered sections + Scope + Section ordering + Sign-off + Cross-references). Mirrors Phase 96 deploy runbook structure verbatim:
  - **Sections 1-5:** deploy procedure (prereqs, install, yaml edit, daemon redeploy, slash registration verification)
  - **Sections 6-8:** UAT smoke tests (UAT-100-A inline short-runner, UAT-100-B long-runner subthread, UAT-100-C settingSources NON_RELOADABLE behavior)
  - **Section 9:** rollback procedure (operator-initiated only — explicitly noted "never autonomous")
  - **Sign-off checklist:** 9 ticked checkboxes tying every section together
  - **Cross-references:** links to Plans 01-07 with each plan's contribution to the runbook
- **`smoke-test-doc.test.ts`** at `.planning/phases/100-*/__tests__/smoke-test-doc.test.ts` (105 lines, 10 SMK tests). Validates the runbook structure:
  - SMK1 — file exists
  - SMK2 — 9 numbered sections present (h2 headings 1-9)
  - SMK3 — references `clawcode gsd install` (Plan 06 hand-off)
  - SMK4 — references all 5 GSD slash command names (Plan 04 hand-off)
  - SMK5 — no TODO/TBD/PLACEHOLDER markers
  - SMK6 — mentions Phase 99-M relay or Plan 100-05 artifact paths
  - SMK7 — has a rollback section
  - SMK8 — UAT-100-A/B/C acceptance markers present
  - SMK9 — references the clawdy host / systemd unit / install path
  - SMK10 — file size between 200 and 600 lines
- **All 10 SMK tests pass GREEN.** Vitest discovers the test under `.planning/` via the default include pattern — no `vitest.config.ts` adjustment needed (the plan's optional Step 6 was unnecessary). Verification: `npx vitest run .planning/phases/100-*/__tests__/smoke-test-doc.test.ts` → 10/10 GREEN.
- **Acceptance criteria all green:**
  - 562 lines (within 200-600 budget)
  - 13 h2 sections (>= 9 required)
  - 14 UAT marker mentions (>= 6 required)
  - No TODO/TBD/PLACEHOLDER markers
  - 8 mentions of `clawcode gsd install`
  - 21 total mentions of the 5 GSD slash names
- **Zero source code changes.** Plan 08 only adds files under `.planning/`. The runbook references existing code shipped in Plans 04/05/06 and operator commands (`clawcode gsd install`, `clawcode restart admin-clawdy`).
- **Zero new npm dependencies.**
- **deployment_constraint compliance verified:** the structural test validates only that the runbook FILE exists and has the required sections — it does NOT execute any of the documented procedures. The runbook DOCUMENTS the deploy; the operator runs it manually per Plan 08 contract.

## Task Commits

1. **Task 1 (RED): structural validation tests** — `dc033cb` (test): 10 SMK tests scaffold the contract before the runbook is authored. 9/10 RED, 1/10 vacuously GREEN (SMK1 file-exists naturally fails when the file is absent — but `existsSync` returns false and the test correctly reports the failure).
2. **Task 1 (GREEN): SMOKE-TEST.md operator runbook** — `d513a03` (feat): 562-line 9-section runbook lands; all 10 SMK tests pass GREEN.

**Plan metadata commit:** TBD (final commit on this SUMMARY + STATE.md + ROADMAP.md update)

## Files Created/Modified

### Documentation

- `.planning/phases/100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow/SMOKE-TEST.md` — NEW, 562 lines. The canonical Phase 100 deploy + UAT runbook.

### Tests

- `.planning/phases/100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow/__tests__/smoke-test-doc.test.ts` — NEW, 105 lines. `describe("Phase 100 — SMOKE-TEST.md runbook structure")` containing 10 SMK1..SMK10 tests reading the runbook from disk and asserting structural invariants.

## Decisions Made

- **Runbook DOCUMENTS the deploy procedure; structural test validates only the runbook FILE.** Per the deployment_constraint: no deployments performed by this plan. The runbook is the operator's manual procedure. The structural test catches drift (missing section, leftover TODO, broken cross-reference) before the operator attempts the deploy — it does NOT execute any of the documented procedures.
- **9-section structure mirrors Phase 96 96-07-DEPLOY-RUNBOOK.md precedent.** Section 1 prereqs, Sections 2-5 deploy, Sections 6-8 UAT, Section 9 rollback, plus Sign-off checklist + Cross-references. Established template — operators familiar with Phase 96 can read Phase 100 SMOKE-TEST.md without re-learning the layout.
- **Sections 6-8 UAT cannot be executed by Claude.** They're real Discord operator interactions on the production guild. autonomous=false on the plan reflects this contract; the runbook documents what operator types + observes; operator confirms acceptance.
- **Section 9 rollback is operator-initiated only — explicitly noted "never autonomous".** Defends against future automation attempts that might accidentally trigger destructive ops (`rm -rf /opt/clawcode-projects/sandbox`).
- **Two production substitutions documented for Section 3 yaml edit:** `channels` (real Discord ID) + `workspace` (operator's chosen path). All other fields land byte-identical to dev fixture per Plan 07 hand-off — preserves Plan 04 dispatcher contract + Plan 02 SDK passthrough invariant + Plan 06 sandbox-path matching.
- **Vitest discovers `.planning/__tests__/` test files via default include pattern.** No `vitest.config.ts` edit needed — the plan's optional Step 6 contingency was unnecessary. Confirmed via `npx vitest run .planning/phases/100-*/__tests__/smoke-test-doc.test.ts` returning 10 passing tests on first attempt after the runbook landed.

## Deviations from Plan

None — plan executed exactly as written. Both steps (RED + GREEN) committed atomically per the plan's combined-cycle directive.

The plan's optional Step 6 (vitest config adjustment for `.planning/` discovery) turned out to be unnecessary — the default include pattern already covers `.planning/**/__tests__/*.test.ts`. Confirmed empirically: the first vitest run after the test file was created reported all 10 tests discovered + 9 RED + 1 vacuously GREEN, exactly as expected.

## Issues Encountered

- **Pre-existing repo state:** several unrelated files in `git status --short` (`.claude/`, `.playwright-mcp/`, `Screenshot ...png`, etc.) — verified out-of-scope per CLAUDE.md SCOPE BOUNDARY rule. Not committed by this plan.
- **No new tsc errors caused by Plan 08:** the test file uses standard imports (`vitest`, `node:fs`, `node:path`) and matches the existing test file conventions. Zero TS errors introduced.
- **No vitest regressions:** the new SMK tests are additive — they live in `.planning/phases/100-*/__tests__/`, isolated from `src/` test suites.

## User Setup Required

None — Plan 08 is documentation-tier (1 markdown runbook + 1 structural test). The runbook itself is the user-facing artifact; the operator (you) is the consumer.

**Production deploy is the operator's manual step per Plan 08 contract:** SSH to clawdy, follow Sections 1-9 in order, tick each Sign-off checkbox, commit the STATE.md/ROADMAP.md updates marking Phase 100 shipped.

## Next Phase Readiness

**Phase 100 ships when the operator runs through SMOKE-TEST.md and all 9 sign-off checkboxes are ticked.** This summary documents that the runbook + structural test are both authored; the actual deploy is operator-driven.

**ROADMAP.md update:** once operator UAT sign-off completes, update Phase 100 status from "in-progress" to "Shipped <date>" per the runbook's Sign-off Checklist final step.

**Future phase hand-offs:**
- **Phase 101+ remote git auth** (deferred from CONTEXT.md): once operators want `gh pr create` from `#admin-clawdy`, future phase wires GitHub device-code or SSH key auth. Operator MUST re-run a Section 1-style prereq verification before that ships.
- **Phase 101+ multi-operator coordination** (deferred): once another collaborator joins, future phase adds soft-lock around active workflows. SMOKE-TEST.md remains the single-operator baseline.
- **Phase 101+ additional GSD slash commands** (deferred): the 5 in Phase 100 are the most-common entry points; future phases can add more `/gsd-<command>` entries to admin-clawdy.slashCommands without touching Plan 04 source code (as long as new ones are short-runners — long-runners require adding to `GSD_LONG_RUNNERS` in `slash-commands.ts:156`).

---

*Phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow*
*Plan: 08*
*Completed: 2026-04-26*

## Self-Check: PASSED

- ✓ `.planning/phases/100-*/SMOKE-TEST.md` FOUND (562 lines, 13 h2 sections)
- ✓ `.planning/phases/100-*/__tests__/smoke-test-doc.test.ts` FOUND (105 lines, 10 SMK tests)
- ✓ `.planning/phases/100-*/100-08-SUMMARY.md` FOUND (this file)
- ✓ commit `dc033cb` (RED — 10 SMK structural tests) FOUND
- ✓ commit `d513a03` (GREEN — SMOKE-TEST.md operator runbook) FOUND
- ✓ All 10 SMK tests pass GREEN (`npx vitest run .planning/phases/100-*/__tests__/smoke-test-doc.test.ts` → 10/10)
- ✓ All acceptance criteria met:
  - 562 lines (within 200-600 budget)
  - 13 h2 sections (>= 9 required)
  - 14 UAT marker mentions (>= 6 required)
  - No TODO/TBD/PLACEHOLDER markers
  - 8 mentions of `clawcode gsd install`
  - 21 total mentions of the 5 GSD slash names
- ✓ Zero source code changes (Plan 08 only adds files under `.planning/`)
- ✓ Zero new npm dependencies
- ✓ deployment_constraint compliance: structural test validates the runbook FILE; does NOT execute documented procedures
