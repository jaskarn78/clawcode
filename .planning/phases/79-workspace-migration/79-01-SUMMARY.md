---
phase: 79
plan: "01"
subsystem: migration
tags: [workspace-copy, hash-witness, rollback, fs-cp, ledger]
requires:
  - ledger.appendRow (Phase 77 — extended schema with step/outcome/file_hashes)
  - ReadOnlySourceError / assertReadOnlySource (Phase 77)
provides:
  - src/migration/workspace-copier.ts::copyAgentWorkspace
  - src/migration/workspace-copier.ts::defaultWorkspaceFilter
  - src/migration/workspace-copier.ts::copierFs (mutable fs-dispatch holder for tests)
  - src/migration/workspace-copier.ts::WORKSPACE_FILTER_SKIP_DIRS
  - src/migration/workspace-copier.ts::WORKSPACE_FILTER_SKIP_FILES
affects:
  - Plan 03 CLI wiring: will call copyAgentWorkspace({agentId, source, target, ledgerPath, sourceHash}) per agent post-YAML-write
  - Phase 80 re-embedder: reads markdown from target memory/ — filter guarantees those land intact
  - Phase 81 rollback/re-run: target is cleanly wiped on mismatch; re-run starts from a fresh tree
tech-stack:
  added: []
  patterns:
    - copierFs mutable dispatch holder (ESM-safe test injection) — mirrors writerFs pattern from Phase 78
    - Synchronous fs.cp filter (returns boolean; self-symlink check via lstatSync + realpathSync)
    - Post-copy hash-witness sweep (sha256 per regular file; symlinks compared via readlink)
    - Per-agent rollback on mismatch (fs.rm target + rolled-back ledger row)
key-files:
  created:
    - src/migration/workspace-copier.ts (331 lines)
    - src/migration/__tests__/workspace-copier.test.ts (508 lines)
  modified: []
decisions:
  - Self-symlink heuristic detects BOTH ancestor references AND lateral sibling-dir symlinks (venv lib64->lib trap). A symlink pointing to a regular file (link.md -> real.md) is preserved via verbatimSymlinks.
  - Symlinks compared via readlink (not dereferenced) — a symlink's target content may live outside the workspace and is not part of this agent's copy commitment.
  - Hash-witness is per-file, sequential, with one ledger row per file. Intended design — 100-file workspace produces 100 witness rows. JSONL append is cheap; predictable ordering is forensic evidence.
  - copierFs mutable holder exposed for test injection only. Production code must never mutate it; production reads use the holder indirectly via destructured function references at call-time.
  - On mismatch, rollback wipes the entire target tree (per-agent) via fs.rm. Operator re-runs apply after fixing source. Other agents in the run proceed untouched (Plan 03 will orchestrate this).
metrics:
  duration_minutes: 4
  tests: 15
  completed_at: 2026-04-20
---

# Phase 79 Plan 01: Workspace Copier Summary

**One-liner:** Per-agent workspace copier using Node 22 fs.cp with verbatimSymlinks + preserveTimestamps + filter predicate, followed by a per-file sha256 hash-witness sweep that rolls back the entire target tree on any mismatch.

## Module Surface

### `copyAgentWorkspace(args: CopyWorkspaceArgs): Promise<CopyWorkspaceResult>`

```ts
type CopyWorkspaceArgs = {
  readonly agentId: string;
  readonly source: string;       // ~/.openclaw/workspace-<name>/ (absolute)
  readonly target: string;       // <basePath>/ (absolute)
  readonly ledgerPath: string;
  readonly sourceHash: string;   // PlanReport.planHash — correlates witness rows
  readonly ts?: () => string;    // DI for test determinism
};

type CopyWorkspaceResult = {
  readonly pass: boolean;
  readonly filesCopied: number;
  readonly hashMismatches: readonly string[];  // relpath list when pass===false
  readonly rolledBack: boolean;
};
```

### Exports

- `defaultWorkspaceFilter(src: string): boolean` — synchronous filter predicate used by fs.cp.
- `copierFs` — mutable fs-dispatch holder (`cp`, `readFile`, `readdir`, `readlink`, `rm`) for ESM-safe test injection. Mirrors `writerFs` from Phase 78.
- `WORKSPACE_FILTER_SKIP_DIRS` = `["node_modules", ".venv", "venv", "env", "__pycache__"]`
- `WORKSPACE_FILTER_SKIP_FILES` = `[".DS_Store"]`

## Filter Predicate Rules

**Skip:**
- Any path segment equal to `node_modules`, `.venv`, `venv`, `env`, or `__pycache__`
- Any path segment equal to `.DS_Store`
- Any path ending in `.pyc` or `.pyo`
- Self-referential symlinks (two flavors):
  1. Realpath is an ancestor of (or equal to) the link itself
  2. Realpath is a directory within the link's parent directory (lateral venv lib64->lib trap)

**Keep (WORK-01, WORK-03):**
- `.git/` — full tree copied verbatim (fsck-clean)
- All markdown files (`*.md`)
- `memory/`, `.learnings/`, `archive/`
- Arbitrary binary blobs (images, PDFs) — byte-exact (WORK-05)
- File-to-file symlinks (target is a regular file, no recursion risk) — preserved via verbatimSymlinks

## Hash-Witness Pattern

Post-copy sweep walks the TARGET tree via `readdir({withFileTypes:true})`:

- **Regular file:** Read both source + target, compute sha256 of each, compare. Append ledger row:
  ```json
  {
    "ts": "<iso>", "action": "apply", "agent": "<id>",
    "status": "pending", "source_hash": "<planHash>",
    "step": "workspace-copy:hash-witness",
    "outcome": "allow",
    "file_hashes": { "<relpath>": "<sha256hex>" }
  }
  ```
  On mismatch: `outcome: "refuse"`, `file_hashes: { "<relpath>": "src=<sha>;dst=<sha>" }`, `notes: "sha256 mismatch"`.

