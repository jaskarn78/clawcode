---
phase: 84-skills-library-migration
plan: 01
subsystem: migration
tags: [skills, migration, secret-scan, fs-guard, ledger, cli]

# Dependency graph
requires:
  - phase: 76-migrate-openclaw-read-side
    provides: v2.1 ledger.ts (append-only JSONL, zod schema, mkdir-on-first-write)
  - phase: 77-migrate-openclaw-apply-preflight
    provides: fs-guard (installFsGuard/uninstallFsGuard), scanSecrets classifier constants
  - phase: 79-migrate-openclaw-workspace-copy
    provides: fs-guard runtime patch pattern (CJS-binding caveat)
provides:
  - Discovery layer — `discoverOpenclawSkills(sourceRoot)` walks `~/.openclaw/skills/` with 12-entry locked classification map + deterministic sha256 sourceHash per skill
  - Secret-scan gate — `scanSkillSecrets(skillDir)` three-phase classifier (sk-prefix / whitelist / high-entropy with credential-context gate) with tighter thresholds than v2.1 (len>=12, bits>=3.8)
  - Skills ledger — `.planning/migration/v2.2-skills-ledger.jsonl` append-only JSONL with per-skill rows, zod-validated; mirrors v2.1 ledger shape with status enum extended to include `skipped`/`refused`
  - CLI scaffold — `clawcode migrate openclaw skills [--dry-run|--no-dry-run] [--source-dir <path>] [--ledger-path <path>] [--include-unknown]` emits deterministic 5-section report
  - fs-guard-enforced source read-only — action body wrapped in try{installFsGuard; ...}finally{uninstallFsGuard} so any stray write under `~/.openclaw/skills/` throws ReadOnlySourceError
affects: [84-02 skills transformer + linker, 84-03 report writer, 88 skills marketplace]

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps (constraint honored)
  patterns:
    - "Per-skill secret classifier with credential-context gate (high-entropy + label co-occurrence required)"
    - "Separate v2.2 ledger file alongside v2.1 ledger (byte-stable isolation)"
    - "Deterministic content-hash for idempotency (sha256 of sorted relpath\\0sha256(content))"
    - "Nested Commander subcommand registered from inside the parent's registerer (single ESM binding)"

key-files:
  created:
    - src/migration/skills-ledger.ts
    - src/migration/skills-secret-scan.ts
    - src/migration/skills-discovery.ts
    - src/cli/commands/migrate-skills.ts
    - src/migration/__tests__/skills-ledger.test.ts
    - src/migration/__tests__/skills-secret-scan.test.ts
    - src/cli/commands/__tests__/migrate-skills.test.ts
  modified:
    - src/cli/commands/migrate-openclaw.ts  # registered migrate-skills subcommand

key-decisions:
  - "Skills ledger is a SEPARATE file (v2.2-skills-ledger.jsonl) from the v2.1 agent ledger — keeps v2.1 byte-stable as a regression pin; v2.2 skills + v2.1 agents can be audited independently"
  - "Secret-scan copies classifier constants from guards.ts rather than exporting them — guards.ts internals stay private; skills scanner documents the doc-sync requirement in a comment"
  - "Credential-context gate: high-entropy alone does NOT refuse; the line must ALSO contain a credential-shaped label (password/secret/token/api_key/...). Solves the false-positive problem for avatar IDs, webhook IDs, git SHAs, and UUIDs in documentation"
  - "Tighter thresholds than v2.1 PlanReport guard (len>=12 + bits>=3.8 for skills vs len>=30 + bits>=4.0 for PlanReport) to catch short hand-typed passwords like finmentum-crm's 19-char MySQL credential"
  - "Word-boundary exemption: sub-30-char tokens containing `-`/`_`/space are NOT secrets (compound identifiers) — real credentials at that length are opaque runs with no word boundaries"
  - "Nested Commander subcommand registered from inside registerMigrateOpenclawCommand (passes the openclaw parent Command as arg) rather than registered from cli/index.ts — keeps the migrate-openclaw namespace self-contained"
  - "Sections always emit headers even when empty (with `(none)` body) — deterministic output contract so downstream greps can pin all 5 sections"

patterns-established:
  - "Credential-context gate for high-entropy detection: co-occurrence of label + high-entropy token is the signal, not high-entropy alone. Documented for reuse in future scanners."
  - "Deterministic per-entity content hash via sha256(sorted relpath\\0sha256(content)) for idempotency tracking"
  - "Per-subsystem ledger file pattern (v2.1 ledger.jsonl for agents, v2.2-skills-ledger.jsonl for skills) — separate append-only streams per lifecycle"

