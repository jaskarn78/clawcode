# Phase 130 Plan 02 — Skill Loading Survey

**Date:** 2026-05-15
**Goal:** Identify the chokepoint where the daemon iterates per-agent skills, so the manifest-validation hook lands in ONE place (silent-path-bifurcation rule).

## Existing skill-loading topology

| File | Role |
|------|------|
| `src/skills/scanner.ts` | `scanSkillsDirectory(skillsPath, log) → SkillsCatalog` — reads every `<dir>/SKILL.md` under the fleet-wide skills path, parses `version` + `effort` frontmatter + first-paragraph description. Returns `Map<name, SkillEntry{name, description, version, path, effort?}>`. **Catalog is name-keyed.** |
| `src/skills/linker.ts` | `linkAgentSkills(agentSkillsDir, agentSkills, catalog, log)` — creates `workspace/skills/<name>` symlinks for skills the agent's config lists. |
| `src/skills/installer.ts` | `installWorkspaceSkills(srcDir, dstDir, log)` — one-time copy of in-repo `./skills/` into `~/.clawcode/skills/`. |
| `src/manager/session-config.ts` | Renders `skillsHeader` for the system prompt from `config.skills` + injected `SkillsCatalog` (via `setSkillsCatalog`). **Consumes** the catalog; does not load. |
| `src/manager/daemon.ts:2437-2447` | The ACTUAL boot-time chokepoint: scans the skills dir once, then loops `for (const agent of resolvedAgents) { linkAgentSkills(...) }`. |
| `src/cli/commands/skills.ts` | Operator-facing CLI surface that already issues an IPC `skills` request and renders a per-agent catalog table. Plan 03 extends this with `--validate`. |
| `src/marketplace/install-single-skill.ts` | Marketplace install flow that writes new SKILL.md files; tangential — does not load. |

## Existing frontmatter parsing

`src/skills/scanner.ts` already has hand-rolled regex frontmatter extraction (`extractVersion`, `extractEffortFrontmatter`). No project-wide `gray-matter` dep — the codebase standard is the `yaml` package (v2.8.3), used in `loader.ts`, `tier-manager.ts`, `agent-create.ts`, etc.

**Plan 02's loader will:**
1. Use the existing `^---\n(...)\n---` regex split (matches scanner.ts style).
2. Feed the captured YAML block to `parse(...)` from `yaml`.
3. Hand to `SkillManifestSchema.safeParse(...)` from `src/plugin-sdk`.

No new dependency.

## Chokepoint decision

**Insert a NEW module `src/manager/skill-loader.ts` and call it ONCE in `daemon.ts:2447` per-agent.**

Rejected alternatives:
- **(a) Extend `scanSkillsDirectory`** — couples manifest cross-check (which needs the *agent's* `mcpServers[]`) to the FLEET-WIDE scan that knows no agent. Forces a two-pass design or threading agent context into a name-keyed catalog. Worse layering.
- **(c) Validate inside `linkAgentSkills`** — that function is filesystem-only (symlink writing); mixing config validation breaks its single-responsibility contract.

**(b) — new module, post-scan, pre-link** wins:
1. `scanSkillsDirectory` still produces the name-keyed catalog (unchanged).
2. After scan, BEFORE link, a new per-agent loop calls `loadSkillManifest(catalog.get(name)!.path, agent.mcpServers.map(s=>s.name))` for each `agent.skills[]` entry.
3. Refused skills are filtered OUT of the per-agent skills list before `linkAgentSkills` runs (so no broken symlink is created).
4. The filtered list + a per-agent `unloadedSkills[]` accumulator land on a new daemon-scoped map for Plan 03 to surface.

### Call-site placement (T-04 target)

Replace the loop at `src/manager/daemon.ts:2446-2448`:

```ts
// BEFORE:
for (const agent of resolvedAgents) {
  await linkAgentSkills(join(agent.workspace, "skills"), agent.skills, skillsCatalog, log);
}

// AFTER (Plan 02 wiring):
const unloadedSkillsByAgent = new Map<string, UnloadedSkillEntry[]>();
for (const agent of resolvedAgents) {
  const enabledMcp = agent.mcpServers.map((s) => s.name);
  const loadedSkills: string[] = [];
  const unloaded: UnloadedSkillEntry[] = [];
  for (const skillName of agent.skills) {
    const entry = skillsCatalog.get(skillName);
    if (!entry) {
      // Already warn-logged by linkAgentSkills today; preserve.
      loadedSkills.push(skillName); // legacy back-compat — non-manifest skips fall through
      continue;
    }
    const result = loadSkillManifest(entry.path, enabledMcp);
    if (result.status === "loaded" || result.status === "manifest-missing") {
      // manifest-missing = warn + back-compat load (D-03a).
      loadedSkills.push(skillName);
    } else {
      unloaded.push({ name: skillName, status: result.status, reason: result.reason, missingMcp: result.missingMcp });
    }
  }
  unloadedSkillsByAgent.set(agent.name, unloaded);
  await linkAgentSkills(join(agent.workspace, "skills"), loadedSkills, skillsCatalog, log);
}
```

`grep -c "loadSkillManifest(" src/manager/daemon.ts` = **1** (the call inside the loop). Plan 03 reads `unloadedSkillsByAgent` to render the boot-time Discord notification.

## Cross-check input (T-02 contract)

`agent.mcpServers` is `readonly { readonly name: string; ... }[]` per `src/shared/types.ts:422`. The loader takes `enabledMcpServers: string[]` (already-projected names) — the daemon supplies `agent.mcpServers.map(s => s.name)` at the call site. Keeps the loader pure / synchronous / unit-testable.

## Migration scope adjustment (T-05)

`~/.clawcode/agents/admin-clawdy/` **does not exist on the local environment** (production-only agent on the `clawdy` host). Local enumeration shows 6 fleet-wide skills at `~/.clawcode/skills/` and per-agent skills under `~/.clawcode/agents/{general,projects,finmentum,research,...}/skills/`. T-05 will migrate the **6 fleet-wide global skills** (`~/.clawcode/skills/{new-reel,new-reel-v2,frontend-design,self-improving-agent,subagent-thread,tuya-ac}`) as the canonical proof-of-concept — these are the same files distributed to every agent (incl. admin-clawdy on prod) via `installWorkspaceSkills(./skills, ~/.clawcode/skills)`. Migrating upstream of the per-agent layout. Per-agent dirs are deferred to v3.0.1 (matches `D-05a`).
