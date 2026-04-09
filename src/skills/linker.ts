import { lstat, readlink, symlink, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type { SkillEntry, SkillsCatalog } from "./types.js";

/**
 * Create symlinks in an agent's workspace skills/ directory for each assigned skill.
 *
 * For each skill name in assignedSkillNames:
 * - Look up the SkillEntry in catalog
 * - If found, create a symlink at {agentSkillsDir}/{skillName} -> entry.path
 * - If symlink already exists and points to correct target, skip
 * - If symlink points to wrong target, remove and recreate
 * - If skill name not found in catalog, log warning and skip
 *
 * @param agentSkillsDir - Absolute path to the agent's workspace skills/ directory
 * @param assignedSkillNames - Skill names assigned to this agent
 * @param catalog - The full skills catalog from scanning
 * @param log - Optional pino logger
 */
export async function linkAgentSkills(
  agentSkillsDir: string,
  assignedSkillNames: readonly string[],
  catalog: SkillsCatalog,
  log?: Logger,
): Promise<void> {
  if (assignedSkillNames.length === 0) {
    return;
  }

  // Ensure the skills directory exists
  await mkdir(agentSkillsDir, { recursive: true });

  for (const skillName of assignedSkillNames) {
    const entry: SkillEntry | undefined = catalog.get(skillName);
    if (!entry) {
      log?.warn({ skill: skillName }, "Assigned skill not found in catalog, skipping");
      continue;
    }

    const linkPath = join(agentSkillsDir, skillName);

    // Check existing symlink state
    try {
      const stats = await lstat(linkPath);
      if (stats.isSymbolicLink()) {
        const currentTarget = await readlink(linkPath);
        if (currentTarget === entry.path) {
          // Already correct, skip
          continue;
        }
        // Wrong target, remove and recreate
        await unlink(linkPath);
      } else {
        // Non-symlink file/dir exists at this path, skip with warning
        log?.warn({ skill: skillName, linkPath }, "Non-symlink exists at skill link path, skipping");
        continue;
      }
    } catch {
      // Path doesn't exist, which is fine -- we'll create it
    }

    await symlink(entry.path, linkPath);
    log?.debug({ skill: skillName, target: entry.path }, "Skill symlink created");
  }
}
