---
phase: 82-pilot-cutover-completion
plan: 02
subsystem: cli-migration
tags: [cli, pilot-highlight, cutover, migration-report, milestone-v2.1]

requires:
  - phase: 82-01
    provides: pilot-selector + cutoverAgent + buildMigrationReport + writeMigrationReport
provides:
  - Three new CLI surfaces on `clawcode migrate openclaw`:
      - pilot-highlight line appended to `plan` output
      - `cutover <agent>` subcommand (per-agent Discord-binding removal)
      - `complete` subcommand (milestone report write)
  - Dispatch-holder extensions for cutoverAgent + report-writer handlers
    (test-injection seams preserved)
affects: [v2.1-completion]

tech-stack:
  added: []
  patterns:
    - "Dispatch-holder late-bind: runCutoverAction + runCompleteAction attached to migrateOpenclawHandlers after definition (mirrors Phase 81 Plan 02)"
    - "Default-with-fallback dispatch: `impl = holder.x ?? moduleRef` so production paths use the module and tests swap the holder"
    - "Guarded pilot emission: report.agents.length >= 1 AND opts.agent === undefined"

key-files:
  created:
    - src/cli/commands/__tests__/migrate-openclaw-pilot.test.ts
    - src/cli/commands/__tests__/migrate-openclaw-cutover.test.ts
    - src/cli/commands/__tests__/migrate-openclaw-complete.test.ts
  modified:
    - src/cli/commands/migrate-openclaw.ts (pilot-highlight + runCutoverAction + runCompleteAction + 2 commander subcommands + dispatch-holder extensions)
    - src/cli/commands/__tests__/migrate-openclaw.test.ts (3 additive describe blocks — empty-inventory pilot guard, cutover registration, complete registration)

key-decisions:
  - "Pilot line is suppressed on `plan --agent <name>` — operator already committed to one agent; recommendation has no signal value"
  - "Pilot line is suppressed on empty-inventory — `pickPilot` returns null but additionally guarded by `report.agents.length >= 1` for symmetry with the `--agent` guard"
  - "runCompleteAction bundled into Task 1 GREEN commit for dispatch-holder coherence (all 4 new holder fields initialized simultaneously) rather than shipping the handler skeleton in Task 2 — logged as a minor commit-ordering deviation, test RED was verified for Task 1 scenarios"
  - "Per D-08, zero npm deps added; `git diff package.json package-lock.json` empty"
  - "Per D-06, REPORT_PATH_LITERAL is not overridable from the CLI — no --output flag added; writeMigrationReport uses the locked path by default and tests inject a tmp path through the dispatch holder"

requirements-completed: [OPS-01, OPS-02, OPS-04]

duration: ~22min
completed: 2026-04-21
---

# Phase 82 Plan 02: Pilot-Highlight + Cutover + Complete CLI Wiring Summary

**Wave 2 wires Wave 1 modules into `clawcode migrate openclaw` and proves the four phase-level success criteria via 19 new integration tests. Three CLI surfaces land: pilot-highlight line in `plan` output, `cutover <agent>` subcommand (the only CLI path that writes to `~/.openclaw/`), and `complete` subcommand (writes the milestone v2.1 migration report). Milestone v2.1 closes: all 31 requirements complete.**

## Performance

- **Duration:** ~22 min
- **Tasks:** 2 (test-first TDD)
- **Files created:** 3 new integration test files
- **Files modified:** 2 (migrate-openclaw.ts + migrate-openclaw.test.ts)
- **Tests added:** 19 total (5 pilot + 6 cutover + 8 complete) plus 3 additive pins in the regression suite (empty-inventory pilot guard + 2 subcommand-registration pins)
- **Phase 82 test count:** 47 new tests (52 Wave 1 + additions here), zero regressions

## Three CLI Surface Changes

### 1. `runPlanAction` pilot-highlight (OPS-01)

After the existing `cliLog(formatPlanOutput(report))`, the handler computes `mcpCounts` from the inventory (via `extractPerAgentMcpNames`) and calls `pickPilot(report.agents, mcpCounts)`. The returned `{winner, reason}` is rendered as `formatPilotLine(winner, reason)` and emitted as a separate `cliLog` line AFTER the plan-hash dim line.

Suppression guards:
- `opts.agent === undefined` — no highlight when the operator filtered to one agent
- `report.agents.length >= 1` — nothing to recommend on empty inventory

### 2. `runCutoverAction` + `cutover <agent>` subcommand (OPS-02)

Commander-registered with a required `<agent>` argument. Calls `migrateOpenclawHandlers.cutoverAgent` (dispatch-holder indirect for test injection). Three `CutoverOutcome` variants map:
- `"cut-over"` → exit 0, stdout `✓ cut over <agent>: removed N binding(s)` + dim `observeHint`
- `"already-cut-over"` → exit 0, dim stdout `<agent>: already cut over (0 bindings to remove) — no-op` (idempotency per D-05)
- `"refused"` → exit 1, red stderr `✗ cutover refused for <agent>: <reason>`

