import { mkdir, writeFile, access, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { WorkspaceResult } from "../shared/types.js";
import { WorkspaceError } from "../shared/errors.js";
import {
  DEFAULT_SOUL,
  DEFAULT_IDENTITY_TEMPLATE,
  renderIdentity,
} from "../config/defaults.js";
import { resolveContent } from "../config/loader.js";
import { logger } from "../shared/logger.js";

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

/**
 * Create an isolated workspace directory for an agent.
 *
 * Creates the workspace directory structure (memory/, skills/) and populates
 * identity files (SOUL.md, IDENTITY.md) following idempotency rules:
 * - When soul/identity is undefined and file exists: skip (preserve user edits)
 * - When soul/identity is undefined and file missing: write defaults
 * - When soul/identity is defined in config: always overwrite (config is source of truth)
 *
 * @param agent - Resolved agent configuration
 * @returns Result describing what was created
 * @throws WorkspaceError if filesystem operations fail
 */
export async function createWorkspace(
  agent: ResolvedAgentConfig,
): Promise<WorkspaceResult> {
  const { workspace, name } = agent;
  const filesWritten: string[] = [];

  try {
    // Create directory structure
    await mkdir(workspace, { recursive: true });
    await mkdir(join(workspace, "memory"), { recursive: true });
    await mkdir(join(workspace, "skills"), { recursive: true });

    // SOUL.md logic
    const soulPath = join(workspace, "SOUL.md");
    if (agent.soul !== undefined) {
      // Config-provided soul: always overwrite (config is source of truth)
      const content = await resolveContent(agent.soul);
      await writeFile(soulPath, content, "utf-8");
      filesWritten.push(soulPath);
      logger.debug({ agent: name, file: "SOUL.md" }, "wrote config-provided SOUL.md");
    } else if (!(await fileExists(soulPath))) {
      // No config soul and file doesn't exist: write default
      await writeFile(soulPath, DEFAULT_SOUL, "utf-8");
      filesWritten.push(soulPath);
      logger.debug({ agent: name, file: "SOUL.md" }, "wrote default SOUL.md");
    } else {
      logger.debug({ agent: name, file: "SOUL.md" }, "preserving existing SOUL.md");
    }

    // IDENTITY.md logic
    const identityPath = join(workspace, "IDENTITY.md");
    if (agent.identity !== undefined) {
      // Config-provided identity: always overwrite
      const content = await resolveContent(agent.identity);
      await writeFile(identityPath, content, "utf-8");
      filesWritten.push(identityPath);
      logger.debug({ agent: name, file: "IDENTITY.md" }, "wrote config-provided IDENTITY.md");
    } else if (!(await fileExists(identityPath))) {
      // No config identity and file doesn't exist: write default with name interpolation
      const content = renderIdentity(DEFAULT_IDENTITY_TEMPLATE, name);
      await writeFile(identityPath, content, "utf-8");
      filesWritten.push(identityPath);
      logger.debug({ agent: name, file: "IDENTITY.md" }, "wrote default IDENTITY.md");
    } else {
      logger.debug({ agent: name, file: "IDENTITY.md" }, "preserving existing IDENTITY.md");
    }

    return {
      agentName: name,
      path: workspace,
      created: true,
      filesWritten,
    };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkspaceError(message, workspace);
  }
}

/**
 * Create workspaces for multiple agents sequentially.
 * Sequential execution provides clearer error reporting than parallel.
 *
 * @param agents - Array of resolved agent configurations
 * @returns Array of workspace results, one per agent
 */
export async function createWorkspaces(
  agents: readonly ResolvedAgentConfig[],
): Promise<WorkspaceResult[]> {
  const results: WorkspaceResult[] = [];

  for (const agent of agents) {
    const result = await createWorkspace(agent);
    results.push(result);
  }

  return results;
}
