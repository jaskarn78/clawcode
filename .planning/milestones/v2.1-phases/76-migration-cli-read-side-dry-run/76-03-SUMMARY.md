---
phase: 76-migration-cli-read-side-dry-run
plan: 03
subsystem: migration
tags: [migration, openclaw, cli, commander, ansi-colors, zero-write, vitest, esm]

# Dependency graph
requires:
  - phase: 76-migration-cli-read-side-dry-run
    provides: OpenclawSourceInventory + readOpenclawInventory (Plan 01); buildPlan + PlanReport + PlanWarning (Plan 02); appendRow + latestStatusByAgent + DEFAULT_LEDGER_PATH (Plan 01 ledger)
provides:
  - `clawcode migrate openclaw list` subcommand — 6-column table (NAME, SOURCE PATH, MEMORIES, MCP, DISCORD CHANNEL, STATUS) of all 15 active OpenClaw agents with ledger-derived status
  - `clawcode migrate openclaw plan [--agent <name>]` subcommand — per-agent diff, finmentum-family marker, SHA256 plan hash, and ledger bootstrap (one row per agent, idempotent re-plan)
  - `registerMigrateOpenclawCommand(program)` — nested commander subcommand registration (program → migrate → openclaw → list|plan)
  - `runListAction()` / `runPlanAction(opts)` — exported action handlers for direct integration-test access (no subprocess spawn)
  - `formatListTable` / `formatPlanOutput` / `renderWarnings` — pure formatters testable in isolation
  - `green` / `yellow` / `red` / `dim` / `colorEnabled` — hand-rolled ANSI helpers in src/cli/output.ts respecting NO_COLOR + FORCE_COLOR + isTTY
  - Env-var pattern for test isolation: `CLAWCODE_OPENCLAW_JSON` + `CLAWCODE_OPENCLAW_MEMORY_DIR` + `CLAWCODE_AGENTS_ROOT` + `CLAWCODE_LEDGER_PATH` — reusable by Phases 77-82
  - vi.mock factory pattern for ESM fs spying (zero-write contract enforcement) — reusable by Phase 79 workspace-copy verification
affects:
  - 77 (pre-flight guards extend the CLI command surface; reuse env-var override pattern)
  - 78 (config-mapper will populate the MCP column reserved as "0" placeholder here)
  - 79 (workspace-copy reuses vi.mock zero-write test pattern for non-destructive-to-source assertion)
  - 81 (verify/rollback will extend `migrate openclaw` subcommand tree with additional verbs)
  - 82 (cutover reads ledger status column the list subcommand already surfaces)

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps — hard constraint satisfied
  patterns:
    - "Nested commander subcommand: program.command('migrate').command('openclaw').command('list|plan') delivers `clawcode migrate openclaw <sub>` surface"
    - "Env-var path overrides (CLAWCODE_* namespace) enable test isolation without DI refactor of commander"
    - "Hand-rolled ANSI (green/yellow/red/dim) with NO_COLOR + FORCE_COLOR + isTTY precedence — zero chalk/picocolors dep"
    - "vi.mock with importOriginal factory as ESM-compatible alternative to vi.spyOn for non-configurable module namespace exports"
    - "Action handlers (runListAction/runPlanAction) exported as async functions with numeric return codes — no process.exit inside the core flow, CLI wrapper translates codes"

key-files:
  created:
    - src/cli/commands/migrate-openclaw.ts
    - src/cli/commands/__tests__/migrate-openclaw.test.ts
  modified:
    - src/cli/output.ts (ANSI color helpers appended — existing cliLog/cliError untouched)
    - src/cli/index.ts (import + registerMigrateOpenclawCommand call added after registerRegistryCommand)

