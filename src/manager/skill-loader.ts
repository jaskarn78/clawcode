/**
 * Phase 130 Plan 02 — skill manifest loader chokepoint.
 *
 * Single entry point for daemon-side SKILL.md manifest validation. Reads
 * a skill directory's SKILL.md frontmatter, validates it against
 * `SkillManifestSchema` (from `src/plugin-sdk`), and cross-checks
 * `requiredMcpServers` against the calling agent's enabled MCP server
 * list. On mismatch, refuses the skill (returns a typed result the
 * daemon filters on) and emits a structured log at every exit branch.
 *
 * Per `feedback_silent_path_bifurcation.md`: this is the ONLY place that
 * parses + validates SKILL.md manifests for load-time gating. The CLI's
 * `--validate` flag (Plan 03 T-02) reuses this same function. Scanner
 * (`src/skills/scanner.ts`) still parses `version` + `effort` + first
 * paragraph for the catalog — that's a separate concern (catalog
 * metadata vs. load-gate); duplication would create the bifurcation we
 * are explicitly preventing.
 *
 * Structured log keys (Phase 999.54 + Phase 127 precedent):
 *   - `phase130-skill-load-success` (info)  — `{skill, capabilities, requiredMcpServers}`
 *   - `phase130-skill-load-fail`    (error) — `{skill, missingMcp, enabledMcp}`
 *   - `phase130-skill-manifest-missing` (warn) — `{skill, path}`
 *   - `phase130-skill-manifest-parse-error` (error) — `{skill, issues}`
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  SkillManifestSchema,
  type SkillManifest,
} from "../plugin-sdk/index.js";

/**
 * Result of attempting to load and validate a single SKILL.md.
 *
 * `manifest` is non-null only when `status === "loaded"`. All other
 * statuses surface via the discriminator; callers should switch on
 * `status` rather than null-checking `manifest`.
 */
export type LoadSkillManifestResult =
  | { readonly status: "loaded"; readonly manifest: SkillManifest }
  | {
      readonly status: "refused-mcp-missing";
      readonly manifest: null;
      readonly missingMcp: readonly string[];
      readonly reason: string;
    }
  | { readonly status: "manifest-missing"; readonly manifest: null }
  | {
      readonly status: "parse-error";
      readonly manifest: null;
      readonly reason: string;
    };

/**
 * Frontmatter delimiter regex — mirrors `src/skills/scanner.ts`
 * `extractVersion` style. Captures the YAML block between the first
 * pair of `---` fences. Tolerant of trailing newlines after the closing
 * fence (the body following the frontmatter is ignored here).
 */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/**
 * Read + validate a skill's manifest, returning a discriminated-union
 * result. Pure I/O + parsing; no side effects beyond structured log
 * emission.
 *
 * @param skillDir absolute path to the skill directory containing SKILL.md
 * @param enabledMcpServers names of MCP servers the calling agent has enabled
 */
export function loadSkillManifest(
  skillDir: string,
  enabledMcpServers: readonly string[],
): LoadSkillManifestResult {
  const skillName = path.basename(skillDir);
  const skillMdPath = path.join(skillDir, "SKILL.md");

  if (!fs.existsSync(skillMdPath)) {
    // eslint-disable-next-line no-console
    console.warn(
      "phase130-skill-manifest-missing",
      JSON.stringify({ skill: skillName, path: skillMdPath }),
    );
    return { status: "manifest-missing", manifest: null };
  }

  const raw = fs.readFileSync(skillMdPath, "utf-8");
  const fmMatch = raw.match(FRONTMATTER_RE);
  if (!fmMatch) {
    // eslint-disable-next-line no-console
    console.warn(
      "phase130-skill-manifest-missing",
      JSON.stringify({ skill: skillName, path: skillMdPath }),
    );
    return { status: "manifest-missing", manifest: null };
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(fmMatch[1]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(
      "phase130-skill-manifest-parse-error",
      JSON.stringify({
        skill: skillName,
        issues: [{ path: "(yaml)", message }],
      }),
    );
    return {
      status: "parse-error",
      manifest: null,
      reason: `yaml parse error: ${message}`,
    };
  }

  // Empty frontmatter (e.g. `---\n\n---`) parses to null/undefined; treat
  // as "no manifest" same as missing fences. Matches scanner.ts back-compat
  // posture for the legacy skills that predate Phase 130.
  if (parsedYaml === null || parsedYaml === undefined) {
    // eslint-disable-next-line no-console
    console.warn(
      "phase130-skill-manifest-missing",
      JSON.stringify({ skill: skillName, path: skillMdPath }),
    );
    return { status: "manifest-missing", manifest: null };
  }

  const result = SkillManifestSchema.safeParse(parsedYaml);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join(".") || "(root)",
      message: i.message,
    }));
    // eslint-disable-next-line no-console
    console.error(
      "phase130-skill-manifest-parse-error",
      JSON.stringify({ skill: skillName, issues }),
    );
    return {
      status: "parse-error",
      manifest: null,
      reason: "schema mismatch",
    };
  }

  const manifest = result.data;
  const enabledSet = new Set(enabledMcpServers);
  const missingMcp = manifest.requiredMcpServers.filter(
    (s) => !enabledSet.has(s),
  );

  if (missingMcp.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      "phase130-skill-load-fail",
      JSON.stringify({
        skill: manifest.name,
        missingMcp,
        enabledMcp: [...enabledMcpServers],
      }),
    );
    return {
      status: "refused-mcp-missing",
      manifest: null,
      missingMcp,
      reason: `required MCP server(s) not enabled: ${missingMcp.join(", ")}`,
    };
  }

  // eslint-disable-next-line no-console
  console.info(
    "phase130-skill-load-success",
    JSON.stringify({
      skill: manifest.name,
      capabilities: manifest.capabilities,
      requiredMcpServers: manifest.requiredMcpServers,
    }),
  );
  return { status: "loaded", manifest };
}
