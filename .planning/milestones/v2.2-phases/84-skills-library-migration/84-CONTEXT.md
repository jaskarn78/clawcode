# Phase 84: Skills Library Migration - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss for autonomous run)

<domain>
## Phase Boundary

Operator can port the 5 P1 OpenClaw skills (`finmentum-crm`, `new-reel`, `frontend-design`, `self-improving-agent`, `tuya-ac`) into ClawCode via a gated CLI that's safe to re-run and emits an auditable report.

**Requirements in scope:** SKILL-01 through SKILL-08 (migrate 5 P1 skills via `clawcode migrate openclaw skills` CLI; secret-scan gate; frontmatter normalization; per-agent linker verification; idempotency; operator report; non-destructive to source; scope-tag enforcement).

**Hard gate:** `finmentum-crm` SKILL.md contains literal MySQL credentials in its description — migration must block until creds are scrubbed. Secret scan reuses v2.1 scanSecrets utility.

**Independent phase** — zero dependencies on Phase 83. Can build on v2.1 migration pipeline (ledger, atomic writer, fs-guard).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices at Claude's discretion. Use:
- ROADMAP phase goal
- REQUIREMENTS.md SKILL-01..08
- Research artifacts in `.planning/research/` (FEATURES.md has the full skill inventory with verdicts)
- v2.1 migration pipeline patterns from `src/migration/` (reusable for ledger, fs-guard, atomic writer)

### Known constraints
- Zero new npm deps
- Migration is non-destructive — `~/.openclaw/skills/` NEVER modified (enforced by fs-guard)
- Target layout: ClawCode skills live in `~/.clawcode/skills/` or workspace `skills/` dir — confirm by reading `src/skills/scanner.ts` + `src/skills/linker.ts`
- Idempotent via ledger (matches v2.1 MIGR-03 pattern)
- Scope tags: Finmentum skills (`finmentum-crm`, `new-reel`) auto-link only to Finmentum agents
- Skill-file format handling: `tuya-ac` needs frontmatter added; others preserve
- `self-improving-agent` has `hooks/` — verify hooks frontmatter supported

### Skills to port (P1 only)
1. `finmentum-crm` — blocks until MySQL creds scrubbed (secret-scan refuses)
2. `new-reel` — 56KB SKILL.md + `scripts/` + `reference/` subfolder; preserve `${CLAUDE_SKILL_DIR}` substitutions
3. `frontend-design` — content-only, zero conversion
4. `self-improving-agent` — hooks/ + scripts/ + `.learnings/`; dedupe `.learnings/` against v2.1-migrated memory entries tagged `"learning"`
5. `tuya-ac` — plain markdown; add `---` frontmatter during port

### Report format
`.planning/milestones/v2.2-skills-migration-report.md` with per-skill outcome (migrated/skipped/failed-secret-scan/deprecated).

</decisions>

<code_context>
## Existing Code Insights

Codebase context gathered during plan-phase research. Known reusable patterns:
- `src/migration/` — v2.1 one-shot migration pipeline (ledger, fs-guard, atomic writer)
- `src/skills/scanner.ts` — SKILL.md parser (tolerates missing frontmatter)
- `src/skills/installer.ts`, `src/skills/linker.ts` — per-agent skill binding
- `src/security/scan-secrets.ts` (or similar) — v2.1 secret scanner

</code_context>

<specifics>
## Specific Ideas

None specific beyond REQUIREMENTS.md.

</specifics>

<deferred>
## Deferred Ideas

- P2 skills (power-apps-builder, remotion, workspace-janitor, test) — out of scope for v2.2
- Community publishing (MKT-F1) — deferred
- Skill versioning + upgrade prompts (MKT-F2) — deferred

</deferred>
