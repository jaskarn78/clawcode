# Phase 130: Manifest-Driven Plugin SDK — Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Mode:** Auto-generated from BACKLOG.md (autonomous workflow). Operator-pre-specified spec from 2026-05-14 capability-comparison-vs-OpenClaw report (§"Steal from OpenClaw" #2).

<canonical_refs>
## Canonical References

| Ref | Why | Path |
|-----|-----|------|
| BACKLOG.md (authoritative spec) | Operator-written 2026-05-14 19:52 PT; capability vocabulary + manifest schema + acceptance criteria | `.planning/phases/130-manifest-driven-plugin-sdk/BACKLOG.md` |
| ROADMAP.md Phase 130 entry | Goal + Success Criteria + dependencies | `.planning/ROADMAP.md` — Phase Details (v3.0) section |
| OpenClaw plugin-sdk (MIT — REFERENCE) | The pattern being lifted | `openclaw/plugin-sdk/src/` (external repo — read at `https://github.com/openclaw/openclaw/tree/main/plugin-sdk`) |
| OpenClaw gateway loader (MIT — REFERENCE) | Load-time validation pattern | `openclaw/gateway/src/plugins/loader.ts` (external) |
| Existing skill discovery code | Where the validation hook lands | Search `src/manager/` for `skills` loading; likely in `session-config.ts` (existing `skills: []` config field) + `src/skills/` if it exists |
| Existing MCP server config | Where MCP manifest validation lands | `src/config/schema.ts` `mcpServerSchema` + `src/manager/session-adapter.ts:1317 transformMcpServersForSdk` |
| Phase 999.54 alwaysLoad pattern | Precedent for resolver-level MCP server validation | `.planning/phases/999.54-allowed-tools-sdk-passthrough/999.54-CONTEXT.md` (D-05a structured log emission shape) |
| Phase 126 (999.57) subagent context isolation | Adjacent — clarifies what gets inherited vs isolated; informs `runtime-api` shape | `.planning/phases/126-subagent-context-isolation/999.57-CONTEXT.md` |
| Phase 131 (999.50 tmux skill) | First migration target — port to new manifest format | `.planning/phases/131-tmux-remote-control-skill/BACKLOG.md` |
| feedback_silent_path_bifurcation.md | Anti-pattern — manifest loader single-chokepoint, NOT per-call-site | memory |
| feedback_ramy_active_no_deploy.md | Deploy hold | memory |
| Comparison report | "ClawCode's plugin discipline is implicit, not contractual" — operator's framing | `Admin Clawdy/research/agent-runtime-comparison-2026-05-14.md` |
</canonical_refs>

<domain>
## Phase Boundary

Promote MCP servers + skills to a discoverable, type-checked plugin surface. Modeled on OpenClaw's `plugin-sdk`. Every skill carries a `SKILL.md` manifest declaring capabilities, required tools, required MCP servers, and ownership. Daemon validates at load time and refuses mismatches with a clear error.

**In scope:**
- `plugin-sdk` package surface: `defineSkill(manifest)` / `defineMCPTool(manifest)` helpers producing manifest-conformant exports.
- Manifest schemas (Zod) for skills (`SKILL.md` frontmatter) and MCP servers (`mcp-manifest.json`).
- Capability vocabulary (enum): `filesystem`, `network`, `llm-call`, `discord-post`, `cross-agent-delegate`, `mcp-tool-use`, `subagent-spawn`, `memory-write`, `memory-read`, `secret-access`, etc.
- Daemon-side load-time validation chokepoint — refuses to load a skill whose manifest declares an MCP server not enabled for the calling agent.
- Migration of existing skills (back-fill manifests) — start with `Admin Clawdy/skills/` for fleet validation before broader rollout.
- Docs page enumerating the capability vocabulary with examples.

**Out of scope (deferred):**
- `clawcode doctor` command consuming the manifest — separate phase ([[999.NN-doctor-command]] backlog).
- Public ClawHub-style registry — future phase; this lands the foundation, not the marketplace.
- Runtime capability ENFORCEMENT (e.g., sandboxing skill execution to its declared capabilities) — manifest declares the upper bound; runtime enforcement is a v3.x followup.
- MCP server manifest VALIDATION beyond load-time enumeration — full MCP-side capability assertion is a v3.x extension.
- Migration of ALL skills in one phase — start with `Admin Clawdy` agent's skills; back-fill the rest in follow-up dot-releases as part of v3.0.1.

</domain>

<decisions>
## Implementation Decisions

### Mechanism (manifest format)

