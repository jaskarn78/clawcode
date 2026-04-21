import type { EffortLevel } from "../config/schema.js";

/**
 * A single skill entry parsed from a SKILL.md file in a skills directory.
 */
export type SkillEntry = {
  readonly name: string;
  readonly description: string;
  readonly version: string | null;
  readonly path: string;
  /**
   * Phase 83 EFFORT-05 — per-skill effort override.
   *
   * When set, turns that explicitly invoke this skill run at this
   * effort level, then revert at turn boundary. Parsed from SKILL.md
   * YAML frontmatter `effort:` field via extractEffortFrontmatter.
   * Undefined when the skill's SKILL.md omits the field, has no
   * frontmatter, or sets an invalid level (silently ignored).
   */
  readonly effort?: EffortLevel;
};

/**
 * A catalog of discovered skills, keyed by skill name (directory name).
 */
export type SkillsCatalog = ReadonlyMap<string, SkillEntry>;
