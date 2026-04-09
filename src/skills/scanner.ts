import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type { SkillEntry, SkillsCatalog } from "./types.js";

/**
 * Parse YAML frontmatter from a SKILL.md file content.
 * Extracts `version` field if present. Returns null if no frontmatter or no version.
 */
function extractVersion(content: string): string | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const versionMatch = frontmatterMatch[1].match(/^version:\s*(.+)$/m);
  return versionMatch ? versionMatch[1].trim() : null;
}

/**
 * Extract the first paragraph (description) from SKILL.md content.
 * Skips YAML frontmatter and leading blank lines.
 * First paragraph = first non-empty lines before a blank line.
 */
function extractDescription(content: string): string {
  // Strip frontmatter if present
  const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n*/, "");

  const lines = withoutFrontmatter.split("\n");
  const paragraphLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" && paragraphLines.length > 0) {
      break;
    }
    if (trimmed !== "") {
      paragraphLines.push(trimmed);
    }
  }

  return paragraphLines.join(" ");
}

/**
 * Scan a directory of skill folders and return a catalog of discovered skills.
 *
 * Each subdirectory must contain a SKILL.md file to be recognized as a skill.
 * Directories without SKILL.md are skipped with a warning log.
 * Non-existent or empty directories return an empty catalog.
 *
 * @param skillsPath - Absolute path to the skills directory
 * @param log - Optional pino logger for warnings
 * @returns A SkillsCatalog (ReadonlyMap) keyed by skill directory name
 */
export async function scanSkillsDirectory(
  skillsPath: string,
  log?: Logger,
): Promise<SkillsCatalog> {
  const catalog = new Map<string, SkillEntry>();

  let entries: string[];
  try {
    entries = await readdir(skillsPath);
  } catch {
    log?.warn({ skillsPath }, "Skills directory does not exist, returning empty catalog");
    return catalog;
  }

  for (const entry of entries) {
    const entryPath = join(skillsPath, entry);

    // Skip non-directories
    const entryStat = await stat(entryPath);
    if (!entryStat.isDirectory()) {
      continue;
    }

    const skillMdPath = join(entryPath, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillMdPath, "utf-8");
    } catch {
      log?.warn({ skill: entry }, "Skipping directory without SKILL.md");
      continue;
    }

    const version = extractVersion(content);
    const description = extractDescription(content);

    catalog.set(entry, {
      name: entry,
      description,
      version,
      path: entryPath,
    });
  }

  return catalog;
}
