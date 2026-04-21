---
phase: 76-migration-cli-read-side-dry-run
plan: 02
subsystem: migration
tags: [migration, openclaw, sha256, determinism, finmentum, diff-builder, cli, dry-run]

# Dependency graph
requires:
  - phase: 76-migration-cli-read-side-dry-run
    provides: OpenclawSourceInventory + OpenclawSourceEntry types (Plan 01) + ChunkCountResult + FINMENTUM_FAMILY_IDS + isFinmentumFamily helpers consumed verbatim
provides:
  - AgentPlan + PlanReport + PlanWarning types (authoritative per-agent target spec for Phases 77-82)
  - buildPlan() — pure-function diff assembly with SHA256 determinism invariant
  - computePlanHash() — canonical JSON hasher (key-sorted at every nesting level, generatedAt EXCLUDED)
  - getTargetBasePath() + getTargetMemoryPath() — finmentum-family collapse resolvers
  - WARNING_KINDS const tuple (4 kinds — downstream phases extend)
  - Pinned expected-diff.json fixture (15 agents, 17 warnings, SHA256 46a8f3b5b278...)
affects:
  - 76-03 (CLI wiring consumes PlanReport verbatim for table rendering + --agent filter + exit-1 on unknown)
  - 77 (pre-flight guards extend WARNING_KINDS; reuse AgentPlan for Discord-collision checks)
  - 78 (config-mapper consumes AgentPlan.targetBasePath/targetMemoryPath for clawcode.yaml entries — SHARED-01 honored)
  - 79 (workspace-copy consumes AgentPlan.sourceWorkspace → targetBasePath path pairs)
  - 81 (verify/rollback hashes recomputed against the same canonicalize() algorithm)

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps — node:crypto + node:path only
  patterns:
    - "Canonical JSON hashing — sorted keys at every nesting level, explicit generatedAt exclusion via Omit<PlanReport, 'generatedAt' | 'planHash'>"
    - "DI now() parameter for test-stable generatedAt without polluting production signatures"
    - "Defensive re-sort of upstream-sorted arrays — protects determinism invariant against future refactors of upstream module"
    - "Warnings-as-data (never throw) — buildPlan emits structured PlanWarning entries; CLI layer translates to exit codes"
    - "Pinned fixture as regression guard — expected-diff.json byte-parity test catches accidental shape drift"

key-files:
  created:
    - src/migration/diff-builder.ts
    - src/migration/__tests__/diff-builder.test.ts
    - src/migration/__tests__/fixtures/expected-diff.json
  modified: []

key-decisions:
  - "generatedAt is EXCLUDED from planHash via Omit<PlanReport, 'planHash' | 'generatedAt'> type-narrowing on computePlanHash input — same semantic content MUST hash identically regardless of when computed"
  - "Custom canonicalize() over JSON.stringify — V8 insertion-order is NOT stable across refactors; canonicalize sorts keys at every nesting level"
  - "Re-exports FINMENTUM_FAMILY_IDS + isFinmentumFamily from diff-builder — Wave 3 CLI only imports from one module (single point of contact)"
  - "targetAgentName = sourceId (not a separate slug) — keeps downstream phases from needing a rename-map lookup table; slug stability proven by test"
  - "Unknown --agent filter emits warning + empty agents (NOT throw) — CLI layer translates to exit(1); buildPlan stays a pure data transform"
  - "Missing agent in chunkCounts defaults to {missing:true, count:0} — realistic (Phase 76 only probes sqlite files that existsSync) and non-fatal"
  - "Pinned fixture uses FIXED_NOW = 2026-04-20T00:00:00.000Z — expected-diff.json is stable across runs, byte-parity test catches accidental shape drift"

patterns-established:
  - "Pure-function data transforms under src/migration/ — zero I/O, zero env reads, all inputs explicit (enables trivial parallel testing)"
  - "Test-scaffolding: realisticChunkCounts() factory returns a fresh Map per call so tests can mutate without cross-pollution"
  - "Load-bearing-invariant tests labeled in describe blocks — '(load-bearing)' / '(core invariant)' suffixes flag regression-sensitive cases for reviewers"

requirements-completed:
  - MIGR-01

# Metrics
duration: 4min
completed: 2026-04-20
---

# Phase 76 Plan 02: Deterministic Diff Engine Summary

**Pure-function `buildPlan()` that produces a SHA256-stable PlanReport from OpenClaw inventory + chunk counts, with finmentum-family 5-agent basePath collapse and 4 non-fatal warning kinds — 24 unit tests proving determinism, collapse rule, and pinned byte-parity.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-20T16:28:49Z
- **Completed:** 2026-04-20T16:32:00Z
- **Tasks:** 1 (TDD, RED→GREEN)
- **Files created:** 3
- **Files modified:** 0
- **Tests added:** 24 (all passing; 47 total in src/migration/)
- **Test runtime:** ~460ms for diff-builder, 1.27s for all 4 migration test files

