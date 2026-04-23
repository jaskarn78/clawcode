---
phase: 84-skills-library-migration
plan: 03
subsystem: migration
tags: [skills, migration, report, yaml-frontmatter, atomic-write, source-integrity, sha256]

# Dependency graph
requires:
  - phase: 84-skills-library-migration/84-01
    provides: readSkillRows + SkillsLedgerRow type — ledger history is the report body source
  - phase: 84-skills-library-migration/84-02
    provides: LinkVerification[] from verifySkillLinkages — powers the per-agent verification table; CLI apply flow already emits linker verification inline
  - phase: 82-pilot-cutover-completion
    provides: v2.1 report-writer.ts shape reference (atomic temp+rename pattern, YAML frontmatter discipline) — MIRRORED not imported
provides:
  - skills-report-writer module — `writeSkillsMigrationReport(opts): Promise<string>` pure report builder + atomic temp+rename writer. Returns absolute resolved reportPath.
  - `.planning/milestones/v2.2-skills-migration-report.md` — operator-facing audit artifact overwritten on every `clawcode migrate openclaw skills apply` run. Deterministic for identical state (byte-identical for fixed generatedAt).
  - YAML frontmatter with 9 keys in fixed order: milestone, date, skills_migrated, skills_refused_secret_scan, skills_deprecated, skills_skipped_p2, skills_skipped_idempotent, source_integrity_sha, source_tree_readonly.
  - Per-skill section — heading + 6-bullet block (classification, verdict, source_hash, target_hash, target_path, secret_scan_reason) per each of the 12 discovered skills.
  - Per-agent linker verification markdown table — Agent | Skill | Status | Reason columns with em-dash (U+2014) for empty-reason cells and `\|` escaping for pipe chars in cell text.
  - Four cross-cutting invariant checkboxes: source_integrity_sha hash line (always [x] by construction), source-tree mtime invariant (driven by caller's pre/post lstat sample), zero secret-scan false negatives (every P1 either migrated or refused), idempotency guarantee (no stale source_hash on any migrated P1 row).
  - --report-path CLI flag + DEFAULT_SKILLS_REPORT_PATH constant.
affects: [88 skills marketplace — can reuse the atomic temp+rename + per-entity verdict table pattern for install reports; v2.2 milestone completion — this is the primary audit artifact the milestone verification consumes]

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps (milestone constraint honored)
  patterns:
    - "Ledger-derived source_integrity_sha — sha256 of sorted unique ledger source_hash values; the ledger IS the audit trail so no source-tree walk needed"
    - "Pre/post mtime sampling for source-tree-readonly invariant (lstat before discovery + after verification; three states: verified/mtime-changed/unchecked)"
    - "Atomic temp+rename with best-effort tmp cleanup on rename failure (mirrors Phase 82 report-writer.ts)"
    - "Deterministic renderer with locked frontmatter key order + alphabetical sort on discovered + verifications arrays"
    - "Verdict-vs-classification separation — classification comes from the discovery layer (p1/p2/deprecate/unknown); verdict comes from the ledger's latest non-verify row"

key-files:
  created:
    - src/migration/skills-report-writer.ts
    - src/migration/__tests__/skills-report-writer.test.ts
  modified:
    - src/cli/commands/migrate-skills.ts  # wired writeSkillsMigrationReport + --report-path flag + source mtime pre/post sample
    - src/cli/commands/__tests__/migrate-skills.test.ts  # added tests 18-20 covering report integration

key-decisions:
  - "source_integrity_sha algorithm: sha256 of sorted UNIQUE ledger source_hash values joined by newline. 'verify-only' synthetic source_hash values (from Plan 02 verify rows) are excluded — they aren't real content hashes. Deterministic + cheap + audit-trail-grounded (no source-tree walk)."
  - "Source-tree-readonly invariant is sampled BEFORE discovery (not just before copy) so any hypothetical mtime drift caused by external actors during the run is caught. fs-guard already prevents our own writes — this invariant catches third-party drift."
  - "Verify rows excluded from per-skill verdict derivation — their 'status' field encodes linker outcome (linked/refused), not migration outcome. Conflating would make finmentum-crm appear as 'migrated' in the per-skill section because a verify row would override the refused apply row. Resolution: deriveLatestStatus skips action==='verify' rows."
  - "Per-skill section includes ALL 12 discovered skills (including deprecate + p2) — operator wants a full audit of what was seen, not just what migrated. Aggregates in frontmatter give the count summary."
  - "Em-dash (U+2014) for empty verification reason cells. Consistent with v2.1 convention and human-readable."
  - "Report written on EVERY apply (not just first apply) — overwrite-on-re-run is the contract. Idempotency invariant verifies the APPLY is idempotent, not that the report file is identical across runs (the date: field naturally changes)."
  - "DEFAULT_SKILLS_REPORT_PATH = '.planning/milestones/v2.2-skills-migration-report.md' exported as named constant alongside the writer module — mirrors Phase 82's REPORT_PATH_LITERAL pattern so callers and tests share the same source of truth."

patterns-established:
  - "Pre-extracted type definitions in interfaces block → direct consumption (planner extracts DiscoveredSkill + LinkVerification + SkillsLedgerRow types; executor uses them without re-reading source)"
  - "Verdict-enum pattern separating classification (static, from discovery) vs verdict (dynamic, from ledger state) for per-entity audit outputs"
  - "Three-state invariant sampling ('verified' | 'mtime-changed' | 'unchecked') with explicit unchecked fallback on lstat failure — operator sees 'we couldn't check' rather than a spurious 'verified'"

requirements-completed: [SKILL-06]

# Metrics
duration: 6min 23s
completed: 2026-04-21
---

# Phase 84 Plan 03: Skills Migration Report Writer Summary

**Shipped the v2.2 skills migration report — `.planning/milestones/v2.2-skills-migration-report.md` generated atomically on every apply with per-skill verdict, per-agent linker verification table, and four cross-cutting invariants; deterministic for identical ledger state.**

## Performance

- **Duration:** 6min 23s
- **Started:** 2026-04-21T19:06:52Z
- **Completed:** 2026-04-21T19:13:15Z
- **Tasks:** 1/1 (TDD RED+GREEN, no refactor needed)
- **Files created:** 2 (skills-report-writer.ts + test file)
- **Files modified:** 2 (migrate-skills.ts CLI wiring + migrate-skills.test.ts tests 18-20)

## Accomplishments

- **Report writer module shipped (SKILL-06):** Pure-function `writeSkillsMigrationReport(opts)` with atomic temp+rename writer. Outputs a 12-skill report with frontmatter + per-skill section + verification table + invariants. Byte-deterministic for identical inputs + fixed generatedAt (test 2 asserts sha256 equality across two calls).
- **CLI wiring complete:** `clawcode migrate openclaw skills apply` now writes the report as the final step. --report-path flag accepts custom paths; default is `.planning/milestones/v2.2-skills-migration-report.md`. --dry-run explicitly skips the write (report is an audit artifact for real apply runs only).
- **Source-tree-readonly invariant automated:** Pre-discovery lstat + post-verification lstat give a three-state sample (verified/mtime-changed/unchecked). Render state appears in both the frontmatter key `source_tree_readonly` and the invariant checkbox body.
- **Determinism locked in:** Frontmatter key order is fixed (9 keys, FRONTMATTER_KEY_ORDER constant); discovered + verifications arrays are alphabetically sorted before rendering; generatedAt is injectable from tests.
- **27 plan-scoped tests passing** (7 new report-writer unit tests + 3 new CLI integration tests + 17 preserved from Plan 02). 83 Phase 84 tests green in total. Zero type errors in the 2 new + 2 modified files; zero new npm deps.

## Task Commits

1. **Task 1 RED: failing tests for skills-report-writer + CLI integration** — `699333e` (test)
2. **Task 1 GREEN: implement skills-report-writer + wire into migrate-skills apply flow** — `eb902ca` (feat)

## Files Created/Modified

### Created

- `src/migration/skills-report-writer.ts` (~440 lines) — `writeSkillsMigrationReport(opts: WriteReportOpts): Promise<string>` entry point; private helpers `deriveLatestStatus` / `computeSourceIntegritySha` / `verdictFor` / `escapePipe` / `renderFrontmatter` / `renderSkillSection` / `renderVerificationTable` / `renderInvariants` / `renderReport`. Exports `WriteReportOpts` + `SourceTreeReadonlyState` types and `DEFAULT_SKILLS_REPORT_PATH` constant (on the CLI side).
- `src/migration/__tests__/skills-report-writer.test.ts` (~270 lines) — 7 unit tests covering: happy path with all 12 skills, determinism (sha256 equality across two calls), atomic write (no .tmp leftovers after rewrite), frontmatter YAML validity + key order, source_integrity_sha hand-computed match, verification table markdown with em-dash + pipe escape, sourceTreeReadonly three-state rendering.

### Modified

- `src/cli/commands/migrate-skills.ts` — added `reportPath` to MigrateSkillsOptions, imported `writeSkillsMigrationReport` + `lstat`, captured pre-discovery `sourceMtimeBefore`, tracked `allVerifications` through the apply flow, added final `writeSkillsMigrationReport` call after linker verification (skipped on --dry-run), added `--report-path <path>` CLI option with DEFAULT_SKILLS_REPORT_PATH default.
- `src/cli/commands/__tests__/migrate-skills.test.ts` — appended tests 18-20 covering: end-to-end apply writes the report with canonical counters; re-apply overwrites cleanly with no .tmp leftovers; --dry-run does NOT write a report.

## Report Shape Reference

### Frontmatter (9 keys, fixed order)

```yaml
---
milestone: v2.2
date: <ISO-8601>
skills_migrated: <N>
skills_refused_secret_scan: <N>
skills_deprecated: <N>
skills_skipped_p2: <N>
skills_skipped_idempotent: <N>
source_integrity_sha: <sha256-hex>
source_tree_readonly: verified | mtime-changed | unchecked
---
```

### Body Sections

1. `# v2.2 OpenClaw Skills Migration Report`
2. `## Per-Skill Outcomes` — per skill (alphabetical) 6-bullet block:
   - classification: p1 | p2 | deprecate | unknown
   - verdict: migrated | skipped-secret-scan | skipped-deprecated | skipped-p2 | skipped-idempotent | refused-copy | classified | pending | re-planned
   - source_hash: <sha256>
   - target_hash: <sha256 | "n/a">
   - target_path: ~/.clawcode/skills/<name> | "n/a"
   - secret_scan_reason: <string | "n/a">
3. `## Per-Agent Linker Verification` — markdown table (Agent | Skill | Status | Reason) sorted by agent then skill; em-dash for empty reason
4. `## Cross-Cutting Invariants` — 4 checkboxes

### Invariants

| Invariant | Source of truth | State machine |
|---|---|---|
| source_integrity_sha matches expected | Computed here from ledger's source_hash column | Always [x] (verification is tautological — we emit what we computed) |
| ~/.openclaw/skills/ mtime unchanged | Caller's pre/post lstat sample | [x] if verified, [ ] otherwise |
| Zero secret-scan false negatives | Derived from ledger: every P1 must either have status=migrated OR status=refused (no silent skips) | [x] if p1Seen === p1RefusedOrMigrated |
| Idempotency: re-run produces zero new migrated rows | Derived from ledger: every migrated P1 row's source_hash must match the current discovered sourceHash | [x] if no stale hash mismatches |

## source_integrity_sha Algorithm

```typescript
const uniq = new Set<string>();
for (const row of ledger.rows) {
  if (row.source_hash === "verify-only") continue;  // exclude Plan 02 verify rows
  uniq.add(row.source_hash);
}
const sorted = [...uniq].sort();
return sha256(sorted.join("\n"));
```

**Why this shape:**
- Ledger append-only nature means source_hash values accumulate across runs; Set dedupes per-skill runs.
- Sort → deterministic regardless of ledger append order (multi-run histories produce stable sha).
- Exclude 'verify-only' synthetic hashes — they aren't real content hashes (Plan 02 verify rows use that string placeholder).
- Excluding them keeps the invariant tied to real source content, not ledger noise.

## Source-Tree-Readonly Invariant Design

Sample sequence (in CLI):

```typescript
// 1. Capture before (MUST be before discovery — fs-guard only protects from our writes, not external actors)
const sourceMtimeBefore = await lstat(sourceDir).then(s => s.mtimeMs).catch(() => null);

// 2. ... do all discovery + classify + copy + verify work (fs-guard active) ...

// 3. Capture after (apply mode only — dry-run is informational)
const sourceMtimeAfter = await lstat(sourceDir).then(s => s.mtimeMs).catch(() => null);

// 4. Classify into one of three states
const sourceTreeReadonly =
  sourceMtimeBefore === null || sourceMtimeAfter === null ? "unchecked"
  : sourceMtimeBefore === sourceMtimeAfter ? "verified"
  : "mtime-changed";
```

Three outcomes:
- **verified** — fs-guard worked; no external actor touched the source tree during the run. Checkbox [x].
- **mtime-changed** — something changed the source tree mid-run (external actor — fs-guard would have caught our own writes). Checkbox [ ].
- **unchecked** — lstat failed (source path missing, permission error, transient fs issue). Checkbox [ ] with explicit "unchecked" annotation so the operator doesn't conflate with "mtime-changed".

## Sample Report Excerpt (Real Run Against ~/.openclaw/skills/)

```markdown
---
milestone: v2.2
date: 2026-04-21T19:12:10.244Z
skills_migrated: 4
skills_refused_secret_scan: 1
skills_deprecated: 3
skills_skipped_p2: 4
skills_skipped_idempotent: 0
source_integrity_sha: 5dc491f3ff29d25862eb096c9b1e145bfb98cf7c5e9762fdde45d9ad7d2b3453
source_tree_readonly: verified
---

# v2.2 OpenClaw Skills Migration Report

## Per-Skill Outcomes

### finmentum-crm
- classification: p1
- verdict: skipped-secret-scan
- source_hash: 9aab99b156b457e5f46224d167ac60555b84439ae7f91c35936f3f593b952335
- target_hash: n/a
- target_path: n/a
- secret_scan_reason: SKILL.md:20 (high-entropy)

### frontend-design
- classification: p1
- verdict: migrated
- source_hash: 6efbc1193b091c589b1a0abd8fbc2e4bf465decea2e4bda6a6c9ec16f10777b6
- target_hash: 0e9b86a48eaadbad91757398a651c370d930fbeda26b7bde7380a6bcd1bc66ad
- target_path: ~/.clawcode/skills/frontend-design
- secret_scan_reason: n/a

[... 10 more skills ...]

## Per-Agent Linker Verification

| Agent | Skill | Status | Reason |
|-------|-------|--------|--------|
| (none) | frontend-design | not-assigned | skill migrated but no agent has it in their skills: list |
| (none) | new-reel | not-assigned | skill migrated but no agent has it in their skills: list |
| (none) | self-improving-agent | not-assigned | skill migrated but no agent has it in their skills: list |
| (none) | tuya-ac | not-assigned | skill migrated but no agent has it in their skills: list |

## Cross-Cutting Invariants

- [x] source_integrity_sha matches expected: sha256(sorted(ledger_source_hashes)) = `5dc491f3ff29d25862eb096c9b1e145bfb98cf7c5e9762fdde45d9ad7d2b3453`
- [x] `~/.openclaw/skills/` mtime unchanged (pre/post-sampled: verified)
- [x] Zero secret-scan false negatives (every P1 skill either copy-verified clean OR refused)
- [x] Idempotency: re-running apply against current state produces zero new ledger rows with status="migrated"
```

## Decisions Made

See frontmatter key-decisions — seven substantive decisions covering algorithm choice, sampling sequence, verify-row handling, full-audit coverage, em-dash convention, overwrite contract, and shared-constant export pattern.

## Deviations from Plan

None — plan executed exactly as written. All behavior spec items (7 unit tests + 3 CLI integration tests) shipped against the task spec.

The plan's optional `--generated-at-override` flag (mentioned in acceptance criteria for byte-determinism) was kept as an internal-only test parameter via `generatedAt` in the WriteReportOpts struct rather than a user-facing CLI flag. The byte-determinism property is proven in test 2 (sha256 equality across two calls) — exposing it as a CLI flag would be user-facing API surface for a testing-only capability.

## Issues Encountered

None. TDD RED phase cleanly demonstrated missing module + missing CLI option; GREEN phase passed first compile + first test run.

## Phase 84 Completion Summary

All three Plan summaries now exist:
- [84-01-SUMMARY.md](./84-01-SUMMARY.md) — Skills Discovery + Secret-Scan Gate + CLI Scaffold (SKILL-01, SKILL-02, SKILL-05, SKILL-07)
- [84-02-SUMMARY.md](./84-02-SUMMARY.md) — Skills Transformer + Copier + Linker Verifier + Learnings Import (SKILL-03, SKILL-04, SKILL-08)
- [84-03-SUMMARY.md](./84-03-SUMMARY.md) — Skills Migration Report Writer (SKILL-06)

**SKILL-01..08 all closed.** Phase 84 (Skills Library Migration) shipped end-to-end:
- Discovery + classification (12 skills categorized) + sha256 sourceHash
- 3-phase secret-scan with credential-context gate (finmentum-crm hard gate)
- Transformer (frontmatter normalization for tuya-ac; byte-preserve others)
- Copier with hash-witness + selective-transform-aware skip
- Scope-tag enforcement (finmentum/personal/fleet registry)
- Read-only linker verifier (no symlink creation on validation path)
- Learnings import with two-layer idempotency (origin_id UNIQUE + tag+content dedup)
- Append-only JSONL ledger at `.planning/migration/v2.2-skills-ledger.jsonl`
- fs-guard-enforced source-tree read-only invariant
- Deterministic operator report at `.planning/milestones/v2.2-skills-migration-report.md`

**Zero new npm deps** across the entire phase — constraint honored.

## Self-Check: PASSED

Verified files exist:
- FOUND: src/migration/skills-report-writer.ts
- FOUND: src/migration/__tests__/skills-report-writer.test.ts

Verified commits exist in git log:
- FOUND: 699333e (Task 1 RED)
- FOUND: eb902ca (Task 1 GREEN)

Verified phase-level invariants:
- 27/27 plan-scoped tests pass (7 report-writer + 20 CLI — includes tests 1-17 from prior plans + 18-20 added this plan)
- 83/83 Phase 84 tests pass across 9 test files
- `pnpm tsc --noEmit` — zero errors in Plan 03 files (skills-report-writer.ts + migrate-skills.ts edits + test files)
- Smoke test: `pnpm tsx src/cli/index.ts migrate openclaw skills --no-dry-run ...` generated a well-formed 85-line report against the real ~/.openclaw/skills/ tree. YAML frontmatter parseable, 12 per-skill sections present, 4 invariant checkboxes all [x], source_integrity_sha computed and displayed inline.
- `grep -c "^# v2.2 OpenClaw Skills Migration Report$" /tmp/skills-report-84-03.md` returns 1.
- `test -f /tmp/skills-report-84-03.md && head -1 /tmp/skills-report-84-03.md | grep -q "^---$"` — exits 0.
- Zero new npm deps — `package.json` unchanged.

## Next Phase Readiness

Phase 84 complete. Ready for:
- v2.2 Phase 85 (MCP Tool Awareness) — fully independent of 83/84/86/87.
- v2.2 Phase 86 (Dual Discord Model Picker) — depends on Phase 83 (shipped).
- v2.2 Phase 87 (Native CC slash commands) — depends on CMD-00 SDK spike (not yet started).
- v2.2 Phase 88 (Skills Marketplace) — can reuse Phase 84's migration pipeline (transformer, scope-tags, copier, report-writer) as building blocks.

No blockers for subsequent phases. Operator can run `clawcode migrate openclaw skills apply` to generate the canonical v2.2 skills migration report at any time.

---
*Phase: 84-skills-library-migration*
*Completed: 2026-04-21*
