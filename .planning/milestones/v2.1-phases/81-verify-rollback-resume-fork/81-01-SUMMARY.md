---
phase: 81-verify-rollback-resume-fork
plan: 01
subsystem: migration
tags: [verify, rollback, yaml, sha256, idempotency, discord-rest, sqlite, typescript]

requires:
  - phase: 78-config-mapping-yaml-writer
    provides: writeClawcodeYaml + writerFs dispatch + atomic temp+rename pattern
  - phase: 79-workspace-copier-agent-fs
    provides: copierFs dispatch pattern + hash-witness sweep template
  - phase: 80-memory-translation-re-embedding
    provides: discoverWorkspaceMarkdown + origin_id path in MemoryStore.insert()
  - phase: 75-shared-workspace-runtime-support
    provides: memoryPath vs workspace semantics (finmentum detection signal)

provides:
  - verifier.verifyAgent — 4-check post-migration verification (workspace-files, memory-count, discord-reachable, daemon-parse)
  - verifier.computeVerifyExitCode — pure exit-code helper (0 clean, 1 any fail)
  - verifier.verifierFetch — ESM-safe monkey-patch holder for Discord REST
  - rollbacker.rollbackAgent — per-agent atomic rollback with source hash-witness
  - rollbacker.hashSourceTree — read-only recursive sha256 over source workspace + memories.db
  - rollbacker.SourceCorruptionError — throw + refuse-ledger contract for source mutation during rollback
  - yaml-writer.removeAgentFromConfig — atomic agent-removal mirror of writeClawcodeYaml

affects:
  - 81-02 (CLI wiring for `clawcode migrate openclaw verify|rollback` subcommands)
  - 81-03 (resume idempotency regression + fork-to-Opus cost visibility)

tech-stack:
  added: []  # zero new npm deps — global fetch + node:crypto + node:fs
  patterns:
    - "4-check verification returning readonly VerifyCheckResult[] with fixed ordering"
    - "Source-invariant hash-witness (pre/post sha256 map) for rollback atomicity"
    - "ESM-safe dispatch holder pattern (verifierFetch, rollbackerFs) for test monkey-patching"
    - "Literal Discord REST URL contract (grep-verifiable) — https://discord.com/api/v9/channels/{id}"
    - "Finmentum detection via config shape (memoryPath !== workspace) instead of hardcoded ID list"

key-files:
  created:
    - src/migration/rollbacker.ts
  modified: []  # all Task 1 files already committed in prior sessions; Task 2 added the one new module

key-decisions:
  - "verifier.ts is PURE — returns VerifyCheckResult[]; CLI caller handles exit code + ledger rows"
  - "rollbacker.ts owns ledger writes (success + refuse) — only non-pure Phase 81 module"
  - "Source-hash witness uses prefixed keys: workspace/<rel> + memory/<agent>.sqlite for forensic clarity"
  - "source_hash field on rollback ledger rows is placeholder 'n/a' — the field is load-bearing for plan/apply rows, not rollback"
  - "hashSourceTree tolerates missing source path (empty map) — doesn't break rollback when source never existed"
  - "Dedicated vs finmentum detection: memoryPath !== workspace (Phase 75 signal), no hardcoded family ID list"

patterns-established:
  - "Dispatch-holder monkey-patch pattern extended to verifier (fetch) + rollbacker (fs) — consistent with Phase 78 writerFs + Phase 79 copierFs"
  - "Ledger-refuse-before-throw contract: any non-recoverable invariant violation (SourceCorruptionError) writes a refuse row BEFORE throwing, so forensic replay shows the attempted state transition"
  - "Literal URL contract: full Discord REST endpoint pinned as a grep-verifiable constant (DISCORD_CHANNEL_URL_PREFIX) — operator can `grep https://discord.com/api/v9/channels/ src/` to audit all Discord traffic"

requirements-completed: [MIGR-04, MIGR-05]

duration: 9min
completed: 2026-04-20
---

# Phase 81 Plan 01: Verify + Rollback Module Foundation Summary

**Four-check verifier (workspace/memory/discord/daemon) + per-agent atomic rollback with source-invariant sha256 hash-witness, both pure TypeScript libraries with zero new npm deps.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-20T23:23:26Z
- **Completed:** 2026-04-20T23:32:46Z
- **Tasks:** 2 (Task 1 already complete in prior session; Task 2 executed this session)
- **Files modified:** 1 (rollbacker.ts created)
- **Lines added:** 325 (rollbacker.ts)
- **Tests added in this session:** 0 (RED phase for rollbacker was committed in `50b6b28`)
- **Tests passing (plan scope):** 47/47 (19 verifier + 18 yaml-writer + 10 rollbacker)

