---
phase: 77-pre-flight-guards-safety-rails
plan: 02
subsystem: migration
tags: [guards, pre-flight, apply, systemctl, secret-scan, channel-collision, fail-fast]

# Dependency graph
requires:
  - phase: 77-pre-flight-guards-safety-rails
    provides: "ledgerRowSchema extended with step/outcome/file_hashes (77-01); LEDGER_OUTCOMES closed enum"
  - phase: 76-migration-cli-read-side-dry-run
    provides: "OpenclawSourceInventory, PlanReport, appendRow, loadConfig"
provides:
  - "src/migration/guards.ts — 4 pre-flight guards (checkDaemonRunning, assertReadOnlySource, scanSecrets, detectChannelCollisions) + ReadOnlySourceError + computeShannonEntropy + 3 literal-message constants"
  - "src/migration/apply-preflight.ts — runApplyPreflight orchestrator with fail-fast canonical order and per-guard ledger writes"
  - "GuardResult shape — {pass, message, ledgerRow, reportBody?} — reusable by Phase 78+ write boundaries (scanSecrets on every YAML write)"
  - "Default runner around node:child_process.execFile — zero new deps, execa-shape shim for systemctl invocation"
affects: [77-03, 78-apply-writes, 79-workspace-copy, 80-memory-translation, 81-verify-rollback, 82-pilot-cutover]

# Tech tracking
tech-stack:
  added: []  # Zero new dependencies — used node:child_process.execFile as execa shim
  patterns:
    - "Pure-function guards with DI — execaRunner + ts injection keeps guards unit-testable without process spawning"
    - "Three-phase secret classification: explicit prefix (sk-/MT-) ALWAYS wins over whitelist wins over high-entropy fallback — ordering discovered during TDD and pinned in tests"
    - "BFS walker with key-path tracking — offender's location encoded in ledgerRow.notes for operator diagnostics (e.g., 'agents[1].sourceModel')"
    - "Aligned-column report formatter pattern — header widths include label lengths so table underlines correctly even for narrow rows"
    - "Witness row for pre-flight:readonly — orchestrator records one row per guard to keep ledger ordering consistent; runtime fs-interceptor install deferred to Plan 03"

key-files:
  created:
    - "src/migration/guards.ts"
    - "src/migration/apply-preflight.ts"
    - "src/migration/__tests__/guards.test.ts"
    - "src/migration/__tests__/apply-preflight.test.ts"
    - ".planning/phases/77-pre-flight-guards-safety-rails/77-02-SUMMARY.md"
  modified: []

key-decisions:
  - "Zero new deps — replaced execa (listed in CONTEXT as in-deps but not actually installed) with node:child_process.execFile shim. execaRunner DI means the default can change in a future phase without touching guards."
  - "Secret-shape detection three-phase order: explicit prefix (sk-/MT-) → whitelist → high-entropy. Discovered during TDD: sk- tokens satisfy SHORT_IDENT (all [a-z0-9-]) so a naive whitelist-first check silently passed them. Pinned this ordering in two tests (sk- refuse, op:// allow)."
  - "scanSecrets walks only report.agents — not the entire PlanReport. Reason: generatedAt/planHash/sourcePath/targetRoot are computed by trusted code and would produce false positives on opaque hash prefixes. Keeps fleet-wide agent='ALL' in ledger rows semantically honest."
  - "Orchestrator writes pre-flight:readonly as a pure witness row — Plan 03's CLI entry owns the actual fs.writeFile/appendFile/mkdir interceptor install. This keeps the 4-row canonical ledger sequence intact even though no interceptor is wired this phase."
  - "Filter threading: daemon+readonly+channel use agent=filter ?? 'ALL'; secret stays fleet-wide (agent='ALL') by design because the scan walks the entire PlanReport regardless of --only. This asymmetry is tested explicitly."

patterns-established:
  - "execaRunner DI shape — {stdout, exitCode} Promise; default wraps node:child_process.execFile with ENOENT → reject, non-zero exit → resolve-with-stdout semantics. Reusable by Phase 78+ for systemctl cutover invocations."
  - "GuardResult envelope — every guard returns {pass, message, ledgerRow, reportBody?}. Orchestrator pattern: appendRow BEFORE evaluating pass/fail so forensic evidence survives crashes mid-evaluation."

requirements-completed: [MIGR-02, MIGR-07, OPS-03]

# Metrics
duration: ~7min
completed: 2026-04-20
---

# Phase 77 Plan 02: Pre-flight Guards Implementation Summary

**Two pure-logic modules delivering the 4-guard pre-flight chain (daemon → readonly → secret → channel) with fail-fast ordering, per-guard ledger witnesses, and literal-string refusal messages pinned in tests — zero new dependencies, 28 new unit tests, zero regressions.**

## Performance

- **Duration:** ~7 min (~460s)
- **Started:** 2026-04-20T17:14:43Z
- **Tasks:** 2 (both test-first TDD)
- **Files created:** 4 source + 1 summary
- **Tests added:** 28 (21 guards + 7 orchestrator)

## Accomplishments

