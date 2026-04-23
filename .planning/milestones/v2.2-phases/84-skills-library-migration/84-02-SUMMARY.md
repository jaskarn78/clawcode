---
phase: 84-skills-library-migration
plan: 02
subsystem: migration
tags: [skills, migration, transformer, copier, linker, scope-tags, learnings, dedup, origin_id]

# Dependency graph
requires:
  - phase: 80-migrate-openclaw-memory
    provides: MemoryStore origin_id UNIQUE partial index (Phase 80 MEM-02) — hard idempotency gate reused for learnings import
  - phase: 79-migrate-openclaw-workspace-copy
    provides: workspace-copier.ts shape — hash-witness + verbatimSymlinks pattern mirrored in skills-copier
  - phase: 84-skills-library-migration/84-01
    provides: skills-discovery + skills-secret-scan + skills-ledger + CLI scaffold; Plan 02 replaces the "would-migrate" stub with the real apply path
provides:
  - Transformer — `normalizeSkillFrontmatter(content, skillName): string` adds YAML `name:` + `description:` when absent; byte-preserves existing frontmatter. `hasFrontmatter(content): boolean` helper.
  - Copier — `copySkillDirectory(sourceDir, targetDir, opts?): Promise<CopyResult>` with `defaultSkillsFilter` (skips node_modules, __pycache__, .git, *.pyc/pyo, .DS_Store, SKILL.md.{backup,pre,pre-fix,pre-restore}-*), `verbatimSymlinks` cp, post-copy sha256 hash witness, deterministic `targetHash`, optional `transformSkillMd` hook.
  - Scope tags — `SCOPE_TAGS` map (P1 skills → finmentum/personal/fleet) + `scopeForAgent(name)` + `canLinkSkillToAgent(skill, agent, {force?})`. Implements SKILL-08 gate.
  - Linker verifier — `verifySkillLinkages({catalog, resolvedAgents, migratedSkillNames, force?}): LinkVerification[]` read-only per-agent resolution check (linked / missing-from-catalog / scope-refused / not-assigned).
  - Learnings dedup — `readLearningsDir(path)` + `dedupeLearnings(learnings, memoryStore)` partition into toImport/skipped via MemoryStore `findByTagAndContent("learning", trimmedContent)`.
  - MemoryStore `findByTagAndContent(tag, content): {id} | undefined` — narrow additive lookup for migration dedup.
  - CLI apply path — `clawcode migrate openclaw skills --no-dry-run --skills-target <path> --clawcode-yaml <path> --force-scope --memory-db <path>` end-to-end copy + transform + learnings import + verification.
affects: [84-03 report writer consumes ledger rows + verification array, 88 skills marketplace reuses the transformer + scope-tags + copier]

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps (constraint honored)
  patterns:
    - "SKILL.md frontmatter normalizer (prepend when absent; byte-preserve when present) — idempotent via hasFrontmatter precheck"
    - "Per-skill directory copier with hash-witness + optional SKILL.md transform hook (selective mismatch suppression for rewritten SKILL.md)"
    - "Scope-tag registry + agent-family classifier as the single source of truth for SKILL-08 (Finmentum scoping)"
    - "Read-only catalog-lookup verifier (mirrors linker resolution without symlinking) for pre-startup migration validation"
    - "Origin_id-addressed learnings import (sha256 of trimmed content, 16-char prefix) — two-layer idempotency: MemoryStore UNIQUE partial index + tag+content dedup"
    - "CLI action chain: discover → secret-scan → ledger-idempotency → copy+transform → learnings-dedup → scan+verify → ledger verify-rows"