## Accomplishments

- Completed GREEN phase for Task 2 — `rollbacker.ts` implementation making all 10 pre-written failing tests pass
- Verified Task 1 was already complete from prior sessions (commits `56cb0a3`, `683d0d3`, `b15ddb5` — verifier + yaml-writer removeAgentFromConfig + tests all in place and green)
- Source-invariant hash-witness contract enforced: `hashSourceTree` runs pre and post, any mismatch throws `SourceCorruptionError` after emitting a `rollback:source-corruption` refuse ledger row
- Finmentum-shared vs dedicated-workspace detection via `memoryPath !== workspace` config shape — no hardcoded family ID list, agent-agnostic
- Ledger append on success: `{action:'rollback', status:'rolled-back', step:'rollback:complete', outcome:'allow', file_hashes:<source-map>}` enables `latestStatusByAgent` to return `rolled-back` for apply-side resume logic in Plan 02

## Task Commits

Each task followed the TDD red-green cycle; RED commits existed from prior sessions, GREEN for Task 2 landed this session:

**Task 1 — verifier.ts + removeAgentFromConfig (from prior session):**
1. `56cb0a3` — test(81-01): add failing tests for verifier module (RED)
2. `683d0d3` — test(81-01): add failing tests for removeAgentFromConfig (RED)
3. `b15ddb5` — feat(81-01): implement verifier.ts + removeAgentFromConfig (GREEN)

**Task 2 — rollbacker.ts (completed this session):**
4. `50b6b28` — test(81-01): add failing tests for rollbacker module (RED — from prior session)
5. `3709236` — feat(81-01): implement rollbacker per-agent atomic rollback (GREEN — this session)

## Files Created/Modified

- `src/migration/rollbacker.ts` — 325 LOC. Exports `rollbackAgent`, `hashSourceTree`, `SourceCorruptionError`, `rollbackerFs` dispatch holder. Per-agent atomic rollback pipeline: loadConfig resolve → pre-hash source → removeAgentFromConfig → target fs.rm (dedicated workspace OR finmentum-shared per-agent files) → post-hash source → diff + throw/refuse on mismatch → success ledger row.

## Decisions Made

- **`rollbacker.ts` is the ONE non-pure module in Phase 81 Plan 01** — it writes ledger rows directly on both success and refuse paths. Plan 02's CLI is a thin exit-code/stderr wrapper around the throw. This keeps the atomic-rollback-and-ledger-commit sequence owned by a single module and prevents Plan 02 from needing to know the refuse-row schema.
- **Source-hash witness keys are PREFIXED** (`workspace/...` + `memory/<agent>.sqlite`) — forensic replay of a `rollback:complete` ledger row can distinguish workspace bytes from sqlite bytes without path inspection. Test 6 pins both prefixes must appear.
- **`source_hash: "n/a"` on rollback rows** — the ledger schema requires a non-empty string; rollback's concept of "source hash" is already captured in `file_hashes`. Using "n/a" as a sentinel keeps the row schema-valid without polluting the top-level field with a fabricated composite hash.
- **hashSourceTree skips symlinks and special files** — source workspace contract is regular files + the per-agent sqlite. If source grows symlinks in future, extend with readlink-based comparison (Phase 79 workspace-copier pattern is the template).

## Deviations from Plan

None — plan executed exactly as written. Task 1 was already fully complete from prior sessions (verifier.ts, yaml-writer removeAgentFromConfig, and both test suites all committed and green); the executor verified this and moved to Task 2. Task 2's implementation matched the plan's STEP 1 pseudocode 1:1 with zero structural deviations.

## Issues Encountered

None specific to Plan 01. Full-project test suite has 11 pre-existing failures in unrelated files:
- `src/manager/__tests__/daemon-openai.test.ts` (7 failed)
- `src/manager/__tests__/bootstrap-integration.test.ts` (2 failed)
- `src/manager/__tests__/session-manager.test.ts` (1 failed)
- `src/config/__tests__/shared-workspace.integration.test.ts` (1 failed)

These are in `manager/` and `config/` — zero overlap with `src/migration/`. Baseline failure count unchanged (11 before → 11 after Plan 01). Same test-count-delta confirms: test count went from 3590 → 3600 (+10 new rollbacker tests, all passing), failed count stayed flat. Documented as out-of-scope per the scope-boundary rule; these do not block Plan 81-02 or 81-03.