- Exported `checkDaemonRunning`, `assertReadOnlySource`, `scanSecrets`, `detectChannelCollisions`, `ReadOnlySourceError`, `computeShannonEntropy`, plus 3 literal-message constants (`DAEMON_REFUSE_MESSAGE`, `SECRET_REFUSE_MESSAGE`, `SYSTEMD_FALLBACK_MESSAGE`) from `src/migration/guards.ts`.
- Exported `runApplyPreflight`, `ApplyPreflightArgs`, `ApplyPreflightResult` from `src/migration/apply-preflight.ts` with canonical fail-fast ordering and per-guard ledger writes.
- BFS walker with key-path tracking (`agents[1].sourceModel` style) so operator diagnostics point directly at offenders.
- Aligned-column collision report with header / separator / body rows / footer — ready for CLI verbatim printing in Plan 03.
- Zero npm dependency changes: `execa` (listed in 77-CONTEXT as in-deps but not actually installed) replaced by a `node:child_process.execFile` shim injected via `execaRunner` DI.
- All 28 new tests pass; all 83 pre-existing migration tests still pass.

## Task Commits

Each task was committed atomically with TDD discipline:

1. **Task 1 RED — failing tests for 4 pre-flight guards** — `56c6c52` (test)
2. **Task 1 GREEN — implement 4 guards + ReadOnlySourceError** — `b08a402` (feat)
3. **Task 2 RED — failing tests for apply-preflight orchestrator** — `2907cc6` (test)
4. **Task 2 GREEN — implement runApplyPreflight orchestrator** — `ea0d15d` (feat)

**REFACTOR:** Not needed — both GREEN commits are clean on first pass (the three-phase secret classification was the only iteration during GREEN, documented in code comments).

## Files Created

- `src/migration/guards.ts` (498 lines) — 4 pure-function guards + types + literal constants + BFS walker + aligned-column report formatter
- `src/migration/apply-preflight.ts` (150 lines) — orchestrator with fail-fast canonical order and per-guard ledger writes
- `src/migration/__tests__/guards.test.ts` (430 lines) — 21 unit tests across 4 describe blocks with literal-message regression pins
- `src/migration/__tests__/apply-preflight.test.ts` (308 lines) — 7 unit tests pinning fail-fast ordering, row count per path, filter + ts DI threading

## Decisions Made

- **Zero new deps via node:child_process shim** — `CONTEXT.md` claimed `execa` was already in deps; it isn't (package.json verified: no execa entry, no node_modules/execa). The `execaRunner` DI pattern already existed in the plan's interface — the default implementation now wraps `child_process.execFile` with an execa-compatible `{stdout, exitCode}` shape. No signature change; tests inject `vi.fn()` mocks so they never hit the real subprocess path.
- **Secret classification ordering: prefix → whitelist → entropy** — Initial naive implementation ran whitelist first; sk- tokens (all lowercase letters + digits + hyphens) silently matched `SHORT_IDENT = /^[a-z0-9\-]+$/` and passed. Final ordering: explicit known-secret prefixes (sk-/MT-) ALWAYS refuse, then whitelist (op://, numeric, short-ident) passes, then high-entropy fallback for anything unclassified. Pinned in two regression tests: sk-prefix refuse + op:// allow.
- **Secret scan walks report.agents only, not full PlanReport** — `generatedAt`/`planHash`/`sourcePath`/`targetRoot` are computed by trusted code (diff-builder.ts, Phase 76 Plan 02). Walking them produces false positives on opaque hash prefixes. Scope to agents[] keeps agent='ALL' semantically correct.
- **pre-flight:readonly as a witness row in the orchestrator** — The actual fs.writeFile/appendFile/mkdir interceptor install is Plan 03's responsibility (commander action scope, single install/uninstall pair per command). The orchestrator records a pure witness row so the canonical 4-row ledger sequence is intact even before Plan 03 lands.
- **Filter threading asymmetry** — daemon/readonly/channel use `agent: filter ?? 'ALL'`; secret stays fleet-wide (`agent: 'ALL'`) because the scan walks the entire PlanReport regardless of --only. Tested explicitly in `filter='general' threads through to every guard`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] execa not actually in dependencies**
- **Found during:** Task 1 GREEN implementation
- **Issue:** `77-CONTEXT.md` line 19 + `77-02-PLAN.md` line 312 specified `import { execa } from "execa"`, but `package.json` has no `execa` entry and `node_modules/execa/` doesn't exist. The build would fail on `npm ci` in CI.
- **Fix:** Replaced the default `execaRunner` implementation with a `node:child_process.execFile` shim that preserves the `{stdout, exitCode}` Promise shape. The plan's `execaRunner` DI parameter is untouched — tests inject `vi.fn()` mocks so no subprocess is ever spawned in tests. Zero new deps; the execa-shape contract is preserved at the type level.
- **Files modified:** `src/migration/guards.ts` (default runner only)
- **Commit:** `b08a402`
- **Verification:** `git diff package.json package-lock.json` → empty. `npx vitest run` → all 28 new tests pass.

