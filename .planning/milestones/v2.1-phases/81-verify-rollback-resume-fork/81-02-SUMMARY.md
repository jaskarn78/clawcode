---
phase: 81-verify-rollback-resume-fork
plan: 02
subsystem: migration
tags: [cli, verify, rollback, resume, idempotency, ledger, commander, typescript]

requires:
  - phase: 81-01
    provides: verifyAgent + rollbackAgent + SourceCorruptionError + hashSourceTree
  - phase: 78-config-mapping-yaml-writer
    provides: migrateOpenclawHandlers dispatch holder pattern + writeClawcodeYaml
  - phase: 76-migration-cli-read-side-dry-run
    provides: registerMigrateOpenclawCommand + formatListTable column-width pattern

provides:
  - "clawcode migrate openclaw verify [agent]" — aligned-column emoji table + ledger witness + exit 0/1
  - "clawcode migrate openclaw rollback <agent>" — atomic rollback + SourceCorruptionError branch
  - runVerifyAction — iterates migrated/verified/rolled-back ledger statuses, emits per-agent verify:complete or verify:fail rows
  - runRollbackAction — wraps Plan 01 rollbackAgent, maps outcome → stdout/stderr + exit code
  - formatVerifyTable — pure aligned-column table formatter with load-bearing ✅/❌/⏭ emoji literals
  - migrateOpenclawHandlers dispatch holder extended with verifyAgent, rollbackAgent, runVerifyAction, runRollbackAction for ESM-safe test DI
  - MIGR-03 witness — direct MemoryStore insert test proves zero duplicate origin_id rows on re-insert

affects:
  - 81-03 (fork-to-Opus cost visibility + pilot rehearsal — uses verify/rollback subcommands in the rehearsal runbook)
  - Phase 82 (pilot+cutover — operator workflow invokes verify before each apply and rollback on any failed verification)

tech-stack:
  added: []  # zero new npm deps — commander + existing CLI output helpers + node:crypto
  patterns:
    - "Late-bind dispatch pattern for action handlers defined AFTER the dispatch holder — placeholder async () => 0 closures at init, real fns assigned post-definition"
    - "Load-bearing emoji literals in VERIFY_STATUS_EMOJI const — grep-verifiable contract against ASCII substitution drift"
    - "Commander subcommand walk for test registration assertion: program.commands.find(name==='migrate').commands.find(name==='openclaw').commands.find(...)"
    - "Multi-agent iteration gated by ledger status set {migrated, verified, rolled-back} — pending agents skipped with note"

key-files:
  created: []
  modified:
    - src/cli/commands/migrate-openclaw.ts
    - src/cli/commands/__tests__/migrate-openclaw.test.ts

key-decisions:
  - "runApplyAction resume semantics are idempotent re-run (not skip) — the CLI does NOT short-circuit migrated agents; idempotency is enforced at the DB layer via origin_id UNIQUE. The integration test asserts re-run succeeds + same callLog + zero duplicate origin_ids rather than 'translator not called second time'."
  - "verify iterates ledger statuses ∈ {migrated, verified, rolled-back} — rolled-back agents are re-verifiable (a common forensic flow: rollback, re-apply, verify); pending agents (never applied) have nothing to verify."
  - "ledger rows go to {agent: 'ALL'} when opts.only is undefined in runApplyAction — the 'migrated' status is a BULK run attribute, not per-agent. Integration tests assert on step='write' + outcome='allow' rather than latestStatusByAgent(agent)==='migrated'."
  - "Late-bind the action handlers into migrateOpenclawHandlers because the holder lives BELOW the fn definitions in the source file (Phase 76 historical layout). Placeholder async () => 0 closures at init satisfy the type, real fns assigned post-definition. Preserves the dispatch-holder test DI pattern without reordering the file."
  - "Integration tests use a single-agent fixture (AGENT_NAME='alpha') with model.primary = 'anthropic-api/claude-sonnet-4-5' (DEFAULT_MODEL_MAP covers it → 'sonnet', a valid config enum). Baseline clawcode.yaml requires agents min 1 (placeholder) + top-level mcpServers {clawcode, 1password} defs (AUTO_INJECT_MCP pre-populates them per-agent)."
  - "Source memory sqlite NOT staged in test fixture (withMemoriesDb defaults to false) — fake bytes aren't a valid SQLite file and readChunkCount can't open them. Tests that need chunk counts > 0 can opt-in."

