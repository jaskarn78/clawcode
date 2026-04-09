# Phase 10: Skills Registry - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds a central skills registry with per-agent assignment. After this phase, all available skills are cataloged with metadata, agents only see their assigned skills, and agents can discover/list skills at runtime. Skills use Claude Code's existing SKILL.md format.

</domain>

<decisions>
## Implementation Decisions

### Registry Structure
- **D-01:** Central skills directory at a configurable path (default: `~/.clawcode/skills/`)
- **D-02:** Each skill is a directory containing at minimum a `SKILL.md` file
- **D-03:** Registry scans the skills directory on daemon startup, building an in-memory catalog
- **D-04:** Catalog stores: skill name (directory name), description (from SKILL.md first paragraph), version (from SKILL.md frontmatter if present), path

### Per-Agent Assignment
- **D-05:** Skills assigned per agent in clawcode.yaml under agent's `skills` array (already in schema from Phase 1)
- **D-06:** Agent system prompt includes list of assigned skills with descriptions
- **D-07:** Agent workspace `skills/` directory gets symlinks to assigned skill directories

### Runtime Discovery
- **D-08:** Agents can list their skills via the skills info in their system prompt
- **D-09:** IPC `skills` method returns full catalog and per-agent assignments
- **D-10:** `clawcode skills` CLI command shows catalog with agent assignments

### Claude's Discretion
- SKILL.md parsing details (frontmatter format)
- Symlink vs copy for agent skill directories
- Whether to validate skill names at config load time

</decisions>

<canonical_refs>
## Canonical References

### Existing Codebase
- `src/config/schema.ts` — Already has `skills` array per agent
- `src/manager/session-manager.ts` — buildSessionConfig (add skills section)
- `src/manager/daemon.ts` — Daemon startup (add registry scan)
- `src/ipc/protocol.ts` — IPC methods
- `src/cli/index.ts` — CLI commands

### Reference
- `~/.openclaw/skills/` — OpenClaw's skill directory structure
- Claude Code skill format — directory with SKILL.md

</canonical_refs>

<code_context>
## Reusable Assets
- Config schema already has skills array per agent
- System prompt injection pattern from memory/channels
- IPC + CLI command patterns well established

</code_context>

<specifics>
## Specific Ideas
- Registry should be read-only at runtime (no install/uninstall in v1.1)
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 10-skills-registry*
*Context gathered: 2026-04-09*