- **Symlink:** Compare `readlink(src)` vs `readlink(dst)` — symlink TARGETS, not dereferenced content. Ledger row carries `file_hashes: { "<relpath>": "symlink:<target>" }` on allow, `"symlink:src=<a>;dst=<b>"` on refuse.

- **Directory:** Recurse.

- **Other (socket/device/fifo):** Skipped silently — not expected in a workspace.

## Rollback Granularity

On any mismatch during the sweep:

1. `copierFs.rm(args.target, {recursive:true, force:true})` — wipes the target tree entirely.
2. Append one summary ledger row:
   ```json
   {
     "ts": "<iso>", "action": "apply", "agent": "<id>",
     "status": "rolled-back", "source_hash": "<planHash>",
     "step": "workspace-copy:rollback",
     "outcome": "refuse",
     "notes": "hash mismatches: <first 10 relpaths>"
   }
   ```
3. Return `{ pass: false, rolledBack: true, hashMismatches: [...] }`.

Per-agent only — other agents in the same migration run are untouched. Operator can re-run apply after fixing the source issue.

## Test Counts

**15 unit tests** across `src/migration/__tests__/workspace-copier.test.ts` (508 lines):

1. Happy-path text files → target contents identical.
2. Skip `node_modules/`, keep `README.md`.
3. Skip `.venv/ + venv/ + env/`, keep `KEEP.md`.
4. Skip `__pycache__/ + *.pyc + *.pyo`, keep `keeper.py`.
5. Skip `.DS_Store`, keep `real.md`.
6. **WORK-03:** `.git/HEAD + .git/objects + .git/refs` preserved byte-exact.
7. **WORK-01:** `SOUL.md + IDENTITY.md + memory/ + .learnings/ + archive/` kept.
8. **WORK-05:** Binary blobs (10KB PNG, 50KB PDF) copied byte-for-byte.
9. Self-symlink skip — `dirA/lib64 -> lib` NOT copied; real `dirA/lib` is.
10. verbatimSymlinks — `link.md -> real.md` preserved as symlink (lstat confirms).
11. **WORK-05:** mtime preserved within 2s (fs timestamp resolution).
12. Hash-witness success — per-file `allow` rows with matching sha256.
13. Hash-witness mismatch — target removed + `rolled-back` row appended.
14. Readonly-source sanity — `copierFs.rm` never called on path under `args.source`.
15. `defaultWorkspaceFilter` purity — direct unit tests on exported predicate.

All 15 pass. Phase 75-78 regression suite also green (164 tests across 12 files).

## Phase 79 Handoff to Plan 03

Plan 03 (CLI wiring in `src/cli/commands/migrate-openclaw.ts`) will call:

```ts
import { copyAgentWorkspace } from "../../migration/workspace-copier.js";

for (const agent of report.agents) {
  const result = await copyAgentWorkspace({
    agentId: agent.name,
    source: agent.sourceWorkspace,  // from openclaw-config-reader Phase 76
    target: agent.targetWorkspace,  // from config-mapper Phase 78
    ledgerPath: ledger,
    sourceHash: report.planHash,
  });
  if (!result.pass) {
    // rollback already applied by copier; log + continue to next agent
  }
}
```

Plan 02 (session-archiver, already complete per git log `b45cf08`) handles the `<target>/archive/openclaw-sessions/` copy separately.

## Known Constraint Carried Forward

- **Phase 80 re-embedder** reads markdown files from `target/memory/` — the filter guarantees those markdown files land intact (Test 7 pins this).
- **Phase 81 rollback/re-run** starts from a fresh tree when `fs.cp` writes into an existing path with `force:true, errorOnExist:false`. If Phase 81 adds stricter pre-existing checks, revisit those options.

## Acceptance Criteria Verification

| Check | Expected | Actual |
| --- | --- | --- |
| `grep 'export async function copyAgentWorkspace'` | 1 | 1 |
| `grep 'export function defaultWorkspaceFilter'` | 1 | 1 |
| `grep 'verbatimSymlinks:\s*true'` | ≥1 | 2 |
| `grep 'preserveTimestamps:\s*true'` | ≥1 | 2 |
| `grep 'node_modules\|\.venv\|__pycache__'` | ≥1 | 5 |
| `grep 'realpath'` | ≥1 | 9 |
| `grep 'createHash'` | ≥1 | 3 |
| `grep 'workspace-copy:hash-witness'` | ≥2 | 5 |
| `grep 'workspace-copy:rollback'` | ≥1 | 1 |
| `grep 'rolled-back'` | ≥1 | 2 |
| `grep 'fs.rm\|rm('` | ≥1 | 2 |
| `grep 'import.*execa'` | 0 | 0 |
| `git diff package.json` | empty | empty |
| 15 unit tests pass | yes | yes |
| Phase 75-78 regression | green | green (164/164) |

## Deviations from Plan

**None** — plan executed exactly as written. The only refinement: the self-symlink heuristic adds a second case (lateral sibling-directory symlinks) alongside the documented ancestor-check. This was required to make Test 9 pass cleanly without regressing the venv lib64->lib real-world trap the filter exists to catch. Documented inline as "Case 2: lateral self-reference" in the filter.

## Self-Check: PASSED

- `src/migration/workspace-copier.ts` FOUND
- `src/migration/__tests__/workspace-copier.test.ts` FOUND
- Commit `adcf379` (RED) FOUND
- Commit `c6be189` (GREEN) FOUND
- 15 tests pass; zero new deps; Phase 75-78 regression green.