requirements-completed: [SKILL-01, SKILL-02, SKILL-05, SKILL-07]

# Metrics
duration: ~25min
completed: 2026-04-21
---

# Phase 84 Plan 01: Skills Discovery + Secret-Scan Gate Summary

**Stood up the `clawcode migrate openclaw skills` CLI scaffold with three hard gates (fs-guard-enforced source read-only, per-skill secret scan that refuses finmentum-crm until its literal MySQL credentials are scrubbed, JSONL ledger that drives idempotency) — zero new npm deps.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-21T18:15:29Z
- **Completed:** 2026-04-21T18:40:30Z
- **Tasks:** 2/2 (both TDD RED+GREEN)
- **Files created:** 7 (3 modules + 1 CLI + 3 tests)
- **Files modified:** 1 (migrate-openclaw.ts for subcommand registration)

## Accomplishments

- Secret-scan HARD GATE shipped — finmentum-crm refused with exact-location offender (`SKILL.md:20 (high-entropy)`) until the MySQL credentials are moved to op:// refs. Plan 02 cannot ship without this working; now it's pinned by 9 canary tests.
- Zero-dep credential-context classifier: the co-occurrence-of-label-plus-high-entropy heuristic cleanly distinguishes real credentials from legitimate high-entropy identifiers (avatar IDs, webhook IDs, UUIDs) that routinely appear in skill documentation.
- End-to-end CLI works: `clawcode migrate openclaw skills --dry-run` emits deterministic output with 4 of 5 P1 skills clean-migrating (frontend-design, new-reel, self-improving-agent, tuya-ac) and finmentum-crm correctly bucketed under `skipped (secret-scan)`.
- 29 tests passing across 3 test files (9 ledger + 9 secret-scan + 11 CLI integration). Zero type errors introduced; zero new npm deps; regression clean against pre-existing tests.

## Task Commits

1. **Task 1 RED: skills-ledger + secret-scan tests** — `7bf88c1` (test)
2. **Task 1 GREEN: skills-ledger + secret-scan + discovery modules** — `91f5e8d` (feat)
3. **Task 2 RED: migrate-skills CLI tests** — `9b51bcb` (test)
4. **Task 2 GREEN: migrate-skills CLI + scanner refinements** — `925a516` (feat)

Task 1 shipped three pure-function modules (skills-ledger.ts / skills-secret-scan.ts / skills-discovery.ts) with ≥18 tests total. Task 2 wired them into the `migrate openclaw skills` Commander subtree, added end-to-end CLI tests (including the fs-guard belt-and-suspenders), and refined the secret-scan classifier to handle markdown code fences + backtick-quoted IDs without false positives.

## Files Created/Modified

### Created

- `src/migration/skills-ledger.ts` — Append-only JSONL ledger at `.planning/migration/v2.2-skills-ledger.jsonl`. Mirrors v2.1 `ledger.ts` shape with a trimmed action enum (plan/apply/verify) and extended status enum (adds `skipped`/`refused`). `appendSkillRow` / `readSkillRows` / `latestStatusBySkill` public API.
- `src/migration/skills-secret-scan.ts` — `scanSkillSecrets(skillDir): Promise<SkillSecretResult>` walks SKILL.md + scripts/ + references/ with a three-phase classifier. Credential-context gate requires a label (password/secret/token/api_key/bearer/etc.) to co-occur with a high-entropy token before refusing. Returns first offender with masked preview (secret NEVER in payload).
- `src/migration/skills-discovery.ts` — `discoverOpenclawSkills(sourceRoot): Promise<readonly DiscoveredSkill[]>` walks the source root, classifies each subdir against the locked 12-entry `SKILL_CLASSIFICATIONS` map, computes a deterministic `sourceHash` per skill via `sha256(sorted relpath\0sha256(content))`.
- `src/cli/commands/migrate-skills.ts` — `runMigrateSkillsAction(opts): Promise<number>` + `registerMigrateSkillsCommand(parent)`. Action body wrapped in `try{installFsGuard; ...}finally{uninstallFsGuard}`. Emits 5 deterministic sections in locked order with `(none)` placeholder for empty buckets.
- `src/migration/__tests__/skills-ledger.test.ts` — 9 tests
- `src/migration/__tests__/skills-secret-scan.test.ts` — 9 tests (8 canaries per plan spec + node_modules skip)
- `src/cli/commands/__tests__/migrate-skills.test.ts` — 11 tests covering Task 2 behavior spec

### Modified