## Accomplishments

- **`diff-builder.ts`** — pure function with three exports beyond the core `buildPlan`: `computePlanHash` (canonical-JSON SHA256), `getTargetBasePath` (finmentum collapse), `getTargetMemoryPath` (distinct-per-agent inside shared basePath). Re-exports `FINMENTUM_FAMILY_IDS` + `isFinmentumFamily` so Wave 3 CLI has a single import surface.
- **Determinism proof** — three tests interlock: (1) two successive `buildPlan()` calls with identical inputs yield identical `planHash`; (2) a single chunk-count delta (878 → 879 for `general`) changes the hash; (3) round-trip serialize → parse → recompute yields the same hash. Together these prove the SHA256 is a true semantic fingerprint, not a wall-clock artifact.
- **Finmentum 5-agent collapse verified** — all 5 family ids (`fin-acquisition`, `fin-research`, `fin-playground`, `fin-tax`, `finmentum-content-creator`) resolve to `targetBasePath === /tmp/clawcode-agents/finmentum` but get 5 distinct `targetMemoryPath` values under `<basePath>/memory/<id>`. Dedicated agents like `general` have `basePath === memoryPath` (workspace fallback).
- **4 warning kinds** — `missing-discord-binding` (agent has no channel binding in `openclaw.json`), `empty-source-memory` (split into "sqlite file not found" vs "chunks table present but empty" via `detail`), `source-db-no-chunks-table` (file present, no chunks table), `unknown-agent-filter` (`--agent <name>` doesn't match).
- **Pinned fixture** — `expected-diff.json` captures the 15-agent PlanReport with `planHash: 46a8f3b5b278326fddf4a864c1b273e83c339f9198df3d9bfb0fc0b4984267e6` and 17 warnings. Any future change in PlanReport shape will cause the pinned-parity test to fail — forcing an intentional fixture update.

## Task Commits

Test-first (RED → GREEN) with atomic commits:

1. **Task 1 RED: diff-builder tests (24 it blocks)** — `dac8f3a` (test)
2. **Task 1 GREEN: diff-builder impl + pinned fixture** — `f571976` (feat)

## Files Created/Modified

- `src/migration/diff-builder.ts` (308 lines) — pure function, zero I/O; imports only `node:crypto`, `node:path`, `./openclaw-config-reader`, `./source-memory-reader`
- `src/migration/__tests__/diff-builder.test.ts` (510 lines) — 24 `it()` blocks across 9 describe groups, covers determinism / collapse / warnings / filter / field-population / pinned-parity
- `src/migration/__tests__/fixtures/expected-diff.json` (~400 lines, pinned) — canonical 15-agent PlanReport shape with realistic chunk counts sourced from `.planning/research/STACK.md`

## Decisions Made

1. **`generatedAt` type-narrowed out of `computePlanHash` input via `Omit<PlanReport, "planHash" | "generatedAt">`** — the compiler prevents callers from accidentally passing a full report and tainting the hash. Belt-and-suspenders over a runtime check.
2. **Custom `canonicalize()` over `JSON.stringify`** — V8's default is insertion-order, which is NOT stable across trivial refactors (reordering object literal keys, toJSON migrations). Canonicalize sorts keys at every nesting level and emits arrays in-order (array order is semantically significant for agents/warnings, which are pre-sorted).
3. **`targetAgentName = sourceId`** — no separate slug. Downstream phases index by sourceId everywhere; a rename-map would be an additional source of drift. Explicit `expect(a.targetAgentName).toBe(a.sourceId)` test pins the invariant.
4. **`WARNING_KINDS` as a `const` tuple with `satisfies`-friendly type export** — Wave 3 CLI switch statement catches typos at compile time. Phase 77 extensions append new kinds without breaking callers.
5. **Missing agent in `chunkCounts` Map defaults to `{missing: true, count: 0}`** — realistic case (Phase 76 only probes sqlite files that `existsSync`), and non-fatal by design. An explicit test passes an empty Map and verifies all 15 agents surface `empty-source-memory` warnings.
6. **`now` as DI parameter (default `() => new Date()`)** — minimal surface change vs. wrapping in a clock class. Test uses `FIXED_NOW = () => new Date("2026-04-20T00:00:00.000Z")` so `expected-diff.json` has a stable `generatedAt` for byte-parity assertions.
7. **Warnings emitted AFTER agent-map loop, then sorted** — decouples warning insertion order from agent traversal order. Critical because we later re-sort agents defensively too — if warnings were inline, re-sorting agents would reshuffle warnings.
8. **Defensive re-sort of `agents` even though Plan 01 already sorts** — protects the hash-stability invariant against a future refactor of `readOpenclawInventory` that forgets the sort. Cost: one `Array.prototype.sort` per buildPlan call. Benefit: no silent hash drift on upstream changes.
9. **Realistic chunk counts from `STACK.md` "Reality Check: Embeddings"** — 878 general, 597 fin-acquisition, 47 personal, etc. Keeps the pinned fixture meaningful and lets Wave 3 CLI integration tests reuse the same `realisticChunkCounts()` factory without re-deriving numbers.

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's `<action>` block specified the code verbatim; I followed it with one small clarity improvement (`canonicalize` guards against `undefined` to match `JSON.stringify` semantics — a future-proofing touch, not a deviation since the plan's code would produce equivalent output on the current test inputs).