key-files:
  created:
    - src/migration/skills-transformer.ts
    - src/migration/skills-scope-tags.ts
    - src/migration/skills-copier.ts
    - src/migration/skills-linker-verifier.ts
    - src/migration/skills-learnings-dedup.ts
    - src/migration/__tests__/skills-transformer.test.ts
    - src/migration/__tests__/skills-copier.test.ts
    - src/migration/__tests__/skills-scope-tags.test.ts
    - src/migration/__tests__/skills-linker-verifier.test.ts
    - src/migration/__tests__/skills-learnings-dedup.test.ts
    - .planning/phases/84-skills-library-migration/deferred-items.md
  modified:
    - src/cli/commands/migrate-skills.ts  # Plan 01 stub replaced with apply path + learnings + linker verification + new CLI flags
    - src/cli/commands/__tests__/migrate-skills.test.ts  # tests 12-17 added for apply path
    - src/memory/store.ts  # narrow findByTagAndContent lookup added (Phase 84 SKILL-04)

key-decisions:
  - "Transformer adds frontmatter to tuya-ac ONLY (others already have it); does not modify scanner.ts (scope creep risk + v2.1 scanner consumed by Phase 83). extractDescription fallback in scanner.ts already handles first-paragraph-as-description for skills without a frontmatter description:, so the minimal `name:` + `description:` prepend is sufficient."
  - "Copier filter EXCLUDES .git/ — self-improving-agent ships with a .git dir that is transient VCS metadata, not skill content. Also excludes SKILL.md.{backup,pre,pre-fix,pre-restore}-* (editor snapshots in new-reel + self-improving-agent)."
  - "Hash witness SELECTIVELY skips SKILL.md when transformSkillMd actually changed the content — the mismatch is expected after the rewrite. All other files get the full byte-for-byte witness."
  - "Linker verifier is READ-ONLY — does NOT call linkAgentSkills (which creates symlinks). Replicates the catalog.has(skillName) resolution check so dry-run validation cannot poison the real link table on failure."
  - "MemoryStore.findByTagAndContent uses LIKE '%\"tag\"%' (quoted-JSON substring match) — tags column is a JSON array string; exact-token match requires the quote wrappers to avoid matching prefixes (e.g., `learnings` should not match tag=`learning`)."
  - "Learnings import source='manual' (MemoryStore CHECK constraint enforces ['conversation','manual','system','consolidation','episode']); tags=['learning','migrated-from-openclaw']; origin_id=openclaw-learning-<hash-prefix-16>. Two-layer dedup: dedupeLearnings skips matches before insert; MemoryStore UNIQUE(origin_id) handles race/retry."
  - "SCOPE_TAGS map is v2.2-LOCKED with 5 P1 entries — user-extensible map deferred per SKILL-F1 (REQUIREMENTS.md). Unknown skills default to fleet (max-permissive)."
  - "CLI exit code 1 when ANY of: secret-scan refusal, copy-failed bucket populated, missing-from-catalog verification. Scope-refused on its own does NOT flip exit 1 (it's an operator decision — use --force-scope to override)."

patterns-established:
  - "SKILL.md frontmatter normalization pattern: detect YAML block at start with `/^---\\n(?:[\\s\\S]*?\\n)?---/` (permits empty-body frontmatter); prepend minimal `name:` + `description:` when absent."
  - "Per-entity hash-witness pattern with selective transform-aware skipping — the general workspace-copier pattern extended to handle callers that legitimately rewrite one file post-copy."
  - "Scope-tag registry as canonical truth — single source consumed by both the verifier (emits scope-refused status) and any future marketplace installer (reuse in Phase 88)."
  - "Origin-id hard idempotency stacked on tag+content soft dedup — belt-and-suspenders for migration imports that survive partial-write crashes."

requirements-completed: [SKILL-03, SKILL-04, SKILL-08]

# Metrics
duration: ~17min
completed: 2026-04-21
---

# Phase 84 Plan 02: Skills Transformer + Linker + Idempotent Apply Summary