patterns-established:
  - "Aligned-column table formatter: padEnd-based column-width calc mirroring formatListTable + formatCostsTable — no cli-table3 dep. Per-agent blocks separated by blank line (\\n\\n) so multi-agent verify output is grep-parseable by agent."
  - "Env-var → action-args plumbing: CLI reads process.env.CLAWCODE_DISCORD_TOKEN + process.env.CLAWCODE_VERIFY_OFFLINE, forwards as discordToken + offline args to the pure module. Keeps verifier.ts module pure (no env reads); CLI owns env surface area."
  - "Commander subcommand registration test pattern: walk program.commands tree, assert .registeredArguments[0].required matches (required: true for <agent>, required: false for [agent])."
  - "CLAUDE.md enforcement: followed /gsd:execute-phase workflow; no direct repo edits outside the plan's task scope; task commits use conventional-commits feat/test/refactor prefixes with {phase}-{plan} scope."

requirements-completed: [MIGR-03, MIGR-04, MIGR-05]

# Metrics
duration: 17min
completed: 2026-04-20
---

# Phase 81 Plan 02: Verify + Rollback CLI Subcommands Summary

**`clawcode migrate openclaw verify [agent]` + `rollback <agent>` subcommands wired into Commander via late-bound migrateOpenclawHandlers dispatch holder, with 15 unit tests pinning formatVerifyTable emoji literals + env-var forwarding + ledger witness rows, plus 7 integration tests proving MIGR-03 resume idempotency (zero duplicate origin_ids on re-run) + MIGR-04/05 end-to-end verify/rollback cycles.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-04-20T23:36:23Z
- **Completed:** 2026-04-20T23:53:50Z
- **Tasks:** 2
- **Files modified:** 2 (migrate-openclaw.ts + its test file)
- **Tests added this plan:** 22 (15 unit + 7 integration)
- **Tests passing (file scope):** 42/42
- **Tests passing (migration scope):** 235/235

## Accomplishments

- Wired Plan 01's `verifyAgent` + `rollbackAgent` modules into the CLI as two new Commander subcommands under `clawcode migrate openclaw`
- Added `formatVerifyTable` pure helper with load-bearing ✅/❌/⏭ emoji literals (grep-verifiable contract against ASCII substitution)
- Extended `migrateOpenclawHandlers` dispatch holder with four new fields (`verifyAgent`, `rollbackAgent`, `runVerifyAction`, `runRollbackAction`) for ESM-safe test DI
- Implemented `runVerifyAction` — iterates all agents whose latest ledger status ∈ {migrated, verified, rolled-back}, forwards `CLAWCODE_DISCORD_TOKEN` + `CLAWCODE_VERIFY_OFFLINE` env vars, writes per-agent `verify:complete` (allow) or `verify:fail` (refuse) ledger rows, returns aggregate exit code 0/1
- Implemented `runRollbackAction` — wraps `rollbackAgent`, catches `SourceCorruptionError` with mismatches list, emits the literal "source tree was modified during rollback" copy on the refuse path
- Wrote the critical MIGR-03 witness test: direct MemoryStore insert against the same `origin_id` twice, assert `GROUP BY origin_id HAVING COUNT(*) > 1` returns zero rows — proves the DB-level UNIQUE invariant that makes resume safe
- Wrote end-to-end integration tests for verify happy/fail paths, rollback source-invariant preservation (hashSourceTree before/after byte-identical), and apply→rollback→apply cycle restoration

## Task Commits

1. **Task 1 RED — failing tests for verify + rollback CLI** — `86c030e` (test)
2. **Task 1 GREEN — wire verify + rollback subcommands into migrate CLI** — `e793c51` (feat)
3. **Task 2 — resume + verify + rollback integration tests** — `a5e2a71` (test)

_Plan metadata commit follows the SUMMARY write._

## Files Created/Modified

- **`src/cli/commands/migrate-openclaw.ts`** (modified) — ~150 LOC added: `VERIFY_STATUS_EMOJI` const, `formatVerifyTable` helper, `runVerifyAction`, `runRollbackAction`, extended dispatch holder with `verifyAgent`/`rollbackAgent`/`runVerifyAction`/`runRollbackAction` fields, late-bind for the action handlers, and two new `openclaw.command(...)` registrations under `registerMigrateOpenclawCommand`.
- **`src/cli/commands/__tests__/migrate-openclaw.test.ts`** (modified) — ~670 LOC added across two new describe blocks: "Phase 81 Plan 02 — verify + rollback CLI" (15 unit tests) and "Phase 81 Plan 02 — integration: resume + verify + rollback end-to-end" (7 integration tests). Also added `existsSync` + `latestStatusByAgent` imports.

## Decisions Made

- **Resume semantics are idempotent re-run, not skip.** `runApplyAction` does NOT short-circuit migrated agents; idempotency is enforced at the DB layer via `origin_id` UNIQUE. The MIGR-03 integration test was adjusted to assert "re-run succeeds + translator invoked same way + zero duplicate origin_ids in resulting DB" rather than "translator not called on second run". This matches the actual Phase 76+77+80 code behavior — resume safety comes from the database contract, not from CLI-level skip logic.

