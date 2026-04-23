---
phase: 88-skills-marketplace
plan: 01
subsystem: marketplace
tags: [skills, marketplace, catalog, install, yaml-writer, scope-gate, secret-scan, idempotency]

# Dependency graph
requires:
  - phase: 84-skills-library-migration
    provides: discoverOpenclawSkills + scanSkillSecrets + copySkillDirectory + normalizeSkillFrontmatter + SCOPE_TAGS + canLinkSkillToAgent + scopeForAgent + SKILL_DEPRECATION_REASONS + appendSkillRow/readSkillRows — every Phase 88 primitive reuses these verbatim (no duplication)
  - phase: 86-dual-discord-model-picker-core
    provides: updateAgentModel atomic YAML pattern (parseDocument → YAMLMap.set → tmp+rename → sha256) — mirrored verbatim for updateAgentSkills with YAMLSeq mutation
  - phase: 84-skills-library-migration/84-02
    provides: SCOPE_TAGS v2.2-locked P1 skill registry + force-scope override semantics — install scope gate reuses canLinkSkillToAgent
provides:
  - "MarketplaceEntry shape + loadMarketplaceCatalog — unions local ClawCode skills with configured legacy sources into a deduped, alphabetically-sorted, frozen readonly array. Local wins on name collision; deprecated/unknown excluded."
  - "defaults.marketplaceSources optional schema field + resolveMarketplaceSources loader helper — expands ~/... paths via existing expandHome pattern; returns [] when omitted (v2.1/v2.2 configs parse unchanged)."
  - "ResolvedMarketplaceSources exported type (src/shared/types.ts) — pass-through for daemon→catalog loader plumbing."
  - "updateAgentSkills (src/migration/yaml-writer.ts) — atomic append/remove of a skill name on agents[*].skills; comment-preserving, idempotent, 4 typed outcomes (updated/no-op/not-found/file-not-found). Mirrors updateAgentModel atomic pipeline."
  - "installSingleSkill (src/marketplace/install-single-skill.ts) — wraps Phase 84 pipeline (secret-scan → copier+transformer → updateAgentSkills → ledger) end-to-end for ONE skill. Returns SkillInstallOutcome discriminated union with 8 distinct kinds. Non-rollback on YAML persist failure."
  - "computeSkillContentHash (src/migration/skills-discovery.ts) — promoted from private computeSkillHash; exported for the installer's ledger idempotency gate."
  - "SkillInstallOutcome discriminated union — 8 typed kinds for zero-silent-skip Discord rendering (MKT-05 precedent for Plan 02)."
affects: [88-02 slash commands (loadMarketplaceCatalog + installSingleSkill + updateAgentSkills become the three pure-function handoff points; Plan 02 is a thin Discord UI adapter)]

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps
  patterns:
    - "Discriminated-outcome install: every refusal path returns a distinct .kind variant so the Discord renderer never collapses two failures into one ephemeral reply (MKT-05)."
    - "Atomic single-seq YAML mutation via parseDocument AST — YAMLSeq.add + splice, initializes missing seq, mirrors the Phase 86 single-scalar mutation (YAMLMap.set) but for the list-valued sibling."
    - "Local-wins dedup via Map-keyed-by-name insertion order — canonical marketplace pattern for 'curated ClawCode catalog + legacy fallback' unions."
    - "Non-rollback on YAML persist failure after irreversible copy — the copied skill dir is the consequential action; persistence is next-boot durability. Mirrors Phase 86 Plan 02 MODEL-04."
    - "Scope-gate + ledger-refused-row parity — marketplace scope refusal writes the same 'apply / refused / refuse' ledger row as the Phase 84 CLI, so the migration report reader sees one unified audit trail."
    - "Best-effort ledger append (log-and-swallow) — installer outcome is authoritative; a temporarily-unwritable ledger never fails an install that already succeeded on disk."

