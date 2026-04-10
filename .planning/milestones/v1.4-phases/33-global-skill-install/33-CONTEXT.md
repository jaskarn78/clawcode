# Phase 33: Global Skill Install - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase)

<domain>
## Phase Boundary

Copy workspace-local skills from `skills/` to `~/.claude/skills/` at daemon startup, and immediately on first run. This makes skills like `subagent-thread` accessible to agents running as raw Claude Code sessions (outside daemon skill injection). The installer runs once per skill file, comparing checksums to avoid redundant copies.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Install to `~/.claude/skills/<skill-name>/` mirroring the workspace's `skills/<skill-name>/` structure. Checksum-based idempotency. Run at daemon startup before sessions start. Also expose as `clawcode init` step.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `skills/subagent-thread/SKILL.md` — source skill file to install
- `src/skills/scanner.ts` — already scans workspace skills directory
- `src/manager/daemon.ts` — startup sequence to hook into

### Established Patterns
- File operations use `node:fs/promises` throughout codebase
- Daemon startup uses sequential init steps before starting sessions

### Integration Points
- `startDaemon()` in `src/manager/daemon.ts` — add skill install step after loading config
- `src/cli/commands/init.ts` — expose standalone install for non-daemon use

</code_context>

<specifics>
## Specific Ideas

- Source: `{cwd}/skills/**/*.md` (workspace-relative)
- Destination: `~/.claude/skills/<skill-name>/<file>`
- Skip if destination exists and checksum matches (no unnecessary writes)
- Log each installed skill

</specifics>

<deferred>
## Deferred Ideas

- Skill versioning / rollback
- Skill registry with metadata

</deferred>