- `src/cli/commands/migrate-openclaw.ts` — Added `registerMigrateSkillsCommand(openclaw)` call at the end of `registerMigrateOpenclawCommand` so the `skills` subcommand attaches to the same `openclaw` parent tree as `list` / `plan` / `apply` / `verify` / `rollback` / `cutover` / `complete`.

## Secret-Scan Canary Outcomes

| Skill | Verdict | Reason / offender location |
|---|---|---|
| cognitive-memory | skipped (deprecated) | superseded by ClawCode v1.1/v1.5/v1.9 memory stack |
| finmentum-content-creator.retired | skipped (deprecated) | `.retired` suffix; replaced by new-reel |
| **finmentum-crm** | **skipped (secret-scan)** | **SKILL.md:20 (high-entropy) — MySQL credentials** |
| frontend-design | migrated | ready to migrate |
| new-reel | migrated | ready to migrate |
| openclaw-config | skipped (deprecated) | references dead OpenClaw gateway |
| power-apps-builder | skipped (p2-out-of-scope) | P2 — out of v2.2 scope |
| remotion | skipped (p2-out-of-scope) | P2 — out of v2.2 scope |
| self-improving-agent | migrated | ready to migrate |
| test | skipped (p2-out-of-scope) | P2 — out of v2.2 scope |
| tuya-ac | migrated | ready to migrate |
| workspace-janitor | skipped (p2-out-of-scope) | P2 — out of v2.2 scope |

## Idempotency Proof

- **First dry-run against fresh ledger:** emits 5 sections, ledger file NOT created (dry-run writes nothing).
- **Second dry-run (after manual 'migrated' row with matching source_hash):** frontend-design moves from `migrated` section to `skipped (idempotent)` bucket. Covered by test 4.
- **Second dry-run (after 'migrated' row with STALE source_hash):** frontend-design stays in `migrated` bucket (re-planned because source changed). Covered by test 5.
- **Determinism:** `diff <(clawcode migrate openclaw skills --dry-run) <(clawcode migrate openclaw skills --dry-run)` is empty. Verified by manual run + captured to summary.

## fs-guard Coverage

- Action body wrapped in `try { installFsGuard(); ... } finally { uninstallFsGuard(); }`.
- Verified by test 6: `installFsGuard(); writeFile(~/.openclaw/skills/poisoned.md)` throws `ReadOnlySourceError`.
- `grep -n "installFsGuard\|uninstallFsGuard" src/cli/commands/migrate-skills.ts` returns 4 matches (import + invocation pair).

## Handoff Interface for Plan 02

Plan 02 (skills transformer + linker) consumes:

- `DiscoveredSkill[]` (from `discoverOpenclawSkills`) — the 12-entry array with per-skill `{name, path, classification, sourceHash}`. Plan 02 filters to `classification === "p1"` and iterates.
- `scanSkillSecrets(skill.path)` — Plan 02 calls this BEFORE copying any file. If `result.pass === false`, skip the copy and emit a `refused` ledger row.
- `appendSkillRow(ledgerPath, row)` — Plan 02 writes per-skill rows with `action: "apply"`, `status: "migrated"` once the copy + linker succeed.
- Ledger idempotency: Plan 02 reads `latestStatusBySkill(ledgerPath)` to determine which skills were already `migrated` with the current source hash and skip them on re-run.
- CLI scaffold: the `runMigrateSkillsAction` function already runs the classification pipeline; Plan 02 replaces the current `"ready to migrate"` / `"would-migrate"` stub with a real per-skill transformer + copy.

## Deviations from Plan

### Auto-fixed Issues (Rule 1 / Rule 2 / Rule 3)

**1. [Rule 2 — Missing functionality] Credential-context gate on high-entropy classifier**
- **Found during:** Task 2 integration testing.
- **Issue:** High-entropy-alone was insufficient to refuse. Skill documentation routinely contains legitimate high-entropy IDs (avatar IDs, webhook IDs, UUIDs, git SHAs) that match the `len>=12 && classes>=3 && entropy>=3.8` predicate but are NOT credentials. Without a context gate, new-reel's 32-char hex avatar ID `d46fa7f3801f413d943120285050d6ed` and the 16-char n8n workflow ID `Gvzo8KsU3SqJWzRh` both triggered false-positive refusals.
- **Fix:** Added `hasCredentialContext(line)` gate — high-entropy tokens refuse ONLY when the surrounding line contains a credential-shaped label (password / passwd / pwd / secret / api_key / access_key / private_key / bearer / auth / credential / client_secret / refresh_token / session_token). Public-ID labels (`id`, `avatar_id`, `webhook`, `endpoint`, `workflow`) are NOT in the list — those tokens pass.
- **Files modified:** `src/migration/skills-secret-scan.ts`.
- **Commit:** `925a516`.