key-files:
  created:
    - src/marketplace/catalog.ts
    - src/marketplace/install-single-skill.ts
    - src/marketplace/__tests__/catalog.test.ts
    - src/marketplace/__tests__/install-single-skill.test.ts
  modified:
    - src/config/schema.ts                 # defaults.marketplaceSources + MarketplaceSourceConfig export
    - src/config/loader.ts                 # resolveMarketplaceSources helper + ResolvedMarketplaceSources import
    - src/shared/types.ts                  # ResolvedMarketplaceSource + ResolvedMarketplaceSources exports
    - src/migration/yaml-writer.ts         # updateAgentSkills + UpdateAgentSkillsArgs/Result
    - src/migration/skills-discovery.ts    # computeSkillHash → exported computeSkillContentHash
    - src/migration/__tests__/yaml-writer.test.ts  # U1-U8 describe block for updateAgentSkills

key-decisions:
  - "Catalog is read-only + HASH-FREE — source hashes are computed at install time (one skill per install) rather than at browse time (N skills per browse). Keeps /clawcode-skills-browse responsive; hash work stays on the write path."
  - "Deprecated skills are NEVER advertised in the marketplace (classification=='deprecate' filtered at catalog load) AND the installer's step-2 gate re-checks via SKILL_DEPRECATION_REASONS for defense-in-depth. A deprecated skill cannot reach install even if an operator hand-crafted a catalog entry."
  - "Unknown-classification legacy skills are ALSO skipped from the catalog in v2.2. Only pre-curated p1/p2 names surface. SKILL-F1 (user-extensible scope tags) is the extension point for future milestones."
  - "fs-guard is NOT installed inside installSingleSkill — the daemon runtime context writes ONLY to skillsTargetDir + clawcodeYamlPath (neither under ~/.openclaw/). Installing the guard mid-daemon would risk cascading into unrelated in-flight tasks; keeping it CLI-scoped (Phase 84 migrate-skills) is the right layering."
  - "updateAgentSkills initializes a MISSING skills: seq to an empty YAMLSeq before the mutation, rather than returning not-found. Newly-created agents via writeClawcodeYaml always emit an explicit skills: [] — but a hand-edited YAML might omit the key entirely; defensive init keeps the install path robust."
  - "SkillInstallOutcome is deliberately verbose (8 kinds) — Plan 02's Discord ephemeral replies branch on kind to explain exactly why an install refused. Collapsing kinds would force the UI to compute its own reason strings + re-lose the scope vs secret-scan vs deprecated vs copy distinction."
  - "Local catalog entries have source='local' and NO classification field (local catalog is curated by the operator, so there's no p1/p2 verdict to track). Legacy entries always carry classification='p1' or 'p2'. Plan 02 can branch on source for rendering."
  - "Description truncation capped at 100 chars to match Discord StringSelectMenuOption description limit (DISCORD_SELECT_CAP precedent from Phase 86 Plan 03) — avoids double-truncation inside the UI layer."
  - "Ledger writes on EVERY refusal outcome (scope, secret-scan, copy-fail) — NOT on rejected-deprecated + not-in-catalog (those are pre-gate refusals; writing a row would confuse the idempotency map with a skill we never attempted). Matches Phase 84 CLI bucket→status→ledger mapping."

patterns-established:
  - "Pre-extracted interfaces block in PLAN.md (shipped by planner) dramatically cut TDD RED-phase scavenger-hunt time — the executor wrote tests against contracts already lifted out of 9 source files without opening any of them. Re-apply for every future TDD plan."
  - "Three-function Plan 02 handoff (loadMarketplaceCatalog, installSingleSkill, updateAgentSkills) — all pure / all DI-driven / all testable without a running daemon. Plan 02's IPC handler becomes a 10-line thin adapter that never touches Discord primitives."
  - "Typed-outcome install pattern: for any end-user-facing operation that can refuse for ≥3 reasons, return a discriminated union rather than throwing. Keeps the UI layer's error rendering a pattern-match, not a string-contains hunt."

requirements-completed: [MKT-02, MKT-03, MKT-04]

# Metrics
duration: 11min 27s
completed: 2026-04-21
---

# Phase 88 Plan 01: Skills Marketplace Foundation Summary