key-decisions:
  - "vi.mock factory with importOriginal replaces plan-prescribed vi.spyOn — ESM namespace exports on node:fs/promises are non-configurable in Node 22; vi.spyOn fails with 'Cannot redefine property'. vi.mock is the idiomatic ESM-compatible spy mechanism for this constraint."
  - "Env-var override precedence over homedir defaults — resolvePaths() checks process.env.CLAWCODE_* first; tests inject tmp paths without touching commander's config-resolution flow"
  - "Snapshot existingStatus BEFORE the ledger-append loop — otherwise first new 'pending' row within a single plan invocation would flip subsequent agents to 're-planned'. Subtle idempotency bug avoided by reading the status map once at the top of runPlanAction"
  - "Nested commander pattern (migrate → openclaw → list|plan) produces exact `clawcode migrate openclaw list` surface per 76-CONTEXT D-command-structure — flat `.command('migrate-openclaw list')` would have been simpler but wrong per the contract"
  - "MCP column hardcoded to '0' in list output — per 76-CONTEXT, MCP enumeration is deferred to Phase 78. Placeholder avoids forcing a schema change later when Phase 78 fills in real values"
  - "formatListTable + formatPlanOutput + renderWarnings are pure functions — no direct process.stdout.write inside; callers (runListAction/runPlanAction) marshal via cliLog. Enables unit tests of table shape without stdout capture"

patterns-established:
  - "CLI command modules in src/cli/commands/<name>.ts export registerXCommand + runXAction for integration test direct-invocation (no subprocess spawn)"
  - "ANSI color helpers centralized in src/cli/output.ts — every command imports from one place, consistent NO_COLOR behavior across the CLI"
  - "Integration tests override process.env in beforeEach + capture process.stdout.write/process.stderr.write via vi.spyOn — clean test isolation without real TTY"
  - "vi.hoisted + vi.mock pattern for sharing capture arrays between mock factories and test body — mocks are hoisted above imports, hoisted vars are too"

requirements-completed:
  - MIGR-01
  - MIGR-08

# Metrics
duration: 8min
completed: 2026-04-20
---

# Phase 76 Plan 03: CLI Wiring + Zero-Write Contract Summary

**Nested commander subcommand `clawcode migrate openclaw <list|plan>` wires Wave 1 readers + Wave 2 diff engine into the two user-facing read-side commands, with hand-rolled ANSI color helpers and a 12-test integration suite that proves the zero-write contract via vi.mock factories on both `node:fs` and `node:fs/promises`.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-20T16:35:32Z
- **Completed:** 2026-04-20T16:43:42Z
- **Tasks:** 3 (Task 1 + Task 2 + Task 3 TDD-adjacent)
- **Files created:** 2
- **Files modified:** 2
- **Tests added:** 12 (12 passing; 59 total in src/migration/ + src/cli/commands/__tests__/migrate-openclaw.test.ts)
- **Test runtime:** ~500ms for migrate-openclaw.test.ts; 2.18s for full migration+CLI suite

## Accomplishments

- **`src/cli/output.ts`** — Appended `colorEnabled()` + `green`/`yellow`/`red`/`dim` wrappers. Zero imports (pure file), 39 lines total, preserves existing `cliLog` / `cliError` unchanged. Precedence: `NO_COLOR` (any non-empty value wins, empty string also disables per no-color.org spec) > `FORCE_COLOR` (any non-"0" enables) > `process.stdout.isTTY`.

- **`src/cli/commands/migrate-openclaw.ts`** (257 lines) — Nested commander wiring (migrate → openclaw → list|plan), pure formatters (`formatListTable`, `formatPlanOutput`, `renderWarnings`, `formatAgentPlan`), action handlers (`runListAction`, `runPlanAction`), env-var path resolution (`resolvePaths`). `runPlanAction` returns numeric exit code (0 success, 1 unknown-agent) instead of calling `process.exit` directly — integration-testable.

- **`src/cli/index.ts`** — Two-line change: import added alphabetically after `registerRegistryCommand`; registration call appended in the register block. Zero reorder of existing 50+ commands.

