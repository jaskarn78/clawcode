---
phase: 79-workspace-migration
plan: 02
subsystem: migration
tags: [migration, session-archive, fs.cp, ledger, conversation-store-isolation, work-04, zero-deps]

# Dependency graph
requires:
  - phase: 77-pre-flight-guards-safety-rails
    provides: "ledger.appendRow + LedgerRow schema extended with step/outcome/file_hashes (Phase 77 Plan 01 additive extension)"
  - phase: 76-migration-cli-read-side-dry-run
    provides: "openclaw-config-reader.agentDir convention; ledger JSONL append-only invariant"
provides:
  - "src/migration/session-archiver.ts exports archiveOpenclawSessions + ARCHIVE_SESSIONS_SUBDIR"
  - "ArchiveSessionsArgs / ArchiveSessionsResult types (readonly record shapes)"
  - "WORK-04 archive-only contract — zero ConversationStore references pinned by static-grep test"
  - "Missing-source graceful-skip pattern for per-agent fs copy (reused by Plan 03 and Phase 80)"
  - "Manifest-witness sha256 pattern (sorted <relpath>:<size> → hex) for ledger forensic evidence"
affects: [79-03-cli-wiring, 81-verify-rollback, 82-pilot-cutover]

# Tech tracking
tech-stack:
  added: []  # Zero new deps — node:fs/promises + node:crypto + node:path + ledger.appendRow only
  patterns:
    - "Dedicated-module isolation pattern — separate file enforces the 'no ConversationStore' contract via static grep, cheaper than runtime assertion"
    - "Manifest-sha witness (sorted <relpath>:<size>) vs full-byte hash — lighter forensic evidence for archive/reference content (workspace-copier owns full-byte witness for primary content)"
    - "Missing-source graceful-skip — existsSync on both agentDir AND sessions subdir; ledger :skip row with notes"

key-files:
  created:
    - "src/migration/session-archiver.ts"
    - "src/migration/__tests__/session-archiver.test.ts"
  modified: []

key-decisions:
  - "Dedicated module (not a workspace-copier arg) — source path + filter semantics differ, and isolation is enforceable by static grep on the module file"
  - "Manifest-sha witness over <relpath>:<size> lines — workspace-copier (Plan 01) handles full-byte witness; archive is read-only reference material, a manifest witness is sufficient forensic record"
  - "existsSync check on BOTH sourceAgentDir AND sessions subdir — handles two orthogonal absence cases (agent never migrated vs agent has no recorded sessions yet)"
  - "force:true + errorOnExist:false on fs.cp — idempotent re-runs for Phase 81 rollback-then-retry; no EEXIST surprises"
  - "preserveTimestamps:true — WORK-05 byte-exact + mtime preservation extended to archive subtree"
  - "Ledger step naming 'session-archive:copy' / 'session-archive:skip' — matches '<module>:<operation>' convention established in Phase 77 (pre-flight:*) and Plan 01 (workspace-copy:*)"
  - "No filter predicate — session directories are ClawCode/OpenClaw-generated JSONL + metadata; venv/node_modules traps that workspace-copier skips don't exist here"
  - "Zero ConversationStore imports — enforced by static-grep test 8 (readFileSync('src/migration/session-archiver.ts').not.toMatch(/ConversationStore/))"

patterns-established:
  - "Static-grep isolation invariant — a file that doesn't import a module can't accidentally write to it; unit-test-level source-code assertion pins the contract without runtime instrumentation"
  - "Archive-only contract for cross-system migrations — passive filesystem copy, never a data-plane write into the target DB/ConversationStore"
  - "Per-agent same-target convention for shared workspaces — each finmentum agent calls archiver with its OWN sourceAgentDir + SAME targetBasePath; OpenClaw's per-agent session IDs guarantee filename distinctness"

requirements-completed:
  - WORK-04

# Metrics
duration: 4min
completed: 2026-04-20
---

# Phase 79 Plan 02: OpenClaw Session Archiver (WORK-04) Summary

**Dedicated session-archiver module landed: verbatim `fs.cp` of `~/.openclaw/agents/<name>/sessions/` → `<target>/archive/openclaw-sessions/`, graceful missing-source skip, manifest-sha ledger witness, and zero ConversationStore references pinned by static-grep invariant. Closes WORK-04 "archive-only, no replay" contract.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-20T20:10:15Z
- **Completed:** 2026-04-20T20:14:26Z
- **Tasks:** 1 (TDD — RED/GREEN, refactor skipped: implementation landed clean)
- **Files created:** 2 (1 src, 1 test)
- **Files modified:** 0
- **New deps:** 0
- **Tests:** 8 unit, all passing

