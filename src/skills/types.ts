/**
 * A single skill entry parsed from a SKILL.md file in a skills directory.
 */
export type SkillEntry = {
  readonly name: string;
  readonly description: string;
  readonly version: string | null;
  readonly path: string;
};

/**
 * A catalog of discovered skills, keyed by skill name (directory name).
 */
export type SkillsCatalog = ReadonlyMap<string, SkillEntry>;
