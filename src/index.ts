/**
 * ClawCode public API.
 *
 * Re-exports core modules for programmatic usage by consumers
 * who want to use ClawCode without the CLI.
 */

// Config loading and resolution
export { loadConfig, resolveAllAgents, resolveAgentConfig } from "./config/loader.js";

// Config schema and types
export { configSchema } from "./config/schema.js";
export type { Config, AgentConfig } from "./config/schema.js";

// Workspace creation
export { createWorkspace, createWorkspaces } from "./agent/workspace.js";

// Shared types
export type { ResolvedAgentConfig, WorkspaceResult } from "./shared/types.js";

// Errors
export {
  ConfigValidationError,
  ConfigFileNotFoundError,
  WorkspaceError,
} from "./shared/errors.js";