**2. [Rule 1 - Bug] Whitelist order shadowed sk- tokens**
- **Found during:** Task 1 GREEN — test "refuses a plan with an sk- prefix secret" failed with `pass=true`.
- **Issue:** The naive implementation ran whitelist before secret detection. `sk-abcdefghijklmnopqrstuvwxyz12` matches `SHORT_IDENT = /^[a-z0-9\-]+$/` and `length <= 40`, so the whitelist passed it silently before the sk- regex ever fired.
- **Fix:** Split `isSecretShaped` into `hasSecretPrefix` (sk-, MT-) and `isHighEntropySecret` (length + classes + shannon). Ordered classification as: explicit prefix → whitelist → high-entropy. Documented in inline comments.
- **Files modified:** `src/migration/guards.ts` (walker body + helper split)
- **Commit:** `b08a402`
- **Verification:** Both regression pins pass — sk- refuses, op:// allows.

### Plan Copy Note

The plan's <action> blocks provided near-final source (lines 298-643 of 77-02-PLAN.md). The two deviations above are the only substantive differences. Every literal-string constant, regex, ledger row shape, guard order, and grep-enforced acceptance criterion is preserved as specified.

---

**Total deviations:** 2 auto-fixes (Rule 3 + Rule 1); 0 scope-boundary logs.
**Impact on plan:** Zero — both fixes were required for tests to pass, not scope expansions. Plan executed as intended.

## Issues Encountered

- Initial test fixture YAML used `model: claude-sonnet-4-5` (a Phase 74 OpenAI-endpoint model name). The ClawCode config schema only accepts `sonnet`/`opus`/`haiku`. Fixed to `model: sonnet` in `writeYaml` helper for both test files. Pre-existing `~/.openclaw/` → ClawCode terminology mismatch that would have surfaced in Plan 03's CLI tests anyway — catching it here was free.

## Known Stubs

None. `pre-flight:readonly` is a witness row (not a stub) — the actual runtime fs-interceptor install is Plan 03 scope, documented explicitly in the orchestrator's inline comments and acknowledged in the plan's `<behavior>` section (line 707-713). No hardcoded empty values, no placeholder text, no mock data flowing to UI.

## User Setup Required

None — no external service configuration required. Future Plan 03 will document:
- `systemctl --user stop openclaw-gateway` (before running `clawcode migrate openclaw apply`)
- 1Password op:// references for any credentials (secret guard will refuse raw values)

## Next Phase Readiness

- Plan 03 can import `runApplyPreflight` directly and wire it into `src/cli/commands/migrate-openclaw.ts` under a new `.command("apply")` subcommand with `--only <agent>` flag.
- Plan 03 still owns: (a) actual fs.writeFile/appendFile/mkdir interceptor install/uninstall, (b) commander wiring, (c) exit-code mapping to process.exit, (d) ANSI-colored CLI rendering of firstRefusal.message and reportBody.
- Phase 78+ consumers can re-use `scanSecrets` on every YAML write boundary by passing a synthetic PlanReport with just the slice being written. The exported `GuardResult` + `LedgerRow` shape is stable.
- `computeShannonEntropy` is exported for Phase 78 tests that want to pin secret-shape boundary values without reimplementing the formula.

## Self-Check: PASSED

Created files verified on disk:

```
FOUND: src/migration/guards.ts (DAEMON_REFUSE_MESSAGE line 36, SECRET_REFUSE_MESSAGE line 38, 4 export functions + ReadOnlySourceError + 3 literal consts + computeShannonEntropy)
FOUND: src/migration/apply-preflight.ts (runApplyPreflight export, 4 appendRow calls, 3 guard imports)
FOUND: src/migration/__tests__/guards.test.ts (21 tests)
FOUND: src/migration/__tests__/apply-preflight.test.ts (7 tests)
FOUND: .planning/phases/77-pre-flight-guards-safety-rails/77-02-SUMMARY.md
```

Commits verified in `git log --oneline`:

```
FOUND: 56c6c52 test(77-02): add failing tests for 4 pre-flight guards
FOUND: b08a402 feat(77-02): implement 4 pre-flight guards + ReadOnlySourceError
FOUND: 2907cc6 test(77-02): add failing tests for apply-preflight orchestrator
FOUND: ea0d15d feat(77-02): implement apply-preflight orchestrator
```

Literal-string invariant verified:
- `grep "OpenClaw daemon is running\\. Run 'systemctl --user stop openclaw-gateway' first, then re-run the migration\\." src/migration/guards.ts` → matches (line 37)
- `grep "refused to write raw secret-shaped value to clawcode.yaml — use op:// reference or whitelist the value" src/migration/guards.ts` → matches (line 39, em-dash preserved)

Test suite: `npx vitest run src/migration/__tests__/guards.test.ts src/migration/__tests__/apply-preflight.test.ts` → **28 passed / 28**.
Full migration suite: `npx vitest run src/migration/` → **83 passed / 83** (zero regressions).
Zero new deps: `git diff package.json package-lock.json` → empty.
Typecheck: `npx tsc --noEmit` → zero errors in the new files (pre-existing unrelated tsc errors documented in `deferred-items.md` from Plan 77-01, identical count).

---
*Phase: 77-pre-flight-guards-safety-rails*
*Completed: 2026-04-20*