- **Verify iterates ledger statuses ∈ {migrated, verified, rolled-back}.** Rolled-back agents are RE-VERIFIABLE (a common forensic flow: rollback, re-apply, verify). Pending agents (those with only a `plan` row) have nothing to verify — they're skipped silently. The CONTEXT's "multi-agent" verify spec is satisfied by filtering the `latestStatusByAgent` map on this allow-set.

- **Late-bind pattern for the action handlers.** `migrateOpenclawHandlers` lives BELOW `runVerifyAction` / `runRollbackAction` definitions in the source file (Phase 76 historical layout). Rather than restructure the whole file, the holder initializes with placeholder `async () => 0` closures for the two new fields and reassigns real fn references post-definition. The Commander wiring goes through the holder, so tests swap mocks without rebinding module namespace exports. Preserves Phase 78's dispatch-holder test DI pattern with a minimal-diff file change.

- **Load-bearing emoji literals.** `VERIFY_STATUS_EMOJI = { pass: "✅" (U+2705), fail: "❌" (U+274C), skip: "⏭" (U+23ED) }`. The 81-CONTEXT pins these exact codepoints; downstream regression tests `grep` for them verbatim. `VERIFY_STATUS_EMOJI` is `Object.freeze`d to prevent accidental mutation and exported for test visibility.

- **Ledger row `verify:complete` vs `verify:fail` with `source_hash: "n/a"`.** `source_hash` is required by the ledger zod schema but verify doesn't hash the source tree (it's Plan 01's rollback-side invariant). Using `"n/a"` as a sentinel keeps the row schema-valid; the `step` field (`verify:complete` / `verify:fail`) and `outcome` (`allow` / `refuse`) carry the actual witness semantics.

- **Fixture design: single-agent + full AUTO_INJECT_MCP baseline.** The integration fixture uses one agent (`alpha`) with `model.primary = "anthropic-api/claude-sonnet-4-5"` (DEFAULT_MODEL_MAP covers it → `sonnet`, a valid config enum). Baseline `clawcode.yaml` needs ≥ 1 agent (schema min 1) + top-level `mcpServers: { clawcode, 1password }` definitions (AUTO_INJECT_MCP auto-injects these into every migrated agent; loader validates the cross-reference). Placeholder agent with `channels: []` never collides with the real agent's empty channel array.

- **Source memory sqlite NOT staged by default.** `withMemoriesDb: false` default because fake bytes aren't a valid SQLite database and `readChunkCount` fails opening them. Tests that need realistic source chunk counts can stage a real tiny sqlite, but none of Plan 02's witnesses require it.

## Deviations from Plan

None — plan executed exactly as written, with two small implementation clarifications captured in "Decisions Made" above (late-bind pattern + fixture model choice). Both were anticipated by the plan's `<action>` guidance ("Verify the actual runApplyAction ledger/skip behavior during implementation and adjust assertions accordingly" / "model.primary... that DEFAULT_MODEL_MAP covers"). Zero new npm deps, zero scope creep, zero architectural changes.

**Total deviations:** 0.
**Impact on plan:** Plan spec preserved byte-exact on all load-bearing contracts (emoji literals, subcommand names, env var names, ledger step literals, exit-code semantics).

## Issues Encountered

Three small fixture-wiring issues surfaced during Task 2 integration-test development, all resolved without changing production code:

1. **Fake SQLite bytes failed readChunkCount.** Initial fixture wrote `"fake sqlite bytes"` to `<agent>.sqlite` — better-sqlite3 threw `"file is not a database"` when `gatherChunkCounts` tried to read it. Fix: changed `withMemoriesDb` default to `false`; integration tests that don't need chunk counts skip the staging.
2. **Config schema requires ≥ 1 agent.** Empty `agents: []` baseline failed `loadConfig` inside `detectChannelCollisions` pre-flight guard. Fix: added a placeholder agent with empty channels to satisfy the min-1 schema rule without triggering collisions.
3. **AUTO_INJECT_MCP cross-reference.** The config-mapper auto-injects `clawcode` + `1password` MCP server refs into every migrated agent; the loader validates these against the top-level `mcpServers` definitions and throws if absent. Fix: added both definitions (with the required `name` field — `mcpServerSchema` requires `name: z.string().min(1)`) to the baseline YAML.

TypeScript errors in test file from untyped `vi.fn(async () => [...])` inference (`mock.calls` typed as `never[][]`) fixed by wrapping in `as unknown as Array<[{...}]>` casts rather than reshaping the mock signatures — keeps test readability.