**Shipped the v2.2 skills migration apply path — `clawcode migrate openclaw skills apply` now copies 4 of 5 P1 skills (finmentum-crm still held at Plan 01 secret-scan gate), normalizes tuya-ac's frontmatter, preserves the other four byte-for-byte, imports self-improving-agent `.learnings/*.md` into MemoryStore with origin_id dedup, and runs a per-agent linker verification with scope-tag enforcement — all zero new npm deps.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-04-21T18:45:10Z
- **Completed:** 2026-04-21T19:02:05Z
- **Tasks:** 2/2 (both TDD RED+GREEN)
- **Files created:** 11 (5 modules + 5 test files + deferred-items.md)
- **Files modified:** 3 (migrate-skills.ts, migrate-skills.test.ts, memory/store.ts)

## Accomplishments

- **Skills transformer (SKILL-03):** `normalizeSkillFrontmatter` prepends `---\\nname:\\ndescription:\\n---\\n\\n` to tuya-ac only; byte-preserves frontend-design / new-reel / self-improving-agent frontmatter verbatim. Idempotent via `hasFrontmatter` precheck. 9 tests pass.
- **Skills copier:** `copySkillDirectory` with `defaultSkillsFilter` (drops `.git/`, `node_modules/`, `__pycache__/`, `*.pyc`/`*.pyo`, `.DS_Store`, `SKILL.md.{backup,pre,pre-fix,pre-restore}-*` editor snapshots), `verbatimSymlinks` cp, post-copy sha256 witness with selective-transform-aware SKILL.md skip, deterministic `targetHash`. 6 tests pass.
- **Scope tags (SKILL-08):** `SCOPE_TAGS` map + `scopeForAgent` + `canLinkSkillToAgent({force?})`. Finmentum skills refuse non-fin-* agents. Personal skill (tuya-ac) refuses non-clawdy/jas agents. Unknown skills default to fleet. 10 tests pass.
- **Linker verifier (SKILL-04):** `verifySkillLinkages` returns per-(agent, skill) status of linked / missing-from-catalog / scope-refused / not-assigned. Pure function, no fs I/O, does NOT create symlinks. 6 tests pass.
- **Learnings dedup:** `readLearningsDir` + `dedupeLearnings` partition into toImport/skipped; uses `MemoryStore.findByTagAndContent("learning", trimmedContent)` + `origin_id="openclaw-learning-<hash>"` for two-layer idempotency. 5 tests pass (including real self-improving-agent/.learnings/ readback).
- **CLI apply path wired end-to-end:** 4 P1 skills migrated, learnings imported (3 entries), finmentum-crm blocked at secret-scan (hard gate preserved per Plan 01), linker verification emitted, idempotent re-run produces zero new writes + zero duplicate learnings. 17 CLI tests pass (11 from Plan 01 + 6 new).
- **55 tests passing total** across 6 test files (9 transformer + 6 copier + 10 scope-tags + 6 linker-verifier + 5 learnings-dedup + 17 CLI + 2 bonus grep). Zero type errors in Plan 02 files. Zero new npm deps.

## Task Commits

1. **Task 1 RED: transformer + copier + scope-tags tests** — `fc8d2c8` (test)
2. **Task 1 GREEN: implement three pure modules** — `50e5e83` (feat)
3. **Task 2 RED: linker-verifier + learnings-dedup + apply-path tests** — `cc02b48` (test)
4. **Task 2 GREEN: wire apply path end-to-end** — `c930d81` (feat)

Task 1 shipped three pure-function modules with 25 unit tests. Task 2 added the verifier + dedup modules, extended `MemoryStore` with the narrow `findByTagAndContent` lookup, and rewrote the migrate-skills CLI action body to include the copy + transform + learnings import + per-agent verification pipeline. Commits are tagged with `(84-02)` scope for ledger traceability.

## Transformer Outcomes

| Skill | Frontmatter Action | Description Source |
| --- | --- | --- |
| tuya-ac | **Prepended** — `name:` + `description:` added | first body line post-heading strip (`tuya-ac — Tuya Smart AC Control`) |
| frontend-design | Preserved byte-for-byte | existing `description:` in frontmatter |
| new-reel | Preserved byte-for-byte | existing `description:` in frontmatter (`${CLAUDE_SKILL_DIR}` substitutions intact) |
| self-improving-agent | Preserved byte-for-byte | existing `description:` in frontmatter |