**Shipped the three pure-function primitives Plan 02 needs to bolt on a Discord slash command: `loadMarketplaceCatalog` unions local skills with configured legacy sources into a deduped read-only catalog; `installSingleSkill` wraps the Phase 84 pipeline (scan → copy → YAML persist → ledger) against one skill with 8 typed refusal outcomes; `updateAgentSkills` mirrors Phase 86's atomic YAML writer contract for appending/removing skills. Zero new npm deps.**

## Performance

- **Duration:** 11 min 27 s
- **Started:** 2026-04-21T22:43:13Z
- **Completed:** 2026-04-21T22:54:40Z
- **Tasks:** 2 (both TDD RED → GREEN)
- **Files created:** 4
- **Files modified:** 6

## Accomplishments

- **Catalog foundation (MKT-02):** `loadMarketplaceCatalog` unions `scanSkillsDirectory(localSkillsPath)` (ClawCode local skills) with `discoverOpenclawSkills(source.path)` (legacy sources per configured `defaults.marketplaceSources`). Filters to p1/p2 only (deprecated + unknown excluded). Local wins on name collision. Alphabetical sort + frozen array for deterministic Discord menu ordering. Descriptions truncated to 100 chars (Discord StringSelectMenuOption cap). 10 tests green (C1-C9 + C8b).
- **Single-skill install (MKT-03):** `installSingleSkill` runs the Phase 84 pipeline end-to-end against one skill, in the exact order catalog-lookup → deprecated-gate → scope-gate → ledger-idempotency → secret-scan → copy+transform → YAML persist → ledger success row. Returns `SkillInstallOutcome` with 8 distinct `.kind` variants: `installed`, `installed-persist-failed`, `already-installed`, `blocked-secret-scan`, `rejected-scope`, `rejected-deprecated`, `not-in-catalog`, `copy-failed`. 10 tests green (I1-I10).
- **Atomic YAML writer (MKT-04):** `updateAgentSkills` mirrors the Phase 86 `updateAgentModel` atomic template — `parseDocument → find-by-name → YAMLSeq.add/splice → doc.toString({lineWidth:0}) → tmp+rename → sha256 witness`. 4 typed outcomes (`updated`/`no-op`/`not-found`/`file-not-found`); comment-preserving; supports both `op="add"` and `op="remove"`; initializes missing `skills:` seq defensively. 8 tests green (U1-U8).
- **Ledger idempotency + computeSkillContentHash:** Promoted the previously-private `computeSkillHash` to an exported `computeSkillContentHash` so the installer can derive the current source hash for the idempotency gate. When the latest "migrated apply" ledger row for a skill matches the current hash, `installSingleSkill` returns `already-installed` without re-copying.
- **Secret-scan HARD GATE preserved:** The `scanSkillSecrets` pre-flight is installed at step 5 of the install pipeline. The `finmentum-crm` test fixture (MySQL-style `password: Sup3rSecret!M@mA123`) refuses at step 5 with `kind: "blocked-secret-scan"` + offender location — never reaches the copier. Matches the Phase 84 CLI hard-gate semantics verbatim.
- **Scope-gate (SKILL-08):** Installer step 3 calls `canLinkSkillToAgent(skill, agent, {force})`. When it returns false, the installer writes a `refused` ledger row (`notes: "scope: <skill> vs <agent>"`) and returns `kind: "rejected-scope"` with both scopes. `force=true` bypasses.
- **Non-rollback on persist failure:** When `updateAgentSkills` throws (e.g. EACCES on rename), `installSingleSkill` does NOT re-copy or delete the already-copied skill. Returns `kind: "installed-persist-failed"` with `persist_error` surfaced for operator reconciliation. Mirrors the Phase 86 Plan 02 MODEL-04 contract.
- **Ledger writes on every scoped outcome:** Scope-refused, secret-scan-refused, copy-failed, and installed rows all land in the ledger for audit parity with the Phase 84 CLI pipeline. Pre-gate refusals (not-in-catalog, rejected-deprecated) do NOT write — writing a ledger row for a skill the system never attempted to install would confuse the `latestStatusBySkill` idempotency map.
- **Zero new TS errors.** 38 pre / 38 post (identical count; none in touched files).
- **Zero new npm deps.** Entire plan runs on existing YAML package, crypto, node:fs, and Phase 84 modules.
- **190 plan-scope tests green** across 4 test files (10 catalog + 10 install + 35 yaml-writer + 135 config schema including pre-existing). 8 pre-existing migration test failures (config-mapper / memory-translator / verifier) confirmed pre-existing via `git stash` comparison — deferred per scope-boundary Rule 3.