Pre-existing TypeScript errors in `src/triggers/__tests__/engine.test.ts`, `src/usage/__tests__/daily-summary.test.ts`, and `src/usage/budget.ts` are also unrelated to migration work. `npx tsc --noEmit` returns zero errors in `src/migration/**/*.ts`.

## Acceptance Criteria Verification

Task 1 (from prior sessions — all still pass):
- `grep -c "export async function verifyAgent" src/migration/verifier.ts` → 1 ✓
- `grep -c "export function computeVerifyExitCode" src/migration/verifier.ts` → 1 ✓
- `grep -c "export const verifierFetch" src/migration/verifier.ts` → 1 ✓
- `grep -c "https://discord.com/api/v9/channels/" src/migration/verifier.ts` → 1 ✓
- `grep -c "REQUIRED_WORKSPACE_FILES" src/migration/verifier.ts` → 3 ✓ (declaration + 2 usages)
- `grep -c "export async function removeAgentFromConfig" src/migration/yaml-writer.ts` → 1 ✓
- `grep -c "export type RemoveAgentFromConfigResult" src/migration/yaml-writer.ts` → 1 ✓

Task 2 (this session):
- `grep -c "export async function rollbackAgent" src/migration/rollbacker.ts` → 1 ✓
- `grep -c "export class SourceCorruptionError" src/migration/rollbacker.ts` → 1 ✓
- `grep -c "export async function hashSourceTree" src/migration/rollbacker.ts` → 1 ✓
- `grep -c "export const rollbackerFs" src/migration/rollbacker.ts` → 1 ✓
- `grep -c "memoryPath !== resolved.workspace" src/migration/rollbacker.ts` → 1 ✓
- `grep -c "rollback:complete" src/migration/rollbacker.ts` → 2 ✓ (DO-section reference + the actual ledger step literal)
- `grep -c "rollback:source-corruption" src/migration/rollbacker.ts` → 1 ✓

Zero-subprocess contract:
- `execa`/`child_process` in verifier.ts + rollbacker.ts — only in code-comment DO-NOT directives; zero runtime imports.

TypeScript:
- `npx tsc --noEmit 2>&1 | grep "migration/(verifier|rollbacker|yaml-writer)"` → 0 matches ✓

## Self-Check: PASSED

File existence:
- `src/migration/rollbacker.ts` — FOUND (325 LOC)
- `src/migration/verifier.ts` — FOUND (336 LOC, pre-existing from Task 1)
- `src/migration/yaml-writer.ts` — FOUND (has `removeAgentFromConfig` export from Task 1)
- `src/migration/__tests__/rollbacker.test.ts` — FOUND (547 LOC, pre-existing RED)
- `src/migration/__tests__/verifier.test.ts` — FOUND (534 LOC, pre-existing RED+GREEN)

Commit existence:
- `3709236` (Task 2 GREEN) — FOUND in git log
- `50b6b28` (Task 2 RED) — FOUND in git log (prior session)
- `b15ddb5` (Task 1 GREEN) — FOUND in git log (prior session)
- `683d0d3` + `56cb0a3` (Task 1 RED) — FOUND in git log (prior session)

Test suite:
- Plan 01 scope: 47/47 tests passing (19 verifier + 18 yaml-writer + 10 rollbacker)
- Full project: 3589/3600 passing; 11 pre-existing failures unchanged, unrelated to migration

## Next Phase Readiness

**Plan 81-01 closes MIGR-04 + MIGR-05 at the module level.** Plan 81-02 has everything it needs to wire these as CLI subcommands:

- `verifyAgent` takes an `offline` boolean — Plan 02 CLI reads `CLAWCODE_VERIFY_OFFLINE` env and passes through.
- `computeVerifyExitCode` maps result array → exit code — Plan 02 CLI calls it after printing the results table.
- `rollbackAgent` handles ledger writes + throw on corruption — Plan 02 CLI wraps the throw into stderr + exit 1 and leaves successful runs silent.
- `SourceCorruptionError.mismatches` gives operators the exact file paths that changed — Plan 02 CLI dumps these to stderr for forensic triage.

No blockers for 81-02. Pre-existing manager/config test failures are deferred (unrelated infrastructure concerns — see "Issues Encountered").

---
*Phase: 81-verify-rollback-resume-fork*
*Completed: 2026-04-20*