- **D-01:** **`SKILL.md` frontmatter** is the manifest. YAML frontmatter at the top of `SKILL.md` per existing skill convention. Zod schema in `src/plugin-sdk/manifest-schema.ts`. Fields:
  ```yaml
  ---
  name: subagent-thread                    # kebab-case
  description: Spawn subagent in Discord thread
  version: 1.0.0                           # semver
  owner: "*"                               # agent name OR "*" for fleet-wide
  capabilities:
    - subagent-spawn
    - discord-post
  requiredTools: []                        # built-in tools (read/write/etc) — empty default
  requiredMcpServers:                      # MCP server names this skill needs enabled
    - clawcode
  ---
  ```
- **D-01a:** **`mcp-manifest.json`** is the parallel for MCP servers. Lives at `{mcp-server-dir}/mcp-manifest.json`. Same capability vocabulary. Optional this phase — gate-validated only for MCP servers that ship one (no retroactive requirement).

### plugin-sdk package surface

- **D-02:** **`src/plugin-sdk/`** is the new package location (in-tree, not separate npm package — same monorepo discipline as v2.2's zero-new-dep constraint). Exports:
  ```ts
  // src/plugin-sdk/index.ts
  export { defineSkill } from "./define-skill.js";
  export { defineMCPTool } from "./define-mcp-tool.js";
  export type { SkillManifest, MCPToolManifest, Capability } from "./manifest-schema.js";
  export { CAPABILITY_VOCABULARY } from "./capability-vocabulary.js";
  ```
- **D-02a:** `defineSkill(manifest)` validates the manifest at compile-time (Zod parse) and at module-load time. Returns the typed manifest unchanged but throws on schema mismatch. Same shape as OpenClaw's `plugin-sdk` `defineSkill`.

### Daemon-side load-time validation

- **D-03:** **Single chokepoint at the skills-loader** — wherever the daemon iterates `~/.clawcode/agents/<agent>/skills*/` and registers them. Search `src/manager/` for the existing loader; if absent, create `src/manager/skill-loader.ts` as the chokepoint. Validation steps:
  1. Read `SKILL.md` frontmatter.
  2. Zod-parse against `SkillManifestSchema`.
  3. Cross-check `requiredMcpServers` against the agent's enabled MCP servers (from resolved config). If any required server is NOT enabled: REFUSE LOAD; emit structured error log via `console.error("phase130-skill-load-fail", JSON.stringify({...}))`.
  4. Refusals surface in `/clawcode-tools` Discord slash output + `clawcode mcp-status` CLI as `skill: <name> — UNLOADED (missing MCP: <server>)`.
- **D-03a:** **Manifest-less skills get a structured warn log, not a silent load** — `console.warn("phase130-skill-manifest-missing", JSON.stringify({skill, path}))`. Migration period: don't break existing skills; just nag operators to backfill.

### Capability vocabulary

- **D-04:** **Closed enum at `src/plugin-sdk/capability-vocabulary.ts`**:
  ```ts
  export const CAPABILITY_VOCABULARY = [
    "filesystem",          // read/write files outside workspace
    "network",             // arbitrary HTTP(S)
    "llm-call",            // additional Anthropic API calls beyond agent turn
    "discord-post",        // send messages via webhook
    "discord-read",        // read Discord channel messages
    "cross-agent-delegate", // post_to_agent or spawn_subagent_thread
    "subagent-spawn",      // delegate_task / spawn_subagent_thread
    "memory-write",        // memory.db writes
    "memory-read",         // memory.db reads
    "secret-access",       // 1Password / op:// secret resolution
    "mcp-tool-use",        // calls MCP tools beyond the agent's normal set
    "schedule-cron",       // creates cron entries
    "config-mutate",       // edits clawcode.yaml
  ] as const;
  export type Capability = typeof CAPABILITY_VOCABULARY[number];
  ```
- **D-04a:** Manifest's `capabilities` field is `Capability[]` (typed enum). Mismatch produces a Zod parse error with the offending value.

### Migration scope (this phase)

- **D-05:** **`Admin Clawdy` agent's skills** are the migration scope this phase. Per-agent skill dirs under `~/.clawcode/agents/<agent>/skills*/`. Back-fill `SKILL.md` frontmatter for every skill in `admin-clawdy`'s skill catalog. Validate end-to-end (load → enforce → report) on the admin-clawdy agent before fleet rollout.
- **D-05a:** **Other agents' skill manifests** are back-filled in v3.0.1 or as part of Phase 131 (which ports the tmux skill as the first NEW skill following the manifest pattern). This phase ships the FOUNDATION; broader rollout is incremental.

### Reload behavior

- **D-06:** **RELOADABLE via ConfigWatcher hot-reload path.** SKILL.md changes pick up on the next ConfigWatcher tick. Cache the parsed manifest at load; invalidate on `SKILL.md` mtime change. Per `feedback_silent_path_bifurcation.md`: the cache invalidation lives in ONE place (the skill-loader chokepoint), not per-call-site.

### Telemetry

- **D-07:** **Structured log keys** following Phase 999.54 + Phase 127 precedent:
  - `phase130-skill-load-success` — `{agent, skill, capabilities, requiredMcpServers}`
  - `phase130-skill-load-fail` — `{agent, skill, reason, missingMcp}`
  - `phase130-skill-manifest-missing` — `{agent, skill, path}` (warn level)
- Operator-facing: `clawcode mcp-status --agent <name>` (or `clawcode skills <agent>`) renders the per-skill status table.

### Error UX

- **D-08:** **Refusal surfaces in Discord too** — when an agent boots and finds a skill it can't load, the daemon emits a single Discord notification via webhook on the agent's channel: `"⚠️ skill <name> not loaded — missing MCP server <server>"`. Same fire-and-forget pattern as Phase 127's stall notification (Phase 89 canary). Don't spam if there are multiple — batch into a single message listing all UNLOADED skills.

### Open Question (deferred to plan-research)

- **D-09:** **Skills that escalate capability mid-run** — e.g., a skill that calls `delegate_task` mid-turn. The BACKLOG flags this as an open question: "manifest declares the upper-bound, runtime enforces."
  - **(a)** Manifest declares all POSSIBLE capabilities the skill might exercise. Runtime checks each tool-call against the declared set.
  - **(b)** Manifest declares the BASELINE. Escalation is via an explicit elevation API (`requireCapability("cross-agent-delegate")`) that the skill calls.
  - **(c)** No runtime enforcement this phase — manifest is documentation + load-time check only.
  - **Decision deferred to plan-phase research.** Recommend (c) for v3.0 (foundation), promote to (a) or (b) in v3.x once enforcement matters operationally.

### NON-reloadable: NONE

- **D-10:** All Phase 130 fields are reloadable.

### Claude's Discretion

- File layout: `src/plugin-sdk/{index, manifest-schema, capability-vocabulary, define-skill, define-mcp-tool}.ts` + `src/plugin-sdk/__tests__/`.
- Skill-loader chokepoint: search first; if absent, create `src/manager/skill-loader.ts`.
- Existing skills survey: enumerate skills under `~/.clawcode/agents/admin-clawdy/skills*/` for migration scope.
- Validation test pattern: Plan 999.54-04 test cascade is the precedent (schema → loader → end-to-end fixture).

</decisions>

<code_context>
## Existing Code Insights

- **Skills config field** is already in `src/config/schema.ts` (`skills: z.array(z.string()).default([])` per-agent). The new manifest layer sits ALONGSIDE this, not REPLACING — the agent config still references skill names; the manifest adds typed metadata to each.
- **`clawcode skills` CLI** likely exists (per v2.2 skills marketplace work) — extend with `--validate` flag that runs the manifest validator without loading. Search `src/cli/commands/` for the existing surface.
- **OpenClaw's `plugin-sdk`** is MIT-licensed reference. Port the IDIOMS (define helper shape, manifest field names) but NOT the runtime — ClawCode's daemon is independently architected.
- **Phase 999.54's `phase999.54-resolver` log precedent** — structured log emission shape proven; mirror for Phase 130 keys.
- **Phase 127's `onStreamStall` callback factory pattern** — single-chokepoint construction injected via deps; same pattern applies to skill-loader validation hook.

</code_context>

<specifics>
## Specific Ideas

- **Capability vocabulary v1:** 13 capabilities (D-04). Each maps to an operator-observable risk surface. Operators can grep `requires: ["filesystem"]` in `SKILL.md` and immediately understand the skill's blast radius.
- **Manifest version field:** `version: 1.0.0` (semver). Future evolutions bump to 2.0.0; the loader supports back-compat for v1 manifests indefinitely.
- **Migration scope:** `admin-clawdy` skills only this phase. Other agents get v3.0.1 follow-up.
- **No OpenClaw runtime port:** lift the SCHEMA + DX patterns only; ClawCode's daemon is the runtime.

</specifics>

<deferred>
## Deferred Ideas

- **Runtime capability enforcement** (sandboxing) — v3.x.
- **`clawcode doctor` command** consuming manifest — separate phase per `[[999.NN-doctor-command]]` backlog.
- **Public ClawHub registry** — future phase; this lands foundation.
- **MCP server manifest VALIDATION beyond load-time** — v3.x extension.
- **Migration of ALL skills** — incremental in v3.0.1.
- **Capability-escalation API (D-09 option b)** — promote in v3.x when enforcement matters.

</deferred>

<scope_creep_guardrail>
## Scope Guardrail

Phase 130 scope:
- **YES:** Manifest schema, plugin-sdk package, capability vocabulary, load-time validation chokepoint, admin-clawdy migration.
- **NO:** Runtime enforcement, public registry, `doctor` command, all-fleet migration, MCP server runtime validation beyond load-time enumeration.

Reject scope-creep like "while we're at it, sandbox the skill runtime" — that's v3.x.

</scope_creep_guardrail>
