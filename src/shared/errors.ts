import type { z } from "zod/v4";

/**
 * Thrown when the config file fails Zod schema validation.
 * Includes formatted error messages with agent name context.
 */
export class ConfigValidationError extends Error {
  readonly issues: readonly string[];

  constructor(error: z.ZodError, rawConfig?: unknown) {
    const issues = formatZodIssues(error, rawConfig);
    super(`Config validation failed:\n${issues.join("\n")}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

/**
 * Thrown when the config file does not exist at the specified path.
 */
export class ConfigFileNotFoundError extends Error {
  readonly configPath: string;

  constructor(configPath: string) {
    super(`Config file not found: ${configPath}`);
    this.name = "ConfigFileNotFoundError";
    this.configPath = configPath;
  }
}

/**
 * Thrown when workspace creation or modification fails.
 */
export class WorkspaceError extends Error {
  readonly workspacePath: string;

  constructor(message: string, workspacePath: string) {
    super(`Workspace error at ${workspacePath}: ${message}`);
    this.name = "WorkspaceError";
    this.workspacePath = workspacePath;
  }
}

/**
 * Format Zod issues with agent name context for user-friendly error messages.
 * Transforms paths like ".agents[2].channels[0]" into
 * "Agent 'researcher': channels[0] must be a string".
 */
function formatZodIssues(error: z.ZodError, rawConfig?: unknown): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.filter(
      (p): p is string | number => typeof p === "string" || typeof p === "number",
    );
    const agentName = resolveAgentName(path, rawConfig);
    const fieldPath = extractFieldPath(path);
    const prefix = agentName ? `Agent '${agentName}': ` : "";
    return `  - ${prefix}${fieldPath}: ${issue.message}`;
  });
}

/**
 * Extract agent name from the raw config using the path index.
 */
function resolveAgentName(
  path: readonly (string | number)[],
  rawConfig?: unknown,
): string | undefined {
  if (!rawConfig || typeof rawConfig !== "object" || rawConfig === null) {
    return undefined;
  }

  const agentsIndex = path.indexOf("agents");
  if (agentsIndex === -1 || agentsIndex + 1 >= path.length) {
    return undefined;
  }

  const agentIdx = path[agentsIndex + 1];
  if (typeof agentIdx !== "number") {
    return undefined;
  }

  const config = rawConfig as Record<string, unknown>;
  const agents = config["agents"];
  if (!Array.isArray(agents) || agentIdx >= agents.length) {
    return undefined;
  }

  const agent = agents[agentIdx] as Record<string, unknown> | undefined;
  return typeof agent?.["name"] === "string" ? agent["name"] : undefined;
}

/**
 * Extract a human-readable field path, skipping the "agents[N]" prefix
 * when agent context is available.
 */
function extractFieldPath(path: readonly (string | number)[]): string {
  const parts = path.map((p) => (typeof p === "number" ? `[${p}]` : p));
  return parts.join(".").replace(/\.\[/g, "[") || "(root)";
}
