# Phase 88: Skills Marketplace - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped for autonomous run)

<domain>
## Phase Boundary

Discord users can browse available skills via `/clawcode-skills-browse` and install one to the bound agent with a single select-menu interaction. Install runs the Phase 84 migration pipeline (secret-scan + frontmatter + idempotency) against just the chosen skill.

**Requirements:** MKT-01..07 + UI-01.

**Depends on:** Phase 84 (reuses the migration utility end-to-end), Phase 86 (atomic YAML writer — same pattern used for `skills:` list updates).

**Inspiration:** OpenClaw skill marketplace pattern (user reference).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
Per REQUIREMENTS.md MKT-01..07, research FEATURES.md, ARCHITECTURE.md, PITFALLS.md.

### Known constraints / reuse
- Zero new npm deps
- Reuse Phase 84 skills-migration pipeline (secret-scan gate, frontmatter normalization, idempotency, ledger, fs-guard, atomic writer)
- Marketplace sources union: ClawCode local skills catalog + `~/.openclaw/skills/` legacy (config-driven)
- Discord UI: StringSelectMenuBuilder (UI-01); ephemeral replies; reject skills failing Phase 84 gates with explanation
- `/clawcode-skills` (no `-browse`) lists installed skills with remove option
- Single summary Discord message per install (no spam)

### Out-of-scope
- Publishing (MKT-F1), versioning (MKT-F2) — future milestone

</decisions>

<code_context>
## Existing Code Insights

Phase 84 shipped:
- `src/migration/skills-discovery.ts`, `skills-ledger.ts`, `skills-secret-scan.ts`
- `src/migration/skills-transformer.ts`, `skills-copier.ts`, `skills-scope-tags.ts`, `skills-linker-verifier.ts`
- `src/migration/skills-learnings-dedup.ts`, `skills-report-writer.ts`
- `src/cli/commands/migrate-skills.ts`
- `src/skills/scanner.ts`, `installer.ts`, `linker.ts`

Phase 86 shipped:
- `src/migration/yaml-writer.ts:updateAgentModel` pattern (reuse for `updateAgentSkills`)
- Discord StringSelectMenuBuilder + ButtonBuilder patterns in slash-commands.ts

</code_context>

<specifics>
None beyond REQUIREMENTS.md.
</specifics>

<deferred>
- Publishing flow (MKT-F1)
- Versioning + upgrades (MKT-F2)
</deferred>
