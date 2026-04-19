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
    // clawdy-v2-stability (2026-04-19) — stoppedAt is populated only when
    // stopAgent transitions the entry to status="stopped". A newly-created
    // entry is never "already stopped" in the reap sense, so null here.
    stoppedAt: null,
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
  readonly reason:
    | "unknown-agent"
    | "orphaned-subagent"
    | "orphaned-thread"
    | "stale-subagent"
    | "stale-thread"
    | "phantom-subagent"
    | "phantom-thread";
};

/**
 * Default TTL for reaping stopped subagent / thread-session entries. Any
 * sub/thread entry with `status:"stopped"` and a `stoppedAt` older than this
 * TTL (or missing `stoppedAt` — legacy pre-fix data) is considered abandoned
 * and pruned by {@link reconcileRegistry}. 1 hour balances "keep recently-stopped
 * entries visible in dashboards for debug" against "don't let gravestones
 * accumulate for days". Parent agents are NEVER reaped by this TTL — only
 * `*-sub-*` and `*-thread-*` entries.
 */
export const STOPPED_SUBAGENT_REAP_TTL_MS = 60 * 60 * 1000;

/**
 * Reconcile the registry against the currently-configured set of agents.
 *
 * Returns a new Registry with ghost entries removed, plus a list of pruned
 * entries for logging. Does NOT mutate the input registry.
 *
 * Retention rules (an entry is KEPT iff any of these is true):
 *   1. `entry.name` is in `knownAgentNames` (a configured agent). Parent
 *      agents are NEVER TTL-reaped — even when stopped they represent
 *      actual configured agents and the operator expects persistent state.
 *   2. `entry.name` matches `{parent}-sub-{id}` AND parent ∈ `knownAgentNames`
 *      AND the entry is either not stopped, or stopped within the reap TTL.
 *   3. `entry.name` matches `{parent}-thread-{id}` AND parent ∈ `knownAgentNames`
 *      AND the entry is either not stopped, or stopped within the reap TTL.
 *
 * Any other entry is pruned with a reason:
 *   - `"unknown-agent"` — no `-sub-` / `-thread-` suffix, and name not in
 *     `knownAgentNames`.
 *   - `"orphaned-subagent"` — has `-sub-` suffix but parent segment is empty
 *     or not in `knownAgentNames`.
 *   - `"orphaned-thread"` — has `-thread-` suffix but parent segment is empty
 *     or not in `knownAgentNames`.
 *   - `"stale-subagent"` — subagent whose parent IS configured but the entry
 *     has been `status:"stopped"` longer than {@link STOPPED_SUBAGENT_REAP_TTL_MS}
 *     (or the entry predates the `stoppedAt` field, meaning it's legacy zombie
 *     data and should be cleaned up on first boot with the new reap path).
 *   - `"stale-thread"` — same rule for thread-session entries.
 *   - `"phantom-subagent"` — subagent whose parent IS configured, `status` is
 *     NOT `"stopped"` (e.g. `"running"` / `"starting"`), AND the caller passed
 *     `pruneNonStoppedSubagents: true`. Used on daemon boot to reap entries
 *     whose child process crashed in a prior daemon instance before
 *     `stopAgent` could transition them to `"stopped"` — no child process is
 *     alive across a daemon restart, so any non-stopped sub/thread entry at
 *     boot is by definition a phantom.
 *   - `"phantom-thread"` — same rule for thread-session entries.
 *
 * Names like `-sub-foo` / `-thread-foo` (empty parent segment) are routed to
 * `orphaned-subagent` / `orphaned-thread` respectively — structurally they
 * look like subagent/thread sessions with a broken parent, and the empty
 * string is never treated as a live parent even if it happens to be present
 * in `knownAgentNames`.
 *
 * When no pruning occurs the original registry is returned by reference
 * (identity-equal) so callers can skip the `writeRegistry` call entirely
 * on clean boots. When pruning occurs, `updatedAt` bumps to `now`.
 *
 * @param registry         The current registry state
 * @param knownAgentNames  The set of agent names currently configured
 * @param options          Optional overrides for reap behavior — `now` is
 *                         injected for tests; `reapTtlMs` defaults to
 *                         {@link STOPPED_SUBAGENT_REAP_TTL_MS};
 *                         `pruneNonStoppedSubagents` enables phantom reaping
 *                         (daemon passes `true` at boot — see JSDoc above).
 */
export function reconcileRegistry(
  registry: Registry,
  knownAgentNames: ReadonlySet<string>,
  options: {
    readonly now?: number;
    readonly reapTtlMs?: number;
    readonly pruneNonStoppedSubagents?: boolean;
  } = {},
): { readonly registry: Registry; readonly pruned: readonly PrunedEntry[] } {
  const now = options.now ?? Date.now();
  const reapTtlMs = options.reapTtlMs ?? STOPPED_SUBAGENT_REAP_TTL_MS;
  const pruneNonStopped = options.pruneNonStoppedSubagents ?? false;

  const pruned: PrunedEntry[] = [];
  const kept: RegistryEntry[] = [];

  /**
   * True when the sub/thread entry should be TTL-reaped — i.e. it is fully
   * stopped and either (a) stoppedAt is older than the TTL or (b) stoppedAt
   * is missing (legacy pre-fix data — treat as stopped long ago).
   *
   * Non-stopped statuses (starting / running / stopping / crashed / restarting /
   * failed) are always retained regardless of stoppedAt so we never reap an
   * entry mid-lifecycle. `failed` in particular is kept so operators can see
   * the terminal failure in the dashboard.
   */
  const isStaleStopped = (entry: RegistryEntry): boolean => {
    if (entry.status !== "stopped") return false;
    if (entry.stoppedAt == null) return true; // legacy entry — reap immediately
    return now - entry.stoppedAt >= reapTtlMs;
  };

  for (const entry of registry.entries) {
    // Rule 1: exact match to a configured agent — never TTL-reaped.
    if (knownAgentNames.has(entry.name)) {
      kept.push(entry);
      continue;
    }

    // Rule 2: live subagent session — name shaped like `{parent}-sub-{id}`.
    const subIdx = entry.name.indexOf("-sub-");
    if (subIdx !== -1) {
      const parent = entry.name.slice(0, subIdx);
      if (parent.length === 0 || !knownAgentNames.has(parent)) {
        pruned.push({ name: entry.name, reason: "orphaned-subagent" });
      } else if (isStaleStopped(entry)) {
        pruned.push({ name: entry.name, reason: "stale-subagent" });
      } else if (pruneNonStopped && entry.status !== "stopped") {
        pruned.push({ name: entry.name, reason: "phantom-subagent" });
      } else {
        kept.push(entry);
      }
      continue;
    }

    // Rule 3: live thread session — name shaped like `{parent}-thread-{id}`.
    const threadIdx = entry.name.indexOf("-thread-");
    if (threadIdx !== -1) {
      const parent = entry.name.slice(0, threadIdx);
      if (parent.length === 0 || !knownAgentNames.has(parent)) {
        pruned.push({ name: entry.name, reason: "orphaned-thread" });
      } else if (isStaleStopped(entry)) {
        pruned.push({ name: entry.name, reason: "stale-thread" });
      } else if (pruneNonStopped && entry.status !== "stopped") {
        pruned.push({ name: entry.name, reason: "phantom-thread" });
      } else {
        kept.push(entry);
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
    registry: { entries: kept, updatedAt: now },
    pruned,
  };
}

/**
 * Type guard for Node.js system errors with a code property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
