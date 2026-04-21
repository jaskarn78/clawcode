/**
 * Phase 84 Plan 02 Task 1 — SKILL-08 scope-tag registry.
 *
 * Encodes the OpenClaw → ClawCode skill scope rules so the migrator can
 * refuse to link Finmentum-scoped skills onto non-Finmentum agents, and
 * personal skills onto non-personal agents, without operator intervention.
 *
 * Scope vocabulary (v2.2 locked; user-extensible map is deferred to
 * a future milestone per REQUIREMENTS.md SKILL-F1):
 *   - "finmentum"  — agents whose names start with `fin-` (fin-acquisition,
 *                    fin-research, fin-tax, ...). Only these see finmentum-
 *                    scoped skills by default.
 *   - "personal"   — hardcoded personal channel-set agents: `clawdy`, `jas`.
 *                    Only these see personal-scoped skills (e.g. tuya-ac).
 *   - "fleet"      — everyone else (general, projects, research, ...). Sees
 *                    fleet-scoped skills AND fleet skills link to any agent.
 *
 * Rules encoded by `canLinkSkillToAgent`:
 *   - fleet skills → link to any agent
 *   - finmentum skills → link only to finmentum agents (unless --force-scope)
 *   - personal skills → link only to personal agents (unless --force-scope)
 */

/**
 * Canonical scope for each v2.2 P1 skill. Skills not in this map default
 * to `"fleet"` scope (max-permissive — a skill we don't know about is
 * assumed to be general-purpose). Callers that need stricter default
 * behavior should add explicit entries here.
 */
export const SCOPE_TAGS: ReadonlyMap<
  string,
  "finmentum" | "personal" | "fleet"
> = new Map([
  // P1 skills (v2.2)
  ["finmentum-crm", "finmentum"],
  ["new-reel", "finmentum"],
  ["frontend-design", "fleet"],
  ["self-improving-agent", "fleet"],
  ["tuya-ac", "personal"],
]);

/**
 * Classify an agent into one of the three scope families.
 *
 * Rules:
 *   - `fin-` prefix → finmentum
 *   - `clawdy` / `jas` → personal
 *   - everything else → fleet
 */
export function scopeForAgent(
  agentName: string,
): "finmentum" | "personal" | "fleet" {
  if (agentName.startsWith("fin-")) return "finmentum";
  if (agentName === "clawdy" || agentName === "jas") return "personal";
  return "fleet";
}

/**
 * Test whether `skillName` may be linked to `agentName` under the v2.2
 * scope rules. The `force` option (passed by the CLI's `--force-scope`
 * flag) bypasses all checks.
 *
 * Return `true` when:
 *   - force is set, OR
 *   - the skill is fleet-scoped (or unknown — defaults to fleet), OR
 *   - the skill's scope equals the agent's scope
 */
export function canLinkSkillToAgent(
  skillName: string,
  agentName: string,
  opts?: { readonly force?: boolean },
): boolean {
  if (opts?.force === true) return true;
  const skillScope = SCOPE_TAGS.get(skillName) ?? "fleet";
  if (skillScope === "fleet") return true;
  const agentScope = scopeForAgent(agentName);
  return skillScope === agentScope;
}