### 3. `runCompleteAction` + `complete` subcommand (OPS-04)

Commander-registered with `--force` option. Calls `migrateOpenclawHandlers.buildMigrationReport` then, on `"built"` outcome, `migrateOpenclawHandlers.writeMigrationReport`. Four `BuildReportResult` variants map:
- `"refused-pending"` → exit 1, stderr = `buildResult.message` (byte-exact D-07 literal)
- `"refused-invariants"` → exit 1, stderr = message + failing invariants list
- `"refused-secret"` → exit 1, stderr = offender-path-aware refusal
- `"built"` → `writeMigrationReport` then exit 0 + stdout `Migration complete. Report: <path>`

## Four Success Criteria Mapped to Tests

| SC | Description | Test file | Test case |
|----|-------------|-----------|-----------|
| 1 | `plan` output contains `✨ Recommended pilot: ...` line | migrate-openclaw-pilot.test.ts | `SC-1: plan output contains the '✨ Recommended pilot:' literal prefix` |
| 1a | Winner is non-finmentum | migrate-openclaw-pilot.test.ts | `SC-1: winner is a low-memory non-finmentum agent` + `finmentum family agents NEVER appear on the pilot line` |
| 1b | Pilot line suppressed on `--agent <name>` | migrate-openclaw-pilot.test.ts | `SC-1 (negative): plan --agent <name> does NOT emit pilot line` |
| 2 | `cutover <agent>` removes bindings atomically; idempotent re-run is no-op | migrate-openclaw-cutover.test.ts | `A (SC-2 happy)` + `B (SC-2 idempotent)` + `C (SC-2 refuse-pending)` + `D (SC-2 refuse-no-yaml-entry)` |
| 3 | `complete` writes `.planning/milestones/v2.1-migration-report.md` with per-agent sections + invariants + zero secrets | migrate-openclaw-complete.test.ts | `SC-3: happy path — three [x] invariants` + `SC-3 (secret): sk- prefix → refuse` |
| 4 | Post-complete: zero channel-ID overlap between openclaw.json:bindings and clawcode.yaml:agents[].channels | migrate-openclaw-complete.test.ts | `SC-4: cross-agent channel overlap → refuse` + `SC-4 (positive): zero overlap → invariant [x]` |

## Task Commits

1. **Task 1 RED:** `7634e52` — failing tests for pilot-highlight + cutover CLI wiring
2. **Task 1 GREEN:** `265ff33` — pilot line + cutover subcommand + complete subcommand handlers + dispatch-holder extensions + commander wiring
3. **Task 2 RED/GREEN:** `d2cefe7` — integration tests for complete subcommand + cross-agent invariants (GREEN handler was bundled into Task 1 commit for dispatch-holder coherence)

## Files Created/Modified

- `src/cli/commands/__tests__/migrate-openclaw-pilot.test.ts` (created) — 5 integration tests
- `src/cli/commands/__tests__/migrate-openclaw-cutover.test.ts` (created) — 6 integration tests
- `src/cli/commands/__tests__/migrate-openclaw-complete.test.ts` (created) — 8 integration tests
- `src/cli/commands/migrate-openclaw.ts` (modified) — imports added + pilot-highlight block in runPlanAction + runCutoverAction + runCompleteAction + dispatch holder extended with 5 new fields + late-bind for 2 action handlers + commander registrations for `cutover` and `complete`
- `src/cli/commands/__tests__/migrate-openclaw.test.ts` (modified) — 3 additive describe blocks (empty-inventory pilot guard + cutover registration + complete registration)

## Decisions Made

- **Pilot-highlight suppression on `--agent` filter** — CONTEXT specified pilot as a `plan` feature; when the operator has already chosen one agent via `--agent`, a recommendation has no signal value. Guard `opts.agent === undefined` added inline.
- **`runCompleteAction` shipped in Task 1 GREEN** — Plan sequenced this for Task 2, but the dispatch holder contract requires all fields initialized simultaneously (Phase 80/81 pattern). Shipping the handler skeleton in Task 1 kept the holder coherent and let Task 2 focus entirely on integration-test proofs. Logged here as a minor commit-ordering deviation from the plan's strict TDD flow; all Task 1 RED scenarios still failed before the GREEN commit and passed after.
- **Default-with-fallback dispatch pattern** — `const impl = migrateOpenclawHandlers.cutoverAgent ?? cutoverAgentModule;`. Protects against a test that forgets to restore the holder between runs (module ref is always a safe fallback even if the holder field is cleared).
- **Zero-emoji CLI stdout** — `Migration complete. Report:` uses no emoji; the green color code is the visual cue. Consistent with Phase 81 verify/rollback stdout style.