## Module Surface

### `src/migration/session-archiver.ts`

```typescript
export const ARCHIVE_SESSIONS_SUBDIR = "archive/openclaw-sessions";

export type ArchiveSessionsArgs = {
  readonly agentId: string;
  readonly sourceAgentDir: string;   // ~/.openclaw/agents/<name>/ (absolute)
  readonly targetBasePath: string;   // <basePath>/ (absolute; archive goes in subdir)
  readonly ledgerPath: string;
  readonly sourceHash: string;
  readonly ts?: () => string;
};

export type ArchiveSessionsResult = {
  readonly pass: boolean;
  readonly copied: number;             // JSONL files copied (0 if skipped)
  readonly skipped: boolean;           // true when source sessions dir is absent
  readonly archiveDestPath: string;    // <targetBasePath>/archive/openclaw-sessions
};

export async function archiveOpenclawSessions(
  args: ArchiveSessionsArgs,
): Promise<ArchiveSessionsResult>;
```

## Key Behaviors

### Happy-path copy
- `fs.promises.cp(sourceSessionsDir, archiveDestPath, { recursive: true, preserveTimestamps: true, force: true, errorOnExist: false })`
- No filter predicate — raw verbatim copy
- Nested subdirectories (e.g. `sessions/2024/jan/a.jsonl`) preserved (Test 6)
- mtime preserved within ~1 ms (Test 7)
- Idempotent re-runs (force:true) for Phase 81 rollback-then-retry scenarios

### Missing-source tolerance
- Checked via `existsSync(args.sourceAgentDir) || !existsSync(sourceSessionsDir)` — covers both agent-never-existed AND agent-exists-but-no-sessions cases
- Returns `{pass:true, copied:0, skipped:true, archiveDestPath}` without throwing
- Ledger witness row: `step:"session-archive:skip"`, `outcome:"allow"`, `notes:"source sessions not found at <path>"`
- Normal case for finmentum sub-agents (fin-acquisition/-research/-playground/-tax per 79-CONTEXT)

### Manifest-sha witness
Cheaper than full-byte hash — archives are reference material, not primary content (workspace-copier owns full-byte witness for WORK-05). Algorithm:

1. Walk archive tree recursively (directory + file entries)
2. Collect `<relPath>:<size>` lines for every regular file
3. Sort lexicographically (deterministic across filesystem orderings)
4. `sha256(lines.join("\n"))` → hex
5. Record in `file_hashes[ARCHIVE_SESSIONS_SUBDIR]`

Enough forensic evidence to detect manifest-level tampering (file additions, deletions, resizings) without O(total-bytes) cost on re-runs.

### ConversationStore isolation (WORK-04 contract pin)

