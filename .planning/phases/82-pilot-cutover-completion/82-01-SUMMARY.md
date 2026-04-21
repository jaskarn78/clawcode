---
phase: 82-pilot-cutover-completion
plan: 01
subsystem: migration
tags: [pilot-selection, discord-cutover, fs-guard, ledger-witness, atomic-write]

requires:
  - phase: 77-pre-flight-guards-safety-rails
    provides: fs-guard runtime interceptor + scanSecrets detector
  - phase: 78-config-mapping-yaml-writer
    provides: atomic temp+rename pattern + writerFs dispatch pattern
  - phase: 80-memory-translation-re-embedding
    provides: discoverWorkspaceMarkdown + origin_id scheme
  - phase: 81-verify-rollback-resume-fork
    provides: latestStatusByAgent + rollbacker hash-tree pattern
provides:
  - Pure pilot-selector with scoring formula + literal line format
  - cutoverAgent three-guard orchestrator (ledger, yaml, bindings)
  - fs-guard allowlist carve-out (one-path source-tree exception)
  - removeBindingsForAgent write helper (atomic, preserves operator fields)
  - buildMigrationReport + writeMigrationReport with three cross-agent invariants
affects: [82-02, v2.1-completion]

tech-stack:
  added: []
  patterns:
    - "fs-guard allowlist: exact-equality resolved-path bypass, Set<string> module state"
    - "Non-schema JSON mutation: bypass zod for operator-curated passthrough fields"
    - "Ledger witness: source_integrity_sha hashes sorted ledger rows, not tree"
    - "Three-guard orchestrator: fail-fast in order, ledger row per branch"

key-files:
  created:
    - src/migration/pilot-selector.ts
    - src/migration/cutover.ts
    - src/migration/report-writer.ts
    - src/migration/__tests__/pilot-selector.test.ts
    - src/migration/__tests__/cutover.test.ts
    - src/migration/__tests__/report-writer.test.ts
  modified:
    - src/migration/fs-guard.ts (allowlist option added)
    - src/migration/openclaw-config-reader.ts (removeBindingsForAgent added)
    - src/migration/__tests__/fs-guard.test.ts (allowlist describe block added)
    - src/migration/__tests__/openclaw-config-reader.test.ts (removeBindingsForAgent describe block added)

key-decisions:
  - "Bypass zod schema in removeBindingsForAgent to preserve operator-curated fields (env, auth, channels.discord.token, accountId on bindings)"
  - "fs-guard allowlist uses exact-equality on resolve()'d paths — sibling .bak files still refuse"
  - "source_integrity_sha hashes the sorted ledger witness rows (not a live tree walk) — the ledger IS the audit trail"
  - "sourceTreeByteIdentical invariant heuristic: zero non-cutover allow rows with source-tree file_hashes keys"
  - "Second installFsGuard call is a no-op including its allowlist arg; uninstall+reinstall is required to change allowlist membership"

patterns-established:
  - "fs-guard allowlist: additive option preserving all Phase 77 default-refuse behavior; empty-list install identical to no-arg install"
  - "Idempotent cutover: zero-bindings guard branches to already-cut-over (exit 0) before touching fs; second post-success run returns same outcome"
  - "Literal-string grep-contract: PILOT_RECOMMEND_PREFIX, CUTOVER_OBSERVE_HINT_TEMPLATE, REPORT_PATH_LITERAL, 'Cannot complete: ...' refusal messages"

requirements-completed: [OPS-01, OPS-02, OPS-04]

duration: ~25min
completed: 2026-04-20
---

# Phase 82 Plan 01: Pilot-Selector + Cutover + Report-Writer (Wave 1) Summary

**Five Wave-1 migration modules shipped TDD — pilot-selector scoring + line formatter, cutoverAgent three-guard orchestrator, buildMigrationReport with three cross-agent invariants, fs-guard allowlist one-path carve-out, and removeBindingsForAgent write helper. 52 new tests; zero regressions in the 235-test baseline migration suite.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 (each test-first / TDD)
- **Files created:** 6 (3 impl + 3 test)
- **Files modified:** 4 (2 impl + 2 test extensions)
- **Tests added:** 52 (30 in Task 1 + 22 in Task 2)
- **Migration suite:** 235 → 287 green (zero regressions)

