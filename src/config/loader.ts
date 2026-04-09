import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { configSchema } from "./schema.js";
import { expandHome } from "./defaults.js";
import { ConfigFileNotFoundError, ConfigValidationError } from "../shared/errors.js";
import type { Config, AgentConfig, DefaultsConfig } from "./schema.js";
import type { ResolvedAgentConfig } from "../shared/types.js";

/**
 * Load and validate a clawcode.yaml config file.
 *
 * @param configPath - Path to the YAML config file
 * @returns Validated Config object
 * @throws ConfigFileNotFoundError if the file does not exist
 * @throws ConfigValidationError if the file fails schema validation
 */
export async function loadConfig(configPath: string): Promise<Config> {
  const expandedPath = expandHome(configPath);

  let rawText: string;
  try {
    rawText = await readFile(expandedPath, "utf-8");
  } catch {
    throw new ConfigFileNotFoundError(configPath);
  }

  const rawConfig: unknown = parseYaml(rawText);
  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    throw new ConfigValidationError(result.error, rawConfig);
  }

  return result.data;
}

/**
 * Resolve an agent config by merging with top-level defaults.
 * Returns a new object -- never mutates inputs.
 *
 * @param agent - Raw agent config from the parsed YAML
 * @param defaults - Top-level defaults section
 * @returns Fully resolved agent config
 */
export function resolveAgentConfig(
  agent: AgentConfig,
  defaults: DefaultsConfig,
): ResolvedAgentConfig {
  // Resolve heartbeat: if agent has heartbeat: false, disable but keep global config values
  const heartbeatConfig = agent.heartbeat === false
    ? { ...defaults.heartbeat, enabled: false }
    : defaults.heartbeat;

  return {
    name: agent.name,
    workspace: agent.workspace ?? join(expandHome(defaults.basePath), agent.name),
    channels: agent.channels,
    model: agent.model ?? defaults.model,
    skills: agent.skills.length > 0 ? agent.skills : defaults.skills,
    soul: agent.soul,
    identity: agent.identity,
    memory: agent.memory ?? defaults.memory,
    skillsPath: expandHome(defaults.skillsPath),
    heartbeat: heartbeatConfig,
    schedules: agent.schedules,
    admin: agent.admin ?? false,
    subagentModel: agent.subagentModel,
    threads: agent.threads ?? defaults.threads,
    webhook: agent.webhook ?? undefined,
    slashCommands: agent.slashCommands,
  };
}

/**
 * Resolve a content value that may be inline text or a file path.
 *
 * Resolution logic:
 * 1. If the value contains a newline, it's inline content -- return as-is
 * 2. If the value looks like a file path (starts with /, ./, ~/) and the file exists, read it
 * 3. Otherwise return as-is (treat as inline content)
 *
 * @param value - Inline content string or file path
 * @returns Resolved content string
 */
export async function resolveContent(value: string): Promise<string> {
  // Inline content: contains newlines
  if (value.includes("\n")) {
    return value;
  }

  // File path: starts with /, ./, or ~/
  if (/^[.~\/]/.test(value)) {
    const expandedPath = expandHome(value);
    if (await fileExists(expandedPath)) {
      return readFile(expandedPath, "utf-8");
    }
  }

  // Default: treat as inline content
  return value;
}

/**
 * Resolve all agents in a config by merging with defaults.
 *
 * @param config - Validated config object
 * @returns Array of fully resolved agent configs
 */
export function resolveAllAgents(config: Config): ResolvedAgentConfig[] {
  return config.agents.map((agent) => resolveAgentConfig(agent, config.defaults));
}

/**
 * Check if a file exists at the given path.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