## Task Commits

1. **Task 1 RED: failing tests for loadMarketplaceCatalog (C1-C9)** — `085de9d` (test)
2. **Task 1 GREEN: loadMarketplaceCatalog + marketplaceSources schema** — `c9330e5` (feat)
3. **Task 2 RED: failing tests for updateAgentSkills + installSingleSkill** — `c269f28` (test)
4. **Task 2 GREEN: installSingleSkill + updateAgentSkills atomic writer** — `31fcab9` (feat)

## The Three Handoff Functions for Plan 02

### 1. `loadMarketplaceCatalog(opts): Promise<readonly MarketplaceEntry[]>`

```typescript
import { loadMarketplaceCatalog, type MarketplaceEntry } from
  "./marketplace/catalog.js";
import { resolveMarketplaceSources } from "./config/loader.js";

// daemon wiring (Plan 02 IPC handler)
const sources = resolveMarketplaceSources(config);
const catalog = await loadMarketplaceCatalog({
  localSkillsPath: config.defaults.skillsPath,  // already expandHome'd
  sources,
  log,
});
// catalog: readonly MarketplaceEntry[]
// Each entry: { name, description (<=100 chars), category: "finmentum"|"personal"|"fleet",
//                source: "local" | {path, label?}, skillDir, classification? }
```

Plan 02's `/clawcode-skills-browse` handler builds a `StringSelectMenuBuilder` directly from this array. `description` is already truncated to the Discord cap. Sorting is deterministic.

### 2. `installSingleSkill(opts): Promise<SkillInstallOutcome>`

```typescript
import { installSingleSkill, type SkillInstallOutcome } from
  "./marketplace/install-single-skill.js";
import { DEFAULT_SKILLS_LEDGER_PATH } from "./migration/skills-ledger.js";

const result = await installSingleSkill({
  skillName: interaction.values[0],  // from select menu
  agentName: boundAgent.name,
  catalog,                            // from function #1 above
  skillsTargetDir: config.defaults.skillsPath,
  clawcodeYamlPath,
  ledgerPath: DEFAULT_SKILLS_LEDGER_PATH,
  force: interaction.user.has(ADMIN_ROLE),  // MKT-05 optional
});

switch (result.kind) {
  case "installed":
    await interaction.editReply(`✅ Installed ${result.skill}`);
    break;
  case "installed-persist-failed":
    await interaction.editReply(`⚠️  Installed but YAML persist failed: ${result.persist_error}`);
    break;
  case "already-installed":
    await interaction.editReply(`ℹ️  Already installed (${result.reason})`);
    break;
  case "blocked-secret-scan":
    await interaction.editReply(`⛔ Secret scan refused: ${result.offender}`);
    break;
  case "rejected-scope":
    await interaction.editReply(
      `⛔ Scope: ${result.skillScope} skill on ${result.agentScope} agent`,
    );
    break;
  case "rejected-deprecated":
    await interaction.editReply(`⛔ Deprecated: ${result.reason}`);
    break;
  case "not-in-catalog":
    await interaction.editReply(`⛔ Unknown skill: ${result.skill}`);
    break;
  case "copy-failed":
    await interaction.editReply(`⛔ Copy failed: ${result.reason}`);
    break;
}
```

The discriminated union is exhaustive — TypeScript will flag any missing case in Plan 02's switch.

### 3. `updateAgentSkills(args): Promise<UpdateAgentSkillsResult>`