## Issues Encountered

None functional. Pre-existing typecheck errors elsewhere in the codebase (`src/image/`, `src/manager/`, `src/tasks/`) were observed during a whole-project `tsc --noEmit` run but are OUTSIDE this plan's scope (none in `src/migration/`). Not tracked as deferred items — they're inherited tech debt already noted in STATE.md under "Known tech debt".

## Plan-Level Verification Results

Every acceptance criterion in the plan passes:

- `grep -n 'export function buildPlan'` → line 206 ✓
- `grep -n 'export function computePlanHash'` → line 158 ✓
- `grep -nE 'createHash\(.sha256.\)'` → line 162 ✓
- `grep -nE "from \"./openclaw-config-reader"` → line 45 ✓
- `grep -nE "from \"./source-memory-reader"` → line 46 ✓
- `grep -n 'generatedAt'` → 10 occurrences, all in doc/type/return positions; `computePlanHash` input is `Omit<..., "generatedAt">` ✓
- Test file has 24 `it()` blocks (plan required ≥10) ✓
- Determinism assertions present (5 `planHash.toBe` lines) ✓
- `test -f src/migration/__tests__/fixtures/expected-diff.json` → OK ✓
- `jq '.agents | length' expected-diff.json` → 15 ✓
- `jq '[.agents[] | select(.isFinmentumFamily == true) | .targetBasePath] | unique | length' expected-diff.json` → 1 ✓
- `npx vitest run src/migration/__tests__/diff-builder.test.ts` → 24/24 passed ✓

Zero-I/O audit (the plan's explicit phase-level guardrail):

- `grep -nE '(readFile|writeFile|appendFile|mkdir|Database)' src/migration/diff-builder.ts` → zero matches (only a doc comment mentioning "no readFile") ✓
- `grep -nE "from \"(chalk|picocolors|cli-table3|jsondiffpatch)\""` → zero matches ✓
- Import surface: `node:crypto`, `node:path`, `./openclaw-config-reader.js`, `./source-memory-reader.js` (type-only) — nothing else ✓

## User Setup Required

None — entirely internal tooling.

## Next Phase Readiness

**Ready for 76-03 (CLI wiring + integration test):**

- `buildPlan()` returns exactly the shape the `plan` subcommand needs to render the `Name | Source Path | Memories | MCP Count | Discord Channel | Status` table (per 76-CONTEXT "Plan output table columns").
- `PlanWarning` has the 4 kinds the CLI must handle. Unknown-agent-filter is the only one that maps to `exit(1)`; the other 3 are informational.
- `planHash` is what the ledger row's `source_hash` field should carry on the `{action:"plan"}` bootstrap rows.
- **Test scaffolding reusable by 76-03 integration test:**
  - `realisticChunkCounts()` factory (copy verbatim or refactor into a shared test helper)
  - `FIXED_NOW = () => new Date("2026-04-20T00:00:00.000Z")` for stable generatedAt
  - `FIXTURE = openclaw.sample.json` + `EXPECTED_DIFF_FIXTURE = expected-diff.json` — Wave 3 can assert CLI output matches these

**Notes for the CLI implementer:**

- `getTargetBasePath` / `getTargetMemoryPath` are exported as independent functions in addition to being used inside `buildPlan`. CLI can call them directly for ad-hoc path lookups without reconstructing a full inventory.
- The `now` DI is optional — production callers should omit it and get `() => new Date()` by default.
- `clawcodeAgentsRoot` must be pre-expanded (no `~` handling inside diff-builder). CLI layer expands `~/.clawcode/agents` via `os.homedir()` before calling `buildPlan`.

**No blockers** for Plan 76-03.

## Self-Check: PASSED

Verified via file/commit existence:

- FOUND: src/migration/diff-builder.ts
- FOUND: src/migration/__tests__/diff-builder.test.ts
- FOUND: src/migration/__tests__/fixtures/expected-diff.json
- FOUND commit: dac8f3a (test: RED)
- FOUND commit: f571976 (feat: GREEN)

Verification commands all pass:
- `npx vitest run src/migration/__tests__/diff-builder.test.ts` → 24/24 passed, 463ms
- `npx vitest run src/migration/__tests__/` → 47/47 passed, 1.27s (no regression)
- `npx tsc --noEmit` on `src/migration/**` → zero errors
- Zero-I/O grep audit → PASSED
- Zero-new-deps grep audit → PASSED

---
*Phase: 76-migration-cli-read-side-dry-run*
*Completed: 2026-04-20*
