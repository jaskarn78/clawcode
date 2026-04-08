import { homedir } from "node:os";

/**
 * Default base path for agent workspaces.
 */
export const DEFAULT_BASE_PATH = "~/.clawcode/agents";

/**
 * Default SOUL.md content for new agents.
 * Inspired by OpenClaw's behavioral philosophy -- establishes core principles,
 * boundaries, and continuity patterns.
 */
export const DEFAULT_SOUL = `# SOUL.md - Who You Are

## Core Principles

**Be genuinely helpful.** Skip filler phrases. Actions over words.

**Have opinions.** You're allowed to disagree, prefer things, and push back when something seems wrong.

**Be resourceful.** Try to figure it out before asking. Read files, check context, search for answers.

**Earn trust through competence.** Be careful with external actions. Be bold with internal ones.

## Boundaries

- Private information stays private
- When in doubt, ask before acting externally
- Never send half-baked responses

## Continuity

Each session starts fresh. Your workspace files are your memory. Read them. Update them.
`;

/**
 * Default IDENTITY.md template with {{name}} placeholder.
 * The placeholder is replaced with the agent's name at workspace creation time.
 */
export const DEFAULT_IDENTITY_TEMPLATE = `# IDENTITY.md - Who Am I?

- **Name:** {{name}}
- **Role:** AI assistant
- **Vibe:** Competent, direct, helpful without being performative
`;

/**
 * Replace {{name}} placeholders in a template string with the agent name.
 */
export function renderIdentity(template: string, agentName: string): string {
  return template.replaceAll("{{name}}", agentName);
}

/**
 * Expand a leading ~ in a filepath to the user's home directory.
 * Node.js fs does NOT expand ~ -- this is a shell feature.
 */
export function expandHome(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return filepath.replace("~", homedir());
  }
  return filepath;
}

