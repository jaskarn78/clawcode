import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ThreadBinding, ThreadBindingRegistry } from "./thread-types.js";
import { ManagerError } from "../shared/errors.js";

/**
 * Empty registry constant -- used as the default when no registry file exists.
 */
export const EMPTY_THREAD_REGISTRY: ThreadBindingRegistry = {
  bindings: [],
  updatedAt: 0,
} as const;

/**
 * Read the thread registry from a JSON file on disk.
 * Returns EMPTY_THREAD_REGISTRY if the file does not exist.
 * Throws ManagerError if the file contains invalid JSON.
 *
 * @param path - Absolute path to the thread registry JSON file
 */
export async function readThreadRegistry(
  path: string,
): Promise<ThreadBindingRegistry> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return EMPTY_THREAD_REGISTRY;
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as ThreadBindingRegistry;
  } catch {
    throw new ManagerError(
      `Corrupt thread registry file at ${path}: invalid JSON`,
    );
  }
}

/**
 * Write the thread registry to disk atomically.
 * Writes to a .tmp file first, then renames (atomic on POSIX).
 * Creates parent directories if they do not exist.
 *
 * @param path - Absolute path to the thread registry JSON file
 * @param registry - The registry state to persist
 */
export async function writeThreadRegistry(
  path: string,
  registry: ThreadBindingRegistry,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });

  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
  await rename(tmpPath, path);
}

/**
 * Add a new binding to the registry. Returns a new registry (immutable).
 * Throws ManagerError if a binding for the threadId already exists.
 *
 * @param registry - The current registry state
 * @param binding - The new thread binding to add
 */
export function addBinding(
  registry: ThreadBindingRegistry,
  binding: ThreadBinding,
): ThreadBindingRegistry {
  const existing = registry.bindings.find(
    (b) => b.threadId === binding.threadId,
  );
  if (existing) {
    throw new ManagerError(
      `Thread binding for '${binding.threadId}' already exists`,
    );
  }

  return {
    bindings: [...registry.bindings, binding],
    updatedAt: Date.now(),
  };
}

/**
 * Remove a binding by threadId. Returns a new registry (immutable).
 * Returns unchanged registry if threadId not found (no throw).
 *
 * @param registry - The current registry state
 * @param threadId - The thread ID to remove
 */
export function removeBinding(
  registry: ThreadBindingRegistry,
  threadId: string,
): ThreadBindingRegistry {
  const filtered = registry.bindings.filter((b) => b.threadId !== threadId);
  if (filtered.length === registry.bindings.length) {
    return registry;
  }

  return {
    bindings: filtered,
    updatedAt: Date.now(),
  };
}

/**
 * Update the lastActivity timestamp for a binding. Returns a new registry (immutable).
 * Returns unchanged registry if threadId not found.
 *
 * @param registry - The current registry state
 * @param threadId - The thread ID to update
 * @param timestamp - The new lastActivity timestamp
 */
export function updateActivity(
  registry: ThreadBindingRegistry,
  threadId: string,
  timestamp: number,
): ThreadBindingRegistry {
  const index = registry.bindings.findIndex((b) => b.threadId === threadId);
  if (index === -1) {
    return registry;
  }

  const existing = registry.bindings[index];
  const updated: ThreadBinding = { ...existing, lastActivity: timestamp };
  const newBindings = registry.bindings.map((b, i) =>
    i === index ? updated : b,
  );

  return {
    bindings: newBindings,
    updatedAt: Date.now(),
  };
}

/**
 * Find a binding by threadId. Returns undefined if not found.
 *
 * @param registry - The current registry state
 * @param threadId - The thread ID to look up
 */
export function getBindingForThread(
  registry: ThreadBindingRegistry,
  threadId: string,
): ThreadBinding | undefined {
  return registry.bindings.find((b) => b.threadId === threadId);
}

/**
 * Get all bindings for a given agent name.
 *
 * @param registry - The current registry state
 * @param agentName - The agent name to filter by
 */
export function getBindingsForAgent(
  registry: ThreadBindingRegistry,
  agentName: string,
): readonly ThreadBinding[] {
  return registry.bindings.filter((b) => b.agentName === agentName);
}

/**
 * Phase 999.36 sub-bug C (D-09, D-10) — find a binding by sessionName.
 *
 * The subagent's sessionName is the SDK-level agent identity (e.g.
 * `fin-acquisition-sub-OV9rkf`). When the LLM in a subagent context
 * calls `clawcode_share_file` and passes `agent: <its own sessionName>`,
 * the daemon's IPC handler uses this helper to resolve the actual
 * Discord thread the subagent is bound to — overriding the otherwise-
 * incorrect fallback to `agentConfig.channels[0]`.
 *
 * Returns undefined for non-subagent invocations (no binding has the
 * given sessionName) — caller MUST fall through to existing channel
 * resolution.
 *
 * Disambiguates the shared-workspace failure class: when two agents in
 * the same workspace (e.g. fin-acquisition + finmentum-content-creator)
 * spawn subagents, each subagent's sessionName is unique even though
 * the parent agentName field on the binding is shared by the family.
 * Looking up by sessionName picks the correct binding deterministically.
 *
 * @param registry - The current registry state
 * @param sessionName - The subagent session name to look up
 */
export function getBindingForSession(
  registry: ThreadBindingRegistry,
  sessionName: string,
): ThreadBinding | undefined {
  return registry.bindings.find((b) => b.sessionName === sessionName);
}

/**
 * Type guard for Node.js system errors with a code property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