## Accomplishments

- **pilot-selector.ts** — pure `scorePilot` / `pickPilot` / `formatPilotLine` + `PILOT_RECOMMEND_PREFIX` constant. Scoring formula `memoryChunkCount*0.6 + mcpCount*0.2 + (isFinmentumFamily?100:0)` with alphabetical tie-break. Line format `✨ Recommended pilot: <id> (<reason>)` is byte-exact grep-pinned.
- **cutover.ts** — `cutoverAgent` three-guard orchestrator. Refuses on (a) agent status ≠ migrated|verified, (b) agent absent from clawcode.yaml, (c) zero bindings in openclaw.json (idempotent no-op). Happy path installs fs-guard with one-path allowlist, calls removeBindingsForAgent, writes before/after sha256 witness to ledger, emits observe-hint with real channel id. Finally-block uninstalls fs-guard.
- **report-writer.ts** — `buildMigrationReport` + `writeMigrationReport` with REPORT_PATH_LITERAL = `.planning/milestones/v2.1-migration-report.md`. Three refuse paths: refused-pending (literal message pinned), refused-invariants (three booleans), refused-secret (via Phase 77 scanSecrets). Atomic temp+rename with rename-failure cleanup.
- **fs-guard.ts extension** — additive `allowlist?: string[]` option. Resolved-path exact-equality (not prefix); sibling `.bak` still refuses. Every existing Phase 77 test still green.
- **openclaw-config-reader.ts extension** — `removeBindingsForAgent` write helper (the only write-side export in this module). Bypasses zod schema to preserve operator-curated fields (env, auth, channels.discord.token). Atomic temp+rename. Returns `{removed, beforeSha256, afterSha256}`. Zero-removed = zero writes + before==after hash.

## Task Commits

1. **Task 1 RED:** `0f89bb8` (test) — failing tests for pilot-selector + fs-guard allowlist + removeBindingsForAgent
2. **Task 1 GREEN:** `e13cf89` (feat) — implementations for all three Task 1 modules
3. **Task 2 RED:** `ef0001a` (test) — failing tests for cutover + report-writer orchestrators
4. **Task 2 GREEN:** `7da3ba7` (feat) — implementations for cutoverAgent + buildMigrationReport + writeMigrationReport

## Files Created/Modified

- `src/migration/pilot-selector.ts` (created) — pure scoring/line-format module
- `src/migration/cutover.ts` (created) — three-guard cutover orchestrator
- `src/migration/report-writer.ts` (created) — report builder + atomic writer
- `src/migration/fs-guard.ts` (modified) — allowlist option added, default behavior preserved
- `src/migration/openclaw-config-reader.ts` (modified) — removeBindingsForAgent write helper appended
- `src/migration/__tests__/pilot-selector.test.ts` (created) — 17 tests
- `src/migration/__tests__/cutover.test.ts` (created) — 11 tests
- `src/migration/__tests__/report-writer.test.ts` (created) — 11 tests
- `src/migration/__tests__/fs-guard.test.ts` (modified) — 7 allowlist tests added
- `src/migration/__tests__/openclaw-config-reader.test.ts` (modified) — 8 removeBindingsForAgent tests added

## Decisions Made

