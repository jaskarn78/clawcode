import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Registry, RegistryEntry } from "./types.js";
import { ManagerError } from "../shared/errors.js";

/**
 * Empty registry constant — used as the default when no registry file exists.
 */
export const EMPTY_REGISTRY: Registry = {
  entries: [],
  updatedAt: 0,
} as const;

/**
 * Read the registry from a JSON file on disk.
 * Returns EMPTY_REGISTRY if the file does not exist.
 * Throws ManagerError if the file contains invalid JSON.
 *
 * @param path - Absolute path to the registry JSON file
 */
export async function readRegistry(path: string): Promise<Registry> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return EMPTY_REGISTRY;
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as Registry;
  } catch {
    const err = new ManagerError(`Corrupt registry file at ${path}: invalid JSON`);
    err.name = "ManagerError";
    throw err;
  }
}

/**
 * Write the registry to disk atomically.
 * Writes to a .tmp file first, then renames (atomic on POSIX).
 * Creates parent directories if they do not exist.
 *
 * @param path - Absolute path to the registry JSON file
 * @param registry - The registry state to persist
 */
export async function writeRegistry(
  path: string,
  registry: Registry,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });

  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
  await rename(tmpPath, path);
}

/**
 * Create a new registry entry with default values.
 * Status is "stopped", all counters are 0, all nullable fields are null.
 *
 * @param name - The agent name
 */
export function createEntry(name: string): RegistryEntry {
  return {
    name,
    status: "stopped",
    sessionId: null,
    startedAt: null,
    restartCount: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastStableAt: null,
    // Phase 56 Plan 01 — warm-path fields default to pre-check state.
    warm_path_ready: false,
    warm_path_readiness_ms: null,
  };
}

/**
 * Update a named entry in the registry, returning a new Registry object.
 * Does NOT mutate the original registry (immutable update).
 * Throws ManagerError if the named agent is not found.
 *
 * @param registry - The current registry state
 * @param name - The agent name to update
 * @param updates - Partial fields to merge into the entry
 */
export function updateEntry(
  registry: Registry,
  name: string,
  updates: Partial<Omit<RegistryEntry, "name">>,
): Registry {
  const index = registry.entries.findIndex((e) => e.name === name);
  if (index === -1) {
    throw new ManagerError(`Agent '${name}' not found in registry`);
  }

  const existingEntry = registry.entries[index];
  const updatedEntry: RegistryEntry = { ...existingEntry, ...updates };

  const newEntries = registry.entries.map((entry, i) =>
    i === index ? updatedEntry : entry,
  );

  return {
    entries: newEntries,
    updatedAt: Date.now(),
  };
}

/**
 * Type guard for Node.js system errors with a code property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