Post-apply sanity check via `scanSkillsDirectory(~/.clawcode/skills)`:
- tuya-ac → `description="tuya-ac — Tuya Smart AC Control"`, `version=null`
- frontend-design → `description="Create distinctive, production-grade frontend interfaces..."`, `version=null`
- new-reel → `description="Create a new Instagram Reel video through conversational workflow..."`, `version=null`
- self-improving-agent → `description="Captures learnings, errors, and corrections to enable continuous improvement..."`, `version=null`

## Copier Hash-Witness Outcomes

Each P1 skill was copied with a post-copy sha256 witness over every regular file in the target. All 4 clean P1 skills passed:

| Skill | target_hash (prefix) | Files Copied | Filter Matches |
| --- | --- | --- | --- |
| frontend-design | `0e9b86a48eaa…` | ~15 | none (clean content-only skill) |
| new-reel | `f1e397a24443…` | SKILL.md + scripts/* + reference/* | **3 backup snapshots dropped** (SKILL.md.backup-*, SKILL.md.pre-fix-*, SKILL.md.pre-restore-*) |
| self-improving-agent | `a988f4f3c9ef…` | SKILL.md + hooks/* + scripts/* + references/* + assets/* + .learnings/* | **.git/ dropped** (VCS metadata) |
| tuya-ac | `0d59650270e0…` | SKILL.md (transformed) + scripts/ | none |

Hash witness selectively skips SKILL.md when the transform modified it (expected mismatch after `normalizeSkillFrontmatter` prepend for tuya-ac); all other files byte-match their sources.

## Per-Agent Linker Verification

Run against current `clawcode.yaml` (9 agents, most with no P1 skills declared in their `skills:` list):

```
=== linker verification ===
  (none)  frontend-design        not-assigned — skill migrated but no agent has it in their skills: list
  (none)  new-reel               not-assigned — skill migrated but no agent has it in their skills: list
  (none)  self-improving-agent   not-assigned — skill migrated but no agent has it in their skills: list
  (none)  tuya-ac                not-assigned — skill migrated but no agent has it in their skills: list
```

All 4 migrated skills currently report `not-assigned` — operators need to add the skill names to their agent `skills:` lists in a follow-up quick or in Plan 03. No agents currently have any of the P1 skills in their `skills:` list, so there are no assignments to verify.

Synthetic test fixtures in `migrate-skills.test.ts` tests 14-15 exercise the scope-refused path (tuya-ac on fin-research → scope-refused) and the --force-scope override (same scenario + force=true → linked). Real-world assignment wiring is deferred to Plan 03 / operator action.

## Scope-Tag Enforcement Samples

From `src/migration/__tests__/skills-scope-tags.test.ts` (all pass):

| Skill | Agent | Force | Result | Rationale |
| --- | --- | --- | --- | --- |
| finmentum-crm | fin-acquisition | no | `true` (allow) | finmentum skill + finmentum agent |
| finmentum-crm | clawdy | no | `false` (refuse) | finmentum skill + personal agent |
| finmentum-crm | clawdy | **yes** | `true` (allow) | force flag bypasses scope check |
| frontend-design | clawdy | no | `true` (allow) | fleet skill → any agent |
| tuya-ac | fin-acquisition | no | `false` (refuse) | personal skill + finmentum agent |
| tuya-ac | clawdy | no | `true` (allow) | personal skill + personal agent |
| new-reel | general | no | `false` (refuse) | finmentum skill + fleet agent |
| random-unknown | anyone | no | `true` (allow) | unknown defaults to fleet |

Smoke-tested end-to-end: synthetic clawcode.yaml with `fin-research` + `tuya-ac` (personal on finmentum) emits `fin-research tuya-ac scope-refused` under default run; with `--force-scope` the same pair emits `fin-research tuya-ac linked`.

## self-improving-agent Learnings Import

From live smoke test against `~/.openclaw/skills/self-improving-agent/.learnings/`:

| Phase | Count | Notes |
| --- | --- | --- |
| Before (first apply) | 3 .md files on disk | ERRORS.md, FEATURE_REQUESTS.md, LEARNINGS.md |
| Imported to MemoryStore | 3 | tags=["learning","migrated-from-openclaw"], origin_id=openclaw-learning-<hash-16> |
| Deduplicated at write | 0 | fresh MemoryStore; no pre-existing learning-tagged entries |
| Second apply (idempotency) | 3 on disk | 0 re-imported (all 3 match MemoryStore via origin_id UNIQUE partial index + tag+content dedup) |

The MemoryStore UNIQUE(origin_id) partial index (Phase 80 MEM-02) is the hard idempotency gate — even if `dedupeLearnings` missed a match (it won't — the tag+content match is exact), the INSERT OR IGNORE at the SQLite layer guarantees zero duplicates.

## Handoff to Plan 03

Plan 03 (migration report writer) consumes:

- **Ledger rows** at `.planning/migration/v2.2-skills-ledger.jsonl` — per-skill rows with `action: "apply"` | `"verify"`, `status`, `source_hash`, `target_hash`, `step`, `outcome`, `notes`. Use `readSkillRows` + `latestStatusBySkill` to derive the final state table.
- **Linker verification array shape** — `LinkVerification[]` per skill with `agent`, `status` ∈ {`linked`, `missing-from-catalog`, `scope-refused`, `not-assigned`}, `reason?`. The ledger persists one `verify` row per verification via `appendSkillRow`; Plan 03 re-derives from the ledger (no in-memory handoff needed).
- **CLI exit code** — non-zero iff there were secret-scan refusals, copy-failed mismatches, or missing-from-catalog verifications. Plan 03's report generator classifies a skill as "ready" when the ledger's latest row is `status: "migrated"` AND no `missing-from-catalog` verify row exists for it.
- **Migration report content** — transformation table (this summary lines 137-152), copier hash table (lines 156-171), scope enforcement matrix (lines 199-213), learnings import stats (lines 215-233). Plan 03 can crib directly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Empty-body frontmatter regex**
- **Found during:** Task 1 GREEN (test 9 — `hasFrontmatter("---\\n---\\n")`)
- **Issue:** `/^---\\n[\\s\\S]*?\\n---/` required at least one `\\n` between the opening and closing `---` markers. An empty-body frontmatter block `---\\n---\\n` failed the regex because after consuming `---\\n`, there's no intervening content to match `[\\s\\S]*?\\n---`.
- **Fix:** Made the middle group optional: `/^---\\n(?:[\\s\\S]*?\\n)?---/`.
- **Files modified:** `src/migration/skills-transformer.ts`.
- **Commit:** `50e5e83`.

**2. [Rule 1 — Bug] Symlink test expected a path-filter would NOT remove loopback symlinks**
- **Found during:** Task 1 GREEN (copier test f)
- **Issue:** The `defaultSkillsFilter` correctly removes self-referential symlinks (`loopback -> .` resolves to the directory that CONTAINS the link — ancestor self-symlink pattern), which is the defensive behavior we want (prevents recursion). The test was written expecting the symlink to survive the filter.
- **Fix:** Revised test to use a non-recursive file-to-file symlink (`alias.md -> real.md`) which correctly survives `defaultSkillsFilter` and is preserved verbatim by `verbatimSymlinks` in `fs.cp`.
- **Files modified:** `src/migration/__tests__/skills-copier.test.ts`.
- **Commit:** `50e5e83`.

**3. [Rule 1 — Bug] MemoryStore `source` CHECK constraint violation**
- **Found during:** Task 2 GREEN (skills-learnings-dedup test d + migrate-skills.test test 16)
- **Issue:** Initial apply path + tests used `source: "migration"` on `MemoryStore.insert`, which failed the CHECK constraint `source IN ('conversation', 'manual', 'system', 'consolidation', 'episode')`. The subsequent origin_id-collision code path then fired because INSERT OR IGNORE suppressed the constraint violation.
- **Fix:** Changed migration learnings imports to `source: "manual"` (the most natural category for a manual curation act).
- **Files modified:** `src/cli/commands/migrate-skills.ts`, `src/migration/__tests__/skills-learnings-dedup.test.ts`.
- **Commit:** `c930d81`.

**4. [Rule 2 — Missing functionality] Synthetic test YAML missing required `version: 1`**
- **Found during:** Task 2 GREEN (tests 14-15 — linker verification)
- **Issue:** Test YAML didn't include the required `version: 1` top-level field that `configSchema` demands. `loadConfig` threw a validation error which was caught silently by the CLI's `try/catch` around the verification block; tests then failed because no `=== linker verification ===` section emitted.
- **Fix:** Added `version: 1` to both synthetic test YAML builders.
- **Files modified:** `src/cli/commands/__tests__/migrate-skills.test.ts`.
- **Commit:** `c930d81`.

**5. [Rule 2 — Missing functionality] `skipped (copy-failed)` bucket was not defined**
- **Found during:** Task 2 implementation — Plan said the apply path should emit `skipped (copy-failed)` when the hash witness refuses but the Plan 01 SECTION_ORDER + bucket enum didn't include it.
- **Fix:** Added the new bucket to `Bucket` type, `SECTION_ORDER`, `bucketToStatus` (returns `refused`), `bucketToOutcome` (returns `refuse`), `formatEntryLine` (red color for fail bucket).
- **Files modified:** `src/cli/commands/migrate-skills.ts`.
- **Commit:** `c930d81`.

None of the above required architectural changes. All fit within the plan's shape — the first three are bug fixes to the test fixtures / regex / store contract, and the last two are missing scaffolding the plan implicitly required.

## Deferred Issues

Pre-existing test failures observed during phase-level regression check (8 failures across 3 unrelated test files: `config-mapper.test.ts`, `memory-translator.test.ts`, `verifier.test.ts`). Confirmed via `git stash` that these existed before Plan 02; logged to `.planning/phases/84-skills-library-migration/deferred-items.md`. Out of scope per Rule 3 boundary (auto-fix only issues the current task caused).

## Self-Check: PASSED

Verified files exist:
- FOUND: src/migration/skills-transformer.ts
- FOUND: src/migration/skills-scope-tags.ts
- FOUND: src/migration/skills-copier.ts
- FOUND: src/migration/skills-linker-verifier.ts
- FOUND: src/migration/skills-learnings-dedup.ts
- FOUND: src/migration/__tests__/skills-transformer.test.ts
- FOUND: src/migration/__tests__/skills-copier.test.ts
- FOUND: src/migration/__tests__/skills-scope-tags.test.ts
- FOUND: src/migration/__tests__/skills-linker-verifier.test.ts
- FOUND: src/migration/__tests__/skills-learnings-dedup.test.ts
- FOUND: .planning/phases/84-skills-library-migration/deferred-items.md

Verified commits exist in git log:
- FOUND: fc8d2c8 (Task 1 RED)
- FOUND: 50e5e83 (Task 1 GREEN)
- FOUND: cc02b48 (Task 2 RED)
- FOUND: c930d81 (Task 2 GREEN)

Verified phase-level invariants:
- 55/55 Plan 02 tests pass across 6 test files
- `pnpm tsc --noEmit` clean for all 5 new modules + 3 modified files
- `pnpm tsx src/cli/index.ts migrate openclaw skills --no-dry-run ...` end-to-end migration: 4 P1 skills copied, tuya-ac frontmatter normalized, finmentum-crm refused (hard gate), learnings imported (3/0), verification emitted, idempotent re-run moves all 4 skills to `skipped (idempotent)`.
- Zero new npm deps — verified by `package.json` unchanged.
- Ledger at `.planning/migration/v2.2-skills-ledger.jsonl` — append-only; apply rows have `status=migrated` + `target_hash` populated for all 4 clean P1 skills.