- **removeBindingsForAgent bypasses the zod schema** — operator-curated passthrough fields (env, auth, channels.discord.token, accountId on bindings) would be stripped by the `openclawSourceAgentSchema` / `openclawBindingSchema` if we parsed through them. Working with the raw JSON parse tree and modifying ONLY `bindings` preserves byte-exact operator intent.
- **fs-guard allowlist is exact-equality (not startsWith)** — sibling paths (e.g., `openclaw.json.bak`) MUST still refuse. Tests pin this explicitly to prevent a future refactor accidentally broadening the bypass.
- **source_integrity_sha hashes the sorted ledger witness rows, not a live tree walk** — tree walk for 14+ agents would be expensive and non-deterministic across clocks. The ledger IS the audit trail; hashing its witness rows gives a stable checksum that equals-equals across re-runs.
- **Second installFsGuard call is a no-op (including its allowlist arg)** — this preserves the Phase 77 idempotency contract. To change allowlist membership: `uninstallFsGuard()` then `installFsGuard({ allowlist: [...] })`. Documented in JSDoc.
- **sourceTreeByteIdentical invariant uses a heuristic** — "zero non-cutover allow rows with source-tree file_hashes keys" is the practical test. Rollback witness rows are allowed (they hash the PRE-rollback source, not a mutation). Documented in-code.

## Deviations from Plan

None — plan executed exactly as written. Minor adjustments made within the Claude-discretion zones:
- `writeMigrationReport` exposed the parent-dir `mkdir` call through the `reportWriterFs` dispatch holder (Phase 78/81 pattern) so tests could observe/monkey-patch.
- `buildMigrationReport` scans `perAgent` rows with warnings folded in as an extra field for the scanner shim — structural walker picks up secrets regardless of schema fit.

## Issues Encountered

- One `@ts-expect-error` directive ended up unused after I added the `as unknown` cast — TypeScript correctly flagged it. Replaced with a standard comment. Migration suite's dedicated typecheck path is clean (0 errors in `src/migration/`).
- 10 pre-existing test failures in unrelated `src/manager/__tests__/` files (bootstrap-integration, daemon-openai, session-manager) failed both before and after my changes. Verified via `git stash` + re-run. Logged to `.planning/phases/82-pilot-cutover-completion/deferred-items.md` — out of scope per the Phase 82 boundary.

## Verification

All grep invariants hit (each command returns the expected count):

```bash
grep -c "✨ Recommended pilot:" src/migration/pilot-selector.ts           # 3 (constant + 2 JSDoc)
grep -c "Now wait 15 minutes" src/migration/cutover.ts                    # 1
grep -c ".planning/milestones/v2.1-migration-report.md" src/migration/report-writer.ts  # 3 (const + 2 JSDoc)
grep -c "Cannot complete:" src/migration/report-writer.ts                 # 4 (pending + invariants + 2 JSDoc)
```

Package.json: `git diff package.json package-lock.json` returns empty — zero new npm deps (D-08 honored).

## Known Stubs

None — all modules implement their full contract for Wave 1 consumers. Wave 2's CLI will wire these into `migrate openclaw cutover <agent>` + `migrate openclaw complete` subcommands + the pilot-highlight line in `runPlanAction` output.

## Next Phase Readiness

Wave 2 (Plan 02) can now integrate these modules:
- `runCutoverAction` → wraps `cutoverAgent` with CLI flag parsing + stdout formatting
- `runCompleteAction` → wraps `buildMigrationReport` + `writeMigrationReport` with --force flag
- `runPlanAction` → appends `formatPilotLine(...)` after the diff table

All Wave 1 exports are deeply tested and the integration surface is small. Zero known stubs or deferred work for Wave 1.

---

## Self-Check: PASSED

Verified on disk:
- FOUND: src/migration/pilot-selector.ts
- FOUND: src/migration/cutover.ts
- FOUND: src/migration/report-writer.ts
- FOUND: src/migration/__tests__/pilot-selector.test.ts
- FOUND: src/migration/__tests__/cutover.test.ts
- FOUND: src/migration/__tests__/report-writer.test.ts

Verified in git log (git log --oneline | grep -E "82-01"):
- FOUND: 0f89bb8 (Task 1 RED)
- FOUND: e13cf89 (Task 1 GREEN)
- FOUND: ef0001a (Task 2 RED)
- FOUND: 7da3ba7 (Task 2 GREEN)

Migration suite: 287 tests passing (235 baseline + 52 new). Zero regressions.

---

*Phase: 82-pilot-cutover-completion*
*Plan: 01*
*Completed: 2026-04-20*
