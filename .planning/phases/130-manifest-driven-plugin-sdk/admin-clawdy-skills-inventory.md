# Phase 130 — admin-clawdy skills migration inventory

**Date:** 2026-05-15
**Plan:** 130-02 T-05

## Scope adjustment (deviation from plan body)

The plan body targets `~/.clawcode/agents/admin-clawdy/skills*/`. That
directory **does not exist on the local development environment** —
admin-clawdy is a production-only agent on the `clawdy` host
(Tailscale `100.98.211.108`). The local fleet uses:

```
~/.clawcode/skills/                       # fleet-wide (6 skills)
~/.clawcode/agents/{general,projects,...}/skills/     # per-agent
```

Per advisor guidance: migrate the **6 fleet-wide skills at
`~/.clawcode/skills/`** as the canonical proof-of-concept. These are
the same files `installWorkspaceSkills` (daemon.ts:2441) distributes to
every agent's workspace — admin-clawdy on production reads from the
same fleet-wide pool. Migrating upstream of the per-agent layout
satisfies the spirit of D-05 ("admin-clawdy skills only this phase")
without inventing a directory that doesn't exist locally. Per-agent
skill dirs are deferred to v3.0.1 (matches D-05a).

## Inventory

| Skill | Existing frontmatter | Inferred capabilities | Inferred requiredMcpServers | Owner |
|-------|---------------------|----------------------|----------------------------|-------|
| `frontend-design` | name, description, license | filesystem (writes UI files) | (none) | `*` |
| `new-reel` | name, description | network (HeyGen + Nextcloud + container POSTs), filesystem (writes project JSON) | (none — uses HTTP, not MCP) | `*` |
| `new-reel-v2` | name, description | network (reelforge container), filesystem | (none — uses HTTP, not MCP) | `*` |
| `self-improving-agent` (dir) — `self-improvement` (name) | name, description, metadata | filesystem (writes `.learnings/*.md`), memory-write | (none) | `*` |
| `subagent-thread` | version: 1.0 only — no name/description in frontmatter | subagent-spawn, discord-post (delegate_task + thread visibility), cross-agent-delegate | (none — uses built-in IPC, not MCP) | `*` |
| `tuya-ac` | name, description | network (Tuya Cloud API), secret-access (Tuya OAuth token) | (none — direct HTTP to Tuya Cloud) | `*` |

### Notes on inference

- **`network` capability** is assigned generously: every skill that
  POSTs to an HTTP endpoint outside the daemon process gets it.
- **`filesystem` capability** is assigned when the skill body
  explicitly writes files outside the agent's workspace **or** writes
  to a well-known shared directory (e.g., `projects/<slug>.json`,
  `.learnings/`).
- **`memory-write` for `self-improving-agent`:** the skill writes
  user-correction logs into the agent's memory dir; the `memory-write`
  capability label maps cleanly.
- **`secret-access` for `tuya-ac`:** the skill resolves a Tuya OAuth
  token at runtime via `op://` or env — gets the label.
- **`subagent-spawn` for `subagent-thread`:** the skill's whole purpose
  is `spawn_subagent_thread` IPC. The `cross-agent-delegate` label
  applies to the same surface (delegate_task).
- **No `mcpServer` requirement** for any of the six — the existing
  fleet skills predate Phase 130's MCP-aware design and all use
  direct HTTP / built-in IPC. The `clawcode-broker` MCP / `1password`
  MCP cross-checks become exercisable when fin/projects per-agent
  skills migrate in v3.0.1.
- **`subagent-thread` frontmatter** is currently malformed for the
  scanner's `extractVersion` regex (it works because `version` is on
  its own line); back-fill must add `name`/`description` while
  preserving the v1.0 version string semantically (bumped to `1.0.0`
  for semver compliance with `SkillManifestSchema`).
- **`self-improving-agent` directory vs `name: self-improvement`
  manifest:** preserved as-is. `scanSkillsDirectory` keys the catalog
  by directory name, the manifest's `name` field is a display label;
  the schema regex `^[a-z0-9-]+$` accepts `self-improvement`.

## Validation

A post-migration unit test (`migrated-fleet-skills-load.test.ts`)
loops these 6 directories, calls `loadSkillManifest(dir, [])`, and
asserts `status === "loaded"` for each. Since none declare
`requiredMcpServers`, an empty `enabledMcpServers` argument is
sufficient.