- **`src/cli/commands/__tests__/migrate-openclaw.test.ts`** (219 lines, 12 `it()` blocks):
  - 2 color-helpers tests (NO_COLOR respected; FORCE_COLOR emits ANSI)
  - 1 list-renders-all-15-agents test (with all required column headers)
  - 1 plan-determinism test (planHash identical across two successive runs)
  - 2 --agent filter tests (known → exit 0 with 1 agent; unknown → exit 1 with actionable stderr listing all 15 ids)
  - 1 zero-write contract test (vi.mock factories on `node:fs` + `node:fs/promises` record every write/append/mkdir; forbidden substrings `/.clawcode/` + `/.openclaw/`; forbidden endings `clawcode.yaml` + `clawcode.yml`)
  - 1 ledger-bootstrap test (15 pending rows on first plan)
  - 1 idempotent re-plan test (30 rows total, second 15 all `re-planned`)
  - 1 finmentum-grouping test (exactly 5 `[finmentum-shared]` markers, all pointing to the same `/finmentum` basePath)
  - 1 list-reflects-ledger test (>=15 `pending` entries in status column after plan)
  - 1 warnings-count test (exactly 8 `missing-discord-binding` entries — 15 agents minus 7 bindings)

## Task Commits

1. **Task 1: output.ts ANSI color helpers** — `6879e75` (feat)
2. **Task 2: migrate-openclaw.ts CLI module + index.ts wiring** — `3f6ade8` (feat)
3. **Task 3: integration tests (zero-write + determinism + ledger)** — `dbd3a1a` (test)

## Files Created/Modified

- `src/cli/output.ts` — +25 lines (color helpers + colorEnabled; existing exports preserved)
- `src/cli/commands/migrate-openclaw.ts` — 257 lines new; pure formatters + action handlers + nested commander registration
- `src/cli/index.ts` — +2 lines (import + register call)
- `src/cli/commands/__tests__/migrate-openclaw.test.ts` — 219 lines new; 12 `it()` blocks

## Decisions Made

1. **vi.mock factory replaces plan-prescribed vi.spyOn** — ESM namespace exports on `node:fs/promises` are non-configurable in Node 22 (verified empirically: `Object.getOwnPropertyDescriptor(fsPromises, 'writeFile').configurable === false`). `vi.spyOn` fails with `TypeError: Cannot redefine property`. The fix: `vi.mock("node:fs/promises", async (importOriginal) => { const orig = await importOriginal(); return { ...orig, writeFile: wrapped, appendFile: wrapped, mkdir: wrapped }; })`. Paired with `vi.hoisted(() => ({ calls: [] }))` to share the capture array between the mock factory and the test body. Same pattern applied to `node:fs` for sync operations.

