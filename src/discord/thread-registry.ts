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
 * Type guard for Node.js system errors with a code property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