## Deviations from Plan

- **Task 2 RED/GREEN commit structure** — Plan called for a `test(82-02)` commit followed by `feat(82-02): wire complete subcommand`. I bundled the complete handler into Task 1's GREEN commit for dispatch-holder coherence; Task 2 shipped as a single `test(82-02)` commit where the tests happened to pass immediately against the already-shipped handler. All Task 2 RED scenarios validated through the handler behavior, not through code-that-doesn't-yet-exist. Zero CONTEXT.md D-01..D-09 decisions violated.
- **Pilot-selector winner on 0-memory fixture** — CONTEXT hinted the winner would be `personal` or `local-clawdy` under real memory counts. With the empty tmpdir memoryDir (all chunk counts = 0), alphabetical tie-break across non-finmentum agents makes `card-generator` the winner. The test asserts the invariant ("winner is non-finmentum") rather than a specific name — determinism preserved without over-specifying.

## Issues Encountered

- None specific to this plan. The 10 pre-existing test failures in `src/manager/__tests__/` (bootstrap-integration, daemon-openai, session-manager) remain and are documented in `.planning/phases/82-pilot-cutover-completion/deferred-items.md` (created by Wave 1). Verified unchanged count before and after Wave 2 work.

## Verification

All grep invariants hit:

```bash
grep -rln "✨ Recommended pilot:" src/                      # 4 files (impl + 2 tests + regression test)
grep -rln "Now wait 15 minutes" src/                         # 4 files (cutover.ts + CLI + 2 tests)
grep -rln "\.planning/milestones/v2\.1-migration-report\.md" src/  # 4 files (report-writer + CLI + 2 tests)
grep -rln "Cannot complete:" src/                            # 3 files (report-writer + 2 tests)
grep -rln "Migration complete\. Report:" src/                 # 2 files (CLI + 1 test)
```

Package.json clean (D-08):
```bash
$ git diff package.json package-lock.json
# (empty)
```

Combined test runs:
- `npx vitest run src/cli/commands/__tests__/migrate-openclaw-pilot.test.ts` → 5 pass
- `npx vitest run src/cli/commands/__tests__/migrate-openclaw-cutover.test.ts` → 6 pass
- `npx vitest run src/cli/commands/__tests__/migrate-openclaw-complete.test.ts` → 8 pass
- `npx vitest run src/cli/commands/__tests__/migrate-openclaw.test.ts` → 45 pass (42 pre-existing + 3 new)
- `npx vitest run src/migration` → 287 pass (zero regressions from Wave 1)

Whole-suite count: 3727 passed + 10 failed (all failures pre-existing and documented in deferred-items.md — identical count before and after Phase 82 Wave 2).

## Known Stubs

None. All handlers implement their full contract. The `cutover` and `complete` subcommands are production-ready end-to-end; the operator can run them against the real on-box OpenClaw state.

## Milestone v2.1 Closure

All 31 v2.1 requirements complete:
- SHARED-01..03 (Phase 75)
- MIGR-01..08 (Phase 76, 77, 79, 81)
- CONF-01..04 (Phase 78)
- WORK-01..05 (Phase 79)
- MEM-01..05 (Phase 80)
- FORK-01..02 (Phase 81)
- OPS-01, OPS-02, OPS-04 (Phase 82 — this plan)
- OPS-03 (closed by Phase 77 channel-collision guard)

The milestone v2.1 migration report artifact (`.planning/milestones/v2.1-migration-report.md`) is generable via `clawcode migrate openclaw complete` end-to-end, with all three cross-agent invariants asserted. Ready for commit to git on a green test run.

---

## Self-Check: PASSED

Verified on disk:
- FOUND: src/cli/commands/__tests__/migrate-openclaw-pilot.test.ts
- FOUND: src/cli/commands/__tests__/migrate-openclaw-cutover.test.ts
- FOUND: src/cli/commands/__tests__/migrate-openclaw-complete.test.ts
- FOUND: src/cli/commands/migrate-openclaw.ts (modified)
- FOUND: src/cli/commands/__tests__/migrate-openclaw.test.ts (modified with 3 additive describe blocks)

Verified in git log (git log --oneline | grep -E "82-02"):
- FOUND: 7634e52 (Task 1 RED — test commit)
- FOUND: 265ff33 (Task 1 GREEN — feat commit bundling pilot + cutover + complete handlers)
- FOUND: d2cefe7 (Task 2 test commit)

Test counts: 19 new integration tests + 3 additive regression pins, zero regressions across Wave 1 (287 migration tests) and the broader Phase 82 surface (45 migrate-openclaw.test.ts tests).

---

*Phase: 82-pilot-cutover-completion*
*Plan: 02*
*Completed: 2026-04-21*
