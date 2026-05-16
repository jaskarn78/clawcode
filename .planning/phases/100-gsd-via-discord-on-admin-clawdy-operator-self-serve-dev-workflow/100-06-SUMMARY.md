---
phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow
plan: 06
subsystem: cli
tags: [gsd, install, symlink, sandbox, commander, node-fs-promises, idempotent, di-pure]

# Dependency graph
requires:
  - phase: 100-04
    provides: ResolvedAgentConfig.gsd.projectDir + settingSources field — Plan 06's sandbox path will be Admin Clawdy's gsd.projectDir on production deploy
provides:
  - "`clawcode gsd install` CLI subcommand: idempotent symlinks (~/.claude/get-shit-done, ~/.claude/commands/gsd) + sandbox bootstrap (/opt/clawcode-projects/sandbox with git init)"
  - "Pure DI exports: ensureSymlink, ensureSandbox, runGsdInstallAction (testable without real filesystem)"
  - "DEFAULTS const with 5 absolute paths (operator-overridable via --skills-source, --skills-target, --commands-source, --commands-target, --sandbox flags)"
  - "registerGsdInstallCommand wrapper following the established Commander subcommand-group pattern"
affects: [100-08, plan-08-runbook, admin-clawdy-deployment]

# Tech tracking
tech-stack:
  added: []  # Zero new dependencies — uses node:fs/promises + node:child_process (Node 22 LTS built-ins)
  patterns:
    - "DI-pure CLI action — runGsdInstallAction(args) returns exit code; production wires defaults from node:fs/promises, tests inject vi.fn mocks"
    - "Idempotency via readlink-comparison + stat-existence — already-present detection without destructive ops"
    - "Source-paths-immutable invariant — INST14 spy assertion ensures no fs.unlink/symlink/mkdir call ever targets /home/jjagpal/.claude/"
    - "Path validation: assertAbsolute rejects relative paths and '..' traversal at action entry (INST15+16)"

key-files:
  created:
    - src/cli/commands/gsd-install.ts (370 lines)
    - src/cli/commands/__tests__/gsd-install.test.ts (564 lines, 16 INST tests)
  modified:
    - src/cli/index.ts (+4 lines — import + register call)

key-decisions:
  - "Symlink the PARENT directories (~/.claude/get-shit-done, ~/.claude/commands/gsd), NOT individual skill subfolders — sidesteps Issue #14836 symlink-discovery bug per RESEARCH.md Common Pitfalls §1"
  - "Target ~/.claude/commands/gsd (SDK-discoverable surface), not ~/.claude/skills/ — RESEARCH.md Common Pitfalls §2"
  - "Local-only — Plan 06 NEVER touches clawdy via SSH; production deployment is operator-driven on the clawcode user via Plan 08's runbook"
  - "Idempotency by construction: readlink-comparison detects already-correct symlinks; stat detects pre-existing .git — no destructive ops on second run"
  - "Source-paths-immutable: ensureSymlink only ever writes to TARGET paths; SOURCE paths are stat-read-only — pinned by INST14 spy invariant"
  - "Zero new npm deps — uses node:fs/promises (stat, mkdir, symlink, unlink, readlink) + node:child_process (execFile via promisify) — both Node 22 LTS built-ins"

patterns-established:
  - "Commander parent-group + subcommand pattern: program.commands.find(c => c.name() === 'gsd') ?? program.command('gsd') — sets up `clawcode gsd install` and leaves room for future `clawcode gsd status` / `clawcode gsd uninstall` siblings"
  - "16-test INST pin format mirroring Phase 96 PRO-, Phase 95 DREAM-, Phase 92 cutover- conventions"

requirements-completed: [REQ-100-05, REQ-100-08]

# Metrics
duration: 5min
completed: 2026-04-26
---

# Phase 100 Plan 06: Install helper — `clawcode gsd install` CLI subcommand Summary

**Idempotent CLI subcommand that creates two ~/.claude/ symlinks for the clawcode user (`get-shit-done`, `commands/gsd`) and bootstraps `/opt/clawcode-projects/sandbox/` as a git repo, using DI-pure helpers and zero new dependencies.**

## Performance

- **Duration:** ~5 min (parallel Wave 4 with Plan 100-07)
- **Started:** 2026-04-26T18:53:30Z
- **Completed:** 2026-04-26T18:58:36Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 3 (1 source + 1 test created, 1 index.ts edit)

## Accomplishments

- `clawcode gsd install` CLI subcommand registered as a `gsd` parent-group child — operator runs locally OR on clawdy (post-deploy per Plan 08 runbook) to bootstrap the GSD pre-flight
- 5 absolute-path DEFAULTS (skillsSource/Target, commandsSource/Target, sandboxDir) with 5 corresponding CLI override flags
- Idempotent by construction: readlink + comparison detects already-matching symlinks; stat detects pre-existing `.git`; no destructive ops on second run
- 16 hermetic INST tests cover ensureSymlink (5 cases), ensureSandbox (3 cases), runGsdInstallAction (8 cases including idempotency, source-immutability, path-validation invariants)
- Zero new npm dependencies — node:fs/promises + node:child_process built-ins
- Source-paths-immutable invariant pinned by INST14 spy assertion: `fs.unlink`, `fs.symlink` (target), `fs.mkdir`, and `gitRunner.execGit` never touch `/home/jjagpal/.claude/`

## Task Commits

Each task was committed atomically:

1. **Task 1: TDD RED — gsd-install 16-test scaffold** — `f7ba990` (test)
2. **Task 2: GREEN — clawcode gsd install CLI subcommand** — `21143fc` (feat)

_Note: Plan 100-07 ran in parallel during Wave 4 — its commit `a71a7c7` appears between the two Plan 06 commits in the linear log._

## Files Created/Modified

- `src/cli/commands/gsd-install.ts` (370 lines, NEW) — DEFAULTS, ensureSymlink, ensureSandbox, runGsdInstallAction, registerGsdInstallCommand; assertAbsolute path validation
- `src/cli/commands/__tests__/gsd-install.test.ts` (564 lines, NEW) — 16 INST tests with hermetic vi.fn() mocks for fs deps + gitRunner; stdout/stderr capture via process.stdout.write spy
- `src/cli/index.ts` (+4 lines, MODIFIED) — import + register call alongside existing `registerProbeFsCommand` / `registerFsStatusCommand`

## Defaults Table (5 paths)

| Field            | Default Path                                  | Purpose                                                            |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `skillsSource`   | `/home/jjagpal/.claude/get-shit-done`         | jjagpal's GSD library (workflows, references, templates)           |
| `skillsTarget`   | `/home/clawcode/.claude/get-shit-done`        | clawcode user's mirror — what slash commands `@`-include           |
| `commandsSource` | `/home/jjagpal/.claude/commands/gsd`          | jjagpal's slash command files (`plan-phase.md`, `autonomous.md`, …) |
| `commandsTarget` | `/home/clawcode/.claude/commands/gsd`         | SDK-discoverable surface for Admin Clawdy when `settingSources: ["project","user"]` |
| `sandboxDir`     | `/opt/clawcode-projects/sandbox`              | Empty git repo for smoke-testing GSD via Discord (Plan 08)          |

## CLI Flag Table (5 overrides)

| Flag                          | Description                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `--skills-source <path>`      | Override default skills source (jjagpal's GSD library)     |
| `--skills-target <path>`      | Override default skills target (clawcode user's mirror)    |
| `--commands-source <path>`    | Override default commands source                           |
| `--commands-target <path>`    | Override default commands target                           |
| `--sandbox <path>`            | Override default sandbox directory                         |

## Decisions Made

None beyond what's documented in `key-decisions` frontmatter — followed plan exactly.

## Deviations from Plan

None — plan executed exactly as written. All 16 INST tests passed GREEN on first run after Task 2; no auto-fixes required.

The pre-existing typecheck errors observed in unrelated files (memory/graph.test.ts, tasks/task-manager.ts, triggers/__tests__/engine.test.ts, usage/) are out of scope per the deviation_rules SCOPE_BOUNDARY clause — not caused by Plan 06 changes. `npx tsc --noEmit | grep -E "(gsd-install|cli/index\.ts)"` returns no matches confirming our code is type-clean.

## Issues Encountered

None. Plan 100-07 ran in parallel (its `--no-verify` --commit `a71a7c7` interleaves between our two commits in the linear git log) — expected for Wave 4 parallel execution; no merge conflicts because the plans touched disjoint files.

## User Setup Required

None — Plan 06 ships the CLI command; operators run it locally OR on clawdy. Production deployment runbook lives in Plan 08.

## Hand-off to Plan 08 Runbook

Plan 08's smoke-test runbook MUST include `clawcode gsd install` as a step in the production deployment procedure:

```bash
# As clawcode user on clawdy host (per Plan 08 runbook):
ssh clawcode@clawdy
clawcode gsd install
# Verify:
readlink /home/clawcode/.claude/get-shit-done    # → /home/jjagpal/.claude/get-shit-done
readlink /home/clawcode/.claude/commands/gsd     # → /home/jjagpal/.claude/commands/gsd
test -d /opt/clawcode-projects/sandbox/.git      # exits 0
```

The summary table printed by the install command tells the operator exactly which steps were `created` / `already-present` / `failed`. Re-running is safe.

## Next Phase Readiness

- Plan 100-07 (clawcode.yaml admin-clawdy fixture) is running in parallel and ships the agent config that will use `gsd.projectDir: /opt/clawcode-projects/sandbox` (matching this plan's DEFAULTS.sandboxDir)
- Plan 100-08 (smoke-test runbook) will reference `clawcode gsd install` as the production pre-flight step

## Self-Check: PASSED

Verified files exist:
- FOUND: src/cli/commands/gsd-install.ts (370 lines)
- FOUND: src/cli/commands/__tests__/gsd-install.test.ts (564 lines, 16 INST tests)
- FOUND: src/cli/index.ts (modified, registerGsdInstallCommand wired in 2 places: import + call)

Verified commits exist:
- FOUND: f7ba990 — test(100-06): RED — gsd-install 16-test scaffold
- FOUND: 21143fc — feat(100-06): GREEN — clawcode gsd install CLI subcommand

Verified test outcomes:
- FOUND: 16 tests passed (npx vitest run src/cli/commands/__tests__/gsd-install.test.ts → 16/16)
- FOUND: 549 CLI tests pass (no regressions in src/cli/)
- FOUND: gsd install --help help text renders correctly via `npx tsx src/cli/index.ts gsd install --help`

Verified frontmatter:
- requirements-completed: [REQ-100-05, REQ-100-08] (matches PLAN.md frontmatter `requirements: [REQ-100-05, REQ-100-08]`)

---
*Phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow*
*Plan: 06*
*Completed: 2026-04-26*
