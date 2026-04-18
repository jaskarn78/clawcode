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
 * A registry entry removed by {@link reconcileRegistry}, together with the
 * reason the pruner rejected it. Emitted for ops logging so operators can
 * trace ghost-entry removals in journalctl.
 */
export type PrunedEntry = {
  readonly name: string;
  readonly reason: "unknown-agent" | "orphaned-subagent" | "orphaned-thread";
};

/**
 * Reconcile the registry against the currently-configured set of agents.
 *
 * Returns a new Registry with ghost entries removed, plus a list of pruned
 * entries for logging. Does NOT mutate the input registry.
 *
 * Retention rules (an entry is KEPT iff any of these is true):
 *   1. `entry.name` is in `knownAgentNames` (a configured agent).
 *   2. `entry.name` matches `{parent}-sub-{id}` AND parent ∈ `knownAgentNames`.
 *   3. `entry.name` matches `{parent}-thread-{id}` AND parent ∈ `knownAgentNames`.
 *
 * Any other entry is pruned with a reason:
 *   - `"unknown-agent"` — no `-sub-` / `-thread-` suffix, and name not in
 *     `knownAgentNames`.
 *   - `"orphaned-subagent"` — has `-sub-` suffix but parent segment is empty
 *     or not in `knownAgentNames`.
 *   - `"orphaned-thread"` — has `-thread-` suffix but parent segment is empty
 *     or not in `knownAgentNames`.
 *
 * Names like `-sub-foo` / `-thread-foo` (empty parent segment) are routed to
 * `orphaned-subagent` / `orphaned-thread` respectively — structurally they
 * look like subagent/thread sessions with a broken parent, and the empty
 * string is never treated as a live parent even if it happens to be present
 * in `knownAgentNames`.
 *
 * When no pruning occurs the original registry is returned by reference
 * (identity-equal) so callers can skip the `writeRegistry` call entirely
 * on clean boots. When pruning occurs, `updatedAt` bumps to `Date.now()`.
 *
 * @param registry         The current registry state
 * @param knownAgentNames  The set of agent names currently configured
 */
export function reconcileRegistry(
  registry: Registry,
  knownAgentNames: ReadonlySet<string>,
): { readonly registry: Registry; readonly pruned: readonly PrunedEntry[] } {
  const pruned: PrunedEntry[] = [];
  const kept: RegistryEntry[] = [];

  for (const entry of registry.entries) {
    // Rule 1: exact match to a configured agent.
    if (knownAgentNames.has(entry.name)) {
      kept.push(entry);
      continue;
    }

    // Rule 2: live subagent session — name shaped like `{parent}-sub-{id}`.
    const subIdx = entry.name.indexOf("-sub-");
    if (subIdx !== -1) {
      const parent = entry.name.slice(0, subIdx);
      if (parent.length > 0 && knownAgentNames.has(parent)) {
        kept.push(entry);
      } else {
        pruned.push({ name: entry.name, reason: "orphaned-subagent" });
      }
      continue;
    }

    // Rule 3: live thread session — name shaped like `{parent}-thread-{id}`.
    const threadIdx = entry.name.indexOf("-thread-");
    if (threadIdx !== -1) {
      const parent = entry.name.slice(0, threadIdx);
      if (parent.length > 0 && knownAgentNames.has(parent)) {
        kept.push(entry);
      } else {
        pruned.push({ name: entry.name, reason: "orphaned-thread" });
      }
      continue;
    }

    // No structural match — plain unknown agent.
    pruned.push({ name: entry.name, reason: "unknown-agent" });
  }

  if (pruned.length === 0) {
    return { registry, pruned: [] };
  }

  return {
    registry: { entries: kept, updatedAt: Date.now() },
    pruned,
  };
}

/**
 * Type guard for Node.js system errors with a code property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