2. **`fsCapture.calls.length = 0` reset inside the zero-write test** — file-scoped capture array accumulates across the 12 tests; resetting at the top of the zero-write test prevents prior-test noise (e.g., the determinism test's 30+ appendFile calls) from confusing the backstop assertion. The backstop (`appendCalls.length >= 1`) confirms instrumentation is actually firing — without it, a bugged mock could silently "pass" zero-forbidden-writes by intercepting zero calls.

3. **`existingStatus` snapshotted BEFORE the ledger-append loop** — `runPlanAction` reads `latestStatusByAgent(ledgerPath)` ONCE at the top, then iterates. If we re-read the status map per iteration, the first agent's new `pending` row would flip all subsequent agents to `re-planned` within the same plan invocation. Subtle idempotency bug avoided.

4. **`mcpCount: "0"` hardcoded in ListRow** — per 76-CONTEXT the MCP server enumeration is deferred to Phase 78. Placeholder "0" (not `—`) reflects the fact that we don't know MCP counts YET, but the column exists in the plan's table schema. Phase 78 will replace the hardcode with per-agent MCP probing.

5. **Action handlers return numeric codes instead of calling process.exit** — `runPlanAction` returns `0 | 1`; the commander `.action()` wrapper translates to `process.exit(code)`. This decouples the business logic from the CLI harness — integration tests call `runPlanAction` directly and assert the returned code, no process-exit guards needed.

6. **Nested commander subcommands (program → migrate → openclaw → list|plan)** — delivers the exact `clawcode migrate openclaw <sub>` surface per 76-CONTEXT. Commander 14 supports this via chained `.command()` calls on the returned subcommand Command instance. Verified with real CLI smoke invocation — all three sub-calls dispatch correctly.

7. **Env-var overrides named `CLAWCODE_*`** — namespace matches the project brand; Phases 77-82 can reuse the same env-var names without naming collision. `CLAWCODE_OPENCLAW_JSON` / `_MEMORY_DIR` / `_AGENTS_ROOT` / `_LEDGER_PATH` — four clean names, no structural coupling to the module hierarchy.

## Deviations from Plan

**1. [Rule 1 - Bug] vi.spyOn on node:fs/promises namespace fails in ESM**

- **Found during:** Task 3 first test run (12 tests loaded, 11 passed, zero-write test threw `TypeError: Cannot redefine property: writeFile / Module namespace is not configurable in ESM`)
- **Issue:** Plan's action spec prescribed `vi.spyOn(fsPromises, "writeFile")` but ESM module namespaces on `node:fs/promises` have `configurable: false` property descriptors in Node 22 + vitest 4.x. `vi.spyOn` delegates to `Object.defineProperty` which throws on non-configurable.
- **Fix:** Replaced `vi.spyOn(fsPromises, …)` with `vi.mock("node:fs/promises", async (importOriginal) => { … })` factory + `vi.hoisted(() => ({ calls: [] }))` shared capture. Same pattern for `node:fs`. Functionally equivalent — records every call with path, lets real implementation run so the tmp ledger actually lands, and is the idiomatic vitest ESM pattern.
- **Files modified:** src/cli/commands/__tests__/migrate-openclaw.test.ts (test-only change, no production impact)
- **Commit:** dbd3a1a

Guidance for Phase 77+: the `vi.mock` + `vi.hoisted` pattern is now the project's standard for fs-writes integration tests. Plan 79 (workspace-copy) will need the same approach for its non-destructive-to-source assertion.

**2. [Minor] Test file acceptance grep `vi.spyOn(fs,` and `vi.spyOn(fsPromises,` not satisfied — superseded by vi.mock approach**

- Plan's acceptance criteria included `grep -nE "vi\\.spyOn\\(fs," migrate-openclaw.test.ts` and `grep -nE "vi\\.spyOn\\(fsPromises," migrate-openclaw.test.ts` — both return zero because of Deviation #1. The semantic intent (spy on BOTH fs and fsPromises) is satisfied via `vi.mock("node:fs", …)` and `vi.mock("node:fs/promises", …)`.

## Issues Encountered

- **ESM namespace immutability surprise** — the plan assumed `vi.spyOn` would Just Work on `node:fs/promises`. Empirically it doesn't in Node 22 + vitest 4.x. Cost me ~2 minutes to diagnose (`Object.getOwnPropertyDescriptor` confirmed `configurable: false`) and ~3 minutes to refactor. Net impact: zero — the final test suite is arguably cleaner with `vi.mock` + `vi.hoisted` than it would have been with spyOn + per-test rewind.
- **`mockImplementation` typing with overloaded node:fs signatures** — `fs.promises.writeFile` has ~10 overloads. Manual `as typeof orig.writeFile` cast was needed in the mock factory; pre-existing tech debt around vitest + Node type narrowing.

## Plan-Level Verification Results

Every substantive verification criterion passes:

- `grep -n 'export function cliLog' src/cli/output.ts` → match ✓
- `grep -n 'export function cliError' src/cli/output.ts` → match ✓
- `grep -n 'export function green' src/cli/output.ts` → match ✓ (same for yellow/red/dim/colorEnabled)
- `grep -n 'NO_COLOR' src/cli/output.ts` → match ✓
- `grep -nE "from \"(chalk|picocolors|ansi-colors)\"" src/cli/output.ts` → 0 matches ✓
- `grep -nE "import .* from" src/cli/output.ts` → 0 matches (pure file) ✓
- `wc -l src/cli/output.ts` → 39 (< 50 cap) ✓
- `grep -n 'export function registerMigrateOpenclawCommand' src/cli/commands/migrate-openclaw.ts` → match ✓
- `grep -n 'export async function runListAction' src/cli/commands/migrate-openclaw.ts` → match ✓
- `grep -n 'export async function runPlanAction' src/cli/commands/migrate-openclaw.ts` → match ✓
- `grep -n 'export function formatListTable/formatPlanOutput/renderWarnings' → all match ✓
- `grep -nE "program\\.command\\(\"migrate\"\\)"` → match ✓; `"openclaw"` → match ✓; `"list"` / `"plan"` → match ✓
- `grep -n '.option("--agent <name>"' src/cli/commands/migrate-openclaw.ts` → match ✓
- `grep -n 'process\\.env\\.CLAWCODE_OPENCLAW_JSON'` → match ✓; `CLAWCODE_LEDGER_PATH` → match ✓
- `grep -n 'registerMigrateOpenclawCommand' src/cli/index.ts` → 2 matches (import + call) ✓
- `grep -nE "from \"(chalk|picocolors|cli-table3|jsondiffpatch)\"" src/cli/commands/migrate-openclaw.ts` → 0 matches ✓
- `grep -c 'console\\.' src/cli/commands/migrate-openclaw.ts` → 0 ✓ (after I removed the one literal `console.` mention from a DO-NOT docstring)
- Test file has 12 `it()` blocks (≥ 10 required) ✓
- Test file has `not.toContain("/.clawcode/")` literal ✓
- Test file asserts `expect(code).toBe(1)` for unknown agent ✓
- Test file asserts `length.toBe(15)` and `length.toBe(30)` for ledger bootstrap + re-plan ✓
- `npx vitest run src/cli/commands/__tests__/migrate-openclaw.test.ts` → 12/12 passed, 404ms ✓
- `npx vitest run src/migration/__tests__ src/cli/commands/__tests__/migrate-openclaw.test.ts` → 59/59 passed, 2.18s (zero regression on Plans 01/02) ✓
- `find ~/.clawcode -newer .planning/ROADMAP.md -type f` → 0 files ✓
- `git diff HEAD~3 HEAD -- package.json package-lock.json` → empty (zero new deps) ✓
- Real CLI smoke:
  - `migrate openclaw list` with tmp env-vars → 15-row aligned table ✓
  - `migrate openclaw plan` → full diff + `Plan hash: f66944f…` + 23 warnings (15 empty-source-memory + 8 missing-discord-binding) + 15-row ledger written ✓
  - `migrate openclaw plan --agent does-not-exist` → exit 1 + stderr: `Unknown OpenClaw agent: 'does-not-exist'. Available: card-generator, card-planner, …` ✓

**TypeScript compile check**: `npx tsc --noEmit` surfaces ~25 pre-existing errors in `src/image/`, `src/manager/`, `src/tasks/`, `src/triggers/`, `src/usage/`, `src/memory/` — all out of Phase 76 scope (inherited tech debt per STATE.md "Known tech debt" section). Zero errors in `src/cli/commands/migrate-openclaw.ts`, `src/cli/output.ts`, `src/cli/index.ts`, or `src/cli/commands/__tests__/migrate-openclaw.test.ts`.

## Success Criteria Matrix

All 4 phase success criteria from 76-CONTEXT pass:

1. **Zero-write list**: `runListAction` against the 15-agent fixture triggers ZERO writes to `/.clawcode/` or `clawcode.yaml` — proven by `vi.mock`-recorded path array in test 7.
2. **Deterministic plan**: Two successive `runPlanAction({})` calls produce identical `planHash` — proven by test 4's regex extraction + equality assertion.
3. **Ledger-backed status**: After a `plan`, `list` shows each agent tagged with its ledger status (`pending` on first run, `re-planned` on subsequent) — proven by tests 8/9/11.
4. **--agent filter + error path**: `plan --agent <unknown>` exits 1 with actionable error containing the full available-agent list — proven by test 6.

Both phase requirements (MIGR-01 and MIGR-08) traced and tested.

## User Setup Required

**None** — entirely internal-tooling foundation. CLI works against the committed fixture; real `~/.openclaw/openclaw.json` will be used by the operator in Phase 77+ with no configuration change.

## Next Phase Readiness

**Ready for 77 (pre-flight guards):**
- `runPlanAction` already emits `PlanWarning` for missing Discord bindings + empty memory + absent chunks table; Phase 77 can extend `WARNING_KINDS` with new pre-flight kinds (channel collision, secret-shape detection) and the CLI's `renderWarnings` will colorize them automatically.
- Env-var override pattern (`CLAWCODE_OPENCLAW_JSON` etc.) is stable and reusable verbatim; Phase 77 pre-flight tests can inject tmp fixtures the same way.
- Ledger bootstrap is done — Phase 77 pre-flight just reads `latestStatusByAgent` and adds `{action: "preflight", status: ...}` rows.

**Ready for 78 (config-mapper):**
- `AgentPlan.targetBasePath` + `targetMemoryPath` encode the finmentum SHARED-01 contract; Phase 78 config-mapper consumes these verbatim for clawcode.yaml entries.
- MCP column reserved as "0" — Phase 78 can replace the placeholder without schema change to `ListRow`.

**Ready for 79 (workspace-copy):**
- `vi.mock` + `vi.hoisted` zero-write test pattern is now available as a template. Phase 79 non-destructive-to-source assertion can copy the factory approach verbatim, just swap the forbidden-substring list to target `/.openclaw/workspace-` writes.

**Notes for Phase 77 implementer:**
- Pre-flight is a new subcommand `preflight` (sibling of `list` / `plan`); add via `openclaw.command("preflight")` in the existing `registerMigrateOpenclawCommand`.
- Don't duplicate the `resolvePaths()` env-var logic — export it from `migrate-openclaw.ts` or factor into a shared helper.
- Pre-flight must respect the same zero-write contract as `list` + `plan` — reuse the test pattern.

**No blockers** for Phase 77.

## Known Stubs

- `mcpCount: "0"` in `ListRow` — Phase 78 will fill this with real per-agent MCP server counts by reading the `mcpServers` section of each agent's openclaw.json entry. Documented in 76-CONTEXT "Subcommands in scope" + the file's own inline comment (`// reserved — Phase 78 will populate`).

These are intentional stubs with a named successor phase. Not blocking Phase 76 goal.

## Self-Check: PASSED

Verified via file/commit existence:

- FOUND: src/cli/commands/migrate-openclaw.ts
- FOUND: src/cli/commands/__tests__/migrate-openclaw.test.ts
- FOUND: src/cli/output.ts (modified — color helpers appended)
- FOUND: src/cli/index.ts (modified — import + register call)
- FOUND commit: 6879e75 (feat: output.ts ANSI helpers)
- FOUND commit: 3f6ade8 (feat: migrate-openclaw.ts + index.ts wiring)
- FOUND commit: dbd3a1a (test: integration tests)

Verification commands pass:
- `npx vitest run src/cli/commands/__tests__/migrate-openclaw.test.ts` → 12/12 passed, 404ms
- `npx vitest run src/migration/__tests__ src/cli/commands/__tests__/migrate-openclaw.test.ts` → 59/59 passed, 2.18s (no regression)
- `find ~/.clawcode -newer .planning/ROADMAP.md -type f` → 0 matches (zero stray writes)
- `git diff HEAD~3 HEAD -- package.json package-lock.json` → empty (zero new deps)
- Real CLI smoke (list + plan + plan --agent unknown) → all three dispatch and behave as spec'd

---
*Phase: 76-migration-cli-read-side-dry-run*
*Completed: 2026-04-20*