## User Setup Required

None — no external service configuration required. `CLAWCODE_DISCORD_TOKEN` and `CLAWCODE_VERIFY_OFFLINE` are operator-facing env vars documented inline in the verify subcommand's usage; operators set them only when running verify interactively.

## Acceptance Criteria Verification

Task 1 acceptance:
- `grep -c "runVerifyAction" src/cli/commands/migrate-openclaw.ts` → 7 (≥ 3 required) ✓
- `grep -c "runRollbackAction" src/cli/commands/migrate-openclaw.ts` → 7 (≥ 3 required) ✓
- `grep -c '\\.command("verify")' src/cli/commands/migrate-openclaw.ts` → 1 ✓
- `grep -c '\\.command("rollback")' src/cli/commands/migrate-openclaw.ts` → 1 ✓
- `grep -c "✅\\|❌\\|⏭" src/cli/commands/migrate-openclaw.ts` → 4 (≥ 3 required) ✓
- `grep -c "CLAWCODE_DISCORD_TOKEN" src/cli/commands/migrate-openclaw.ts` → 2 ✓
- `grep -c "CLAWCODE_VERIFY_OFFLINE" src/cli/commands/migrate-openclaw.ts` → 2 ✓
- `grep -c "verify:complete\\|verify:fail" src/cli/commands/migrate-openclaw.ts` → 3 ✓
- `grep -c "SourceCorruptionError" src/cli/commands/migrate-openclaw.ts` → 3 (≥ 2 required) ✓
- `grep -c "source tree was modified during rollback" src/cli/commands/migrate-openclaw.ts` → 2 (≥ 1 required; 1 in docstring + 1 in runtime) ✓
- 15 Task 1 tests pass ✓
- `npx tsc --noEmit` returns 0 errors on the migrate-openclaw files ✓

Task 2 acceptance:
- `grep -c "Phase 81 Plan 02 — integration" src/cli/commands/__tests__/migrate-openclaw.test.ts` → 2 (describe block + test describe) ✓
- `grep -c "duplicate origin_id\\|GROUP BY origin_id" src/cli/commands/__tests__/migrate-openclaw.test.ts` → 6 ✓
- `grep -c "hashSourceTree" src/cli/commands/__tests__/migrate-openclaw.test.ts` → 5 ✓
- `grep -c "SourceCorruptionError" src/cli/commands/__tests__/migrate-openclaw.test.ts` → 3 ✓
- 7 Task 2 integration tests pass ✓
- Full migrate-openclaw test file: 42/42 pass ✓
- Full migration test suite: 235/235 pass ✓
- Plan 01 suites (verifier + rollbacker + yaml-writer): 47/47 pass ✓

Invariants:
- `grep -rn "INSERT INTO vec_memories" src/migration/` → 0 (Phase 80 raw-SQL ban preserved) ✓
- Zero new npm deps ✓

## Self-Check: PASSED

File existence:
- `src/cli/commands/migrate-openclaw.ts` — FOUND (extended from 879 → ~1065 LOC)
- `src/cli/commands/__tests__/migrate-openclaw.test.ts` — FOUND (extended from 694 → ~1737 LOC)
- `.planning/phases/81-verify-rollback-resume-fork/81-02-SUMMARY.md` — FOUND (this file)

Commit existence (via `git log --oneline`):
- `86c030e` — test(81-02): add failing tests for verify + rollback CLI ✓
- `e793c51` — feat(81-02): wire verify + rollback subcommands into migrate CLI ✓
- `a5e2a71` — test(81-02): add resume + verify + rollback integration tests ✓

Test suite:
- Plan 02 scope: 22/22 new tests pass
- Full file: 42/42 pass
- Migration dir: 235/235 pass
- Plan 01 regression: 47/47 still green (verifier + rollbacker + yaml-writer)

## Next Phase Readiness

**Plan 81-02 closes MIGR-03 + MIGR-04 + MIGR-05.** Plan 81-03 (fork-to-Opus regression + cost visibility + pilot rehearsal) has everything it needs:

- `clawcode migrate openclaw verify <agent>` is the rehearsal's pre-cutover gate
- `clawcode migrate openclaw rollback <agent>` is the abort path for any failed verification
- Resume idempotency is pinned via the MIGR-03 origin_id witness test — Plan 03 can exercise mid-flight interruption during pilot confidently

No blockers for 81-03. No pre-existing failures were introduced; the 11 pre-existing unrelated test failures from Plan 01's SUMMARY (daemon-openai, bootstrap-integration, session-manager, shared-workspace.integration) are still unrelated to migration and remain deferred.

---
*Phase: 81-verify-rollback-resume-fork*
*Completed: 2026-04-20*