```typescript
import { updateAgentSkills } from "./migration/yaml-writer.js";

// Called from: installSingleSkill (add) + Plan 02 /clawcode-skills remove action
const result = await updateAgentSkills({
  existingConfigPath: clawcodeYamlPath,
  agentName: "clawdy",
  skillName: "frontend-design",
  op: "add" | "remove",
});

// 4 outcomes: updated / no-op / not-found / file-not-found (throws on rename EACCES)
```

Plan 02's `/clawcode-skills` remove flow calls this directly with `op: "remove"` — no additional pipeline needed for removal (nothing to secret-scan + nothing to copy; just pop the skill from the agent's list).

### Handoff config surface: `defaults.marketplaceSources`

Operators add legacy sources to `clawcode.yaml`:

```yaml
defaults:
  marketplaceSources:
    - path: ~/.openclaw/skills
      label: OpenClaw legacy
    - path: /opt/fleet/skills
```

Daemon at boot calls `resolveMarketplaceSources(config)` to expand the `~/...` paths. v2.1/v2.2 configs that omit the field produce `[]` (local-only marketplace).

## Install Pipeline — Call Order (pinned by I1 test)

```
1. Catalog lookup              (opts.catalog.find)
2. Deprecated gate             (SKILL_DEPRECATION_REASONS + classification check)
3. Scope gate                  (canLinkSkillToAgent)                     [may write refused ledger row]
4. Ledger idempotency gate     (computeSkillContentHash + readSkillRows) [returns already-installed]
5. Secret-scan HARD GATE       (scanSkillSecrets)                        [may write refused ledger row]
6. Copy + transform            (copySkillDirectory + normalizeSkillFrontmatter)  [may write refused ledger row]
7. YAML persist                (updateAgentSkills) — NON-ROLLBACK on throw
8. Ledger success row          (appendSkillRow status="migrated")
9. Return typed outcome
```

## Evidence — Refused Ledger Rows

Scope-refused (tuya-ac on fin-research):
```jsonl
{"ts":"2026-04-21T...","action":"apply","skill":"tuya-ac","status":"refused","source_hash":"scope-gate","step":"scope-check","outcome":"refuse","notes":"scope: personal vs finmentum"}
```

Secret-scan-refused (finmentum-crm with literal credentials):
```jsonl
{"ts":"2026-04-21T...","action":"apply","skill":"finmentum-crm","status":"refused","source_hash":"<current-hash>","step":"secret-scan","outcome":"refuse","notes":"high-entropy: .../SKILL.md:9"}
```

Success (frontend-design on clawdy):
```jsonl
{"ts":"2026-04-21T...","action":"apply","skill":"frontend-design","status":"migrated","source_hash":"...","target_hash":"...","step":"copy+persist","outcome":"allow","notes":"persisted=true"}
```

Persist-failed (copy succeeded, YAML write threw EACCES):
```jsonl
{"ts":"2026-04-21T...","action":"apply","skill":"frontend-design","status":"migrated","source_hash":"...","target_hash":"...","step":"copy+persist","outcome":"allow","notes":"persisted=false; EACCES: simulated persist failure"}
```

The `persisted=false` signal lets the report writer flag stuck installs for operator reconciliation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Local SKILL.md description format in C4 test fixture**
- **Found during:** Task 1 GREEN (C4 test failure)
- **Issue:** My initial test fixture for local-wins dedup wrote SKILL.md with a heading line (`# frontend-design`) as the first body paragraph. The existing scanner.ts `extractDescription` returns the first non-blank body paragraph including headings, so `SkillEntry.description` came back as "# frontend-design" instead of the intended "LOCAL description wins" text. Mismatched against the assertion.
- **Fix:** Removed the heading line from the fixture so the description appears verbatim as the first body paragraph. Matches how real ClawCode SKILL.md files are structured (description in frontmatter + body starts with content, not a heading).
- **Files modified:** `src/marketplace/__tests__/catalog.test.ts` (fixture helper)
- **Commit:** `c9330e5`