This module imports NOTHING from `src/conversation-store/**` (which doesn't exist anyway) and has zero references to `ConversationStore`. **Test 8** pins this at the source-code level:

```typescript
const src = readFileSync("src/migration/session-archiver.ts", "utf8");
expect(src).not.toMatch(/ConversationStore/);
```

Rationale per 79-CONTEXT Decision "Session Archive & ConversationStore Isolation": "Migrator NEVER calls ConversationStore write APIs during workspace copy... This is passive (migrator just doesn't touch that API); no filter needed in ConversationStore code." The dedicated module plus the grep invariant close the loop — the invariant is enforceable in CI without runtime instrumentation.

## Finmentum Family Handling

Per 79-CONTEXT, the 5 finmentum agents share one target base path but have distinct `sourceAgentDir`s under `~/.openclaw/agents/<name>/`. Plan 03 invokes `archiveOpenclawSessions` sequentially for each of the 5 agents with:
- `sourceAgentDir` = that agent's own `~/.openclaw/agents/<name>/`
- `targetBasePath` = the SHARED finmentum base path

All 5 invocations land files into the same `<shared>/archive/openclaw-sessions/` directory. OpenClaw's session basenames are session-ID scoped (distinct per agent by construction), so no dedup layer is required at this module. Concurrent archives across different agents touch disjoint filename sets — documented in the module header.

## Test Coverage

| # | Test | Pin |
|---|------|-----|
| 1 | happy-path copy | byte-identical target files + result shape |
| 2 | missing sessions subdir — skip | no target subtree created, pass:true |
| 3 | missing source agentDir entirely | skip path via existsSync short-circuit |
| 4 | ledger row on success | step:copy + outcome:allow + manifest sha256 hex |
| 5 | ledger row on skip | step:skip + outcome:allow + notes field |
| 6 | nested subdir preservation | recursive:true correctness |
| 7 | mtime preservation | preserveTimestamps:true within 2s tolerance |
| 8 | ConversationStore isolation | static-grep invariant on module source |

## Acceptance Criteria Results

- [x] `grep 'export async function archiveOpenclawSessions' src/migration/session-archiver.ts` → 1 match
- [x] `grep 'ARCHIVE_SESSIONS_SUBDIR = "archive/openclaw-sessions"'` → 1 match
- [x] `grep 'ConversationStore' src/migration/session-archiver.ts` → **0 matches** (WORK-04 isolation pin)
- [x] `grep 'preserveTimestamps:\s*true'` → 1 match
- [x] `grep 'session-archive:copy'` → 1 match
- [x] `grep 'session-archive:skip'` → 1 match
- [x] `grep 'existsSync'` → 3 matches (missing-source tolerance)
- [x] `grep 'createHash'` → 2 matches (manifest witness)
- [x] `grep -E 'import.*execa|fs-extra|cpy'` → 0 matches
- [x] `npx vitest run src/migration/__tests__/session-archiver.test.ts` → 8/8 pass
- [x] `git diff package.json` → zero changes
- [x] All 11 pre-existing migration test files continue to pass (149 tests)

## Deviations from Plan

**None** — plan executed exactly as written. Implementation landed clean on first GREEN iteration; refactor phase was not required.

## Out-of-Scope Observations

The following pre-existing tsc errors exist on master BEFORE this plan (verified via `git stash`):
- `src/tasks/task-manager.ts` — `causationId` missing from `CausalityContext` type (4 occurrences)
- `src/triggers/__tests__/engine.test.ts` — Mock type assignment errors (2 occurrences)
- `src/usage/__tests__/daily-summary.test.ts` — Tuple index errors on empty tuple (3 occurrences)
- `src/usage/budget.ts` — comparison-type mismatch on budget status
- `src/cli/commands/__tests__/latency.test.ts` + `tasks.test.ts` — implicit-any on `c` parameter (6 occurrences)
- `src/image/daemon-handler.ts` — `ImageProvider` / `ImageErrorType` type mismatches

These are **not caused by this plan** and are out of scope per the GSD scope-boundary rule (session-archiver only touches its own two files). Logged here for visibility; not added to deferred-items.md because they pre-date Phase 79 entirely.

A parallel Plan 01 (workspace-copier) run is expected to land `src/migration/workspace-copier.ts` — its test file `workspace-copier.test.ts` currently fails with "Cannot find module" and is Plan 01's responsibility to resolve.

## Handoff to Plan 03 (CLI wiring)

Plan 03 must:
1. In `migrate-openclaw.ts` `runApplyAction`, after workspace-copier succeeds for an agent, call:
   ```typescript
   await archiveOpenclawSessions({
     agentId: agent.name,
     sourceAgentDir: inventorySource.agentDir,  // from openclaw-config-reader
     targetBasePath: getTargetBasePath(agent),  // from diff-builder (shared for finmentum)
     ledgerPath: DEFAULT_LEDGER_PATH,
     sourceHash: planReport.planHash,
   });
   ```
2. For the finmentum family, iterate the 5 agents sequentially — they all write into the same shared archive subdir, but with per-agent-distinct session filenames.
3. Surface `result.skipped` in CLI output so operators understand when an agent had no source sessions (normal, not an error).
4. The Plan 03 integration test should also include a static-grep invariant on the CLI wiring module: confirm NO import of any session-replay API from the archiver call site.

## Self-Check: PASSED

- Files created:
  - FOUND: src/migration/session-archiver.ts
  - FOUND: src/migration/__tests__/session-archiver.test.ts
- Commits:
  - FOUND: 240b7b7 (test: failing tests)
  - FOUND: b45cf08 (feat: implementation)
- Acceptance criteria: 12/12 pass
- Tests: 8/8 pass
- ConversationStore isolation invariant: 0 matches confirmed