**2. [Rule 1 — Bug] Tokenizer strip-chars incomplete**
- **Found during:** Task 2 integration testing.
- **Issue:** The bare-token strip regex `/^[()"',;:]+|[()"',;:]+$/g` did not remove markdown emphasis (`*`), code-span backticks (`` ` ``), or markdown-list brackets (`[`, `]`, `{`, `}`) from token ends. This caused compound tokens like `` `d46fa7f3801f413d943120285050d6ed`** `` to flunk the classifier while the inner hex would have passed.
- **Fix:** Extended strip-char class to include `*` and `` ` `` and markdown bracket chars.
- **Files modified:** `src/migration/skills-secret-scan.ts`.
- **Commit:** `925a516`.

**3. [Rule 1 — Bug] Quoted-substring assignment split missing**
- **Found during:** Task 2 integration testing.
- **Issue:** Pass 1 of the tokenizer (quoted substrings) emitted the WHOLE quoted content as a single token. For `"device_id=YOUR_DEVICE_ID_HERE"` this produced the compound string whose mixed-case-plus-special entropy flunked the 3.8-bit threshold, even though the rhs `YOUR_DEVICE_ID_HERE` on its own passed cleanly.
- **Fix:** Pass 1 also splits on `=` when the first `=` is a valid assignment (eq > 0 && eq < len-1) and only yields the rhs.
- **Files modified:** `src/migration/skills-secret-scan.ts`.
- **Commit:** `925a516`.

**4. [Rule 2 — Missing functionality] Additional whitelist shapes for skill-doc content**
- **Found during:** Task 2 integration testing.
- **Issue:** The Phase 77 guards.ts whitelist covered op:// refs, numeric IDs, short identifiers, absolute paths, and model IDs — but skill documentation routinely contains shell command substitutions (`$(cat ...)`, `${VAR}`), HTTPS URLs, Python method chains (`hashlib.sha256(body.encode()).hexdigest()`), and Docker/package references (`python:3.11-slim`). Without these, the classifier produced repeat false positives.
- **Fix:** Extended `isWhitelisted` with: shell substitution + env-var reference + HTTPS/file/data URLs + function-call syntax (contains `(` or `)`) + path-shaped tokens + dotted identifiers + Docker/package refs (`name:tag`) + quote-char presence + whitespace presence.
- **Files modified:** `src/migration/skills-secret-scan.ts`.
- **Commit:** `925a516`.

**5. [Rule 2 — Missing functionality] Word-boundary exemption for sub-30-char tokens**
- **Found during:** Task 2 integration testing (`ARM-compatible` from self-improving-agent refused at entropy 3.81).
- **Issue:** At the new tighter skills threshold (len>=12, bits>=3.8), the classifier caught short compound identifiers like `ARM-compatible` that contain `-` as a word boundary. Real credentials at that length are continuous opaque runs without word boundaries.
- **Fix:** Sub-30-char tokens with internal `-`/`_`/space are exempted (treated as compound identifiers, not secrets). Real-world credential example `KME6fka2nuy@cmu@pmj` has no word boundaries so it still refuses.
- **Files modified:** `src/migration/skills-secret-scan.ts`.
- **Commit:** `925a516`.

None of the above required architectural changes — all were additive refinements to the classifier's whitelist / context-gate layers. The underlying three-phase flow (hasSecretPrefix → isWhitelisted → isHighEntropySecret) is unchanged.

## Self-Check: PASSED

Verified files exist:
- FOUND: src/migration/skills-ledger.ts
- FOUND: src/migration/skills-secret-scan.ts
- FOUND: src/migration/skills-discovery.ts
- FOUND: src/cli/commands/migrate-skills.ts
- FOUND: src/migration/__tests__/skills-ledger.test.ts
- FOUND: src/migration/__tests__/skills-secret-scan.test.ts
- FOUND: src/cli/commands/__tests__/migrate-skills.test.ts

Verified commits exist in git log:
- FOUND: 7bf88c1 (Task 1 RED)
- FOUND: 91f5e8d (Task 1 GREEN)
- FOUND: 9b51bcb (Task 2 RED)
- FOUND: 925a516 (Task 2 GREEN)

Verified phase-level invariants:
- 29/29 plan tests pass
- `pnpm tsx src/cli/index.ts migrate openclaw skills --dry-run` exits 0 and emits all 5 sections deterministically
- `grep -rn "KME6fka2nuy\|100.117.234.17.*password" src/` returns zero lines (no secret leaks)
- `npx tsc --noEmit` — clean for the 4 new files (pre-existing errors in unrelated files are out of scope per Rule 3)