**2. [Rule 1 — Bug] YAML flow-style vs block-style skills list in I1 assertion**
- **Found during:** Task 2 GREEN (I1 test failure)
- **Issue:** The test wrote `skills: []` into the fixture YAML, which the yaml package preserves as flow style. After `updateAgentSkills` added an element, the result was `skills: [ frontend-design ]` (flow) rather than `- frontend-design` (block). The assertion was format-specific.
- **Fix:** Changed assertion from a regex on the raw text to a parse + `toContain` on the structured array. Shape invariant is what matters; flow vs block is yaml's call.
- **Files modified:** `src/marketplace/__tests__/install-single-skill.test.ts`
- **Commit:** `31fcab9`

Neither required architectural changes. Both are test-fixture cleanups inside the TDD cycle.

### Scope-Guard Decisions (NOT defects)

- **fs-guard deliberately NOT installed in `installSingleSkill`.** The Phase 84 CLI installs the guard because it's invoked from an operator shell where a bug could mean `rm -rf ~/.openclaw/.git`. The marketplace installer runs inside the daemon where the only writes are to `skillsTargetDir` and `clawcodeYamlPath` — both outside `~/.openclaw/`. Installing the guard mid-daemon could cascade into unrelated in-flight daemon tasks whose writes would suddenly refuse. Documented as a key decision above.

## Deferred Issues

**Pre-existing test failures** (8 failures across `config-mapper.test.ts`, `memory-translator.test.ts`, `verifier.test.ts`):

```
src/migration/__tests__/config-mapper.test.ts  — 4 failures (mcpServers auto-injection assertions)
src/migration/__tests__/memory-translator.test.ts — 2 failures (static grep expectations drift)
src/migration/__tests__/verifier.test.ts — 2 failures (workspace-files-present: missing MEMORY.md fixture)
```

Confirmed pre-existing via `git stash --include-untracked && npx vitest run ... && git stash pop` — 8 failing before and after my changes. Logged in `.planning/phases/84-skills-library-migration/deferred-items.md` by Phase 84 Plan 02. Out of scope per Rule 3 boundary (auto-fix only issues the current task caused).

## Self-Check: PASSED

Verified files exist:
- FOUND: src/marketplace/catalog.ts
- FOUND: src/marketplace/install-single-skill.ts
- FOUND: src/marketplace/__tests__/catalog.test.ts
- FOUND: src/marketplace/__tests__/install-single-skill.test.ts
- FOUND: .planning/phases/88-skills-marketplace/88-01-SUMMARY.md (this file)

Verified modifications landed:
- FOUND: `marketplaceSources:` in `src/config/schema.ts` (defaultsSchema)
- FOUND: `MarketplaceSourceConfig` export in `src/config/schema.ts`
- FOUND: `resolveMarketplaceSources` export in `src/config/loader.ts`
- FOUND: `ResolvedMarketplaceSources` export in `src/shared/types.ts`
- FOUND: `updateAgentSkills` in `src/migration/yaml-writer.ts`
- FOUND: `computeSkillContentHash` exported in `src/migration/skills-discovery.ts`

Verified commits exist in git log:
- FOUND: 085de9d (Task 1 RED)
- FOUND: c9330e5 (Task 1 GREEN)
- FOUND: c269f28 (Task 2 RED)
- FOUND: 31fcab9 (Task 2 GREEN)

Verified plan-scope invariants:
- 190/190 Plan 01 tests pass across 4 test files (10 catalog + 10 install-single-skill + 35 yaml-writer + 135 schema)
- 38 pre-existing TS errors, 38 post-Plan-01 TS errors (identical count)
- Zero new TS errors in any touched file (`src/marketplace/`, `src/config/schema.ts`, `src/config/loader.ts`, `src/shared/types.ts`, `src/migration/yaml-writer.ts`, `src/migration/skills-discovery.ts`)
- Zero new npm deps — `package.json` unchanged
- Secret-scan grep proof: `rg 'Sup3rSecret' src/` matches only `install-single-skill.test.ts` (test fixture), no production file
- Three pure-function handoff contracts published for Plan 02 (no daemon coupling required)

---
*Phase: 88-skills-marketplace*
*Completed: 2026-04-21*
