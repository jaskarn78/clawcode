# Phase 1: Foundation & Workspaces - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the central configuration system and per-agent workspace scaffolding. After this phase, a user can write a YAML config defining their agents and run a command that creates isolated workspace directories with identity files for each agent. No process management, no Discord, no memory — just config + workspaces.

</domain>

<decisions>
## Implementation Decisions

### Config Schema
- **D-01:** Single YAML config file (`clawcode.yaml`) at project root defining all agents
- **D-02:** Each agent entry has: name, workspace (path), channels (array of Discord channel IDs), model (sonnet/opus/haiku), skills (array), soul (inline or path), identity (inline or path)
- **D-03:** Top-level config includes: version, defaults (shared model, shared skills), agents array
- **D-04:** Agent-level fields override defaults (e.g., agent specifies model: opus overrides default model: sonnet)

### Workspace Layout
- **D-05:** Each agent workspace is a directory under a configurable base path (default: `~/.clawcode/agents/`)
- **D-06:** Workspace contains: SOUL.md, IDENTITY.md, memory/ directory, skills/ directory
- **D-07:** Workspaces are fully isolated — no shared files, no symlinks between agent dirs

### Default Identity
- **D-08:** Ship with sensible default SOUL.md and IDENTITY.md templates
- **D-09:** Config YAML can override identity via inline content or file path reference
- **D-10:** Default SOUL.md establishes baseline behavioral philosophy; default IDENTITY.md uses agent name for identity

### Setup CLI
- **D-11:** TypeScript CLI entry point — `clawcode init` reads config, validates, creates workspaces, populates identity files
- **D-12:** `clawcode init` is idempotent — running it again updates/creates missing workspaces without destroying existing ones
- **D-13:** CLI validates config schema before creating anything — fail fast with clear error messages

### Claude's Discretion
- Config validation library choice (zod, ajv, etc.)
- YAML parsing library choice
- CLI framework choice (commander, yargs, etc.)
- Exact default SOUL.md and IDENTITY.md content (should be good general-purpose defaults inspired by OpenClaw's patterns)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### OpenClaw Reference Implementation
- `~/.openclaw/openclaw.json` — Reference config structure (agents, channels, models, skills sections)
- `~/.openclaw/workspace-general/SOUL.md` — Reference SOUL.md format and content
- `~/.openclaw/workspace-general/IDENTITY.md` — Reference IDENTITY.md format
- `~/.openclaw/workspace-general/AGENTS.md` — Reference agent-level config

### Research
- `.planning/research/STACK.md` — Technology stack decisions (Node.js 22, TypeScript, Claude Agent SDK)
- `.planning/research/ARCHITECTURE.md` — System architecture (manager is deterministic code, not AI)
- `.planning/research/FEATURES.md` — Feature landscape and dependency graph

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code

### Established Patterns
- None — first phase establishes patterns

### Integration Points
- Config file will be consumed by all subsequent phases (lifecycle, Discord, memory, heartbeat)
- Workspace directories will be the root for per-agent memory, skills, and session state

</code_context>

<specifics>
## Specific Ideas

- Config schema should mirror OpenClaw's declarative approach but in YAML (not JSON) for human readability
- SOUL.md and IDENTITY.md separation follows the OpenClaw pattern: soul = behavioral philosophy, identity = name/avatar/tone
- Workspace structure should accommodate future phases: memory/ for Phase 4, skills/ for v1.x skills registry

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-workspaces*
*Context gathered: 2026-04-08*
